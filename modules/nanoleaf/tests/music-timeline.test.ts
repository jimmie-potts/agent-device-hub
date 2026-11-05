import assert from 'node:assert/strict';
import type {LayoutEntry} from '../src/devices.js';
import {MAX_BYTES, MAX_FRAMES, Rejected, render, size} from '../src/effects.js';
import {MAX_MUSIC_CUES, MAX_MUSIC_DURATION_MS, MIN_MUSIC_CUE_MS, MusicTimelineCursor, prepareMusicTimeline,
  renderMusicCue, selectMusicCue, type TimelineSample} from '../src/music-timeline.js';
import {decode, test} from './support.js';

const cue = (id: string, offsetMs: number, durationMs = 500) =>
  ({id, offsetMs, durationMs, recipe: {pattern: 'pulse', colors: ['#804020']}, intensity: 1});
const plan = () => ({version: 1, durationMs: 3000, cues: [cue('a', 0), cue('b', 500), cue('c', 1500), cue('d', 2000)]});
function playing(sample: TimelineSample | null): Extract<TimelineSample, {kind: 'playing' | 'paused'}> {
  assert.ok(sample !== null && (sample.kind === 'playing' || sample.kind === 'paused'));
  return sample;
}
function selected(sample: TimelineSample | null): string | null {
  const value = playing(sample);
  return value.selection.kind === 'cue' ? value.selection.cue.id : null;
}

test('preparation freezes preset defaults into repeatable explicit cue values', () => {
  const prepared = prepareMusicTimeline({version: 1, durationMs: 2000, cues: [
    {id: 'first', offsetMs: 0, durationMs: 1000, recipe: {preset: 'ocean'}, intensity: 0.5},
  ]});
  assert.deepEqual(prepared, {version: 1, durationMs: 2000, cues: [
    {id: 'first', offsetMs: 0, durationMs: 1000, intensity: 0.5,
      recipe: {pattern: 'wave', speed: 'slow', direction: 'right', loop: true,
        colors: ['#003f8a', '#0077b6', '#00b4d8', '#48cae4', '#2ec4b6']}},
  ]});
  assert.deepEqual(prepareMusicTimeline(JSON.parse(JSON.stringify(prepared))), prepared);
});

test('prepared plans own deeply immutable copies and reject unresolved favorites', () => {
  const input = plan();
  const prepared = prepareMusicTimeline(input);
  const first = input.cues[0];
  assert.ok(first !== undefined);
  first.recipe.colors[0] = '#ffffff';
  input.cues.length = 0;
  const frozen = prepared.cues[0];
  assert.ok(frozen !== undefined);
  assert.equal(frozen.recipe.colors[0], '#804020');
  for (const value of [prepared, prepared.cues, frozen, frozen.recipe, frozen.recipe.colors]) assert.ok(Object.isFrozen(value));
  assert.throws(() => prepareMusicTimeline({...plan(), cues: [{...cue('favorite', 0), recipe: {favorite: 'mutable-name'}}]}), TypeError);
});

test('timeline validation rejects malformed versions, values, excess count and duration', () => {
  for (const input of [null, {}, {...plan(), version: 2}, {...plan(), extra: true}, {...plan(), cues: []},
    {...plan(), durationMs: MAX_MUSIC_DURATION_MS + 1}, {...plan(), durationMs: NaN}, {...plan(), durationMs: 0},
    {...plan(), cues: Array.from({length: MAX_MUSIC_CUES + 1}, (_, i) => cue(`cue-${i}`, i * 100, 100)), durationMs: 30000}]) {
    assert.throws(() => prepareMusicTimeline(input), TypeError);
  }
  const many = prepareMusicTimeline({version: 1, durationMs: MAX_MUSIC_DURATION_MS,
    cues: Array.from({length: MAX_MUSIC_CUES}, (_, i) => cue(`cue-${i}`, i * MIN_MUSIC_CUE_MS, MIN_MUSIC_CUE_MS))});
  assert.equal(many.cues.length, MAX_MUSIC_CUES);
});

test('cue validation rejects overlap, density, duplicate IDs and unsupported recipes', () => {
  const badCues = [
    [{...cue('a', 0), extra: true}], [cue('a', -1)], [cue('a', 0, 99)], [cue('a', 0, 3001)],
    [cue('a', 0), cue('a', 500)], [cue('a', 0), cue('b', 499)], [cue('b', 500), cue('a', 0)],
    [cue('', 0)], [cue('x'.repeat(65), 0)], [cue('bad\n', 0)],
    ...[null, '1', NaN, Infinity, -0.1, 1.1].map(intensity => [{...cue('a', 0), intensity}]),
    ...[{pattern: 'unknown', colors: ['#ffffff']}, {pattern: 'pulse', colors: []}, {preset: 'unknown'},
      {kind: 'animation.play', preset: 'ocean'}, {pattern: 'pulse', colors: ['red']}].map(recipe => [{...cue('a', 0), recipe}]),
  ];
  for (const cues of badCues) assert.throws(() => prepareMusicTimeline({...plan(), cues}), TypeError);
});

