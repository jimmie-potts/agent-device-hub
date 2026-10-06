// Translated from codex-nanoleaf tests/test_effects.py: requested animation validation, pattern frames and the shared
// display encoder, whose case slice 2a translated. The effect digests recorded from Python and the port's own checks
// follow (PORTING.md).
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {isObject, pyJson, pyMod} from '../src/compat.js';
import {pairLines} from '../src/configuration.js';
import * as effects from '../src/effects.js';
import {effectPayload} from '../src/renderer.js';
import {decode, fixtureJson, suite, test} from './support.js';

type Groups = number[][];
type Positions = number[][];
interface Point {
  panelId: number;
  x: number;
  y: number;
}

/** The real 15-Line layout paired as Python paired it, and a two-Line wall; built per test, since pairing is under test too. */
function layouts(): Record<'fifteen' | 'two', [Groups, Positions]> {
  const layout = fixtureJson('lines-layout.json') as {layout: {positionData: Point[]}};
  const groups = pairLines(layout);
  const zones = new Map(layout.layout.positionData.map(point => [point.panelId, point]));
  const zone = (id: number): Point => zones.get(id) ?? {panelId: id, x: NaN, y: NaN};
  const positions = groups.map(pair => [pair.reduce((sum, id) => sum + zone(id).x, 0) / 2, pair.reduce((sum, id) => sum + zone(id).y, 0) / 2]);
  return {fifteen: [groups, positions], two: [[[101, 102], [103, 104]], [[0, 0], [10, 0]]]};
}
const WHITE: string[] = Array.from({length: effects.MAX_COLORS}, () => '#ffffff');

type Command = Record<string, unknown>;
const command = (fields: Command = {}): Command => ({kind: 'animation.play', pattern: 'wave', colors: ['#0044aa', '#00aa66'], ...fields});
/** effects.render of a command these tests have checked with effects.valid. */
const render = (value: object, groups: Groups, positions: Positions | null): effects.Display =>
  effects.render(value as effects.ExplicitAnimation, groups, positions);

/** Frames per Line, after checking that both zones of each Line carry identical frames. */
function lines(payload: effects.Display, groups: Groups): number[][][] {
  const frames = decode(payload);
  return groups.map(pair => {
    const first = frames.get(pair[0] ?? -1);
    assert.ok(first !== undefined);
    for (const id of pair) assert.deepEqual(frames.get(id), first, 'paired zones differ');
    return first;
  });
}

const brightness = (frame: readonly number[]): number => (frame[0] ?? 0) + (frame[1] ?? 0) + (frame[2] ?? 0);
/** The first keyframe with the largest channel sum, as Python's max(range(...), key=...). */
function brightest(frames: readonly (readonly number[])[]): number {
  let best = 0;
  frames.forEach((frame, index) => {
    if (brightness(frame) > brightness(frames[best] ?? [])) best = index;
  });
  return best;
}

const isSorted = (values: readonly number[]): boolean => values.every((value, index) => index === 0 || (values[index - 1] ?? 0) <= value);

suite('ValidationTest', () => {
  test('test_accepts_bounded_commands', () => {
    for (const fields of [{}, {speed: 'slow', direction: 'outward', loop: false}, {pattern: 'pulse', colors: ['#ABCDEF']},
      {pattern: 'sparkle', colors: WHITE, speed: 'fast'}, {pattern: 'gradient', direction: 'up'}, {pattern: 'breathe', loop: true}]) {
      assert.ok(effects.valid(command(fields)), JSON.stringify(fields));
    }
  });

  test('test_rejects_malformed_commands', () => {
    for (const fields of [{pattern: 'strobe'}, {colors: []}, {colors: [...WHITE, '#000000']}, {colors: ['#12345']}, {colors: ['red']},
      {colors: '#123456'}, {colors: ['#1234567']}, {colors: ['#12345g']}, {speed: 'ludicrous'}, {speed: 3}, {direction: 'north'},
      {loop: 'yes'}, {loop: 1}, {pattern: 'pulse', direction: 'left'}, {pattern: 'breathe', direction: 'up'},
      {pattern: 'sparkle', direction: 'inward'}, {extra: true}, {kind: 'animation.stop'}, {colors: ['#123456\n']}]) {
      assert.equal(effects.valid(command(fields)), false, JSON.stringify(fields));
    }
    assert.equal(effects.valid(null), false);
    assert.equal(effects.valid({kind: 'animation.play', pattern: 'wave'}), false);
  });
});

