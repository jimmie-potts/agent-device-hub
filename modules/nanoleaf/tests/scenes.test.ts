// Translated from codex-nanoleaf tests/test_scene_restore.py, tests/test_modes.py (the worker and scene cases),
// PaletteWorkerTest in tests/test_palette.py and the worker cases of tests/test_project_map.py (PORTING.md lists every
// case). The worker cases replay cases recorded from Python (worker-support.ts), with tasks from the shared feed.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import {withState} from '../src/database.js';
import * as edits from '../src/edits.js';
import type {Indication} from '../src/line-projection.js';
import {renderConfig} from '../src/project-map.js';
import {BASELINE, COLORS, MIN_BRIGHTNESS, PULSE_SECONDS, TRAVEL_SECONDS, type RenderConfig} from '../src/renderer.js';
import {FALLBACK, SceneRestorer} from '../src/scenes.js';
import {pyRound} from '../src/compat.js';
import {execute} from '../src/sqlite.js';
import {query, suite, temporary, test, write} from './support.js';
import {effects, keyOf, ManualClock, replay, SCENE, SceneDevice, scheduledOf, type Call} from './worker-support.js';

const ACTIVE: Indication[] = [['working', 1000], ...Array.from({length: 14}, () => null)];
const IDLE: Indication[] = Array.from({length: 15}, () => null);

/** SceneTest.setUp: the Lines, a fake device on a test clock, and the restorer the worker would make. */
class Scenes {
  readonly directory: string;
  readonly clock = new ManualClock();
  readonly device = new SceneDevice(this.clock);

  constructor(context: TestContext) {
    this.directory = temporary(context);
    writeFileSync(join(this.directory, 'config.json'), JSON.stringify(SCENE));
    writeFileSync(join(this.directory, 'layout.json'), JSON.stringify({line_groups: SCENE.line_groups, line_positions: SCENE.line_positions}));
  }

  manager(): SceneRestorer {
    return new SceneRestorer(this.directory, SCENE, this.device.request);
  }

  saved(): {version: number; scene: {name: string; brightness: number} | null; owned: boolean; quiet_scene: string | null;
    quiet_brightness: number | null;} {
    return JSON.parse(readFileSync(join(this.directory, 'scene-state.json'), 'utf8')) as ReturnType<Scenes['saved']>;
  }
}

const quiet = (config: RenderConfig = SCENE): RenderConfig => ({...config, _mode: 'quiet'});
const free = (config: RenderConfig = SCENE): RenderConfig => ({...config, _mode: 'free'});
const puts = (calls: readonly Call[]): Call[] => calls.filter(([, method]) => method === 'PUT');
const rgb = (frame: readonly number[] | undefined): string => (frame ?? []).slice(0, 3).join();
const selections = (calls: readonly Call[], name: string): number[] => calls
  .filter(([, method, endpoint, payload]) => method === 'PUT' && endpoint === '/effects'
    && (payload as {select?: string} | null)?.select === name).map(([at]) => at);

