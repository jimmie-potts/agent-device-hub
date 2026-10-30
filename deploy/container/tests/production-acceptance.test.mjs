// Explicit disposable-container exercise. It never accepts a production target or host credential.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {lstat, mkdtemp, readdir, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import os, {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkConfiguration} from '../../../packages/sdk/dist/src/index.js';
import * as runtimeModules from '../../../apps/runtime/dist/src/modules.js';
import {holdRuntimeLease} from '../../../apps/runtime/dist/src/lease.js';
import {startRuntime} from '../../../apps/runtime/dist/src/runtime.js';
import {simulatedSections} from '../../../apps/runtime/dist/tests/fixtures/simulated.js';
import {containerOptions, productionModules} from '../entrypoint.mjs';

test('production profile starts configured household modules on fresh state with simulated transports', {
  skip: process.env.BUNNY_CONTAINER_ACCEPTANCE !== '1', timeout: 60_000,
}, async t => {
  assert.equal(process.platform, 'linux');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bunny-production-')));
  const secretsRoot = await mkdtemp('/run/secrets/bunny/production-');
  t.after(async () => {
    await rm(root, {recursive: true, force: true});
    await rm(secretsRoot, {recursive: true, force: true});
  });
  const names = ['playback', 'lifx', 'tidbyt', 'pixoo', 'nanoleaf', 'onn', 'roborock', 'wemo', 'companions', 'codex-desktop'];
  const selected = runtimeModules.shippedModules.filter(({name}) => name === 'core' || names.includes(name));
  assert.equal(selected.length, names.length + 1, 'every selected module ships');
  const modules = await simulatedSections(secretsRoot, selected);
  modules.companions = {};
  modules['codex-desktop'] = {sources: [{hostId: 'synthetic-pc', sourceId: 'codex-desktop'}]};
  const config = {modules, edge: {credentials: '/run/secrets/bunny/edge.json', browserAccess: 'trusted-loopback',
    launcher: false, mcp: false, privateProxy: {origin: 'https://synthetic.ts.net', tokenDigest: '1'.repeat(64)}}};
  // Only the existing test factories are substituted. No simulation switch is exposed by the production entrypoint.
  const factories = selected.map(factory => ({...factory, create: () => factory.simulate()}));
  const prepared = productionModules(config, {...runtimeModules, shippedModules: factories}, checkConfiguration,
    containerOptions({BUNNY_ACCESS: 'production', BUNNY_CONTROL: 'enabled'}));
  const runtime = await startRuntime({modules: prepared.modules, stateDir: join(root, 'state'), port: 0, config,
    simulate: true, log: () => {}});
  try {
    const health = runtime.health();
    assert.equal(health.status, 'ok', JSON.stringify(health));
    assert.deepEqual(health.modules.map(({name}) => name), prepared.factories.map(({name}) => name));
    assert.ok(health.modules.every(({state}) => state === 'running'));
    console.log(JSON.stringify({profile: 'production', control: 'enabled', transports: 'simulated',
      freshState: true, modules: health.modules.map(({name, state}) => ({name, state}))}));
  } finally {await runtime.stop();}

  // Shipped real modules with no configured dependency retain their ordinary refusal instead of being labelled healthy.
  const unavailable = productionModules({modules: {onn: {}, roborock: {}}, edge: config.edge},
    runtimeModules, checkConfiguration, containerOptions({BUNNY_ACCESS: 'production', BUNNY_CONTROL: 'enabled'}));
  const refused = await startRuntime({modules: unavailable.modules, stateDir: join(root, 'unavailable'), port: 0,
    config: {modules: {onn: {}, roborock: {}}, edge: config.edge}, log: () => {}});
  try {
    assert.equal(refused.health().status, 'degraded');
    assert.deepEqual(refused.health().modules.map(({name, state}) => [name, state]),
      [['core', 'running'], ['onn', 'refused'], ['roborock', 'refused']]);
  } finally {await refused.stop();}
});

