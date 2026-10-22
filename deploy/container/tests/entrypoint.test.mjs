import assert from 'node:assert/strict';
import {test} from 'node:test';
import {checkLocalBrowserConfig, checkLocalBrowserCredentials, containerOptions} from '../entrypoint.mjs';

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

test('browser-only configuration refuses devices, unselected references and other access methods', () => {
  const valid = {modules: {}, edge: {credentials: '/run/secrets/bunny/edge.json', browserAccess: 'trusted-loopback', launcher: false, mcp: false}};
  checkLocalBrowserConfig(valid);
  for (const change of [
    config => {config.modules.pixoo = {};}, config => {delete config.edge;},
    config => {config.edge.credentials = '/elsewhere/private';},
    config => {config.edge.browserAccess = undefined;}, config => {config.edge.launcher = true;},
    config => {config.edge.mcp = true;},
    config => {config.edge.wifiProxy = {};},
  ]) {const config = structuredClone(valid); change(config); assert.throws(() => checkLocalBrowserConfig(config));}
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
