import assert from 'node:assert/strict';
import {connectRemote} from '@jimmie-potts/sdk';
import {FAMILY, SOURCE, createPresenceModule, presenceSchemas, type PresenceObservation} from '@jimmie-potts/presence-pro';
import {SimulatedPresence, SYNTHETIC_SECTION} from '@jimmie-potts/presence-pro/testing';
import {createCoreModule} from './fixtures/core.js';
import {edgeConfig, it, run, waitFor} from './support.js';

it('Presence Pro disposable runtime exposes authenticated state, SDK sync and private core history, preserving disconnect gaps', async context => {
  const reader = {source: 'bunny/parts/presence-reader', token: 'synthetic-presence-reader-token-1841', scopes: ['read'] as const};
  const files = await edgeConfig(context, [reader], {modules: {'presence-pro': SYNTHETIC_SECTION}});
  const device = new SimulatedPresence();
  const {runtime, logs} = await run(context, {modules: [createCoreModule(), createPresenceModule({native: device.native})], configFile: files.config, edge: {schemas: presenceSchemas}});
  const read = async (path: string, authorized = true) => fetch(new URL(path, runtime.url), {headers: authorized ? {authorization: `Bearer ${reader.token}`} : {}});
  assert.equal((await read(`/api/v2/families/${FAMILY}`, false)).status, 401);
  const states = async (): Promise<PresenceObservation[]> => {
    const response = await read(`/api/v2/families/${FAMILY}`); assert.equal(response.status, 200);
    return (await response.json() as {records: PresenceObservation[]}).records;
  };
  await waitFor(async () => (await states()).every(state => state.connection === 'connected') && (await states()).length === 2);
  assert.deepEqual((await states()).map(state => state.id).sort(), ['presence-a', 'presence-b']);
  assert.ok((await states()).every(state => state.occupancy.value === 'occupied'));
  const modules = await (await read('/api/v2/modules')).json() as {modules: {name: string; serves: string[]}[]};
  assert.deepEqual(modules.modules.find(module => module.name === 'presence-pro')?.serves, [FAMILY]);
  const remote = await connectRemote({url: runtime.url, source: reader.source, token: reader.token}); context.after(() => remote.close());
  const synced = await remote.sync<PresenceObservation>([FAMILY], () => {}, {timeoutMs: 2000});
  assert.equal(synced.status, 'synced'); if (synced.status === 'synced') { assert.equal(synced.copy.states().length, 2); await synced.copy.close(); }
  device.act({device: 'presence-pro', action: 'offline', id: 'presence-a'});
  await waitFor(async () => (await states()).find(state => state.id === 'presence-a')?.connection === 'disconnected');
  const disconnected = (await states()).find(state => state.id === 'presence-a'); assert.equal(disconnected?.occupancy.value, 'unknown');
  assert.equal((await states()).find(state => state.id === 'presence-b')?.occupancy.value, 'occupied');
  await waitFor(async () => {
    const response = await read(`/api/v2/history?source=${encodeURIComponent(SOURCE)}`); assert.equal(response.status, 200);
    const page = await response.json() as {rows: {record: {changed?: {connection?: string; occupancy?: {value: string}}}}[]};
    return page.rows.some(row => row.record.changed?.connection === 'disconnected' && row.record.changed.occupancy?.value === 'unknown');
  });
  await remote.close(); await runtime.stop();
  assert.ok(!JSON.stringify(logs).includes(reader.token));
});
