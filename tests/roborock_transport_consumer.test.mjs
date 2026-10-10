import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import * as transport from '@jimmie-potts/roborock-transport';
import {mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
void test('the fresh built runtime registry resolves every registration alongside the transport package', async () => {
  const {REGISTRATIONS} = await import('../apps/runtime/dist/src/registry.js');
  assert.ok(REGISTRATIONS.length > 0);
  for (const entry of REGISTRATIONS) {
    assert.equal(typeof entry.name, 'string');
    assert.equal(typeof entry.create, 'function');
    assert.equal(typeof entry.simulate, 'function');
  }
});
void test('built consumer sees only the narrow inert transport and private loaders', async () => {
  assert.deepEqual(Object.keys(transport).sort(), ['createReadTransport', 'loadPrivateConfig', 'loadPrivateSession']);
  const config = {schemaVersion: 1, deviceId: 'synthetic-robot', address: '127.0.0.1', broker: 'mqtts://mqtt-us.roborock.com:8883', region: 'us'};
  const session = {schemaVersion: 1, deviceId: config.deviceId, model: 'roborock.vacuum.a97', protocol: '1.0', localKey: '0123456789abcdef', rriot: {u: 'synthetic-user', s: 'sentinel-auth-secret', k: 'sentinel-auth-key'}, broker: config.broker};
  const reader = transport.createReadTransport(config, session); reader.stop();
  const result = await reader.readStatus(); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.error.code, 'cancelled');
  assert.throws(() => transport.createReadTransport({...config, address: 'public.example.invalid'}, session));
});
void test('direct and MQTT packet diagnostics resolve the exact same debug module', () => {
  const moduleRequire = createRequire(import.meta.resolve('@jimmie-potts/roborock-transport'));
  const mqttRequire = createRequire(moduleRequire.resolve('mqtt'));
  const packetRequire = createRequire(mqttRequire.resolve('mqtt-packet'));
  assert.equal(moduleRequire.resolve('debug'), mqttRequire.resolve('debug')); assert.equal(moduleRequire.resolve('debug'), packetRequire.resolve('debug'));
});

// A small, short-lived external consumer: resolves the built exports rather than module-internal files.
test('external TypeScript consumer compiles every typed read and registry failure branch', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'roborock-consumer-'));
  try {
    const root = join(import.meta.dirname, '..');
    await symlink(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir');
    const file = join(dir, 'consumer.mts');
    await writeFile(file, `
import {createReadTransport, type Config, type Session, type Reading, type VendorJson} from '@jimmie-potts/roborock-transport';
export async function read(config: Config, session: Session) {
  const owner = createReadTransport(config, session);
  const reads: Reading<VendorJson>[] = await Promise.all([owner.readStatus(), owner.readConsumables(), owner.readCleanSummary(), owner.readCleanRecord(1700000000), owner.readRoomMapping()]);
  const map: Reading<Buffer> = await owner.readCurrentMap({timeoutMs: 10000, signal: new AbortController().signal});
  const code: string | undefined = map.ok ? undefined : map.error.error.code;
  owner.stop(); return {reads, map, code};
}
`);
    const result = spawnSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--strict', '--noUncheckedIndexedAccess', '--exactOptionalPropertyTypes', '--noEmit', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', file], {encoding: 'utf8'});
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally {await rm(dir, {recursive: true, force: true});}
});
