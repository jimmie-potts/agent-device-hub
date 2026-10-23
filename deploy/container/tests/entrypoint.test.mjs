import assert from 'node:assert/strict';
import {mkdtemp, realpath, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {checkConfiguration} from '../../../packages/sdk/dist/src/index.js';
import {checkLocalBrowserConfig, containerOptions, refuseNamedDevices} from '../entrypoint.mjs';

test('device control defaults off while the core remains selected', () => {
  assert.equal(containerOptions({}).control, 'disabled');
  assert.equal(containerOptions({BUNNY_CONTROL: 'enabled'}).control, 'enabled');
  for (const control of ['', 'true', 'yes', 'ENABLED']) {
    assert.throws(() => containerOptions({BUNNY_CONTROL: control}));
  }
});

test('container locations and listener have explicit safe defaults', () => {
  assert.deepEqual(containerOptions({}), {
    control: 'disabled', stateDir: '/var/lib/bunny', config: '/etc/bunny/runtime.json', port: 8788, access: 'isolated',
  });
  assert.throws(() => containerOptions({BUNNY_PORT: '0'}));
  assert.throws(() => containerOptions({BUNNY_PORT: '65536'}));
  assert.throws(() => containerOptions({BUNNY_STATE_DIR: 'relative'}));
  assert.throws(() => containerOptions({BUNNY_CONFIG: 'relative'}));
});

test('host-local browser access is explicit, fixed-port and never enables device control', () => {
  assert.deepEqual(containerOptions({BUNNY_ACCESS: 'host-local'}), {
    control: 'disabled', stateDir: '/var/lib/bunny', config: '/etc/bunny/runtime.json', port: 18788, access: 'host-local',
  });
  for (const env of [
    {BUNNY_ACCESS: 'public'}, {BUNNY_ACCESS: ''},
    {BUNNY_ACCESS: 'host-local', BUNNY_CONTROL: 'enabled'},
    {BUNNY_ACCESS: 'host-local', BUNNY_PORT: '8788'},
    {BUNNY_ACCESS: 'host-local', BUNNY_STATE_DIR: '/another'},
    {BUNNY_ACCESS: 'host-local', BUNNY_CONFIG: '/another/config.json'},
  ]) assert.throws(() => containerOptions(env));
});

// Synthetic registrations in shipped order: two that reach a device through a simulated transport, two that reach none.
const shipped = [
  {name: 'playback', simulation: {}}, {name: 'tidbyt', simulation: {}},
  {name: 'companions'}, {name: 'wispr'},
];

test('browser-only configuration refuses devices, unselected references and other access methods', () => {
  const valid = {modules: {}, edge: {credentials: '/run/secrets/bunny/edge.json', browserAccess: 'trusted-loopback', launcher: false, mcp: false}};
  assert.deepEqual(checkLocalBrowserConfig(valid, shipped), []);
  for (const change of [
    config => {config.modules.playback = {};}, config => {config.modules.pixoo = {};},
    config => {config.modules.core = {};}, config => {config.modules.wispr = {secrets: {}};},
    config => {config.modules.wispr = {secrets: {token: '/run/secrets/bunny/token'}};},
    config => {config.modules.wispr = {}; config.modules.tidbyt = {};}, config => {delete config.edge;},
    config => {config.edge.credentials = '/elsewhere/private';},
    config => {config.edge.browserAccess = undefined;}, config => {config.edge.launcher = true;},
    config => {config.edge.mcp = true;},
    config => {config.edge.wifiProxy = {};},
  ]) {
    const config = structuredClone(valid); change(config);
    assert.throws(() => checkLocalBrowserConfig(config, shipped), {message: 'container-browser-config-refused'});
  }
});

test('browser-only configuration admits sections for modules that reach no device, in shipped order', () => {
  const config = {modules: {wispr: {sourceId: 'synthetic'}, companions: {}},
    edge: {credentials: '/run/secrets/bunny/edge.json', browserAccess: 'trusted-loopback', launcher: false, mcp: false}};
  assert.deepEqual(checkLocalBrowserConfig(config, shipped).map(({name}) => name), ['companions', 'wispr']);
});

test('an admitted module whose accepted configuration names a device refuses startup', () => {
  const module = (name, configure) => ({manifest: {name, ...(configure === undefined ? {} : {configure})}});
  const config = {modules: {companions: {}, wispr: {}, quiet: {}}};
  const accepted = [module('core'), module('companions'), module('quiet', () => ({config: {}, devices: []}))];
  refuseNamedDevices(accepted, config, checkConfiguration);
  // A refused configuration is the runtime's to report: the module shows refused, and startup continues.
  refuseNamedDevices([...accepted, module('wispr', () => ({error: {code: 'invalid-request', detail: 'fixed'}}))], config, checkConfiguration);
  assert.throws(() => refuseNamedDevices([...accepted, module('wispr', () => ({config: {}, devices: ['desk-lamp']}))], config, checkConfiguration),
    {message: 'container-browser-config-refused'});
});

test('the host-local selection over the real shipped list starts admitted modules beside a healthy core', async t => {
  const [{coreFactory, shippedModules, buildModules}, {startRuntime}] = await Promise.all([
    import('../../../apps/runtime/dist/src/modules.js'), import('../../../apps/runtime/dist/src/runtime.js'),
  ]);
  const edge = {credentials: '/run/secrets/bunny/edge.json', browserAccess: 'trusted-loopback', launcher: false, mcp: false};
  const devices = shippedModules.slice(1).filter(registration => registration.simulation !== undefined);
  assert.ok(devices.some(({name}) => name === 'playback'));
  for (const {name} of devices) {
    assert.throws(() => checkLocalBrowserConfig({modules: {[name]: {}}, edge}, shippedModules.slice(1)), {message: 'container-browser-config-refused'});
  }
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bunny-local-modules-')));
  t.after(() => rm(root, {recursive: true, force: true}));
  async function run(modules) {
    const config = {modules, edge};
    const factories = [coreFactory, ...checkLocalBrowserConfig(config, shippedModules.slice(1))];
    const built = buildModules(factories, false);
    refuseNamedDevices(built, config, checkConfiguration);
    const stateDir = await mkdtemp(join(root, 'state-'));
    const runtime = await startRuntime({modules: built, stateDir, port: 0, config: {modules}, log: () => {}});
    try {return runtime.health();} finally {await runtime.stop();}
  }
  const coreOnly = await run({});
  assert.equal(coreOnly.status, 'ok');
  assert.deepEqual(coreOnly.modules.map(({name, state}) => [name, state]), [['core', 'running']]);
  // wispr refuses an empty section; the core and companions keep running.
  const admitted = await run({wispr: {}, companions: {}});
  assert.equal(admitted.status, 'degraded');
  assert.deepEqual(admitted.modules.map(({name, state}) => [name, state]), [['core', 'running'], ['companions', 'running'], ['wispr', 'refused']]);
});
