import assert from 'node:assert/strict';
import {mkdtemp, realpath, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {checkConfiguration} from '../../../packages/sdk/dist/src/index.js';
import {checkLocalBrowserConfig, checkLocalBrowserCredentials, containerOptions, hostLocalModules, refuseNamedDevices} from '../entrypoint.mjs';

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
  {name: 'companions'}, {name: 'wispr'}, {name: 'follower', after: ['playback']}, {name: 'listener', after: ['companions']},
];

test('browser-only configuration refuses devices, unselected references and other access methods', () => {
  const valid = {modules: {}, edge: {credentials: '/run/secrets/bunny/edge.json', browserAccess: 'trusted-loopback', launcher: false, mcp: false}};
  assert.deepEqual(checkLocalBrowserConfig(valid, shipped), []);
  for (const change of [
    config => {config.modules.playback = {};}, config => {config.modules.pixoo = {};},
    config => {config.modules.core = {};}, config => {config.modules.wispr = {secrets: {}};},
    config => {config.modules.wispr = {secrets: {token: '/run/secrets/bunny/token'}};},
    config => {config.modules.wispr = {}; config.modules.tidbyt = {};}, config => {delete config.edge;},
    // A module that starts after one this profile does not host would run without it.
    config => {config.modules.follower = {};}, config => {config.modules.listener = {};},
    config => {config.edge.credentials = '/elsewhere/private';},
    config => {config.edge.browserAccess = undefined;}, config => {config.edge.launcher = true;},
    config => {config.edge.mcp = true;},
    config => {config.edge.wifiProxy = {};},
  ]) {
    const config = structuredClone(valid); change(config);
    assert.throws(() => checkLocalBrowserConfig(config, shipped), {message: 'container-browser-config-refused'});
  }
});

test('a module that declares a simulation is admitted only for a section its registration calls host-local (Hub #567)', () => {
  const edge = {credentials: '/run/secrets/bunny/edge.json', browserAccess: 'trusted-loopback', launcher: false, mcp: false};
  const remoteOnly = section => Array.isArray(section?.sources) && section.sources.every(source => source.home === undefined);
  const withDesktop = [...shipped, {name: 'desktop', simulation: {}, hostLocal: remoteOnly}];
  assert.deepEqual(checkLocalBrowserConfig({modules: {desktop: {sources: [{hostId: 'pc', sourceId: 'desktop'}]}}, edge}, withDesktop).map(({name}) => name), ['desktop']);
  for (const section of [{home: '/home/owner/.codex', hostId: 'pc', sourceId: 'desktop'}, {sources: [{home: '/home/owner/.codex', hostId: 'pc', sourceId: 'desktop'}]}, {}, {sources: [{hostId: 'pc', sourceId: 'desktop'}], secrets: {}}]) {
    assert.throws(() => checkLocalBrowserConfig({modules: {desktop: section}, edge}, withDesktop), {message: 'container-browser-config-refused'});
  }
  // The predicate belongs to the registration: the same section is refused for a module without one.
  assert.throws(() => checkLocalBrowserConfig({modules: {playback: {sources: [{hostId: 'pc', sourceId: 'desktop'}]}}, edge}, withDesktop), {message: 'container-browser-config-refused'});
});

