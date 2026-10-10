// Shared helpers for the playback module's tests: a manual clock, the old Hub's fake Sony and Sonos servers on the
// loopback interface (copied from `apps/hub/tests/playback.test.mjs` at main 483d3a93), and the module hosted by the
// module test kit's harness on a manual clock.
import {mkdtemp, rm} from 'node:fs/promises';
import {createServer, type IncomingMessage} from 'node:http';
import type {AddressInfo, Socket} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test as nodeTest, type TestContext} from 'node:test';
import {MessageValidator, type Message} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies, type PlaybackState} from '@jimmie-potts/event-contracts/v2/families';
import {DatabaseSync} from 'node:sqlite';
import {
  InProcessBus, type BunnyModule, type BusOptions, type CommandDraft, type Draft, type Handler, type Participant, type RequestOptions, type RequestResult, type Responder, type Scheduler,
  type SendOptions, type SubscribeOptions, type SyncHandler, type SyncOptions, type SyncProvider,
} from '@jimmie-potts/sdk';
import {ModuleHarness, type HarnessRecord} from '@jimmie-potts/sdk/testing';
import {CONTROL_PATH} from '../src/sonos.js';
import {PLAYBACK_SCHEMA, controlPlayback, createPlaybackModule, type PlaybackModuleOptions} from '../src/module.js';
import type {PlaybackConfig} from '../src/configuration.js';
import type {PlaybackAction} from '../src/playback.js';
import type {Deadline} from '../src/sources.js';
import type {SimulatedSpeakers} from '../src/simulated.js';
import type {SpeakerTransport} from '../src/transport.js';

/** node:test's test() with a timeout, so a wait that never ends fails the test instead of hanging the run. */
export function test(name: string, body: (context: TestContext) => void | Promise<void>): void {
  void nodeTest(name, {timeout: 30_000}, body);
}

export const START_MS = Date.parse('2026-10-07T12:00:00.000Z');

/** A manual wall clock with a scheduler on it. `advance` runs every timer that falls due, in order. */
export function manualClock(start = START_MS): {now: () => number; scheduler: Scheduler; advance: (ms: number) => void; pending: () => number} {
  let now = start;
  const timers = new Set<{at: number; callback: () => void}>();
  return {
    now: () => now,
    scheduler: {after: (delayMs, callback) => {
      const timer = {at: now + delayMs, callback};
      timers.add(timer);
      return () => { timers.delete(timer); };
    }},
    advance: ms => {
      const end = now + ms;
      for (;;) {
        const due = [...timers].filter(timer => timer.at <= end).sort((a, b) => a.at - b.at)[0];
        if (due === undefined) break;
        now = Math.max(now, due.at);
        if (timers.delete(due)) due.callback();
      }
      now = end;
    },
    pending: () => timers.size,
  };
}

/** Lets promises and I/O that are already due run. */
export async function flush(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) await new Promise(resolve => { setImmediate(resolve); });
}

/** Wraps prepared writes with a one-shot error callback at the module's real database boundary. */
export function withWriteFailure(database: DatabaseSync, takeFailure: () => Error | undefined): DatabaseSync {
  return new Proxy(database, {
    get(target, property) {
      if (property === 'prepare') return (sql: string) => {
        const statement = target.prepare(sql);
        const run = statement.run.bind(statement);
        return new Proxy(statement, {
          get(inner, key) {
            if (key === 'run') return (...parameters: Parameters<typeof run>) => {
              const failure = takeFailure();
              if (failure !== undefined) throw failure;
              return run(...parameters);
            };
            const value: unknown = Reflect.get(inner, key, inner);
            if (typeof value !== 'function') return value;
            return (...args: unknown[]): unknown => {
              const result: unknown = Reflect.apply(value, inner, args);
              return result;
            };
          },
        });
      };
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]): unknown => {
        const result: unknown = Reflect.apply(value, target, args);
        return result;
      };
    },
  });
}

/** A deadline on real time, for a source called outside the module. */
export const deadlineOf = (ms: number): Deadline => call => call(AbortSignal.timeout(ms));

/** A body, a raw string, or one of the strings 'hang' (never answer) and 'drop' (close the connection). */
type Reply = string | ({status?: number} & Record<string, unknown>) | undefined;
type Listening = {endpoint: string; close: () => Promise<void>; peak: () => number};