suite('PresetTest', () => {
  test('test_presets_resolve_to_identical_bounded_explicit_frames', () => {
    // The MCP host's advertised preset list is not ported; the runtime module will advertise PRESETS itself (#844).
    assert.deepEqual(Object.keys(effects.PRESETS), ['cozy', 'ocean', 'sunset', 'aurora', 'campfire', 'forest', 'rain', 'focus', 'party',
      'celebration']);
    const [groups, positions] = layouts().fifteen;
    for (const [name, fields] of Object.entries(effects.PRESETS)) {
      const preset = {kind: 'animation.play', preset: name};
      const explicit = {kind: 'animation.play', ...fields};
      assert.ok(effects.valid(preset), name);
      assert.ok(effects.valid(explicit), name);
      const actual = render(preset, groups, positions);
      assert.deepEqual(actual, render(explicit, groups, positions), name);
      assert.ok(effects.size(actual) <= effects.MAX_BYTES, name);
      assert.ok(Math.max(...[...decode(actual).values()].map(frames => frames.length)) <= effects.MAX_FRAMES, name);
      assert.deepEqual(preset, {kind: 'animation.play', preset: name});
    }
  });

  test('test_presets_reject_unknown_names_and_all_overrides', () => {
    for (const name of ['unknown', 'Cozy', '', null, [], 1]) assert.equal(effects.valid({kind: 'animation.play', preset: name}), false);
    for (const [key, value] of Object.entries({pattern: 'wave', colors: ['#ffffff'], speed: 'slow', direction: 'right', loop: false})) {
      assert.equal(effects.valid({kind: 'animation.play', preset: 'cozy', [key]: value}), false, key);
    }
  });
});

suite('EncoderTest', () => {
  test('test_display_encodes_zone_frames', () => {
    const write = effects.display([[7, [[1, 2, 3, 4]]], [9, [[5, 6, 7, 1], [8, 9, 10, 2]]]], true, true, true);
    assert.equal(write.animData, '2 7 1 1 2 3 0 4 9 2 5 6 7 0 1 8 9 10 0 2');
    assert.deepEqual([write.command, write.animType, write.loop, write.logicalPanelsEnabled], ['display', 'custom', true, true]);
    const fixed = effects.display([[7, [[1, 2, 3, 1]]]], false, false, false);
    assert.equal(fixed.animType, 'static');
    assert.ok(!('logicalPanelsEnabled' in fixed));
  });

  test('test_cap_stays_below_the_live_verified_comet', () => {
    // The middle-Line comet preview passed live checks on this 15-Line wall.
    const [groups, positions] = layouts().fifteen;
    const config = {line_groups: groups, line_positions: positions, kind: 'lines', _mode: 'work',
      _comet: {source: Math.floor(groups.length / 2), started: 100.0}};
    const comet = effectPayload(config, groups.map(() => null), 100.0, false);
    assert.ok(effects.MAX_BYTES < effects.size(comet));
    assert.ok(effects.MAX_FRAMES <= Math.max(...[...decode(comet).values()].map(frames => frames.length)));
  });
});