test('half-open selection distinguishes exact boundaries, gaps and show end', () => {
  const prepared = prepareMusicTimeline(plan());
  for (const [at, expected] of [[0, 'a'], [499.9, 'a'], [500, 'b'], [999.9, 'b'], [1500, 'c'], [2000, 'd']] as const) {
    const value = selectMusicCue(prepared, at);
    assert.equal(value.kind === 'cue' ? value.cue.id : value.kind, expected);
  }
  for (const at of [1000, 1499, 2500, 2999]) assert.deepEqual(selectMusicCue(prepared, at), {kind: 'gap'});
  for (const at of [3000, 4000]) assert.deepEqual(selectMusicCue(prepared, at), {kind: 'ended'});
  for (const at of [-1, NaN, Infinity]) assert.throws(() => selectMusicCue(prepared, at), TypeError);
});

test('late start selects only the current cue and reports wholly missed cues once', () => {
  const cursor = new MusicTimelineCursor(plan());
  const first = playing(cursor.startAt({positionMs: 1750, monotonicMs: 10000}));
  assert.equal(selected(first), 'c');
  assert.equal(first.selection.kind === 'cue' && first.selection.elapsedMs, 250);
  assert.equal(first.activate, true);
  assert.deepEqual(first.missedCueIds, ['a', 'b']);
  const next = playing(cursor.sample({generation: first.generation, monotonicMs: 10050}));
  assert.equal(next.activate, false);
  assert.deepEqual(next.missedCueIds, []);
});

test('slow evaluation skips expired cues without a backlog, including end-of-show', () => {
  const cursor = new MusicTimelineCursor(plan());
  const first = cursor.startAt({positionMs: 0, monotonicMs: 100});
  const late = playing(cursor.sample({generation: first.generation, monotonicMs: 1850}));
  assert.equal(selected(late), 'c');
  assert.deepEqual(late.missedCueIds, ['b']);
  const ended = cursor.sample({generation: late.generation, monotonicMs: 4000});
  assert.deepEqual(ended, {kind: 'ended', generation: late.generation, positionMs: 3000, missedCueIds: ['d']});
  assert.deepEqual(cursor.sample({generation: late.generation, monotonicMs: 4500}), {...ended, missedCueIds: []});
});

test('pause freezes position and resume renews the clock and generation', () => {
  const cursor = new MusicTimelineCursor(plan());
  const first = cursor.startAt({positionMs: 0, monotonicMs: 1000});
  const paused = playing(cursor.pause({generation: first.generation, monotonicMs: 1250}));
  assert.equal(paused.kind, 'paused');
  assert.equal(paused.positionMs, 250);
  assert.equal(paused.activate, false);
  assert.equal(cursor.sample({generation: first.generation, monotonicMs: 999999}), null);
  const waited = playing(cursor.sample({generation: paused.generation, monotonicMs: 5000}));
  assert.equal(waited.positionMs, 250);
  const resumed = playing(cursor.resume({generation: paused.generation, monotonicMs: 6000}));
  assert.equal(resumed.positionMs, 250);
  assert.equal(resumed.activate, true);
  assert.equal(cursor.pause({generation: paused.generation, monotonicMs: 0}), null);
  const boundary = cursor.sample({generation: resumed.generation, monotonicMs: 6250});
  assert.equal(selected(boundary), 'b');
});

test('forward and backward seeks select directly and fence every older control', () => {
  const cursor = new MusicTimelineCursor(plan());
  const first = cursor.startAt({positionMs: 0, monotonicMs: 1000});
  const forward = playing(cursor.seek({generation: first.generation, positionMs: 2250, monotonicMs: 1100}));
  assert.equal(selected(forward), 'd');
  assert.deepEqual(forward.missedCueIds, []);
  for (const value of [cursor.sample({generation: first.generation, monotonicMs: 0}),
    cursor.seek({generation: first.generation, positionMs: 0, monotonicMs: 0}),
    cursor.stop({generation: first.generation}), cursor.resume({generation: first.generation, monotonicMs: 0})]) assert.equal(value, null);
  const backward = playing(cursor.seek({generation: forward.generation, positionMs: 250, monotonicMs: 1200}));
  assert.equal(selected(backward), 'a');
  assert.equal(backward.activate, true);
  assert.deepEqual(backward.missedCueIds, []);
  const paused = playing(cursor.pause({generation: backward.generation, monotonicMs: 1300}));
  const gap = playing(cursor.seek({generation: paused.generation, positionMs: 1200, monotonicMs: 1400}));
  assert.equal(gap.kind, 'paused');
  assert.deepEqual(gap.selection, {kind: 'gap'});
  assert.equal(gap.activate, false);
});

