// Filtered exception fields (ADR 0012 "Safe errors", amended 2026-10-30; Hub #777): the one reader of an exception's
// message and stack keeps the context a diagnosis needs, replaces every credential-like or payload-like segment,
// bounds both texts and reads nothing a value supplies through a getter of its own.
import assert from 'node:assert/strict';
import {validateRecord} from '@jimmie-potts/bunny-observability';
import {MAX_EXCEPTION_MESSAGE, MAX_EXCEPTION_STACKTRACE, OMITTED, REDACTED, exceptionFields, filterExceptionText} from '../src/index.js';
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

it('a bound or caller-installed stack accessor is not V8\'s and never runs, while V8\'s own is read', () => {
  let ran = 0;
  const bound = new Error('bound');
  const getter = (): string => { ran += 1; return SECRET; };
  Object.defineProperty(bound, 'stack', {get: getter.bind(null)});
  assert.equal(exceptionFields(bound)['exception.stacktrace'], undefined, 'a bound function prints as native code but is not V8\'s accessor');
  assert.equal(ran, 0);
  const captured = {name: 'Captured'} as {name: string; stack?: string};
  Error.captureStackTrace(captured);
  const typed = new TypeError('typed');
  const accessor = (error: Error): unknown => (Object.getOwnPropertyDescriptor(error, 'stack') as {readonly get?: unknown} | undefined)?.get;
  assert.equal(accessor(typed), accessor(new RangeError('other')), 'V8 shares one accessor');
  assert.match(String(exceptionFields(typed)['exception.stacktrace']), /^TypeError: typed\n/);
});

it('credential-named members in colon, quoted and single-quoted forms are replaced, and a multi-line body or prompt is omitted', () => {
  const message = ['token: s3cr3tValue99 expired', 'secret: yaml-secret-value-1', 'token="quoted-secret-9"', "{'password':'hunter3'}",
    'Authorization: Digest username="alice", realm="x", response="abc123def456abc"'].join('; ');
  const kept = String(exceptionFields(new Error(message))['exception.message']);
  for (const canary of ['s3cr3tValue99', 'yaml-secret-value-1', 'quoted-secret-9', 'hunter3', 'abc123def456abc']) assert.equal(kept.includes(canary), false, canary);
  assert.ok(kept.includes('realm="x"'), 'a non-credential member stays');
  const body = JSON.stringify({prompt: 'remind me about the dentist and what I said about my sister yesterday'.repeat(2), password: 'hunter2', transcript: 'we talked about health and finances'}, null, 2);
  const multi = String(exceptionFields(new SyntaxError(`bad body ${body} at line 3`))['exception.message']);
  assert.equal(multi.includes('dentist'), false, 'a pretty-printed body is omitted whole');
  assert.equal(multi.includes('finances'), false);
  assert.ok(multi.startsWith(`bad body ${OMITTED} at line 3`), multi);
  const quoted = String(exceptionFields(new Error(`bad prompt "${'line one of a long prompt about the dentist\n'.repeat(4)}" refused`))['exception.message']);
  assert.equal(quoted.includes('dentist'), false, 'a quoted prompt across lines is omitted');
  const stack = String(exceptionFields(new Error('frames stay'))['exception.stacktrace']);
  assert.ok(stack.split('\n').length > 3 && !stack.includes(OMITTED), 'a stack of frames is never a block');
});

it('costs time in proportion to a bounded prefix, whatever the message\'s size, and never reads a proxy', () => {
  for (const hostile of ['a+'.repeat(512 * 1024), '{"'.repeat(256 * 1024), 'ab='.repeat(256 * 1024), '"'.repeat(512 * 1024), '{'.repeat(512 * 1024)]) {
    const started = performance.now();
    const fields = exceptionFields(new Error(hostile));
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 250, `a ${hostile.length}-character message took ${elapsed.toFixed(0)} ms`);
    assert.ok(String(fields['exception.message']).length <= MAX_EXCEPTION_MESSAGE);
    assert.equal(fields['bunny.exception.truncated'], true);
  }
  let trapped = 0;
  const proxied = new Proxy(new Error(SECRET), {getPrototypeOf(target) { trapped += 1; return Object.getPrototypeOf(target) as object; },
    getOwnPropertyDescriptor(target, key) { trapped += 1; return Object.getOwnPropertyDescriptor(target, key); }});
  assert.deepEqual(exceptionFields(proxied), {});
  assert.equal(trapped, 0, 'a proxy is refused before any trap runs');
});

