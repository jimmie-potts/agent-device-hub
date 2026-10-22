import assert from 'node:assert/strict';
import {request} from 'node:http';
import {test} from 'node:test';
import {createCoreModule} from '../src/index.js';
import {edgeConfig, run} from './support.js';

function probe(url: string, hostname: string, host: string): Promise<number> {
  const port = new URL(url).port;
  return new Promise((resolve, reject) => {
    const req = request({hostname, port, path: '/api/runtime/v1/health', headers: {host}, timeout: 3000}, response => {
      response.resume(); response.once('end', () => resolve(response.statusCode ?? 0));
    });
    req.once('error', reject); req.once('timeout', () => req.destroy(new Error('probe-timeout'))); req.end();
  });
}

void test('container socket opt-in preserves loopback origins and existing local browser authentication', {
  skip: process.platform !== 'linux', timeout: 20_000,
}, async context => {
  const files = await edgeConfig(context, [], {browserAccess: 'trusted-loopback'});
  const {runtime} = await run(context, {modules: [createCoreModule()], configFile: files.config,
    listener: 'container-host-local', edge: {schemas: {}}});
  const host = new URL(runtime.url).host;
  assert.equal(await probe(runtime.url, '127.0.0.2', host), 200, 'opted-in socket accepts another loopback address');
  assert.equal(await probe(runtime.url, '127.0.0.1', 'unwanted.invalid'), 403);
  assert.equal(await probe(runtime.url, '127.0.0.1', '0.0.0.0:' + new URL(runtime.url).port), 403);
  const endpoint = runtime.url + '/api/v2/browser/session';
  const headers = {'content-type': 'application/json', origin: runtime.url, 'bunny-request': '1'};
  const wrong = await fetch(endpoint, {method: 'POST', headers: {...headers, origin: 'https://unwanted.invalid'}, body: '{}'});
  assert.equal(wrong.status, 403); await wrong.arrayBuffer();
  const admitted = await fetch(endpoint, {method: 'POST', headers, body: '{}'});
  assert.equal(admitted.status, 200); await admitted.arrayBuffer();
  const cookie = admitted.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie !== undefined && cookie.length > 0, 'ordinary browser sign-in creates a session; its value is never logged');
  const read = await fetch(runtime.url + '/api/v2/families/session', {headers: {cookie}});
  assert.equal(read.status, 200); await read.arrayBuffer();
  assert.deepEqual(runtime.health().modules.map(module => module.name), ['core']);
  const {runtime: ordinary} = await run(context, {modules: [createCoreModule()]});
  await assert.rejects(probe(ordinary.url, '127.0.0.2', new URL(ordinary.url).host), 'default/native socket still binds only127.0.0.1');
  assert.equal(await probe(ordinary.url, '127.0.0.1', new URL(ordinary.url).host), 200);
});
