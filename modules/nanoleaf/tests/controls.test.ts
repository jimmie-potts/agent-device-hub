// Translated from codex-nanoleaf tests/test_controller_controls.py, test_controller_worker.py and
// test_controller_animations.py (WorkerTest): native controls, holds, uncertain attempts and requested animations
// through the worker (PORTING.md lists every case). Each test replays a case recorded from Python (record.ControlCase):
// commands go through the port's admission, Python's receipts compare through MAPPING.md's controller receipt rule,
// and every device request, row and scene file must match. Then the test's own assertions follow.
import assert from 'node:assert/strict';
import {sceneList} from '../src/controls.js';
import {render, type ExplicitAnimation} from '../src/effects.js';
import type {Outcome as ControlOutcome} from '../src/journal.js';
import {ControlCase, puts, replayControls, type ControlReplay} from './control-support.js';
import {suite, test} from './support.js';
import {SCENE, type Call} from './worker-support.js';

const WAVE: ExplicitAnimation = {kind: 'animation.play', pattern: 'wave', colors: ['#0044aa', '#00aa66'], speed: 'slow'};
const EXPECTED_WAVE = render(WAVE, SCENE.line_groups, SCENE.line_positions);

/** The results of the replay's steps with this op, in order. */
function results(replay: ControlReplay, op: string): unknown[] {
  return replay.recorded.steps.flatMap((step, index) => {
    const outcome = replay.outcomes[index];
    return step[0] === op && outcome !== undefined && 'result' in outcome ? [outcome.result] : [];
  });
}

/** The scheduled steps' results of the replay's `index`th worker run. */
function scheduled(replay: ControlReplay, index = 0): unknown[] {
  const run = results(replay, 'run')[index] as {scheduled: {result?: unknown}[]};
  return run.scheduled.map(item => item.result);
}

function outcome(id: string, result: ControlOutcome['result'], evidence: ControlOutcome['evidence'], code?: string): ControlOutcome {
  return {type: 'outcome', device: 'wall', requestId: id, result, evidence, ...(code === undefined ? {} : {error: {code}})} as ControlOutcome;
}

const outcomeOf = (replay: ControlReplay, id: string): ControlOutcome | undefined => replay.run.outcomes().get(id);
const animationWrites = (calls: readonly Call[]): unknown[] => puts(calls)
  .filter(([endpoint, payload]) => endpoint === '/effects' && (payload as {write?: {animType?: string}}).write?.animType === 'custom')
  .map(([, payload]) => payload);
const holdOf = (run: ControlCase): unknown => run.query("SELECT value FROM meta WHERE key='controller_hold_revision'");

