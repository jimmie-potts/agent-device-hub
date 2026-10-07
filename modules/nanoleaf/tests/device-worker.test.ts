// Translated from codex-nanoleaf tests/test_device_worker.py and test_panels_controller.py's WorkerOwnershipTest and
// LedgerTest.test_local_mode_change_cancels_only_that_devices_controls: the Lines and NL22 Panels as two devices, each
// with its own worker (PORTING.md lists every case). Each test replays a case recorded from Python on shared input
// (record.DeviceCase) and checks every step, both devices' requests, every address, the rows, both scene files and each
// command's outcome; then the test's own assertions follow. Python's hook events become shared feed changes, and its
// unread set becomes the feed's read evidence (shared input only).
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {BASELINE, COLORS, COMET_SECONDS} from '../src/renderer.js';
import type {LightRequest} from '../src/transport.js';
import {superviseWorker} from '../src/worker.js';
import type {Outcome as ControlOutcome} from '../src/journal.js';
import {puts} from './control-support.js';
import {DeviceCase, replayDevices, type DeviceReplay} from './device-support.js';
import {suite, test} from './support.js';
import {effects, type Call} from './worker-support.js';

/** The results of the replay's steps with this op, in order; an `on` step counts as the step inside it. */
function results(replay: DeviceReplay, op: string): unknown[] {
  return replay.recorded.steps.flatMap((step, index) => {
    const inner = step[0] === 'on' ? step[2] as unknown[] : step;
    const outcome = replay.outcomes[index];
    return inner[0] === op && outcome !== undefined && 'result' in outcome ? [outcome.result] : [];
  });
}

/** The worker run outcomes of the replay, in order. */
const runs = (replay: DeviceReplay): unknown[] => [...results(replay, 'run'), ...results(replay, 'supervise')]
  .map(run => (run as {outcome: unknown}).outcome);

/** The scheduled steps' results of the replay's `index`th worker run. */
function scheduled(replay: DeviceReplay, index = 0): unknown[] {
  const run = results(replay, 'run')[index] as {scheduled: {result?: unknown}[]};
  return run.scheduled.map(item => item.result);
}

const effectWrites = (calls: readonly Call[]): number => effects(calls).length;
const isColor = (frame: readonly number[], color: readonly number[]): boolean => frame[0] === color[0] && frame[1] === color[1] && frame[2] === color[2];
const white = [255, 255, 255];
const levels = (calls: readonly Call[], withPower = false): number[] => puts(calls).flatMap(([endpoint, payload]) => {
  const body = payload as {brightness?: {value: number}; on?: unknown};
  return endpoint === '/state' && body.brightness !== undefined && (!withPower || body.on !== undefined) ? [body.brightness.value] : [];
});

function outcome(id: string, device: string, result: ControlOutcome['result'], evidence: ControlOutcome['evidence'], code?: string): ControlOutcome {
  return {type: 'outcome', device, requestId: id, result, evidence, ...(code === undefined ? {} : {error: {code}})} as ControlOutcome;
}

