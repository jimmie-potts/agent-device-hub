// Explicit disposable-container exercise. It never accepts a production target or host credential.
import assert from 'node:assert/strict';
import {mkdtemp, realpath, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {test} from 'node:test';
import {checkConfiguration} from '../../../packages/sdk/dist/src/index.js';
import * as runtimeModules from '../../../apps/runtime/dist/src/modules.js';
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
