import assert from 'node:assert/strict';
import test from 'node:test';
import type {ArtworkSummary} from '@jimmie-potts/event-contracts/v2/art-state';
import {backdropEvidence, backdropLoader, NO_BACKDROP, type ArtBackdrop} from '../src/frontend/backdrop.js';
import {browserArt, type BrowserArt} from '../src/frontend/model.js';
import {combinePresentation, type ArtPresentation} from '../src/frontend/presentation.js';

const digest = (seed: string): string => seed.repeat(64).slice(0, 64);
const artwork = (seed: string): ArtworkSummary => ({artworkId: `synthetic-${seed}`, createdAtMs: 1, favorite: false, feedback: null, variationOf: null,
  palette: ['#112233'], provenance: {generatedBy: 'local', factual: false}, compositions: [{target: 'ui', compositionId: digest(`c${seed}`), outcome: 'succeeded', motion: 'still', renditions: [
    {renditionId: digest(`s${seed}`), ref: `rendition.${digest(`s${seed}`)}`, width: 768, height: 512, bytes: 40, frames: 1, durationMs: 0, format: 'webp'},
    {renditionId: digest(`l${seed}`), ref: `rendition.${digest(`l${seed}`)}`, width: 1536, height: 1024, bytes: 80, frames: 1, durationMs: 0, format: 'webp'}]}]});
const large = (seed: string): BrowserArt => {const art = browserArt(artwork(seed), false);assert.ok(art !== undefined);return art;};
const settled = (): Promise<void> => new Promise(resolve => {setTimeout(resolve, 0);});

type FakeBitmap = {width: number; height: number; closed: boolean; close: () => void};
/** A content route whose answers the test releases one by one, and a decoder that records every bitmap it made. */
function world() {
  const requests: string[] = [], answers = new Map<string, {resolve: (blob: Blob) => void; reject: (error: Error) => void}>();
  const bitmaps: FakeBitmap[] = [], published: ArtBackdrop[] = [];
  const api = {image: (path: string): Promise<Blob> => {requests.push(path);return new Promise<Blob>((resolve, reject) => {answers.set(path, {resolve, reject});});}};
  // The synthetic large rendition is 80 bytes and decodes to 1536x1024; anything else decodes to the card size.
  const decode = (blob: Blob): Promise<ImageBitmap> => {
    const bitmap: FakeBitmap = {width: blob.size === 80 ? 1536 : 768, height: blob.size === 80 ? 1024 : 512, closed: false, close() {bitmap.closed = true;}};
    bitmaps.push(bitmap);return Promise.resolve(bitmap as unknown as ImageBitmap);
  };
  const loader = backdropLoader(api, value => {published.push(value);}, decode);
  const path = (art: BrowserArt): string => `/modules/art/content/${art.rendition.ref}`;
  const answer = async (art: BrowserArt, body: Blob = new Blob([new Uint8Array(art.rendition.bytes)], {type: 'image/webp'})): Promise<void> => {
    const pending = answers.get(path(art));assert.ok(pending !== undefined, `a request for ${art.rendition.ref}`);answers.delete(path(art));
    pending.resolve(body);await settled();
  };
  const fail = async (art: BrowserArt): Promise<void> => {answers.get(path(art))?.reject(new Error('unavailable'));answers.delete(path(art));await settled();};
  const last = (): ArtBackdrop => published.at(-1) ?? NO_BACKDROP;
  const closed = (value: ArtBackdrop['image']): boolean | undefined => bitmaps.find(bitmap => (bitmap as unknown) === value?.bitmap)?.closed;
  return {loader, requests, bitmaps, published, answer, fail, last, path, closed};
}