// The household device modules the fresh-state cutover selects (#568). The record below covers each, in shipped order.
const DEVICE_MODULES = ['playback', 'lifx', 'tidbyt', 'pixoo', 'nanoleaf', 'onn', 'roborock', 'wemo'];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const octal = info => (info.mode & 0o777).toString(8);
async function statOf(path) {
  try {return await lstat(path);} catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Each module's store, log and private folder under `<stateDir>/modules`, as the runtime leaves them. */
async function storeInventory(stateDir, names) {
  const dir = join(stateDir, 'modules');
  const entries = {};
  for (const name of names) {
    const [store, wal, shm, folder] = await Promise.all(['.sqlite', '.sqlite-wal', '.sqlite-shm', ''].map(suffix => statOf(join(dir, name + suffix))));
    entries[name] = {
      store: store === undefined ? undefined : {mode: octal(store), uid: store.uid, ino: store.ino, regular: store.isFile(), links: store.nlink},
      wal: wal !== undefined, shm: shm !== undefined,
      folder: folder === undefined ? undefined : {mode: octal(folder), uid: folder.uid, directory: folder.isDirectory()},
    };
  }
  return entries;
}

/** The outcome of a start that must not succeed: the refusal's code, or `started` after stopping what did start. */
const outcomeOf = (starting, stop) => starting.then(runtime => stop(runtime).then(() => 'started'), error => `refused:${error.code ?? error.name}`);

const built = relative => new URL(relative, import.meta.url).href;
/** Runs an ES module source in a child Node process with `args` and returns its last stdout line, or how it ended. */
function childLine(source, args, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source, '--', ...args], {stdio: ['ignore', 'pipe', 'pipe']});
    let output = '';
    child.stdout.on('data', bytes => {output += bytes;});
    child.stderr.on('data', () => {});
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.once('error', reject);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      const lines = output.trim().split('\n');
      resolve(code === 0 ? lines[lines.length - 1] : `exited:${signal ?? code}`);
    });
  });
}
/** Another process takes the runtime's lease on argv[1] and prints `taken` or `refused:<code>`. */
const LEASE_PROBE = `import {holdRuntimeLease} from ${JSON.stringify(built('../../../apps/runtime/dist/src/lease.js'))};
try {const lease = await holdRuntimeLease(process.argv[1]); lease.release(); console.log('taken');}
catch (error) {console.log('refused:' + (error.code ?? error.name));}`;
/** Another process starts the same production selection, simulated, on argv[1] from the configuration file argv[2] and the
 * module names argv[3], then prints its outcome and each module's state as JSON. */
const SECOND_RUNTIME_PROBE = `import {readFile} from 'node:fs/promises';
import {checkConfiguration} from ${JSON.stringify(built('../../../packages/sdk/dist/src/index.js'))};
import * as runtimeModules from ${JSON.stringify(built('../../../apps/runtime/dist/src/modules.js'))};
import {startRuntime} from ${JSON.stringify(built('../../../apps/runtime/dist/src/runtime.js'))};
import {containerOptions, productionModules} from ${JSON.stringify(built('../entrypoint.mjs'))};
const [stateDir, configFile, namesJson] = process.argv.slice(1);
const config = JSON.parse(await readFile(configFile, 'utf8'));
const names = JSON.parse(namesJson);
const selected = runtimeModules.shippedModules.filter(({name}) => name === 'core' || names.includes(name));
const factories = selected.map(factory => ({...factory, create: () => factory.simulate()}));
const modules = productionModules(config, {...runtimeModules, shippedModules: factories}, checkConfiguration,
  containerOptions({BUNNY_ACCESS: 'production', BUNNY_CONTROL: 'enabled'})).modules;
let coreFailed = false;
try {
  const runtime = await startRuntime({modules, stateDir, port: 0, config, simulate: true, startTimeoutMs: 5000, log: () => {}, onCoreFailure: () => {coreFailed = true;}});
  const states = Object.fromEntries(runtime.health().modules.map(({name, state, reason}) => [name, reason === undefined ? state : state + ':' + reason.code]));
  await runtime.stop();
  console.log(JSON.stringify({outcome: states.core === 'running' ? 'started' : 'core-' + states.core, modules: states, coreFailed}));
} catch (error) {console.log(JSON.stringify({outcome: 'refused:' + (error.code ?? error.name), modules: {}, coreFailed}));}`;

