import type {Message} from '@jimmie-potts/event-contracts/v2';
import type {Identity, SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {Lifecycle21Observation, ReadReceiptObservation, ReadReceiptQualification} from '@jimmie-potts/event-contracts/v2/read-receipts';
import {producerSource} from '../hook/producer.js';

export const CLAUDE_TERMINAL_VERSION = '2.1.292';
export const CLAUDE_RECEIPT_FEED = `claude-terminal-read-${CLAUDE_TERMINAL_VERSION}`;
export type ReceiptFeed = Pick<Identity, 'provider' | 'client' | 'hostId' | 'sourceId'>;

/** The distinct credential grant opts this exact qualified producer into receipt intake. */
export const receiptSource = ({provider, client, hostId, sourceId}: ReceiptFeed): string =>
  producerSource({provider, client, hostId, sourceId, feed: CLAUDE_RECEIPT_FEED}).replace('/hub-', '/claude-read-');
/** Equality with this token binds a pane to one owner record; it is never parsed or ordered. */
export const viewRevision = (record: Pick<SessionRecord, 'revision'>): string => `session-${record.revision}`;

export function isReadReceipt(observation: Lifecycle21Observation): observation is ReadReceiptObservation {
  return observation.event.kind === 'read-receipt-observed';
}

/** Called only after schema validation and source authentication. No payload can opt itself in. */
export function receiptQualification(message: Message<ReadReceiptObservation>): ReadReceiptQualification | undefined {
  const {provider, client, hostId, sourceId} = message.data.identity;
  const feed = {provider, client, hostId, sourceId};
  if (provider !== 'claude' || client !== 'code' || message.data.event.receipt.kind !== 'owned-ui' || message.source !== receiptSource(feed)) return undefined;
  return {source: message.source, feed, kind: 'owned-ui'};
}
