import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {MessageValidator} from '../dist/v2/index.js';
import {registerCoreFamilies} from '../dist/v2/families.js';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/v2/families.json', import.meta.url), 'utf8'));
const original = Object.values(fixtures.valid).find(message => message.dataschema === 'https://bunny.invalid/events/playback/2.0' && message.data.playback.player === 'playing');
const generation = '12345678-1234-4234-8234-123456789abc';
// Synthetic one-pixel PNG, independent of the production normalizer.
const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQsUn5DwAC0AG0vqck9wAAAABJRU5ErkJggg==';
const ready = {status: 'ready', generation, mediaType: 'image/png', width: 1, height: 1, base64};
const record = (artwork = ready) => ({...structuredClone(original), dataschema: 'https://bunny.invalid/events/playback/2.1', data: {...structuredClone(original.data), artwork}});
const validate = message => {
  const v = new MessageValidator();
  registerCoreFamilies(v);
  return v.validate(message);
};

test('playback 2.1 shares bounded artwork while the closed 2.0 contract is unchanged', () => {
  assert.equal(validate(original).ok, true);
  for (const artwork of [ready, {status: 'missing', generation}, {status: 'unsupported', generation}]) {
    assert.equal(validate(record(artwork)).ok, true, JSON.stringify(validate(record(artwork))));
  }
  const old = record(); old.dataschema = original.dataschema;
  assert.equal(validate(old).ok, false);
  const text = record(); delete text.data.artwork;
  assert.equal(validate(text).ok, true);
});

test('malformed encoding, bytes, dimensions, association and versions are refused', () => {
  for (const patch of [
    {base64: base64 + '\n'}, {base64: 'AAAA'}, {base64: base64.replace(/=+$/, '')},
    {base64: Buffer.alloc(65_537).toString('base64')}, {width: 129}, {height: 0}, {width: 2},
    {mediaType: 'image/jpeg'}, {generation: 'private-track-name'}, {url: 'http://127.0.0.1:9000/private'},
  ]) assert.equal(validate(record({...ready, ...patch})).ok, false, JSON.stringify(patch).slice(0, 150));
  for (const player of ['stopped', 'inactive', 'unknown']) {
    const message = record(); message.data.playback.player = player;
    assert.equal(validate(message).ok, false, player);
  }
  const unavailable = record(); unavailable.data.availability = 'unavailable'; unavailable.data.playback = {status: 'unknown'};
  assert.equal(validate(unavailable).ok, false);
  const version = record(); version.dataschema = 'https://bunny.invalid/events/playback/2.2';
  assert.equal(validate(version).ok, false);
});

test('maximum artwork remains within the complete envelope capacity', () => {
  const bytes = Buffer.alloc(65_536);
  Buffer.from(base64, 'base64').copy(bytes);
  const message = record({...ready, base64: bytes.toString('base64')});
  assert.equal(validate(message).ok, true);
  assert.ok(Buffer.byteLength(JSON.stringify(message)) < 256 * 1024);
});