suite('LaunchAndTargetTest', () => {
  test('test_launch_starts_one_instance_per_registered_device', async context => {
    // Partly: the process launcher is #844's module host, which starts superviseWorker for each registered device.
    const replay = await replayDevices(context, 'each registered device has a worker');
    assert.deepEqual(results(replay, 'registered')[0], ['wall', 'panels']);
  });

  test('test_unreadable_registry_launches_the_original_device', async context => {
    // Partly, as above.
    const replay = await replayDevices(context, 'each registered device has a worker');
    assert.deepEqual(results(replay, 'registered')[1], ['wall']);
  });

  test('test_second_instance_for_a_device_exits_without_sending', async context => {
    const replay = await replayDevices(context, 'a second instance for a device exits without sending');
    assert.deepEqual(runs(replay)[0], {result: false});
    assert.deepEqual(results(replay, 'calls')[0], []);
    assert.ok(effectWrites(replay.run.lines.calls) > 0);
    // The Lines keep the original lock file's name.
    assert.deepEqual(results(replay, 'locks')[0], ['notification-lock.panels.sqlite', 'notification-lock.sqlite']);
  });

  test('test_cli_mode_and_status_accept_a_device_target', async context => {
    // Partly: the command line and its printed status are not ported; mode commands and status address one device.
    const replay = await replayDevices(context, 'mode commands address one device');
    const modes = results(replay, 'status').map(status => (status as {mode: string}).mode);
    assert.deepEqual(modes, ['quiet', 'work', 'free', 'quiet']);
  });

  test('test_unknown_target_is_rejected_without_state_change', async context => {
    // Partly: the command line's exit is not ported. A command for an unregistered device is refused as not-found, where
    // Python's credential check refused it as forbidden, and a malformed device ID as invalid-request; nothing changes.
    const replay = await replayDevices(context, 'an unknown target changes nothing');
    assert.deepEqual(results(replay, 'command'), [{refused: 'not-found'}, {refused: 'invalid-request'}]);
    const [before, after] = results(replay, 'query');
    assert.deepEqual(after, before);
  });
});

suite('MirroredTest', () => {
  test('test_one_task_occupies_one_element_on_each_device', async context => {
    const replay = await replayDevices(context, 'one task occupies one element on each device');
    assert.deepEqual(results(replay, 'query')[0], [['panels', 1], ['wall', 1]]);
    const [lines, panels] = [effects(replay.run.lines.calls)[0]?.[1], effects(replay.run.panels.calls)[0]?.[1]];
    assert.ok(lines !== undefined && panels !== undefined);
    assert.equal(lines.size, 30);
    assert.equal(panels.size, 18);
    const green = (frames: ReadonlyMap<number, number[][]>): number =>
      [...frames.values()].filter(steps => steps.some(step => step[0] === 0 && step[2] === 0 && (step[1] ?? 0) > 0)).length;
    // The first wave crosses every triangle.
    assert.equal(green(panels), 18);
    // The Lines run later on the same shared epoch: their Line stays green, and the obsolete wave is not replayed.
    assert.equal(green(lines), 2);
    assert.deepEqual(results(replay, 'query')[1], [[1]]);
  });

  test('test_scene_restoration_is_per_device', async context => {
    const replay = await replayDevices(context, 'scene restoration is per device');
    assert.deepEqual((replay.run.scenes().panels as {scene: unknown}).scene, {name: 'Forest', brightness: 64});
    assert.equal(replay.run.scenes().wall, null);
    assert.deepEqual([replay.run.panels.selected, replay.run.panels.brightness], ['Forest', 64]);
    assert.deepEqual(replay.run.lines.calls, []);
  });
});

suite('AddressChangeTest', () => {
  test('test_running_worker_sends_to_the_new_address_on_its_next_pass', async context => {
    const replay = await replayDevices(context, 'a running worker follows an address change');
    const moved = replay.run.addresses.indexOf('moved');
    const [before, after] = [replay.run.addresses.slice(0, moved), replay.run.addresses.slice(moved + 1)] as [string[][], string[][]];
    assert.ok(before.length > 0 && before.every(([ip]) => ip === '192.0.2.2'));
    assert.ok(after.some(([, method]) => method === 'PUT'));
    assert.deepEqual(new Set(after.map(([ip]) => ip)), new Set(['192.0.2.4']));
  });
});

suite('SmallPanelsTest', () => {
  test('test_full_panels_device_waits_without_moving_tasks', async context => {
    const replay = await replayDevices(context, 'a full Panels device waits without moving tasks');
    const [counts, panelSlots, countsAfter, panelSlotsAfter] = results(replay, 'query');
    assert.deepEqual(counts, [['panels', 6], ['wall', 9]]);
    // A failing Panels device never gives its tasks to the Lines or takes the Lines' tasks.
    assert.deepEqual(runs(replay)[2], {error: 'OSError', message: 'Device unavailable'});
    assert.deepEqual(panelSlotsAfter, panelSlots);
    assert.deepEqual(countsAfter, counts);
  });
});

