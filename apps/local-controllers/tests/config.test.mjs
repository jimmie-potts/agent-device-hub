import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadHostConfig } from '@jimmie-potts/local-controllers';
import { bulb, privateFiles } from './helpers.mjs';

const rejects = (path) => assert.throws(() => loadHostConfig(path), error => error.message === 'invalid-host-config' && !/sentinel|192\.0\.2|local-controllers-/.test(error.stack));

test('a private configuration loads the Tidbyt runner file and the LIFX bulbs', t => {
  const s = privateFiles(t);
  const config = loadHostConfig(s.write('host.json', s.host));
  assert.equal(config.port, 0);
  assert.equal(config.tidbyt.credentials.deviceId, 'device');
  assert.deepEqual(config.lifx.bulbs.map(b => b.deviceId), ['desk', 'shelf']);
  assert.deepEqual(config.credentials.map(c => c.id), ['bunny-hub', 'reader', 'tidbyt-only']);
  const { lifx, ...tidbytOnly } = s.host;
  tidbytOnly.credentials = [{ ...s.host.credentials[2] }];
  assert.equal(loadHostConfig(s.write('tidbyt.json', tidbytOnly)).lifx, undefined);
  const { tidbyt, ...lifxOnly } = s.host;
  lifxOnly.credentials = [{ ...s.host.credentials[0], devices: ['desk'] }];
  assert.equal(loadHostConfig(s.write('lifx.json', lifxOnly)).tidbyt, undefined);
});

test('a per-bulb status block and the host-level status feed load with their defaults applied by the publisher, not the loader', t => {
  const s = privateFiles(t);
  const tokenFile = s.write('lifx-status-token', 't'.repeat(43));
  const value = {
    ...s.host,
    lifx: {
      ...s.host.lifx,
      status: { hubUrl: 'http://127.0.0.1:9', ownerId: 'owner', tokenFile },
      bulbs: [{ ...s.host.lifx.bulbs[0], status: { brightnessCapPercent: 40, quietCapPercent: 10 } }, s.host.lifx.bulbs[1]],
    },
  };
  const config = loadHostConfig(s.write('host.json', value));
  assert.deepEqual(config.lifx.status, { hubUrl: 'http://127.0.0.1:9', ownerId: 'owner', token: 't'.repeat(43) });
  assert.deepEqual(config.lifx.bulbs[0].status, { brightnessCapPercent: 40, quietCapPercent: 10 });
  assert.equal(config.lifx.bulbs[1].status, undefined, 'a bulb without a status block stays unconfigured for painting');
});

test('an invalid status feed or per-bulb cap fails before anything starts', t => {
  const s = privateFiles(t);
  const tokenFile = s.write('lifx-status-token', 't'.repeat(43));
  const status = { hubUrl: 'http://127.0.0.1:9', ownerId: 'owner', tokenFile };
  const variants = {
    'bad hub url': { ...s.host, lifx: { ...s.host.lifx, status: { ...status, hubUrl: 'https://127.0.0.1:9' } } },
    'bad owner id': { ...s.host, lifx: { ...s.host.lifx, status: { ...status, ownerId: '' } } },
    'unknown status field': { ...s.host, lifx: { ...s.host.lifx, status: { ...status, extra: 1 } } },
    'missing token file': { ...s.host, lifx: { ...s.host.lifx, status: { ...status, tokenFile: join(s.dir, 'missing') } } },
    'cap below range': { ...s.host, lifx: { ...s.host.lifx, status, bulbs: [{ ...s.host.lifx.bulbs[0], status: { brightnessCapPercent: 0 } }, s.host.lifx.bulbs[1]] } },
    'cap above range': { ...s.host, lifx: { ...s.host.lifx, status, bulbs: [{ ...s.host.lifx.bulbs[0], status: { quietCapPercent: 101 } }, s.host.lifx.bulbs[1]] } },
    'fractional cap': { ...s.host, lifx: { ...s.host.lifx, status, bulbs: [{ ...s.host.lifx.bulbs[0], status: { brightnessCapPercent: 40.5 } }, s.host.lifx.bulbs[1]] } },
    'unknown per-bulb status field': { ...s.host, lifx: { ...s.host.lifx, status, bulbs: [{ ...s.host.lifx.bulbs[0], status: { extra: 1 } }, s.host.lifx.bulbs[1]] } },
  };
  for (const [name, value] of Object.entries(variants)) {
    const path = s.write('host.json', value);
    assert.throws(() => loadHostConfig(path), { message: 'invalid-host-config' }, name);
  }
});

