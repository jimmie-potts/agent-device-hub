import assert from 'node:assert/strict';
import test from 'node:test';
import type {ArtScheduleRecord} from '@jimmie-potts/event-contracts/v2/art-schedule';
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {noticeExpiry, noticeMatchesImage, scheduledArtNotice} from '../src/frontend/notice.js';
const now = 1_000_000, hash = 'a'.repeat(64);
const record: ArtScheduleRecord = {id: 'art', revision: 2, settingsRevision: 1, timeZone: 'UTC', status: 'presenting', weather: 'fresh',
  policy: {enabled: true, wakingStartMinute: 480, wakingEndMinute: 1320, appearances: 7, targets: [], browser: true, ambient: false, generation: false, weather: true, coversStatus: false},
  nextOpportunity: null, lastOpportunity: {id: 'slot-1', kind: 'appearance', startAtMs: now, toleranceMs: 1000, artworkId: 'saved-art', reason: null,
    generationRequestId: null, browserRequestId: 'selected-1', displays: []},
  notice: {opportunityId: 'slot-1', artworkId: 'saved-art', compositionId: hash, browserRequestId: 'selected-1', startAtMs: now, expiresAtMs: now + 30_000,
    forecast: {kind: 'rain-forecast', likelihood: 'chance', forecastStartAtMs: now + 60_000, forecastEndAtMs: now + 3_660_000,
      observedAtMs: now - 100, forecastUpdatedAtMs: now - 200, staleAtMs: now + 600_000, weatherRevision: 1}}};
const operation: OperationRecord = {id: 'selected-1', revision: 2, requestId: 'selected-1', kind: 'device', family: 'art-auto', command: 'bunny.cmd.art-auto.art', target: 'art',
  requestedBy: 'bunny/core', status: 'completed', result: 'succeeded', evidence: 'none', sentAtMs: now - 1, updatedAtMs: now, deadlineAtMs: now + 1000};
void test('rain label needs its own successful browser selection, even when the new opportunity reuses an image', () => {
  assert.deepEqual(scheduledArtNotice(record, true, [operation], true, now), record.notice);
  for (const changed of [{...operation, requestId: 'older'}, {...operation, target: 'other'}, {...operation, family: 'moment-play'}, {...operation, requestedBy: 'other'},
    {...operation, status: 'accepted' as const}, {...operation, status: 'completed' as const, result: 'failed' as const}])
    assert.equal(scheduledArtNotice(record, true, [changed], true, now), undefined);
  const newer = structuredClone(record);assert.ok(newer.notice);newer.notice.browserRequestId = 'selected-2';
  assert.equal(scheduledArtNotice(newer, true, [operation], true, now), undefined);
});
void test('disabled, stale, future, replaced or expired factual evidence hides the rain label', () => {
  for (const [live, operationsLive] of [[false, true], [true, false]]) assert.equal(scheduledArtNotice(record, live ?? false, [operation], operationsLive ?? false, now), undefined);
  for (const change of [
    {...record, policy: {...record.policy, enabled: false}}, {...record, policy: {...record.policy, browser: false}}, {...record, policy: {...record.policy, weather: false}},
    {...record, weather: 'stale' as const}, {...record, weather: 'unavailable' as const}, {...record, lastOpportunity: null}, {...record, notice: null},
  ]) assert.equal(scheduledArtNotice(change, true, [operation], true, now), undefined);
  assert.equal(scheduledArtNotice(record, true, [operation], true, now - 1), undefined);
  assert.equal(scheduledArtNotice(record, true, [operation], true, now + 30_000), undefined);
});
void test('the actual decoded visible composition and bounded forecast lifetime gate the separate label', () => {
  const notice = record.notice;assert.ok(notice);
  const image = {artworkId: 'saved-art', compositionId: hash};
  assert.equal(noticeMatchesImage(notice, image, true, now), true);
  assert.equal(noticeMatchesImage(notice, image, false, now), false);
  assert.equal(noticeMatchesImage(notice, {...image, compositionId: 'b'.repeat(64)}, true, now), false);
  assert.equal(noticeMatchesImage(notice, {...image, artworkId: 'manual-gallery-choice'}, true, now), false);
  assert.equal(noticeMatchesImage(notice, undefined, true, now), false);
  assert.equal(noticeMatchesImage(notice, image, true, now + 30_000), false);
  assert.equal(noticeExpiry({...notice, expiresAtMs: now + 90_000}), now + 30_000);
  assert.equal(noticeExpiry({...notice, forecast: {...notice.forecast, staleAtMs: now + 500}}), now + 500);
});
