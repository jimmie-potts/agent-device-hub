// The server side of the remote transport (Hub #883): a remote part's edge on the runtime's in-process bus. It
// authenticates each call, validates every inbound message against profile 2.0 and the 256 KiB cap, and carries the
// remote part's subscriptions, responders and sync owners over one event stream per connection.
import {createHash, randomUUID, timingSafeEqual} from 'node:crypto';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {
  MAX_DETAIL, MAX_MESSAGE_BYTES, errorBody, errorCodes, type ErrorBody, type ErrorCode, type Message, type MessageValidator,
} from '@jimmie-potts/event-contracts/v2';
import {buildMessage, type Content} from './envelope.js';
import type {InProcessBus} from './in-process.js';
import {CALLS, MAX_ANSWER_BYTES, MAX_CALL_BYTES, REMOTE_PATH, REMOTE_SCHEMA, frame, statusOf, type Call, type StreamEventName} from './remote-protocol.js';
import {SdkError, type Cancel, type Command, type Reply, type Scheduler, type Sdk, type Subscription} from './sdk.js';
import type {Snapshot, SyncAnswer, SyncRequest} from './sync.js';
import {childOf} from './trace.js';

/** One remote participant's credential: a bearer token that lets it act as `source`. */
export type RemoteGrant = {source: string; token: string};
/** What the edge logs. It never carries a credential. */
export type EdgeLogRecord = {event: 'edge.refused' | 'edge.connected' | 'edge.disconnected'; route: string; code?: string; source?: string; detail?: string};
export type EdgeOptions = {
  bus: InProcessBus;
  /** Validates every inbound message: profile 2.0, the registered payload schemas and the 256 KiB cap. */
  validator: MessageValidator;
  grants: readonly RemoteGrant[];
  log?: (record: EdgeLogRecord) => void;
  now?: () => number;
  /** Runs the edge's own waits for forwarded commands and sync requests. Defaults to the global `setTimeout`. */
  scheduler?: Scheduler;
};
const timers: Scheduler = {after: (delayMs, callback) => {
  const timer = setTimeout(callback, delayMs);
  return () => { clearTimeout(timer); };
}};

/**
 * How long past a request's expiry the edge still waits for its result. The remote requester's own deadline settles
 * the request first, so a remote part always sees the same deadline answer.
 */
const GRACE_MS = 1000;
const ID = /^[A-Za-z0-9_.-]{1,128}$/;

class Refusal extends Error {
  readonly body: ErrorBody;

  constructor(body: ErrorBody) {
    super(body.error.code);
    this.body = body;
  }
}
const refuse = (code: ErrorCode, detail: string): Refusal => new Refusal(errorBody(code, {detail: detail.slice(0, MAX_DETAIL)}));
const digest = (token: string): Buffer => createHash('sha256').update(token, 'utf8').digest();
const isCall = (value: string): value is Call => (CALLS as readonly string[]).includes(value);
type Fields = Record<string, unknown>;
const fields = (value: unknown): Fields | undefined => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Fields : undefined;

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

/** An error body whose code is registered with its flag, as a remote responder or owner may refuse with. */
function registered(value: unknown): ErrorBody | undefined {
  const error = fields(fields(value)?.error);
  const code = error?.code;
  if (typeof code !== 'string' || errorCodes[code]?.retryable !== error?.retryable) return undefined;
  return value as ErrorBody;
}

type Connection = {
  id: string;
  source: string;
  participant: Sdk;
  response: ServerResponse;
  open: boolean;
  closed: Promise<void>;
  markClosed: () => void;
  /** The socket's buffer is full: writes wait for it to drain. */
  drained: Promise<void> | undefined;
  /** Subscriptions, responders and sync owners by the id the remote part chose. */
  opened: Map<string, Subscription>;
  /** Forwarded commands and sync requests waiting for the remote part's answer, by `<id>/<requestId>`. */
  waiting: Map<string, (answer: Reply | Snapshot | ErrorBody) => void>;
};

export class RemoteEdge {
  readonly #bus: InProcessBus;
  readonly #validator: MessageValidator;
  readonly #grants: {source: string; digest: Buffer}[];
  readonly #log: (record: EdgeLogRecord) => void;
  readonly #now: () => number;
  readonly #scheduler: Scheduler;
  readonly #connections = new Map<string, Connection>();
  /** One participant per source, for calls that need no connection. */
  readonly #participants = new Map<string, Sdk>();

  constructor(options: EdgeOptions) {
    this.#bus = options.bus;
    this.#validator = options.validator;
    this.#grants = options.grants.map(({source, token}) => ({source, digest: digest(token)}));
    const log = options.log ?? (() => {});
    this.#log = record => {
      try {
        log(record);
      } catch {
        // A failing log must not fail the call.
      }
    };
    this.#now = options.now ?? (() => Date.now());
    this.#scheduler = options.scheduler ?? timers;
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

