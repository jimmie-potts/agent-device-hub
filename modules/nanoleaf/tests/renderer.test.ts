// Translated renderer cases: tests/test_bridge.py (render, pulse and wave colors), test_panels.py (PayloadTest and the
// render configuration), test_comets.py and test_modes.py (their frame cases), test_palette.py (frames and the saved
// palette) and test_project_map.py (project halves). Frames recorded from Python follow. Map edits, palette writes and
// mode commands are ported with the edits and worker slice, so these tests save each edit's rows as the edit would
// (PORTING.md lists every case and where the rest went).
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import {pyJson, pyRound} from '../src/compat.js';
import {withState} from '../src/database.js';
import {projection} from '../src/devices.js';
import type {Display, Rgb} from '../src/effects.js';
import {dashboard, type Indication} from '../src/line-projection.js';
import {readLayout} from '../src/panels.js';
import {DEFAULT_PALETTE, lineId, palette, paletteRgb, renderConfig, type Role} from '../src/project-map.js';
import {BASELINE, COLORS, cometColor, effectPayload, indicatorBrightness, MIN_BRIGHTNESS, PULSE_TICKS, pixelColor, render, travelDelays, zoneColor,
  type Delays, type RenderConfig} from '../src/renderer.js';
import {execute, rows} from '../src/sqlite.js';
import {controlState} from '../src/store.js';
import type {LightRequest} from '../src/transport.js';
import {Clock, decode, fixtureJson, framesOf, legacyPrompt, query, setMode, suite, temporary, test, write} from './support.js';

const LINES = Array.from({length: 15}, (_, i) => [100 + i * 2, 101 + i * 2]);
const POSITIONS = Array.from({length: 15}, (_, i) => [i * 10, 0]);
/** BridgeTest.setUp's configuration. */
const BRIDGE: RenderConfig = {ip: '192.168.1.207', token: 'test', line_groups: LINES, line_positions: POSITIONS};
/** SceneTest.setUp's configuration, which the comet, mode, project and palette tests share. */
const SCENE: RenderConfig = {ip: '192.168.1.207', token: 'PRIVATE_TEST_TOKEN', line_groups: LINES, line_positions: POSITIONS};

/** A snapshot of `count` elements with the given indications. */
function snapshotOf(count: number, items: Record<number, Indication> = {}): Indication[] {
  return Array.from({length: count}, (_, index) => items[index] ?? null);
}

const delaysOf = (config: {line_positions?: number[][]}, count: number): Delays =>
  Array.from({length: count}, (_, source) => travelDelays(config, source));
const dim = (color: Rgb, amount = MIN_BRIGHTNESS): number[] => color.map(channel => pyRound(channel * amount));
const same = (left: readonly number[] | undefined, right: readonly number[]): boolean => JSON.stringify(left) === JSON.stringify([...right]);
const hex = (value: string): Rgb => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16)) as unknown as Rgb;
const rgbOf = (frames: readonly number[][]): number[][] => frames.map(frame => frame.slice(0, 3));
const STATUSES = Object.entries(COLORS) as [keyof typeof COLORS, Rgb][];