suite('EvidenceTest', () => {
  test('test_completion_queues_one_comet_per_work_device', async context => {
    const replay = await replayDevices(context, 'a completion queues one comet per Work device');
    assert.deepEqual(results(replay, 'query'), [[['wall']], [['panels'], ['wall']]]);
  });

  test('test_reading_clears_both_devices_and_drops_queued_comets', async context => {
    // Partly: read evidence comes from the shared feed, so the session stays idle where Python's legacy reader ended it.
    // Shared read evidence drops every device's queued comet when it is accepted, where Python's legacy reader left the
    // Panels' queued comet for the Panels' own pass to drop.
    const replay = await replayDevices(context, 'reading clears both devices and drops queued comets');
    const [, cometsAfterLines, cometsAfterPanels] = results(replay, 'query');
    assert.deepEqual([cometsAfterLines, cometsAfterPanels], [[], []]);
    const flashes = effects(replay.run.panels.calls).some(([, frames]) => [...frames.values()].some(steps => steps.some(step => isColor(step, white))));
    assert.equal(flashes, false);
  });

  test('test_panels_plays_its_own_comet_from_its_own_triangle', async context => {
    // Partly: the read evidence also drops the Lines' queued comet, as shared input reads it, and the Panels' comet,
    // started with the completion, is sent again by the next pass while it runs; Python's legacy run sent it once.
    const replay = await replayDevices(context, 'the Panels play their own comet from their own triangle');
    assert.deepEqual(results(replay, 'query')[0], []);
    const flashing = effects(replay.run.panels.calls).filter(([, frames]) => [...frames.values()].some(steps => steps.some(step => isColor(step, white))));
    assert.ok(flashing.length > 0);
    assert.ok(flashing.every(([at]) => at - (flashing[0]?.[0] ?? 0) < COMET_SECONDS));
    assert.deepEqual(replay.run.lines.calls, []);
  });
});

suite('ModesTest', () => {
  test('test_panels_free_handoff_leaves_lines_rendering', async context => {
    const replay = await replayDevices(context, 'a Panels Free handoff leaves the Lines rendering');
    assert.deepEqual(results(replay, 'deviceState')[0], {brightness: 64, on: true, selected: 'Forest'});
    assert.deepEqual(results(replay, 'calls')[0], []);
    assert.ok(effectWrites(replay.run.lines.calls) > 0);
    assert.deepEqual(replay.run.panels.calls, []);
    assert.deepEqual(results(replay, 'status')[0], {mode: 'free', pending: false, error: null});
  });

  test('test_panels_free_keeps_the_lines_comet_and_pending_edit', async context => {
    const replay = await replayDevices(context, 'a Panels Free keeps the Lines comet and pending edit');
    assert.equal(results(replay, 'patch')[0], true);
    const [comets, pending] = results(replay, 'query');
    assert.deepEqual(comets, [['wall', 1]]);
    assert.deepEqual(pending, [['wall']]);
    assert.equal((results(replay, 'status')[0] as {mode: string}).mode, 'work');
  });

  test('test_unread_completion_shows_unread_color_on_both_devices', async context => {
    const replay = await replayDevices(context, 'an unread completion shows the unread color on both devices');
    const placed = new Map((results(replay, 'query')[0] as [string, number][]));
    const unread = COLORS.unread;
    for (const [device, calls] of [['wall', replay.run.lines.calls], ['panels', replay.run.panels.calls]] as const) {
      const first = effects(calls)[0]?.[1];
      assert.ok(first !== undefined, device);
      const slot = placed.get(device);
      // The task's slot shows the unread color on each device's first frame.
      const colored = [...first.entries()].filter(([, steps]) => steps[0] !== undefined && isColor(steps[0], unread));
      assert.ok(slot !== undefined && colored.length > 0, device);
    }
  });

  test('test_panels_scene_returns_after_a_recoverable_failure', async context => {
    // Partly: the comet the completion starts holds the Panels until the run ends, so the scene's return is checked by
    // the Panels' saved scene and the recorded requests.
    const replay = await replayDevices(context, 'a Panels scene returns after a recoverable failure');
    assert.deepEqual(runs(replay)[0], {error: 'OSError', message: 'Device unavailable'});
    assert.deepEqual((replay.run.scenes().panels as {scene: unknown}).scene, {name: 'Forest', brightness: 64});
    assert.deepEqual(replay.run.lines.calls, []);
  });

  test('test_quiet_on_one_device_keeps_the_other_in_work', async context => {
    const replay = await replayDevices(context, 'Quiet on one device keeps the other in Work');
    assert.equal(levels(replay.run.panels.calls, true)[0], 10);
    assert.equal(levels(replay.run.lines.calls, true)[0], 30);
    const animType = (calls: readonly Call[]): unknown =>
      (puts(calls).find(([endpoint, payload]) => endpoint === '/effects' && 'write' in (payload as object))?.[1] as {write: {animType: string}}).write.animType;
    assert.equal(animType(replay.run.panels.calls), 'static');
    assert.equal(animType(replay.run.lines.calls), 'custom');
  });

  test('test_panels_preview_is_scoped_to_panels', async context => {
    // Partly: the command line that queued the preview is not ported; the preview is the Panels' meta key.
    const replay = await replayDevices(context, 'a preview is scoped to its device');
    assert.deepEqual(results(replay, 'query'), [[['preview@panels']], []]);
    assert.ok(effectWrites(replay.run.panels.calls) > 0);
  });
});

