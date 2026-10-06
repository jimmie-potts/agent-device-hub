// The two transports the conformance suite runs against (Hub #883): the in-process bus, and remote participants that
// reach the same bus through a RemoteEdge over SSE and HTTP on 127.0.0.1. Every participant comes wrapped by `checked`.
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {
  InProcessBus, RemoteEdge, connectRemote, type EdgeLogRecord, type ErrorScope, type Participant, type RemoteParticipant, type Scheduler,
} from '../src/index.js';
import {checked, flush, until, validator} from './support.js';

/** The sources a test may connect; each gets a run-generated token on the remote transport. */
export const SOURCES = ['bunny/core', 'bunny/wall', 'bunny/second', 'bunny/rogue'] as const;
export type Source = typeof SOURCES[number];

export type World = {
  bus: InProcessBus;
  /** Errors the bus and every remote participant reported. */
  errors: {error: unknown; scope: ErrorScope}[];
  /** A participant over the transport under test. */
  connect(source: Source): Promise<Participant>;
  /** A participant on the bus itself, whatever the transport. */
  local(source: Source): Participant;
  /** Waits until `count` calls of this kind have reached the bus: at once in process, once the edge read them remotely. */
  arrived(call: 'request' | 'sync', count: number): Promise<void>;
  close(): Promise<void>;
};

export type Transport = {
  name: 'in-process' | 'remote';
  start(options?: {maxQueued?: number}): Promise<World>;
  /**
   * What a closing participant's request gets while its command still waits in the responder's queue: `cancelled` in
   * process, where the bus knows, and `uncertain-result` remotely, where the requester cannot.
   */
  closedWhileQueued: 'cancelled' | 'uncertain-result';
};

export const inProcess: Transport = {
  name: 'in-process',
  closedWhileQueued: 'cancelled',
  start: ({maxQueued} = {}) => {
    const errors: World['errors'] = [];
    const bus = new InProcessBus({onError: (error, scope) => { errors.push({error, scope}); }, ...(maxQueued === undefined ? {} : {maxQueued})});
    const local = (source: Source): Participant => checked(bus.connect(source));
    return Promise.resolve({
      bus, errors, local, connect: source => Promise.resolve(local(source)), arrived: () => Promise.resolve(), close: () => Promise.resolve(),
    });
  },
};

export type Edge = {
  bus: InProcessBus;
  edge: RemoteEdge;
  url: string;
  tokens: ReadonlyMap<Source, string>;
  logs: EdgeLogRecord[];
  errors: World['errors'];
  /** A remote participant, not wrapped by `checked`, for tests that send what the profile refuses. */
  connect(source: Source, options?: {maxQueued?: number; scheduler?: Scheduler; now?: () => number}): Promise<RemoteParticipant>;
  /** How many calls of each route the edge has read. */
  received(route: string): number;
  close(): Promise<void>;
};

/** A bus, its edge on 127.0.0.1 at a free port, and a fresh token for each source. */
export async function startEdge({maxQueued}: {maxQueued?: number} = {}): Promise<Edge> {
  const errors: World['errors'] = [];
  const logs: EdgeLogRecord[] = [];
  const report = (error: unknown, scope: ErrorScope): void => { errors.push({error, scope}); };
  const bus = new InProcessBus({onError: report, ...(maxQueued === undefined ? {} : {maxQueued})});
  const tokens = new Map(SOURCES.map(source => [source, randomBytes(32).toString('base64url')]));
  const edge = new RemoteEdge({bus, validator, grants: [...tokens].map(([source, token]) => ({source, token})), log: record => { logs.push(record); }});
  const received = new Map<string, number>();
  const server: Server = createServer((request, response) => {
    const route = (request.url ?? '').split('/').pop() ?? '';
    request.once('end', () => { received.set(route, (received.get(route) ?? 0) + 1); });
    edge.handle(request, response);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const opened: RemoteParticipant[] = [];
  return {
    bus, edge, url, tokens, logs, errors, received: route => received.get(route) ?? 0,
    connect: async (source, options = {}) => {
      const remote = await connectRemote({
        url, source, token: tokens.get(source) ?? '', onError: report, reconnectDelayMs: 20,
        ...(options.maxQueued === undefined ? {} : {maxQueued: options.maxQueued}),
        ...(options.scheduler === undefined ? {} : {scheduler: options.scheduler}),
        ...(options.now === undefined ? {} : {now: options.now}),
      });
      opened.push(remote);
      return remote;
    },
    close: async () => {
      await Promise.all(opened.map(remote => remote.close()));
      await edge.close();
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    },
  };
}

export const remote: Transport = {
  name: 'remote',
  closedWhileQueued: 'uncertain-result',
  start: async ({maxQueued} = {}) => {
    const edge = await startEdge(maxQueued === undefined ? {} : {maxQueued});
    return {
      bus: edge.bus, errors: edge.errors, close: () => edge.close(),
      local: source => checked(edge.bus.connect(source)),
      connect: async source => checked(await edge.connect(source, maxQueued === undefined ? {} : {maxQueued})),
      arrived: async (call, count) => {
        // The edge dispatches a call within microtasks of reading it.
        await until(() => edge.received(call) >= count, `${count} ${call} calls at the edge`);
        await flush();
      },
    };
  },
};

/** Runs `body` with a fresh world and always closes it. */
export async function using(transport: Transport, options: {maxQueued?: number}, body: (world: World) => Promise<void>): Promise<void> {
  const world = await transport.start(options);
  try {
    await body(world);
  } finally {
    await world.close();
  }
}
