// The server side of the remote transport (Hub #883): a remote part's edge on the runtime's in-process bus.
import type {IncomingMessage, ServerResponse} from 'node:http';
import type {MessageValidator} from '@jimmie-potts/event-contracts/v2';
import type {InProcessBus} from './in-process.js';

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
};

export class RemoteEdge {
  constructor(_options: EdgeOptions) {}

  /** Serves one HTTP request; mount it on a `node:http` server. */
  readonly handle = (_request: IncomingMessage, response: ServerResponse): void => {
    response.writeHead(501);
    response.end();
  };

  /** Ends the open streams, of one source or of all, so those remote parts reconnect. */
  disconnect(_source?: string): void {}

  /** Ends every stream and closes what the remote parts opened. */
  close(): Promise<void> {
    return Promise.resolve();
  }
}