suite('LocateTest', () => {
  test('test_locate_flashes_one_triangle_on_panels_only', async context => {
    const replay = await replayDevices(context, 'Locate flashes one triangle on the Panels only');
    const [located, after] = results(replay, 'query') as [[string, string][], unknown[]];
    assert.equal(located[0]?.[1], 'panels');
    assert.equal(effectWrites(replay.run.lines.calls), 0);
    const flashed = new Set(effects(replay.run.panels.calls).flatMap(([, frames]) =>
      [...frames.entries()].filter(([, steps]) => steps.some(step => isColor(step, white))).map(([zone]) => zone)));
    assert.equal(flashed.size, 1);
    assert.deepEqual(after, []);
    assert.deepEqual([replay.run.panels.selected, replay.run.panels.brightness], ['Forest', 64]);
  });

  test('test_locate_is_rejected_in_panels_free_and_for_lines_ids', async context => {
    const replay = await replayDevices(context, 'Locate is refused in Panels Free and for Lines IDs');
    assert.deepEqual(replay.outcomes.filter((_, index) => replay.recorded.steps[index]?.[0] === 'locate').map(item => 'error' in item && item.error),
      ['ValueError', 'ValueError']);
    assert.deepEqual(results(replay, 'query')[0], []);
  });
});

suite('ContinuityTest', () => {
  test('test_registering_panels_later_replays_nothing', async context => {
    const replay = await replayDevices(context, 'registering the Panels later replays nothing');
    const [epochs, comets, epochAfter, panelComets, panelSlots] = results(replay, 'query') as unknown[][];
    assert.deepEqual(comets, [['wall']]);
    assert.deepEqual(epochAfter, epochs?.filter(row => (row as unknown[])[0] === (epochAfter?.[0] as unknown[] | undefined)?.[0]));
    assert.deepEqual(panelComets, [[0]]);
    const occupied = new Set((panelSlots as [string, number][]).map(([, slot]) => slot));
    const first = effects(replay.run.panels.calls)[0]?.[1];
    assert.ok(first !== undefined);
    // Every unoccupied triangle starts at the baseline: nothing earlier is replayed.
    const zones = [...first.keys()];
    zones.forEach((zone, index) => {
      if (!occupied.has(index)) assert.ok((first.get(zone) ?? []).every(step => isColor(step, BASELINE)), String(zone));
    });
  });

  test('test_override_keeps_the_panels_comet_source_until_it_ends', async context => {
    const replay = await replayDevices(context, 'an override keeps the Panels comet source until it ends');
    const [source, patched, , during, after] = scheduled(replay);
    assert.ok(Array.isArray(source) && source.length === 1);
    assert.equal(patched, false);
    assert.deepEqual(during, source);
    assert.deepEqual(after, []);
  });
});

