// The profile 2.0 envelope a participant puts around what it sends (ADR 0012, "Envelope and conventions"). A remote
// part builds its messages with this, so they keep their own `id` and `time` when its edge injects them. Its IDs come
// from Web Crypto, which Node and a browser both have, so a browser part can bundle it (Hub #922).
import type {Message, MessageKind} from '@jimmie-potts/event-contracts/v2';
import type {TraceContext} from './sdk.js';

export type Content<T> = {type: string; subject: string; dataschema: string; data: T};

/** A new message from `source`, sent at `sentAtMs`; commands and sync requests also carry their `expiresat`. */
export function buildMessage<T>(
  source: string, kind: MessageKind, content: Content<T>, trace: TraceContext, sentAtMs: number, expiresAtMs?: number,
): Message<T> {
  return {
    specversion: '1.0', bunnyprofile: '2.0', id: crypto.randomUUID(), source, type: content.type, subject: content.subject,
    time: new Date(sentAtMs).toISOString(), kind, datacontenttype: 'application/json', dataschema: content.dataschema, ...trace,
    ...(expiresAtMs === undefined ? {} : {expiresat: new Date(expiresAtMs).toISOString()}),
    data: content.data,
  };
}
