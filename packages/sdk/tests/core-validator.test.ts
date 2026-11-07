// The process's shared core validator is sealed, so registering on it must not compile (Hub #1537). The SDK's typecheck
// covers this file; the event contract package's own tests are JavaScript and cannot hold a type assertion.
import assert from 'node:assert/strict';
import {coreValidator, registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import {it} from './support.js';

it('the shared core validator offers only validate, and registering on it does not compile', () => {
  const shared = coreValidator();
  // @ts-expect-error the shared core validator is sealed and offers no register; an owner that needs more families builds its own.
  const register: unknown = shared.register;
  assert.equal(typeof register, 'function', 'only the type withholds register; the sealed instance still refuses it at run time');
  // @ts-expect-error registering the core families on the shared validator would throw while an owner starts.
  assert.throws(() => { registerCoreFamilies(shared); }, /sealed validator/);
  assert.equal(typeof shared.validate, 'function');
});