suite('IsolationTest', () => {
  test('test_panels_outage_leaves_lines_update_and_outcome', async context => {
    // The worker command's retry loop is superviseWorker. Python handed every attempt the same feed state; the port has
    // none to carry (PORTING.md).
    const replay = await replayDevices(context, 'a Panels outage leaves the Lines updating');
    // The first attempt failed, the retry 2 s later ran on, and the stop ended it.
    assert.deepEqual(runs(replay)[1], {stopped: 1010});
    assert.equal(replay.run.panels.calls[0]?.[0], 1000);
    assert.ok(replay.run.panels.calls.some(([at]) => at === 1002));
    const [first] = results(replay, 'status') as {error: unknown}[];
    assert.equal(first?.error, null);
    assert.deepEqual(results(replay, 'query')[0], []);
    assert.ok(effectWrites(replay.run.lines.calls) > 0);
    assert.equal(replay.run.outcomes().size, 0);
  });

  test('test_failed_pass_records_panels_error_only', async context => {
    const replay = await replayDevices(context, 'a failed pass records the Panels error only');
    const [panels, lines] = results(replay, 'status') as {error: unknown}[];
    assert.equal(panels?.error, 'Light update failed; retrying.');
    assert.equal(lines?.error, null);
  });

  test('test_waiting_panels_instance_wakes_even_after_lines_clears_dirty', async context => {
    const replay = await replayDevices(context, 'a waiting Panels worker wakes after the Lines clear the dirty flag');
    const red = effects(replay.run.panels.calls).filter(([, frames]) => [...frames.values()].some(steps => steps.some(step => isColor(step, [255, 0, 0]))));
    assert.ok(red.length > 0);
  });
});

suite('ProtectedApiTest', () => {
  test('test_machine_requests_never_reach_panels', async context => {
    const replay = await replayDevices(context, 'machine requests never reach the Panels');
    assert.equal((results(replay, 'status')[0] as {mode: string}).mode, 'free');
    assert.equal(levels(replay.run.panels.calls, true)[0], 30);
    assert.ok(!levels(replay.run.panels.calls).includes(55));
    assert.deepEqual(results(replay, 'pending'), [['mode.set', 'brightness.set'], []]);
    assert.ok(levels(replay.run.lines.calls).includes(55));
  });

  test('test_extension_animations_play_only_on_lines', async context => {
    const replay = await replayDevices(context, 'requested animations play only on the Lines');
    assert.deepEqual(results(replay, 'play'), ['accepted']);
    assert.equal(effectWrites(replay.run.panels.calls), 0);
    assert.deepEqual(results(replay, 'animationsPending'), [['queued'], []]);
    const custom = puts(replay.run.lines.calls).filter(([endpoint, payload]) => endpoint === '/effects'
      && (payload as {write?: {animType?: string}}).write?.animType === 'custom');
    assert.equal(custom.length, 1);
  });

  test('test_lines_hold_does_not_stop_panels', async context => {
    const replay = await replayDevices(context, 'a Lines hold does not stop the Panels');
    const [[held]] = results(replay, 'query') as [[string]];
    assert.equal(results(replay, 'matchRevision')[0], Number(held));
    assert.ok(effectWrites(replay.run.panels.calls) > 0);
    assert.deepEqual(replay.run.outcomes().get('q'), outcome('q', 'wall', 'uncertain', 'none', 'uncertain-result'));
  });

  test('test_panels_never_runs_controller_integration_or_scene_discovery', async context => {
    // Partly: the port has no integration processing or controller ledger to patch. Each device keeps its own scene
    // list; the Lines' never holds the Panels' scenes.
    const replay = await replayDevices(context, 'only the Lines list the Lines scenes');
    assert.ok(effectWrites(replay.run.panels.calls) > 0);
    assert.deepEqual(results(replay, 'sceneNames')[0], ['Beach Waves', 'Cotton Candy']);
  });

  test('test_panels_pass_keeps_the_lines_error', async context => {
    const replay = await replayDevices(context, 'a Panels pass keeps the Lines error');
    const [lines, panels] = results(replay, 'status') as {error: unknown}[];
    assert.equal(lines?.error, 'Light update failed; retrying.');
    assert.equal(panels?.error, null);
  });

  test('test_lines_outage_keeps_panels_comets_in_shared_input', async context => {
    // Partly: the feed is accepted as steps instead of polled at each attempt.
    const replay = await replayDevices(context, 'a Lines outage keeps the Panels comets in shared input');
    assert.deepEqual(runs(replay), Array.from({length: 3}, () => ({error: 'OSError', message: 'Device unavailable'})));
    assert.deepEqual(results(replay, 'query')[0], [['panels'], ['wall']]);
  });
});

