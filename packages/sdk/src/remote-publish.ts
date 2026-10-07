// One prepared message, sent to an edge's publish call without a stream (Hub #926). A short-lived remote part, such as an
// agent hook, sends one message and ends, so it needs neither the remote client's event stream nor its reconnects: one
// HTTP call, bounded as a whole, whose result says what may have happened (ADR 0012, "Errors, effects and outcomes"). An
// edge's refusal, or an edge that was never reached, proves the message was not published. A call that reached the edge
// and then lost its answer, or an edge that failed, may have published it, so it is uncertain. Nothing sends it again.
import {request as httpRequest, type ClientRequest, type IncomingMessage} from 'node:http';
import {MAX_DETAIL, errorBody, type ErrorBody, type ErrorCode, type Message} from '@jimmie-potts/event-contracts/v2';
import {buildMessage} from './envelope.js';
import {refusalOf} from './refusal.js';
import {REMOTE_PATH, REMOTE_SCHEMA, SOURCE_HEADER} from './remote-protocol.js';
import {MAX_TIMEOUT_MS, SdkError, type Draft, type SendOptions} from './sdk.js';
import {childOf, traceFields} from './trace.js';

export type PublishOnceOptions = {
  /** The edge's base URL, such as `http://127.0.0.1:8788`. Only `http` is supported: an edge listens on loopback. */
  url: string;
  /** The source the token was granted to, sent in the `bunny-source` header; the message must come from it. */
  source: string;
  /** The bearer token the edge granted the source. It is sent only in the `authorization` header. */
  token: string;
  /** How long the whole call may take, connecting included: an integer from 1 to `MAX_TIMEOUT_MS`. */
  timeoutMs: number;
};

/**
 * What one publication call ended with. `rejected` proves the message was not published: the edge refused it with a
 * registry code, or could not be reached (`unavailable`). `uncertain` (`uncertain-result`) means it may have been: the
 * call reached the edge and its answer was lost, late or not the edge's, or the edge failed. Error bodies carry the
 * message's trace ID.
 */
export type PublishOnceResult = {status: 'published'} | {status: 'rejected'; error: ErrorBody} | {status: 'uncertain'; error: ErrorBody};

/** The largest answer the call reads. An edge answers a publication with a few hundred bytes. */
const MAX_ANSWER_BYTES = 16 * 1024;

/**
 * A new profile 2.0 message from `source`, as a participant would send it: a new `id`, the current `time` from `now`
 * (default `Date.now`) and a `traceparent` that continues `parent`, or starts a new sampled trace without one.
 */
export function prepareMessage<T extends object>(source: string, draft: Draft<T>, options: SendOptions & {now?: () => number} = {}): Message<T> {
  return buildMessage(source, draft.kind, draft, childOf(options.parent), (options.now ?? Date.now)());
}

/** The edge's publication route for `url`, or undefined when `url` is not an `http` URL. */
function routeOf(url: string): URL | undefined {
  let base: URL;
  try {
    base = new URL(url);
  } catch {
    return undefined;
  }
  if (base.protocol !== 'http:') return undefined;
  return new URL(`${base.origin}${base.pathname.replace(/\/$/, '')}${REMOTE_PATH}/publish`);
}

const fields = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** What the edge's answer says: published, its refusal, or, for anything else, an uncertain publication. */
function answerOf(status: number, text: string, ids: {traceId?: string}): PublishOnceResult {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  const answer = fields(body);
  if (status === 200 && answer?.schema === REMOTE_SCHEMA && answer.status === 'published') return {status: 'published'};
  const refusal = status === 200 ? undefined : refusalOf(body);
  // The edge refuses a message before its bus has it; `internal` and `uncertain-result` mean it failed, maybe after.
  if (refusal !== undefined && refusal.error.code !== 'internal' && refusal.error.code !== 'uncertain-result') {
    return {status: 'rejected', error: {error: {...refusal.error, ...ids}}};
  }
  return uncertain('the edge did not answer with its publication or a refusal; the message may have been published', ids);
}

const failure = (code: ErrorCode, detail: string, ids: {traceId?: string}): ErrorBody => errorBody(code, {...ids, detail: detail.slice(0, MAX_DETAIL)});
const uncertain = (detail: string, ids: {traceId?: string}): PublishOnceResult => ({status: 'uncertain', error: failure('uncertain-result', detail, ids)});

/**
 * Sends one prepared message, such as one from `prepareMessage`, to the edge's publication call, as the token's source,
 * with no stream, and resolves with what happened within `timeoutMs`; it never rejects for the edge's answer. The call
 * carries the message's `traceparent`. It rejects with `SdkError` (`invalid-request`), before anything is sent, a
 * malformed deadline or a URL that is not `http`. Nothing is sent again, and nothing is reported but the result.
 */
export function publishOnce(options: PublishOnceOptions, key: string, message: Message): Promise<PublishOnceResult> {
  const {source, token, timeoutMs} = options;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    return Promise.reject(new SdkError(errorBody('invalid-request', {detail: `timeoutMs must be an integer from 1 to ${MAX_TIMEOUT_MS}`})));
  }
  const route = routeOf(options.url);
  if (route === undefined) return Promise.reject(new SdkError(errorBody('invalid-request', {detail: 'the edge\'s URL must be an http URL'})));
  const traced = traceFields(message);
  const ids = traced === undefined ? {} : {traceId: traced.traceId};
  const body = JSON.stringify({schema: REMOTE_SCHEMA, key, message});
  const headers = {
    authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), [SOURCE_HEADER]: source,
    // The call carries the message's trace, as every HTTP call between B.U.N.N.Y. components does (ADR 0012, "Observability").
    ...(traced === undefined ? {} : {traceparent: message.traceparent}),
  };
  return new Promise<PublishOnceResult>((resolve, reject) => {
    /** Whether the connection is up, so the edge may have read the call. */
    let reached = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let outgoing: ClientRequest;
    try {
      outgoing = httpRequest(route, {method: 'POST', agent: false, headers}, receive);
    } catch (error) {
      // Node refuses a header value it cannot send, such as a token with a line break, before connecting.
      reject(new SdkError(errorBody('invalid-request', {detail: 'the token or the source cannot be sent in a header'}), {cause: error}));
      return;
    }
    function receive(response: IncomingMessage): void {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_ANSWER_BYTES) finish(uncertain(`the edge's answer was over ${MAX_ANSWER_BYTES} bytes; the message may have been published`, ids));
        else chunks.push(chunk);
      });
      response.once('end', () => { finish(answerOf(response.statusCode ?? 0, Buffer.concat(chunks).toString('utf8'), ids)); });
      response.on('error', () => { lost('the edge\'s answer was cut off'); });
    }
    /** Settles once, and ends the call, its timer and its connection, whichever way it ended. */
    function finish(result: PublishOnceResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      outgoing.destroy();
      resolve(result);
    }
    /** A call that ended without the edge's answer: unpublished if it never reached the edge, uncertain once it had. */
    function lost(detail: string): void {
      finish(reached ? uncertain(`${detail}; the message may have been published`, ids) : {status: 'rejected', error: failure('unavailable', `${detail}; nothing was sent`, ids)});
    }
    outgoing.once('socket', socket => {
      if (socket.connecting) socket.once('connect', () => { reached = true; });
      else reached = true;
    });
    // Every error is heard, so one after the call settled never escapes as an unhandled event.
    outgoing.on('error', () => { lost('the edge could not be reached'); });
    timer = setTimeout(() => { lost(`the edge did not answer within ${timeoutMs} ms`); }, timeoutMs);
    outgoing.end(body);
  });
}
