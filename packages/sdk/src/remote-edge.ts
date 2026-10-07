// The server side of the remote transport (Hub #883): a remote part's edge on the runtime's in-process bus. It
// authenticates each call, validates every inbound message against profile 2.0 and the 256 KiB cap, and carries the
// remote part's subscriptions, responders and sync owners over one event stream per connection.
import {createHash, randomUUID, timingSafeEqual} from 'node:crypto';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {
  MAX_DETAIL, MAX_MESSAGE_BYTES, errorBody, type ErrorBody, type ErrorCode, type Message, type MessageValidator,
} from '@jimmie-potts/event-contracts/v2';
import {errorType, levelOf, reporter, type Diagnostic, type EdgeRoute, type OnDiagnostic} from './diagnostics.js';
import {buildMessage, type Content} from './envelope.js';
import {failed, unanswered, undelivered, type InProcessBus} from './in-process.js';
import {refusalOf, replyOf} from './refusal.js';
import {overlaps, parseKey, parsePattern, type Pattern} from './routing.js';
import {
  CALLS, MAX_ANSWER_BYTES, MAX_CALL_BYTES, REMOTE_PATH, REMOTE_SCHEMA, SOURCE_HEADER, frame, statusOf, type Call, type StreamEventName,
} from './remote-protocol.js';
import {MAX_TIMEOUT_MS, SdkError, type Cancel, type Command, type Reply, type RequestResult, type Scheduler, type Sdk, type Subscription} from './sdk.js';
import {isSource, schemaFamily, type Snapshot, type SyncAnswer, type SyncRequest} from './sync.js';
import {childOf} from './trace.js';

/**
 * What a remote participant may do (Hub #835): the calls it may make and the routing-key patterns it may use. Either
 * left out allows all, as every grant did before. A key it publishes or requests must match one of `keys`; a pattern it
 * subscribes or responds to, and the state keys `bunny.state.<family>.*` of each family it syncs or serves, must lie
 * within one. `reply` comes with `respond` and `answer` with `serve`. Every part may open its stream and close what it
 * opened on it.
 *
 * `publishes` names the payload families, by the family of a message's `dataschema`, that it may publish; left out, any.
 * `excluded` names key patterns it may never use or receive, though `keys` covers them, such as the keys of a device
 * its grant does not name: a key it publishes or requests, or a pattern it responds to, may meet none; and what it
 * receives, through a subscription or a sync, leaves out every message and record whose key one matches.
 */
export type EdgePermissions = {
  readonly calls?: readonly Call[];
  readonly keys?: readonly string[];
  readonly publishes?: readonly string[];
  readonly excluded?: readonly string[];
};
/** One remote participant's credential: a bearer token that lets it act as `source`, with its permissions. */
export type RemoteGrant = {source: string; token: string} & EdgePermissions;
/**
 * Who an authenticated call acts as: its source and permissions, and an `id` naming its credential, so that the host
 * can end the streams of a credential it revokes (`disconnectPrincipal`).
 */
export type EdgePrincipal = {readonly source: string; readonly id?: string} & EdgePermissions;
export type EdgeOptions = {
  bus: InProcessBus;
  /** Validates every inbound message: profile 2.0, the registered payload schemas and the 256 KiB cap. */
  validator: MessageValidator;
  /**
   * One per remote source. A token may appear once; a source may hold several, as during a rotation. Ignored when
   * `authenticate` is given.
   */
  grants?: readonly RemoteGrant[];
  /**
   * The host's own authentication, in place of `grants`: who the request acts as, or undefined to refuse it as
   * `unauthenticated`. It runs for every call and must not throw; the runtime uses it for its credentials and browser
   * sessions (Hub #835).
   */
  authenticate?: (request: IncomingMessage) => EdgePrincipal | undefined;
  /** How often an open stream gets a comment line, so that its reader can tell a live stream from a lost one. Defaults to 15 s. */
  heartbeatMs?: number;
  /** The command memory's bounds, for tests: `MAX_REMEMBERED_PER_SOURCE`, `MAX_REMEMBERED_COMMANDS` and `REMEMBER_MS` by default. */
  commandMemory?: {perSource?: number; total?: number; rememberMs?: number};
  /**
   * Runs the heartbeats and stall limits. They concern real sockets, so they default to the global `setTimeout`, whatever
   * `scheduler` is, and never keep the process alive.
   */
  liveness?: Scheduler;
  /**
   * How long a stream's socket may stay full, its reader having stopped, before the edge ends the stream, so that its
   * subscriptions free their queued messages and the reader reconnects and syncs again. Defaults to 30 s.
   */
  stallMs?: number;
  /**
   * Hears the edge's own decisions: a part connected or disconnected, a call refused, and an exception it did not
   * expect, with the code it answered (`internal`, or `uncertain-result` once it had handed a command to its bus) and
   * the exception's type (ADR 0012, "Observability"). A record never carries a credential, a payload, a refusal's
   * detail or an exception's message; before authentication it carries only the route and the code. Repeated refusals
   * follow the repetition rule (`REFUSAL_WINDOW_MS`). A no-op by default; a throw is ignored.
   */
  onDiagnostic?: OnDiagnostic;
  now?: () => number;
  /**
   * Runs the edge's own waits for forwarded commands and sync requests, and its windows for repeated refusals. Defaults
   * to the global `setTimeout`.
   */
  scheduler?: Scheduler;
};

/**
 * How long the edge counts repeats of one refusal before it records them (ADR 0012, "Repetition"). The first refusal
 * of a run is recorded at once; later ones with the same route, code and source are counted, and each window that
 * counted any ends with one summary of the same refusal whose `attempts` is that count. A window with none ends the
 * run, so the next such refusal is recorded at once again. A part whose revoked token reconnects every few seconds
 * makes one record and then one a minute, not one per attempt.
 */