suite('BridgeTest', () => {
  test('test_render_returns_the_successfully_accepted_output_and_timing', async () => {
    const clock = new Clock();
    const calls: [string, string, unknown][] = [];
    const request: LightRequest = (_address, method, endpoint = '', payload = null) => {
      calls.push([method, endpoint, structuredClone(payload)]);
      clock.sleep(endpoint === '/effects' ? 0.25 : 0.4);
      return Promise.resolve(null);
    };
    const config: RenderConfig = {...BRIDGE, _mode: 'work', _now: clock.now, _controller_request: request};
    const receipt = await render(config, snapshotOf(15, {0: ['working', 1000.0]}), 1000.0, true);
    assert.deepEqual(calls.map(call => call.slice(0, 2)), [['PUT', '/effects'], ['PUT', '/state']]);
    assert.deepEqual(receipt.effect, calls[0]?.[2]);
    assert.deepEqual(receipt.lineGroups, LINES);
    assert.equal(receipt.mode, 'work');
    assert.equal(receipt.brightness, 30);
    assert.equal(receipt.loop, true);
    assert.equal(receipt.animationEpochMs, 1_000_000);
    assert.equal(receipt.sendStartedAtMs, 1_000_000);
    assert.equal(receipt.effectAcceptedAtMs, 1_000_250);
    assert.equal(receipt.acceptedAtMs, 1_000_650);
  });

  test('test_render_returns_completion_comet_receipt', async () => {
    const calls: [string, unknown][] = [];
    const request: LightRequest = (_address, _method, endpoint = '', payload = null) => {
      calls.push([endpoint, payload]);
      return Promise.resolve(null);
    };
    const config: RenderConfig = {...BRIDGE, _mode: 'work', _comet: {source: 7, started: 1998.0}, _now: () => 2000.5, _controller_request: request};
    const receipt = await render(config, snapshotOf(15), 2000.0, false);
    assert.deepEqual(calls.map(([endpoint]) => endpoint), ['/effects', '/state']);
    assert.deepEqual(receipt.effect, calls[0]?.[1]);
    assert.deepEqual(receipt.lineGroups, LINES);
    assert.equal(receipt.mode, 'work');
    assert.equal(receipt.brightness, 30);
    assert.equal(receipt.loop, false);
    assert.equal(receipt.animationEpochMs, 2_000_000);
    assert.equal(receipt.acceptedAtMs, 2_000_500);
    assert.ok(receipt.effect.write.animData !== '');
  });

  test('test_radiation_spreads_by_distance_from_task_in_both_directions', () => {
    const snapshot = snapshotOf(15, {7: ['working', 0]});
    const delays = delaysOf(BRIDGE, 15);
    assert.equal(delays[7]?.[0], delays[7]?.[14]);
    assert.ok((delays[7]?.[6] ?? 0) < (delays[7]?.[0] ?? 0));
    assert.deepEqual(pixelColor(snapshot, 7, 0.5, delays), COLORS.working);
    assert.deepEqual(pixelColor(snapshot, 0, 0.5, delays), BASELINE);
    for (const target of [0, 14]) {
      assert.deepEqual(pixelColor(snapshot, target, 1.3, delays), COLORS.working);
      for (const laterPulse of [3.3, 5.3]) assert.deepEqual(pixelColor(snapshot, target, laterPulse, delays), BASELINE);
    }
    assert.deepEqual(pixelColor(snapshot, 7, 2.5, delays), COLORS.working);
  });

  test('test_both_zones_match_and_animation_has_two_second_period', () => {
    const snapshot = snapshotOf(15, {7: ['question', 1000]});
    for (const [instant, loop] of [[1000, false], [1002, true]] as const) {
      const payload = effectPayload(BRIDGE, snapshot, instant, loop);
      assert.equal(payload.write.loop, loop);
      const panels = decode(payload);
      assert.equal(panels.size, 30);
      for (const [first, second] of LINES) {
        const frames = framesOf(panels, first);
        assert.deepEqual(frames, panels.get(second ?? -1));
        assert.equal(frames.reduce((sum, frame) => sum + (frame.at(-1) ?? 0), 0), 20);
        assert.ok(frames.every(frame => (frame.at(-1) ?? 0) >= 1));
        assert.ok(!rgbOf(frames).some(color => same(color, [0, 0, 0])));
      }
    }
  });

  test('test_red_radiation_has_priority_when_different_colors_overlap', () => {
    const snapshot = snapshotOf(15, {0: ['working', 0], 1: ['blocked', 0]});
    assert.deepEqual(pixelColor(snapshot, 0, 0.5, delaysOf(BRIDGE, 15)), COLORS.blocked);
  });

  test('test_unread_completion_pulses_locally_without_legacy_wave', () => {
    const snapshot = snapshotOf(15, {0: ['unread', 0]});
    const delays = delaysOf(BRIDGE, 15);
    assert.deepEqual(pixelColor(snapshot, 0, 0.5, delays), COLORS.unread);
    assert.deepEqual(pixelColor(snapshot, 0, 1.5, delays), dim(COLORS.unread));
    assert.deepEqual(pixelColor(snapshot, 14, 1, delays), BASELINE);
    for (const laterPulse of [3, 5]) assert.deepEqual(pixelColor(snapshot, 14, laterPulse, delays), BASELINE);
  });

  test('test_assigned_lines_keep_their_status_hue_at_every_pulse_brightness', () => {
    for (const [status, bright] of STATUSES) {
      const panels = decode(effectPayload(BRIDGE, snapshotOf(15, {0: [status, 0]}), 100, true));
      const colors = rgbOf(framesOf(panels, 100));
      assert.ok(colors.some(color => same(color, bright)), status);
      assert.ok(colors.some(color => same(color, dim(bright, 0.2))), status);
      for (const color of colors) {
        const scale = Math.max(...color) / Math.max(...bright);
        assert.ok(scale >= 0.2, status);
        color.forEach((actual, index) => assert.ok(Math.abs(actual - (bright[index] ?? 0) * scale) <= 1, status));
      }
      for (let line = 1; line < 15; line += 1) {
        assert.ok(rgbOf(framesOf(panels, 100 + line * 2)).every(color => same(color, BASELINE)), `${status} line ${line}`);
      }
    }
  });

  test('test_concurrent_local_statuses_keep_independent_hues', () => {
    const snapshot = snapshotOf(15, Object.fromEntries(STATUSES.map(([status], index) => [index, [status, 0] as const])));
    const panels = decode(effectPayload(BRIDGE, snapshot, 100.7, true));
    STATUSES.forEach(([status, color], line) => {
      const colors = rgbOf(framesOf(panels, 100 + line * 2));
      assert.ok(colors.some(seen => same(seen, color)), status);
      if (status !== 'unread') assert.ok(colors.every(seen => seen[2] === 0), status);
    });
  });

  test('test_source_keeps_status_color_during_outward_and_following_local_pulses', () => {
    const delays = delaysOf(BRIDGE, 15);
    for (const [status, bright] of STATUSES) {
      for (let cycle = 0; cycle < 3; cycle += 1) {
        assert.deepEqual(pixelColor(snapshotOf(15, {0: [status, 0]}), 0, cycle * 2 + 1.9, delays), dim(bright, 0.2), status);
      }
    }
  });
});

