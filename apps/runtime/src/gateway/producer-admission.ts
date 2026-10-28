import {errorBody, type ErrorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import type {LifecycleObservation} from '@jimmie-potts/event-contracts/v2/families';
import {LIFECYCLE_SCHEMA} from '../hook/observation.js';
import {producerSource} from '../hook/producer.js';

/** Additional private-ingress admission; released local producer configuration stays unchanged. */
export function checkProducerIdentity(message: Message): ErrorBody | undefined {
  if (message.dataschema !== LIFECYCLE_SCHEMA || !/^bunny\/parts\/hub-[0-9a-f]{32}$/.test(message.source)) return undefined;
  // The SDK has validated this family and authenticated the envelope's source.
  const {provider, client, hostId, sourceId} = (message.data as LifecycleObservation).identity;
  return message.source === producerSource({provider, client, hostId, sourceId}) ? undefined
    : errorBody('forbidden', {detail: 'the private producer credential does not own this lifecycle identity'});
}