export const REFUSAL_WINDOW_MS = 60_000;
/** The edge's default heartbeat and stall limits (Hub #835). */
export const HEARTBEAT_MS = 15_000;
export const STALL_MS = 30_000;
/**
 * How many commands the edge remembers, so that a raw HTTP client that sends one again is refused (Hub #835): at most
 * `MAX_REMEMBERED_PER_SOURCE` for one source and `MAX_REMEMBERED_COMMANDS` in all. Past either, that source's next
 * command is refused with the retryable `capacity` until older ones are forgotten; another source still gets through.
 */
export const MAX_REMEMBERED_COMMANDS = 65_536;
export const MAX_REMEMBERED_PER_SOURCE = 1024;
/**
 * How long the edge remembers a command once its bus settled it: until its expiry, and at most this long. One the bus
 * refused before any responder had it is forgotten at once, since sending it again is safe.
 */
export const REMEMBER_MS = 10 * 60 * 1000;
/** The comment line the edge writes on an idle stream; a client's parser skips it. */
const HEARTBEAT = ': heartbeat\n\n';
const timers: Scheduler = {after: (delayMs, callback) => {
  const timer = setTimeout(callback, delayMs);
  return () => { clearTimeout(timer); };
}};
/** Real timers that never keep the process alive, for the liveness of real sockets. */
const realTimers: Scheduler = {after: (delayMs, callback) => {
  const timer = setTimeout(callback, delayMs).unref();
  return () => { clearTimeout(timer); };
}};

/**
 * How long past its expiry the edge still holds a forwarded command or sync request for the remote part's answer. The
 * bus settles the requester at the expiry itself, so this only frees the forward once nothing can use its answer.
 */
const FORWARD_MARGIN_MS = 100;
const ID = /^[A-Za-z0-9_.-]{1,128}$/;
const SOURCE = /^bunny(\/[a-z0-9][a-z0-9-]*)+$/;
const REPLY_SCHEMA = 'https://bunny.invalid/events/reply/2.0';

class Refusal extends Error {
  readonly body: ErrorBody;

  constructor(body: ErrorBody) {
    super(body.error.code);
    this.body = body;
  }
}
const refuse = (code: ErrorCode, detail: string): Refusal => new Refusal(errorBody(code, {detail: detail.slice(0, MAX_DETAIL)}));
/**
 * The edge's answer to an exception it did not expect: fixed text, because an exception's message may hold anything,
 * such as a credential a library quoted. The exception itself stays in memory; it reaches no response or log record.
 */
const FAILED: ErrorBody = errorBody('internal', {detail: 'the edge failed'});
/**
 * The same answer once the edge has handed a command to its bus: a handler may have run it, so the edge cannot claim
 * that nothing happened (ADR 0012, "Errors, effects and outcomes").
 */
const FAILED_AFTER_DISPATCH: ErrorBody = errorBody('uncertain-result', {detail: 'the edge failed after it sent the command'});
const digest = (token: string): Buffer => createHash('sha256').update(token, 'utf8').digest();
const isCall = (value: string): value is Call => (CALLS as readonly string[]).includes(value);
/** The route a record names: one of the edge's calls or its stream, or `other` for any path the caller chose. */
const routeOf = (route: string): EdgeRoute => isCall(route) || route === 'stream' ? route : 'other';
type Fields = Record<string, unknown>;
/** A run of one refusal: its first record, the repeats counted since the last record, and its window's timer. */
type Repeats = {first: Diagnostic; count: number; cancel: Cancel};
/** A command the edge has handed to its bus, with its routing key: from then on a failure may follow a handler's effect. */
type Dispatched = {key: string; command: Command<object>};
/** Where a call stands: `dispatched` once its command is with the bus. */
type Progress = {dispatched?: Dispatched};
/** A remembered command: until when, and whether its bus has not settled it yet, which keeps it whatever its time. */
type Remembered = {untilMs: number; pending: boolean};

/**
 * What a failure's record names of the command it may have left uncertain: its routing key, request ID, message ID and
 * trace, as the bus's own records of it do. The edge validated the command; a key or request ID the bus would refuse is
 * left out, so the record keeps the rest.
 */
function commandFacts({key, command}: Dispatched): Pick<Diagnostic, 'key' | 'requestId' | 'messageId' | 'trace'> {
  const {requestId} = command.data as {requestId?: unknown};
  return {
    ...(parseKey(key)?.category === 'cmd' ? {key} : {}),
    ...(typeof requestId === 'string' && ID.test(requestId) ? {requestId} : {}),
    messageId: command.id, trace: {traceparent: command.traceparent},
  };
}
const fields = (value: unknown): Fields | undefined => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Fields : undefined;


const FAMILY = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const patterns = (value: unknown): boolean => Array.isArray(value) && value.every(key => typeof key === 'string' && parsePattern(key) !== undefined);

/**
 * Why a grant's permissions are malformed, or undefined: its calls must be the edge's, its keys and exclusions routing-key
 * patterns, and what it publishes family names.
 */
function checkPermissions(permissions: EdgePermissions): string | undefined {
  const given = permissions as {calls?: unknown; keys?: unknown; publishes?: unknown; excluded?: unknown};
  if (given.calls !== undefined && (!Array.isArray(given.calls) || !given.calls.every(call => typeof call === 'string' && isCall(call)))) return 'names a call the edge does not have';
  if (given.keys !== undefined && !patterns(given.keys)) return 'names a malformed key pattern';
  if (given.excluded !== undefined && !patterns(given.excluded)) return 'excludes a malformed key pattern';
  if (given.publishes !== undefined && (!Array.isArray(given.publishes) || !given.publishes.every(family => typeof family === 'string' && FAMILY.test(family)))) {
    return 'names a malformed family to publish';
  }
  return undefined;
}