suite('SceneTest', () => {
  test('test_scene_and_brightness_survive_takeover_and_worker_restart', async context => {
    const s = new Scenes(context);
    const first = s.manager();
    assert.equal(await first.observe(), true);
    await first.send(SCENE, ACTIVE, 1000, false);
    assert.equal(s.device.selected, '*Dynamic*');
    assert.equal(s.device.brightness, 30);
    assert.deepEqual(s.saved().scene, {name: 'Beach Waves', brightness: 43});
    const restarted = s.manager();
    assert.equal(await restarted.observe(), false);
    await restarted.send(SCENE, IDLE, 1005, true);
    assert.deepEqual([s.device.selected, s.device.brightness], ['Beach Waves', 43]);
    assert.equal(s.saved().owned, false);
  });

  test('test_temporary_indicators_never_replace_saved_scene', async context => {
    const s = new Scenes(context);
    const manager = s.manager();
    await manager.observe();
    for (const status of Object.keys(COLORS)) {
      await manager.send(SCENE, [[status, 1000], ...IDLE.slice(1)], 1000, true);
      assert.equal(await manager.observe(), false);
      assert.deepEqual(s.saved().scene, {name: 'Beach Waves', brightness: 43});
    }
  });

  test('test_first_viewed_task_goes_to_base_and_only_last_read_restores_scene', async context => {
    // Partly, shared input only: a read shared task stays on its Line as idle, so the scene returns once the owner
    // removes the last task, where Python's last read returned it.
    const result = await replay(context, 'the scene returns after the last task');
    const slots = new Map(scheduledOf(result)[2] as [string, number][]);
    const [first, second] = [slots.get(keyOf('a')), slots.get(keyOf('b'))].map(slot => SCENE.line_groups[slot ?? -1]?.[0] ?? -1);
    const between = effects(result.run.device.calls, 1007).filter(([at]) => at < 1009);
    assert.ok(between.length > 0);
    const dim = COLORS.unread.map(channel => pyRound(channel * MIN_BRIGHTNESS)).join();
    for (const [, panels] of between) {
      assert.deepEqual(new Set((panels.get(first ?? 0) ?? []).map(rgb)), new Set([BASELINE.join()]));
      assert.ok((panels.get(second ?? 0) ?? []).map(rgb).includes(dim));
    }
    const restorations = selections(result.run.device.calls, 'Beach Waves');
    assert.equal(restorations.length, 1);
    assert.ok((restorations[0] ?? 0) >= 1011);
    assert.deepEqual([result.run.device.selected, result.run.device.brightness], ['Beach Waves', 43]);
    assert.deepEqual(query(result.run.directory, 'SELECT * FROM sessions'), []);
  });

  test('test_scene_change_during_quiet_work_becomes_restore_target_without_new_hooks', async context => {
    // Partly, shared input only: the interrupted task stays on its Line as idle until the owner removes it.
    const result = await replay(context, 'a scene chosen during Work becomes the target');
    const [, scene, selected, started] = scheduledOf(result);
    assert.deepEqual((scene as {scene: unknown}).scene, {name: 'Cotton Candy', brightness: 66});
    assert.equal(selected, '*Dynamic*');
    assert.deepEqual(started, [[1000]]);
    assert.deepEqual([result.run.device.selected, result.run.device.brightness], ['Cotton Candy', 66]);
  });

  test('test_idle_hooks_leave_scene_running_without_restarting_it', async context => {
    const result = await replay(context, 'idle passes leave the scene running');
    assert.deepEqual(puts(result.run.device.calls), []);
    assert.deepEqual((result.outcomes.at(-1) as {result: {scene: unknown}}).result.scene, {name: 'Cotton Candy', brightness: 57});
  });

  test('test_no_initial_scene_uses_blue_until_user_chooses_one', async context => {
    const s = new Scenes(context);
    s.device.selected = '*Dynamic*';
    const manager = s.manager();
    await manager.observe();
    await manager.send(SCENE, ACTIVE, 1000, true);
    assert.equal(s.saved().scene, null);
    await manager.send(SCENE, IDLE, 1004, true);
    assert.equal(s.device.selected, '*Static*');
    [s.device.selected, s.device.brightness] = ['Cotton Candy', 64];
    await manager.observe();
    await manager.send(SCENE, ACTIVE, 1005, true);
    await manager.send(SCENE, IDLE, 1010, true);
    assert.deepEqual([s.device.selected, s.device.brightness], ['Cotton Candy', 64]);
  });

  test('test_failed_restore_keeps_target_for_retry', async context => {
    const s = new Scenes(context);
    const manager = s.manager();
    await manager.observe();
    await manager.send(SCENE, ACTIVE, 1000, true);
    s.device.fail = {method: 'PUT', endpoint: '/effects'};
    await assert.rejects(manager.send(SCENE, IDLE, 1003, true), {name: 'OSError'});
    assert.equal(s.saved().owned, true);
    const retried = s.manager();
    await retried.observe();
    await retried.send(SCENE, IDLE, 1005, true);
    assert.deepEqual([s.device.selected, s.device.brightness], ['Beach Waves', 43]);
    assert.equal(s.saved().owned, false);
  });

  test('test_lost_restore_response_does_not_recapture_indicator_brightness', async context => {
    const s = new Scenes(context);
    const manager = s.manager();
    await manager.observe();
    await manager.send(SCENE, ACTIVE, 1000, true);
    s.device.loseSelectionReply = true;
    await assert.rejects(manager.send(SCENE, IDLE, 1003, true), {name: 'OSError'});
    const retried = s.manager();
    await retried.observe();
    await retried.send(SCENE, IDLE, 1005, true);
    assert.deepEqual(s.saved().scene, {name: 'Beach Waves', brightness: 43});
    assert.equal(s.saved().owned, false);
  });

  test('a lost restore response in Quiet does not recapture the Quiet level', async context => {
    // The port's own Quiet variant of the case above, checked against Python's restorer: the level is saved as the
    // port's own before the requests, so the next observation does not take 10% as the scene's brightness.
    const s = new Scenes(context);
    const manager = s.manager();
    await manager.observe();
    await manager.send(SCENE, ACTIVE, 1000, true);
    s.device.loseSelectionReply = true;
    await assert.rejects(manager.send(quiet(), IDLE, 1003, true), {name: 'OSError'});
    assert.deepEqual([s.device.selected, s.device.brightness], ['Beach Waves', 10]);
    const retried = s.manager();
    await retried.observe();
    assert.deepEqual(s.saved().scene, {name: 'Beach Waves', brightness: 43});
    assert.deepEqual([s.saved().quiet_scene, s.saved().quiet_brightness], ['Beach Waves', 10]);
  });

  test('a Quiet level with no remembered scene sends nothing', async context => {
    // A damaged state: the playing scene is the one the port dimmed, but no scene is remembered. Python's lookup failed
    // before any request; the port refuses the same way (checked against Python's restorer).
    const s = new Scenes(context);
    writeFileSync(join(s.directory, 'scene-state.json'),
      JSON.stringify({version: 1, scene: null, owned: false, quiet_scene: 'Beach Waves', quiet_brightness: 10}));
    s.device.brightness = 10;
    const manager = s.manager();
    await manager.observe();
    s.device.calls = [];
    await assert.rejects(manager.send(SCENE, IDLE, 1000, true), {name: 'TypeError'});
    assert.deepEqual(s.device.calls, []);
  });

  test('test_capture_failure_leaves_original_scene_untouched', async context => {
    const result = await replay(context, 'a failed capture changes nothing');
    assert.deepEqual(result.outcomes.at(-1), {result: {outcome: {error: 'OSError', message: 'Device unavailable'}, scheduled: []}});
    assert.deepEqual(puts(result.run.device.calls), []);
    assert.equal(result.run.device.selected, 'Beach Waves');
    assert.deepEqual(query(result.run.directory, "SELECT value FROM meta WHERE key='dirty'"), [['1']]);
  });

  test('test_deleted_scene_returns_to_blue_without_selecting_invalid_name', async context => {
    const s = new Scenes(context);
    const manager = s.manager();
    await manager.observe();
    await manager.send(SCENE, ACTIVE, 1000, true);
    s.device.names = s.device.names.filter(name => name !== 'Beach Waves');
    await manager.observe();
    await manager.send(SCENE, IDLE, 1003, true);
    assert.equal(s.device.selected, '*Static*');
    assert.equal(s.saved().owned, false);
  });

  test('test_scene_state_contains_no_credentials_or_task_contents', async context => {
    const s = new Scenes(context);
    const manager = s.manager();
    await manager.observe();
    await manager.send(SCENE, ACTIVE, 1000, true);
    const saved = s.saved();
    assert.deepEqual(new Set(Object.keys(saved)), new Set(['version', 'scene', 'owned', 'quiet_scene', 'quiet_brightness']));
    assert.deepEqual(new Set(Object.keys(saved.scene ?? {})), new Set(['name', 'brightness']));
    assert.ok(!JSON.stringify(saved).includes('PRIVATE_TEST_TOKEN'));
  });

  test('test_legacy_quiet_state_file_keeps_remembered_brightness_after_upgrade', async context => {
    // Files written before the recorded level existed only ever dimmed to 10.
    const s = new Scenes(context);
    const path = join(s.directory, 'scene-state.json');
    writeFileSync(path, JSON.stringify({version: 1, scene: {name: 'Beach Waves', brightness: 43}, owned: true, quiet_scene: 'Beach Waves'}));
    s.device.brightness = 10;
    const manager = s.manager();
    assert.equal(manager.state.quiet_brightness, 10);
    await manager.observe();
    assert.deepEqual(s.saved().scene, {name: 'Beach Waves', brightness: 43});
    await manager.send(free(), IDLE, 1000, true);
    assert.equal(s.device.brightness, 43);
    writeFileSync(path, JSON.stringify({version: 1, scene: null, owned: false, quiet_scene: null, quiet_brightness: 101}));
    assert.throws(() => s.manager(), {name: 'ValueError'});
  });

  test('an idle pass leaves a device the indicators do not hold', async context => {
    // Another effect plays and the indicators released the lights: nothing is restored (checked against Python's restorer).
    const s = new Scenes(context);
    writeFileSync(join(s.directory, 'scene-state.json'),
      JSON.stringify({version: 1, scene: {name: 'Beach Waves', brightness: 43}, owned: false, quiet_scene: null, quiet_brightness: null}));
    s.device.selected = '*Dynamic*';
    const manager = s.manager();
    await manager.observe();
    s.device.calls = [];
    await manager.send(SCENE, IDLE, 1000, true);
    assert.deepEqual(s.device.calls, []);
    assert.equal(s.device.selected, '*Dynamic*');
    assert.equal(s.saved().owned, false);
  });

  test('a restarted worker returns a scene the indicators still own', async context => {
    // The display shown before the restart is unchanged, but the saved state says the indicators hold the lights.
    const result = await replay(context, 'an owned scene returns after a restart');
    assert.equal((result.outcomes[2] as {result: {owned: boolean}}).result.owned, true);
    assert.equal(selections(result.run.device.calls, 'Beach Waves').filter(at => at >= 1002).length, 1);
    assert.equal(result.run.device.selected, 'Beach Waves');
  });

  test('test_upgrade_adopts_cached_indicators_before_restoring_idle_baseline', async context => {
    // Partly, shared input only: the interrupted task leaves its Line when the owner removes it.
    const result = await replay(context, 'cached indicators are adopted');
    assert.equal(result.run.device.selected, '*Static*');
    assert.equal((result.recorded.scene as {owned: boolean}).owned, false);
  });
});

