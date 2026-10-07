// The server side of the remote transport (Hub #883): a remote part's edge on the runtime's in-process bus. It
// authenticates each call, validates every inbound message against profile 2.0 and the 256 KiB cap, and carries the
// remote part's subscriptions, responders and sync owners over one event stream per connection.
import {createHash, randomUUID, timingSafeEqual} from 'node:crypto';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {
  MAX_DETAIL, MAX_MESSAGE_BYTES, RETRYABLE, errorBody, isErrorCode, type ErrorBody, type ErrorCode, type Message, type MessageValidator,
} from '@jimmie-potts/event-contracts/v2';
import {buildMessage, type Content} from './envelope.js';
import {failed, unanswered, undelivered, type InProcessBus} from './in-process.js';
import {CALLS, MAX_ANSWER_BYTES, MAX_CALL_BYTES, REMOTE_PATH, REMOTE_SCHEMA, frame, statusOf, type Call, type StreamEventName} from './remote-protocol.js';
import {MAX_TIMEOUT_MS, SdkError, type Cancel, type Command, type Reply, type Scheduler, type Sdk, type Subscription} from './sdk.js';
import type {Snapshot, SyncAnswer, SyncRequest} from './sync.js';
import {childOf} from './trace.js';

/** One remote participant's credential: a bearer token that lets it act as `source`. */
export type RemoteGrant = {source: string; token: string};
/**
 * What the edge logs. It never carries a credential, and its `detail` is the refusal's fixed text, never an exception's
 * message.
 */
