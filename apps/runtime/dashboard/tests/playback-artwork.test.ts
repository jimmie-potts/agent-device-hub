import assert from 'node:assert/strict';
import test from 'node:test';
import type {PlaybackState} from '@jimmie-potts/event-contracts/v2/families';
import {playbackArtwork, type ArtworkRequest} from '../src/playback-artwork.ts';
import type {ModuleEntry} from '../src/modules.ts';

const module: ModuleEntry = {name: 'speaker-owner', state: 'running', serves: ['playback'], pages: []};
const generation = 'abcdef00-0000-4000-8000-000000000001';
const record: PlaybackState = {id: 'living-room', revision: 2, availability: 'available',
  playback: {status: 'known', player: 'playing', title: 'Synthetic song', controls: ['pause']},
  artwork: {status: 'ready', generation, mediaType: 'image/png', width: 1, height: 1, base64: 'synthetic'}};
const artwork = (value = record, live = true, modules: readonly ModuleEntry[] | undefined = [module]): ArtworkRequest | undefined =>
  playbackArtwork(value, 'bunny/modules/speaker-owner', live, modules);
const url = (value = record, live = true, modules: readonly ModuleEntry[] | undefined = [module]): string | undefined => artwork(value, live, modules)?.src;

void test('the catalog selects the owner path and same-generation revisions select different native requests', () => {
  assert.equal(url(), `/modules/speaker-owner/content/artwork.${generation}.2`);
  assert.equal(url({...record, revision: 3}), `/modules/speaker-owner/content/artwork.${generation}.3`);
  assert.equal(url({...record, playback: {...record.playback, status: 'known', player: 'paused', controls: ['play']}}), url());
});

void test('one owner generation keeps its image identity across revisions; another generation or owner does not (#1569)', () => {
  assert.equal(artwork()?.image, `speaker-owner:${generation}`);
  assert.equal(artwork({...record, revision: 3})?.image, artwork()?.image);
  const next = {...record, revision: 3, artwork: {...record.artwork, status: 'ready', generation: 'abcdef00-0000-4000-8000-000000000002'}} as PlaybackState;
  assert.notEqual(artwork(next)?.image, artwork()?.image);
  const other: ModuleEntry = {...module, name: 'other-owner'};
  assert.notEqual(playbackArtwork(record, 'bunny/modules/other-owner', true, [other])?.image, artwork()?.image);
});

void test('stale, missing, invalid and ambiguous ownership retain a text-only card', () => {
  assert.equal(url(record, false), undefined);
  for (const modules of [undefined, [], [{...module, state: 'failed'}], [{...module, serves: ['device']}], [module, module]]) {
    assert.equal(playbackArtwork(record, 'bunny/modules/speaker-owner', true, modules), undefined);
  }
  assert.equal(playbackArtwork(record, 'bunny/modules/unknown', true, [module]), undefined);
  for (const variant of [
    {...record, artwork: undefined}, {...record, artwork: {status: 'missing', generation} as const},
    {...record, artwork: {status: 'unsupported', generation} as const}, {...record, availability: 'stale' as const},
    {...record, availability: 'unavailable' as const}, {...record, playback: {status: 'unknown'} as const},
    {...record, playback: {status: 'known', player: 'stopped', controls: []} as const},
    {...record, revision: 0}, {...record, revision: Number.MAX_SAFE_INTEGER + 1},
    {...record, artwork: {...record.artwork, status: 'ready', generation: 'bad'} as PlaybackState['artwork']},
  ]) assert.equal(url(variant as PlaybackState), undefined);
});
