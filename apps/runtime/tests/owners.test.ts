// Every device module serves `device/2.0` for its own devices (Hub #918, #967). The SDK keys sync ownership by source
// and family, so the runtime starts two modules that both serve `device`, and both run. A module or a remote part that
// copies the family syncs each owner by name, the source `bunny/modules/<name>` that health and the shipped list name,
// and gets only that owner's records. A sync that names no owner is refused with `invalid-request`.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {chmod, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {connectRemote, type BunnyModule, type Snapshot, type SyncedCopy} from '@jimmie-potts/sdk';
import {EDGE_GRANTS_FILE, type LogRecord} from '../src/index.js';
import {sourceOf} from '../src/host.js';
import {DEVICE_FAMILY, deviceRecord, deviceState} from './fixtures/device.js';
import {entry, fixture, it, run, stateDir, waitFor} from './support.js';

/** A device module that serves its own devices' records, as every device module serves `device`. */
const deviceModule = (name: string, devices: readonly string[]): BunnyModule => fixture(name, async ({sdk}) => {
  await sdk.serveSync([DEVICE_FAMILY], (): Snapshot => ({revision: 1, states: devices.map(id => deviceState(deviceRecord(id, 1, name, 'available')))}));
});

const ids = (copy: SyncedCopy<DeviceRecord> | undefined): string[] => (copy?.states() ?? []).map(state => `${state.source} ${state.data.id}`).sort();
const syncRecords = (logs: readonly LogRecord[], requestId: string): string[] => logs
  .filter(record => record.event_name.startsWith('runtime.sync.') && record.attributes['bunny.request.id'] === requestId)
  .map(record => `${record.event_name} ${record.severity_text} ${String(record.attributes['bunny.code'])}`);

it('two modules that both serve device run, and a module and a remote part sync each by name and get only its devices', async context => {
  const dir = await stateDir(context);
  const reader = {source: 'bunny/parts/reader', token: randomBytes(32).toString('base64url')};
  const grants = join(dir, EDGE_GRANTS_FILE);
  await writeFile(grants, JSON.stringify({schema: 'edge-grants/1.0', grants: [reader]}), {mode: 0o600});
  await chmod(grants, 0o600);

  // A display copies `device` from each device module it knows, by the module's source.
  const copies = new Map<string, SyncedCopy<DeviceRecord>>();
  const display = fixture('display', async ({sdk}) => {
    for (const owner of [sourceOf('bulbs'), sourceOf('panels')]) {
      const synced = await sdk.sync<DeviceRecord>([DEVICE_FAMILY], () => {}, {timeoutMs: 5000, owner});
      if (synced.status === 'rejected') throw new Error(`the display could not sync device from ${owner}: ${synced.error.error.code}`);
      copies.set(owner, synced.copy);
    }
  });
  const {runtime, logs} = await run(context, {
    modules: [deviceModule('bulbs', ['bulb-1', 'bulb-2']), deviceModule('panels', ['panel-1']), display], stateDir: dir, edge: {schemas: {}},
  });

  const report = runtime.health();
  assert.deepEqual(['bulbs', 'panels', 'display'].map(name => `${name} ${entry(report, name).state}`), ['bulbs running', 'panels running', 'display running']);
  assert.equal(report.status, 'ok');
  // Health names each module's served families, so a consumer learns the owners of device without asking every module.
  assert.deepEqual(['bulbs', 'panels', 'display'].map(name => entry(report, name).serves), [[DEVICE_FAMILY], [DEVICE_FAMILY], undefined]);
  const owners = report.modules.filter(module => module.serves?.includes(DEVICE_FAMILY) === true).map(module => sourceOf(module.name));
  assert.deepEqual(owners, ['bunny/modules/bulbs', 'bunny/modules/panels']);
  assert.deepEqual(ids(copies.get('bunny/modules/bulbs')), ['bunny/modules/bulbs bulb-1', 'bunny/modules/bulbs bulb-2']);
  assert.deepEqual(ids(copies.get('bunny/modules/panels')), ['bunny/modules/panels panel-1']);

  // A remote part, such as the dashboard, does the same through the runtime's edge.
  const remote = await connectRemote({url: runtime.url, source: reader.source, token: reader.token});
  context.after(() => remote.close());
  for (const [owner, expected] of [['bunny/modules/bulbs', ['bunny/modules/bulbs bulb-1', 'bunny/modules/bulbs bulb-2']], ['bunny/modules/panels', ['bunny/modules/panels panel-1']]] as const) {
    const synced = await remote.sync<DeviceRecord>([DEVICE_FAMILY], () => {}, {timeoutMs: 5000, owner});
    assert.equal(synced.status, 'synced', owner);
    if (synced.status !== 'synced') return;
    assert.deepEqual(ids(synced.copy), expected, owner);
    await synced.copy.close();
  }
  const unnamed = await remote.sync([DEVICE_FAMILY], () => {}, {timeoutMs: 5000});
  assert.equal(unnamed.status, 'rejected');
  if (unnamed.status !== 'rejected') return;
  assert.equal(unnamed.error.error.code, 'invalid-request', 'a sync that names no owner is refused while two serve device');
  await waitFor(() => syncRecords(logs, unnamed.requestId).length > 0, 5000, 'the refusal\'s record');
  assert.deepEqual(syncRecords(logs, unnamed.requestId), ['runtime.sync.refused INFO invalid-request'], 'the runtime recorded it once');
  assert.deepEqual(['bulbs', 'panels', 'display'].map(name => entry(runtime.health(), name).state), ['running', 'running', 'running']);
});