export type EdgeLogRecord = {event: 'edge.refused' | 'edge.connected' | 'edge.disconnected'; route: string; code?: ErrorCode; source?: string; detail?: string};
export type EdgeOptions = {
  bus: InProcessBus;
  /** Validates every inbound message: profile 2.0, the registered payload schemas and the 256 KiB cap. */
  validator: MessageValidator;
  /** One per remote source. A token may appear once; a source may hold several, as during a rotation. */
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

/**
 * A remote responder's or owner's refusal, rebuilt as the shared error body: a registered code with its flag, and at
 * most `MAX_DETAIL` characters of detail. Anything else it carried is dropped. Undefined when it is not a refusal.
 */
function rebuilt(value: unknown): ErrorBody | undefined {
  const error = fields(fields(value)?.error);
  const code = error?.code;
  if (!isErrorCode(code) || RETRYABLE[code] !== error?.retryable) return undefined;
  const detail = typeof error?.detail === 'string' && error.detail.length > 0 ? error.detail.slice(0, MAX_DETAIL) : undefined;
  return errorBody(code, detail === undefined ? {} : {detail});
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
  participant: Sdk;
  response: ServerResponse;
  open: boolean;
  closed: Promise<void>;
  markClosed: () => void;
  /** The socket's buffer is full: writes wait for it to drain. */
  drained: Promise<void> | undefined;
  /** Subscriptions, responders and sync owners by the id the remote part chose. */
  opened: Map<string, Subscription>;
};

export class RemoteEdge {
  readonly #bus: InProcessBus;
  readonly #validator: MessageValidator;
  readonly #grants: {source: string; digest: Buffer}[];
  readonly #log: (record: EdgeLogRecord) => void;
  readonly #now: () => number;
  readonly #scheduler: Scheduler;
  readonly #connections = new Map<string, Connection>();
  /**
   * Forwarded commands and sync requests waiting for an answer, by source, responder or owner id and the forwarded
   * message's own id, so a retry that reuses a requestId has its own entry. They outlive a connection, so a reply that
   * comes on the reconnected stream still reaches the requester.
   */
  readonly #waiting = new Map<string, Waiting>();
  /** One participant per source, for calls that need no connection. */
  readonly #participants = new Map<string, Sdk>();

  constructor(options: EdgeOptions) {
    this.#bus = options.bus;
    this.#validator = options.validator;
    // A token that two grants share would make the source ambiguous. Neither refusal names the token.
    const grants = options.grants.map(({source, token}) => {
      if (typeof source !== 'string' || !SOURCE.test(source) || source.length > 256) throw new SdkError(errorBody('invalid-request', {detail: 'a grant names a malformed source'}));
      if (typeof token !== 'string' || token.length === 0) throw new SdkError(errorBody('invalid-request', {detail: `the grant for ${source} has no token`}));
      return {source, digest: digest(token)};
    });
    if (new Set(grants.map(grant => grant.digest.toString('hex'))).size !== grants.length) {
      throw new SdkError(errorBody('invalid-request', {detail: 'two grants share a token'}));
    }
    this.#grants = grants;
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

  /**
   * Ends every stream and closes what the remote parts opened. A forwarded command still waiting can get no reply any
   * more, so its request is `uncertain`, as the deadline would make it; a forwarded sync request is unavailable.
   */
  close(): Promise<void> {
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
    try {
      source = this.#authenticate(request);
      if (request.method === 'GET' && route === 'stream') {
        this.#open(source, response);
        return;
      }
      if (request.method !== 'POST' || !isCall(route)) throw refuse('not-found', `no ${String(request.method)} ${path}`);
      const body = await this.#read(request, route === 'answer' ? MAX_ANSWER_BYTES : MAX_CALL_BYTES);
      // A remote part that stops waiting, because its copy or participant closed, drops the call.
      const dropped = new AbortController();
      response.once('close', () => { if (!response.writableEnded) dropped.abort(); });
      // The remote part may have gone while its body was read.
      if (response.closed) dropped.abort();
      this.#write(response, 200, {schema: REMOTE_SCHEMA, ...await this.#call(source, route, body, dropped.signal)});
    } catch (error) {
      // Only the edge's and the SDK's own refusals carry their text on; anything else is the fixed `internal` answer.
      const refused = error instanceof Refusal || error instanceof SdkError ? error.body : FAILED;
      const {code, detail} = refused.error;
      this.#log({event: 'edge.refused', route, code, ...(source === undefined ? {} : {source}), ...(detail === undefined ? {} : {detail})});
      // A body over its limit is left unread, so the connection closes after the refusal.
      this.#write(response, statusOf(code), refused, code === 'too-large');
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
      request.once('error', reject);
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

  async #call(source: string, call: Call, body: Fields, signal: AbortSignal): Promise<object> {
    switch (call) {
      case 'publish':
        await this.#participant(source).publishMessage(text(body, 'key'), this.#inbound(source, body.message));
        return {status: 'published'};
      case 'request': {
        // The edge answers when its bus settles: the reply, `expired` if the command was still queued at its deadline,
        // or `uncertain-result` if a handler had it. The remote requester waits a little longer, so it hears this.
        const command = this.#inbound(source, body.command) as Command<object>;
        const result = await this.#bus.requestMessage(source, text(body, 'key'), command, this.#remaining(command), signal);
        return {result};
      }
      case 'sync': {
        const request = this.#inbound(source, body.request) as Message<SyncRequest>;
        if (request.subject !== request.data.families.join(',')) throw refuse('invalid-message', 'a sync request\'s subject names its families, joined by commas');
        const answer = await this.#bus.syncMessage(source, request, this.#remaining(request), signal);
        if (answer.status === 'served') this.#capped(answer);
        return {answer};
      }
      case 'subscribe': {
        const connection = this.#connection(source, body);
        const id = this.#fresh(connection, body);
        connection.opened.set(id, await connection.participant.subscribe(text(body, 'pattern'), message => this.#pushed(connection, 'message', {subscription: id, message}), {
          onOverflow: ({dropped}) => this.#pushed(connection, 'overflow', {subscription: id, ...(dropped === undefined ? {} : {dropped})}),
        }));
        return {status: 'subscribed'};
      }
      case 'respond': {
        const connection = this.#connection(source, body);
        const id = this.#fresh(connection, body);
        // The forward settles a command with a reply or one of the bus's markers, which the bus reads in place of a
        // reply; the participant's types know only replies.
        connection.opened.set(id, await connection.participant.respond(text(body, 'pattern'), command =>
          this.#forward(connection, 'command', id, command, 'command', {responder: id, command}) as Promise<Reply>));
        return {status: 'responding'};
      }
      case 'serve': {
        const connection = this.#connection(source, body);
        const id = this.#fresh(connection, body);
        const families: unknown = body.families;
        const isNames = (value: unknown): value is string[] => Array.isArray(value) && value.every(family => typeof family === 'string');
        if (!isNames(families)) throw refuse('invalid-request', 'families is not a list of names');
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
        const answer = rebuilt(body.answer) ?? this.#snapshot(source, body.answer);
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

  /** A message from the remote part, checked: profile 2.0, its payload schema, the cap, its expiry and its source. */
  #inbound(source: string, value: unknown): Message {
    const result = this.#validator.validate(value, {nowMs: this.#now()});
    if (!result.ok) throw new Refusal({error: result.error});
    if (result.value.source !== source) throw refuse('forbidden', `this token cannot send a message from ${result.value.source}`);
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
    const reply: Reply | undefined = fields(value)?.status === 'accepted' ? {status: 'accepted'} : rebuilt(value);
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

  #key(source: string, id: string, messageId: string): string {
    return `${source}\n${id}\n${messageId}`;
  }

  #open(source: string, response: ServerResponse): void {
    let markClosed = (): void => {};
    const closed = new Promise<void>(resolve => { markClosed = resolve; });
    const connection: Connection = {
      id: randomUUID(), source, participant: this.#bus.connect(source), response, open: true, drained: undefined, closed, markClosed,
      opened: new Map(),
    };
    this.#connections.set(connection.id, connection);
    response.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive'});
    response.on('close', () => { this.#drop(connection); });
    response.write(frame('ready', {connection: connection.id}));
    this.#log({event: 'edge.connected', route: 'stream', source});
  }

  /**
   * A lost stream closes everything the connection opened. A forwarded sync request still waiting is refused as
   * unavailable, since a sync only reads. A forwarded command is not answered: its handler may be running it, so it
   * waits for a reply on the reconnected stream, or for its deadline, which makes it uncertain.
   */
  #drop(connection: Connection): void {
    if (!connection.open) return;
    connection.open = false;
    connection.markClosed();
    this.#connections.delete(connection.id);
    for (const waiting of [...this.#waiting.values()]) {
      if (waiting.kind === 'sync' && waiting.connection === connection.id) waiting.finish(errorBody('unavailable', {detail: 'the remote owner disconnected'}));
    }
    for (const opened of connection.opened.values()) {
      opened.close().catch(() => {});
    }
    connection.opened.clear();
    this.#log({event: 'edge.disconnected', route: 'stream', source: connection.source});
  }

  /**
   * Writes one event, and says whether it went to the socket. When the socket's buffer is full it waits for it to
   * drain, so a slow reader's queue fills.
   */
  async #push(connection: Connection, event: StreamEventName, data: object): Promise<boolean> {
    if (!connection.open) return false;
    if (connection.response.write(frame(event, data))) return true;
    connection.drained ??= new Promise(resolve => {
      connection.response.once('drain', () => {
        connection.drained = undefined;
        resolve();
      });
    });
    await Promise.race([connection.drained, connection.closed]);
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

  #write(response: ServerResponse, status: number, body: object, close = false): void {
    if (response.headersSent || response.destroyed) return;
    response.writeHead(status, {'content-type': 'application/json', 'cache-control': 'no-store', ...(close ? {connection: 'close'} : {})});
    response.end(JSON.stringify(body));
  }
}