/** Serves one loopback HTTP server whose handler returns a reply, 'hang' or 'drop'. */
async function serve(path: string, handle: (request: IncomingMessage, body: string) => Promise<{reply: Reply; render: (reply: Exclude<Reply, undefined>) => {status: number; type: string; body: string}} | undefined>): Promise<Listening> {
  const sockets = new Set<Socket>();
  let active = 0, peak = 0;
  const server = createServer((request, response) => {
    void (async () => {
      let text = '';
      for await (const chunk of request) text += String(chunk);
      active += 1;
      peak = Math.max(peak, active);
      try {
        const handled = await handle(request, text);
        if (handled === undefined) return;
        const {reply, render} = handled;
        if (reply === 'hang') return;
        if (reply === 'drop') {
          request.socket.destroy();
          return;
        }
        if (reply === undefined) return;
        const {status, type, body} = render(reply);
        response.writeHead(status, {'content-type': type});
        response.end(body);
      } finally {
        active -= 1;
      }
    })();
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  const {port} = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${port}${path}`, peak: () => peak,
    close: () => new Promise(resolve => {
      for (const socket of sockets) socket.destroy();
      server.close(() => { resolve(); });
    }),
  };
}

export type SonyCall = {path: string; method: string; id: unknown; params: unknown; version: string};
export const airplay = (fields: Record<string, unknown> = {}): Record<string, unknown> => ({
  source: 'extInput:airPlay', uri: 'extInput:airPlay', output: '', stateInfo: {state: 'PLAYING', supplement: ''}, title: 'Song', artist: 'Artist',
  albumName: 'Album', applicationName: 'app', content: {thumbnailUrl: 'http://192.168.1.20:60200/thumbnail.jpg'}, ...fields,
});
export const playingInfo = (entries: unknown[]): {result: unknown[]} => ({result: [entries]});

/** Answers Sony JSON-RPC like the HT-A9. `set` replaces the reply with a body, a raw string, 'hang' or 'drop'. */
export async function fakeSony(): Promise<Listening & {calls: SonyCall[]; set: (next: (call: SonyCall) => Reply | Promise<Reply>) => void}> {
  const calls: SonyCall[] = [];
  let reply: (call: SonyCall) => Reply | Promise<Reply> = () => playingInfo([airplay()]);
  const listening = await serve('/sony', async (request, text) => {
    const parsed = JSON.parse(text) as Omit<SonyCall, 'path'>;
    const call = {path: request.url ?? '', ...parsed};
    calls.push(call);
    return {reply: await reply(call), render: value => typeof value === 'string' ? {status: 200, type: 'application/json', body: value} : (() => {
      const {status = 200, ...body} = value;
      return {status, type: 'application/json', body: JSON.stringify({id: call.id, ...body})};
    })()};
  });
  return {...listening, calls, set: next => { reply = next; }};
}

export const DIDL = ({title = 'Move Song', artist = 'Move Artist', album = 'Move Album'}: {title?: string | null; artist?: string | null; album?: string | null} = {}): string =>
  `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"><item id="-1" parentID="-1" restricted="true"><res protocolInfo="x-sonos-vli:*:*:*">x-sonos-vli:RINCON_000E58FFFFFF01400:2,airplay:1</res><r:streamContent></r:streamContent><upnp:albumArtURI>http://127.0.0.1:1400/getaa?s=1&amp;u=x</upnp:albumArtURI>${title === null ? '' : `<dc:title>${title}</dc:title>`}<upnp:class>object.item.audioItem.musicTrack</upnp:class>${artist === null ? '' : `<dc:creator>${artist}</dc:creator>`}${album === null ? '' : `<upnp:album>${album}</upnp:album>`}</item></DIDL-Lite>`;
export const escapeXml = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const envelope = (inner: string): string =>
  `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>${inner}</s:Body></s:Envelope>`;
export const soapFault = (code: number): string =>
  envelope(`<s:Fault><faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail><UPnPError xmlns="urn:schemas-upnp-org:control-1-0"><errorCode>${code}</errorCode></UPnPError></detail></s:Fault>`);

export type SonosCall = {path: string; action: string | undefined; soapaction: string | undefined; contentType: string | undefined; body: string};
export type SonosState = {transport: string; uri: string; metadata: string; actions: string; duration: string; rel: string};

/** Answers UPnP AVTransport SOAP like the Sonos Move. `state` drives the default replies; `set` overrides them with a body, {status, body}, 'hang' or 'drop'. */
export async function fakeSonos(): Promise<Listening & {calls: SonosCall[]; state: SonosState; set: (next: ((call: SonosCall) => Reply | Promise<Reply>) | undefined) => void}> {
  const calls: SonosCall[] = [];
  let reply: ((call: SonosCall) => Reply | Promise<Reply>) | undefined;
  const state: SonosState = {
    transport: 'PLAYING', uri: 'x-sonos-vli:RINCON_000E58FFFFFF01400:2,airplay:1', metadata: DIDL(), actions: 'Set, Stop, Pause, Play, Next, Previous',
    duration: '0:03:41', rel: '0:01:03',
  };
  const responses: Record<string, () => string> = {
    GetTransportInfo: () => `<u:GetTransportInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><CurrentTransportState>${state.transport}</CurrentTransportState><CurrentTransportStatus>OK</CurrentTransportStatus><CurrentSpeed>1</CurrentSpeed></u:GetTransportInfoResponse>`,
    GetPositionInfo: () => `<u:GetPositionInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><Track>1</Track><TrackDuration>${state.duration}</TrackDuration><TrackMetaData>${escapeXml(state.metadata)}</TrackMetaData><TrackURI>${escapeXml(state.uri)}</TrackURI><RelTime>${state.rel}</RelTime><AbsTime>NOT_IMPLEMENTED</AbsTime><RelCount>2147483647</RelCount><AbsCount>2147483647</AbsCount></u:GetPositionInfoResponse>`,
    GetCurrentTransportActions: () => `<u:GetCurrentTransportActionsResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><Actions>${state.actions}</Actions></u:GetCurrentTransportActionsResponse>`,
  };
  const xml = 'text/xml; charset="utf-8"';
  const listening = await serve(CONTROL_PATH, async (request, text) => {
    const soapaction = request.headers.soapaction;
    const header = Array.isArray(soapaction) ? soapaction[0] : soapaction;
    const action = /^"urn:schemas-upnp-org:service:AVTransport:1#(\w+)"$/.exec(header ?? '')?.[1];
    const call: SonosCall = {path: request.url ?? '', action, soapaction: header, contentType: request.headers['content-type'], body: text};
    calls.push(call);
    const given = reply === undefined ? undefined : await reply(call);
    if (given !== undefined) {
      return {reply: given, render: value => typeof value === 'string' ? {status: 200, type: xml, body: value} : {status: value.status ?? 200, type: xml, body: String(value.body)}};
    }
    if (action === undefined || request.url !== CONTROL_PATH) return {reply: soapFault(401), render: () => ({status: 500, type: xml, body: soapFault(401)})};
    const inner = responses[action]?.() ?? `<u:${action}Response xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"></u:${action}Response>`;
    return {reply: inner, render: () => ({status: 200, type: xml, body: envelope(inner)})};
  });
  return {...listening, calls, state, set: next => { reply = next; }};
}

/** The playback section the module tests configure: the Move first, then the HT-A9, at documentation addresses. */
export const SECTION = {
  id: 'living-room',
  sources: [
    {kind: 'sonos', endpoint: 'http://192.168.1.30:1400/MediaRenderer/AVTransport/Control'},
    {kind: 'sony', endpoint: 'http://192.168.1.20:10000/sony'},
  ],
} as const;
export const ID = SECTION.id;

/** Whether a message is the playback record reporting `unavailable`. */
export const reportsUnavailable = (message: Message): boolean =>
  message.dataschema === PLAYBACK_SCHEMA && (message.data as Partial<PlaybackState>).availability === 'unavailable';

/** The playback module hosted by the kit's harness on a manual clock, with a requester and a watcher on its bus. */
export type Hosted = {
  harness: ModuleHarness;
  clock: ReturnType<typeof manualClock>;
  requester: Participant;
  published: Message[];
  /** The playback records published so far, in order. */
  records: () => PlaybackState[];
  /** The last playback record published. */
  record: () => PlaybackState;
  outcomes: () => Record<string, unknown>[];
  /** The current instance's log records. */
  logs: () => HarnessRecord[];
  /** Moves the manual clock in steps of at most `stepMs`, letting each step's reads settle. */
  advance: (ms: number, stepMs?: number) => Promise<void>;
  /** Sends a command as the operator, with a deadline on the manual clock, 60 s by default. */
  send: (action: PlaybackAction, requestId: string, expectedRevision?: number, timeoutMs?: number) => Promise<RequestResult>;
  /** Starts a new instance of the module on the same database, after `stop`. */
  start: () => Promise<void>;
  restart: () => Promise<void>;
  stop: () => Promise<void>;
  /**
   * Every published message that breaks profile 2.0, every error a handler or responder of the module threw, and every
   * failure of a module instance's timer or stop.
   */
  problems: () => string[];
  stateDir: string;
  readContent: (ref: string) => Promise<Awaited<ReturnType<NonNullable<BunnyModule['manifest']['content']>>>>;
};

/** Whether a speaker call is a command rather than one of the reads every poll makes. */
const isCommand = (call: string): boolean => call !== 'getPlayingContentInfo' && !call.startsWith('Get');

/**
 * The simulated speakers with a hook that runs as a speaker hears each command, before it answers, and a count of the
 * calls still in progress.
 */
export function hooked(speakers: SimulatedSpeakers, onCommand: (call: string) => void): SpeakerTransport & {inFlight: () => number} {
  let inFlight = 0;
  const track = async <T>(call: string, work: () => Promise<T>): Promise<T> => {
    inFlight += 1;
    try {
      if (isCommand(call)) onCommand(call);
      return await work();
    } finally {
      inFlight -= 1;
    }
  };
  return {
    sony: (endpoint, method, version, signal) => track(method, () => speakers.sony(endpoint, method, version, signal)),
    sonos: (endpoint, action, args, signal) => track(action, () => speakers.sonos(endpoint, action, args, signal)),
    inFlight: () => inFlight,
  };
}

/**
 * Makes the running module's own database connection refuse every write with `SQLITE_READONLY`, as a disk that fails
 * would; returns its release, which the module's stop makes needless. The module keeps its file to itself, as in the
 * runtime (Hub #972), so no other connection can take its lock.
 */
export function refuseWrites(hosted: Pick<Hosted, 'harness'>): () => void {
  const database = hosted.harness.moduleDatabase();
  if (database === undefined) throw new Error('the module has no open database');
  database.exec('PRAGMA query_only = ON');
  return () => {
    if (database.isOpen) database.exec('PRAGMA query_only = OFF');
  };
}

/**
 * The module's stored commands, as `request_id result`: through the module's own connection while it runs, which keeps
 * the file to itself (Hub #972), and otherwise from the file.
 */
export function storedCommands(hosted: Pick<Hosted, 'harness' | 'stateDir'>): string[] {
  const running = hosted.harness.moduleDatabase();
  const database = running ?? new DatabaseSync(join(hosted.stateDir, 'playback.sqlite'), {readOnly: true});
  try {
    return (database.prepare('SELECT request_id, result FROM playback_commands ORDER BY seq').all() as {request_id: string; result: string | null}[])
      .map(row => `${row.request_id} ${row.result ?? 'pending'}`);
  } finally {
    if (running === undefined) database.close();
  }
}

/** A bus that can hold the playback module's outcome publications until released, as a slow publish would. */
export class HeldBus extends InProcessBus {
  #gate: Promise<void> | undefined;
  #open: () => void = () => {};

  hold(): void {
    this.#gate ??= new Promise(resolve => { this.#open = resolve; });
  }

  release(): void {
    this.#open();
    this.#gate = undefined;
  }

  override connect(source: string): Participant {
    const inner = super.connect(source);
    if (source !== 'bunny/modules/playback') return inner;
    return {
      source: inner.source,
      publish: <T extends object>(key: string, draft: Draft<T>, options?: SendOptions) => inner.publish(key, draft, options),
      publishMessage: async <T extends object>(key: string, message: Message<T>) => {
        if (message.kind === 'outcome') await this.#gate;
        return inner.publishMessage(key, message);
      },
      subscribe: <T extends object>(pattern: string, handler: Handler<T>, options?: SubscribeOptions) => inner.subscribe<T>(pattern, handler, options),
      request: <T extends object>(key: string, draft: CommandDraft<T>, options: RequestOptions) => inner.request(key, draft, options),
      respond: <T extends object>(pattern: string, responder: Responder<T>) => inner.respond<T>(pattern, responder),
      sync: <T extends object>(families: readonly string[], handler: SyncHandler<T>, options: SyncOptions) => inner.sync<T>(families, handler, options),
      serveSync: (families: readonly string[], provider: SyncProvider) => inner.serveSync(families, provider),
      close: () => inner.close(),
    };
  }
}

type HostOptions = Omit<PlaybackModuleOptions, 'transport'> & {
  section?: unknown; transport?: SpeakerTransport;
  /** Wraps the module's database for focused storage-error tests. */
  wrapDatabase?: (database: DatabaseSync) => DatabaseSync;
  /** The manual clock to host on, when the speakers wait on it too; a new one by default. */
  clock?: ReturnType<typeof manualClock>;
  /** Builds the bus from the options the host gives it, such as a `HeldBus`. */
  bus?: (options: BusOptions) => InProcessBus;
};

export async function host(context: TestContext, speakers: SimulatedSpeakers, options: HostOptions = {}): Promise<Hosted> {
  const {
    section = SECTION, clock = manualClock(), bus: buildBus = (busOptions: BusOptions) => new InProcessBus(busOptions), wrapDatabase, ...moduleOptions
  } = options;
  const thrown: unknown[] = [];
  // The bus stamps `expiresat` and runs request deadlines on the module's manual clock, as the runtime's does.
  const bus = buildBus({
    now: clock.now, scheduler: clock.scheduler,
    onError: (error, {source}) => { if (source === 'bunny/modules/playback') thrown.push(error); },
  });
  const stateDir = await mkdtemp(join(tmpdir(), 'playback-module-'));
  const requester = bus.connect('bunny/parts/operator');
  const watcher = bus.connect('bunny/parts/watcher');
  const published: Message[] = [];
  const validator = new MessageValidator();
  registerCoreFamilies(validator);
  await watcher.subscribe('bunny.*.*.*', message => { published.push(message); });
  let readContent: BunnyModule['manifest']['content'];
  const build = (): ModuleHarness => {
    const inner = createPlaybackModule({transport: speakers, monotonic: clock.now, ...moduleOptions});
    readContent = inner.manifest.content;
    const module: BunnyModule<PlaybackConfig> = {
      manifest: inner.manifest,
      start: context => inner.start({...context, database: () => {
        const database = context.database();
        return wrapDatabase?.(database) ?? database;
      }}),
      stop: () => inner.stop(),
    };
    return new ModuleHarness(module, {bus, stateDir, clock: {now: clock.now}, scheduler: clock.scheduler, section});
  };
  const first = build();
  const hosted: Hosted & {instances: ModuleHarness[]} = {
    harness: first, instances: [first], clock, requester, published, stateDir,
    readContent: ref => Promise.resolve(readContent?.(ref)),
    records: () => published.filter(message => message.dataschema === PLAYBACK_SCHEMA).map(message => message.data as PlaybackState),
    record: () => {
      const last = hosted.records().at(-1);
      if (last === undefined) throw new Error('no playback record was published');
      return last;
    },
    outcomes: () => published.filter(message => message.kind === 'outcome').map(message => message.data),
    logs: () => hosted.harness.logs,
    advance: async (ms, stepMs = 100) => {
      await flush();
      for (let moved = 0; moved < ms; moved += stepMs) {
        clock.advance(Math.min(stepMs, ms - moved));
        await flush();
      }
    },
    send: (action, requestId, expectedRevision, timeoutMs = 60_000) => {
      const {key, draft} = controlPlayback(ID, action, expectedRevision);
      return requester.request(key, draft, {timeoutMs, requestId});
    },
    start: async () => {
      hosted.harness = build();
      hosted.instances.push(hosted.harness);
      await hosted.harness.start();
      await flush();
    },
    restart: async () => {
      await hosted.harness.stop();
      await hosted.start();
    },
    stop: () => hosted.harness.stop(),
    problems: () => {
      const invalid = published.flatMap(message => {
        const result = validator.validate(message);
        return result.ok ? [] : [`${message.type}: ${result.error.code} ${result.error.detail ?? ''}`];
      });
      return [...invalid, ...thrown.map(error => `a handler threw ${String(error)}`), ...hosted.instances.flatMap(instance => instance.failures.map(String))];
    },
  };
  context.after(async () => {
    await hosted.harness.stop();
    await Promise.all([requester.close(), watcher.close()]);
    await rm(stateDir, {recursive: true, force: true});
  });
  await hosted.harness.start();
  await flush();
  return hosted;
}
