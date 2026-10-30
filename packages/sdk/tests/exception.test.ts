// Filtered exception fields (ADR 0012 "Safe errors", amended 2026-10-30; Hub #777): the one reader of an exception's
// message and stack keeps the context a diagnosis needs, replaces every credential-like or payload-like segment,
// bounds both texts and reads nothing a value supplies through a getter of its own.
import assert from 'node:assert/strict';
import {validateRecord} from '@jimmie-potts/bunny-observability';
import {MAX_EXCEPTION_MESSAGE, MAX_EXCEPTION_STACKTRACE, OMITTED, REDACTED, exceptionFields} from '../src/index.js';
import {it} from './support.js';

const SECRET = 'tok_SYNTHETIC123';
const text = (fields: Readonly<Record<string, unknown>>): string => JSON.stringify(fields);

it('keeps a synthetic failure\'s own context: its message, its frames, and the paths and addresses a diagnosis needs', () => {
  const error = new TypeError('connect ECONNREFUSED 192.0.2.7:56700 while painting /Users/someone/Pictures/wall.png for lamp-1');
  const fields = exceptionFields(error);
  assert.equal(fields['exception.message'], error.message);
  assert.match(String(fields['exception.stacktrace']), /^TypeError: connect ECONNREFUSED 192\.0\.2\.7:56700 .*\n {4}at /);
  assert.ok(String(fields['exception.stacktrace']).includes('exception.test'), 'the frames name where the error arose');
  assert.equal(fields['bunny.exception.redacted_count'], 0);
  assert.equal(fields['bunny.exception.truncated'], false);
  assert.deepEqual(Object.keys(fields).sort(), ['bunny.exception.redacted_count', 'bunny.exception.truncated', 'exception.message', 'exception.stacktrace']);
});

it('replaces credential-like segments and counts each, so no token, password or key survives in either text', () => {
  const message = [
    `Authorization: Bearer ${SECRET}`,
    'x-api-key=AbCdEfGh12345678',
    'GET https://operator:pa55w0rd@device.invalid/api?token=abc123secret&mode=on failed',
    '{"password":"hunter2","mode":"on"}',
    'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    'AKIAIOSFODNN7EXAMPLE',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk4',
    'signature 5d41402abc4b2a76b9719d911017c592a1b2c3d4e5f60718293a4b5c6d7e8f90',
  ].join('; ');
  const fields = exceptionFields(new Error(message));
  const serialized = text(fields);
  for (const canary of [SECRET, 'AbCdEfGh12345678', 'pa55w0rd', 'abc123secret', 'hunter2', 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 'AKIAIOSFODNN7EXAMPLE',
    'eyJhbGciOiJIUzI1NiJ9', '5d41402abc4b2a76b9719d911017c592a1b2c3d4e5f60718293a4b5c6d7e8f90']) {
    assert.equal(serialized.includes(canary), false, `${canary} is gone`);
  }
  const kept = String(fields['exception.message']);
  assert.ok(kept.includes(`Authorization: Bearer ${REDACTED}`), 'the header stays, its value does not');
  assert.ok(kept.includes(`https://${REDACTED}@device.invalid/api?token=${REDACTED}&mode=on`), 'the URL keeps its host and route');
  assert.ok(kept.includes(`{"password":"${REDACTED}","mode":"on"}`), 'a short JSON keeps its other members');
  assert.ok(Number(fields['bunny.exception.redacted_count']) >= 9, `each segment counts, in the message and again in the stack: ${String(fields['bunny.exception.redacted_count'])}`);
});

it('replaces a secret the caller names even when no rule knows its shape, through the caller\'s filter', () => {
  const token = 'plain-looking-value';
  const fields = exceptionFields(new Error(`the device said ${token} twice: ${token}`), {filter: value => {
    const parts = value.split(token);
    return {text: parts.join(REDACTED), replaced: parts.length - 1};
  }});
  assert.equal(fields['exception.message'], `the device said ${REDACTED} twice: ${REDACTED}`);
  assert.equal(text(fields).includes(token), false, 'the stack\'s first line is filtered too');
  assert.ok(Number(fields['bunny.exception.redacted_count']) >= 4);
});

it('omits long quoted and JSON-shaped segments, which may be a request body, a prompt or a transcript', () => {
  const prompt = 'Please summarize my day and remind me of the dentist and the thing I said about my sister '.repeat(3);
  const body = `{"prompt":"${prompt}","sessionId":"s1"}`;
  const fields = exceptionFields(new SyntaxError(`Unexpected token in body ${body} and in text "${prompt}" at line 1`));
  const kept = String(fields['exception.message']);
  assert.equal(kept.includes('dentist'), false, 'no part of the prompt survives');
  assert.equal(kept.includes('sessionId'), false, 'no part of the body survives');
  assert.ok(kept.startsWith(`Unexpected token in body ${OMITTED} and in text ${OMITTED} at line 1`), kept);
  assert.ok(Number(fields['bunny.exception.redacted_count']) >= 2);
  assert.equal(exceptionFields(new Error('a short "quoted" part and a {"small":"object"} stay'))['exception.message'], 'a short "quoted" part and a {"small":"object"} stay');
});

