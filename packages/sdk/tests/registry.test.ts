// The error code registry as a type (Hub #948, ADR 0012 "Errors, effects and outcomes"): wherever a code is expected,
// one outside `schemas/v2/errors.json` fails to compile, and each code keeps the registry's fixed `retryable` flag. The
// event contracts' own tests keep the typed table equal to the registry file, code for code and flag for flag.
import assert from 'node:assert/strict';
import {RETRYABLE, errorBody, errorCodes, isErrorCode, type ErrorCode, type ErrorDetail} from '@jimmie-potts/event-contracts/v2';
import type {EdgeLogRecord} from '../src/index.js';
import type {ConformanceSpec} from '../src/testing/index.js';
import {it} from './support.js';

/** True only when `A` and `B` are the same type. */
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
/** True when any string would do where `T` is expected. */
type TakesAnyString<T> = string extends T ? true : false;

// Each of these fails to compile if a code outside the registry were accepted where a code is expected.
const unknownCode: 'not-a-code' extends ErrorCode ? true : false = false;
const errorBodyCode: TakesAnyString<Parameters<typeof errorBody>[0]> = false;
const detailCode: TakesAnyString<ErrorDetail['code']> = false;
const edgeLogCode: TakesAnyString<NonNullable<EdgeLogRecord['code']>> = false;
const kitCode: TakesAnyString<NonNullable<ConformanceSpec['refused']>['code']> = false;
// The union is exactly the table's keys, and each flag is a literal the compiler knows.
const tableKeys: Same<ErrorCode, keyof typeof RETRYABLE> = true;
const capacity: Same<typeof RETRYABLE['capacity'], true> = true;
const uncertain: Same<typeof RETRYABLE['uncertain-result'], false> = true;

it('a code outside the registry fails to compile where a code is expected, and fails at run time from an untyped caller', () => {
  assert.deepEqual(
    [unknownCode, errorBodyCode, detailCode, edgeLogCode, kitCode, tableKeys, capacity, uncertain],
    [false, false, false, false, false, true, true, true],
  );
  const untyped = String('not-a-code');
  assert.equal(isErrorCode(untyped), false);
  assert.throws(() => errorBody(untyped as ErrorCode), /unregistered error code/);
  for (const code of Object.keys(errorCodes)) {
    assert.ok(isErrorCode(code), code);
    assert.equal(errorBody(code).error.retryable, RETRYABLE[code], `${code} keeps the registry's flag`);
  }
});