// The per-module qualification record a Mac release needs before #568 activates a module (#565): the platform the image
// runs on, its compiled dependencies, and each selected module's fresh-state startup, private store, exclusive startup,
// port-conflict refusal, graceful stop and reopen on the same stores, all with simulated transports and no host input.
// Native versus emulated execution is the operator's comparison of the recorded `arch` with the engine's architecture.
test('production modules qualify on this host: platform, native dependencies, private stores, exclusive startup, stop and reopen', {
  skip: process.env.BUNNY_CONTAINER_ACCEPTANCE !== '1', timeout: 120_000,
}, async t => {
  assert.equal(process.platform, 'linux');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bunny-qualification-')));
  const secretsRoot = await mkdtemp('/run/secrets/bunny/qualification-');
  const blockers = new Set();
  const running = new Set();
  t.after(async () => {
    for (const server of blockers) server.close();
    // A failed assertion leaves nothing running: every runtime this test started and did not stop is stopped here.
    for (const runtime of running) await runtime.stop().catch(() => {});
    await rm(root, {recursive: true, force: true});
    await rm(secretsRoot, {recursive: true, force: true});
  });
  const uid = process.getuid();
  const names = [...DEVICE_MODULES, 'companions', 'codex-desktop'];
  const selected = runtimeModules.shippedModules.filter(({name}) => name === 'core' || names.includes(name));
  assert.equal(selected.length, names.length + 1, 'every selected module ships');
  // The shipped order, which the production selector keeps and health reports.
  const everyName = selected.map(({name}) => name);
  const options = containerOptions({BUNNY_ACCESS: 'production', BUNNY_CONTROL: 'enabled'});
  const edge = {credentials: '/run/secrets/bunny/edge.json', browserAccess: 'trusted-loopback', launcher: false, mcp: false,
    privateProxy: {origin: 'https://synthetic.ts.net', tokenDigest: '1'.repeat(64)}};
  const modules = await simulatedSections(secretsRoot, selected);
  modules.companions = {};
  modules['codex-desktop'] = {sources: [{hostId: 'synthetic-pc', sourceId: 'codex-desktop'}]};
  const config = {modules, edge};
  // Each start builds its modules again from the test factories: a module instance serves one runtime.
  const simulated = () => productionModules(config, {...runtimeModules, shippedModules: selected.map(factory => ({...factory, create: () => factory.simulate()}))},
    checkConfiguration, options).modules;
  const start = async (stateDir, extra = {}) => {
    const runtime = await startRuntime({modules: simulated(), stateDir, port: 0, config, simulate: true, log: () => {}, ...extra});
    running.add(runtime);
    return runtime;
  };
  const stop = async runtime => {
    running.delete(runtime);
    await runtime.stop();
  };
  const states = runtime => Object.fromEntries(runtime.health().modules.map(({name, state, reason}) => [name, reason === undefined ? state : `${state}:${reason.code}`]));

  const platform = {arch: process.arch, machine: os.machine(), kernel: os.release(), node: process.versions.node, sqlite: process.versions.sqlite, v8: process.versions.v8};
  assert.match(platform.sqlite ?? '', /^\d+\.\d+\.\d+$/, 'node:sqlite reports its library version');

  // sharp, which Pixoo, playback and Tidbyt depend on, is the one compiled dependency a selected module needs. It must load
  // and render here, from the package built for this platform. Every other compiled package in the image is listed, so a
  // consumer sees nothing is hidden.
  const {default: sharp} = await import('sharp');
  const png = await sharp({create: {width: 2, height: 2, channels: 3, background: {r: 1, g: 2, b: 3}}}).png().toBuffer();
  assert.deepEqual([...png.subarray(0, 8)], PNG_SIGNATURE);
  const nodeModules = fileURLToPath(new URL('../../../node_modules/', import.meta.url));
  const compiled = new Set();
  for (const entry of await readdir(nodeModules, {recursive: true, withFileTypes: true})) {
    if (!entry.isFile() || !entry.name.endsWith('.node')) continue;
    const parts = join(entry.parentPath, entry.name).slice(nodeModules.length).split('/');
    compiled.add(parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]);
  }
  const native = {
    sharp: JSON.parse(await readFile(join(nodeModules, 'sharp', 'package.json'), 'utf8')).version, libvips: sharp.versions.vips,
    platformPackage: `@img/sharp-${process.platform}-${process.arch}`, compiledPackages: [...compiled].sort(),
  };
  assert.ok(compiled.has(native.platformPackage), `${native.platformPackage} is installed`);

  // Fresh-state startup, then the private stores it leaves: owner-only files and folders, no `-shm` index (exclusive
  // locking), and nothing in `modules/` that no selected module owns.
  const stateDir = join(root, 'state');
  const first = await start(stateDir);
  const startup = states(first);
  assert.equal(first.health().status, 'ok', JSON.stringify(first.health()));
  assert.deepEqual(Object.keys(startup), everyName, 'the selected modules start in shipped order');
  assert.ok(Object.values(startup).every(state => state === 'running'), JSON.stringify(startup));
  const modulesDir = await lstat(join(stateDir, 'modules'));
  assert.equal(octal(modulesDir), '700');
  assert.equal(modulesDir.uid, uid);
  const stores = await storeInventory(stateDir, everyName);
  // Codex Desktop serves remote evidence and keeps no store; every other selected module opens one, in WAL mode.
  assert.deepEqual(Object.keys(stores).filter(name => stores[name].store !== undefined), everyName.filter(name => name !== 'codex-desktop'), 'each selected module keeps its store');
  for (const [name, {store, wal, shm, folder}] of Object.entries(stores)) {
    if (store !== undefined) {
      assert.deepEqual({mode: store.mode, uid: store.uid, regular: store.regular, links: store.links, wal, shm}, {mode: '600', uid, regular: true, links: 1, wal: true, shm: false}, `${name}'s store is private and in WAL mode`);
    }
    if (folder !== undefined) assert.deepEqual({mode: folder.mode, uid: folder.uid, directory: folder.directory}, {mode: '700', uid, directory: true}, `${name}'s folder is private`);
  }
  const owned = entry => everyName.some(name => entry === name || entry.startsWith(`${name}.sqlite`));
  assert.deepEqual((await readdir(join(stateDir, 'modules'))).filter(entry => !owned(entry)), [], 'modules/ holds only the selected modules\' files');

  // Exclusive startup, from other processes as an offline tool or a second start would be: while the first runtime runs,
  // a child process cannot take the lease, and a child process starting the same selection on the same directory does not
  // get a running core; the record keeps each of its modules' observed states. The first runtime and its stores are
  // unaffected. (The container entrypoint ends its process on a core failure; the probe reads the states instead.)
  const configFile = join(root, 'qualification-config.json');
  await writeFile(configFile, JSON.stringify(config), {mode: 0o600});
  await assert.rejects(holdRuntimeLease(stateDir), error => error.code === 'runtime-running');
  const leaseWhileRunning = await childLine(LEASE_PROBE, [stateDir]);
  assert.equal(leaseWhileRunning, 'refused:runtime-running', 'another process cannot take the lease while the runtime runs');
  const competing = JSON.parse(await childLine(SECOND_RUNTIME_PROBE, [stateDir, configFile, JSON.stringify(names)]));
  assert.notEqual(competing.outcome, 'started', 'a second process must not own the same state directory');
  assert.equal(first.health().status, 'ok', 'the first runtime keeps running');
  assert.deepEqual(await storeInventory(stateDir, everyName), stores, 'the refused start left the stores as they were');

  // Port conflict: a runtime whose port another process holds refuses before any module store exists.
  const blocker = createServer();
  blockers.add(blocker);
  await new Promise(resolve => blocker.listen(0, '127.0.0.1', resolve));
  const conflictDir = join(root, 'port-conflict');
  const conflict = await outcomeOf(start(conflictDir, {port: blocker.address().port}), stop);
  assert.equal(conflict, 'refused:EADDRINUSE');
  const afterConflict = await storeInventory(conflictDir, everyName);
  assert.ok(Object.values(afterConflict).every(({store, folder}) => store === undefined && folder === undefined), JSON.stringify(afterConflict));
  blocker.close();
  blockers.delete(blocker);

  // Graceful stop: the lease is free again and each store's log was checkpointed into the file and removed.
  const stopping = Date.now();
  await stop(first);
  const stopMs = Date.now() - stopping;
  (await holdRuntimeLease(stateDir)).release();
  const leaseAfterStop = await childLine(LEASE_PROBE, [stateDir]);
  assert.equal(leaseAfterStop, 'taken', 'another process can take the lease once the runtime stopped');
  const afterStop = await storeInventory(stateDir, everyName);
  for (const [name, {store, wal}] of Object.entries(afterStop)) if (store !== undefined) assert.equal(wal, false, `${name}'s log is checkpointed at a clean stop`);

  // Reopen: the same directory starts again on the same stores, which keep their inode, and every module runs.
  const second = await start(stateDir);
  const reopen = states(second);
  assert.equal(second.health().status, 'ok', JSON.stringify(second.health()));
  assert.ok(Object.values(reopen).every(state => state === 'running'), JSON.stringify(reopen));
  const reopened = await storeInventory(stateDir, everyName);
  for (const [name, {store}] of Object.entries(stores)) if (store !== undefined) assert.equal(reopened[name].store?.ino, store.ino, `${name} reopened its store`);
  await stop(second);
  (await holdRuntimeLease(stateDir)).release();

  // The real builds, not the simulated ones, load on this platform and keep their honest outcome for an empty section:
  // refused with a fixed code, or running with nothing configured, never failed. No device is named, so nothing is reached.
  const empty = Object.fromEntries(names.map(name => [name, {}]));
  const real = productionModules({modules: empty, edge}, runtimeModules, checkConfiguration, options).modules;
  const unconfigured = await startRuntime({modules: real, stateDir: join(root, 'empty'), port: 0, config: {modules: empty, edge}, log: () => {}});
  running.add(unconfigured);
  const emptySection = states(unconfigured);
  await stop(unconfigured);
  assert.equal(emptySection.core, 'running');
  for (const name of names) assert.match(emptySection[name], /^(refused:[a-z-]+|running)$/, `${name} with an empty section`);

  const record = {
    record: 'production-module-qualification/1.0', profile: 'production', control: 'enabled', transports: 'simulated', freshState: true,
    platform, native,
    modules: Object.fromEntries(everyName.map(name => [name, {
      startup: startup[name], reopen: reopen[name], ...(name === 'core' ? {} : {emptySection: emptySection[name]}),
      store: stores[name].store === undefined ? 'none' : {mode: stores[name].store.mode, logWhileRunning: stores[name].wal, logAfterStop: afterStop[name].wal, sameAfterReopen: reopened[name].store?.ino === stores[name].store.ino},
      folder: stores[name].folder === undefined ? 'none' : {mode: stores[name].folder.mode},
    }])),
    // The lease outcomes are what a separate process observed. A stop here releases the lease because the test owns the
    // runtime in-process; the container entrypoint holds its ownership until its process exits.
    exclusiveStartup: {probes: 'child-process', leaseWhileRunning, secondRuntime: competing.outcome, secondRuntimeModules: competing.modules, competingCoreFailed: competing.coreFailed},
    portConflict: {outcome: conflict, storesCreated: false},
    gracefulStop: {ms: stopMs, leaseAfterStop},
  };
  console.log(JSON.stringify(record));
});
