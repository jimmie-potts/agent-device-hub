// Profile 2.0 (Hub #828): every message kind and building block against the shared fixtures.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {MessageValidator, compareDelivery, errorBody, errorCodes, schemas} from '../dist/v2/index.js';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/v2/messages.json', import.meta.url), 'utf8'));
const validator = () => {
  const v = new MessageValidator();
  for (const [uri, schema] of Object.entries(fixtures.schemas)) v.register(uri, schema);
  return v;
};
const patch = (base, changes) => {
  const value = structuredClone(fixtures.valid[base]);
  for (const [key, change] of Object.entries(changes)) {
    if (change === null) delete value[key];
    else value[key] = change;
  }
  return value;
};

test('every valid fixture passes, one for each message kind', () => {
  const v = validator();
  const kinds = new Set();
  for (const [name, message] of Object.entries(fixtures.valid)) {
    const result = v.validate(message);
    assert.equal(result.ok, true, `${name}: ${JSON.stringify(result.error)}`);
    kinds.add(message.kind);
  }
  assert.deepEqual([...kinds].sort(), ['command', 'occurrence', 'outcome', 'removal', 'reply', 'state', 'sync-completed', 'sync-request']);
});

test('every invalid fixture fails with its expected code', () => {
  const v = validator();
  for (const {name, base, patch: changes, expect, detail} of fixtures.invalid) {
    const result = v.validate(patch(base, changes));
    assert.equal(result.ok, false, name);
    assert.equal(result.error.code, expect, `${name}: ${result.error.detail}`);
    if (detail !== undefined) assert.equal(result.error.detail, detail, name);
    assert.equal(result.error.retryable, errorCodes[expect].retryable);
  }
});

test('a command past its expiry is refused when the reader passes its clock', () => {
  const v = validator();
  const {base, nowMs, expect} = fixtures.expired;
  assert.equal(v.validate(fixtures.valid[base]).ok, true, 'without a clock the message itself is valid');
  assert.equal(v.validate(fixtures.valid[base], {nowMs: nowMs - 1}).ok, true);
  const result = v.validate(fixtures.valid[base], {nowMs});
  assert.equal(result.ok, false);
  assert.equal(result.error.code, expect);
});

test('a message over 256 KiB is refused before any schema check', () => {
  const v = validator();
  const {base, field, bytes, expect} = fixtures.oversized;
  const big = structuredClone(fixtures.valid[base]);
  big.data[field] = {status: 'known', value: 'x'.repeat(bytes)};
  const result = v.validate(big);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, expect);
});

test('the same (source, id) is a duplicate with the same content and a conflict with different content', () => {
  const [a, b] = fixtures.duplicates.same.map(name => structuredClone(fixtures.valid[name]));
  assert.equal(compareDelivery(undefined, a), 'new');
  assert.equal(compareDelivery(a, b), 'duplicate');
  // Key order is not content: an outbox's resend may serialize attributes in another order.
  const reordered = Object.fromEntries(Object.entries(b).reverse());
  reordered.data = Object.fromEntries(Object.entries(b.data).reverse());
  assert.equal(compareDelivery(a, reordered), 'duplicate');
  const {base, patch: changes} = fixtures.duplicates.conflict;
  assert.equal(compareDelivery(a, patch(base, changes)), 'conflict');
  assert.equal(compareDelivery(a, patch(base, {id: 'msg-other'})), 'new');
});

test('modules register payload schemas built from the shared blocks, but not reserved or duplicate ones', () => {
  const v = new MessageValidator();
  assert.equal(v.validate(fixtures.valid.state).error.code, 'unknown-schema');
  v.register('https://bunny.invalid/events/example-session/2.0', fixtures.schemas['https://bunny.invalid/events/example-session/2.0']);
  assert.equal(v.validate(fixtures.valid.state).ok, true);
  assert.throws(() => v.register('https://bunny.invalid/events/example-session/2.0', {}), /already registered/);
  for (const family of ['reply', 'outcome', 'removal', 'sync-request', 'sync-completed', 'blocks', 'kinds', 'profile']) {
    assert.throws(() => v.register(`https://bunny.invalid/events/${family}/2.0`, {}), /reserved/, family);
  }
  assert.throws(() => v.register('example-session/2.1', {}), /invalid dataschema/);
  assert.throws(() => v.register('https://bunny.invalid/events/Example/2.0', {}), /invalid dataschema/);
});

test('non-JSON input is refused without throwing', () => {
  const v = validator();
  for (const input of [undefined, null, 5, 'text', [], new Map(), Object.create(null), {toJSON: () => ({})}]) {
    const result = v.validate(input);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'invalid-message');
  }
  const cyclic = structuredClone(fixtures.valid.state);
  cyclic.data.self = cyclic;
  assert.equal(v.validate(cyclic).ok, false);
  assert.equal(v.validate(JSON.parse('null')).error.code, 'invalid-message');
});

test('the error body takes retryable from the registry and refuses unregistered codes', () => {
  assert.deepEqual(errorBody('capacity', {requestId: 'req-1'}), {error: {code: 'capacity', retryable: true, requestId: 'req-1'}});
  assert.deepEqual(errorBody('uncertain-result'), {error: {code: 'uncertain-result', retryable: false}});
  assert.throws(() => errorBody('not-a-code'), /unregistered/);
  assert.throws(() => errorBody('internal', {detail: ''}), /detail/);
  assert.throws(() => errorBody('internal', {traceId: 'XYZ'}), /traceId/);
  assert.throws(() => errorBody('internal', {requestId: 'has space'}), /requestId/);
  for (const [code, entry] of Object.entries(errorCodes)) {
    assert.match(code, /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
    assert.equal(typeof entry.retryable, 'boolean');
  }
});

test('the error block lists exactly the registry codes and retryable flags, so received bodies cannot disagree', () => {
  const error = schemas.blocks.$defs.errorBody.properties.error;
  assert.deepEqual(schemas.blocks.$defs.errorCode.enum, Object.keys(errorCodes));
  assert.deepEqual(error.allOf[0].if.properties.code.enum, Object.entries(errorCodes).filter(([, entry]) => entry.retryable).map(([code]) => code));
});