/**
 * The call a grant must list for each call: a follow-up comes with the call that opened what it uses. The stream and
 * `close` need none: a stream carries only what the part's other calls opened on it, so every part may hold one, as
 * the SDK's client does from the moment it connects.
 */
const NEEDS: Readonly<Record<Call | 'stream', Call | undefined>> = {
  stream: undefined, close: undefined, reply: 'respond', answer: 'serve',
  publish: 'publish', subscribe: 'subscribe', request: 'request', respond: 'respond', sync: 'sync', serve: 'serve',
};

/** Refuses a call the principal's grant does not list, before anything is read or done. */
function allowCall({calls}: EdgePrincipal, call: Call | 'stream'): void {
  const needed = NEEDS[call];
  if (calls === undefined || needed === undefined || calls.includes(needed)) return;
  throw refuse('forbidden', `this grant may not ${needed}`);
}

/** Whether every key `inner` matches, `outer` matches too: each of its tokens is a wildcard or the same token. */
const within = (inner: Pattern, outer: Pattern): boolean =>
  [[inner.category, outer.category], [inner.family, outer.family], [inner.id, outer.id]].every(([a, b]) => b === '*' || a === b);

/** Whether some key matches both a pattern of the principal's exclusions and `wanted`, a key or a pattern. */
function excludes({excluded}: EdgePrincipal, wanted: string): boolean {
  const parsed = parsePattern(wanted);
  return excluded !== undefined && parsed !== undefined && excluded.some(pattern => {
    const out = parsePattern(pattern);
    return out !== undefined && overlaps(out, parsed);
  });
}

/**
 * Refuses a key or pattern that lies outside every pattern of the principal's grant, or, with `exact`, a key or pattern
 * that meets one of its exclusions. A malformed one is left for the bus, which refuses it as `invalid-request`.
 */
function allowKey(principal: EdgePrincipal, wanted: string, {exact = false}: {exact?: boolean} = {}): void {
  const {keys} = principal;
  const parsed = parsePattern(wanted);
  if (parsed === undefined) return;
  const covered = keys === undefined || keys.some(key => {
    const granted = parsePattern(key);
    return granted !== undefined && within(parsed, granted);
  });
  if (!covered || (exact && excludes(principal, wanted))) throw refuse('forbidden', 'this grant does not cover that routing key');
}

/** The key a synced record has, `bunny.state.<family>.<id>`, or undefined when it names no entity. */
function stateKey(family: unknown, id: unknown): string | undefined {
  return typeof family === 'string' && typeof id === 'string' ? `bunny.state.${family}.${id}` : undefined;
}

/**
 * A sync or a sync owner covers each family's state keys, `bunny.state.<family>.*`. The check is the same whichever owner
 * answers a sync, so one pattern such as `bunny.state.device.*` covers every owner of the family; a sync owner is always
 * the caller's own source.
 */
function allowFamilies(principal: EdgePrincipal, families: readonly string[]): void {
  for (const family of families) allowKey(principal, `bunny.state.${family}.*`);
}

function text(body: Fields, name: string): string {
  const value = body[name];
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) throw refuse('invalid-request', `${name} is not a string`);
  return value;
}

function identifier(body: Fields, name: string): string {
  const value = text(body, name);
  if (!ID.test(value)) throw refuse('invalid-request', `${name} is not an identifier`);
  return value;
}

/** A sync call's `owner`: absent, or a participant source. */
function ownerOf(body: Fields): string | undefined {
  const {owner} = body;
  if (owner === undefined) return undefined;
  if (!isSource(owner)) throw refuse('invalid-request', 'owner is not a participant source');
  return owner;
}

/**
 * What a forward settles with: the remote part's reply or snapshot, a refusal, or for a command one of the bus's
 * markers, so that a command is never answered as a refusal the remote responder did not give.
 */
type Forwarded = Reply | Snapshot | ErrorBody | typeof unanswered | typeof failed | typeof undelivered;
/** A forwarded command or sync request, waiting for the remote part's answer. */
type Waiting = {kind: 'command' | 'sync'; connection: string; finish: (answer: Forwarded) => void};

type Connection = {
  id: string;
  source: string;
  /** The credential the stream was opened with, if the host named one. */
  principal: string | undefined;
  participant: Sdk;
  response: ServerResponse;
  open: boolean;
  closed: Promise<void>;
  markClosed: () => void;
  /** The socket's buffer is full: writes wait for it to drain. */
  drained: Promise<void> | undefined;
  /** Ends the stream when its socket stays full past the stall limit; cancelled when it drains. */
  stall: Cancel;
  /** The next heartbeat. */
  heartbeat: Cancel;
  /** Subscriptions, responders and sync owners by the id the remote part chose. */
  opened: Map<string, Subscription>;
};

export class RemoteEdge {
  readonly #bus: InProcessBus;
  readonly #validator: MessageValidator;
  readonly #grants: {principal: EdgePrincipal; digest: Buffer}[];
  readonly #authenticateHost: ((request: IncomingMessage) => EdgePrincipal | undefined) | undefined;
  readonly #diagnose: OnDiagnostic;
  readonly #now: () => number;
  readonly #scheduler: Scheduler;
  readonly #heartbeatMs: number;
  readonly #stallMs: number;
  readonly #liveness: Scheduler;
  readonly #connections = new Map<string, Connection>();
  /**
   * The commands the edge has handed to its bus, by source and then message ID (Hub #835). A command that arrives again
   * while it is remembered is refused as `duplicate-conflict`, so a raw HTTP client cannot make a responder run it twice.
   * Each source has its own quota, so one cannot lock the others out.
   */
  readonly #sent = new Map<string, Map<string, Remembered>>();
  #remembered = 0;
  readonly #memory: {perSource: number; total: number; rememberMs: number};
  /**
   * Forwarded commands and sync requests waiting for an answer, by source, responder or owner id and the forwarded
   * message's own id, so a retry that reuses a requestId has its own entry. They outlive a connection, so a reply that
   * comes on the reconnected stream still reaches the requester.
   */
  readonly #waiting = new Map<string, Waiting>();
  /** One participant per source, for calls that need no connection. */
  readonly #participants = new Map<string, Sdk>();
  /** Runs of repeated refusals, by route, code and source. */
  readonly #repeats = new Map<string, Repeats>();
  #closed = false;