const NL22 = (fixtureJson('nl22-panels-fixture.json') as {panelLayout: unknown}).panelLayout;
const triangles = (): RenderConfig => ({...projection(readLayout(NL22)), device: 'panels', ip: '192.0.2.2', token: 'fake'});

suite('PayloadTest', () => {
  const config = triangles();
  const count = config.line_groups.length;
  const colors = (payload: Display, element: number): number[][] => rgbOf(framesOf(decode(payload), config.line_groups[element]?.[0]));

  // AC9: one zone per triangle and no Lines-only logical-panel flag.
  test('test_custom_payload_has_one_zone_per_triangle', () => {
    const payload = effectPayload(config, snapshotOf(count, {0: ['working', 1000]}), 1000, false);
    const write = payload.write;
    assert.equal(write.animType, 'custom');
    assert.ok(!('logicalPanelsEnabled' in write));
    assert.equal(Number(write.animData.split(' ')[0]), count);
    const frames = decode(payload);
    assert.deepEqual([...frames.keys()].sort((a, b) => a - b), config.line_groups.map(([id]) => id).sort((a = 0, b = 0) => a - b));
    for (const zoneFrames of frames.values()) {
      assert.equal(zoneFrames.reduce((sum, frame) => sum + (frame[4] ?? 0), 0), PULSE_TICKS);
      assert.ok(zoneFrames.every(frame => frame[3] === 0));
    }
    const idle = effectPayload(config, snapshotOf(count), 1000, true).write;
    assert.equal(idle.animType, 'static');
    assert.ok([...decode({write: idle}).values()].every(zoneFrames => zoneFrames.length === 1));
  });

  test('test_lines_payload_keeps_logical_zones', () => {
    const write = effectPayload({line_groups: LINES, line_positions: POSITIONS}, snapshotOf(15, {0: ['working', 1000]}), 1000, false).write;
    assert.equal(write.logicalPanelsEnabled, true);
    assert.equal(Number(write.animData.split(' ')[0]), 30);
  });

  // AC10: whole triangles, travel within the arrangement and alert priority.
  test('test_wave_reaches_neighbors_before_distant_triangles', () => {
    const source = 0;
    const delays = travelDelays(config, source);
    const order = delays.map((_, i) => i).sort((a, b) => (delays[a] ?? 0) - (delays[b] ?? 0));
    const [near = -1, far = -1] = [order[1], order.at(-1)];
    assert.ok((delays[near] ?? 0) < (delays[far] ?? 0));
    const snapshot = snapshotOf(count, {[source]: ['blocked', 0]});
    const table = delaysOf(config, count);
    const arrival = (target: number): number => {
      for (let t = 0; t < 200; t += 1) if (!same(pixelColor(snapshot, target, t / 100, table), BASELINE)) return t / 100;
      throw new Error('The wave never arrived.');
    };
    assert.ok(arrival(near) < arrival(far));
    assert.deepEqual(pixelColor(snapshot, far, 5.3, table), BASELINE);
    assert.ok(pixelColor(snapshot, source, 2.5, table)[0] > 0);
    assert.ok(new Set((config.line_positions ?? []).map(point => JSON.stringify(point))).size > 1);
  });

  test('test_comet_keeps_question_triangle_and_returns_others', () => {
    const payload = effectPayload({...config, _comet: {source: 0, started: 1000}, _mode: 'work'}, snapshotOf(count, {5: ['question', 900]}), 1000, true);
    assert.equal(payload.write.loop, false);
    assert.ok(!colors(payload, 5).some(color => same(color, [255, 255, 255])));
    assert.ok(colors(payload, 5).every(([r = 0, g = 0, b = -1]) => r > 0 && g > 0 && b === 0));
    const others = Array.from({length: count}, (_, i) => i).filter(i => i !== 5);
    assert.ok(others.some(i => colors(payload, i).some(color => same(color, [255, 255, 255]))));
    assert.ok(others.every(i => same(colors(payload, i).at(-1), BASELINE)));
  });

  // AC11: triangles never show project halves.
  test('test_project_layout_never_splits_a_triangle', () => {
    const cfg: RenderConfig = {...config, _style: 'project', _coverage: 'whole',
      _signatures: Array.from({length: count}, () => [[200, 0, 200], 0] as const)};
    const payload = effectPayload(cfg, snapshotOf(count, {3: ['working', 1000]}), 1000, true);
    for (let element = 0; element < count; element += 1) assert.ok(!colors(payload, element).some(color => same(color, [200, 0, 200])));
  });

  // AC12: Locate flashes one triangle only.
  test('test_locate_targets_one_triangle', () => {
    const payload = effectPayload({...config, _locate: {source: 7, started: 1000}}, snapshotOf(count), 1000, false);
    for (let element = 0; element < count; element += 1) {
      assert.equal(colors(payload, element).some(color => same(color, [255, 255, 255])), element === 7, String(element));
    }
  });
});

