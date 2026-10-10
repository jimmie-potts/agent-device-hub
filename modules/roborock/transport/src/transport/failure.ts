import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {SdkError} from '@jimmie-potts/sdk';
/** Internal retry marker. Decode, authentication and cancellation failures never carry it. */
export class ConnectionFailure extends SdkError {
  constructor() { super(errorBody('unavailable', {detail: 'The vendor connection ended before an observation.'})); }
}