suite('UnregisteredDeviceTest', () => {
  test('test_waiting_instance_exits_after_its_device_is_removed', async context => {
    const replay = await replayDevices(context, 'a waiting instance exits after its device is removed');
    assert.deepEqual(runs(replay)[0], {result: null});
    assert.ok(effectWrites(replay.run.panels.calls) > 0);
    assert.deepEqual(replay.run.panels.calls.filter(([at]) => at > 1003), []);
    assert.ok(effectWrites(replay.run.lines.calls) > 0);
  });

  test('test_retry_loop_stops_for_an_unregistered_device', async context => {
    const replay = await replayDevices(context, 'the retry loop stops for an unregistered device');
    assert.deepEqual(runs(replay)[0], {result: null});
    // One attempt: the device was unregistered during it, so the failure is not recorded or retried.
    assert.equal(replay.run.panels.calls.length, 1);
    assert.deepEqual(results(replay, 'query')[0], []);
  });
});

suite('WorkerOwnershipTest', () => {
  test('test_a_command_runs_only_on_its_own_devices_worker', async context => {
    // Partly: lastSuccessfulSend is #844's device state.
    const replay = await replayDevices(context, 'a command runs only on its own device\'s worker');
    assert.deepEqual(puts(replay.run.panels.calls), [['/state', {brightness: {value: 42, duration: 0}}]]);
    assert.deepEqual(results(replay, 'calls')[0], []);
    assert.deepEqual(puts(replay.run.lines.calls), [['/state', {on: {value: false}}]]);
    assert.deepEqual(replay.run.outcomes().get('p'), outcome('p', 'panels', 'succeeded', 'transmitted'));
    assert.deepEqual(replay.run.outcomes().get('l'), outcome('l', 'wall', 'succeeded', 'transmitted'));
  });

  test('test_commands_admitted_mid_pass_stay_with_their_own_device', async context => {
    // Partly: shared input reads no unread file, so both commands are admitted while the Panels worker waits.
    const replay = await replayDevices(context, 'commands admitted while the Panels worker waits stay with their own device');
    assert.deepEqual(scheduled(replay, 2), ['accepted', 'accepted']);
    assert.deepEqual(puts(replay.run.panels.calls), [['/state', {on: {value: false}}]]);
    assert.deepEqual(puts(replay.run.lines.calls), []);
    assert.deepEqual(replay.run.outcomes().get('p'), outcome('p', 'panels', 'succeeded', 'transmitted'));
    assert.equal(replay.run.outcomes().get('l'), undefined);
  });

  test('test_panels_override_governs_only_the_panels', async context => {
    const replay = await replayDevices(context, 'a Panels override governs only the Panels');
    assert.deepEqual(results(replay, 'desired'), [{brightness: {status: 'known', value: 60}, power: {status: 'unknown'}},
      {brightness: {status: 'unknown'}, power: {status: 'unknown'}}]);
    assert.ok(levels(replay.run.panels.calls).includes(60));
    assert.ok(levels(replay.run.lines.calls).includes(30));
    assert.ok(!levels(replay.run.lines.calls).includes(60));
  });

  test('test_panels_mode_command_is_journaled_by_the_panels_worker', async context => {
    // Partly: the operation lists and lastSuccessfulSend are the journal's and #844's.
    const replay = await replayDevices(context, 'a Panels mode command is journaled by the Panels worker');
    assert.deepEqual(replay.run.outcomes().get('q'), outcome('q', 'panels', 'succeeded', 'transmitted'));
    assert.ok(puts(replay.run.panels.calls).length > 0);
    assert.deepEqual(puts(replay.run.lines.calls), []);
  });

  test('test_uncertain_panels_mode_write_holds_only_the_panels', async context => {
    const replay = await replayDevices(context, 'an uncertain Panels mode write holds only the Panels');
    assert.equal(replay.run.outcomes().get('q')?.result, 'uncertain');
    assert.deepEqual(results(replay, 'query')[0], [['controller_hold_revision@panels']]);
  });

  test('test_panels_hold_leaves_the_lines_running', async context => {
    const replay = await replayDevices(context, 'a Panels hold leaves the Lines running');
    assert.deepEqual(replay.run.outcomes().get('p'), outcome('p', 'panels', 'uncertain', 'none', 'uncertain-result'));
    assert.deepEqual(results(replay, 'query')[0], [['controller_hold_revision@panels']]);
    assert.deepEqual(replay.run.outcomes().get('l'), outcome('l', 'wall', 'succeeded', 'transmitted'));
    // The held Panels' next run never sends the uncertain request again.
    assert.deepEqual(results(replay, 'calls')[0], []);
    // The Lines keep rendering tasks while the Panels are held.
    assert.ok(effectWrites(replay.run.lines.calls) > 0);
  });

  test('test_lines_hold_leaves_panels_commands_running', async context => {
    const replay = await replayDevices(context, 'a Lines hold leaves the Panels commands running');
    assert.deepEqual(puts(replay.run.panels.calls), [['/state', {on: {value: false}}]]);
    assert.deepEqual(replay.run.outcomes().get('p'), outcome('p', 'panels', 'succeeded', 'transmitted'));
    assert.deepEqual(results(replay, 'query')[0], [['controller_hold_revision']]);
  });

  test('test_each_worker_discovers_only_its_own_scenes', async context => {
    // Partly: the extension snapshot is #844's; each device's scene list is read directly.
    const replay = await replayDevices(context, 'each worker discovers only its own scenes');
    assert.deepEqual(results(replay, 'sceneIds'), [[2, true], [2, true]]);
    assert.deepEqual(results(replay, 'sceneNames'), [['Beach Waves', 'Cotton Candy'], ['Forest', 'Sunset']]);
    const {sceneList} = await import('../src/controls.js');
    const ids = (device: string): string[] => sceneList(replay.run.database(), device).map(scene => scene.id);
    assert.deepEqual(ids('wall').filter(id => ids('panels').includes(id)), []);
  });

  test('test_panels_scene_follows_the_panels_mode', async context => {
    // Partly: the refused request's replay is the runtime's.
    const replay = await replayDevices(context, 'a Panels scene follows the Panels mode');
    assert.deepEqual(results(replay, 'command'), [{refused: 'unsupported-capability'}, 'accepted']);
    assert.ok(!puts(results(replay, 'calls')[0] as Call[]).some(([, payload]) => (payload as {select?: string}).select === 'Sunset'));
    assert.deepEqual(puts(replay.run.lines.calls), []);
    assert.deepEqual(puts(replay.run.panels.calls), [['/effects', {select: 'Sunset'}]]);
    assert.deepEqual(replay.run.outcomes().get('s2'), outcome('s2', 'panels', 'succeeded', 'transmitted'));
  });

  test('test_panels_instance_still_owns_no_shared_ingestion', async context => {
    // Partly: the port has no feed poller or integration processing to patch; the Panels' own pass still draws.
    const replay = await replayDevices(context, 'scene restoration is per device');
    assert.ok(effectWrites(replay.run.panels.calls) > 0);
  });
});

