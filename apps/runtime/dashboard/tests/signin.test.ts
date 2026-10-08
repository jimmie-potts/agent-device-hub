// The dashboard's five non-edge HTTP calls keep W3C context without changing browser authentication (Hub #922).
import assert from 'node:assert/strict';
import test from 'node:test';
import {traceFields} from '@jimmie-potts/sdk';
import {currentSession, launchSignIn, previewPlaces, signOut, trustedSignIn} from '../src/signin.ts';

void test('every sign-in and read call carries its own valid traceparent, with no bearer token or foreign context', async context => {
  const calls: {path: string; options: RequestInit; headers: Headers}[] = [];
  context.mock.method(globalThis, 'fetch', (input: string, options: RequestInit) => {
    calls.push({path: input, options, headers: new Headers(options.headers)});
    return Promise.resolve(Response.json({places: {}}));
  });
  assert.equal(await trustedSignIn(), 'signed-in');
  assert.equal(await launchSignIn('s'.repeat(43)), 'signed-in');
  await signOut();
  assert.equal(await currentSession(), 'live');
  assert.deepEqual(await previewPlaces(), {});
  assert.deepEqual(calls.map(call => call.path), [
    '/api/v2/browser/session', '/api/v2/browser/launch', '/api/v2/browser/logout', '/api/v2/authority?scope=read', '/api/v2/links',
  ]);
  const traces = calls.map(call => traceFields({traceparent: call.headers.get('traceparent') ?? ''}));
  assert.deepEqual(traces.map(trace => trace !== undefined), [true, true, true, true, true], 'all five calls carry W3C context');
  assert.equal(new Set(traces.map(trace => trace?.traceId)).size, 5, 'independent calls do not invent a shared parent');
  for (const {options, headers} of calls) {
    assert.deepEqual([options.cache, options.redirect, options.credentials], ['no-store', 'error', 'same-origin']);
    assert.equal(headers.get('authorization'), null, 'authentication remains the browser cookie');
    assert.equal(headers.get('tracestate'), null);
    assert.equal(headers.get('baggage'), null);
    if (options.method === 'POST') assert.equal(headers.get('bunny-request'), '1', 'the same-origin mutation guard remains');
  }
});