it('bounds both texts in characters and bytes, cutting a stack between its frames and saying so', () => {
  const long = exceptionFields(new Error('x'.repeat(5000)));
  assert.ok(String(long['exception.message']).length <= MAX_EXCEPTION_MESSAGE);
  assert.ok(String(long['exception.message']).endsWith(' [truncated]'));
  assert.ok(Buffer.byteLength(String(long['exception.stacktrace'])) <= MAX_EXCEPTION_STACKTRACE);
  assert.ok(String(long['exception.stacktrace']).endsWith(' [truncated]'), 'a stack whose first line is too long is cut in that line');
  assert.equal(long['bunny.exception.truncated'], true);
  const wide = exceptionFields(new Error('€'.repeat(1000)));
  assert.ok(Buffer.byteLength(String(wide['exception.message'])) <= MAX_EXCEPTION_MESSAGE, 'bytes, not only characters');
  assert.equal(wide['bunny.exception.truncated'], true);
  const deep = new Error('deep');
  deep.stack = `Error: deep\n${Array.from({length: 200}, (_, index) => `    at frame${index} (/opt/bunny/modules/lamp/dist/src/module.js:${index}:1)`).join('\n')}`;
  const cut = String(exceptionFields(deep)['exception.stacktrace']);
  assert.ok(cut.length <= MAX_EXCEPTION_STACKTRACE);
  assert.match(cut, /\(\/opt\/bunny\/modules\/lamp\/dist\/src\/module\.js:\d+:1\)\n\[truncated\]$/, 'whole frames only');
});

it('reads only an Error\'s own message and V8\'s own stack: a getter of the value, a cause or a non-Error is never read', () => {
  let touched = 0;
  const hostile = {name: 'Error', get message(): string { touched += 1; return SECRET; }, get stack(): string { touched += 1; return SECRET; }};
  assert.deepEqual(exceptionFields(hostile), {});
  assert.deepEqual(exceptionFields('a string'), {});
  assert.deepEqual(exceptionFields(undefined), {});
  class Lying extends Error {
    override get stack(): string { touched += 1; return SECRET; }
  }
  // V8 installs its own stack accessor on the instance, so the class's getter never shadows it and is never run.
  const lying = exceptionFields(new Lying('a message of its own'));
  assert.equal(lying['exception.message'], 'a message of its own');
  assert.match(String(lying['exception.stacktrace']), /^Error: a message of its own\n {4}at /, 'V8\'s own stack, not the class\'s getter');
  const redefined = new Error('redefined');
  Object.defineProperty(redefined, 'stack', {get() { touched += 1; return SECRET; }});
  assert.equal(exceptionFields(redefined)['exception.stacktrace'], undefined, 'an accessor a caller installed is not invoked');
  const cause = new Error('outer', {cause: new Error(SECRET)});
  assert.equal(text(exceptionFields(cause)).includes(SECRET), false, 'the cause stays in memory');
  const aggregate = new AggregateError([new Error(SECRET)], 'several');
  assert.equal(text(exceptionFields(aggregate)).includes(SECRET), false, 'the errors list stays in memory');
  assert.equal(touched, 0, 'no getter ran');
  const typed = new Error('typed');
  Object.defineProperty(typed, 'message', {value: {secret: SECRET}});
  assert.equal(text(exceptionFields(typed)).includes(SECRET), false, 'a message that is not a string is left out');
  const empty = new Error('');
  empty.stack = '';
  assert.deepEqual(exceptionFields(empty), {}, 'no text, no counts');
});

it('produces attributes a profile 1.7 record admits, under the runtime\'s scopes', () => {
  const fields = exceptionFields(new RangeError(`the device said ${SECRET}`));
  const record = {
    schema_version: '1.7', timestamp: new Date().toISOString(), severity_number: 17, severity_text: 'ERROR',
    event_name: 'runtime.module.failed', body: 'Module failed',
    resource: {'service.namespace': 'bunny', 'service.name': 'runtime', 'service.version': '0.1.0', 'service.instance.id': '00000000-0000-4000-8000-000000000002', 'deployment.environment.name': 'test'},
    scope: {name: 'bunny.runtime', version: '1.0.0'},
    attributes: {'bunny.provenance': 'source', 'bunny.module': 'lamp', 'bunny.code': 'internal', 'bunny.phase': 'handler', 'error.type': 'RangeError', ...fields},
  };
  const checked = validateRecord(record);
  assert.equal(checked.ok, true);
  assert.equal(JSON.stringify(checked).includes(SECRET), false);
  assert.equal(validateRecord({...record, schema_version: '1.6'}).ok, false, 'an earlier profile refuses the text');
});