suite('PatternTest', () => {
  const mixed = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff', '#808080', '#ffffff'];

  test('test_every_pattern_fits_the_proven_envelope', () => {
    for (const [name, [groups, positions]] of Object.entries(layouts())) {
      for (const [pattern, spatial] of Object.entries(effects.PATTERNS)) {
        for (const colors of [['#336699'], WHITE, mixed]) {
          for (const speed of Object.keys(effects.SPEEDS)) {
            for (const direction of spatial ? effects.DIRECTIONS : [null]) {
              for (const loop of [true, false]) {
                const fields: Command = {pattern, colors, speed, loop};
                if (direction !== null) fields.direction = direction;
                const label = JSON.stringify({name, ...fields, colors: colors.length});
                const payload = render(command(fields), groups, positions);
                assert.ok(effects.size(payload) <= effects.MAX_BYTES, label);
                assert.equal(payload.write.loop, loop, label);
                assert.equal(payload.write.logicalPanelsEnabled, true, label);
                for (const frames of lines(payload, groups)) {
                  assert.ok(frames.length >= 1 && frames.length <= effects.MAX_FRAMES, label);
                  for (const [r = -1, g = -1, b = -1, w, t = 0] of frames) {
                    assert.ok([r, g, b].every(c => c >= 0 && c <= 255) && w === 0 && t >= 1, label);
                  }
                }
              }
            }
          }
        }
      }
    }
  });

  test('test_legacy_payload_bytes_are_unchanged', () => {
    // Captured from f3c1384 before adding rotation and faster timing.
    const hashes = {fifteen: '0369586c426223e2ae1b489ce70f0e4d8a0dd5b696c3212e0919037d886b3f8f',
      two: '04c76ed471fb743de0ee33438680b04192c9675c2676f93f9058279dd5f8750b'};
    for (const [name, [groups, positions]] of Object.entries(layouts())) {
      const digest = createHash('sha256');
      for (const [pattern, spatial] of Object.entries(effects.PATTERNS)) {
        const directions = spatial ? ['left', 'right', 'up', 'down', 'outward', 'inward'] : [null];
        for (const colors of [['#336699'], WHITE, ['#ff0000', '#00ff00', '#0000ff']]) {
          for (const speed of ['slow', 'medium', 'fast']) {
            for (const direction of directions) {
              for (const loop of [true, false]) {
                const fields: Command = {pattern, colors, speed, loop};
                if (direction !== null) fields.direction = direction;
                digest.update(pyJson(render(command(fields), groups, positions)));
              }
            }
          }
        }
      }
      assert.equal(digest.digest('hex'), hashes[name as keyof typeof hashes], name);
    }
  });

  test('test_rotating_crests_follow_centroid_angles', () => {
    for (const [name, [groups, positions]] of Object.entries(layouts())) {
      const cx = positions.reduce((sum, [x = 0]) => sum + x, 0) / positions.length;
      const cy = positions.reduce((sum, [, y = 0]) => sum + y, 0) / positions.length;
      for (const [direction, sign] of [['clockwise', -1], ['counterclockwise', 1]] as const) {
        const expected = positions.map(([x = 0, y = 0]) => pyMod(sign * Math.atan2(y - cy, x - cx) / (2 * Math.PI), 1));
        for (const [pattern, colors] of [['wave', ['#ffffff']], ['gradient', ['#ffffff', '#000000']]] as const) {
          const label = `${name} ${direction} ${pattern}`;
          const fields = {pattern, colors: [...colors], direction};
          assert.ok(effects.valid(command(fields)), label);
          const crests = lines(render(command(fields), groups, positions), groups).map(brightest);
          crests.forEach((crest, index) => {
            const error = Math.abs(pyMod(crest / effects.KEYFRAMES - (expected[index] ?? 0) + 0.5, 1) - 0.5);
            assert.ok(error <= 0.5 / effects.KEYFRAMES + 1e-9, label);
          });
          // Quantized crests ordered around the circle permit adjacent ties.
          const order = groups.map((_, i) => i).sort((a, b) => (expected[a] ?? 0) - (expected[b] ?? 0));
          const unwrapped = order.map(i => {
            const crest = crests[i] ?? 0;
            return crest !== 0 ? crest : (expected[i] ?? 0) > 0.5 ? effects.KEYFRAMES : 0;
          });
          assert.ok(isSorted(unwrapped), label);
          assert.ok(new Set(crests).size > 1, label);
        }
      }
    }
  });

  test('test_rotation_at_the_center_is_deterministic', () => {
    for (const direction of ['clockwise', 'counterclockwise'] as const) assert.deepEqual(effects.phases([[0, 0], [0, 0]], direction), [0.0, 0.0]);
  });

  test('test_faster_shortens_every_pattern_cycle', () => {
    const [groups, positions] = layouts().two;
    for (const pattern of Object.keys(effects.PATTERNS)) {
      const cycles = ['fast', 'faster'].map(speed => {
        const fields = command({pattern, speed});
        assert.ok(effects.valid(fields), pattern);
        const frames = lines(render(fields, groups, positions), groups)[0] ?? [];
        assert.ok(frames.every(frame => (frame[4] ?? 0) >= 1), pattern);
        return frames.reduce((sum, frame) => sum + (frame[4] ?? 0), 0);
      });
      assert.ok((cycles[1] ?? 0) < (cycles[0] ?? 0), pattern);
    }
  });

  test('test_defaults_loop_at_medium_speed', () => {
    const two = layouts().two;
    const payload = render(command(), ...two);
    assert.equal(payload.write.loop, true);
    assert.deepEqual(payload, render(command({speed: 'medium', direction: 'right', loop: true}), ...two));
  });

  test('test_speed_sets_cycle_length', () => {
    const two = layouts().two;
    const cycle = (speed: string): number => (lines(render(command({speed}), ...two), two[0])[0] ?? []).reduce((sum, frame) => sum + (frame[4] ?? 0), 0);
    assert.ok(cycle('slow') > cycle('medium'));
    assert.ok(cycle('medium') > cycle('fast'));
  });

  test('test_wave_crest_travels_along_the_direction', () => {
    const [groups, positions] = layouts().fifteen;
    const cx = positions.reduce((sum, [x = 0]) => sum + x, 0) / positions.length;
    const cy = positions.reduce((sum, [, y = 0]) => sum + y, 0) / positions.length;
    const measures: Record<string, (p: Positions[number]) => number> = {right: p => p[0] ?? 0, left: p => -(p[0] ?? 0), up: p => p[1] ?? 0,
      down: p => -(p[1] ?? 0), outward: p => ((p[0] ?? 0) - cx) ** 2 + ((p[1] ?? 0) - cy) ** 2,
      inward: p => -(((p[0] ?? 0) - cx) ** 2 + ((p[1] ?? 0) - cy) ** 2)};
    for (const [direction, measure] of Object.entries(measures)) {
      const crests = lines(render(command({colors: ['#2080ff'], direction}), groups, positions), groups).map(brightest);
      const order = groups.map((_, i) => i).sort((a, b) => measure(positions[a] ?? []) - measure(positions[b] ?? []));
      const ordered = order.map(i => crests[i] ?? 0);
      assert.deepEqual(ordered, [...ordered].sort((a, b) => a - b), direction);
      assert.ok((crests[order[0] ?? 0] ?? 0) < (crests[order.at(-1) ?? 0] ?? 0), direction);
    }
  });

  test('test_gradient_spreads_colors_along_the_direction', () => {
    const [groups, positions] = layouts().fifteen;
    const frames = lines(render(command({pattern: 'gradient', colors: ['#ff0000', '#0000ff'], direction: 'right'}), groups, positions), groups);
    const xs = positions.map(([x = 0]) => x);
    const first = xs.indexOf(Math.min(...xs));
    const last = xs.indexOf(Math.max(...xs));
    assert.deepEqual(frames[first]?.[0]?.slice(0, 3), [255, 0, 0]);
    assert.deepEqual(frames[last]?.[0]?.slice(0, 3), [0, 0, 255]);
    assert.notDeepEqual(frames[first]?.[0], frames[first]?.[1]);
  });

  test('test_pulse_and_breathe_flash_every_line_together_in_color_order', () => {
    const {fifteen, two} = layouts();
    for (const pattern of ['pulse', 'breathe']) {
      const frames = lines(render(command({pattern, colors: ['#ff0000', '#00ff00']}), ...fifteen), fifteen[0]);
      assert.ok(frames.every(line => JSON.stringify(line) === JSON.stringify(frames[0])), pattern);
      assert.deepEqual((frames[0] ?? []).filter((_, i) => i % 2 === 0).map(frame => frame.slice(0, 3)), [[255, 0, 0], [0, 255, 0]], pattern);
      assert.equal(frames[0]?.length, 4, pattern);
    }
    const [groups, positions] = two;
    const pulse = lines(render(command({pattern: 'pulse', colors: ['#ffffff']}), groups, positions), groups)[0] ?? [];
    const breathe = lines(render(command({pattern: 'breathe', colors: ['#ffffff']}), groups, positions), groups)[0] ?? [];
    // A sharp flash, then a slower decay.
    assert.ok((pulse[0]?.[4] ?? 0) < (pulse[1]?.[4] ?? 0));
    assert.equal(breathe[0]?.[4], breathe[1]?.[4]);
  });

  test('test_sparkle_flashes_each_line_once_at_varied_times', () => {
    const fifteen = layouts().fifteen;
    const frames = lines(render(command({pattern: 'sparkle', colors: ['#204060']}), ...fifteen), fifteen[0]);
    const flashes = frames.map(line => {
      const peak = Math.max(...line.map(brightness));
      assert.equal(line.filter(frame => brightness(frame) === peak).length, 1);
      return brightest(line);
    });
    assert.ok(new Set(flashes).size > 3);
  });

  test('test_spatial_patterns_need_positions_and_large_walls_are_rejected', () => {
    const groups = [[1, 2], [3, 4]];
    assert.throws(() => render(command(), groups, null), (error: unknown) => error instanceof effects.Rejected && error.code === 'unsupported-capability');
    assert.ok(render(command({pattern: 'pulse'}), groups, null).write.animData !== '');
    const huge = Array.from({length: 300}, (_, i) => [1000 + i * 2, 1001 + i * 2]);
    assert.throws(() => render(command({pattern: 'pulse', colors: WHITE}), huge, huge.map((_, i) => [i, 0])),
      (error: unknown) => error instanceof effects.Rejected && error.code === 'capacity');
  });
});

