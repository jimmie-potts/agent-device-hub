// Translated from codex-nanoleaf tests/test_controller_controls.py, test_controller_worker.py and
// test_controller_animations.py (WorkerTest): native controls, holds, uncertain attempts and requested animations
// through the worker (PORTING.md lists every case). Each test replays a case recorded from Python (record.ControlCase):
// commands go through the port's admission, Python's receipts compare through MAPPING.md's controller receipt rule,
// and every device request, row and scene file must match. Then the test's own assertions follow.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import {admitCommand, MAX_QUEUED, Refused, sceneList} from '../src/controls.js';
import {render, type ExplicitAnimation} from '../src/effects.js';
import {transactWith, type Outcome as ControlOutcome} from '../src/journal.js';
import {setMode} from '../src/modes.js';
import {execute, transaction} from '../src/sqlite.js';
import {ControlCase, puts, replayControls, type ControlReplay} from './control-support.js';
import {suite, temporary, test} from './support.js';
import {ManualClock, moduleDatabase, runUntil, SCENE, SceneDevice, type Call, type Step} from './worker-support.js';

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

/** A control case of the port's own: steps run in order on a fresh case. */
async function steps(context: TestContext, list: readonly Step[]): Promise<{run: ControlCase; results: unknown[]}> {
  const run = new ControlCase(context);
  const values: unknown[] = [];
  for (const step of list) values.push(await run.apply(step));
  return {run, results: values};
}

