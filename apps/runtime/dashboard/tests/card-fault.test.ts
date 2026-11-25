// The record of a contained card fault (Hub #2139): one record through the SDK's recordLog, at the level its table gives,
// with the card's identity and the error's type, never the error's message, stack or cause.
import assert from 'node:assert/strict';
import test from 'node:test';
import {levelOf, type LogFields, type Logger} from '@jimmie-potts/sdk';
import {CARD_FAULT_EVENT, pageRecords, recordCardFault, reportCardError} from '../src/card-fault.ts';

const SECRET = 'tok_SYNTHETIC2139 /Users/someone/private.txt';

function capture(): {log: Logger; records: {level: string; event: string; fields: LogFields | undefined}[]} {
  const records: {level: string; event: string; fields: LogFields | undefined}[] = [];
  const at = (level: string) => (event: string, fields?: LogFields) => { records.push({level, event, fields}); };
  return {log: {debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error')}, records};
}

void test('a card fault is one record with the card and the error type, at the table level', () => {
  const {log, records} = capture();
  recordCardFault(log, 'device:bunny/modules/tidbyt:tidbyt', new TypeError(SECRET, {cause: new Error(SECRET)}));
  assert.deepEqual(records, [{level: levelOf(CARD_FAULT_EVENT), event: 'dashboard.card.failed',
    fields: {'bunny.card': 'device:bunny/modules/tidbyt:tidbyt', 'bunny.code': 'internal', 'error.type': 'TypeError'}}]);
  assert.equal(levelOf(CARD_FAULT_EVENT), 'error', 'a rendering fault is an internal fault: ERROR');
  assert.equal(JSON.stringify(records).includes('SYNTHETIC2139'), false, 'no message, stack or cause is recorded');
});

void test('a thrown value that is not an Error is recorded by its type, and an unusual name falls back to Error', () => {
  const {log, records} = capture();
  recordCardFault(log, 'inbox', SECRET);
  const odd = new Error('x');odd.name = SECRET;
  recordCardFault(log, 'inbox', odd);
  assert.deepEqual(records.map(record => record.fields?.['error.type']), ['string', 'Error']);
});

void test('an identity outside the neutral alphabet is not recorded as given', () => {
  const {log, records} = capture();
  recordCardFault(log, `inbox ${SECRET}`, new Error('x'));
  assert.equal(records[0]?.fields?.['bunny.card'], 'unknown');
});

void test('the page keeps a bounded log of its records', () => {
  const start = pageRecords().length;
  for (let index = 0; index < 100; index += 1) recordCardFault(undefined, 'inbox', new Error('x'));
  assert.ok(start <= 64);
  assert.equal(pageRecords().length, 64, 'the page log keeps its newest 64 records');
  assert.equal(pageRecords().at(-1)?.event, 'dashboard.card.failed');
});

void test('a contained error is reported as a page error, or on the console in a browser without reportError', () => {
  const scope = globalThis as {reportError?: (error: unknown) => void};
  const original = scope.reportError, originalConsole = console.error;
  const reported: unknown[] = [], logged: unknown[] = [];
  const error = new TypeError('synthetic');
  try {
    scope.reportError = value => { reported.push(value); };
    console.error = (value: unknown) => { logged.push(value); };
    reportCardError(error);
    assert.deepEqual([reported, logged], [[error], []]);
    delete scope.reportError;
    assert.doesNotThrow(() => { reportCardError(error); });
    assert.deepEqual([reported, logged], [[error], [error]]);
  } finally {
    if (original === undefined) delete scope.reportError; else scope.reportError = original;
    console.error = originalConsole;
  }
});
