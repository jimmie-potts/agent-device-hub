import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {startHub} from '../../dist/server.js';
import {qualificationSnapshot} from '../qualification.mjs';

test('reset qualification reads the provider titles shown by the real preview', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'qr-'));
  let hub;
  t.after(async () => { await hub?.close(); await rm(directory, {recursive: true, force: true}); });
  const token = 'q'.repeat(43);
  hub = await startHub({directory, ownerId: 'qualification', consumers: [], controllers: [],
    credentials: [{id: 'operator', digest: createHash('sha256').update(token).digest('hex'), scopes: ['read', 'ingest'], devices: []}]});
  const headers = {authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-pixoo-request': '1'};
  const readJson = async route => {
    const response = await fetch(new URL(route, hub.url), {headers});
    assert.equal(response.status, 200);
    return response.json();
  };
  const baseline = await qualificationSnapshot(readJson);
  const response = await fetch(new URL('/api/monitor/v1/events', hub.url), {method: 'POST', headers, body: JSON.stringify({
    apiVersion: '1.1', identity: {provider: 'codex', client: 'cli', hostId: 'verify', sourceId: 'verify', sessionId: 'title-only'},
    turn: {status: 'unknown'}, parent: {status: 'top-level'}, ordering: {status: 'unknown'}, observedAtMs: Date.now(),
    title: {value: 'Qualification session', source: 'provider'}, event: {kind: 'session.started'},
  })});
  assert.equal(response.status, 200);
  const changed = await qualificationSnapshot(readJson);
  assert.ok(changed.revision > baseline.revision);
  assert.deepEqual(changed.sessions.map(s => s.label ?? s.title?.value).filter(Boolean), ['Qualification session']);
  assert.equal(changed.apiVersion, '1.2');
  // The driver must opt in without changing the compatibility route for old readers.
  const legacy = (await readJson('/api/monitor/v1/sessions')).snapshot;
  assert.equal(legacy.apiVersion, '1.0');
  assert.equal(legacy.sessions[0].title, undefined);
});