suite('ReservationTest', () => {
  test('test_render_config_gives_triangles_no_signature', context => {
    // The project-layout edit is saved as its rows.
    const directory = temporary(context);
    const config: RenderConfig = {...projection(readLayout(NL22)), device: 'panels'};
    write(directory, db => {
      execute(db, "INSERT INTO projects VALUES ('p','P','#00ff00','[]')");
      execute(db, "INSERT OR IGNORE INTO map_settings (style,coverage,rotation,flip_x,flip_y,device) VALUES ('classic','whole',0,0,0,'panels')");
      execute(db, "UPDATE map_settings SET style='project' WHERE device='panels'");
      execute(db, "INSERT INTO line_prefs (line_id,project,signature,device) VALUES (?,'p',0,'panels')", config.elements?.[0]?.id ?? '');
      renderConfig(db, config, snapshotOf(config.line_groups.length));
    });
    assert.equal(config._style, 'project');
    assert.deepEqual(config._signatures, []);
  });
});

suite('CometTest', () => {
  test('test_geometry_head_tail_duration_and_zone_pairs', () => {
    const cfg: RenderConfig = {...SCENE, _comet: {source: 0, started: 1000}, _mode: 'work'};
    const snapshot: Indication[] = Array.from({length: 15}, () => ['working', 990]);
    const delays = delaysOf(cfg, 15);
    const base: Rgb = [0, 51, 0];
    const color = (index: number, instant: number): Rgb => cometColor(cfg, snapshot, index, instant, delays, base);
    assert.deepEqual(color(0, 1000.05), [255, 255, 255]);
    assert.deepEqual(color(14, 1001.45), [255, 255, 255]);
    assert.deepEqual(color(14, 1001.3), base);
    assert.deepEqual(color(14, 1002), base);
    const tail = color(14, 1001.75);
    assert.ok(tail[2] > tail[0]);
    assert.notDeepEqual(tail, base);
    const payload = effectPayload(cfg, snapshot, 1000, true);
    assert.equal(payload.write.loop, false);
    const panels = decode(payload);
    for (const [first, second] of LINES) {
      const frames = framesOf(panels, first);
      assert.deepEqual(frames, panels.get(second ?? -1));
      assert.equal(frames.reduce((sum, frame) => sum + (frame[4] ?? 0), 0), 20);
      assert.equal(frames.length, 20);
    }
  });

  test('test_protect_red_yellow_lines_and_outward_waves', () => {
    const cfg: RenderConfig = {...SCENE, _comet: {source: 0, started: 1000}};
    const snapshot = snapshotOf(15, {0: ['blocked', 999], 1: ['question', 999], 14: ['blocked', 999.6]});
    const delays = delaysOf(cfg, 15);
    for (const [target, instant] of [[0, 1000.05], [1, 1000.15], [8, 1000.86]] as const) {
      const base = pixelColor(snapshot, target, instant, delays);
      assert.deepEqual(cometColor(cfg, snapshot, target, instant, delays, base), base, String(target));
    }
    assert.notDeepEqual(pixelColor(snapshot, 8, 1000.86, delays), BASELINE);
  });
});

