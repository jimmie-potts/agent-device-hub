import type {Message} from '@jimmie-potts/event-contracts/v2';
import type {Identity, SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {Lifecycle21Observation, ReadReceiptObservation, ReadReceiptQualification} from '@jimmie-potts/event-contracts/v2/read-receipts';
import {producerSource} from '../hook/producer.js';

export const CLAUDE_TERMINAL_VERSION = '2.1.292';
export const CLAUDE_RECEIPT_FEED = `claude-terminal-read-${CLAUDE_TERMINAL_VERSION}`;
/** Persisted enrollment identity from the first qualified protocol; its historical versions are not admission rules. */
export const CODEX_RECEIPT_FEED = 'codex-desktop-read-26.1027.30824-22943-0.166.0-alpha.5.1';
/** Desktop puts global configuration flags before the stdio subcommand. Other transports remain unobserved. */
export function isCodexStdioServer(args: readonly string[]): boolean {
  let index = 0;
  while ((args[index] === '-c' || args[index] === '--config') && args[index + 1] !== undefined) index += 2;
  return args[index] === 'app-server' && !args.slice(index + 1).some(arg => arg === 'daemon' || arg.startsWith('--listen'));
}
export type ReceiptFeed = Pick<Identity, 'provider' | 'client' | 'hostId' | 'sourceId'>;

/** The distinct credential grant opts this exact qualified producer into receipt intake. */
export const receiptSource = ({provider, client, hostId, sourceId}: ReceiptFeed): string =>
  producerSource({provider, client, hostId, sourceId, feed: CLAUDE_RECEIPT_FEED}).replace('/hub-', '/claude-read-');
export const codexReceiptSource = ({provider, client, hostId, sourceId}: ReceiptFeed): string =>
  producerSource({provider, client, hostId, sourceId, feed: CODEX_RECEIPT_FEED}).replace('/hub-', '/codex-read-');
/** Equality with this token binds a pane to one owner record; it is never parsed or ordered. */
export const viewRevision = (record: Pick<SessionRecord, 'revision'>): string => `session-${record.revision}`;

export function isReadReceipt(observation: Lifecycle21Observation): observation is ReadReceiptObservation {
  return observation.event.kind === 'read-receipt-observed';
}

/** Called only after schema validation and source authentication. No payload can opt itself in. */
export function receiptQualification(message: Message<ReadReceiptObservation>): ReadReceiptQualification | undefined {
  const {provider, client, hostId, sourceId} = message.data.identity;
  const feed = {provider, client, hostId, sourceId};
  const kind = message.data.event.receipt.kind;
  if (provider === 'claude' && client === 'code' && kind === 'owned-ui' && message.source === receiptSource(feed)) {
    return {source: message.source, feed, kind};
  }
  if (provider === 'codex' && client === 'local' && kind === 'provider-client' && message.source === codexReceiptSource(feed)) {
    return {source: message.source, feed, kind};
  }
  return undefined;
}