it('bounds the serialized form, so a text of quotes and backslashes still fits the record', () => {
  const fields = exceptionFields(new Error('"\\'.repeat(2000)));
  const message = String(fields['exception.message']);
  assert.ok(message.length <= MAX_EXCEPTION_MESSAGE);
  assert.ok(Buffer.byteLength(JSON.stringify(message)) - 2 <= MAX_EXCEPTION_MESSAGE, 'escaped bytes within the limit');
  assert.ok(Buffer.byteLength(JSON.stringify(String(fields['exception.stacktrace']))) - 2 <= MAX_EXCEPTION_STACKTRACE);
  assert.equal(fields['bunny.exception.truncated'], true);
  const cookie = String(exceptionFields(new Error('refused; cookie: session=abc123; csrftoken=xyz789\nnext line'))['exception.message']);
  assert.equal(cookie.includes('abc123') || cookie.includes('xyz789'), false, 'every cookie pair goes');
  assert.ok(cookie.endsWith('\nnext line'), 'the next line stays');
  const escaped = String(exceptionFields(new Error(`body {\\"name\\":\\"${'x'.repeat(120)}\\",\\"diagnosis\\":\\"synthetic-private-condition\\"} rejected`))['exception.message']);
  assert.equal(escaped.includes('synthetic-private-condition'), false, 'an escaped body is still a block');
  const path = String(exceptionFields(new Error(`Cannot find module '/opt/bunny/releases/${'a'.repeat(140)}/x.js'`))['exception.message']);
  assert.ok(path.includes(OMITTED), 'a very long quoted path is omitted, a documented limit');
});

it('is idempotent: filtering a filtered text again changes nothing and counts nothing', () => {
  const once = exceptionFields(new Error(`GET http://192.0.2.7/api?token=secret-token refused for Bearer ${SECRET}; "${'p'.repeat(200)}"`));
  const again = filterExceptionText(String(once['exception.message']), MAX_EXCEPTION_MESSAGE);
  assert.equal(again.text, once['exception.message']);
  assert.equal(again.replaced, 0);
  assert.equal(again.truncated, false);
});

it('replaces a value that follows an earlier marker, and omits an unclosed payload to the end of the text', () => {
  const marker = String(exceptionFields(new Error(`password=${REDACTED}hunter2 wrong; Authorization: Bearer ${REDACTED}abcdefgh12345678; token: ${OMITTED}quoted-secret-9`))['exception.message']);
  for (const canary of ['hunter2', 'abcdefgh12345678', 'quoted-secret-9']) assert.equal(marker.includes(canary), false, canary);
  const prompt = `bad prompt "${'remind me about the dentist and my sister. '.repeat(120)}`;
  const quoted = String(exceptionFields(new Error(prompt))['exception.message']);
  assert.equal(quoted.includes('dentist'), false, 'an unclosed quoted prompt beyond the window is omitted to the end');
  assert.ok(quoted.startsWith(`bad prompt ${OMITTED}`), quoted);
  const transcript = `bad body [${Array.from({length: 60}, (_, index) => `{"role":"user","content":"turn ${index}: the dentist and my sister and my finances"}`).join(',')}]`;
  const list = String(exceptionFields(new Error(transcript))['exception.message']);
  assert.equal(list.includes('finances'), false, 'a transcript longer than the window is omitted whole');
  assert.equal(exceptionFields(new Error('an unexpected token { was found in "value" near [0]'))['exception.message'], 'an unexpected token { was found in "value" near [0]', 'short unclosed shapes stay');
});

it('keeps library prose that names a key, response or signature, and a contraction opens no string', () => {
  const kept = String(exceptionFields(new Error(`unexpected server response: 502; invalid key: brightness; auth: failed; signature: mismatch for frame 3; couldn't reach the panel at 10.0.0.5 after 3 attempts, ${'so the operation stops here and the controller keeps its last state; '.repeat(3)}key=AbCdEf123456 sig="a1b2c3d4e5f6" response="abc123def456"`))['exception.message']);
  for (const text of ['response: 502', 'key: brightness', 'auth: failed', 'signature: mismatch', 'couldn\'t reach', 'last state']) assert.ok(kept.includes(text), text);
  for (const canary of ['AbCdEf123456', 'a1b2c3d4e5f6', 'abc123def456']) assert.equal(kept.includes(canary), false, canary);
  const scrubbed = filterExceptionText(`${'x'.repeat(4090)}REGISTERED-SECRET-VALUE tail`, 1024, {filter: text => ({text: text.replaceAll('REGISTERED-SECRET-VALUE', REDACTED), replaced: 1})});
  assert.equal(scrubbed.replaced, 1, 'a secret that straddles the prefix is replaced before the prefix is read');
  assert.equal(scrubbed.truncated, true);
});