suite('ModeTest', () => {
  test('test_quiet_frames_are_steady_paired_colors', () => {
    const config: RenderConfig = {...SCENE, _mode: 'quiet'};
    const snap = snapshotOf(15, {0: ['working', 1000], 1: ['question', 1000], 2: ['blocked', 1000], 3: ['unread', 1000]});
    const data = effectPayload(config, snap, 1000, true);
    assert.equal(data.write.animType, 'static');
    assert.equal(data.write.loop, false);
    const panels = decode(data);
    LINES.forEach(([first, second], i) => {
      const frames = framesOf(panels, first);
      assert.deepEqual(frames, panels.get(second ?? -1));
      assert.equal(frames.length, 1);
      const status = snap[i]?.[0];
      const expected = typeof status === 'string' && status in COLORS ? COLORS[status as keyof typeof COLORS] : BASELINE;
      assert.deepEqual(frames[0]?.slice(0, 3), [...expected]);
    });
  });
});

/**
 * ProjectTest.setUp with SceneTest's configuration: projects a and b, legacy tasks prompted at 1000, and the wall's
 * settings, assignments and palette saved as their edits save them.
 */
class Wall {
  readonly directory: string;

  constructor(context: TestContext) {
    this.directory = temporary(context);
    write(this.directory, db => {
      execute(db, 'INSERT INTO projects VALUES (?,?,?,?)', 'a', 'Project A', '#aa55ff', '["/home/tester/projects/a"]');
      execute(db, 'INSERT INTO projects VALUES (?,?,?,?)', 'b', 'Project B', '#33ccee', '["C:/repo/b"]');
    });
  }

  task(session: string, project: string | null): void {
    write(this.directory, db => {
      legacyPrompt(db, session, '1', 1000);
      execute(db, 'UPDATE task_info SET project=? WHERE session=?', project, session);
    });
  }

  settings(changes: Record<string, string | number>): void {
    write(this.directory, db => {
      for (const [key, value] of Object.entries(changes)) execute(db, `UPDATE map_settings SET ${key}=? WHERE device='wall'`, value);
    });
  }

  /** The saved result of the wall's assign edit: each Line keeps the fields the edit leaves out. */
  assign(slots: Iterable<number>, value: {project?: string | null; signature?: number}): void {
    write(this.directory, db => {
      for (const slot of slots) {
        const id = lineId(LINES[slot] ?? []);
        const [project = null, signature = 0] = rows(db, "SELECT project,signature FROM line_prefs WHERE line_id=? AND device='wall'", id)[0] ?? [];
        execute(db, "INSERT OR REPLACE INTO line_prefs (line_id,project,signature,device) VALUES (?,?,?,'wall')", id,
          value.project === undefined ? project : value.project, value.signature ?? signature);
      }
    });
  }

  /** The saved result of a palette setting: one lowercase row per changed role. */
  palette(roles: Partial<Record<Role, string>>): void {
    write(this.directory, db => {
      for (const [role, color] of Object.entries(roles)) execute(db, 'INSERT OR REPLACE INTO palette VALUES (?,?)', role, color.toLowerCase());
    });
  }

  /** ProjectTest.prepare: the worker's placement pass at 1000 and a copy of the configuration with the map's render settings. */
  prepare(): [RenderConfig, Indication[]] {
    return write(this.directory, db => {
      const snapshot = dashboard(db, SCENE, 1000);
      const config = structuredClone(SCENE);
      renderConfig(db, config, snapshot);
      return [config, snapshot];
    });
  }