void test('the backdrop loads the largest still once and publishes its identity, size and palette', async () => {
  const {loader, requests, answer, last, path, published} = world(), art = large('a');
  loader.want({status: 'select', art});
  assert.deepEqual(last(), {status: 'loading', image: null});
  loader.want({status: 'select', art});
  await answer(art);
  const image = last().image;assert.ok(image !== null);assert.equal(last().status, 'ready');
  assert.deepEqual({...image, bitmap: null}, {bitmap: null, width: 1536, height: 1024, artworkId: 'synthetic-a',
    compositionId: art.compositionId, renditionId: art.rendition.renditionId, palette: ['#112233']});
  const count = published.length;
  loader.want({status: 'select', art: large('a')});
  assert.deepEqual(requests, [path(art)], 'one content request per rendition, also for an equal record update');
  assert.equal(published.length, count, 'an unchanged selection publishes nothing new');
});

void test('another artwork with the same rendition reuses its decoded bitmap under its own identity', async () => {
  const {loader, requests, answer, last, bitmaps} = world(), first = large('a');
  const twin: BrowserArt = {...first, artwork: {...first.artwork, artworkId: 'synthetic-twin', palette: ['#445566']}, compositionId: digest('t')};
  loader.want({status: 'select', art: first});loader.want({status: 'select', art: twin});
  await answer(first);
  assert.deepEqual([last().status, last().image?.artworkId, last().image?.compositionId, last().image?.palette], ['ready', 'synthetic-twin', digest('t'), ['#445566']]);
  loader.want({status: 'select', art: first});
  assert.deepEqual([last().status, last().image?.artworkId, last().image?.bitmap], ['ready', 'synthetic-a', bitmaps[0]]);
  assert.equal(requests.length, 1);assert.equal(bitmaps.length, 1);
});

void test('a slow or failing newer image keeps the previous ready image', async () => {
  const {loader, answer, fail, last, closed} = world(), first = large('a'), second = large('b');
  loader.want({status: 'select', art: first});await answer(first);
  const kept = last().image;assert.ok(kept !== null);
  loader.want({status: 'select', art: second});
  assert.deepEqual(last(), {status: 'loading', image: kept});
  await fail(second);
  assert.deepEqual(last(), {status: 'unavailable', image: kept});
  for (const status of ['loading', 'stale', 'unavailable'] as const) {loader.want({status});assert.deepEqual(last(), {status, image: kept});}
  assert.equal(closed(kept), false);
});

void test('bytes or dimensions that do not match the record never replace the image', async () => {
  const {loader, answer, last, bitmaps} = world(), first = large('a'), second = large('b'), third = large('c');
  loader.want({status: 'select', art: first});await answer(first);const kept = last().image;
  loader.want({status: 'select', art: second});await answer(second, new Blob(['invalid synthetic bytes'], {type: 'image/webp'}));
  assert.deepEqual(last(), {status: 'unavailable', image: kept});
  // The right size, but not the declared WebP media type.
  loader.want({status: 'select', art: third});await answer(third, new Blob([new Uint8Array(80)], {type: 'image/png'}));
  assert.deepEqual(last(), {status: 'unavailable', image: kept});
  const wrong = large('d');wrong.rendition = {...wrong.rendition, width: 1024};
  loader.want({status: 'select', art: wrong});await answer(wrong);
  assert.deepEqual(last(), {status: 'unavailable', image: kept});
  assert.equal(bitmaps.at(-1)?.closed, true, 'a bitmap of the wrong size is closed');
});

void test('an obsolete load cannot replace a newer one and is never decoded', async () => {
  const {loader, answer, last, bitmaps} = world(), first = large('a'), second = large('b');
  loader.want({status: 'select', art: first});loader.want({status: 'select', art: second});
  await answer(second);
  assert.equal(last().image?.renditionId, second.rendition.renditionId);
  await answer(first);
  assert.equal(last().image?.renditionId, second.rendition.renditionId);
  assert.equal(last().status, 'ready');
  assert.equal(bitmaps.length, 1, 'the obsolete response is never decoded');
  // Returning to the shown image drops the newer pending load.
  const third = large('c');
  loader.want({status: 'select', art: third});loader.want({status: 'select', art: second});
  assert.equal(last().status, 'ready');
  await answer(third);
  assert.equal(last().image?.renditionId, second.rendition.renditionId);
  // A selection change while metadata loads also makes the pending image obsolete.
  loader.want({status: 'select', art: third});loader.want({status: 'loading'});
  await answer(third);
  assert.deepEqual([last().status, last().image?.renditionId], ['loading', second.rendition.renditionId]);
});

