// one-shot generic browser action transport for Hub #1006.
import assert from 'node:assert/strict';
import test from 'node:test';
import {traceFields} from '@jimmie-potts/sdk';
import {sendAction} from '../src/actions.ts';

const action = {family: 'session-label-set', target: 'a'.repeat(64), data: {label: 'Review', expectedRevision: 4}, requestId: 'label-attempt-1'};
const accepted = {schema: 'command-reply/2.0', status: 'accepted', requestId: action.requestId};

void test('one explicit action sends once with browser authentication and its own trace', async context => {
  const calls: {path: string; options: RequestInit}[] = [];
  context.mock.method(globalThis, 'fetch', (path: string, options: RequestInit) => {
    calls.push({path, options});
    return Promise.resolve(Response.json(accepted));
  });
  assert.deepEqual(await sendAction(action), {status: 'accepted', requestId: action.requestId});
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.ok(call);
  assert.equal(call.path, '/api/v2/commands/session-label-set');
  assert.deepEqual(JSON.parse(call.options.body as string), {target: action.target, data: action.data, requestId: action.requestId});
  assert.deepEqual([call.options.method, call.options.credentials, call.options.cache, call.options.redirect], ['POST', 'same-origin', 'no-store', 'error']);
  const headers = new Headers(call.options.headers);
  assert.equal(headers.get('bunny-request'), '1');
  assert.equal(headers.get('authorization'), null);
  assert.notEqual(traceFields({traceparent: headers.get('traceparent') ?? ''}), undefined);
});

void test('a typed refusal retains the shared code and request identity without retry', async context => {
  const refusal = {error: {code: 'revision-conflict', retryable: false, requestId: action.requestId, detail: 'the session changed'}};
  const fetch = context.mock.method(globalThis, 'fetch', () => Promise.resolve(Response.json(refusal, {status: 409})));
  assert.deepEqual(await sendAction(action), refusal);
  assert.equal(fetch.mock.callCount(), 1);
});

void test('network loss, non-JSON and mismatched or malformed replies are uncertain and never resend', async context => {
  for (const body of [
    {...accepted, requestId: 'another-request'}, {...accepted, extra: true}, {status: 'accepted'},
    {error: {code: 'revision-conflict', retryable: true}},
    {error: {code: 'invented-code', retryable: false}},
    {error: {code: 'revision-conflict', retryable: false, requestId: 'another-request'}},
  ]) {
    const fetch = context.mock.method(globalThis, 'fetch', () => Promise.resolve(Response.json(body)));
    const result = await sendAction(action);
    assert.equal('error' in result && result.error.code, 'uncertain-result');
    assert.equal(fetch.mock.callCount(), 1);
    fetch.mock.restore();
  }
  for (const respond of [
    () => Promise.reject(new Error('synthetic network loss')),
    () => Promise.resolve(new Response('not JSON')),
  ]) {
    const fetch = context.mock.method(globalThis, 'fetch', respond);
    const result = await sendAction(action);
    assert.equal('error' in result && result.error.code, 'uncertain-result');
    assert.equal(fetch.mock.callCount(), 1);
    fetch.mock.restore();
  }
});

void test('the helper keeps another tracked family generic, without label or device lifecycle policy', async context => {
  const generic = {...action, family: 'device-command', target: 'sim-device', data: {operation: 'power', value: 'on'}};
  const calls: {path: string; body: unknown}[] = [];
  context.mock.method(globalThis, 'fetch', (path: string, options: RequestInit) => {
    calls.push({path, body: JSON.parse(options.body as string)});
    return Promise.resolve(Response.json(accepted));
  });
  assert.deepEqual(await sendAction(generic), {status: 'accepted', requestId: generic.requestId});
  assert.deepEqual(calls, [{path: '/api/v2/commands/device-command', body: {target: generic.target, data: generic.data, requestId: generic.requestId}}]);
});