  /** Ends every stream and closes what the remote parts opened. */
  close(): Promise<void> {
    this.disconnect();
    return Promise.resolve();
  }

  async #serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = new URL(request.url ?? '/', 'http://edge').pathname;
    const route = path.startsWith(`${REMOTE_PATH}/`) ? path.slice(REMOTE_PATH.length + 1) : path;
    let source: string | undefined;
    try {
      source = this.#authenticate(request);
      if (request.method === 'GET' && route === 'stream') {
        this.#open(source, response);
        return;
      }
      if (request.method !== 'POST' || !isCall(route)) throw refuse('not-found', `no ${String(request.method)} ${path}`);
      const body = await this.#read(request, route === 'answer' ? MAX_ANSWER_BYTES : MAX_CALL_BYTES);
      // A remote part that stops waiting, at its deadline or because its copy closed, drops the call.
      const dropped = new AbortController();
      response.once('close', () => { if (!response.writableEnded) dropped.abort(); });
      // The remote part may have gone while its body was read.
      if (response.closed) dropped.abort();
      this.#write(response, 200, {schema: REMOTE_SCHEMA, ...await this.#call(source, route, body, dropped.signal)});
    } catch (error) {
      const refused = error instanceof Refusal || error instanceof SdkError ? error.body
        : errorBody('internal', {detail: `the edge failed: ${error instanceof Error ? error.message : 'unknown'}`.slice(0, MAX_DETAIL)});
      const {code, detail} = refused.error;
      this.#log({event: 'edge.refused', route, code, ...(source === undefined ? {} : {source}), ...(detail === undefined ? {} : {detail})});
      this.#write(response, statusOf(code), refused);
    }
  }

  /** The source a bearer token grants. Every grant is compared, in constant time, so timing reveals nothing. */
  #authenticate(request: IncomingMessage): string {
    const header = request.headers.authorization;
    const token = typeof header === 'string' ? /^Bearer (\S+)$/.exec(header)?.[1] : undefined;
    if (token === undefined) throw refuse('unauthenticated', 'a bearer token is required');
    const presented = digest(token);
    let source: string | undefined;
    for (const grant of this.#grants) {
      if (timingSafeEqual(grant.digest, presented)) source = grant.source;
    }
    if (source === undefined) throw refuse('unauthenticated', 'the token is not granted');
    return source;
  }

  async #read(request: IncomingMessage, limit: number): Promise<Fields> {
    const chunks: Buffer[] = [];
    let size = 0;
    // The whole body is read even when it is too large, so the client gets the refusal rather than a reset.
    for await (const chunk of request as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    }
    if (size > limit) throw refuse('too-large', `the call is over ${limit} bytes`);
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

  async #call(source: string, call: Call, body: Fields, signal: AbortSignal): Promise<object> {
    switch (call) {
      case 'publish':
        await this.#participant(source).publishMessage(text(body, 'key'), this.#inbound(source, body.message));
        return {status: 'published'};
      case 'request': {
        const command = this.#inbound(source, body.command) as Command<object>;
        const result = await this.#bus.requestMessage(source, text(body, 'key'), command, this.#waitFor(command));
        return {result};
      }
      case 'sync': {
        const request = this.#inbound(source, body.request) as Message<SyncRequest>;
        const answer = await this.#bus.syncMessage(source, request, this.#waitFor(request), signal);
        if (answer.status === 'served') this.#capped(answer);
        return {answer};
      }
      case 'subscribe': {
        const connection = this.#connection(source, body);
        const id = this.#fresh(connection, body);
        connection.opened.set(id, await connection.participant.subscribe(text(body, 'pattern'), message => this.#push(connection, 'message', {subscription: id, message}), {
          onOverflow: ({dropped}) => this.#push(connection, 'overflow', {subscription: id, ...(dropped === undefined ? {} : {dropped})}),
        }));
        return {status: 'subscribed'};
      }
      case 'respond': {
        const connection = this.#connection(source, body);
        const id = this.#fresh(connection, body);
        connection.opened.set(id, await connection.participant.respond(text(body, 'pattern'), command =>
          this.#forward<Reply>(connection, `${id}/${command.data.requestId}`, command.expiresat, 'command', {responder: id, command})));
        return {status: 'responding'};
      }
      case 'serve': {
        const connection = this.#connection(source, body);
        const id = this.#fresh(connection, body);
        const families: unknown = body.families;
        const isNames = (value: unknown): value is string[] => Array.isArray(value) && value.every(family => typeof family === 'string');
        if (!isNames(families)) throw refuse('invalid-request', 'families is not a list of names');
        connection.opened.set(id, await connection.participant.serveSync(families, request =>
          this.#forward<Snapshot | ErrorBody>(connection, `${id}/${request.data.requestId}`, request.expiresat, 'sync-request', {server: id, request})));
        return {status: 'serving'};
      }
      case 'reply': {
        const connection = this.#connection(source, body);
        const reply = body.reply;
        if (fields(reply)?.status !== 'accepted' && registered(reply) === undefined) throw refuse('invalid-request', 'a reply is accepted or a registered error body');
        connection.waiting.get(`${identifier(body, 'responder')}/${identifier(body, 'requestId')}`)?.(reply as Reply);
        return {status: 'received'};
      }
      case 'answer': {
        const connection = this.#connection(source, body);
        const answer = registered(body.answer) ?? this.#snapshot(source, body.answer);
        connection.waiting.get(`${identifier(body, 'server')}/${identifier(body, 'requestId')}`)?.(answer);
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

  /** A message from the remote part, checked: profile 2.0, its payload schema, the cap, its expiry and its source. */
  #inbound(source: string, value: unknown): Message {
    const result = this.#validator.validate(value, {nowMs: this.#now()});
    if (!result.ok) throw new Refusal({error: result.error});
    if (result.value.source !== source) throw refuse('forbidden', `this token cannot send a message from ${result.value.source}`);
    return result.value;
  }

  /** The edge waits past the expiry, so that the remote requester's own deadline decides. */
  #waitFor(message: Message): number {
    return Math.max(1, Date.parse(message.expiresat ?? '') - this.#now()) + GRACE_MS;
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

  /** Every message of a sync answer must fit the profile's cap at a remote edge; paging is not built yet. */
  #capped(answer: Extract<SyncAnswer, {status: 'served'}>): void {
    for (const message of [...answer.states, answer.completed]) {
      const bytes = Buffer.byteLength(JSON.stringify(message), 'utf8');
      if (bytes > MAX_MESSAGE_BYTES) {
        throw refuse('too-large', `a ${message.kind} message for ${answer.completed.subject} is ${bytes} bytes, over ${MAX_MESSAGE_BYTES}`);
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
    if (connection.opened.has(id)) throw refuse('invalid-state', `${id} is already open`);
    return id;
  }

  #open(source: string, response: ServerResponse): void {
    let markClosed = (): void => {};
    const closed = new Promise<void>(resolve => { markClosed = resolve; });
    const connection: Connection = {
      id: randomUUID(), source, participant: this.#bus.connect(source), response, open: true, drained: undefined, closed, markClosed,
      opened: new Map(), waiting: new Map(),
    };
    this.#connections.set(connection.id, connection);
    response.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive'});
    response.on('close', () => { this.#drop(connection); });
    response.write(frame('ready', {connection: connection.id}));
    this.#log({event: 'edge.connected', route: 'stream', source});
  }

  /** A lost stream closes everything the connection opened; forwarded calls still waiting get no answer. */
  #drop(connection: Connection): void {
    if (!connection.open) return;
    connection.open = false;
    connection.markClosed();
    this.#connections.delete(connection.id);
    const gone = errorBody('unavailable', {detail: 'the remote part disconnected'});
    for (const answer of [...connection.waiting.values()]) answer(gone);
    for (const opened of connection.opened.values()) {
      opened.close().catch(() => {});
    }
    connection.opened.clear();
    this.#log({event: 'edge.disconnected', route: 'stream', source: connection.source});
  }

  /** Writes one event. When the socket's buffer is full it waits for it to drain, so a slow reader's queue fills. */
  async #push(connection: Connection, event: StreamEventName, data: object): Promise<void> {
    if (!connection.open) return;
    if (connection.response.write(frame(event, data))) return;
    connection.drained ??= new Promise(resolve => {
      connection.response.once('drain', () => {
        connection.drained = undefined;
        resolve();
      });
    });
    await Promise.race([connection.drained, connection.closed]);
  }

  /**
   * Sends a command or sync request down the stream and waits for the remote part's answer, until the grace after its
   * expiry. The requester's own deadline has settled it by then, so this late refusal never reaches it.
   */
  #forward<T extends Reply | Snapshot | ErrorBody>(connection: Connection, key: string, expiresat: string | undefined, event: StreamEventName, data: object): Promise<T> {
    const late = errorBody('unavailable', {detail: 'the remote part did not answer in time'});
    return new Promise<T>(resolve => {
      let cancel: Cancel = () => {};
      const finish = (answer: Reply | Snapshot | ErrorBody): void => {
        cancel();
        connection.waiting.delete(key);
        resolve(answer as T);
      };
      cancel = this.#scheduler.after(Math.max(0, Date.parse(expiresat ?? '') - this.#now()) + GRACE_MS, () => { finish(late); });
      connection.waiting.set(key, finish);
      void this.#push(connection, event, data);
    });
  }

  #write(response: ServerResponse, status: number, body: object): void {
    if (response.headersSent || response.destroyed) return;
    response.writeHead(status, {'content-type': 'application/json', 'cache-control': 'no-store'});
    response.end(JSON.stringify(body));
  }
}
