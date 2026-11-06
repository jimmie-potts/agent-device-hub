import {MessageValidator} from '@jimmie-potts/event-contracts/v2';
import {artSchemas as stateSchemas, registerArtStateFamily} from '@jimmie-potts/event-contracts/v2/art-state';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';

/** Only what this module owns. `v2/art`'s families are core families. */
export const artSchemas = stateSchemas;
export {registerArtStateFamily};
export function artValidator(): MessageValidator {
  const validator = new MessageValidator();
  registerCoreFamilies(validator);
  registerArtStateFamily(validator);
  return validator;
}