suite('ControlsTest', () => {
  test('test_scene_rejected_in_work_and_quiet_before_any_write', async context => {
    const replay = await replayControls(context, 'scenes are refused in Work and Quiet');
    assert.deepEqual(results(replay, 'sceneIds'), [[2, true]]);
    assert.deepEqual(results(replay, 'command'), Array.from({length: 3}, () => ({refused: 'unsupported-capability'})));
    assert.deepEqual(results(replay, 'countPuts'), [0]);
    // A refusal has no outcome and leaves nothing queued.
    assert.deepEqual(replay.run.outcomes(), new Map());
    assert.deepEqual(replay.run.query('SELECT id FROM control_journal'), []);
  });

  test('test_power_and_brightness_in_free_are_one_write_each_without_polling', async context => {
    const replay = await replayControls(context, 'power and brightness in Free are one write each');
    const [afterBrightness, afterPower] = results(replay, 'calls') as Call[][];
    assert.deepEqual(afterBrightness?.at(-1)?.slice(1), ['PUT', '/state', {brightness: {value: 42, duration: 0}}]);
    assert.deepEqual(afterPower?.at(-1)?.slice(1), ['PUT', '/state', {on: {value: false}}]);
    assert.equal(afterPower?.filter(call => call[1] === 'GET').length, 0);
    assert.deepEqual(outcomeOf(replay, 'b'), outcome('b', 'succeeded', 'transmitted'));
    assert.deepEqual(outcomeOf(replay, 'p'), outcome('p', 'succeeded', 'transmitted'));
    assert.deepEqual(results(replay, 'desired'), [{brightness: {status: 'known', value: 42}, power: {status: 'known', value: false}}]);
    assert.deepEqual(results(replay, 'deviceState'), [{brightness: 42, on: false, selected: 'Beach Waves'}]);
    assert.deepEqual(replay.run.device.calls, []);
  });

  test('test_scene_that_disappears_before_send_fails_typed_without_a_write', async context => {
    const replay = await replayControls(context, 'a vanished scene fails without a write');
    assert.deepEqual(puts(replay.run.device.calls), []);
    assert.deepEqual(outcomeOf(replay, 's'), outcome('s', 'failed', 'none', 'unsupported-capability'));
  });

  test('test_brightness_executes_once_through_worker_and_governs_work_indicators', async context => {
    // Partly: the ledger's lastSuccessfulSend and the receipt's replay are not ported.
    const replay = await replayControls(context, 'brightness runs once and governs the indicators');
    assert.deepEqual(results(replay, 'deviceState')[0], {brightness: 43, on: true, selected: 'Beach Waves'});
    const writes = puts(replay.run.device.calls);
    assert.deepEqual(writes[0], ['/state', {brightness: {value: 60, duration: 0}}]);
    assert.deepEqual(outcomeOf(replay, 'b'), outcome('b', 'succeeded', 'transmitted'));
    const indicator = writes.filter(([endpoint, payload]) => endpoint === '/state' && 'on' in (payload as object));
    assert.ok(indicator.length > 0);
    assert.ok(indicator.every(([, payload]) => (payload as {brightness: {value: number}}).brightness.value === 60));
    assert.deepEqual((results(replay, 'scene')[0] as {scene: unknown}).scene, {name: 'Beach Waves', brightness: 43});
    assert.equal(replay.run.device.brightness, 60);
  });

  test('test_uncertain_control_write_is_held_until_explicit_choice', async context => {
    const replay = await replayControls(context, 'an uncertain control holds the device');
    assert.deepEqual((results(replay, 'run')[0] as {outcome: unknown}).outcome, {error: 'OSError', message: 'Device unavailable'});
    assert.deepEqual(outcomeOf(replay, 'b'), outcome('b', 'uncertain', 'none', 'uncertain-result'));
    // Not retried while held; the explicit mode choices write again.
    assert.deepEqual(results(replay, 'countPuts'), [1, 1, 3]);
  });

  test('test_mode_command_cancels_queued_control_as_stale_generation', async context => {
    const replay = await replayControls(context, 'a mode command cancels a queued control');
    assert.deepEqual(outcomeOf(replay, 'b'), outcome('b', 'failed', 'none', 'cancelled'));
    assert.deepEqual((results(replay, 'desired')[0] as {brightness: unknown}).brightness, {status: 'unknown'});
    assert.ok(!puts(replay.run.device.calls).some(([, payload]) => (payload as {brightness?: {value: number}}).brightness?.value === 60));
    assert.equal((scheduled(replay)[0] as {brightness: number}).brightness, 10);
  });

  test('test_quiet_idle_override_persists_until_same_mode_quiet_reapplies_ten_percent', async context => {
    const replay = await replayControls(context, 'a Quiet override lasts until Quiet again');
    const seen = scheduled(replay);
    const levels = [[0, 1], [3, 4], [6, 7]].map(([device = 0, scene = 0]) => {
      const saved = seen[scene] as {scene: {brightness: number}; quiet_brightness: number};
      return [(seen[device] as {brightness: number}).brightness, saved.scene.brightness, saved.quiet_brightness];
    });
    assert.deepEqual(levels, [[10, 43, 10], [50, 43, 50], [10, 43, 10]]);
    assert.deepEqual([replay.run.device.selected, replay.run.device.brightness], ['Beach Waves', 43]);
    assert.deepEqual((results(replay, 'desired')[0] as {brightness: unknown}).brightness, {status: 'unknown'});
  });

  test('test_work_idle_override_is_restored_by_same_mode_work_without_reselecting', async context => {
    const replay = await replayControls(context, 'Work restores the remembered brightness');
    assert.equal((results(replay, 'deviceState')[0] as {brightness: number}).brightness, 70);
    assert.deepEqual((results(replay, 'scene')[0] as {scene: unknown}).scene, {name: 'Beach Waves', brightness: 43});
    assert.equal((results(replay, 'deviceState')[1] as {brightness: number}).brightness, 43);
    assert.deepEqual(puts(replay.run.device.calls).map(([endpoint]) => endpoint), ['/state']);
    assert.deepEqual((results(replay, 'desired')[0] as {brightness: unknown}).brightness, {status: 'unknown'});
  });

  test('test_power_off_suppresses_indicator_writes_and_keeps_tracking', async context => {
    const replay = await replayControls(context, 'power off keeps tracking');
    assert.deepEqual(puts(results(replay, 'calls')[0] as Call[]), [['/state', {on: {value: false}}]]);
    assert.deepEqual(outcomeOf(replay, 'p'), outcome('p', 'succeeded', 'transmitted'));
    // Tracking continued while dark: the status change got its epoch.
    const [, status, started] = scheduled(replay, 1);
    assert.deepEqual([status, started], [[['blocked']], [[1003]]]);
    assert.deepEqual(results(replay, 'query').at(-1), [['idle']]);
    const [whileDark, afterWork] = results(replay, 'desired') as {power: unknown}[];
    assert.deepEqual([whileDark?.power, afterWork?.power], [{status: 'known', value: false}, {status: 'unknown'}]);
    assert.ok(puts(replay.run.device.calls).some(([endpoint, payload]) => endpoint === '/state'
      && (payload as {on?: unknown}).on !== undefined && (payload as {on: {value: boolean}}).on.value));
  });

  test('test_scene_activates_in_free_with_one_write_and_no_polling', async context => {
    const replay = await replayControls(context, 'a scene plays in Free with one write');
    const [played, idle] = results(replay, 'calls') as Call[][];
    assert.deepEqual(played, [[1005, 'PUT', '/effects', {select: 'Cotton Candy'}]]);
    assert.deepEqual(outcomeOf(replay, 's'), outcome('s', 'succeeded', 'transmitted'));
    const [before, after] = results(replay, 'query');
    assert.deepEqual(after, before);
    assert.deepEqual(idle, []);
    assert.equal((results(replay, 'scene')[0] as {scene: {name: string}}).scene.name, 'Cotton Candy');
  });

  test('test_free_handoff_clears_override_and_stops_polling', async context => {
    const replay = await replayControls(context, 'Free ends the override');
    assert.deepEqual((results(replay, 'desired')[0] as {brightness: unknown}).brightness, {status: 'unknown'});
    assert.deepEqual([replay.run.device.selected, replay.run.device.brightness], ['Beach Waves', 43]);
    assert.deepEqual(replay.run.device.calls, []);
  });

  test('test_free_brightness_is_an_external_change_that_becomes_the_preference', async context => {
    const replay = await replayControls(context, 'brightness in Free becomes the preference');
    const [inFree, inWork] = results(replay, 'scene') as {scene: unknown; quiet_scene: unknown}[];
    assert.deepEqual(inFree?.scene, {name: 'Beach Waves', brightness: 43});
    assert.deepEqual(inWork?.scene, {name: 'Beach Waves', brightness: 42});
    assert.equal(inWork?.quiet_scene, null);
  });

  test('test_discovery_is_bounded_named_only_in_extension_and_quiet_between_changes', async context => {
    // Partly: the extension snapshot's names and the published snapshot and feed are not ported. The port's scene list
    // is checked instead: a long name keeps only its ID, and only a changed list is reported.
    const replay = await replayControls(context, 'discovery is bounded');
    assert.deepEqual(results(replay, 'sceneIds'), [[256, true], [2, true]]);
    assert.equal(replay.run.reported.filter(message => message.type === 'scenes').length, 2);
    const listed = sceneList(replay.run.database());
    assert.deepEqual(listed.map(scene => Object.keys(scene)), [['id', 'name'], ['id']]);
    assert.equal(listed[0]?.name, 'Beach Waves');
  });

  test('test_control_admitted_during_observation_is_not_undone_by_that_iteration', async context => {
    const power = await replayControls(context, 'a power control admitted during observation');
    assert.deepEqual(power.run.hookResults, [[{result: 'accepted'}]]);
    assert.equal(power.run.device.on, false);
    assert.deepEqual(puts(power.run.device.calls).filter(([, payload]) => 'on' in (payload as object)).map(([, payload]) => payload),
      [{on: {value: false}}]);
    const brightness = await replayControls(context, 'a brightness control admitted during observation');
    assert.deepEqual(brightness.run.hookResults, [[{result: 'accepted'}]]);
    assert.equal(brightness.run.device.brightness, 70);
    const levels = puts(brightness.run.device.calls).flatMap(([, payload]) => {
      const level = (payload as {brightness?: {value: number}}).brightness?.value;
      return level === undefined ? [] : [level];
    });
    assert.equal(levels[0], 70);
    assert.ok(levels.every(level => level === 70), String(levels));
  });

  test('test_control_admitted_after_observation_is_seen_by_the_same_pass_guards', async context => {
    // Admitted during the observation's last request: Python's legacy unread read is not ported (shared input only).
    const replay = await replayControls(context, 'a control admitted during the last observation request');
    assert.deepEqual(replay.run.hookResults, [[{result: 'accepted'}]]);
    assert.deepEqual(puts(replay.run.device.calls).filter(([, payload]) => 'on' in (payload as object)).map(([, payload]) => payload),
      [{on: {value: false}}]);
    assert.equal(replay.run.device.on, false);
  });

  test('test_control_committed_between_journaled_sends_is_applied_before_idle_exit', async context => {
    const replay = await replayControls(context, 'a control committed as an execution completes');
    assert.deepEqual(replay.run.hookResults, [[{result: 'accepted'}]]);
    assert.deepEqual(puts(replay.run.device.calls), [['/state', {on: {value: false}}]]);
    assert.deepEqual(replay.run.query('SELECT id FROM control_journal'), []);
    assert.deepEqual(outcomeOf(replay, 'p'), outcome('p', 'succeeded', 'transmitted'));
  });
});