it('a lone quote or bracket in the message keeps every stack frame, and an inspected object is a block', () => {
  for (const message of ['Unexpected token " in JSON at position 0', 'Unexpected token \' in JSON at position 3', 'Expected " but found }', 'Unterminated string in JSON: "abc', 'Unterminated JSON: {"abc', 'Unexpected token \'}\', "{"a":1,}" is not valid JSON']) {
    const error = new Error(message);
    const frames = String(error.stack).split('\n').filter(line => line.startsWith('    at ')).length;
    const fields = exceptionFields(error);
    const kept = String(fields['exception.stacktrace']).split('\n').filter(line => line.startsWith('    at ')).length;
    assert.equal(kept, frames, `${message}: ${String(fields['exception.stacktrace'])}`);
    assert.ok(String(fields['exception.message']).startsWith(message.slice(0, 16)), message);
  }
  const quotedThenFrame = new Error(`panel "${'remind me about the dentist. '.repeat(6)}`);
  quotedThenFrame.stack = `Error: ${quotedThenFrame.message}\n    at Object.<anonymous> (/Users/x's Mac/mods/y.js:1:1)\n    at run (/mods/z.js:2:2)`;
  const stack = String(exceptionFields(quotedThenFrame)['exception.stacktrace']);
  assert.equal(stack.includes('dentist'), false, 'the unclosed prompt is omitted');
  assert.ok(stack.endsWith('\n    at Object.<anonymous> (/Users/x\'s Mac/mods/y.js:1:1)\n    at run (/mods/z.js:2:2)'), stack);
  const inspected = String(exceptionFields(new Error(`bad { prompt: "${'remind me about the dentist and my sister tomorrow. '.repeat(2)}", password: "hunter2", transcript: "my finances are private" } rejected`))['exception.message']);
  assert.equal(inspected, `bad ${OMITTED} rejected`, 'an inspected object of payload length goes whole');
  const split = filterExceptionText('said REGISTERED​-SECRET ok', 1024, {filter: text => ({text: text.replaceAll('REGISTERED-SECRET', REDACTED), replaced: 1})});
  assert.equal(split.text, `said ${REDACTED} ok`, 'a secret split by a format character is whole for the filter');
});

it('a frame-like line inside a payload is the payload\'s, in a message and in a stack\'s header', () => {
  const body = `{"prompt":"remind me about the dentist","detail":"Error: inner\n    at inner (/opt/x.js:1:1)\n    at outer (/opt/y.js:2:2)","transcript":"my finances are private","password":"hunter2"}`;
  const error = new Error(`bad body ${body}`);
  const fields = exceptionFields(error);
  assert.equal(fields['exception.message'], `bad body ${OMITTED}`, 'the message has no frame bound');
  const stack = String(fields['exception.stacktrace']);
  // The raw stack's frame lines include the body's two embedded ones; the filtered stack keeps the real frames only.
  const frames = String(error.stack).split('\n').filter(line => line.startsWith('    at ')).length - 2;
  assert.ok(stack.startsWith(`Error: bad body ${OMITTED}\n    at `), stack);
  assert.equal(stack.split('\n').filter(line => line.startsWith('    at ')).length, frames, 'the real frames stay');
  for (const canary of ['finances', 'dentist', 'hunter2', 'inner (/opt']) assert.equal(stack.includes(canary), false, canary);
  const transcript = `bad [${['{"role":"user","content":"code:\n    at foo()\nmore about the dentist and my sister"}', '{"role":"user","content":"my finances are private and so is my sister"}'].join(',')}]`;
  assert.equal(exceptionFields(new Error(transcript))['exception.message'], `bad ${OMITTED}`);
  const inspected = `bad { prompt: 'remind me about the dentist and my sister for the week',\n  stack: 'Error: x\n    at f (/x.js:1:1)',\n  transcript: 'my finances are private and my sister' }`;
  assert.equal(exceptionFields(new Error(inspected))['exception.message'], `bad ${OMITTED}`);
  assert.equal(exceptionFields(new Error(`bad "\n    at ${'remind me about the dentist. '.repeat(8)}"`))['exception.message'], `bad ${OMITTED}`);
  const custom = new Error('plain');
  custom.stack = `Custom\n    at one (/a.js:1:1)\n    at two ("${'remind me about the dentist. '.repeat(6)}")\n    at three (/c.js:3:3)`;
  const kept = String(exceptionFields(custom)['exception.stacktrace']);
  assert.equal(kept, `Custom\n    at one (/a.js:1:1)\n    at two (${OMITTED})\n    at three (/c.js:3:3)`, 'a payload in a frame ends with that frame');
});