suite('effect checks the port adds', () => {
  test('inherited object keys are never patterns, presets, speeds or directions', () => {
    for (const fields of [{pattern: 'constructor'}, {speed: 'toString'}, {direction: '__proto__'}]) assert.equal(effects.valid(command(fields)), false);
    assert.equal(effects.valid({kind: 'animation.play', preset: 'constructor'}), false);
  });
});

suite('test decoder checks the port adds', () => {
  test('animData tokens must be integers, as Python read them with int()', () => {
    assert.deepEqual(decode({write: {animData: '1 7 1 1 2 3 0 4'}}), new Map([[7, [[1, 2, 3, 0, 4]]]]));
    for (const animData of ['1 7 1 1 2 3 0 NaN', '1 7 1 1 2 3 0 4.5', '1 7 1 1 2 3 0 0x4', '1 7 1 1 2 3 0', '1 7']) {
      assert.throws(() => decode({write: {animData}}), Error, animData);
    }
  });
});

interface RecordedEffects {
  palettes: string[][];
  layouts: Record<string, {sha256: string; outcomes: string[]}>;
}

const RECORDED = fixtureJson('recorded/rendering.json') as {effects: RecordedEffects; frames: {layouts: Record<string, {line_groups: Groups; line_positions: Positions}>}};

