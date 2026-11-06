import assert from 'node:assert/strict';
import {test} from 'node:test';
import {MUSIC_PLAYBACK_SOURCE} from '@jimmie-potts/event-contracts/v2/music-playback';
import {MUSIC_PRODUCER_SOURCE} from '@jimmie-potts/event-contracts/v2/music-capture';
import {parseCredentials, tokenDigest} from '../src/credentials.js';
import {edgePermissions, principalOf} from '../src/gateway/access.js';

const credential = {id: 'music-playback', source: MUSIC_PLAYBACK_SOURCE, digest: tokenDigest('synthetic-playback-token'), scopes: [], role: 'music-playback-producer'};
const document = (entries: unknown[]) => ({schema: 'edge-credentials/1.0', credentials: entries});
void test('playback producer has one fixed source and no inherited capture or operator authority', () => {
  assert.deepEqual(parseCredentials(document([credential])), [credential]);
  for (const patch of [{source: MUSIC_PRODUCER_SOURCE}, {source: 'bunny/parts/other'}, {scopes: ['read']}, {scopes: ['control']},
    {scopes: ['ingest']}, {robotId: 'device-1'}, {role: 'music-producer'}, {role: undefined}]) {
    assert.throws(() => parseCredentials(document([{...credential, ...patch}])));
  }
  const selected = parseCredentials(document([credential]))[0];
  assert.ok(selected);
  const grant = edgePermissions(principalOf(selected));
  assert.deepEqual([grant.calls, grant.keys, grant.publishes], [[], [], []]);
  assert.deepEqual(grant.endpoint, {respond: ['music-playback-work'], publish: ['music-playback-observation', 'music-playback-result'], request: ['music-playback-endpoint']});
  const capture = parseCredentials(document([{...credential, source: MUSIC_PRODUCER_SOURCE, role: 'music-producer'}]))[0];
  assert.ok(capture);
  assert.deepEqual(edgePermissions(principalOf(capture)).endpoint,
    {respond: ['music-capture-work'], publish: ['music-capture-progress', 'music-capture-features'], request: ['music-capture-endpoint']});
});