  constructor(options: EdgeOptions) {
    this.#bus = options.bus;
    this.#validator = options.validator;
    this.#authenticateHost = options.authenticate;
    // A token that two grants share would make the source ambiguous. Neither refusal names the token.
    const grants = (options.authenticate === undefined ? options.grants ?? [] : []).map(({source, token, ...permissions}) => {
      if (typeof source !== 'string' || !SOURCE.test(source) || source.length > 256) throw new SdkError(errorBody('invalid-request', {detail: 'a grant names a malformed source'}));
      if (typeof token !== 'string' || token.length === 0) throw new SdkError(errorBody('invalid-request', {detail: `the grant for ${source} has no token`}));
      const problem = checkPermissions(permissions);
      if (problem !== undefined) throw new SdkError(errorBody('invalid-request', {detail: `the grant for ${source} ${problem}`}));
      const {calls, keys, publishes, excluded} = permissions;
      return {
        principal: {
          source, ...(calls === undefined ? {} : {calls}), ...(keys === undefined ? {} : {keys}), ...(publishes === undefined ? {} : {publishes}),
          ...(excluded === undefined ? {} : {excluded}),
        },
        digest: digest(token),
      };
    });
    if (new Set(grants.map(grant => grant.digest.toString('hex'))).size !== grants.length) {
      throw new SdkError(errorBody('invalid-request', {detail: 'two grants share a token'}));
    }
    this.#grants = grants;
    this.#diagnose = reporter(options.onDiagnostic);
    this.#now = options.now ?? (() => Date.now());
    this.#scheduler = options.scheduler ?? timers;
    const limit = (value: number | undefined, fallback: number, name: string): number => {
      if (value === undefined) return fallback;
      if (!Number.isSafeInteger(value) || value < 1 || value > MAX_TIMEOUT_MS) throw new RangeError(`${name} must be an integer from 1 to ${MAX_TIMEOUT_MS}`);
      return value;
    };
    this.#heartbeatMs = limit(options.heartbeatMs, HEARTBEAT_MS, 'heartbeatMs');
    const memory = options.commandMemory ?? {};
    this.#memory = {
      perSource: limit(memory.perSource, MAX_REMEMBERED_PER_SOURCE, 'commandMemory.perSource'), total: limit(memory.total, MAX_REMEMBERED_COMMANDS, 'commandMemory.total'),
      rememberMs: limit(memory.rememberMs, REMEMBER_MS, 'commandMemory.rememberMs'),
    };
    this.#stallMs = limit(options.stallMs, STALL_MS, 'stallMs');
    this.#liveness = options.liveness ?? realTimers;
  }

  /** Serves one HTTP request; mount it on a `node:http` server. */
  readonly handle = (request: IncomingMessage, response: ServerResponse): void => {
    void this.#serve(request, response);
  };

  /** Ends the open streams, of one source or of all, so those remote parts reconnect. */
  disconnect(source?: string): void {
    for (const connection of [...this.#connections.values()]) {
      if (source === undefined || connection.source === source) {
        connection.response.end();
        this.#drop(connection);
      }
    }
  }

  /**
   * Ends the open streams that a credential, as `authenticate` named it, opened, as when the host revokes it. Its next
   * call authenticates again, so a revoked credential cannot reconnect.
   */
  disconnectPrincipal(id: string): void {
    for (const connection of [...this.#connections.values()]) {
      if (connection.principal === id) {
        connection.response.end();
        this.#drop(connection);
      }
    }
  }

  /**
   * Ends every stream and closes what the remote parts opened. A forwarded command still waiting can get no reply any
   * more, so its request is `uncertain`, as the deadline would make it; a forwarded sync request is unavailable.
   */
  close(): Promise<void> {
    this.#closed = true;
    // The repeats counted so far are recorded now, and no window outlives the edge.
    for (const repeats of this.#repeats.values()) {
      repeats.cancel();
      this.#summarize(repeats);
    }
    this.#repeats.clear();
    this.disconnect();
    for (const waiting of [...this.#waiting.values()]) {
      waiting.finish(waiting.kind === 'command' ? unanswered : errorBody('unavailable', {detail: 'the edge closed'}));
    }
    return Promise.resolve();
  }

  async #serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = new URL(request.url ?? '/', 'http://edge').pathname;
    const route = path.startsWith(`${REMOTE_PATH}/`) ? path.slice(REMOTE_PATH.length + 1) : path;
    let source: string | undefined;
    const progress: Progress = {};
    try {
      const principal = this.#authenticate(request);
      source = principal.source;
      // A part declares the source it acts as; a token used under another one is refused at once (Hub #835).
      const declared = request.headers[SOURCE_HEADER];
      if (declared !== undefined && declared !== source) throw refuse('forbidden', 'this token acts as another source');
      if (request.method === 'GET' && route === 'stream') {
        allowCall(principal, 'stream');
        this.#open(principal, response);
        return;
      }
      if (request.method !== 'POST' || !isCall(route)) throw refuse('not-found', 'no such route');
      allowCall(principal, route);
      const body = await this.#read(request, route === 'answer' ? MAX_ANSWER_BYTES : MAX_CALL_BYTES);
      // A remote part that stops waiting, because its copy or participant closed, drops the call.
      const dropped = new AbortController();
      response.once('close', () => { if (!response.writableEnded) dropped.abort(); });
      // The remote part may have gone while its body was read.
      if (response.closed) dropped.abort();
      this.#write(response, 200, {schema: REMOTE_SCHEMA, ...await this.#call(principal, route, body, dropped.signal, progress)});
    } catch (error) {
      // The edge's and the SDK's own refusals keep their text, which may quote what the caller sent, and are recorded as
      // refusals, without that text. Anything else gets fixed text, `internal`, or `uncertain-result` once a command was
      // handed to the bus, and is recorded once as a failure with that code and the exception's type, and then with
      // the command's own key, IDs and trace, so the failure joins the bus's records of it. The exception itself stays
      // in memory.
      const known = error instanceof Refusal || error instanceof SdkError;
      const {dispatched} = progress;
      const refused = known ? error.body : dispatched === undefined ? FAILED : FAILED_AFTER_DISPATCH;
      const {code} = refused.error;
      const who = source === undefined ? {} : {source};
      if (known) {
        this.#refused({event: 'edge.refused', level: levelOf(code), route: routeOf(route), code, ...who});
      } else {
        const about = dispatched === undefined ? {} : commandFacts(dispatched);
        this.#diagnose({event: 'edge.failed', level: 'error', route: routeOf(route), code, ...who, ...about, errorType: errorType(error)});
      }
      // A body over its limit is left unread, so the connection closes after the refusal.
      this.#write(response, statusOf(code), refused, code === 'too-large');
    }
  }

  /**
   * Records a refusal by the repetition rule: the first of a run at once, then its repeats as one summary per window
   * that had any (`REFUSAL_WINDOW_MS`). Once the edge has closed, each refusal is recorded at once.
   */
  #refused(diagnostic: Diagnostic): void {
    const key = `${diagnostic.route ?? ''}\n${diagnostic.code ?? ''}\n${diagnostic.source ?? ''}`;
    const open = this.#repeats.get(key);
    if (open !== undefined) {
      open.count += 1;
      return;
    }
    this.#diagnose(diagnostic);
    if (this.#closed) return;
    const repeats: Repeats = {first: diagnostic, count: 0, cancel: () => {}};
    this.#repeats.set(key, repeats);
    this.#window(key, repeats);
  }

  #window(key: string, repeats: Repeats): void {
    repeats.cancel = this.#scheduler.after(REFUSAL_WINDOW_MS, () => {
      if (repeats.count === 0) {
        this.#repeats.delete(key);
        return;
      }
      this.#summarize(repeats);
      this.#window(key, repeats);
    });
  }

  /** Records the repeats counted since the last record as one summary, if there were any. */
  #summarize(repeats: Repeats): void {
    const {first, count} = repeats;
    repeats.count = 0;
    if (count > 0) this.#diagnose({...first, attempts: count});
  }

  /**
   * Who the call acts as: the host's answer, or the grant a bearer token names. Every grant is compared, in constant
   * time, so timing reveals nothing.
   */
  #authenticate(request: IncomingMessage): EdgePrincipal {
    if (this.#authenticateHost !== undefined) {
      const principal = this.#authenticateHost(request);
      if (principal === undefined) throw refuse('unauthenticated', 'a granted bearer token or session is required');
      return principal;
    }
    const header = request.headers.authorization;
    const token = typeof header === 'string' ? /^Bearer (\S+)$/.exec(header)?.[1] : undefined;
    if (token === undefined) throw refuse('unauthenticated', 'a bearer token is required');
    const presented = digest(token);
    let principal: EdgePrincipal | undefined;
    for (const grant of this.#grants) {
      if (timingSafeEqual(grant.digest, presented)) principal = grant.principal;
    }
    if (principal === undefined) throw refuse('unauthenticated', 'the token is not granted');
    return principal;
  }

  /** Reads a JSON body, and stops reading as soon as it passes `limit`. */
  async #read(request: IncomingMessage, limit: number): Promise<Fields> {
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      let size = 0;
      const take = (chunk: Buffer): void => {
        size += chunk.length;
        if (size <= limit) {
          chunks.push(chunk);
          return;
        }
        request.off('data', take);
        request.pause();
        reject(refuse('too-large', `the call is over ${limit} bytes`));
      };
      request.on('data', take);
      request.once('end', resolve);
      // A stream error while the body is read means the caller's connection went: it dropped the call, which is no fault.
      request.once('error', () => { reject(refuse('cancelled', 'the caller closed the call')); });
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw refuse('invalid-request', 'the body is not JSON');
    }
    const body = fields(parsed);
    if (body === undefined) throw refuse('invalid-request', 'the body is not a JSON object');
    if (body.schema !== REMOTE_SCHEMA) throw refuse('unsupported-version', `the call is not ${REMOTE_SCHEMA}`);
    return body;
  }

  async #call(principal: EdgePrincipal, call: Call, body: Fields, signal: AbortSignal, progress: Progress): Promise<object> {
    const {source} = principal;
    switch (call) {
      case 'publish': {
        const key = text(body, 'key');
        allowKey(principal, key, {exact: true});
        const message = this.#inbound(source, body.message);
        // The routing-ID rule holds for what a remote part publishes too: the subject is the key's entity (Hub #835). A
        // malformed key is left for the bus, which refuses it as `invalid-request`.
        const route = parseKey(key);
        if (route !== undefined && message.subject !== route.id) throw refuse('invalid-message', 'a message\'s subject is the last token of its routing key');
        const family = schemaFamily(message.dataschema);
        if (route !== undefined && principal.publishes !== undefined && (family === undefined || !principal.publishes.includes(family))) {
          throw refuse('forbidden', 'this grant may not publish messages of that family');
        }
        await this.#participant(source).publishMessage(key, message);
        return {status: 'published'};
      }
      case 'request': {
        // The edge answers when its bus settles: the reply, `expired` if the command was still queued at its deadline,
        // or `uncertain-result` if a handler had it. The remote requester waits a little longer, so it hears this.
        const command = this.#inbound(source, body.command) as Command<object>;
        const key = text(body, 'key');
        allowKey(principal, key, {exact: true});
        const remembered = this.#remember(source, command);
        // The bus refuses a malformed call with SdkError before it dispatches anything; that stays a refusal, and the
        // command is forgotten, since nothing had it.
        progress.dispatched = {key, command};
        let result: RequestResult;
        try {
          result = await this.#bus.requestMessage(source, key, command, this.#remaining(command), signal);
        } catch (error) {
          remembered(undefined);
          throw error;
        }
        remembered(result);
        return {result};
      }
      case 'sync': {
        const request = this.#inbound(source, body.request) as Message<SyncRequest>;
        if (request.subject !== request.data.families.join(',')) throw refuse('invalid-message', 'a sync request\'s subject names its families, joined by commas');
        allowFamilies(principal, request.data.families);
        // The owner the request is for, when the remote part names one (Hub #967): part of the call, beside the message.
        const owner = ownerOf(body);
        const answer = await this.#bus.syncMessage(source, request, this.#remaining(request), signal, owner);
        if (answer.status !== 'served') return {answer};
        const narrowed = this.#narrowed(principal, answer);
        this.#capped(narrowed);
        return {answer: narrowed};
      }
      case 'subscribe': {
        const connection = this.#connection(source, body);
        const id = this.#fresh(connection, body);
        const pattern = text(body, 'pattern');
        allowKey(principal, pattern);
        // Each message names the key it came on, so the part, and its own filter, can tell where it belongs.
        connection.opened.set(id, await connection.participant.subscribe(pattern, (message, key) => this.#pushed(connection, 'message', {subscription: id, key, message}), {
          onOverflow: ({dropped}) => this.#pushed(connection, 'overflow', {subscription: id, ...(dropped === undefined ? {} : {dropped})}),
          // The part never receives what its grant leaves out: such a message is not even queued for it.
          ...(principal.excluded === undefined ? {} : {accept: key => !excludes(principal, key)}),
        }));
        return {status: 'subscribed'};
      }
      case 'respond': {
        const connection = this.#connection(source, body);
        const id = this.#fresh(connection, body);
        const pattern = text(body, 'pattern');
        allowKey(principal, pattern, {exact: true});
        // The forward settles a command with a reply or one of the bus's markers, which the bus reads in place of a
        // reply; the participant's types know only replies.
        connection.opened.set(id, await connection.participant.respond(pattern, command =>
          this.#forward(connection, 'command', id, command, 'command', {responder: id, command}) as Promise<Reply>));
        return {status: 'responding'};
      }
      case 'serve': {
        const connection = this.#connection(source, body);
        const id = this.#fresh(connection, body);
        const families: unknown = body.families;
        const isNames = (value: unknown): value is string[] => Array.isArray(value) && value.every(family => typeof family === 'string');
        if (!isNames(families)) throw refuse('invalid-request', 'families is not a list of names');
        allowFamilies(principal, families);
        connection.opened.set(id, await connection.participant.serveSync(families, request =>
          this.#forward(connection, 'sync', id, request, 'sync-request', {server: id, request}) as Promise<Snapshot | ErrorBody>));
        return {status: 'serving'};
      }
      case 'reply': {
        this.#connection(source, body);
        const requestId = identifier(body, 'requestId');
        // A remote handler that failed once it started answers `uncertain`; the bus settles that as it does in process.
        const answer = fields(body.reply)?.status === 'uncertain' ? failed : this.#reply(source, requestId, body.reply);
        this.#waiting.get(this.#key(source, identifier(body, 'responder'), identifier(body, 'command')))?.finish(answer);
        return {status: 'received'};
      }
      case 'answer': {
        this.#connection(source, body);
        const answer = refusalOf(body.answer) ?? this.#snapshot(source, body.answer);
        this.#waiting.get(this.#key(source, identifier(body, 'server'), identifier(body, 'request')))?.finish(answer);
        return {status: 'received'};
      }
      case 'close': {
        const connection = this.#connection(source, body);
        const id = identifier(body, 'id');
        const opened = connection.opened.get(id);
        connection.opened.delete(id);
        await opened?.close();
        return {status: 'closed'};
      }
    }
  }

  /**
   * Remembers a command as it goes to the bus, and refuses one this source already sent with the same ID (Hub #835):
   * commands are never sent twice (ADR 0012, "Retries"), so a raw HTTP client that repeats one, even after the first
   * settled, cannot make a responder run it again. The first command's own refusal or reply is not repeated; the repeat
   * is refused before anything happens. A command is remembered while its bus has it, and once settled until its
   * expiry, at most `rememberMs`; one the bus refused before any responder had it is forgotten at once, since sending it
   * again is safe. Returns what the caller calls with the bus's result, or undefined when the bus threw.
   */
  #remember(source: string, command: Message): (result: RequestResult | undefined) => void {
    const now = this.#now();
    let sent = this.#sent.get(source);
    if (sent === undefined) {
      sent = new Map();
      this.#sent.set(source, sent);
    }
    const remembered = sent.get(command.id);
    if (remembered !== undefined && (remembered.pending || remembered.untilMs > now)) throw refuse('duplicate-conflict', 'this command was sent already; a command is never sent twice');
    if (sent.size >= this.#memory.perSource) this.#forget(source, sent, now);
    if (this.#remembered >= this.#memory.total) for (const [other, entries] of [...this.#sent]) this.#forget(other, entries, now);
    // A source at its quota waits for its own commands to be forgotten; it never takes another source's room.
    if (sent.size >= this.#memory.perSource || this.#remembered >= this.#memory.total) {
      throw refuse('capacity', 'the edge remembers as many of this part\'s commands as it can; try again later');
    }
    const entry: Remembered = {untilMs: Date.parse(command.expiresat ?? ''), pending: true};
    sent.set(command.id, entry);
    this.#remembered += 1;
    const entries = sent;
    return result => {
      entry.pending = false;
      // Only a refusal the bus made itself, with no reply, proves that no responder had the command.
      if (result === undefined || (result.status === 'rejected' && result.reply === undefined)) {
        if (entries.get(command.id) === entry) {
          entries.delete(command.id);
          this.#remembered -= 1;
        }
        return;
      }
      entry.untilMs = Math.min(entry.untilMs, this.#now() + this.#memory.rememberMs);
    };
  }

  /** Forgets one source's settled commands whose time has passed. */
  #forget(source: string, entries: Map<string, Remembered>, now: number): void {
    for (const [id, entry] of entries) {
      if (entry.pending || entry.untilMs > now) continue;
      entries.delete(id);
      this.#remembered -= 1;
    }
    if (entries.size === 0) this.#sent.delete(source);
  }

  /**
   * A sync answer as this part may see it: without the records, and their members, whose state keys its grant excludes,
   * as for a device its grant does not name (Hub #835). The owner's revision stands, so the part's copy stays consistent.
   */
  #narrowed(principal: EdgePrincipal, answer: Extract<SyncAnswer, {status: 'served'}>): Extract<SyncAnswer, {status: 'served'}> {
    if (principal.excluded === undefined || principal.excluded.length === 0) return answer;
    const visible = (key: string | undefined): boolean => key !== undefined && !excludes(principal, key);
    const states = answer.states.filter(state => visible(stateKey(schemaFamily(state.dataschema), (state.data as {id?: unknown} | null)?.id)));
    const {data} = answer.completed;
    const members = data.members.filter(member => visible(stateKey(member.family, member.id)));
    return {...answer, states, completed: {...answer.completed, data: {...data, members}}};
  }

  /** A message from the remote part, checked: profile 2.0, its payload schema, the cap, its expiry and its source. */
  #inbound(source: string, value: unknown): Message {
    const result = this.#validator.validate(value, {nowMs: this.#now()});
    if (!result.ok) throw new Refusal({error: result.error});
    if (result.value.source !== source) throw refuse('forbidden', 'this token cannot send a message from another source');
    if (result.value.expiresat !== undefined && this.#remaining(result.value) > MAX_TIMEOUT_MS) {
      throw refuse('invalid-request', `a deadline is at most ${MAX_TIMEOUT_MS} ms away`);
    }
    return result.value;
  }

  /** The time left until a command's or sync request's expiry; the edge's bus waits exactly that long. */
  #remaining(message: Message): number {
    return Math.max(1, Math.ceil(Date.parse(message.expiresat ?? '') - this.#now()));
  }

  /**
   * A remote responder's reply: accepted, or a refusal rebuilt as the shared error body, checked as its reply payload.
   * The `uncertain` answer of a handler that failed is taken before this, since it makes no reply message.
   */
  #reply(source: string, requestId: string, value: unknown): Reply {
    const reply = replyOf(value);
    if (reply === undefined) throw refuse('invalid-request', 'a reply is accepted, uncertain or a registered error body');
    const data = 'error' in reply ? {requestId, error: reply.error} : {requestId, status: reply.status};
    const candidate = buildMessage(source, 'reply', {type: 'org.bunny.remote.reply.replied', subject: requestId, dataschema: REPLY_SCHEMA, data}, childOf(undefined), this.#now());
    const result = this.#validator.validate(candidate);
    if (!result.ok) throw new Refusal({error: result.error});
    return reply;
  }

  /** A remote owner's snapshot, with each state checked as the message it becomes. */
  #snapshot(source: string, value: unknown): Snapshot {
    const snapshot = fields(value);
    const states = snapshot?.states;
    if (snapshot === undefined || !Array.isArray(states)) throw refuse('invalid-request', 'an answer is a snapshot or a registered error body');
    for (const draft of states) {
      // Built only to be checked: the validator refuses fields of the wrong type.
      const {type, subject, dataschema, data} = fields(draft) ?? {};
      const candidate = buildMessage(source, 'state', {type, subject, dataschema, data} as Content<unknown>, childOf(undefined), this.#now());
      const result = this.#validator.validate(candidate);
      if (!result.ok) throw new Refusal({error: result.error});
    }
    return snapshot as Snapshot;
  }

  /** Every message of a sync answer must fit the profile's cap at a remote edge; paging is not built yet (#782). */
  #capped(answer: Extract<SyncAnswer, {status: 'served'}>): void {
    for (const message of [...answer.states, answer.completed]) {
      const bytes = Buffer.byteLength(JSON.stringify(message), 'utf8');
      if (bytes > MAX_MESSAGE_BYTES) {
        throw refuse('too-large', `a message of the sync answer is over ${MAX_MESSAGE_BYTES} bytes`);
      }
    }
  }

  #participant(source: string): Sdk {
    let participant = this.#participants.get(source);
    if (participant === undefined) {
      participant = this.#bus.connect(source);
      this.#participants.set(source, participant);
    }
    return participant;
  }

  #connection(source: string, body: Fields): Connection {
    const connection = this.#connections.get(identifier(body, 'connection'));
    if (connection === undefined) throw refuse('not-found', 'no such connection');
    if (connection.source !== source) throw refuse('forbidden', 'the connection belongs to another source');
    return connection;
  }

  #fresh(connection: Connection, body: Fields): string {
    const id = identifier(body, 'id');
    if (connection.opened.has(id)) throw refuse('invalid-state', 'that id is already open on this connection');
    return id;
  }

  #key(source: string, id: string, messageId: string): string {
    return `${source}\n${id}\n${messageId}`;
  }

  #open({source, id: principal}: EdgePrincipal, response: ServerResponse): void {
    let markClosed = (): void => {};
    const closed = new Promise<void>(resolve => { markClosed = resolve; });
    const connection: Connection = {
      id: randomUUID(), source, principal, participant: this.#bus.connect(source), response, open: true, drained: undefined, closed, markClosed,
      opened: new Map(), stall: () => {}, heartbeat: () => {},
    };
    this.#connections.set(connection.id, connection);
    response.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', connection: 'keep-alive'});
    response.on('close', () => { this.#drop(connection); });
    this.#send(connection, frame('ready', {connection: connection.id}));
    this.#beat(connection);
    this.#diagnose({event: 'edge.connected', level: 'info', route: 'stream', source});
  }

  /**
   * Writes a comment line on the stream every `heartbeatMs`, so that its reader can tell a live stream from one lost
   * without a close (Hub #835). A stream whose socket is full gets none: the stall limit ends it instead.
   */
  #beat(connection: Connection): void {
    connection.heartbeat = this.#liveness.after(this.#heartbeatMs, () => {
      if (!connection.open) return;
      if (connection.drained === undefined) this.#send(connection, HEARTBEAT);
      this.#beat(connection);
    });
  }

  /**
   * Writes to the stream's socket. When its buffer is full, writes wait for it to drain; if it stays full for
   * `stallMs`, its reader has stopped, so the edge ends the stream. Its subscriptions then free their queued messages,
   * and the reader, if it ever reads again, reconnects and syncs (Hub #835).
   */
  #send(connection: Connection, text: string): void {
    if (connection.response.write(text) || connection.drained !== undefined) return;
    connection.drained = new Promise(resolve => {
      connection.response.once('drain', () => {
        connection.stall();
        connection.drained = undefined;
        resolve();
      });
    });
    connection.stall = this.#liveness.after(this.#stallMs, () => {
      if (!connection.open || connection.drained === undefined) return;
      connection.response.destroy();
      this.#drop(connection, 'capacity');
    });
  }

  /**
   * A lost stream closes everything the connection opened. A forwarded sync request still waiting is refused as
   * unavailable, since a sync only reads. A forwarded command is not answered: its handler may be running it, so it
   * waits for a reply on the reconnected stream, or for its deadline, which makes it uncertain.
   */
  #drop(connection: Connection, code?: 'capacity'): void {
    if (!connection.open) return;
    connection.open = false;
    connection.heartbeat();
    connection.stall();
    connection.markClosed();
    this.#connections.delete(connection.id);
    for (const waiting of [...this.#waiting.values()]) {
      if (waiting.kind === 'sync' && waiting.connection === connection.id) waiting.finish(errorBody('unavailable', {detail: 'the remote owner disconnected'}));
    }
    for (const opened of connection.opened.values()) {
      opened.close().catch(() => {});
    }
    connection.opened.clear();
    // A stream the edge ended because its reader stopped is lost capacity, a warning; any other end is routine.
    this.#diagnose({event: 'edge.disconnected', level: code === undefined ? 'info' : 'warn', route: 'stream', source: connection.source, ...(code === undefined ? {} : {code})});
  }

  /**
   * Writes one event, and says whether it went to the socket. When the socket's buffer is full it waits for it to
   * drain, so a slow reader's queue fills.
   */
  async #push(connection: Connection, event: StreamEventName, data: object): Promise<boolean> {
    if (!connection.open) return false;
    this.#send(connection, frame(event, data));
    if (connection.drained !== undefined) await Promise.race([connection.drained, connection.closed]);
    return true;
  }

  async #pushed(connection: Connection, event: StreamEventName, data: object): Promise<void> {
    await this.#push(connection, event, data);
  }

  /**
   * Sends a command or sync request down the stream and waits for the remote part's answer, past its expiry by a
   * margin; the bus settles the requester at the expiry itself. A command that outlasts that wait is `unanswered`,
   * which the bus settles as `uncertain`, never as a refusal, whatever scheduler fired first. A frame that never reached
   * the socket is `undelivered` for a command, and unavailable for a sync request.
   */
  #forward(
    connection: Connection, kind: Waiting['kind'], id: string, message: Message<{requestId: string}>, event: StreamEventName, data: object,
  ): Promise<Forwarded> {
    const key = this.#key(connection.source, id, message.id);
    const command = kind === 'command';
    const late: Forwarded = command ? unanswered : errorBody('unavailable', {detail: 'the remote owner did not answer in time'});
    const lost: Forwarded = command ? undelivered : errorBody('unavailable', {detail: 'the remote owner was not connected'});
    // Message ids are unique per sender, so a second live forward of the same message is a duplicate: it is not sent.
    if (this.#waiting.has(key)) return Promise.resolve(lost);
    return new Promise<Forwarded>(resolve => {
      let cancel: Cancel = () => {};
      const entry: Waiting = {kind, connection: connection.id, finish: answer => {
        cancel();
        // Only this forward's own entry leaves the map.
        if (this.#waiting.get(key) === entry) this.#waiting.delete(key);
        resolve(answer);
      }};
      cancel = this.#scheduler.after(Math.max(0, Date.parse(message.expiresat ?? '') - this.#now()) + FORWARD_MARGIN_MS, () => { entry.finish(late); });
      this.#waiting.set(key, entry);
      void this.#push(connection, event, data).then(written => {
        if (!written) entry.finish(lost);
      });
    });
  }

  /** Writes one JSON answer. The body is encoded first, so a body that cannot be encoded leaves the answer unsent. */
  #write(response: ServerResponse, status: number, body: object, close = false): void {
    if (response.headersSent || response.destroyed) return;
    const text = JSON.stringify(body);
    response.writeHead(status, {'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...(close ? {connection: 'close'} : {})});
    response.end(text);
  }
}