suite('ModeTest', () => {
  test('test_default_duplicate_and_persistence', async context => {
    const result = await replay(context, 'mode commands persist');
    const steps = result.recorded.steps.map(step => step[0]);
    const at = (op: string, index: number): unknown => (result.outcomes.filter((_, position) => steps[position] === op)[index] as {result: unknown}).result;
    assert.equal((at('status', 0) as {mode: string}).mode, 'work');
    assert.deepEqual(at('query', 1), at('query', 0));
    assert.equal((at('status', 1) as {pending: boolean}).pending, true);
    assert.deepEqual(at('status', 2), {mode: 'free', pending: false, error: null});
  });

  test('test_free_releases_once_and_never_requests_lights_on_events', async context => {
    // Partly: the requests after Free are checked over the whole case; the device is Beach Waves at 43 throughout.
    const result = await replay(context, 'Free releases once');
    assert.deepEqual([result.run.device.selected, result.run.device.brightness], ['Beach Waves', 43]);
    assert.deepEqual(result.run.device.calls, []);
  });

  test('test_read_receipts_clear_in_free_without_light_requests', async context => {
    // Partly, shared input only: the read is owner evidence; Python's completion receipts belonged to its unread reader.
    const result = await replay(context, 'reads in Free make no requests');
    assert.deepEqual(result.run.device.calls, []);
  });

  test('test_quiet_idle_preserves_original_brightness_across_restart', async context => {
    const s = new Scenes(context);
    let manager = s.manager();
    await manager.observe();
    await manager.send(quiet(), IDLE, 1000, true);
    assert.equal(s.device.brightness, 10);
    manager = s.manager();
    await manager.observe();
    assert.equal(s.saved().scene?.brightness, 43);
    s.device.calls = [];
    await manager.send(free(), IDLE, 1001, true);
    assert.equal(s.device.brightness, 43);
    assert.ok(!s.device.calls.some(([, , endpoint]) => endpoint === '/effects'));
  });

  test('test_quiet_to_work_active_does_not_capture_dim_brightness', async context => {
    const s = new Scenes(context);
    const manager = s.manager();
    await manager.observe();
    await manager.send(quiet(), IDLE, 1000, true);
    await manager.observe();
    await manager.send(SCENE, ACTIVE, 1001, true);
    await manager.observe();
    await manager.send(SCENE, IDLE, 1003, true);
    assert.equal(s.device.brightness, 43);
  });

  test('test_failed_quiet_takeover_preserves_original_brightness', async context => {
    const s = new Scenes(context);
    let manager = s.manager();
    await manager.observe();
    await manager.send(quiet(), IDLE, 1000, true);
    s.device.fail = {method: 'PUT', endpoint: '/effects'};
    await assert.rejects(manager.send(SCENE, ACTIVE, 1001, true), {name: 'OSError'});
    manager = s.manager();
    await manager.observe();
    assert.equal(s.saved().scene?.brightness, 43);
  });

  test('test_return_to_work_skips_old_waves_preserves_slots', async context => {
    const result = await replay(context, 'return to Work skips old waves');
    const queries = result.recorded.steps.flatMap((step, index) => (step[0] === 'query' ? [result.outcomes[index]] : []));
    assert.deepEqual(queries[1], queries[0]);
    const writes = effects(result.run.device.calls);
    assert.ok(writes.length > 0);
    for (const [, panels] of writes) {
      for (const [zone] of SCENE.line_groups.slice(1)) assert.ok((panels.get(zone ?? 0) ?? []).every(frame => rgb(frame) === BASELINE.join()));
    }
  });

  test('test_rapid_mode_changes_apply_latest_only', async context => {
    const result = await replay(context, 'rapid mode changes');
    assert.equal((result.outcomes.at(-1) as {result: {mode: string}}).result.mode, 'free');
    assert.deepEqual(puts(result.run.device.calls), []);
  });

  test('test_failed_handoff_remains_pending_and_retry_obeys_new_mode', async context => {
    const result = await replay(context, 'failed handoff');
    const statuses = result.recorded.steps.flatMap((step, index) => (step[0] === 'status' ? [result.outcomes[index]] : []));
    assert.deepEqual(statuses[0], {result: {mode: 'free', pending: true, error: null}});
    assert.equal(result.run.device.brightness, 43);
    assert.deepEqual(statuses[1], {result: {mode: 'free', pending: false, error: null}});
  });

  test('test_mode_change_interrupts_preview', async context => {
    // Partly, shared input only: the worker keeps running after Free, so the check is that nothing but the scene's
    // return is written after the mode command, where Python checked that its worker ended early.
    const result = await replay(context, 'a mode command ends a preview');
    assert.equal(result.run.device.selected, 'Beach Waves');
    assert.deepEqual(effects(result.run.device.calls, 1000.5), []);
  });

  test('test_free_leaves_external_stream_alone', async context => {
    const result = await replay(context, 'Free leaves an external stream');
    assert.deepEqual(puts(result.run.device.calls), []);
  });

  test('test_quiet_new_scene_and_manual_brightness_become_preference', async context => {
    const s = new Scenes(context);
    const manager = s.manager();
    await manager.observe();
    await manager.send(quiet(), IDLE, 1000, true);
    [s.device.selected, s.device.brightness] = ['Cotton Candy', 61];
    await manager.observe();
    await manager.send(quiet(), IDLE, 1001, true);
    assert.equal(s.device.brightness, 10);
    await manager.observe();
    await manager.send(free(), IDLE, 1002, true);
    assert.deepEqual([s.device.selected, s.device.brightness], ['Cotton Candy', 61]);
  });

  test('test_quiet_idle_worker_does_not_repeat_writes', async context => {
    const result = await replay(context, 'Quiet idle writes once');
    const [first, second] = scheduledOf(result);
    assert.equal(first, second);
  });

  test('test_missing_scene_quiet_and_free_fallback', async context => {
    const s = new Scenes(context);
    const manager = s.manager();
    s.device.selected = '*Dynamic*';
    await manager.observe();
    await manager.send(quiet(), IDLE, 1000, true);
    assert.equal(s.device.brightness, 10);
    await manager.observe();
    await manager.send(free(), IDLE, 1001, true);
    assert.equal(s.device.brightness, 30);
  });
});

