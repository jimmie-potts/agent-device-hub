import assert from 'node:assert/strict';
import {mkdtemp, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {checkConfiguration} from '../../../packages/sdk/dist/src/index.js';
import {checkLocalBrowserConfig, checkLocalBrowserCredentials, containerOptions, hostLocalModules, refuseNamedDevices} from '../entrypoint.mjs';
import * as entrypoint from '../entrypoint.mjs';

const productionEdge = () => ({credentials: '/run/secrets/bunny/edge.json', browserAccess: 'trusted-loopback',
  launcher: false, mcp: false, privateProxy: {origin: 'https://synthetic.ts.net', tokenDigest: '1'.repeat(64)}});

test('explicit standby admits only production and private-proxy options without producers or devices', () => {
  for (const access of ['production', 'private-proxy']) {
    const env = {BUNNY_ACCESS: access, BUNNY_CONTROL: 'standby'};
    assert.equal(containerOptions(env).control, 'standby');
    for (const change of [{BUNNY_PORT: '8788'}, {BUNNY_STATE_DIR: '/other'}, {BUNNY_CONFIG: '/other'},
      {BUNNY_INGEST_SOURCE: 'bunny/parts/hub-' + '1'.repeat(32)}, {BUNNY_PIXOO_BIND: '192.168.1.10'}]) {
      assert.throws(() => containerOptions({...env, ...change}), {message: 'container-options-refused'});
    }
  }
  for (const access of ['host-local', 'isolated']) {
    assert.throws(() => containerOptions({BUNNY_ACCESS: access, BUNNY_CONTROL: 'standby'}), {message: 'container-options-refused'});
  }
});

test('standby entrypoint validates private inputs before state and runs only the bound core with edge off', async () => {
  const core = {manifest: {name: 'core', apiVersion: '1.3'}};
  const coreFactory = {name: 'core'};
  const options = containerOptions({BUNNY_ACCESS: 'production', BUNNY_CONTROL: 'standby'});
  const steps = [];
  const lease = {releaseBeforeStartup: () => steps.push('release')};
  let config = {modules: {}};
  let credentialsFail = false;
  let ownerFail = false;
  let restoreFail = false;
  const dependencies = {
    readRuntimeConfig: async () => config,
    runtime: {standbyCoreFactory: coreFactory, buildModules: (factories, simulate) => {
      assert.deepEqual(factories, [coreFactory]);
      assert.equal(simulate, false);
      return [core];
    }},
    checkConfiguration,
    checkCredentials: async () => {
      steps.push('credentials');
      if (credentialsFail) throw new Error('synthetic-credentials-refused');
    },
    prepareOwnershipRoot: async () => { steps.push('prepare'); },
    acquireRuntimeOwnership: async () => {
      steps.push('lease');
      if (ownerFail) throw new Error('synthetic-owner-refused');
      return lease;
    },
    refusePendingRestore: async () => {
      steps.push('restore-check');
      if (restoreFail) throw new Error('restore-pending');
    },
    bindCoreRuntimeOwnership: (instance, acquired) => {
      assert.equal(instance, core);
      assert.equal(acquired, lease);
      steps.push('bind');
    },
    parseArguments: () => ({}),
    runProcess: async (parsed, startup) => {
      assert.equal(parsed.edge, false);
      assert.deepEqual(startup, {modules: [core], config, listener: 'container-host-local'});
      steps.push('process');
    },
  };
  await entrypoint.startContainer(options, dependencies);
  assert.deepEqual(steps.splice(0), ['prepare', 'lease', 'restore-check', 'bind', 'process']);
  config = {modules: {core: {}}, edge: productionEdge()};
  await entrypoint.startContainer(options, dependencies);
  assert.deepEqual(steps.splice(0), ['credentials', 'prepare', 'lease', 'restore-check', 'bind', 'process']);
  for (const invalid of [
    {modules: {art: {}}}, {modules: {core: null}}, {modules: {core: {secrets: {}}}},
    {modules: {}, diagnostics: {modules: {art: 'debug'}}}, {modules: {}, edge: {}},
    {modules: {}, edge: {...productionEdge(), mcp: true}},
  ]) {
    config = invalid;
    await assert.rejects(entrypoint.startContainer(options, dependencies), {message: 'container-browser-config-refused'});
    assert.deepEqual(steps.splice(0), []);
  }
  config = {modules: {}, edge: productionEdge()};
  credentialsFail = true;
  await assert.rejects(entrypoint.startContainer(options, dependencies), {message: 'synthetic-credentials-refused'});
  assert.deepEqual(steps.splice(0), ['credentials']);
  credentialsFail = false;
  ownerFail = true;
  await assert.rejects(entrypoint.startContainer(options, dependencies), {message: 'synthetic-owner-refused'});
  assert.deepEqual(steps.splice(0), ['credentials', 'prepare', 'lease']);
  ownerFail = false;
  restoreFail = true;
  await assert.rejects(entrypoint.startContainer(options, dependencies), {message: 'restore-pending'});
  assert.deepEqual(steps.splice(0), ['credentials', 'prepare', 'lease', 'restore-check', 'release']);
});

test('production selection defaults disabled, admits explicit control and bounds the optional Pixoo address', () => {
  assert.equal(containerOptions({BUNNY_ACCESS: 'production'}).control, 'disabled');
  assert.equal(containerOptions({BUNNY_ACCESS: 'production', BUNNY_CONTROL: 'enabled'}).port, 18788);
  assert.equal(containerOptions({BUNNY_ACCESS: 'production', BUNNY_CONTROL: 'enabled', BUNNY_PIXOO_BIND: '192.168.1.10'}).pixooBind, '192.168.1.10');
  for (const env of [
    {BUNNY_ACCESS: 'production', BUNNY_PORT: '8788'}, {BUNNY_ACCESS: 'production', BUNNY_CONFIG: '/other'},
    {BUNNY_ACCESS: 'production', BUNNY_PIXOO_BIND: '192.168.1.10'},
    ...['', '0.0.0.0', '127.0.0.1', '::', '8.8.8.8', '192.168.1.10\n'].map(BUNNY_PIXOO_BIND => ({BUNNY_ACCESS: 'production', BUNNY_CONTROL: 'enabled', BUNNY_PIXOO_BIND})),
    {BUNNY_ACCESS: 'private-proxy', BUNNY_PIXOO_BIND: '192.168.1.10'},
  ]) assert.throws(() => containerOptions(env), {message: 'container-options-refused'});
});

test('production admits only configured shipped modules in dependency order and keeps disabled control safe', () => {
  const factory = (name, devices = [], after = []) => ({name, after, create: () => ({manifest: {name,
    configure: () => ({config: {}, devices})}})});
  const core = factory('core'), playback = factory('playback', ['speaker']), tidbyt = factory('tidbyt', ['display'], ['playback']);
  const quiet = factory('quiet'), unused = factory('unused', ['unused']);
  const runtime = {coreFactory: core, shippedModules: [core, playback, tidbyt, quiet, unused],
    buildModules: factories => factories.map(each => each.create())};
  const options = containerOptions({BUNNY_ACCESS: 'production', BUNNY_CONTROL: 'enabled'});
  const config = {modules: {tidbyt: {}, quiet: {}, playback: {secrets: {token: '/run/secrets/bunny/token'}}}, edge: productionEdge()};
  assert.deepEqual(entrypoint.productionModules(config, runtime, checkConfiguration, options).factories.map(({name}) => name),
    ['core', 'playback', 'tidbyt', 'quiet']);
  assert.deepEqual(entrypoint.productionModules({modules: {quiet: {}}, edge: productionEdge()}, runtime, checkConfiguration,
    containerOptions({BUNNY_ACCESS: 'production'})).factories.map(({name}) => name), ['core', 'quiet']);
  for (const mutate of [
    c => {c.modules.unknown = {};}, c => {delete c.modules.playback;},
    c => {c.modules.playback.secrets.token = '/etc/passwd';},
    c => {c.modules.playback.secrets.token = '/run/secrets/bunny/../outside';},
    c => {c.modules.playback.secrets.token = '/run/secrets/bunny//token';},
    c => {delete c.edge.privateProxy;},
  ]) {
    const changed = structuredClone(config); mutate(changed);
    assert.throws(() => entrypoint.productionModules(changed, runtime, checkConfiguration, options), {message: 'container-browser-config-refused'});
  }
  assert.throws(() => entrypoint.productionModules(config, runtime, checkConfiguration,
    containerOptions({BUNNY_ACCESS: 'production'})), {message: 'container-browser-config-refused'});
});

test('production with control enabled admits MCP; the edge keeps every other limit (#1595)', () => {
  const core = {name: 'core', create: () => ({manifest: {name: 'core'}})};
  const quiet = {name: 'quiet', create: () => ({manifest: {name: 'quiet'}})};
  const runtime = {coreFactory: core, shippedModules: [core, quiet], buildModules: factories => factories.map(each => each.create())};
  const enabled = containerOptions({BUNNY_ACCESS: 'production', BUNNY_CONTROL: 'enabled'});
  const withMcp = {modules: {quiet: {}}, edge: {...productionEdge(), mcp: true}};
  assert.deepEqual(entrypoint.productionModules(withMcp, runtime, checkConfiguration, enabled).factories.map(({name}) => name), ['core', 'quiet']);
  assert.deepEqual(entrypoint.productionModules({modules: {quiet: {}}, edge: productionEdge()}, runtime, checkConfiguration, enabled)
    .factories.map(({name}) => name), ['core', 'quiet']);
  for (const mutate of [
    c => {c.edge.mcp = 'true';}, c => {c.edge.mcp = 1;}, c => {delete c.edge.mcp;},
    c => {c.edge.credentials = '/elsewhere/private';}, c => {c.edge.browserAccess = undefined;},
    c => {c.edge.launcher = true;}, c => {c.edge.wifiProxy = {};}, c => {delete c.edge.privateProxy;}, c => {delete c.edge;},
  ]) {
    const changed = structuredClone(withMcp); mutate(changed);
    assert.throws(() => entrypoint.productionModules(changed, runtime, checkConfiguration, enabled), {message: 'container-browser-config-refused'});
  }
  // With control disabled, production takes the private-proxy admission path, which still refuses MCP.
  const disabled = containerOptions({BUNNY_ACCESS: 'production'});
  assert.deepEqual(entrypoint.productionModules({modules: {quiet: {}}, edge: productionEdge()}, runtime, checkConfiguration, disabled)
    .factories.map(({name}) => name), ['core', 'quiet']);
  assert.throws(() => entrypoint.productionModules(withMcp, runtime, checkConfiguration, disabled), {message: 'container-browser-config-refused'});
});

test('production hosted-GIF selection must match the configured Pixoo listener without widening the gateway', () => {
  const core = {name: 'core', create: () => ({manifest: {name: 'core'}})};
  const pixoo = {name: 'pixoo', create: () => ({manifest: {name: 'pixoo', configure: () => ({config: {}, devices: ['pixoo']})}})};
  const runtime = {coreFactory: core, shippedModules: [core, pixoo], buildModules: factories => factories.map(each => each.create())};
  const config = {modules: {pixoo: {hostedGif: {bind: '0.0.0.0', port: 41240, origin: 'http://192.168.1.10:41240'}}}, edge: productionEdge()};
  const options = containerOptions({BUNNY_ACCESS: 'production', BUNNY_CONTROL: 'enabled', BUNNY_PIXOO_BIND: '192.168.1.10'});
  assert.equal(entrypoint.productionModules(config, runtime, checkConfiguration, options).modules.length, 2);
  assert.throws(() => entrypoint.productionModules(config, runtime, checkConfiguration,
    containerOptions({BUNNY_ACCESS: 'production', BUNNY_CONTROL: 'enabled'})), {message: 'container-browser-config-refused'});
  for (const change of [{bind: '127.0.0.1'}, {port: 41241}, {origin: 'http://192.168.1.11:41240'}]) {
    const changed = structuredClone(config); Object.assign(changed.modules.pixoo.hostedGif, change);
    assert.throws(() => entrypoint.productionModules(changed, runtime, checkConfiguration, options), {message: 'container-browser-config-refused'});
  }
  assert.throws(() => entrypoint.productionModules({modules: {}, edge: productionEdge()}, runtime, checkConfiguration, options),
    {message: 'container-browser-config-refused'});
});

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
  assert.deepEqual(listed.filter(registration => registration.simulation === undefined).map(({name}) => name).sort(), ['companions', 'weather', 'wispr']);
  const devices = listed.filter(registration => registration.simulation !== undefined);
  assert.ok(devices.some(({name}) => name === 'playback'));
  for (const {name} of devices) {
    if (name !== 'art') assert.throws(() => hostLocalModules({modules: {[name]: {}}, edge}, runtimeModules, checkConfiguration), {message: 'container-browser-config-refused'});
  }
  // These simulated modules also have host-local sections: remote Codex Desktop, Volcano's collector, and Art without keys.
  assert.deepEqual(listed.filter(registration => registration.hostLocal !== undefined).map(({name}) => name), ['codex-desktop', 'art', 'volcano']);
  assert.deepEqual(hostLocalModules({modules: {art: {}}, edge}, runtimeModules, checkConfiguration).factories.map(({name}) => name), ['core', 'art']);
  assert.throws(() => hostLocalModules({modules: {art: {secrets: {}}}, edge}, runtimeModules, checkConfiguration), {message: 'container-browser-config-refused'});
  assert.deepEqual(hostLocalModules({modules: {volcano: {id: 'volcano', hostId: 'mac-sim', sourceId: 'volcano-sim'}}, edge}, runtimeModules, checkConfiguration).factories.map(({name}) => name), ['core', 'volcano']);
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
  const art = await run({art: {}});
  assert.equal(art.status, 'ok');
  assert.deepEqual(art.modules.map(({name, state}) => [name, state]), [['core', 'running'], ['art', 'running']]);
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

test('private access admits the coding worker\'s own role and nothing else with a role', () => {
  const worker = {id: 'coding-worker-mac', source: 'bunny/parts/coding-worker', digest: '4'.repeat(64), scopes: [], role: 'coding-worker'};
  const client = {id: 'reader', source: 'bunny/parts/reader', digest: '2'.repeat(64), scopes: ['read']};
  const source = 'bunny/parts/hub-' + '1'.repeat(32);
  const producer = {id: source.slice('bunny/parts/'.length), source, digest: '3'.repeat(64), scopes: ['ingest']};
  checkLocalBrowserCredentials([worker], undefined, 'private-proxy');
  checkLocalBrowserCredentials([client, worker, producer], source, 'private-proxy');
  // The worker is a local loopback client; the host-local profile still admits only its selected producer.
  assert.throws(() => checkLocalBrowserCredentials([worker]));
  assert.throws(() => checkLocalBrowserCredentials([worker, producer], source));
  for (const change of [{role: 'bb8-link'}, {robotId: 'r1'}, {scopes: ['read']}]) {
    assert.throws(() => checkLocalBrowserCredentials([{...worker, ...change}], undefined, 'private-proxy'));
  }
});

const musicProducer = {id: 'music-producer-mac', source: 'bunny/parts/music-producer', digest: '5'.repeat(64), scopes: [], role: 'music-producer'};
const playbackProducer = {
  id: 'music-playback-mac', source: 'bunny/parts/music-playback', digest: '6'.repeat(64), scopes: [], role: 'music-playback-producer',
};

test('private access admits the Music producers\' own roles with no scopes, beside the worker and clients (Hub #1594)', () => {
  const worker = {id: 'coding-worker-mac', source: 'bunny/parts/coding-worker', digest: '4'.repeat(64), scopes: [], role: 'coding-worker'};
  const client = {id: 'reader', source: 'bunny/parts/reader', digest: '2'.repeat(64), scopes: ['read']};
  const source = 'bunny/parts/hub-' + '1'.repeat(32);
  const producer = {id: source.slice('bunny/parts/'.length), source, digest: '3'.repeat(64), scopes: ['ingest']};
  checkLocalBrowserCredentials([musicProducer], undefined, 'private-proxy');
  checkLocalBrowserCredentials([playbackProducer], undefined, 'private-proxy');
  checkLocalBrowserCredentials([client, worker, musicProducer, playbackProducer, producer], source, 'private-proxy');
  // The host-local profile still admits only its selected producer.
  assert.throws(() => checkLocalBrowserCredentials([musicProducer]), {message: 'container-browser-config-refused'});
  assert.throws(() => checkLocalBrowserCredentials([playbackProducer, producer], source), {message: 'container-browser-config-refused'});
  for (const credential of [musicProducer, playbackProducer]) {
    for (const change of [{role: 'bb8-link'}, {role: 'stray-role'}, {robotId: 'r1'}, {scopes: ['read']}, {scopes: ['ingest']}]) {
      assert.throws(() => checkLocalBrowserCredentials([worker, {...credential, ...change}], undefined, 'private-proxy'),
        {message: 'container-browser-config-refused'});
    }
  }
});

test('check-credentials runs the start-time credential check on the installed file, before a grant is reloaded (Hub #1594)', async t => {
  const {CREDENTIALS_SCHEMA} = await import('../../../apps/runtime/dist/src/credentials.js');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bunny-credentials-check-')));
  t.after(() => rm(root, {recursive: true, force: true}));
  const file = join(root, 'edge.json');
  const config = {edge: {credentials: file}};
  await writeFile(file, JSON.stringify({schema: CREDENTIALS_SCHEMA, credentials: [musicProducer, playbackProducer]}), {mode: 0o600});
  for (const access of ['private-proxy', 'production']) {
    assert.deepEqual(await entrypoint.checkConfiguredCredentials(config, {access}), {status: 'admitted', credentials: 2});
  }
  await assert.rejects(entrypoint.checkConfiguredCredentials(config, {access: 'host-local'}), {message: 'container-browser-config-refused'});
  // The isolated profile has no credential check at start, so there is nothing for this command to repeat.
  await assert.rejects(entrypoint.checkConfiguredCredentials(config, {access: 'isolated'}), {message: 'container-command-refused'});
  await assert.rejects(entrypoint.main(['check-credentials'], {}), {message: 'container-command-refused'});
  await assert.rejects(entrypoint.main(['check-credentials', 'extra'], {}), {message: 'container-command-refused'});
});

test('standby accepts an omitted edge and refuses missing, invalid and out-of-profile grants', async t => {
  const {CREDENTIALS_SCHEMA} = await import('../../../apps/runtime/dist/src/credentials.js');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bunny-standby-credentials-')));
  t.after(() => rm(root, {recursive: true, force: true}));
  const file = join(root, 'edge.json'), config = {edge: {credentials: file}};
  for (const access of ['private-proxy', 'production']) {
    const options = {access, control: 'standby'};
    assert.deepEqual(await entrypoint.checkConfiguredCredentials({}, options), {status: 'admitted', credentials: 0});
    await rm(file, {force: true});
    await assert.rejects(entrypoint.checkConfiguredCredentials(config, options), {code: 'edge-credentials-missing'});
    await writeFile(file, '{', {mode: 0o600});
    await assert.rejects(entrypoint.checkConfiguredCredentials(config, options), {code: 'edge-credentials-invalid'});
    const grant = {id: 'reader', source: 'bunny/parts/reader', digest: '2'.repeat(64), scopes: ['read']};
    const document = credential => JSON.stringify({schema: CREDENTIALS_SCHEMA, credentials: [credential]});
    for (const scopes of [['admin'], ['read', 'control'], ['ingest'], []]) {
      await writeFile(file, document({...grant, scopes}), {mode: 0o600});
      await assert.rejects(entrypoint.checkConfiguredCredentials(config, options), {message: 'container-browser-config-refused'});
    }
    await writeFile(file, document(grant), {mode: 0o600});
    assert.deepEqual(await entrypoint.checkConfiguredCredentials(config, options), {status: 'admitted', credentials: 1});
  }
});

// The history rules each profile's core is built with (#1795). Every profile must keep history by the bookkeeping
// members and polled families of the modules it hosts, as #1771 and #1772 declare them; before #1795 the container's
// profiles took a core factory that kept only the contracts package's members and polled nothing.
const shippedRuntime = () => import('../../../apps/runtime/dist/src/modules.js');

/** Asserts that `rules` holds every hosted factory's declared bookkeeping members and polled families. */
function assertHostedRules(rules, hosted) {
  for (const {name, bookkeeping = {}, polling = {}} of hosted) {
    for (const [family, pointers] of Object.entries(bookkeeping)) assert.deepEqual(rules.bookkeeping[family], pointers, `${name} ${family}`);
    for (const [family, interval] of Object.entries(polling)) assert.equal(rules.polling[`bunny/modules/${name}`]?.[family], interval, `${name} polls ${family}`);
  }
  assert.deepEqual(rules.bookkeeping.device, ['/observed/observedAtMs', '/lastTransmission/transmittedAtMs', '/externalControl/observedAtMs'], 'the contracts package\'s members stay');
}

const TYPICAL = ['playback', 'lifx', 'tidbyt', 'pixoo', 'nanoleaf', 'roborock', 'wemo', 'companions', 'weather'];

test('the production profile builds its core with the history rules of the modules it hosts (#1795)', async () => {
  const runtimeModules = await shippedRuntime();
  const selected = runtimeModules.shippedModules.slice(1).filter(({name}) => TYPICAL.includes(name));
  assert.deepEqual(selected.map(({name}) => name).sort(), [...TYPICAL].sort(), 'every typical module ships');
  // Only the hosted modules' transports are simulated; the core factory is the one the entrypoint takes.
  const factories = [runtimeModules.shippedModules[0], ...selected.map(factory => ({...factory, create: () => factory.simulate()}))];
  const prepared = entrypoint.productionModules({modules: Object.fromEntries(TYPICAL.map(name => [name, {}])), edge: productionEdge()},
    {...runtimeModules, shippedModules: factories}, checkConfiguration, containerOptions({BUNNY_ACCESS: 'production', BUNNY_CONTROL: 'enabled'}));
  const core = prepared.modules[0];
  assert.equal(core.manifest.name, 'core');
  const {rules} = core.history;
  assertHostedRules(rules, selected);
  assert.deepEqual(rules.bookkeeping['pixoo-display'], ['/monitor/page']);
  assert.deepEqual(rules.bookkeeping['roborock-vacuum'], ['/observedAtMs/value']);
  assert.deepEqual(rules.bookkeeping['lifx-light'], ['/observed/observedAtMs']);
  assert.deepEqual(rules.polling, {
    'bunny/modules/pixoo': {device: 30_000}, 'bunny/modules/roborock': {'roborock-vacuum': 60_000, device: 60_000},
    'bunny/modules/weather': {'weather-state': 900_000}, 'bunny/modules/wemo': {device: 5000},
  });
});

test('the host-local, disabled-control and isolated profiles build their core with the history rules (#1795)', async () => {
  const runtimeModules = await shippedRuntime();
  const sections = {companions: {}, weather: {}};
  const local = hostLocalModules({modules: sections, edge: {credentials: '/run/secrets/bunny/edge.json', browserAccess: 'trusted-loopback', launcher: false, mcp: false}},
    runtimeModules, checkConfiguration);
  assert.deepEqual(local.factories.map(({name}) => name), ['core', 'companions', 'weather']);
  assertHostedRules(local.modules[0].history.rules, local.factories.slice(1));
  assert.deepEqual(local.modules[0].history.rules.polling['bunny/modules/weather'], {'weather-state': 900_000});
  const disabled = entrypoint.productionModules({modules: sections, edge: productionEdge()}, runtimeModules, checkConfiguration,
    containerOptions({BUNNY_ACCESS: 'production'}));
  assert.deepEqual(disabled.factories.map(({name}) => name), ['core', 'companions', 'weather']);
  assertHostedRules(disabled.modules[0].history.rules, disabled.factories.slice(1));
  // The isolated profile starts `[coreFactory]` with control disabled and the shipped list otherwise: one core factory.
  assert.equal(runtimeModules.coreFactory, runtimeModules.shippedModules[0]);
  const [alone] = runtimeModules.buildModules([runtimeModules.coreFactory], false);
  assertHostedRules(alone.history.rules, runtimeModules.registrations);
  assert.deepEqual(alone.history.rules, runtimeModules.historyRules(runtimeModules.registrations));
});

test('in the production profile on a controlled clock, a page turn writes no row and a silent polled device gets one gap row (#1795)', async t => {
  const [runtimeModules, {startRuntime}, {manualClock}, {RECORDS}] = await Promise.all([shippedRuntime(),
    import('../../../apps/runtime/dist/src/runtime.js'), import('../../../apps/runtime/dist/tests/scenarios/virtual-time.js'),
    import('../../../apps/runtime/dist/tests/fixtures/module-state-records.js')]);
  const clock = manualClock(1_800_000_000_000);
  // Stand-ins under the shipped names, so the core hears their states from the sources it keeps rules for.
  const publishers = {};
  const standIn = name => ({name, create: () => ({manifest: {name, apiVersion: '1.2', configure: section => ({config: section, devices: []})},
    start: context => {publishers[name] = context.sdk;}, stop: () => {}})});
  const prepared = entrypoint.productionModules({modules: {pixoo: {}, wemo: {}}, edge: productionEdge()},
    {...runtimeModules, shippedModules: [runtimeModules.shippedModules[0], standIn('pixoo'), standIn('wemo')]}, checkConfiguration,
    containerOptions({BUNNY_ACCESS: 'production', BUNNY_CONTROL: 'enabled'}));
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bunny-history-rules-')));
  t.after(() => rm(root, {recursive: true, force: true}));
  const runtime = await startRuntime({modules: prepared.modules, stateDir: join(root, 'state'), port: 0, clock: {now: clock.now}, scheduler: clock.scheduler,
    config: {modules: {pixoo: {}, wemo: {}}}, log: () => {}});
  t.after(() => runtime.stop());
  const core = prepared.modules[0];
  const rows = source => core.history.read({kind: 'change', source});
  // Turns of the event loop, never a wait on real time, until the intake has committed `count` rows of `source`.
  const settle = async (source, count) => {
    for (let turn = 0; turn < 500 && rows(source).length < count; turn++) await new Promise(resolve => {setImmediate(resolve);});
    return rows(source);
  };
  let revision = 0;
  const display = RECORDS['pixoo-display/2.1'].data;
  const show = data => publishers.pixoo.publish('bunny.state.pixoo-display.pixoo', {kind: 'state', type: 'org.bunny.pixoo-display.updated', subject: 'pixoo',
    dataschema: 'https://bunny.invalid/events/pixoo-display/2.1', data: {...data, revision: ++revision}});
  await show({...display, monitor: {...display.monitor, page: 0}});
  assert.equal((await settle('bunny/modules/pixoo', 1)).length, 1, 'the first display record writes its row');
  for (const page of [1, 0, 1]) await show({...display, monitor: {...display.monitor, page}});
  // A later real change shows that the page turns were taken and wrote nothing.
  await show({...display, monitor: {...display.monitor, page: 1}, showing: 'none'});
  const shown = await settle('bunny/modules/pixoo', 2);
  assert.equal(shown.length, 2, 'only the real change writes a row');
  assert.deepEqual(Object.keys(shown[1].record.changed).sort(), ['monitor', 'showing']);
  assert.equal(shown[1].record.span.confirmations, 4, 'the three page turns confirmed the span');
  // A Wemo plug read every 5 s, then silent for longer than its 2-minute gap.
  const unsupported = {supported: false}, unknown = {status: 'unknown'};
  const plug = atMs => ({id: 'desk-lamp', revision: ++revision, kind: 'wemo', availability: 'available', configurationRevision: 1, generation: {epoch: 'wemo', sequence: 1},
    capabilities: {power: {supported: true}, brightness: unsupported, modes: unsupported, moments: unsupported, media: unsupported, scenes: unsupported, zones: unsupported,
      preview: unsupported},
    desired: {power: unknown, brightness: unknown, mode: unknown}, observed: {status: 'known', observedAtMs: atMs, power: {status: 'known', value: true}, brightness: unknown},
    pending: 0, pendingKinds: [], lastOutcome: unknown, lastTransmission: unknown, externalControl: unknown});
  const read = () => publishers.wemo.publish('bunny.state.device.desk-lamp', {kind: 'state', type: 'org.bunny.device.updated', subject: 'desk-lamp',
    dataschema: 'https://bunny.invalid/events/device/2.4', data: plug(clock.now())});
  await read();
  assert.equal((await settle('bunny/modules/wemo', 1)).length, 1);
  clock.advance(5000);
  await read();
  // The confirmation writes no row to wait for; the intake takes messages in order, so a display change published after
  // it is a row that shows it was taken before the clock moves on.
  await show({...display, monitor: {...display.monitor, page: 1}, showing: 'dashboard'});
  assert.equal((await settle('bunny/modules/pixoo', 3)).length, 3);
  clock.advance(5 * 60_000);
  await read();
  const plugRows = await settle('bunny/modules/wemo', 2);
  assert.equal(plugRows.length, 2, 'one gap row when readings resume');
  assert.equal(plugRows[1].record.gapMs, 5 * 60_000);
});

test('the production-selected core warns on state changes published during module start', async t => {
  const [runtimeModules, {startRuntime}, {manualClock}] = await Promise.all([
    import('../../../apps/runtime/dist/src/modules.js'),
    import('../../../apps/runtime/dist/src/runtime.js'), import('../../../apps/runtime/dist/tests/scenarios/virtual-time.js'),
  ]);
  const root = await realpath(await mkdtemp(join(tmpdir(), 'gh1778-')));
  t.after(() => rm(root, {recursive: true, force: true}));
  const id = 'fixture-device';
  const module = {
    manifest: {name: 'volcano', apiVersion: '1.3',
      configure: () => ({config: {id, label: 'Synthetic private label'}, devices: []})},
    async start({sdk}) {
      for (let revision = 1; revision <= 121; revision++) {
        await sdk.publish(`bunny.state.device.${id}`, {
          kind: 'state', type: 'org.bunny.device.updated', subject: id, dataschema: 'https://bunny.invalid/events/device/2.4',
          data: {id, revision, available: revision % 2 === 0, label: 'Synthetic private label'},
        });
      }
    },
  };
  const config = {modules: {volcano: {}}, edge: productionEdge()};
  const prepared = entrypoint.productionModules(config, {
    ...runtimeModules, shippedModules: [runtimeModules.coreFactory, {name: 'volcano', create: () => module}],
  }, checkConfiguration, entrypoint.containerOptions({BUNNY_ACCESS: 'production', BUNNY_CONTROL: 'enabled'}));
  const warnings = [];
  const clock = manualClock();
  const runtime = await startRuntime({modules: prepared.modules, stateDir: join(root, 'state'), port: 0, config, clock, scheduler: clock.scheduler,
    log: record => { if (record.event_name === 'history.entity.noisy') warnings.push(record); }});
  try {
    assert.equal(runtime.health().status, 'ok');
    const core = prepared.modules[0];
    // Intake yields between groups. Let it run until the last startup row
    // commits, then check the warning from that same commit.
    for (let turn = 0; turn < 30 && core.history.read({source: 'bunny/modules/volcano'}).length < 121; turn++) await nextTurn();
    assert.equal(core.history.read({source: 'bunny/modules/volcano'}).length, 121);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].severity_text, 'WARN');
    assert.equal(warnings[0].schema_version, '1.9');
    assert.deepEqual(warnings[0].attributes, {'bunny.module': 'core', 'bunny.provenance': 'source',
      'bunny.participant': 'bunny/modules/volcano', 'bunny.history.family': 'device', 'bunny.history.entity_id': id,
      'bunny.history.row_count': 121, 'bunny.history.row_threshold': 120, 'bunny.history.hour_start_at_ms': clock.now()});
  } finally { await runtime.stop(); }
});