suite('LedgerTest', () => {
  test('test_local_mode_change_cancels_only_that_devices_controls', async context => {
    // Partly: the ledger's generation is not ported; the Lines' command stays queued with no outcome.
    const replay = await replayDevices(context, 'a local mode change cancels only that device\'s controls');
    assert.deepEqual(replay.run.outcomes().get('p'), outcome('p', 'panels', 'failed', 'none', 'cancelled'));
    assert.equal(replay.run.outcomes().get('l'), undefined);
    assert.equal((results(replay, 'status')[0] as {mode: string}).mode, 'work');
  });
});

suite('supervisor checks the port adds', () => {
  test('the worker command ends when shared input is paused', async context => {
    // Recorded from Python: a worker that ends while shared input is paused is not run again.
    const replay = await replayDevices(context, 'the worker command ends when shared input is paused');
    assert.deepEqual(runs(replay)[0], {result: null});
    assert.equal(replay.run.clock.seconds() < 1010, true);
  });

  test('a stop during the retry wait ends the worker command', async context => {
    // Recorded from Python: the failure is recorded, and the stop ends the wait before the retry.
    const replay = await replayDevices(context, 'a stop during the retry wait ends the worker command');
    assert.deepEqual(runs(replay)[0], {stopped: 1002});
    assert.deepEqual(results(replay, 'query')[0], [['control_error@panels', 'Light update failed; retrying.']]);
  });

  test('a removed device\'s supervisor ends instead of polling it', async context => {
    // Python's command ran the worker of a removed device again every second until stopped; the supervisor ends.
    const run = new DeviceCase(context);
    await run.apply(['feed', 'prompt', 'a']);
    const result = await run.drive(1020, [[1003, ['unregister', 'panels']]], signal => superviseWorker(run.options(signal, {device: 'panels'})));
    assert.deepEqual(result.outcome, {result: 'unregistered'});
    assert.ok(run.clock.seconds() < 1005);
  });

  test('a supervisor whose device another instance holds ends at once', async context => {
    const run = new DeviceCase(context);
    await run.apply(['lock', 'panels']);
    const result = await run.drive(1010, [], signal => superviseWorker(run.options(signal, {device: 'panels'})));
    assert.deepEqual(result.outcome, {result: 'locked'});
    assert.deepEqual(run.panels.calls, []);
  });

  test('a failure as the supervisor stops is not recorded', async context => {
    // The stop signal comes while a request fails: the supervisor ends without recording a failure for the device.
    const run = new DeviceCase(context);
    await run.apply(['feed', 'prompt', 'a']);
    const controller = new AbortController();
    const request: LightRequest = () => {
      controller.abort();
      return Promise.reject(new Error('Device unavailable'));
    };
    assert.equal(await superviseWorker({...run.options(controller.signal, {device: 'panels'}), request}), 'stopped');
    assert.deepEqual(run.query("SELECT key FROM meta WHERE key LIKE 'control_error%'"), []);
  });

  test('a supervisor that cannot record a failure ends', async context => {
    // A failure the module's database cannot even record ends the supervisor rather than retrying unrecorded.
    const run = new DeviceCase(context);
    const closed = new DatabaseSync(':memory:');
    closed.close();
    const result = await run.drive(1010, [], signal => superviseWorker({...run.options(signal, {device: 'panels'}), database: () => closed}));
    assert.deepEqual(result.outcome, {result: 'unrecorded'});
  });
});
