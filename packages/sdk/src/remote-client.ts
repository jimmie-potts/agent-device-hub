// The client side of the remote transport (Hub #883): the same SDK calls, carried to an edge over SSE and HTTP.
import type {ErrorScope} from './in-process.js';
import type {Sdk} from './sdk.js';

export type RemoteOptions = {
  /** The edge's base URL, such as `http://127.0.0.1:8790`. */
  url: string;
  source: string;
  /** The bearer token the edge granted this source. It is sent only in the `authorization` header. */
  token: string;
  now?: () => number;
  /** How many messages may wait in one subscription's or responder's queue on this side. Defaults to 1024. */
  maxQueued?: number;
  onError?: (error: unknown, scope: ErrorScope) => void;
  /** How long to wait before reconnecting a lost stream. Defaults to 100 ms, doubling up to 5 s. */
  reconnectDelayMs?: number;
};

/** A remote participant: the SDK calls, and `close`, which ends its stream and everything it opened. */
export interface RemoteParticipant extends Sdk {
  close(): Promise<void>;
}

export function connectRemote(_options: RemoteOptions): Promise<RemoteParticipant> {
  return Promise.reject(new Error('the remote transport is not implemented yet'));
}