suite('ControllerWorkerTest', () => {
  test('test_machine_quiet_records_actual_transmission', async context => {
    const replay = await replayControls(context, 'a Quiet command records its transmission');
    assert.deepEqual(outcomeOf(replay, 'q'), outcome('q', 'succeeded', 'transmitted'));
  });

  test('test_same_free_noop_never_sends', async context => {
    // The command needs no change: accepted, then succeeded with observed evidence, where Python cancelled it (PORTING.md).
    const replay = await replayControls(context, 'the same Free is a no-op');
    assert.deepEqual(results(replay, 'command'), ['accepted']);
    assert.deepEqual(outcomeOf(replay, 'f'), outcome('f', 'succeeded', 'observed'));
    assert.deepEqual(replay.run.device.calls, []);
  });

  test('test_uncertain_transport_is_not_retried_by_worker', async context => {
    const replay = await replayControls(context, 'an uncertain write is not retried');
    assert.deepEqual((results(replay, 'run')[0] as {outcome: unknown}).outcome, {error: 'OSError', message: 'Device unavailable'});
    assert.deepEqual(outcomeOf(replay, 'q'), outcome('q', 'uncertain', 'none', 'uncertain-result'));
    assert.deepEqual(results(replay, 'countPuts'), [1, 1]);
  });

  test('test_worker_restart_marks_attempt_uncertain', async context => {
    const replay = await replayControls(context, 'a restart makes an attempt uncertain');
    assert.deepEqual(outcomeOf(replay, 'q'), outcome('q', 'uncertain', 'none', 'uncertain-result'));
    assert.deepEqual(replay.run.device.calls, []);
  });

  test('test_cli_worker_automatic_retry_keeps_hold_and_explicit_same_mode_retries', async context => {
    // Partly: the worker command's retry loop is slice 3e's. A second run stands in for its automatic retry.
    const replay = await replayControls(context, 'a same-mode command retries after a hold');
    const counts = results(replay, 'countPuts') as number[];
    assert.equal(counts[0], 1);
    assert.ok((counts[1] ?? 0) > 1);
  });

  test('test_partial_failure_retains_completed_operations', async context => {
    // The operation lists stay inside the journal; the outcome carries their evidence (MAPPING.md).
    const replay = await replayControls(context, 'a partial failure keeps its completed write');
    assert.deepEqual(outcomeOf(replay, 'q'), outcome('q', 'uncertain', 'transmitted', 'uncertain-result'));
  });

  test('test_expiry_during_unread_cannot_fall_back_to_legacy_send', async context => {
    // The expiry runs during the observation: the legacy unread read is not ported (shared input only).
    const replay = await replayControls(context, 'a command that expires during observation never sends');
    assert.deepEqual(puts(replay.run.device.calls), []);
    assert.deepEqual(outcomeOf(replay, 'q'), outcome('q', 'failed', 'none', 'expired'));
    assert.deepEqual(holdOf(replay.run), [['1']]);
    // As Python's, the pass ends at the hold before it records the scene list it observed.
    assert.equal(replay.run.reported.filter(message => message.type === 'scenes').length, 0);
    const before = await replayControls(context, 'an expired command never sends');
    assert.deepEqual(before.run.device.calls, []);
    assert.deepEqual(outcomeOf(before, 'q'), outcome('q', 'failed', 'none', 'expired'));
  });
});

