import assert from 'node:assert/strict';
import {test} from 'node:test';
import {MUSIC_PRODUCER_SOURCE} from '@jimmie-potts/event-contracts/v2/music-capture';
import {parseCredentials, tokenDigest} from '../src/credentials.js';
import {edgePermissions, principalOf} from '../src/gateway/access.js';

const digest = tokenDigest('synthetic-music-token');
const credential = {id: 'music-producer', source: MUSIC_PRODUCER_SOURCE, digest, scopes: [], role: 'music-producer'};
const document = (entries: unknown[]) => ({schema: 'edge-credentials/1.0', credentials: entries});

test('music producer role requires its exact source and no additional authority', () => {
  assert.deepEqual(parseCredentials(document([credential])), [credential]);
  for (const patch of [{source: 'bunny/parts/other'}, {scopes: ['ingest']}, {scopes: ['read', 'control']}, {robotId: 'device-1'}]) {
    assert.throws(() => parseCredentials(document([{...credential, ...patch}])));
  }
  assert.throws(() => parseCredentials(document([{id: 'ordinary', source: MUSIC_PRODUCER_SOURCE, digest, scopes: ['read']}])));
});

test('music producer cannot read general state or call device commands', () => {
  const [selected] = parseCredentials(document([credential]));
  assert.ok(selected);
  const grant = edgePermissions(principalOf(selected));
  assert.deepEqual(grant.calls, []);
  assert.deepEqual(grant.keys, []);
  assert.deepEqual(grant.publishes, []);
  assert.deepEqual(grant.endpoint, {respond: ['music-capture-work'], publish: ['music-capture-progress', 'music-capture-features'], request: ['music-capture-endpoint']});
  for (const scopes of [['read'], ['control'], ['ingest'], ['read', 'control', 'ingest', 'admin']]) {
    const [ordinary] = parseCredentials(document([{id: 'ordinary', source: 'bunny/parts/ordinary', digest, scopes}]));
    assert.ok(ordinary);
    assert.equal(edgePermissions(principalOf(ordinary)).endpoint, undefined);
  }
});
