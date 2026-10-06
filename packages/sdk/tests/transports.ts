// The two transports the conformance suite runs against (Hub #883): the in-process bus, and remote participants that
// reach the same bus through a RemoteEdge over SSE and HTTP on 127.0.0.1. Every participant comes wrapped by `checked`.
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {
  InProcessBus, RemoteEdge, connectRemote, type EdgeLogRecord, type ErrorScope, type RemoteParticipant, type Sdk,
} from '../src/index.js';
import {checked, validator} from './support.js';

/** The sources a test may connect; each gets a run-generated token on the remote transport. */
export const SOURCES = ['bunny/core', 'bunny/wall', 'bunny/second', 'bunny/rogue'] as const;
export type Source = typeof SOURCES[number];

export type World = {
  bus: InProcessBus;
  /** Errors the bus and every remote participant reported. */
  errors: {error: unknown; scope: ErrorScope}[];
  /** A participant over the transport under test. */
  connect(source: Source): Promise<Sdk>;
  /** A participant on the bus itself, whatever the transport. */
  local(source: Source): Sdk;
  close(): Promise<void>;
};

export type Transport = {
  name: 'in-process' | 'remote';
  start(options?: {maxQueued?: number}): Promise<World>;
  /** What a requester gets for a command still waiting in the responder's queue at its deadline. */
  queuedCommandAtDeadline: 'uncertain-result' | 'expired';
};

export const inProcess: Transport = {
  name: 'in-process',
  // Main's bus answers uncertain-result here; #880 makes it expired once it merges.
  queuedCommandAtDeadline: 'uncertain-result',
  start: ({maxQueued} = {}) => {
    const errors: World['errors'] = [];
    const bus = new InProcessBus({onError: (error, scope) => { errors.push({error, scope}); }, ...(maxQueued === undefined ? {} : {maxQueued})});
    const local = (source: Source): Sdk => checked(bus.connect(source));
    return Promise.resolve({bus, errors, local, connect: source => Promise.resolve(local(source)), close: () => Promise.resolve()});
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
  connect(source: Source, options?: {maxQueued?: number}): Promise<RemoteParticipant>;
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
  const server: Server = createServer(edge.handle);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const opened: RemoteParticipant[] = [];
  return {
    bus, edge, url, tokens, logs, errors,
    connect: async (source, options = {}) => {
      const remote = await connectRemote({
        url, source, token: tokens.get(source) ?? '', onError: report, reconnectDelayMs: 20,
        ...(options.maxQueued === undefined ? {} : {maxQueued: options.maxQueued}),
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
  // A remote requester cannot know whether the handler started, so its deadline is always uncertain.
  queuedCommandAtDeadline: 'uncertain-result',
  start: async ({maxQueued} = {}) => {
    const edge = await startEdge(maxQueued === undefined ? {} : {maxQueued});
    return {
      bus: edge.bus, errors: edge.errors, close: () => edge.close(),
      local: source => checked(edge.bus.connect(source)),
      connect: async source => checked(await edge.connect(source, maxQueued === undefined ? {} : {maxQueued})),
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
