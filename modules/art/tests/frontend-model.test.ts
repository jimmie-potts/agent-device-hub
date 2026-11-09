import assert from 'node:assert/strict';
import test from 'node:test';
import type {ArtworkSummary} from '@jimmie-potts/event-contracts/v2/art-state';
import {artShowSurfaces} from '@jimmie-potts/event-contracts/v2/art-show';
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {artworkOf, browserArt, catalogOf, latestBrowserArt, money, selectedBrowserArtwork, showTargetsOf, showableSurfaces, surfaceLabel, surfaceText} from '../src/frontend/model.js';

const hash = 'a'.repeat(64);
const artwork = (): ArtworkSummary => ({artworkId: 'synthetic-one', createdAtMs: 1, favorite: false, feedback: null, variationOf: null,
  palette: ['#112233'], provenance: {generatedBy: 'openai', factual: false}, compositions: [{target: 'ui', compositionId: hash, outcome: 'succeeded', motion: 'still',
    renditions: [{renditionId: hash, ref: `rendition.${hash}`, width: 1536, height: 1024, bytes: 400, frames: 1, durationMs: 0, format: 'webp'}]}]});

void test('gallery consumes the real numeric catalog cursor and rejects malformed private content', () => {
  const row = artwork();
  assert.deepEqual(catalogOf({artworks: [row], nextAfter: 17}), {artworks: [row], nextAfter: 17});
  assert.deepEqual(catalogOf({artworks: [], nextAfter: null}), {artworks: [], nextAfter: null});
  for (const page of [{artworks: [row], nextAfter: '../private'}, {artworks: [row], nextAfter: -1}, {artworks: [row, row], nextAfter: null},
    {artworks: Array.from({length: 7}, (_, i) => ({...row, artworkId: `art-${i}`})), nextAfter: null}]) assert.throws(() => catalogOf(page));
  assert.equal(artworkOf({...row, palette: ['url(https://invalid)']}), undefined);
  assert.equal(artworkOf({...row, provenance: {generatedBy: 'openai', factual: true}}), undefined);
  const invalid = artwork(); const image = invalid.compositions[0]?.renditions[0]; assert.ok(image !== undefined);
  image.ref = 'rendition.../secret'; assert.equal(artworkOf(invalid), undefined);
});

void test('browser presentation selects rich stills and never promotes a display GIF or explicit dismissal', () => {
  const row = artwork(), small = {...row.compositions[0]?.renditions[0], width: 768, height: 512};
  const composition = row.compositions[0]; assert.ok(composition !== undefined);
  const original = composition.renditions[0]; assert.ok(original !== undefined);
  composition.renditions.push({...original, ...small});
  assert.equal(browserArt(row, true)?.rendition.width, 768);
  assert.equal(browserArt(row)?.rendition.width, 1536);
  assert.equal(latestBrowserArt([{...row, feedback: 'dismiss', createdAtMs: 10}, row])?.createdAtMs, 1);
  composition.target = 'pixoo'; composition.motion = 'gif';
  assert.equal(browserArt(row), undefined);
  assert.equal(money(3500), '$0.0035');
});

void test('authoritative selection admits only the exact validated usable browser composition', () => {
  const row = artwork(), selection = {artworkId: row.artworkId, compositionId: hash};
  assert.deepEqual(selectedBrowserArtwork({...row, calls: []}, selection), row, 'private result metadata may include unused fields');
  for (const value of [{...row, createdAtMs: undefined}, {...row, artworkId: 'other-art'}, {...row, palette: ['invalid']},
    {...row, compositions: row.compositions.map(item => ({...item, compositionId: 'b'.repeat(64)}))},
    {...row, compositions: row.compositions.map(item => ({...item, target: 'pixoo'}))},
    {...row, compositions: row.compositions.map(item => ({...item, renditions: []}))}]) assert.equal(selectedBrowserArtwork(value, selection), undefined);
});

