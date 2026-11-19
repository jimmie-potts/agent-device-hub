import assert from 'node:assert/strict';
import {MusicShowAnalysis} from '../src/music-show-analysis.js';
import type {MusicSample} from '../src/music-input.js';
import {MAX_MUSIC_CUES, MAX_MUSIC_DURATION_MS, selectMusicCue} from '../src/music-timeline-data.js';
import {test} from './support.js';

const item = {libraryScopeId: 'fixture-library', itemId: 'fixture-item'};
const capture = {endpointId: 'fixture-mac', generation: '9df02246-518e-44f2-9412-a942735e63cd'};

function sample(sequence: number, rms = 0.25, strength = 0, confidence = 0): MusicSample {
  const end = sequence * 100;
  return {endpointId: capture.endpointId, elapsedMs: end - 100, feature: {
    input: 'music', generation: capture.generation, sequence, sampleRateHz: 48000, channels: 2, frameCount: 4800,
    startMonotonicMs: end - 100, endMonotonicMs: end, emittedMonotonicMs: end,
    observedAtMs: 1000 + end, validUntilMs: 1400 + end, rms, peak: 1, clippedFraction: 0,
    bands: {bass: 0.2, mid: 0, treble: 0}, onset: {strength, confidence}, discontinuity: false,
  }};
}

test('measured cues keep track offsets, respond to energy and confident onsets, and leave unobserved gaps', () => {
  const analysis = new MusicShowAnalysis(item, capture);
  assert.equal(analysis.result(), undefined);
  analysis.add(sample(1), 5100);
  analysis.add(sample(2), 5200);
  analysis.add(sample(4, 0.5, 1, 0), 7100);
  analysis.add(sample(5, 0.5, 1, 0), 7200);
  analysis.add(sample(7, 0.5, 1, 1), 8100);
  analysis.add(sample(8, 0.5), 8200);

  const result = analysis.result();
  assert.ok(result);
  assert.deepEqual(result.item, item);
  assert.deepEqual(result.analysis, {method: 'energy-onset-v1', sampleCount: 6});
  assert.equal(result.timeline.durationMs, 8200);
  assert.deepEqual(result.timeline.cues.map(cue => [cue.offsetMs, cue.durationMs]), [[5000, 200], [7000, 200], [8000, 200]]);
  const [quiet, louder, accent] = result.timeline.cues;
  assert.ok(quiet && louder && accent);
  assert.ok(louder.intensity > quiet.intensity);
  assert.ok(accent.intensity > louder.intensity);
  for (const position of [4999, 5200, 6950, 7500]) assert.equal(selectMusicCue(result.timeline, position).kind, 'gap');
  assert.equal(selectMusicCue(result.timeline, 8200).kind, 'ended');
});

test('foreign, microphone, marked, duplicate and reversed windows cannot add cue coverage', () => {
  const analysis = new MusicShowAnalysis(item, capture);
  const first = sample(1);
  const second = sample(2);
  analysis.add({...first, endpointId: 'another-mac'}, 100);
  analysis.add({...first, feature: {...first.feature, generation: 'retired'}}, 100);
  analysis.add({...first, feature: {...first.feature, input: 'microphone'}}, 100);
  analysis.add({...first, feature: {...first.feature, discontinuity: true}}, 100);
  assert.equal(analysis.result(), undefined);
  analysis.add(first, 100);
  analysis.add(first, 200);
  analysis.add(second, 200);
  analysis.add(sample(3), 150);
  analysis.add(sample(4), Infinity);
  analysis.add(sample(5), MAX_MUSIC_DURATION_MS + 1);
  const result = analysis.result();
  assert.ok(result);
  assert.equal(result.analysis.sampleCount, 2);
  assert.equal(result.timeline.durationMs, 200);
  assert.ok(Object.isFrozen(result.timeline.cues));
});

test('measured cue preparation stops at the timeline cue limit', () => {
  const analysis = new MusicShowAnalysis(item, capture);
  for (let i = 0; i <= MAX_MUSIC_CUES; i++) analysis.add(sample(i + 1), 100 + i * 600);
  const result = analysis.result();
  assert.ok(result);
  assert.equal(result.timeline.cues.length, MAX_MUSIC_CUES);
  assert.equal(result.analysis.sampleCount, MAX_MUSIC_CUES);
  assert.equal(result.timeline.durationMs, 100 + (MAX_MUSIC_CUES - 1) * 600);
});

test('continuous features produce bounded cue spans through the absolute timeline limit', () => {
  const analysis = new MusicShowAnalysis(item, capture);
  const firstPosition = MAX_MUSIC_DURATION_MS - 2000;
  for (let i = 0; i <= 21; i++) analysis.add(sample(i + 1), firstPosition + i * 100);
  const result = analysis.result();
  assert.ok(result);
  assert.equal(result.timeline.durationMs, MAX_MUSIC_DURATION_MS);
  assert.equal(result.analysis.sampleCount, 21);
  assert.deepEqual(result.timeline.cues.map(cue => cue.durationMs), [2000, 100]);
});

test('contiguous producer windows stay contiguous across plus or minus 1 to 20 ms of projected position jitter', () => {
  const analysis = new MusicShowAnalysis(item, capture);
  const firstPosition = 5100;
  const jitter = [0, -1, 1, -20, 20, -5, 14, -14, 6];
  for (const [index, drift] of jitter.entries()) analysis.add(sample(index + 1), firstPosition + index * 100 + drift);
  const result = analysis.result();
  assert.ok(result);
  assert.equal(result.analysis.sampleCount, jitter.length);
  assert.deepEqual(result.timeline.cues.map(cue => [cue.offsetMs, cue.durationMs]), [[5000, 900]]);
});

test('missing producer time or larger transport changes leave cue gaps instead of extending an excerpt', () => {
  const analysis = new MusicShowAnalysis(item, capture);
  analysis.add(sample(1), 5100);
  const second = sample(2);
  analysis.add({...second, feature: {...second.feature, startMonotonicMs: 125, endMonotonicMs: 225, emittedMonotonicMs: 225}}, 5225);
  const third = sample(3);
  analysis.add({...third, feature: {...third.feature, startMonotonicMs: 225, endMonotonicMs: 325, emittedMonotonicMs: 325}}, 5500);
  const result = analysis.result();
  assert.ok(result);
  assert.deepEqual(result.timeline.cues.map(cue => [cue.offsetMs, cue.durationMs]), [[5000, 100], [5125, 100], [5400, 100]]);
  for (const position of [5100, 5225, 5399]) assert.equal(selectMusicCue(result.timeline, position).kind, 'gap');
});
