import assert from 'node:assert/strict';
import {test} from 'node:test';
import {prepareAuthoredTimeline} from '../src/music-show-authoring.js';

const cue = {startMs: 200, endMs: 500, effect: 'wave', palette: ['#4655ff'], intensity: 0.5};
const spans = [{offsetMs: 200, durationMs: 300, intensity: 0.2}, {offsetMs: 600, durationMs: 200, intensity: 0.9}];

void test('model cues compile through the show validator on measured boundaries', () => {
  const timeline = prepareAuthoredTimeline({cues: [cue]}, spans);
  assert.equal(timeline.durationMs, 500);
  assert.equal(timeline.cues[0]?.recipe.pattern, 'wave');
  assert.equal(timeline.cues[0]?.offsetMs, 200);
});

void test('model output cannot invent timing, cross a measurement gap or add instructions', () => {
  for (const output of [
    {cues: [{...cue, startMs: 250}]},
    {cues: [{...cue, endMs: 800}]},
    {cues: [{...cue, effect: 'raw-device-command'}]},
    {cues: [{...cue, code: 'run'}]},
    {cues: Array.from({length: 33}, (_, index) => ({...cue, startMs: index * 100, endMs: (index + 1) * 100}))},
    {timeline: [cue]},
  ]) assert.throws(() => prepareAuthoredTimeline(output, spans));
});

void test('generic planning uses bounded elapsed time without track alignment', () => {
  assert.equal(prepareAuthoredTimeline({cues: [{...cue, startMs: 0}]}, null).durationMs, 500);
  assert.throws(() => prepareAuthoredTimeline({cues: [cue]}, null));
  assert.throws(() => prepareAuthoredTimeline({cues: [{...cue, startMs: 0, endMs: 30001}]}, null));
});
