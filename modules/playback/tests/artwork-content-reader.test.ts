import assert from 'node:assert/strict';
import test from 'node:test';
import type {PlaybackArtwork, PlaybackState} from '@jimmie-potts/event-contracts/v2/families';
import {readArtworkContent, type CurrentArtworkRead} from '../src/artwork-content.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQsUn5DwAC0AG0vqck9wAAAABJRU5ErkJggg==', 'base64');
const PNG_B = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGM4ISLyHwAEiAHwkp1qPAAAAABJRU5ErkJggg==', 'base64');
const GENERATION = '00000000-0000-4000-8000-000000000001';
const IMAGE = {status: 'ready', generation: GENERATION, mediaType: 'image/png', width: 1, height: 1, base64: PNG.toString('base64')} as const;
const RECORD: PlaybackState = {id: 'living-room', revision: 5, availability: 'available', observedAtMs: 100,
  playback: {status: 'known', player: 'playing', title: 'Synthetic song', controls: ['pause']}, artwork: IMAGE};
const REF = `artwork.${GENERATION}.5`;
const state = (): CurrentArtworkRead => ({record: structuredClone(RECORD), current: structuredClone(IMAGE), stopped: false,
  presentedSonyIsEligible: true, presentedMetadataMatchesRecord: true});

void test('current bytes are copied; reference parsing admits only the exact canonical current identity', () => {
  const current = state();
  const first = readArtworkContent(REF, current);
  assert.ok(first !== undefined && 'bytes' in first); assert.deepEqual(first.bytes, new Uint8Array(PNG));
  first.bytes[0] = 0;
  const second = readArtworkContent(REF, current);
  assert.ok(second !== undefined && 'bytes' in second); assert.deepEqual(second.bytes, new Uint8Array(PNG));
  for (const ref of ['', 'artwork.invalid.5', `artwork.${GENERATION}.0`,
    `artwork.${GENERATION}.05`, `artwork.${GENERATION}.-1`, `artwork.${GENERATION}.5.1`, `artwork.${GENERATION}.6`,
    `artwork.${GENERATION}.9007199254740992`, `artwork.${GENERATION}.5?x=1`, 'a'.repeat(129)]) {
    assert.equal(readArtworkContent(ref, current), undefined, ref);
  }
  const mixed = 'abcdef00-0000-4000-8000-000000000001';
  const image = {...IMAGE, generation: mixed};
  assert.equal(readArtworkContent(`artwork.${mixed.toUpperCase()}.5`, {...current, current: image, record: {...RECORD, artwork: image}}), undefined);
});

void test('private observation disagreement and every retired eligibility refuse an unchanged committed reference', () => {
  const current = state();
  const variants: Partial<CurrentArtworkRead>[] = [
    {record: undefined}, {current: undefined}, {stopped: true}, {presentedSonyIsEligible: false}, {presentedMetadataMatchesRecord: false},
    {current: {status: 'missing', generation: GENERATION}}, {current: {status: 'unsupported', generation: GENERATION}},
    {current: {...IMAGE, generation: '00000000-0000-4000-8000-000000000002'}}, {current: {...IMAGE, base64: PNG_B.toString('base64')}},
    {current: {...IMAGE, width: 2}}, {record: {id: RECORD.id, revision: RECORD.revision, availability: RECORD.availability, playback: RECORD.playback}},
    {record: {...RECORD, availability: 'stale'}}, {record: {...RECORD, availability: 'unavailable'}},
    {record: {...RECORD, artwork: {status: 'missing', generation: GENERATION}}},
    {record: {...RECORD, playback: {status: 'unknown'}}},
    {record: {...RECORD, playback: {status: 'known', player: 'stopped', controls: []}}},
  ];
  for (const variant of variants) assert.equal(readArtworkContent(REF, {...current, ...variant}), undefined);
  const imageB = {...IMAGE, base64: PNG_B.toString('base64')};
  const readB = readArtworkContent(`artwork.${GENERATION}.6`, {...current, current: imageB, record: {...RECORD, revision: 6, artwork: imageB}});
  assert.ok(readB !== undefined && 'bytes' in readB); assert.deepEqual(readB.bytes, new Uint8Array(PNG_B));
  assert.deepEqual(current, state(), 'reads never mutate the committed/private inputs or freshness');
});

void test('bounded canonical PNG content refuses malformed encoding, dimensions and animated/trailing chunks', () => {
  const chunk = Buffer.alloc(12); chunk.write('acTL', 4);
  const badHeader = Buffer.from(PNG); badHeader[24] = 7;
  const variants = [
    {...IMAGE, base64: ''}, {...IMAGE, base64: `${IMAGE.base64}\n`}, {...IMAGE, base64: IMAGE.base64.slice(0, -2)},
    {...IMAGE, base64: Buffer.alloc(65_537).toString('base64')}, {...IMAGE, base64: Buffer.from('not PNG').toString('base64')},
    {...IMAGE, width: 0}, {...IMAGE, height: 129}, {...IMAGE, width: 1.5}, {...IMAGE, width: 2},
    {...IMAGE, base64: badHeader.toString('base64')}, {...IMAGE, base64: PNG.subarray(0, -1).toString('base64')},
    {...IMAGE, base64: Buffer.concat([PNG, Buffer.from([0])]).toString('base64')},
    {...IMAGE, base64: Buffer.concat([PNG.subarray(0, 33), chunk, PNG.subarray(33)]).toString('base64')},
    // A private boundary test may present malformed data that public contract validation would reject earlier.
    {...IMAGE, mediaType: 'image/jpeg'},
  ];
  for (const value of variants) {
    const image = value as PlaybackArtwork;
    assert.equal(readArtworkContent(REF, {...state(), current: image, record: {...RECORD, artwork: image}}), undefined);
  }
});