void test('nothing to present reports none without an image, and nothing throws', async () => {
  const {loader, answer, last} = world(), art = large('a');
  loader.want({status: 'none'});assert.deepEqual(last(), NO_BACKDROP);
  loader.want({status: 'select', art});await answer(art);
  loader.want({status: 'none'});assert.deepEqual(last(), NO_BACKDROP);
});

void test('a replaced bitmap closes only after the newer value is committed, and all close on dispose', async () => {
  const {loader, answer, last, published, closed} = world(), first = large('a'), second = large('b');
  loader.want({status: 'select', art: first});await answer(first);
  const old = last().image;assert.ok(old !== null);loader.committed(old);
  loader.want({status: 'select', art: second});await answer(second);
  const next = last().image;assert.ok(next !== null);
  assert.equal(closed(old), false, 'consumers may still hold the previous committed value');
  loader.committed(next);
  assert.equal(closed(old), true);assert.equal(closed(next), false);
  loader.want({status: 'none'});assert.equal(closed(next), false);loader.committed(null);assert.equal(closed(next), true);
  loader.want({status: 'select', art: first});await answer(first);
  const count = published.length, current = last().image;
  loader.dispose();
  assert.equal(closed(current), true);
  loader.want({status: 'select', art: second});assert.equal(published.length, count, 'a disposed source publishes nothing');
});

void test('a load that settles after dispose is not decoded', async () => {
  const {loader, answer, bitmaps, published} = world(), art = large('a');
  loader.want({status: 'select', art});loader.dispose();const count = published.length;
  await answer(art);
  assert.equal(published.length, count);assert.deepEqual(bitmaps, []);
});

const idle: ArtPresentation = {presented: null, status: 'idle'};
const evidence = (seed: string) => ({artworkId: `synthetic-${seed}`, compositionId: digest(`c${seed}`), renditionId: digest(`l${seed}`), palette: ['#112233']});

void test('the backdrop publishes evidence only for the rendition the shell reports drawn', async () => {
  const {loader, answer, last} = world(), art = large('a');
  loader.want({status: 'select', art});await answer(art);
  const ready = last();
  assert.deepEqual(backdropEvidence(ready, null), idle);
  assert.deepEqual(backdropEvidence(NO_BACKDROP, art.rendition.renditionId), idle);
  assert.deepEqual(backdropEvidence(ready, art.rendition.renditionId), {presented: evidence('a'), status: 'ready'});
  assert.deepEqual(backdropEvidence({...ready, status: 'loading'}, art.rendition.renditionId), {presented: evidence('a'), status: 'loading'});
  assert.deepEqual(backdropEvidence(ready, digest('other')), {presented: null, status: 'ready'});
});

void test('combined presentation keeps one surface when the other goes idle and prefers ready art', () => {
  const widget: ArtPresentation = {presented: evidence('a'), status: 'ready'}, backdrop: ArtPresentation = {presented: evidence('b'), status: 'ready'};
  assert.equal(combinePresentation(widget, idle), widget);
  assert.equal(combinePresentation(idle, backdrop), backdrop);
  assert.equal(combinePresentation(idle, idle), idle);
  assert.equal(combinePresentation(widget, backdrop), widget);
  assert.equal(combinePresentation({presented: null, status: 'loading'}, backdrop), backdrop);
  assert.equal(combinePresentation({...widget, status: 'stale'}, backdrop), backdrop);
  const loading: ArtPresentation = {presented: evidence('a'), status: 'loading'};
  assert.equal(combinePresentation(loading, {presented: null, status: 'unavailable'}), loading);
  const stale: ArtPresentation = {presented: evidence('b'), status: 'stale'};
  assert.equal(combinePresentation({presented: null, status: 'stale'}, stale), stale);
});
