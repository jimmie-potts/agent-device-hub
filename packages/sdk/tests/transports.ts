// The two transports the conformance suite runs against (Hub #883): the in-process bus, and remote participants that
// reach the same bus through a RemoteEdge over SSE and HTTP on 127.0.0.1. Every participant comes wrapped by `checked`.
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {
  InProcessBus, RemoteEdge, connectRemote, type BusOptions, type EdgeLogRecord, type ErrorScope, type Participant, type RemoteParticipant,
  type Scheduler,
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
  /** Waits until `count` calls of this kind were dropped by the remote part and seen so at the edge; at once in process. */
  dropped(call: 'request' | 'sync', count: number): Promise<void>;
  close(): Promise<void>;
};

/** `scheduler`, when given, runs every deadline and wait of the world: the bus's, the edge's and each remote client's. */
export type WorldOptions = {maxQueued?: number; scheduler?: Scheduler};

export type Transport = {
  name: 'in-process' | 'remote';
  start(options?: WorldOptions): Promise<World>;
  /**
   * What a closing participant's request gets while its command still waits in the responder's queue: `cancelled` in
   * process, where the bus knows, and `uncertain-result` remotely, where the requester cannot.
   */
  closedWhileQueued: 'cancelled' | 'uncertain-result';
};

export const inProcess: Transport = {
  name: 'in-process',
  closedWhileQueued: 'cancelled',
  start: ({maxQueued, scheduler} = {}) => {
    const errors: World['errors'] = [];
    const bus = new InProcessBus({
      onError: (error, scope) => { errors.push({error, scope}); }, ...(maxQueued === undefined ? {} : {maxQueued}),
      ...(scheduler === undefined ? {} : {scheduler}),
    });
    const local = (source: Source): Participant => checked(bus.connect(source));
    return Promise.resolve({
      bus, errors, local, connect: source => Promise.resolve(local(source)), arrived: () => Promise.resolve(), dropped: () => Promise.resolve(),
      close: () => Promise.resolve(),
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
  /** How many calls of each route the remote part dropped before the edge answered. */
  dropped(route: string): number;
  close(): Promise<void>;
};

export type EdgeSetup = {
  maxQueued?: number;
  /** The edge's own scheduler, apart from the bus's. */
  scheduler?: Scheduler;
  /** The bus's scheduler. */
  busScheduler?: Scheduler;
  /** Builds the edge's bus from its options, for a test that injects a fault into the bus. */
  bus?: (options: BusOptions) => InProcessBus;
  /** Holds the `nth` call of a route, counted from 1, until the returned promise settles, before the edge sees it. */
  before?: (route: string, nth: number) => Promise<void> | undefined;
};

/** A bus, its edge on 127.0.0.1 at a free port, and a fresh token for each source. */
export async function startEdge({maxQueued, scheduler, busScheduler, bus: build = options => new InProcessBus(options), before}: EdgeSetup = {}): Promise<Edge> {
  const errors: World['errors'] = [];
  const logs: EdgeLogRecord[] = [];
  const report = (error: unknown, scope: ErrorScope): void => { errors.push({error, scope}); };
  const bus = build({onError: report, ...(maxQueued === undefined ? {} : {maxQueued}), ...(busScheduler === undefined ? {} : {scheduler: busScheduler})});
  const tokens = new Map(SOURCES.map(source => [source, randomBytes(32).toString('base64url')]));
  const edge = new RemoteEdge({
    bus, validator, grants: [...tokens].map(([source, token]) => ({source, token})), log: record => { logs.push(record); },
    ...(scheduler === undefined ? {} : {scheduler}),
  });
  const received = new Map<string, number>();
  const dropped = new Map<string, number>();
  const arrivals = new Map<string, number>();
  const server: Server = createServer((request, response) => {
    const route = (request.url ?? '').split('/').pop() ?? '';
    const nth = (arrivals.get(route) ?? 0) + 1;
    arrivals.set(route, nth);
    request.once('end', () => { received.set(route, (received.get(route) ?? 0) + 1); });
    response.once('close', () => { if (!response.writableEnded) dropped.set(route, (dropped.get(route) ?? 0) + 1); });
    const held = before?.(route, nth);
    if (held === undefined) edge.handle(request, response);
    else void held.then(() => { edge.handle(request, response); });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const opened: RemoteParticipant[] = [];
  return {
    bus, edge, url, tokens, logs, errors, received: route => received.get(route) ?? 0, dropped: route => dropped.get(route) ?? 0,
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
  start: async ({maxQueued, scheduler} = {}) => {
    const queued = maxQueued === undefined ? {} : {maxQueued};
    const scheduled = scheduler === undefined ? {} : {scheduler};
    const edge = await startEdge({...queued, ...scheduled, ...(scheduler === undefined ? {} : {busScheduler: scheduler})});
    return {
      bus: edge.bus, errors: edge.errors, close: () => edge.close(),
      local: source => checked(edge.bus.connect(source)),
      connect: async source => checked(await edge.connect(source, {...queued, ...scheduled})),
      arrived: async (call, count) => {
        // The edge dispatches a call within microtasks of reading it.
        await until(() => edge.received(call) >= count, `${count} ${call} calls at the edge`);
        await flush();
      },
      dropped: async (call, count) => {
        await until(() => edge.dropped(call) >= count, `${count} dropped ${call} calls at the edge`);
        await flush();
      },
    };
  },
};

/** Runs `body` with a fresh world and always closes it. */
export async function using(transport: Transport, options: WorldOptions, body: (world: World) => Promise<void>): Promise<void> {
  const world = await transport.start(options);
  try {
    await body(world);
  } finally {
    await world.close();
  }
}