  saved(): Record<Role, string> {
    return withState(this.directory, db => palette(db));
  }
}

const PURPLE: Rgb = [170, 85, 255];

suite('ProjectTest', () => {
  test('test_split_base_status_half_and_swap', context => {
    const wall = new Wall(context);
    wall.task('a', 'a');
    wall.settings({style: 'project', coverage: 'status'});
    let [cfg, snap] = wall.prepare();
    let panels = decode(effectPayload(cfg, snap, 1010, true));
    assert.ok(rgbOf(framesOf(panels, 100)).every(color => same(color, PURPLE)));
    assert.ok(framesOf(panels, 101).every(([r, , b]) => r === 0 && b === 0));
    wall.assign([0], {signature: 1});
    [cfg, snap] = wall.prepare();
    panels = decode(effectPayload(cfg, snap, 1010, true));
    assert.ok(rgbOf(framesOf(panels, 101)).every(color => same(color, PURPLE)));
  });

  test('test_whole_wave_and_comet_restore_project_color', context => {
    const wall = new Wall(context);
    wall.task('a', 'a');
    wall.settings({style: 'project', coverage: 'whole'});
    const [cfg, snap] = wall.prepare();
    const delays = delaysOf(cfg, 15);
    assert.deepEqual(zoneColor(cfg, snap, 0, 0, 1000.5, delays), [0, 255, 0]);
    assert.deepEqual(zoneColor(cfg, snap, 0, 0, 1003, delays), PURPLE);
    cfg._comet = {source: 0, started: 1004};
    assert.deepEqual(zoneColor(cfg, snap, 0, 0, 1004.05, delays), [255, 255, 255]);
    assert.deepEqual(zoneColor(cfg, snap, 0, 0, 1006, delays), PURPLE);
    cfg._coverage = 'status';
    assert.deepEqual(zoneColor(cfg, snap, 0, 0, 1004.05, delays), PURPLE);
  });

  test('test_idle_reserved_signature_and_quiet', context => {
    const wall = new Wall(context);
    wall.assign([0], {project: 'a'});
    wall.task('b', 'b');
    wall.settings({style: 'project'});
    const [cfg, snap] = wall.prepare();
    cfg._mode = 'quiet';
    const frames = decode(effectPayload(cfg, snap, 1000, true));
    assert.deepEqual(framesOf(frames, 100)[0]?.slice(0, 3), [...PURPLE]);
    assert.deepEqual(framesOf(frames, 101)[0]?.slice(0, 3), [...BASELINE]);
    assert.equal(framesOf(frames, 100).length, 1);
  });

  test('test_status_coverage_keeps_unknown_project_half_blue', context => {
    const wall = new Wall(context);
    wall.task('unknown', null);
    wall.settings({style: 'project', coverage: 'status'});
    const [cfg, snap] = wall.prepare();
    cfg._comet = {source: 0, started: 1000};
    const actual = decode(effectPayload(cfg, snap, 1000, false));
    assert.ok(rgbOf(framesOf(actual, 100)).every(color => same(color, BASELINE)));
    assert.ok(rgbOf(framesOf(actual, 102)).every(color => same(color, BASELINE)));
    assert.notDeepEqual(actual.get(100), actual.get(101));
  });
});

const DEFAULTS: Record<Role, string> = {...DEFAULT_PALETTE};

suite('PaletteStateTest', () => {
  // AC11: an upgraded database keeps its preferences and starts with the new defaults.
  test('test_upgrade_keeps_preferences_and_adopts_defaults', context => {
    // The wall view's palette and mode are read from the saved state; the scene file is only compared.
    const wall = new Wall(context);
    wall.assign([2], {project: 'a'});
    write(wall.directory, db => execute(db, "UPDATE projects SET color='#113355' WHERE id='a'"));
    wall.settings({style: 'project', coverage: 'status', rotation: 90});
    setMode(wall.directory, 'quiet');
    const scene = join(wall.directory, 'scene-state.json');
    writeFileSync(scene, JSON.stringify({version: 1, scene: {name: 'Beach Waves', brightness: 43}, owned: false}));
    // The state an earlier version left behind.
    write(wall.directory, db => db.exec('DROP TABLE palette'));
    const tables = (): unknown[] => ['projects', 'line_prefs', 'map_settings'].map(table => query(wall.directory, `SELECT * FROM ${table}`));
    const before = tables();
    assert.deepEqual(wall.saved(), DEFAULTS);
    assert.equal(withState(wall.directory, db => controlState(db).mode), 'quiet');
    assert.deepEqual(tables(), before);
  });

  test('test_damaged_rows_fall_back_to_defaults', context => {
    const wall = new Wall(context);
    write(wall.directory, db => {
      for (const [role, color] of [['unread', 'violet'], ['comet', '#ffffff'], ['base', '#000000']]) {
        execute(db, 'INSERT OR REPLACE INTO palette VALUES (?,?)', role ?? '', color ?? '');
      }
      assert.deepEqual(palette(db), {...DEFAULTS, base: '#000000'});
    });
  });
});

