import {MessageValidator, errorBody, type Validation} from '@jimmie-potts/event-contracts/v2';
import {registerDeviceFamilies} from '@jimmie-potts/event-contracts/v2/devices';
import {registerCoreFamilies, type LifecycleObservation} from '@jimmie-potts/event-contracts/v2/families';
import {LIFECYCLE_SCHEMA, producerSource} from '../hook/index.js';

/** Runtime-owned producer identity admission, after the SDK's ordinary envelope and family checks. */
export class RuntimeEdgeValidator extends MessageValidator {
  constructor(schemas: Readonly<Record<string, object>> = {}) {
    super();
    registerCoreFamilies(this);
    registerDeviceFamilies(this);
    for (const [dataschema, schema] of Object.entries(schemas)) this.register(dataschema, schema);
  }

  override validate<T = Record<string, unknown>>(input: unknown, options: {nowMs?: number} = {}): Validation<T> {
    const result = super.validate<T>(input, options);
    if (!result.ok || result.value.dataschema !== LIFECYCLE_SCHEMA || !/^bunny\/parts\/hub-[0-9a-f]{32}$/.test(result.value.source)) return result;
    // The family has validated this payload. Only the feed tuple participates in the credential identity.
    const {provider, client, hostId, sourceId} = (result.value.data as LifecycleObservation).identity;
    if (result.value.source !== producerSource({provider, client, hostId, sourceId})) {
      return {ok: false, error: errorBody('forbidden', {detail: 'the producer credential does not own this lifecycle identity'}).error};
    }
    return result;
  }
}