void test('Show now offers configured displays, sends only surfaces with compositions and labels them (#1581)', () => {
  const targets = showTargetsOf({schema: 'automation/2.0', targets: [{target: 'desk-display', kind: 'pixoo'}, {target: 'shelf-display', kind: 'tidbyt'}]});
  for (const value of [{targets: []}, {schema: 'automation/2.0', targets: [{target: 'browser', kind: 'pixoo'}]}, {schema: 'automation/2.0', targets: [{target: 'Desk', kind: 'pixoo'}]},
    {schema: 'automation/2.0', targets: [{target: 'desk-display', kind: 'lamp'}]}, {schema: 'automation/2.0', targets: [{target: 'a', kind: 'pixoo'}, {target: 'a', kind: 'tidbyt'}]}]) assert.throws(() => showTargetsOf(value));
  const row = artwork(), pixoo = {...row, compositions: [...row.compositions, {target: 'pixoo' as const, compositionId: 'b'.repeat(64), outcome: 'succeeded' as const, motion: 'gif' as const,
    renditions: [{renditionId: 'b'.repeat(64), ref: `rendition.${'b'.repeat(64)}`, width: 64, height: 64, bytes: 40, frames: 8, durationMs: 800, format: 'gif' as const}]}]};
  assert.deepEqual(showableSurfaces(row, ['browser', 'desk-display', 'shelf-display'], targets), ['browser']);
  assert.deepEqual(showableSurfaces(pixoo, ['desk-display', 'browser', 'shelf-display'], targets), ['desk-display', 'browser']);
  assert.deepEqual(showableSurfaces(pixoo, ['hall-display'], targets), [], 'an unconfigured target is never sent');
  assert.equal(surfaceLabel('desk-display', targets), 'Pixoo · desk-display');assert.equal(surfaceLabel('browser', targets), 'Browser');
});

void test('per-surface results follow the core operations and never claim the panel showed art (#1581)', async () => {
  const [desk, browser] = await artShowSurfaces('show-1', ['desk-display', 'browser']);
  assert.ok(desk?.kind === 'display' && browser?.kind === 'browser');
  const record = (requestId: string, family: string, change: Partial<OperationRecord> = {}): OperationRecord => ({id: requestId, revision: 1, requestId, kind: 'device', family,
    command: 'org.bunny.synthetic.requested', target: 'desk-display', requestedBy: 'bunny/core', status: 'accepted', sentAtMs: 1, updatedAtMs: 1, deadlineAtMs: 2, ...change});
  assert.equal(surfaceText(desk, [], false), 'Waiting for preparation.');
  assert.match(surfaceText(desk, [record(desk.prepareRequestId, 'art-auto')], false), /Preparation in progress/);
  assert.match(surfaceText(desk, [record(desk.prepareRequestId, 'art-auto', {status: 'completed', result: 'succeeded'})], false), /ready; waiting for the appearance/);
  const sent = surfaceText(desk, [record(desk.momentRequestId, 'moment-play', {status: 'completed', result: 'succeeded', evidence: 'transmitted'})], true);
  assert.match(sent, /transmitted; the panel was not observed/);assert.doesNotMatch(sent, /shown/);
  assert.match(surfaceText(desk, [record(desk.momentRequestId, 'moment-play', {status: 'rejected', error: {code: 'invalid-state', retryable: false}})], true), /failed \(invalid-state\)/);
  assert.match(surfaceText(desk, [record(desk.prepareRequestId, 'art-auto', {status: 'completed', result: 'succeeded'})], true), /no appearance was sent/);
  assert.match(surfaceText(desk, [], true), /^Not sent/);
  assert.equal(surfaceText(desk, [record(desk.momentRequestId, 'moment-play', {requestedBy: 'bunny/parts/operator', status: 'completed', result: 'succeeded'})], true).startsWith('Not sent'), true,
    'only the core\'s own operation counts');
  assert.match(surfaceText(browser, [record(browser.presentRequestId, 'art-auto', {status: 'completed', result: 'succeeded', evidence: 'observed'})], true), /saved; rendering is not confirmed/);
  assert.match(surfaceText(browser, [], false), /Waiting for the common start/);
});