suite('PaletteFrameTest', () => {
  const unitDelays = (cfg: RenderConfig): Delays => delaysOf(cfg, cfg.line_groups.length);

  // AC2: base for unused and read Lines, the Unread pulse and the comet tail.
  test('test_work_default_palette', context => {
    const wall = new Wall(context);
    const [cfg] = wall.prepare();
    // A retained shared task that was read shows as idle.
    const snap = snapshotOf(15, {0: ['unread', 990], 1: ['idle', 990]});
    const delays = unitDelays(cfg);
    const [base, unread] = [hex(DEFAULTS.base), hex(DEFAULTS.unread)];
    assert.deepEqual(zoneColor(cfg, snap, 0, 0, 1000.5, delays), unread);
    assert.deepEqual(zoneColor(cfg, snap, 1, 0, 1000.5, delays), base);
    assert.deepEqual(zoneColor(cfg, snap, 2, 1, 1000.5, delays), base);
    cfg._comet = {source: 0, started: 1000};
    assert.deepEqual(zoneColor(cfg, snap, 0, 0, 1000.05, delays), [255, 255, 255]);
    // Late in the tail, the comet has blended fully into the Unread color over the base.
    const tail = zoneColor(cfg, snap, 5, 0, 1000 + 1.4 * 5 / 14 + 0.3, delays);
    const alpha = (0.6 - 0.3) / 0.4;
    assert.deepEqual(tail, base.map((bg, i) => pyRound(bg * (1 - alpha) + (unread[i] ?? 0) * alpha)));
  });

  test('test_chosen_working_color_for_wave_and_pulse', context => {
    const wall = new Wall(context);
    wall.palette({working: '#00e5ff'});
    wall.task('a', null);
    const [cfg, snap] = wall.prepare();
    const delays = unitDelays(cfg);
    const cyan = hex('#00e5ff');
    assert.deepEqual(zoneColor(cfg, snap, 0, 0, 1000.5, delays), cyan);
    const wave = Array.from({length: 200}, (_, t) => zoneColor(cfg, snap, 3, 0, 1000 + t / 100, delays));
    assert.ok(wave.some(color => same(color, cyan)));
    assert.deepEqual(zoneColor(cfg, snap, 3, 0, 1003, delays), hex(DEFAULTS.base));
    assert.deepEqual(zoneColor(cfg, snap, 0, 0, 1001.5, delays), dim(cyan, 0.2));
  });

  // AC3: Quiet steady at 10%.
  test('test_quiet_steady_chosen_colors', context => {
    const wall = new Wall(context);
    wall.palette({working: '#00e5ff'});
    wall.task('a', null);
    const [cfg, snap] = wall.prepare();
    cfg._mode = 'quiet';
    const payload = effectPayload(cfg, snap, 1000, true);
    const frames = decode(payload);
    assert.equal(payload.write.animType, 'static');
    assert.deepEqual(rgbOf(framesOf(frames, 100)), [[...hex('#00e5ff')]]);
    assert.deepEqual(rgbOf(framesOf(frames, 102)), [[...hex(DEFAULTS.base)]]);
    assert.equal(indicatorBrightness(cfg), 10);
  });

  // AC4: Project layout base halves and both coverage settings.
  test('test_project_halves_use_base', context => {
    const wall = new Wall(context);
    wall.palette({base: '#4d3f2a'});
    wall.assign([1], {project: 'a'});
    wall.task('b', 'b');
    wall.settings({style: 'project', coverage: 'whole'});
    const [cfg, snap] = wall.prepare();
    const delays = unitDelays(cfg);
    const base = hex('#4d3f2a');
    assert.deepEqual(zoneColor(cfg, snap, 1, 0, 1003, delays), PURPLE);
    assert.deepEqual(zoneColor(cfg, snap, 1, 1, 1003, delays), base);
    for (const half of [0, 1]) assert.deepEqual(zoneColor(cfg, snap, 4, half, 1003, delays), base);
    let wave = Array.from({length: 200}, (_, t) => zoneColor(cfg, snap, 1, 0, 1000 + t / 100, delays));
    assert.ok(wave.some(color => same(color, [0, 255, 0])));
    cfg._coverage = 'status';
    wave = Array.from({length: 200}, (_, t) => zoneColor(cfg, snap, 1, 0, 1000 + t / 100, delays));
    assert.ok(wave.every(color => same(color, PURPLE)));
  });

  // AC5: priority follows status, not hue.
  test('test_swapped_hues_keep_status_priority', context => {
    const wall = new Wall(context);
    wall.palette({blocked: '#9b30ff', unread: '#ff0000'});
    const violet = hex('#9b30ff');
    const snapshot = snapshotOf(15, {0: ['working', 1000], 1: ['blocked', 1000], 2: ['unread', 900], 3: ['question', 1000]});
    const cfg: RenderConfig = {...SCENE, _palette: paletteRgb(wall.saved())};
    const delays = unitDelays(cfg);
    assert.deepEqual(pixelColor(snapshot, 2, 1000.55, delays, -Infinity, cfg._palette), violet);
    assert.deepEqual(pixelColor(snapshot, 1, 1000.5, delays, -Infinity, cfg._palette), violet);
    cfg._comet = {source: 2, started: 1003};
    const colors = Array.from({length: 200}, (_, t) => zoneColor(cfg, snapshot, 1, 0, 1003 + t / 100, delays));
    // The blocked Line only ever shows its own violet pulse, from 20% to full brightness.
    for (const color of colors) {
      const level = color[2] / 255;
      assert.ok(level >= MIN_BRIGHTNESS - 0.01, String(color));
      assert.ok(color.every((channel, i) => Math.abs(channel - (violet[i] ?? 0) * level) <= 1), String(color));
    }
  });

  // AC12: the Panels use the same palette.
  test('test_panels_use_the_shared_palette', context => {
    const wall = new Wall(context);
    wall.palette({working: '#00e5ff', base: '#000000'});
    const cfg = triangles();
    const count = cfg.line_groups.length;
    write(wall.directory, db => renderConfig(db, cfg, snapshotOf(count)));
    const frames = decode(effectPayload(cfg, snapshotOf(count, {0: ['working', 900]}), 1000, true));
    const [first, other] = [cfg.line_groups[0]?.[0], cfg.line_groups[1]?.[0]];
    assert.ok(rgbOf(framesOf(frames, first)).some(color => same(color, hex('#00e5ff'))));
    assert.ok(rgbOf(framesOf(frames, other)).every(color => same(color, [0, 0, 0])));
  });
});