test('unsafe files are refused without echoing their contents', t => {
  const s = privateFiles(t);
  const path = s.write('host.json', s.host);
  chmodSync(path, 0o640); rejects(path); chmodSync(path, 0o600);
  chmodSync(s.runnerConfig, 0o644); rejects(path); chmodSync(s.runnerConfig, 0o600);
  const link = join(s.dir, 'link.json'); symlinkSync(path, link); rejects(link);
  rejects('relative.json');
  writeFileSync(path, 'x'.repeat(20000), { mode: 0o600 }); rejects(path);
  writeFileSync(path, '{"sentinel": ', { mode: 0o600 }); rejects(path);
  writeFileSync(path, JSON.stringify(s.host));
  mkdirSync(join(s.dir, '.git')); writeFileSync(join(s.dir, '.git/HEAD'), 'ref: refs/heads/main');
  rejects(path);
});

test('invalid fields, devices and credentials fail before anything starts', t => {
  const s = privateFiles(t);
  const variants = {
    'unknown field': { ...s.host, sentinel: true },
    'no devices': { port: 0, credentials: s.host.credentials.map(c => ({ ...c, devices: ['tidbyt'] })) },
    'port': { ...s.host, port: 70000 },
    'runner block': { ...s.host, tidbyt: { runnerConfig: s.runnerConfig, extra: 1 } },
    'missing runner file': { ...s.host, tidbyt: { runnerConfig: join(s.dir, 'missing.json') } },
    'bulb named tidbyt': { ...s.host, lifx: { ...s.host.lifx, bulbs: [bulb('tidbyt', '192.0.2.10')] } },
    'duplicate bulb': { ...s.host, lifx: { ...s.host.lifx, bulbs: [bulb('desk', '192.0.2.10'), bulb('desk', '192.0.2.11')] } },
    'shared address': { ...s.host, lifx: { ...s.host.lifx, bulbs: [bulb('desk', '192.0.2.10'), bulb('shelf', '192.0.2.10')] } },
    'hostname': { ...s.host, lifx: { ...s.host.lifx, bulbs: [bulb('desk', 'lamp.local')] } },
    'broadcast': { ...s.host, lifx: { ...s.host.lifx, bulbs: [bulb('desk', '192.0.2.255')] } },
    'bulb field': { ...s.host, lifx: { ...s.host.lifx, bulbs: [{ ...bulb('desk', '192.0.2.10'), port: 56700 }] } },
    'no bulbs': { ...s.host, lifx: { ...s.host.lifx, bulbs: [] } },
    'retries': { ...s.host, lifx: { ...s.host.lifx, retries: 9 } },
    'no credentials': { ...s.host, credentials: [] },
    'unconfigured device': { ...s.host, credentials: [{ ...s.host.credentials[0], devices: ['desk', 'hall'] }] },
    'digest': { ...s.host, credentials: [{ ...s.host.credentials[0], digest: 'plain-token' }] },
    'scope': { ...s.host, credentials: [{ ...s.host.credentials[0], scopes: ['admin'] }] },
    'no scopes': { ...s.host, credentials: [{ ...s.host.credentials[0], scopes: [] }] },
    'duplicate id': { ...s.host, credentials: [s.host.credentials[0], { ...s.host.credentials[1], id: 'bunny-hub' }] },
    'duplicate digest': { ...s.host, credentials: [s.host.credentials[0], { ...s.host.credentials[1], digest: s.host.credentials[0].digest }] },
    'credential field': { ...s.host, credentials: [{ ...s.host.credentials[0], token: 'sentinel' }] },
  };
  for (const [name, value] of Object.entries(variants)) {
    const path = s.write('host.json', value);
    assert.throws(() => loadHostConfig(path), { message: 'invalid-host-config' }, name);
  }
});
