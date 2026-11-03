import {MessageValidator} from '@jimmie-potts/event-contracts/v2';
import {artSchemas, registerArtStateFamily} from '@jimmie-potts/event-contracts/v2/art-state';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';

export {artSchemas, registerArtStateFamily};
export function artValidator(): MessageValidator {
  const validator = new MessageValidator();
  registerCoreFamilies(validator);
  registerArtStateFamily(validator);
  return validator;
}
