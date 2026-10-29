import {errorBody, type ErrorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import type {DesktopMetadataSnapshot, LifecycleObservation} from '@jimmie-potts/event-contracts/v2/families';
import {LIFECYCLE_SCHEMA} from '../hook/observation.js';
import {producerSource} from '../hook/producer.js';

/** The `desktop-metadata` family's schema (Hub #567). */
export const DESKTOP_METADATA_SCHEMA = 'https://bunny.invalid/events/desktop-metadata/2.0';
const PRODUCER = /^bunny\/parts\/hub-[0-9a-f]{32}$/;

/** Additional private-ingress admission; released local producer configuration stays unchanged. */
export function checkProducerIdentity(message: Message): ErrorBody | undefined {
  if (message.dataschema !== LIFECYCLE_SCHEMA || !PRODUCER.test(message.source)) return undefined;
  // The SDK has validated this family and authenticated the envelope's source.
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
