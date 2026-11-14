// The SSE/HTTP protocol between a remote part and its edge (Hub #883, ADR 0012 "Runtime and transport"). Messages flow
// down one event stream per connection; calls go up as HTTP POSTs. Every frame carries `schema: sdk-remote/1.0`, the
// route carries only the major version, and every refusal is the shared error body.
import {errorBody, type ErrorCode} from '@jimmie-potts/event-contracts/v2/errors';
import {SdkError} from './sdk.js';

export const REMOTE_SCHEMA = 'sdk-remote/1.0';
export const REMOTE_PATH = '/api/sdk/v1';
/** The header in which a remote part declares the source it acts as; the edge refuses a token used under another (Hub #835). */
export const SOURCE_HEADER = 'bunny-source';
/**
 * The header a browser page's every call carries (Hub #922): the runtime's gateway requires `bunny-request: 1` on a
 * browser session's change, which a page on another site cannot send without the gateway's leave (Hub #835).
 */
export const REQUEST_HEADER = 'bunny-request';
/** A call carries at most one message of the profile's 256 KiB, plus the call around it. */
export const MAX_CALL_BYTES = (256 + 64) * 1024;
/** An owner's snapshot answer carries many state drafts, each within the message cap once enveloped. */
export const MAX_ANSWER_BYTES = 16 * 1024 * 1024;
/** The calls a remote part makes, each a POST to `${REMOTE_PATH}/<call>`. */
export const CALLS = ['publish', 'subscribe', 'request', 'respond', 'reply', 'sync', 'serve', 'answer', 'close'] as const;
export type Call = typeof CALLS[number];
/** The events an edge sends down the stream. */
export type StreamEventName = 'ready' | 'message' | 'overflow' | 'command' | 'sync-request';

const STATUS: Partial<Record<ErrorCode, number>> = {
  'too-large': 413, unauthenticated: 401, forbidden: 403, 'not-found': 404, 'invalid-state': 409, 'revision-conflict': 409,
  'duplicate-conflict': 409, capacity: 429, unavailable: 503, 'uncertain-result': 500, internal: 500,
};
/** The HTTP status that carries an error code; other refusals are 400. */
export const statusOf = (code: ErrorCode): number => STATUS[code] ?? 400;

/** One `text/event-stream` frame: `event: <name>` and one `data:` line of JSON. */
export const frame = (event: StreamEventName, data: object): string => `event: ${event}\ndata: ${JSON.stringify({schema: REMOTE_SCHEMA, ...data})}\n\n`;

/** Splits a `text/event-stream` into events. Only `event` and single-line `data` fields are used; comments are skipped. */
export class EventStreamParser {
  #buffer = '';

  constructor(private readonly maxFrame?: number) {}

  push(text: string): {event: string; data: string}[] {
    const events: {event: string; data: string}[] = [];
    if (this.maxFrame === undefined) {
      this.#buffer += text;
      for (let end = this.#buffer.indexOf('\n\n'); end >= 0; end = this.#buffer.indexOf('\n\n')) {
        this.#appendEvent(events, this.#buffer.slice(0, end));
        this.#buffer = this.#buffer.slice(end + 2);
      }
      return events;
    }

    // Check before adding to the retained frame, even when the transport delivers one large chunk.
    let offset = 0;
    if (this.#buffer.endsWith('\n') && text.startsWith('\n')) {
      this.#appendEvent(events, this.#buffer.slice(0, -1));
      this.#buffer = '';
      offset = 1;
    }
    for (let end = text.indexOf('\n\n', offset); end >= 0; end = text.indexOf('\n\n', offset)) {
      this.#append(text.slice(offset, end));
      this.#appendEvent(events, this.#buffer);
      this.#buffer = '';
      offset = end + 2;
    }
    this.#append(text.slice(offset));
    return events;
  }

  #append(text: string): void {
    if (this.maxFrame === undefined) return;
    if (this.#buffer.length + text.length > this.maxFrame + 1) throw tooLarge();
    const next = this.#buffer + text;
    if (new TextEncoder().encode(next).byteLength > this.maxFrame + (next.endsWith('\n') ? 1 : 0)) throw tooLarge();
    this.#buffer = next;
  }

  #appendEvent(events: {event: string; data: string}[], block: string): void {
    if (this.maxFrame !== undefined && new TextEncoder().encode(block).byteLength > this.maxFrame) throw tooLarge();
    let event = 'message', data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) event = line.slice(7);
      else if (line.startsWith('data: ')) data = line.slice(6);
    }
    if (data !== '') events.push({event, data});
  }
}

const malformedJson = (): SdkError => new SdkError(errorBody('invalid-message', {detail: 'the response is not valid UTF-8 JSON'}));
const tooLarge = (): SdkError => new SdkError(errorBody('too-large', {detail: 'the response exceeds its byte limit'}));

/** Read one response within the caller's fetch lifetime and actual byte budget. */
export async function readBoundedJson(response: Response, limit: number, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new SdkError(errorBody('invalid-message', {detail: 'the response has no body'}));
  const cancel = (): void => { void reader.cancel().catch(() => {}); };
  let buffer = new Uint8Array(Math.min(limit, 4096));
  let bytes = 0;
  signal.addEventListener('abort', cancel, {once: true});
  try {
    for (;;) {
      signal.throwIfAborted();
      const {value, done} = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      const next = bytes + value.byteLength;
      if (next > limit) throw tooLarge();
      if (next > buffer.byteLength) {
        const grown = new Uint8Array(Math.min(limit, Math.max(next, buffer.byteLength * 2)));
        grown.set(buffer.subarray(0, bytes));
        buffer = grown;
      }
      buffer.set(value, bytes);
      bytes = next;
    }
    try {
      const text = new TextDecoder('utf-8', {fatal: true}).decode(buffer.subarray(0, bytes));
      return JSON.parse(text) as unknown;
    } catch { throw malformedJson(); }
  } catch (error) {
    cancel();
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}