suite('effects recorded from Python', () => {
  test('every pattern, color set, speed, direction and loop renders the same bytes on each layout', () => {
    const {palettes, layouts} = RECORDED.effects;
    for (const [name, expected] of Object.entries(layouts)) {
      const layout = RECORDED.frames.layouts[name];
      assert.ok(isObject(layout), name);
      const digest = createHash('sha256');
      const outcomes: string[] = [];
      for (const [pattern, spatial] of Object.entries(effects.PATTERNS)) {
        for (const colors of palettes) {
          for (const speed of Object.keys(effects.SPEEDS)) {
            for (const direction of spatial ? effects.DIRECTIONS : [null]) {
              for (const loop of [true, false]) {
                const fields: Command = {kind: 'animation.play', pattern, colors, speed, loop};
                if (direction !== null) fields.direction = direction;
                let text: string;
                try {
                  text = pyJson(render(fields, layout.line_groups, layout.line_positions));
                } catch (error) {
                  if (!(error instanceof effects.Rejected)) throw error;
                  text = 'rejected:' + error.code;
                }
                digest.update(text);
                outcomes.push(createHash('sha256').update(text).digest('hex').slice(0, 12));
              }
            }
          }
        }
      }
      const first = outcomes.findIndex((outcome, index) => outcome !== expected.outcomes[index]);
      assert.equal(first, -1, `${name}: render ${first} differs`);
      assert.equal(digest.digest('hex'), expected.sha256, name);
    }
  });
});