suite('WorkerTest', () => {
  test('test_plays_once_after_the_free_handoff_and_never_again', async context => {
    // Partly: the options view and the receipt's replay are not ported.
    const replay = await replayControls(context, 'an animation plays once after the Free handoff');
    assert.deepEqual(scheduled(replay)[1], 'accepted');
    const after = puts((results(replay, 'calls')[0] as Call[]).filter(([at]) => at >= 1002));
    assert.deepEqual(after.at(-1), ['/effects', EXPECTED_WAVE]);
    // The Free handoff restored the scene first.
    assert.ok(after.slice(0, -1).some(([endpoint, payload]) => endpoint === '/effects' && (payload as {select?: string}).select === 'Beach Waves'));
    assert.deepEqual(outcomeOf(replay, 'w'), outcome('w', 'succeeded', 'transmitted'));
    assert.deepEqual(replay.run.device.calls, []);
  });

  test('test_explicit_mode_commands_retire_a_queued_animation', async context => {
    for (const label of ['Work', 'Quiet', 'Free', 'a machine Free']) {
      const replay = await replayControls(context, `a mode command retires a queued animation (${label})`);
      assert.deepEqual(outcomeOf(replay, 'w'), outcome('w', 'failed', 'none', 'cancelled'), label);
      assert.deepEqual(animationWrites(replay.run.device.calls), [], label);
    }
  });

  test('test_failed_send_ends_uncertain_and_is_never_replayed', async context => {
    const replay = await replayControls(context, 'a failed animation ends uncertain');
    assert.deepEqual((results(replay, 'run')[1] as {outcome: unknown}).outcome, {error: 'OSError', message: 'Device unavailable'});
    assert.deepEqual(outcomeOf(replay, 'w'), outcome('w', 'uncertain', 'none', 'uncertain-result'));
    assert.deepEqual(animationWrites(replay.run.device.calls), []);
  });

  test('test_worker_restart_finishes_an_interrupted_attempt_as_uncertain', async context => {
    const replay = await replayControls(context, 'an interrupted animation ends uncertain');
    // Still in flight: a second animation waits for capacity.
    assert.deepEqual(results(replay, 'play'), ['accepted', {refused: 'capacity'}]);
    assert.deepEqual(animationWrites(replay.run.device.calls), []);
    assert.deepEqual(outcomeOf(replay, 'w'), outcome('w', 'uncertain', 'none', 'uncertain-result'));
    assert.equal(outcomeOf(replay, 'x'), undefined);
  });

  test('test_scene_and_animation_play_in_admission_order', async context => {
    const replay = await replayControls(context, 'scenes and animations play in admission order');
    const order = (calls: readonly Call[]): string[] => puts(calls).map(([, payload]) => (payload as {select?: string}).select ?? 'animation');
    assert.deepEqual(order(results(replay, 'calls')[0] as Call[]), ['Cotton Candy', 'animation']);
    assert.deepEqual(order(replay.run.device.calls), ['animation', 'Cotton Candy']);
  });

  test('test_cancel_revocation_and_expiry_retire_before_send', async context => {
    // Partly: the integration cancel and revocation are not ported (the runtime's requests and the core's credentials).
    const replay = await replayControls(context, 'an expired animation never plays');
    assert.deepEqual(outcomeOf(replay, 'w'), outcome('w', 'failed', 'none', 'expired'));
    assert.deepEqual(animationWrites(replay.run.device.calls), []);
  });

  test('test_admission_clears_a_transport_hold_like_a_fresh_native_request', async context => {
    const replay = await replayControls(context, 'an animation releases a transport hold');
    assert.deepEqual(results(replay, 'query'), [[['1']], []]);
    assert.deepEqual(animationWrites(replay.run.device.calls), [EXPECTED_WAVE]);
    assert.deepEqual(outcomeOf(replay, 'w'), outcome('w', 'succeeded', 'transmitted'));
    // The uncertain scene is not replayed.
    assert.ok(!puts(replay.run.device.calls).some(([, payload]) => (payload as {select?: string}).select === 'Cotton Candy'));
  });

  test('test_unsent_animation_restores_the_hold_like_unsent_v1_work', async context => {
    // Partly: the failed worker launch belongs to the runtime; the expiry part is translated.
    const replay = await replayControls(context, 'an expired animation holds the device');
    const [hold, revision] = results(replay, 'query');
    assert.deepEqual(hold, revision);
    assert.deepEqual(outcomeOf(replay, 'w'), outcome('w', 'failed', 'none', 'expired'));
    assert.deepEqual(animationWrites(replay.run.device.calls), []);
  });
});
