import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {PATTERNS, SPEEDS, DIRECTIONS} from '../src/effects.js';
import {prepareMusicTimeline} from '../src/music-timeline.js';
import {selectMusicCue} from '../src/music-timeline-data.js';
import {SHOW_VERSION_SCHEMA} from '../src/music-show-data.js';
import {DIRECTION_CHOICES, draftProblem, PATTERN_CHOICES, showVersion, SPEED_CHOICES, starter, STARTERS} from '../src/frontend/show-model.js';
import {suite, test} from './support.js';

suite('offline show editor model', () => {
  test('starters are independent explicit recipes accepted by the canonical owner', () => {
    assert.deepEqual([...PATTERN_CHOICES].sort(), Object.keys(PATTERNS).sort());
    assert.deepEqual([...SPEED_CHOICES].sort(), Object.keys(SPEEDS).sort());
    assert.deepEqual([...DIRECTION_CHOICES].sort(), [...DIRECTIONS].sort());
    for (const item of STARTERS) {
      const one = starter(item.id, 'show-one'), two = starter(item.id, 'show-two');
      assert.equal(draftProblem(one), undefined);
      const canonical = prepareMusicTimeline(one.timeline);
      assert.deepEqual(canonical, one.timeline);
      assert.notEqual(one.timeline.cues[0]?.recipe.colors, two.timeline.cues[0]?.recipe.colors);
      assert.equal(selectMusicCue(canonical, 9000).kind, 'gap');
      assert.equal(selectMusicCue(canonical, canonical.durationMs).kind, 'ended');
    }
  });
  test('unknown content cannot impersonate the requested version or introduce malformed cue data', () => {
    const draft = starter('ocean', 'show-one');
    const saved = {schema: SHOW_VERSION_SCHEMA, showId: draft.showId, version: 1, name: draft.name, versionName: draft.versionName,
      kind: 'decorative', timeline: prepareMusicTimeline(draft.timeline)};
    assert.deepEqual(showVersion(saved, 'show-one', 1), saved);
    for (const value of [{...saved, schema: 'unknown'}, {...saved, showId: 'show-other'}, {...saved, version: 2}, {...saved, media: 'file'},
      {...saved, timeline: {...saved.timeline, cues: [...saved.timeline.cues, ...saved.timeline.cues]}},
      {...saved, timeline: {...saved.timeline, cues: [{...saved.timeline.cues[0], recipe: {pattern: 'unknown', colors: ['#fff']}}]}}]) {
      assert.throws(() => showVersion(value, 'show-one', 1));
    }
    assert.notEqual(draftProblem({...draft, name: ' '}), undefined);
    assert.notEqual(draftProblem({...draft, timeline: {...draft.timeline, durationMs: 0}}), undefined);
  });
  test('the editor bundle reaches no server compiler, storage, renderer or Node builtin', async () => {
    const result = await build({entryPoints: ['modules/nanoleaf/src/frontend/shows.tsx'], bundle: true, platform: 'browser', format: 'esm',
      write: false, outdir: '/private/tmp/unused-show-bundle', metafile: true, external: ['react', 'react/jsx-runtime'], logLevel: 'silent'});
    const inputs = Object.keys(result.metafile.inputs);
    for (const path of inputs) assert.ok(!/\/(music-timeline|music-shows|effects|devices|sqlite|compat)\.ts$/.test(path), path);
    assert.ok(inputs.some(path => path.endsWith('/music-timeline-data.ts')));
  });
});