/** The panel of a task's Line, from a slots query in the case. */
const panelOf = (slots: readonly [string, number][], name: string): number =>
  SCENE.line_groups[slots.find(([session]) => session === keyOf(name))?.[1] ?? -1]?.[0] ?? -1;

suite('PaletteWorkerTest', () => {
  // AC6: a change mid-pulse and mid-comet restarts nothing.
  test('test_change_and_reset_mid_pulse_and_mid_comet', async context => {
    const result = await replay(context, 'palette change mid pulse and comet');
    const [, beforeActivity, beforeComets, beforeSlots, , afterActivity, afterComets, afterSlots] = scheduledOf(result) as unknown[][][];
    assert.deepEqual([afterActivity, afterComets, afterSlots], [beforeActivity, beforeComets, beforeSlots]);
    assert.equal(beforeComets?.length, 1);
    const [, source = -1, started = 0] = (beforeComets?.[0] ?? []) as [string, number, number];
    const panel = SCENE.line_groups[source]?.[0] ?? -1;
    const working = panelOf(beforeSlots as [string, number][], 'w');
    const changed = effects(result.run.device.calls, 1002).filter(([at]) => at < 1005);
    assert.ok(changed.some(([, frames]) => (frames.get(panel) ?? []).map(rgb).includes('255,0,192')));
    assert.ok(changed.some(([, frames]) => (frames.get(working) ?? []).map(rgb).includes('0,229,255')));
    assert.ok(!effects(result.run.device.calls, started + 2).some(([, frames]) => [...frames.values()].some(zone => zone.map(rgb).includes('255,255,255'))));
    const reset = effects(result.run.device.calls, 1005);
    assert.ok(reset.some(([, frames]) => (frames.get(panel) ?? []).map(rgb).includes(COLORS.unread.join())));
    assert.ok((afterActivity ?? []).some(row => JSON.stringify(row) === JSON.stringify([keyOf('w'), 't1', 'working', 1000])));
  });

  // AC7: an Off base leaves unused Lines dark, and the scene still returns.
  test('test_off_base_keeps_unused_lines_dark_and_restores_scene', async context => {
    // Partly, shared input only: the interrupted task leaves its Line when the owner removes it.
    const result = await replay(context, 'an Off base keeps unused Lines dark');
    const shown = effects(result.run.device.calls, 1000 + 0.5 * PULSE_SECONDS + TRAVEL_SECONDS).filter(([at]) => at < 1003);
    assert.ok(shown.length > 0);
    for (const [, frames] of shown) {
      assert.ok((frames.get(100) ?? []).some(frame => rgb(frame) === '255,0,0'));
      const others = new Set(Array.from({length: 28}, (_, i) => 102 + i).flatMap(zone => (frames.get(zone) ?? []).map(rgb)));
      assert.deepEqual(others, new Set(['0,0,0']));
    }
    assert.equal(result.run.device.selected, 'Beach Waves');
  });

  // AC3: Free hands the lights back once and sends no palette colors.
  test('test_free_after_palette_change_restores_scene_once', async context => {
    const result = await replay(context, 'Free after a palette change restores the scene once');
    assert.ok(effects(result.run.device.calls).length > 0, 'Work showed the task before Free');
    assert.deepEqual(effects(result.run.device.calls, 1003), [], 'Free sends no task frames');
    assert.equal(selections(result.run.device.calls, 'Beach Waves').filter(at => at >= 1003).length, 1);
    assert.equal(result.run.device.selected, 'Beach Waves');
  });

  test('test_no_scene_fallback_stays_blue', async context => {
    const s = new Scenes(context);
    write(s.directory, db => {
      execute(db, "INSERT INTO projects VALUES ('a','Project A','#aa55ff','[]'),('b','Project B','#33ccee','[]')");
      edits.settings(db, SCENE, {palette: {base: '#000000'}});
    });
    s.device.selected = '*Dynamic*';
    const manager = s.manager();
    await manager.observe();
    const config = withState(s.directory, db => {
      const value = structuredClone(SCENE);
      renderConfig(db, value, IDLE);
      return value;
    });
    await manager.send(config, ACTIVE, 1000, true);
    await manager.send(config, IDLE, 1004, true);
    assert.equal(s.device.selected, '*Static*');
    const frames = effects(s.device.calls).at(-1)?.[1] ?? new Map<number, number[][]>();
    assert.deepEqual(new Set([...frames.values()].flatMap(panel => panel.map(rgb))), new Set([FALLBACK.join()]));
  });
});

