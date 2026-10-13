import {type RobotState, type SimulatedState} from '@jimmie-potts/bb8';
import {commandType, schemaOf, type PublicFamily} from '@jimmie-potts/bb8/link';
import {act, deviceState, dispatchOnce, expect, holds, recorded, running, type Harness, type Scenario} from '../framework.js';
const owner = 'bunny/modules/bb8';
const robot = (h: Harness): RobotState | undefined => h.reader.states<RobotState>('bb8-robot', owner)[0]?.data;
const operations = (h: Harness): number => deviceState<SimulatedState>(h, 'bb8').operations.length;
function command(h: Harness, family: PublicFamily, extra: object = {}) {
  const state = robot(h); if (state?.link.status !== 'known') throw Error('helper unknown');
  return {key: `bunny.cmd.${family}.bb8`, draft: {type: commandType(family), subject: 'bb8', dataschema: schemaOf(family), data: {expectedConfigurationRevision: 0, expectedHelperEpoch: state.link.value.helperEpoch, expectedConnectionGeneration: state.link.value.connectionGeneration, ...extra}}};
}
export const scenarios: readonly Scenario[] = [{
  id: 'bb8-led-status', title: 'explicit BB-8 LED and power control, passive restart and offline refusal',
  seed: {modules: ['core', 'bb8'], follows: [{owner, families: ['device', 'bb8-robot']}], sections: {bb8: {id: 'bb8', configurationRevision: 0}}},
  steps: [
    expect('core and BB-8 run', h => running(h, ['core', 'bb8'])),
    expect('helper membership is live but disconnected', h => (robot(h)?.linkLive === true && robot(h)?.link.status === 'known') || 'helper is unknown'),
    holds('inspection opens no device and writes nothing', h => operations(h) === 0 || 'inspection caused device work', 200),
    act('operator explicitly connects', h => dispatchOnce(h, 'operator', 'connect', command(h, 'bb8-connect'), 'bb8-connect-1')),
    expect('connect completes with observed version evidence', h => recorded(h, 'bb8-connect-1', 'succeeded', 'observed')),
    act('operator sets the main LED', h => dispatchOnce(h, 'operator', 'led', command(h, 'bb8-led-set', {led: {target: 'main', rgb: [10, 20, 30]}}), 'bb8-led-1')),
    expect('LED completion reports transmission and physical state remains unknown', async h => (await recorded(h, 'bb8-led-1', 'succeeded', 'transmitted')) === true && robot(h)?.physicalLed.status === 'unknown' || 'LED evidence differs'),
    act('operator refreshes power', h => dispatchOnce(h, 'operator', 'power', command(h, 'bb8-power-refresh'), 'bb8-power-1')),
    expect('power retains a category, voltage and original observation time', h => {const state = robot(h); return state?.power.status === 'known' && state.power.value.voltageHundredths === 420 && state.power.value.observedAtMs <= h.now() || 'power unknown';}),
    act('runtime restarts', h => h.restart()),
    expect('BB-8 returns with helper membership', h => robot(h)?.linkLive === true || 'helper offline'),
    holds('restart repeats no robot operation', h => operations(h) === 3 || `${operations(h)} operations`, 300),
    act('helper goes offline', h => {h.simulate({device: 'bb8', action: 'offline'});}),
    expect('connection becomes unavailable', h => {const link = robot(h)?.link; return link?.status === 'known' && link.value.connection === 'unavailable' || 'connection not unavailable';}),
    act('operator attempts another LED write', async h => {const reply = await h.dispatch('operator', 'offline-led', command(h, 'bb8-led-set', {led: {target: 'tail', brightness: 0}}), 'bb8-offline-1'); if (reply !== 'unavailable') throw Error(`offline reply ${reply}`);}),
    holds('offline refusal causes no device effect', h => operations(h) === 3 || `${operations(h)} operations`, 100),
  ],
}, {
  id: 'bb8-short-steps', title: 'supervised BB-8 reference, bounded steps, Stop and passive restart',
  seed: {modules: ['core', 'bb8'], follows: [{owner, families: ['device', 'bb8-robot']}], sections: {bb8: {id: 'bb8', configurationRevision: 0}}},
  steps: [
    expect('core and BB-8 run with live membership', async h => (await running(h, ['core', 'bb8'])) === true && robot(h)?.linkLive === true || 'membership unavailable'),
    act('operator connects', h => dispatchOnce(h, 'operator', 'connect', command(h, 'bb8-connect'), 'bb8-motion-connect')),
    expect('connection completes', h => recorded(h, 'bb8-motion-connect', 'succeeded', 'observed')),
    act('step without a reference refuses', async h => {const reply = await h.dispatch('operator', 'missing-reference', command(h, 'bb8-step', {step: {direction: 'forward', speed: 20, durationMs: 300, forwardReference: 'old-reference'}}), 'bb8-no-reference'); if (reply !== 'invalid-state') throw Error(`reply ${reply}`);}),
    act('operator explicitly sets forward', h => dispatchOnce(h, 'operator', 'aim', command(h, 'bb8-aim', {action: 'set'}), 'bb8-aim-1')),
    expect('reference is live', h => {const link = robot(h)?.link; return link?.status === 'known' && link.value.forwardReference !== undefined || 'reference missing';}),
    act('operator selects one short right step', h => {const link = robot(h)?.link; if (link?.status !== 'known') throw Error('link missing'); return dispatchOnce(h, 'operator', 'step', command(h, 'bb8-step', {step: {direction: 'right', speed: 20, durationMs: 300, forwardReference: link.value.forwardReference}}), 'bb8-step-1');}),
    expect('step completes with transmission evidence', h => recorded(h, 'bb8-step-1', 'succeeded', 'transmitted')),
    act('operator selects Stop', h => dispatchOnce(h, 'operator', 'stop', command(h, 'bb8-stop'), 'bb8-stop-1')),
    expect('Stop completes without claiming observed rest', h => recorded(h, 'bb8-stop-1', 'succeeded', 'transmitted')),
    act('runtime restarts', h => h.restart()),
    expect('membership returns with no valid reference', h => {const link = robot(h)?.link; return robot(h)?.linkLive === true && link?.status === 'known' && link.value.forwardReference === undefined || 'reference or membership differs';}),
    holds('restart repeats no robot operation', h => operations(h) === 4 || `${operations(h)} operations`, 300),
  ],
}];
