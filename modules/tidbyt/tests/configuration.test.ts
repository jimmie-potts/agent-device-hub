// The Tidbyt module's section and the conversion of the old runner's configuration (Hub #919, #930). The credentials
// cases are copied from controllers/tidbyt/tests/connection.test.mjs at main 627e3fe3; the conversion reads no file,
// so the file permission cases stay with the installer (#935), which reads the runner's private files.
import assert from 'node:assert/strict';
import test from 'node:test';
import {checkConfiguration} from '@jimmie-potts/sdk';
import {configureTidbyt, convertTidbytRunner, parseRunnerCredentials, playbackIdOf} from '../src/configuration.js';
import {createTidbytModule} from '../src/module.js';
import {SimulatedCloud} from '../src/simulated.js';
import {SECTION} from './support.js';

const DEVICE = 'synthetic-device-id';
const KEY = 'synthetic-secret-key.abc';
const RUNNER = {hubUrl: 'http://127.0.0.1:8788', ownerId: 'owner', tokenFile: '/private/hub-read-token', credentialsFile: '/private/tidbyt.env'};
const manifest = createTidbytModule({transport: new SimulatedCloud().fetch}).manifest;
const refusedDetail = (answer: unknown): string => {
  assert.ok(typeof answer === 'object' && answer !== null && 'error' in answer, 'a refusal');
  const {error} = answer as {error: {code: string; detail?: string}};
  assert.equal(error.code, 'invalid-request');
  return error.detail ?? '';
};

void test('the section names the device, the cloud device, both installations, the playback record and the API key\'s file', () => {
  const configured = configureTidbyt(SECTION);
  assert.deepEqual(configured, {
    config: {id: 'tidbyt', cloudDeviceId: 'simulated-tidbyt', statusInstallation: 'agentdevicehub', nowPlaying: {playback: 'living-room', installation: 'nowplaying'}},
    devices: ['tidbyt'],
  });
  const defaults = configureTidbyt({id: 'tidbyt', cloudDeviceId: DEVICE, nowPlaying: {playback: 'living-room'}, secrets: {token: '/private/token'}});
  assert.deepEqual(defaults, {
    config: {id: 'tidbyt', cloudDeviceId: DEVICE, statusInstallation: 'agentdevicehub', nowPlaying: {playback: 'living-room', installation: 'nowplaying'}},
    devices: ['tidbyt'],
  }, 'the runner\'s default installations');
  const statusOnly = configureTidbyt({id: 'tidbyt', cloudDeviceId: DEVICE, statusInstallation: 'agentstatus', secrets: {token: '/private/token'}});
  assert.deepEqual(statusOnly, {config: {id: 'tidbyt', cloudDeviceId: DEVICE, statusInstallation: 'agentstatus'}, devices: ['tidbyt']});
  const checked = checkConfiguration(manifest, SECTION);
  assert.equal(checked.status, 'accepted', 'the runtime would admit the section');
});

void test('a section the module cannot use is refused with fixed text that repeats no value', () => {
  const sections: unknown[] = [
    undefined, [], 'tidbyt', {...SECTION, extra: true}, {...SECTION, id: 'Tidbyt'}, {...SECTION, id: 'a'.repeat(129)},
    {...SECTION, cloudDeviceId: 'a/b'}, {...SECTION, cloudDeviceId: ''}, {...SECTION, statusInstallation: 'has-dash'},
    {...SECTION, nowPlaying: {playback: 'Living Room'}}, {...SECTION, nowPlaying: {playback: 'living-room', installation: 'agentdevicehub'}},
    {...SECTION, nowPlaying: {playback: 'living-room', extra: 1}}, {...SECTION, nowPlaying: 'living-room'},
    {...SECTION, secrets: {}}, {...SECTION, secrets: {key: '/private/key'}}, (({secrets: _secrets, ...rest}) => rest)(SECTION),
  ];
  for (const section of sections) {
    const detail = refusedDetail(configureTidbyt(section));
    for (const value of ['simulated-tidbyt', 'a/b', 'Living Room', 'has-dash', '/private/key']) assert.ok(!detail.includes(value), `${detail} repeats ${value}`);
  }
});

