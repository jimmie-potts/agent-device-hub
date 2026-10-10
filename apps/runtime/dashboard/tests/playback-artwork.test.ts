import assert from 'node:assert/strict';
import test from 'node:test';
import type {PlaybackState} from '@jimmie-potts/event-contracts/v2/families';
import {playbackArtworkUrl} from '../src/playback-artwork.ts';
import type {ModuleEntry} from '../src/modules.ts';

const module: ModuleEntry = {name: 'speaker-owner', state: 'running', serves: ['playback'], pages: []};
const generation = 'abcdef00-0000-4000-8000-000000000001';
const record: PlaybackState = {id: 'living-room', revision: 2, availability: 'available',
  playback: {status: 'known', player: 'playing', title: 'Synthetic song', controls: ['pause']},
  artwork: {status: 'ready', generation, mediaType: 'image/png', width: 1, height: 1, base64: 'synthetic'}};
const url = (value = record, live = true, modules: readonly ModuleEntry[] | undefined = [module]): string | undefined =>
  playbackArtworkUrl(value, 'bunny/modules/speaker-owner', live, modules);

void test('the catalog selects the owner path and same-generation revisions select different native requests', () => {
  assert.equal(url(), `/modules/speaker-owner/content/artwork.${generation}.2`);
  assert.equal(url({...record, revision: 3}), `/modules/speaker-owner/content/artwork.${generation}.3`);
  assert.equal(url({...record, playback: {...record.playback, status: 'known', player: 'paused', controls: ['play']}}), url());
});

void test('stale, missing, invalid and ambiguous ownership retain a text-only card', () => {
  assert.equal(url(record, false), undefined);
  for (const modules of [undefined, [], [{...module, state: 'failed'}], [{...module, serves: ['device']}], [module, module]]) {
    assert.equal(playbackArtworkUrl(record, 'bunny/modules/speaker-owner', true, modules), undefined);
  }
  assert.equal(playbackArtworkUrl(record, 'bunny/modules/unknown', true, [module]), undefined);
  for (const variant of [
    {...record, artwork: undefined}, {...record, artwork: {status: 'missing', generation} as const},
    {...record, artwork: {status: 'unsupported', generation} as const}, {...record, availability: 'stale' as const},
    {...record, availability: 'unavailable' as const}, {...record, playback: {status: 'unknown'} as const},
    {...record, playback: {status: 'known', player: 'stopped', controls: []} as const},
    {...record, revision: 0}, {...record, revision: Number.MAX_SAFE_INTEGER + 1},
    {...record, artwork: {...record.artwork, status: 'ready', generation: 'bad'} as PlaybackState['artwork']},
  ]) assert.equal(url(variant as PlaybackState), undefined);
});
