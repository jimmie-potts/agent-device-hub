// The presented-source rule and freshness, on normalized observations only. Copied from `apps/hub/tests/playback.test.mjs`
// at main 483d3a93 (Hub #175, #233; copied for Hub #929). The Hub's tests also sent commands through the shared module;
// those parts are in module.test.ts, where the module admits commands.
import assert from 'node:assert/strict';
import {Presentation, type PlaybackObservation} from '../src/playback.js';
import {test} from './support.js';

const playing: PlaybackObservation = {status: 'playing', title: 'Song', artist: 'Artist', controls: ['pause', 'next']};

test('a source written without any Sony code feeds the presentation unchanged', () => {
  let clock = 1000;
  const presentation = new Presentation(1, () => clock);
  assert.deepEqual(presentation.view(), {availability: 'unavailable', index: 0});
  presentation.report(0, playing);
  clock += 250;
  assert.deepEqual(presentation.view(), {availability: 'available', index: 0, observedAtMs: 1000, ageMs: 250, observation: playing});
});

test('the presented source follows session, freshness and configured order', () => {
  let clock = 1000;
  // The Move first, then the Sony, as the owner configures them.
  const presentation = new Presentation(2, () => clock);
  const [move, sony] = [0, 1];
  const view = () => presentation.view();
  const inactive: PlaybackObservation = {status: 'inactive', controls: []}, stopped: PlaybackObservation = {status: 'stopped', controls: []};
  const sonyPlaying: PlaybackObservation = {status: 'playing', title: 'Sony song', controls: ['pause', 'next', 'previous']};
  const movePlaying: PlaybackObservation = {status: 'playing', title: 'Move song', controls: ['pause', 'next', 'previous']};
  const movePaused: PlaybackObservation = {...movePlaying, status: 'paused', controls: ['play', 'next', 'previous']};
  assert.deepEqual(view(), {availability: 'unavailable', index: move});
  presentation.report(sony, sonyPlaying);
  assert.deepEqual([view().availability, view().observation?.title], ['available', 'Sony song'], 'an unobserved first source does not hide the second');
  presentation.report(move, inactive);
  assert.equal(view().index, sony, 'Sony alone: the Move answers inactive');
  presentation.report(move, movePlaying);
  assert.deepEqual([view().index, view().observation?.title], [move, 'Move song'], 'grouped: both play and the Move is configured first');
  presentation.report(sony, inactive);
  presentation.report(move, movePaused);
  assert.deepEqual(view().observation?.controls, ['play', 'next', 'previous']);
  presentation.report(move, movePlaying);
  clock += 5000;
  presentation.report(sony, inactive);
  assert.deepEqual([view().availability, view().observation?.title, view().observedAtMs, view().ageMs], ['stale', 'Move song', 1000, 5000],
    'a Move that stops answering stays presented as stale');
  clock += 24_999;
  presentation.report(sony, inactive);
  assert.equal(view().availability, 'stale');
  clock += 1;
  presentation.report(sony, inactive);
  assert.deepEqual([view().index, view().availability, view().observation, view().observedAtMs], [sony, 'available', inactive, 31_000],
    'after 30 seconds the Sony is presented');
  assert.deepEqual([presentation.availability(move), presentation.observation(move)?.title], ['unavailable', 'Move song'],
    'the silent Move keeps its last observation, which the view withholds');
  presentation.report(move, stopped);
  presentation.report(sony, sonyPlaying);
  assert.equal(view().observation?.title, 'Sony song', 'a stopped Move does not outrank a playing Sony');
  presentation.report(move, {status: 'unknown', controls: []});
  assert.equal(view().observation?.title, 'Sony song', 'an unrecognized state is not a session');
  presentation.report(move, inactive);
  presentation.report(sony, stopped);
  assert.equal(view().observation?.status, 'inactive', 'nothing playing: ties go to configured order');
  clock += 6000;
  presentation.report(sony, stopped);
  assert.deepEqual([view().availability, view().observation?.status], ['available', 'stopped'], 'nothing playing: the fresher source is presented');
});

test('freshness follows the monotonic clock', () => {
  let wall = 100_000, elapsed = 0;
  const presentation = new Presentation(1, () => wall, () => elapsed);
  presentation.report(0, playing);
  wall -= 60_000;
  elapsed += 5000;
  assert.deepEqual([presentation.view().availability, presentation.view().observedAtMs, presentation.view().ageMs], ['stale', 100_000, 5000],
    'a wall-clock step back does not keep a source available');
  wall += 60_000 + 30_000;
  assert.deepEqual([presentation.view().availability, presentation.view().ageMs], ['unavailable', 30_000],
    'a suspend that pauses the monotonic clock does not keep a source available');
});

test('the next availability change is when the oldest fresh observation crosses a threshold', () => {
  let clock = 0;
  const presentation = new Presentation(2, () => clock);
  assert.equal(presentation.nextChangeInMs(), undefined, 'nothing observed, nothing will change');
  presentation.report(0, playing);
  clock += 1200;
  assert.equal(presentation.nextChangeInMs(), 3800, 'stale at 5 s');
  presentation.report(1, playing);
  clock += 4000;
  assert.equal(presentation.nextChangeInMs(), 1000, 'the second source turns stale first now');
  clock += 1000;
  assert.equal(presentation.nextChangeInMs(), 23_800, 'both stale: the first turns unavailable at 30 s');
  clock += 30_000;
  assert.equal(presentation.nextChangeInMs(), undefined, 'both unavailable, nothing will change');
});