test('browser-only configuration admits sections for modules that reach no device, in shipped order', () => {
  const config = {modules: {listener: {}, wispr: {sourceId: 'synthetic'}, companions: {}},
    edge: {credentials: '/run/secrets/bunny/edge.json', browserAccess: 'trusted-loopback', launcher: false, mcp: false}};
  assert.deepEqual(checkLocalBrowserConfig(config, shipped).map(({name}) => name), ['companions', 'wispr', 'listener']);
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

test('the host-local profile refuses an admitted module whose configuration names a device', () => {
  const edge = {credentials: '/run/secrets/bunny/edge.json', browserAccess: 'trusted-loopback', launcher: false, mcp: false};
  const factory = (name, configure) => ({name, create: () => ({manifest: {name, ...(configure === undefined ? {} : {configure})}})});
  const core = factory('core');
  const runtime = devices => ({coreFactory: core, buildModules: factories => factories.map(each => each.create()),
    shippedModules: [core, factory('quiet', () => ({config: {}, devices}))]});
  assert.deepEqual(hostLocalModules({modules: {quiet: {}}, edge}, runtime([]), checkConfiguration).factories.map(({name}) => name), ['core', 'quiet']);
  assert.throws(() => hostLocalModules({modules: {quiet: {}}, edge}, runtime(['desk-lamp']), checkConfiguration), {message: 'container-browser-config-refused'});
});

test('the host-local profile over the real shipped list starts admitted modules beside a healthy core', async t => {
  const [runtimeModules, {startRuntime}] = await Promise.all([
    import('../../../apps/runtime/dist/src/modules.js'), import('../../../apps/runtime/dist/src/runtime.js'),
  ]);
  const edge = {credentials: '/run/secrets/bunny/edge.json', browserAccess: 'trusted-loopback', launcher: false, mcp: false};
  const listed = runtimeModules.shippedModules.slice(1);
  // The container guide names this admissible set; a new module that declares no simulation must update it.
  assert.deepEqual(listed.filter(registration => registration.simulation === undefined).map(({name}) => name).sort(), ['companions', 'wispr']);
  const devices = listed.filter(registration => registration.simulation !== undefined);
  assert.ok(devices.some(({name}) => name === 'playback'));
  for (const {name} of devices) {
    assert.throws(() => hostLocalModules({modules: {[name]: {}}, edge}, runtimeModules, checkConfiguration), {message: 'container-browser-config-refused'});
  }
  // The Codex Desktop module is the one device module with a host-local section: remote sources only, no local home (Hub #567).
  assert.deepEqual(listed.filter(registration => registration.hostLocal !== undefined).map(({name}) => name), ['codex-desktop']);
  const remote = {sources: [{hostId: 'pc-sim', sourceId: 'codex-desktop'}]};
  assert.deepEqual(hostLocalModules({modules: {'codex-desktop': remote}, edge}, runtimeModules, checkConfiguration).factories.map(({name}) => name), ['core', 'codex-desktop']);
  assert.throws(() => hostLocalModules({modules: {'codex-desktop': {home: '/home/owner-sim/.codex', hostId: 'pc-sim', sourceId: 'codex-desktop'}}, edge}, runtimeModules, checkConfiguration), {message: 'container-browser-config-refused'});
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bunny-local-modules-')));
  t.after(() => rm(root, {recursive: true, force: true}));
  async function run(modules) {
    const {factories, modules: built} = hostLocalModules({modules, edge}, runtimeModules, checkConfiguration);
    assert.deepEqual(built.map(({manifest}) => manifest.name), factories.map(({name}) => name));
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
  // A remote-only Codex Desktop section runs beside the core with no local file read.
  const desktop = await run({'codex-desktop': remote});
  assert.equal(desktop.status, 'ok');
  assert.deepEqual(desktop.modules.map(({name, state}) => [name, state]), [['core', 'running'], ['codex-desktop', 'running']]);
});

test('one lifecycle producer requires an explicit host-local source selection', () => {
  const source = 'bunny/parts/hub-' + '1'.repeat(32);
  assert.equal(containerOptions({BUNNY_ACCESS: 'host-local', BUNNY_INGEST_SOURCE: source}).ingestSource, source);
  for (const env of [
    {BUNNY_INGEST_SOURCE: source},
    {BUNNY_ACCESS: 'host-local', BUNNY_INGEST_SOURCE: ''},
    {BUNNY_ACCESS: 'host-local', BUNNY_INGEST_SOURCE: 'bunny/core'},
    {BUNNY_ACCESS: 'host-local', BUNNY_INGEST_SOURCE: 'bunny/modules/codex-desktop'},
    {BUNNY_ACCESS: 'host-local', BUNNY_INGEST_SOURCE: source + '\n'},
  ]) assert.throws(() => containerOptions(env));
});

test('selected producer admits only its single ingest grant and keeps browser-only defaults', () => {
  const source = 'bunny/parts/hub-' + '1'.repeat(32);
  const producer = {id: 'hub-' + '1'.repeat(32), source, digest: '2'.repeat(64), scopes: ['ingest']};
  checkLocalBrowserCredentials([]);
  checkLocalBrowserCredentials([producer], source);
  assert.throws(() => checkLocalBrowserCredentials([producer]));
  assert.throws(() => checkLocalBrowserCredentials([], source));
  assert.throws(() => checkLocalBrowserCredentials([producer, producer], source));
  for (const change of [
    credential => {credential.id = 'another';},
    credential => {credential.source = 'bunny/parts/other';},
    credential => {credential.scopes = ['read'];},
    credential => {credential.scopes = ['ingest', 'control'];},
    credential => {credential.scopes = ['ingest', 'admin'];},
    credential => {credential.scopes = [];},
    credential => {credential.role = 'bb8-link';},
  ]) {
    const credential = structuredClone(producer); change(credential);
    assert.throws(() => checkLocalBrowserCredentials([credential], source));
  }
});

test('private access is explicit, retains local limits and requires its configured entry', () => {
  assert.equal(containerOptions({BUNNY_ACCESS: 'private-proxy'}).port, 18788);
  for (const change of [{BUNNY_CONTROL: 'enabled'}, {BUNNY_PORT: '8788'}, {BUNNY_CONFIG: '/other'}, {BUNNY_STATE_DIR: '/other'}]) {
    assert.throws(() => containerOptions({BUNNY_ACCESS: 'private-proxy', ...change}));
  }
  const config = {modules: {companions: {}}, edge: {credentials: '/run/secrets/bunny/edge.json', browserAccess: 'trusted-loopback',
    launcher: false, mcp: false, privateProxy: {origin: 'https://synthetic.ts.net', tokenDigest: '1'.repeat(64)}}};
  assert.deepEqual(checkLocalBrowserConfig(config, shipped, 'private-proxy').map(({name}) => name), ['companions']);
  assert.throws(() => checkLocalBrowserConfig(config, shipped));
  for (const change of [c => {delete c.edge.privateProxy;}, c => {c.edge.wifiProxy = c.edge.privateProxy;},
    c => {c.modules.playback = {};}, c => {c.edge.mcp = true;}]) {
    const changed = structuredClone(config); change(changed);
    assert.throws(() => checkLocalBrowserConfig(changed, shipped, 'private-proxy'));
  }
});

test('private clients keep scoped grants and the selected local producer remains ingest-only', () => {
  const client = {id: 'reader', source: 'bunny/parts/reader', digest: '2'.repeat(64), scopes: ['read']};
  const source = 'bunny/parts/hub-' + '1'.repeat(32);
  const producer = {id: source.slice('bunny/parts/'.length), source, digest: '3'.repeat(64), scopes: ['ingest']};
  checkLocalBrowserCredentials([client], undefined, 'private-proxy');
  checkLocalBrowserCredentials([client, producer], source, 'private-proxy');
  assert.throws(() => checkLocalBrowserCredentials([client]));
  assert.throws(() => checkLocalBrowserCredentials([client], source, 'private-proxy'));
  assert.throws(() => checkLocalBrowserCredentials([client, {...producer, scopes: ['read', 'ingest']}], source, 'private-proxy'));
  for (const change of [{scopes: ['admin']}, {scopes: ['read', 'admin']}, {role: 'bb8-link', scopes: []}]) {
    assert.throws(() => checkLocalBrowserCredentials([{...client, ...change}], undefined, 'private-proxy'));
  }
});
