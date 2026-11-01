import {READ_RECEIPT_SCHEMA, type Lifecycle21Observation} from '@jimmie-potts/event-contracts/v2/read-receipts';
import {isReadReceipt, receiptQualification} from '../read-receipts/qualification.js';
import {SCHEMA_BASE, errorBody, type ErrorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import {DESKTOP_METADATA_SCHEMA, type DesktopMetadataSnapshot, type LifecycleObservation} from '@jimmie-potts/event-contracts/v2/families';
import {LIFECYCLE_SCHEMA} from '../hook/observation.js';
import {producerSource} from '../hook/producer.js';

const PRODUCER = /^bunny\/parts\/hub-[0-9a-f]{32}$/;
/** The families an `ingest` credential publishes, each only on its own `bunny.event.<family>.` keys. */
const INGESTED = ['lifecycle', 'desktop-metadata'] as const;

/**
 * Admission on every entry (Hub #567): a lifecycle observation or Desktop snapshot travels only on its own family's
 * routing key, so neither reaches the other family's subscribers. The SDK edge matches the message's family to the grant
 * and its subject to the key's last token, but not the key's family to the message's.
 */
export function checkKeyFamily(message: Message, key: string): ErrorBody | undefined {
  const family = INGESTED.find(name => message.dataschema.startsWith(`${SCHEMA_BASE}${name}/`));
  return family === undefined || key.startsWith(`bunny.event.${family}.`) ? undefined
    : errorBody('forbidden', {detail: 'a lifecycle observation or Desktop snapshot must use its own family\'s routing key'});
}

/** Additional private-ingress admission; released local producer configuration stays unchanged. */
export function checkProducerIdentity(message: Message): ErrorBody | undefined {
  if ((message.dataschema !== LIFECYCLE_SCHEMA && message.dataschema !== READ_RECEIPT_SCHEMA) || !PRODUCER.test(message.source)) return undefined;
  // The SDK has validated this family and authenticated the envelope's source.
  if (message.dataschema === READ_RECEIPT_SCHEMA && isReadReceipt(message.data as Lifecycle21Observation)) return checkReadReceiptIdentity(message);
  const {provider, client, hostId, sourceId} = (message.data as LifecycleObservation).identity;
  return message.source === producerSource({provider, client, hostId, sourceId}) ? undefined
    : errorBody('forbidden', {detail: 'the private producer credential does not own this lifecycle identity'});
}

/**
 * Admission of a Desktop metadata snapshot on every entry (Hub #567): only the derived collector credential of the
 * snapshot's feed publishes it. That credential's configuration names the feed and `feed: 'desktop-metadata'`, so it is
 * distinct from a hook credential of the same feed and owns no lifecycle identity on the private entry.
 */
export function checkDesktopFeedIdentity(message: Message): ErrorBody | undefined {
  if (message.dataschema !== DESKTOP_METADATA_SCHEMA) return undefined;
  // The SDK has validated this family and authenticated the envelope's source.
  const {provider, client, hostId, sourceId} = (message.data as DesktopMetadataSnapshot).feed;
  return PRODUCER.test(message.source) && message.source === producerSource({provider, client, hostId, sourceId, feed: 'desktop-metadata'}) ? undefined
    : errorBody('forbidden', {detail: 'the producer credential does not own this Desktop feed'});
}

/** Receipt qualification applies on both loopback and private entries, before publication reaches the bus. */
export function checkReadReceiptIdentity(message: Message): ErrorBody | undefined {
  const dedicated = message.source.startsWith('bunny/parts/claude-read-');
  if (message.dataschema !== READ_RECEIPT_SCHEMA) return dedicated
    ? errorBody('forbidden', {detail: 'a read-receipt credential publishes only its qualified receipts'}) : undefined;
  const observation = message.data as Lifecycle21Observation;
  if (!isReadReceipt(observation)) return dedicated
    ? errorBody('forbidden', {detail: 'a read-receipt credential cannot publish lifecycle activity'}) : undefined;
  return receiptQualification({...message, data: observation}) === undefined
    ? errorBody('forbidden', {detail: 'this source is not qualified for the read receipt feed'}) : undefined;
}