void test('the conversion keeps the cloud device and both installation IDs, so no tile is left behind', () => {
  const credentials = `# private\nTIDBYT_DEVICE_ID=${DEVICE}\nTIDBYT_API_KEY="${KEY}"\nTIDBYT_INSTALLATION_ID=agentstatus\n`;
  const converted = convertTidbytRunner({...RUNNER, nowPlaying: {tokenFile: '/private/playback-token', sourceId: 'living-room', installationId: 'nowplaying2'}}, credentials);
  assert.deepEqual(converted, {
    section: {id: 'tidbyt', cloudDeviceId: DEVICE, statusInstallation: 'agentstatus', nowPlaying: {playback: 'living-room', installation: 'nowplaying2'}},
    apiKey: KEY,
  });
  if (!('section' in converted)) throw new Error('refused');
  // The installer adds the API key's file; the runtime then admits the section as it is.
  const configured = configureTidbyt({...converted.section, secrets: {token: '/private/tidbyt-token'}});
  assert.ok('config' in configured && configured.config.statusInstallation === 'agentstatus' && configured.config.nowPlaying?.installation === 'nowplaying2');
});

void test('the conversion keeps the runner\'s defaults, renames a 1.x source ID by the playback module\'s rule, and carries no Hub token', () => {
  const credentials = `TIDBYT_DEVICE_ID=${DEVICE}\nTIDBYT_API_KEY=${KEY}\n`;
  assert.deepEqual(convertTidbytRunner(RUNNER, credentials), {section: {id: 'tidbyt', cloudDeviceId: DEVICE, statusInstallation: 'agentdevicehub'}, apiKey: KEY});
  const renamed = convertTidbytRunner({...RUNNER, nowPlaying: {tokenFile: '/private/playback-token', sourceId: 'HT-A9'}}, credentials);
  assert.deepEqual(renamed, {
    section: {id: 'tidbyt', cloudDeviceId: DEVICE, statusInstallation: 'agentdevicehub', nowPlaying: {playback: 'ht-a9', installation: 'nowplaying'}},
    apiKey: KEY, renamedFrom: 'HT-A9',
  });
  assert.ok(!JSON.stringify(renamed).includes('/private/'), 'no Hub token file or URL is carried');
  assert.deepEqual(['HT-A9', 'living_room.1', '___', 'living-room'].map(playbackIdOf), ['ht-a9', 'living-room-1', 'playback', 'living-room']);
});

void test('a runner configuration or credentials file the runner would refuse is refused, never repeating a value', () => {
  const good = `TIDBYT_DEVICE_ID=${DEVICE}\nTIDBYT_API_KEY=${KEY}\n`;
  const runners: unknown[] = [
    undefined, [], {...RUNNER, extra: 1}, (({tokenFile: _token, ...rest}) => rest)(RUNNER), {...RUNNER, nowPlaying: {sourceId: 'living-room'}},
    {...RUNNER, nowPlaying: {tokenFile: '/private/t', sourceId: 'a b'}}, {...RUNNER, nowPlaying: {tokenFile: '/private/t', sourceId: 'x', installationId: 'agentdevicehub'}},
    {...RUNNER, nowPlaying: {tokenFile: '/private/t', sourceId: 'x', installationId: 'bad-id'}},
  ];
  for (const runner of runners) refusedDetail(convertTidbytRunner(runner, good));
  const credentials = [
    `TIDBYT_DEVICE_ID=${DEVICE}\n`, `TIDBYT_DEVICE_ID=${DEVICE}\nTIDBYT_API_KEY=${KEY}\nTIDBYT_API_KEY=${KEY}\n`,
    `TIDBYT_DEVICE_ID=${DEVICE}\nTIDBYT_API_KEY=${KEY}\nTIDBYT_INSTALLATION_ID=bad-id\n`, `TIDBYT_DEVICE_ID=${DEVICE}\nTIDBYT_API_KEY=${KEY}\nOTHER=${KEY}\n`,
    `TIDBYT_DEVICE_ID=a/b\nTIDBYT_API_KEY=${KEY}\n`, '',
  ];
  for (const text of credentials) {
    const detail = refusedDetail(convertTidbytRunner(RUNNER, text));
    assert.ok(!detail.includes(KEY) && !detail.includes(DEVICE), 'the refusal repeats no credential');
  }
});

void test('the runner\'s credentials file parses as the runner parsed it', () => {
  assert.deepEqual(parseRunnerCredentials(`# comment\nTIDBYT_DEVICE_ID=${DEVICE}\nTIDBYT_API_KEY="${KEY}"\n`), {deviceId: DEVICE, apiKey: KEY, installationId: 'agentdevicehub'});
  assert.deepEqual(parseRunnerCredentials(`TIDBYT_DEVICE_ID=${DEVICE}\r\nTIDBYT_API_KEY='${KEY}'\r\nTIDBYT_INSTALLATION_ID=agentstatus\r\n`)?.installationId, 'agentstatus');
  for (const text of [`TIDBYT_DEVICE_ID=${DEVICE}\n`, `=${KEY}\n`, `TIDBYT_DEVICE_ID=\nTIDBYT_API_KEY=${KEY}\n`]) assert.equal(parseRunnerCredentials(text), undefined);
});