suite('control checks the port adds', () => {
  test('a mode command that needs no device write succeeds with observed evidence', async context => {
    // From Work with nothing shown, the Free handoff has nothing to restore: the pass observes the device and writes
    // nothing, where Python cancelled the command.
    const {run} = await steps(context, [['run', 1002], ['device', 'clearCalls'], ['command', 'f', {kind: 'mode.set', mode: 'Free'}],
      ['run', 1004]]);
    assert.deepEqual(puts(run.device.calls), []);
    assert.ok(run.device.calls.some(([, method]) => method === 'GET'));
    assert.deepEqual(run.outcomes().get('f'), outcome('f', 'succeeded', 'observed'));
  });

  test('a command retired during its write ends uncertain and is not written again', async context => {
    // The mode command commits while the brightness write is out, which Python's lock prevented. That write may have
    // reached the device, so it ends uncertain; the pass then starts again and applies Quiet.
    const {run} = await steps(context, [['command', 'b', {kind: 'brightness.set', percent: 60}],
      ['hook', {method: 'PUT', endpoint: '/state', payload: 'brightness', step: ['command', 'q', {kind: 'mode.set', mode: 'Quiet'}]}],
      ['run', 1004]]);
    assert.deepEqual(run.hookResults, [[{result: 'accepted'}]]);
    assert.deepEqual(run.outcomes().get('b'), outcome('b', 'uncertain', 'none', 'uncertain-result'));
    assert.deepEqual(run.outcomes().get('q'), outcome('q', 'succeeded', 'transmitted'));
    const levels = puts(run.device.calls).flatMap(([, payload]) => {
      const level = (payload as {brightness?: {value: number}}).brightness?.value;
      return level === undefined ? [] : [level];
    });
    assert.deepEqual(levels.filter(level => level === 60), [60]);
    assert.equal(run.device.brightness, 10);
  });

  test('a command queued behind a hold still expires', async context => {
    // The restarted worker holds the device for the uncertain mode command; the brightness behind it fails at its own
    // expiry while the worker waits, instead of waiting for the next explicit choice.
    const {run, results: values} = await steps(context, [['command', 'q', {kind: 'mode.set', mode: 'Quiet'}],
      ['command', 'b', {kind: 'brightness.set', percent: 60}], ['attempting', 'q'],
      ['run', 1035, [[1031, ['query', 'SELECT id FROM control_journal']]]]]);
    // It expires at its expiry, 30 seconds after admission: gone by the worker's next wait.
    assert.deepEqual((values[3] as {scheduled: unknown[]}).scheduled, [{result: []}]);
    assert.deepEqual(run.outcomes().get('q'), outcome('q', 'uncertain', 'none', 'uncertain-result'));
    assert.deepEqual(run.outcomes().get('b'), outcome('b', 'failed', 'none', 'expired'));
    assert.deepEqual(run.device.calls, []);
    assert.deepEqual(run.query('SELECT id FROM control_journal'), []);
  });

  test('an animation mid-write finishes when a mode command retires the queue', async context => {
    // The mode command commits while the animation's write is out. It retires only queued work, as Python's retirement
    // left an attempt alone, so the animation ends sent.
    const {run} = await steps(context, [['mode', 'free'], ['run', 1002],
      ['play', 'w', {kind: 'animation.play', pattern: 'wave', colors: ['#0044aa', '#00aa66'], speed: 'slow'}],
      ['hook', {method: 'PUT', endpoint: '/effects', payload: 'write', step: ['mode', 'free']}], ['run', 1004]]);
    assert.deepEqual(run.hookResults, [[{result: null}]]);
    assert.deepEqual(run.outcomes().get('w'), outcome('w', 'succeeded', 'transmitted'));
  });

  test('a mode command repeated during the first one\'s write ends it before its next write', async context => {
    // The repeated Quiet commits while the first Quiet's indicator write is out. That write may have reached the
    // device, so the first ends uncertain; its next write is not sent, and the repeat's pass writes Quiet again.
    const {run} = await steps(context, [['feed', 'prompt', 'a'], ['command', 'q', {kind: 'mode.set', mode: 'Quiet'}],
      ['hook', {method: 'PUT', endpoint: '/effects', payload: 'write', step: ['command', 'q2', {kind: 'mode.set', mode: 'Quiet'}]}],
      ['run', 1002]]);
    assert.deepEqual(run.hookResults, [[{result: 'accepted'}]]);
    assert.deepEqual(puts(run.device.calls).map(([endpoint]) => endpoint), ['/effects', '/effects', '/state']);
    assert.deepEqual(run.outcomes().get('q'), outcome('q', 'uncertain', 'none', 'uncertain-result'));
    assert.deepEqual(run.outcomes().get('q2'), outcome('q2', 'succeeded', 'transmitted'));
  });

  test('a mode command repeated after the first one\'s completed write runs in its own pass', async context => {
    // The repeat commits during the first Quiet's last write, after its first completed. The first ends cancelled with
    // that transmission, and the pass starts again for the repeat instead of marking the revision applied.
    const {run} = await steps(context, [['feed', 'prompt', 'a'], ['command', 'q', {kind: 'mode.set', mode: 'Quiet'}],
      ['hook', {method: 'PUT', endpoint: '/state', step: ['command', 'q2', {kind: 'mode.set', mode: 'Quiet'}]}], ['run', 1002]]);
    assert.deepEqual(run.hookResults, [[{result: 'accepted'}]]);
    assert.deepEqual(run.outcomes().get('q'), outcome('q', 'failed', 'transmitted', 'cancelled'));
    assert.deepEqual(run.outcomes().get('q2'), outcome('q2', 'succeeded', 'transmitted'));
    assert.deepEqual(run.query('SELECT id FROM control_journal'), []);
  });

  test('a mode command after a failed pass is applied, not taken as unchanged', async context => {
    // The device's last pass failed, so the same mode is applied again rather than succeeding at once.
    const {run} = await steps(context, [['mode', 'free'], ['run', 1002],
      ['sql', "INSERT OR REPLACE INTO meta VALUES ('control_error', 'Light update failed; retrying.')"],
      ['command', 'f', {kind: 'mode.set', mode: 'Free'}]]);
    assert.equal(run.outcomes().get('f'), undefined);
    await run.apply(['run', 1004]);
    assert.deepEqual(run.outcomes().get('f'), outcome('f', 'succeeded', 'observed'));
    assert.deepEqual(run.query("SELECT value FROM meta WHERE key='control_error'"), []);
  });

  test('a fresh control releases the hold an uncertain write left', async context => {
    const {run} = await steps(context, [['command', 'b', {kind: 'brightness.set', percent: 60}], ['device', 'fail', {method: 'PUT'}],
      ['run', 1002], ['command', 'b2', {kind: 'brightness.set', percent: 40}], ['run', 1004]]);
    assert.deepEqual(run.outcomes().get('b'), outcome('b', 'uncertain', 'none', 'uncertain-result'));
    assert.deepEqual(run.outcomes().get('b2'), outcome('b2', 'succeeded', 'transmitted'));
    assert.deepEqual(run.query("SELECT value FROM meta WHERE key='controller_hold_revision'"), []);
    assert.equal(run.device.brightness, 40);
  });

  test('an animation retired during the pass that would play it is not written', async context => {
    // A mode command commits during the scene's write and retires the animation queued behind it in the same pass.
    const {run} = await steps(context, [['run', 1002], ['mode', 'free'], ['run', 1004], ['command', 's', {kind: 'scene.activate', sceneIndex: 1}],
      ['play', 'a', {kind: 'animation.play', pattern: 'wave', colors: ['#0044aa', '#00aa66'], speed: 'slow'}],
      ['hook', {method: 'PUT', endpoint: '/effects', payload: 'select', step: ['mode', 'free']}], ['run', 1006]]);
    assert.deepEqual(run.hookResults, [[{result: null}]]);
    assert.deepEqual(animationWrites(run.device.calls), []);
    assert.deepEqual(run.outcomes().get('a'), outcome('a', 'failed', 'none', 'cancelled'));
    assert.deepEqual(run.outcomes().get('s'), outcome('s', 'uncertain', 'none', 'uncertain-result'));
  });

  test('a hold during a preview ends the preview', async context => {
    // The brightness expires during the preview's first write, as the listener's expiry did in Python, and holds the
    // device. The preview's next send stops there, as Python's preview send checked the hold.
    const {run} = await steps(context, [['command', 'b', {kind: 'brightness.set', percent: 60}],
      ['sql', "INSERT OR REPLACE INTO meta VALUES ('preview', 'working')"],
      ['hook', {method: 'PUT', endpoint: '/effects', payload: 'write', step: ['expireAll']}], ['run', 1006]]);
    assert.deepEqual(run.hookResults, [[{result: null}]]);
    assert.equal(puts(run.device.calls).filter(([endpoint, payload]) => endpoint === '/effects' && 'write' in (payload as object)).length, 1);
    assert.deepEqual(run.outcomes().get('b'), outcome('b', 'failed', 'none', 'expired'));
  });

  test('a hold the pass sets stops it before its writes', async context => {
    // The animation expires in the pass that would hand the Lines over to Free; that pass ends at the hold, as
    // Python's did, without the handoff's writes.
    const {run, results: values} = await steps(context, [['feed', 'prompt', 'a'], ['run', 1002], ['mode', 'free'],
      ['play', 'w', {kind: 'animation.play', pattern: 'wave', colors: ['#0044aa', '#00aa66'], speed: 'slow'}], ['sleep', 31],
      ['device', 'clearCalls'], ['run', 1036]]);
    assert.deepEqual((values[6] as {outcome: unknown}).outcome, {result: null});
    assert.deepEqual(puts(run.device.calls), []);
    assert.deepEqual(run.outcomes().get('w'), outcome('w', 'failed', 'none', 'expired'));
  });

  test('a held worker ends once shared input is no longer selected', async context => {
    // A new configuration pauses shared input; a worker waiting on a hold then ends, as Python's did.
    const {results: values} = await steps(context, [['command', 'q', {kind: 'mode.set', mode: 'Quiet'}], ['attempting', 'q'],
      ['run', 1005, [[1002, ['sql', "UPDATE shared_input SET source='legacy' WHERE id=1"]]]]]);
    assert.deepEqual((values[2] as {outcome: unknown}).outcome, {result: null});
  });

  test('a held device without shared input ends its worker before reading its configuration', async context => {
    // The worker returns before it loads the device's layout, as Python's did, so a device without a saved layout is
    // not asked for one.
    const directory = temporary(context);
    writeFileSync(join(directory, 'config.json'), JSON.stringify(SCENE));
    const clock = new ManualClock();
    const device = new SceneDevice(clock);
    const database = moduleDatabase(context, directory);
    const reported: unknown[] = [];
    const db = database();
    transaction(db, () => {
      admitCommand(db, directory, {id: 'q', command: {kind: 'mode.set', mode: 'quiet'}, instant: 1000, expires: 1030}, message => reported.push(message));
      execute(db, "UPDATE control_journal SET phase='attempting', uncertain=1");
    });
    assert.equal(await runUntil(context, {directory, database, request: device.request,
      transact: work => transactWith(db, message => reported.push(message))(work)}, clock, 1010), true);
    assert.deepEqual(device.calls, []);
    assert.deepEqual(reported, [outcome('q', 'uncertain', 'none', 'uncertain-result')]);
  });

  test('a replaced sender\'s send is one journaled write', async context => {
    // As Python's tests did, a replaced sender is one write of the pass's mode command.
    const {run} = await steps(context, [['command', 'q', {kind: 'mode.set', mode: 'Quiet'}], ['run', 1002, [], {send: 'capture', scenes: false}]]);
    assert.ok(run.sends.length > 0);
    assert.deepEqual(run.outcomes().get('q'), outcome('q', 'succeeded', 'transmitted'));
  });

  test('a favorite forgotten before its play fails without a write', async context => {
    // The animation was playable when admitted; its favorite is gone by the pass, which ends it with the reason the
    // Lines cannot play it.
    const {run} = await steps(context, [['mode', 'free'], ['run', 1002],
      ['sql', 'INSERT INTO animation_favorites (name, recipe) VALUES (?, ?)', ['calm', '{"pattern":"wave","colors":["#0044aa"]}']],
      ['play', 'f', {kind: 'animation.play', favorite: 'calm'}], ['sql', "DELETE FROM animation_favorites WHERE name='calm'"],
      ['device', 'clearCalls'], ['run', 1004]]);
    assert.deepEqual(animationWrites(run.device.calls), []);
    assert.deepEqual(run.outcomes().get('f'), outcome('f', 'failed', 'none', 'unsupported-capability'));
  });

  test('a scene admitted as an execution completes plays in the same pass', async context => {
    // The scene is admitted after the pass's last write: the pass starts again at once instead of waiting.
    const {run} = await steps(context, [['run', 1002], ['mode', 'free'], ['run', 1004], ['device', 'clearCalls'],
      ['hook', {complete: true, step: ['command', 's', {kind: 'scene.activate', sceneIndex: 1}]}], ['run', 1006]]);
    assert.deepEqual(run.hookResults, [[{result: 'accepted'}]]);
    assert.deepEqual(puts(run.device.calls), [['/effects', {select: 'Cotton Candy'}]]);
    assert.equal(run.device.calls[0]?.[0], 1004);
  });

  test('a hold that comes during a pass\'s writes ends the worker', async context => {
    // The animation expires during the brightness write, as the listener's expiry did in Python, and holds the device:
    // it is not played, and the pass ends at the hold.
    const {run, results: values} = await steps(context, [['mode', 'free'], ['run', 1002], ['command', 'b', {kind: 'brightness.set', percent: 42}],
      ['play', 'w', {kind: 'animation.play', pattern: 'wave', colors: ['#0044aa', '#00aa66'], speed: 'slow'}],
      ['hook', {method: 'PUT', endpoint: '/state', step: ['expireAll']}], ['run', 1006]]);
    assert.deepEqual((values[5] as {outcome: unknown}).outcome, {result: null});
    assert.deepEqual(run.outcomes().get('b'), outcome('b', 'succeeded', 'transmitted'));
    assert.deepEqual(run.outcomes().get('w'), outcome('w', 'failed', 'none', 'expired'));
    assert.deepEqual(animationWrites(run.device.calls), []);
  });

  test('a mode command committed during a control\'s write stops that pass\'s display writes', async context => {
    // The Quiet command commits while the brightness write is out. The Work indicators that pass would have drawn
    // next are not sent; the pass starts again and draws Quiet.
    const {run} = await steps(context, [['feed', 'prompt', 'a'], ['command', 'b', {kind: 'brightness.set', percent: 60}],
      ['hook', {method: 'PUT', endpoint: '/state', payload: 'brightness', step: ['command', 'q', {kind: 'mode.set', mode: 'Quiet'}]}],
      ['run', 1002]]);
    assert.deepEqual(run.hookResults, [[{result: 'accepted'}]]);
    const levels = puts(run.device.calls).flatMap(([endpoint, payload]) => {
      const level = (payload as {brightness?: {value: number}}).brightness?.value;
      return endpoint === '/state' && level !== undefined ? [level] : [];
    });
    assert.equal(levels[0], 60);
    assert.ok(levels.length > 1 && levels.slice(1).every(level => level === 10), String(levels));
    assert.deepEqual(run.outcomes().get('q'), outcome('q', 'succeeded', 'transmitted'));
  });

  test('admission refuses what the device cannot take', context => {
    const run = new ControlCase(context);
    let next = 0;
    const refusal = (command: unknown, device?: string): unknown => {
      const db = run.database();
      next += 1;
      try {
        transaction(db, () => admitCommand(db, run.directory, {id: `r${String(next)}`, command, instant: 1000, expires: 1030,
          ...(device === undefined ? {} : {device})}, run.report));
        return 'accepted';
      } catch (error) {
        if (error instanceof Refused) return error.code;
        throw error;
      }
    };
    assert.equal(refusal({kind: 'brightness.set', percent: 101}), 'invalid-request');
    assert.equal(refusal({kind: 'power.set', on: 'off'}), 'invalid-request');
    assert.equal(refusal({kind: 'mode.set', mode: 'Party'}), 'invalid-request');
    assert.equal(refusal({kind: 'power.set', on: false, extra: 1}), 'invalid-request');
    assert.equal(refusal({kind: 'lamp.set'}), 'invalid-request');
    assert.equal(refusal({kind: 'power.set', on: false}, 'panels'), 'not-found');
    assert.equal(refusal(WAVE), 'unsupported-capability');
    for (let index = 0; index < MAX_QUEUED; index += 1) assert.equal(refusal({kind: 'brightness.set', percent: index}), 'accepted');
    assert.equal(refusal({kind: 'power.set', on: false}), 'capacity');
    // In Free, an animation the Lines cannot play is refused before it waits.
    const db = run.database();
    transaction(db, () => setMode(db, 'free', 1000, run.report));
    assert.equal(refusal({kind: 'animation.play', favorite: 'missing'}), 'unsupported-capability');
    assert.equal(refusal(WAVE), 'accepted');
    assert.deepEqual(run.reported.filter(message => message.type === 'outcome').map(message => message.error?.code),
      Array.from({length: MAX_QUEUED}, () => 'cancelled'));
  });
});