test('stop and backward time permanently retire a cursor without restoration instructions', () => {
  for (const cause of ['explicit', 'clock-discontinuity'] as const) {
    const cursor = new MusicTimelineCursor(plan());
    const started = cursor.startAt({positionMs: 0, monotonicMs: 1000});
    const stopped = cause === 'explicit' ? cursor.stop({generation: started.generation})
      : cursor.sample({generation: started.generation, monotonicMs: 999});
    assert.deepEqual(stopped, {kind: 'stopped', generation: cursor.generation, reason: cause});
    assert.equal(cursor.sample({generation: started.generation, monotonicMs: 2000}), null);
    assert.deepEqual(cursor.resume({generation: cursor.generation, monotonicMs: 2000}), stopped);
    assert.deepEqual(cursor.seek({generation: cursor.generation, positionMs: 0, monotonicMs: 2000}), stopped);
    assert.throws(() => cursor.startAt({positionMs: 0, monotonicMs: 2000}), TypeError);
  }
});

test('a new cursor needs explicit start and bad input cannot advance its clock', () => {
  const cursor = new MusicTimelineCursor(plan());
  assert.deepEqual(cursor.sample({generation: 0, monotonicMs: 100}), {kind: 'ready', generation: 0});
  for (const positionMs of [-1, 3001, NaN]) assert.throws(() => cursor.startAt({positionMs, monotonicMs: 10000}), TypeError);
  assert.throws(() => cursor.startAt({positionMs: 0, monotonicMs: Infinity}), TypeError);
  assert.equal(cursor.generation, 0);
  assert.equal(cursor.startAt({positionMs: 0, monotonicMs: 50}).kind, 'stopped');
  const fresh = new MusicTimelineCursor(plan());
  assert.equal(fresh.startAt({positionMs: 3000, monotonicMs: 0}).kind, 'ended');
});

function layout(kind: LayoutEntry['kind']): LayoutEntry {
  return {kind, elements: [0, 1, 2].map(i => ({id: kind === 'lines' ? `${101 + 2 * i}:${102 + 2 * i}` : `${101 + i}`,
    number: i + 1, zones: kind === 'lines' ? [101 + 2 * i, 102 + 2 * i] : [101 + i], position: [i * 100, i % 2 * 100]}))};
}

test('synthetic Lines and NL22 use canonical recipe values, intensity and encoder bounds', () => {
  for (const kind of ['lines', 'panels'] as const) {
    const saved = layout(kind);
    const prepared = prepareMusicTimeline({version: 1, durationMs: 1000, cues: [
      {...cue('scaled', 0), intensity: 0.5}, {...cue('spatial', 500), recipe: {preset: 'ocean'}},
    ]});
    for (const item of prepared.cues) {
      const payload = renderMusicCue(item, saved);
      const expectedColors = item.id === 'scaled' ? ['#402010'] : [...item.recipe.colors];
      assert.deepEqual(payload, render({kind: 'animation.play', ...item.recipe, colors: expectedColors},
        saved.elements.map(element => element.zones), saved.elements.map(element => element.position), kind));
      assert.deepEqual([...decode(payload).keys()], saved.elements.flatMap(element => element.zones));
      assert.equal(Object.hasOwn(payload.write, 'logicalPanelsEnabled'), kind === 'lines');
      assert.ok(size(payload) <= MAX_BYTES);
      assert.ok([...decode(payload).values()].every(frames => frames.length <= MAX_FRAMES));
    }
    const spatial = prepared.cues[1];
    assert.ok(spatial !== undefined);
    const before = renderMusicCue(spatial, saved);
    const changed = {...saved, elements: saved.elements.map(element => ({...element, position: null}))};
    assert.throws(() => renderMusicCue(spatial, changed), error => error instanceof Rejected && error.code === 'unsupported-capability');
    assert.deepEqual(renderMusicCue(spatial, saved), before);
  }
});

test('two target cursors have independent generations and no shared running state', () => {
  const lines = new MusicTimelineCursor(plan());
  const panels = new MusicTimelineCursor(plan());
  const a = lines.startAt({positionMs: 0, monotonicMs: 1000});
  const b = panels.startAt({positionMs: 1500, monotonicMs: 1000});
  lines.stop({generation: a.generation});
  assert.equal(selected(panels.sample({generation: b.generation, monotonicMs: 1250})), 'c');
  assert.equal(lines.sample({generation: a.generation, monotonicMs: 1250}), null);
});
