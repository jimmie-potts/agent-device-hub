// The SSE/HTTP protocol between a remote part and its edge (Hub #883, ADR 0012 "Runtime and transport"). Messages flow
// down one event stream per connection; calls go up as HTTP POSTs. Every frame carries `schema: sdk-remote/1.0`, the
// route carries only the major version, and every refusal is the shared error body.
import type {ErrorCode} from '@jimmie-potts/event-contracts/v2';

export const REMOTE_SCHEMA = 'sdk-remote/1.0';
export const REMOTE_PATH = '/api/sdk/v1';
/** The header in which a remote part declares the source it acts as; the edge refuses a token used under another (Hub #835). */
export const SOURCE_HEADER = 'bunny-source';
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

  push(text: string): {event: string; data: string}[] {
    this.#buffer += text;
    const events: {event: string; data: string}[] = [];
    for (let end = this.#buffer.indexOf('\n\n'); end >= 0; end = this.#buffer.indexOf('\n\n')) {
      const block = this.#buffer.slice(0, end);
      this.#buffer = this.#buffer.slice(end + 2);
      let event = 'message', data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7);
        else if (line.startsWith('data: ')) data = line.slice(6);
      }
      if (data !== '') events.push({event, data});
    }
    return events;
  }
}