suite('ProjectTest', () => {
  test('test_color_edit_invalidates_display_without_pulse_or_comet_replay', async context => {
    // Partly, shared input only: the interrupted task leaves its Line when the owner removes it.
    const result = await replay(context, 'a color edit invalidates the display');
    const frames = effects(result.run.device.calls, 1003).filter(([at]) => at < 1006);
    assert.ok(frames.some(([, panels]) => (panels.get(100) ?? []).every(frame => rgb(frame) === '17,51,85')));
    assert.ok(!frames.some(([, panels]) => (panels.get(100) ?? []).some(frame => rgb(frame) === '255,255,255')));
  });

  test('test_idle_locate_returns_scene_after_one_second', async context => {
    const result = await replay(context, 'an idle Locate returns the scene');
    const [first] = effects(result.run.device.calls);
    assert.equal(rgb(first?.[1].get(100)?.[0]), '255,255,255');
    assert.deepEqual([result.run.device.selected, result.run.device.brightness], ['Beach Waves', 43]);
    assert.ok(selections(result.run.device.calls, 'Beach Waves').every(at => at >= 1001));
    assert.deepEqual((result.outcomes.at(-1) as {result: unknown}).result, []);
  });

  test('test_project_early_read_comet_finishes_before_scene_restore', async context => {
    // Partly, shared input only: the read task stays on its Line, so the scene returns once the owner removes it; the
    // comet still runs to its end first.
    const result = await replay(context, 'an early read keeps the comet to its end');
    const restorations = selections(result.run.device.calls, 'Beach Waves');
    assert.equal(restorations.length, 1);
    assert.ok((restorations[0] ?? 0) >= 1007);
    assert.deepEqual(query(result.run.directory, 'SELECT * FROM comets'), []);
  });
});