interface Scenario {
  layout: string;
  config: Record<string, unknown>;
  snapshot: Indication[];
  instant: number;
  loop: boolean;
  samples: [number, number, number, number[]][];
  payload: string;
}

const RECORDED = fixtureJson('recorded/rendering.json') as {frames: {layouts: Record<string, RenderConfig>; scenarios: Scenario[]}};

suite('frames recorded from Python', () => {
  test('zone colors and effect payloads match on random renderer states', () => {
    const {layouts, scenarios} = RECORDED.frames;
    scenarios.forEach((scenario, index) => {
      const layout = layouts[scenario.layout];
      assert.ok(layout !== undefined);
      const config: RenderConfig = {...structuredClone(layout), ...structuredClone(scenario.config)};
      const delays = delaysOf(config, config.line_groups.length);
      for (const [target, half, at, expected] of scenario.samples) {
        assert.deepEqual(zoneColor(config, scenario.snapshot, target, half, at, delays), expected,
          `scenario ${index} (${scenario.layout}) element ${target} half ${half} at ${at}`);
      }
      const payload = effectPayload(config, scenario.snapshot, scenario.instant, scenario.loop);
      assert.equal(createHash('sha256').update(pyJson(payload)).digest('hex'), scenario.payload, `scenario ${index} payload`);
    });
  });
});
