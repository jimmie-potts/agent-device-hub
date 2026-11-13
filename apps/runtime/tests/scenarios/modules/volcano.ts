// The Volcano module's scenarios (Hub #615): synthetic physical use through the module's real store and reads, in both
// transports, with the threshold as a tracked action. The catalog collects this file.
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {VOLCANO_SIMULATED_SECTION, type Session, type VolcanoStatus} from '@jimmie-potts/volcano';
import {act, answers, bodyOf, dispatchOnce, expect, holds, recorded, running, type Harness, type Scenario} from '../framework.js';

const OWNER = 'bunny/modules/volcano';
const status = (h: Harness): VolcanoStatus | undefined => h.reader.states<VolcanoStatus>('volcano-status', OWNER).find(value => value.subject === 'volcano')?.data;
const device = (h: Harness): DeviceRecord | undefined => h.reader.states<DeviceRecord>('device', OWNER).find(value => value.subject === 'volcano')?.data;
const button = (action: string, fields: Record<string, unknown> = {}) => (h: Harness): void => { void h.simulate({device: 'volcano', action, ...fields}); };
const sessions = (check: (found: readonly Session[], gapMinutes: number) => true | string, query = '') =>
  answers({as: 'reader', method: 'GET', path: `/modules/volcano/content/sessions${query}`}, answer => {
    if (answer.status !== 200) return `sessions read ${String(answer.status)}`;
    const body = bodyOf<{sessions: Session[]; gapMinutes: number}>(answer);
    return body === undefined ? 'no body' : check(body.sessions, body.gapMinutes);
  });

export const scenarios: readonly Scenario[] = [{
  id: 'volcano-physical-use',
  title: 'physical use is recorded as facts, the threshold is a tracked action, and unavailable never reads as off',
  seed: {modules: ['core', 'volcano'], sections: {volcano: VOLCANO_SIMULATED_SECTION}, follows: [{owner: OWNER, families: ['device', 'volcano-status']}, {owner: 'bunny/core', families: ['operation']}]},
  steps: [
    expect('the core and the Volcano module run', h => running(h, ['core', 'volcano'])),
    expect('the first reading says the heater is off, observed', h => (status(h)?.heater === 'off' && device(h)?.availability === 'available' && device(h)?.kind === 'volcano') || `${String(status(h)?.heater)}, ${String(device(h)?.availability)}`),
    act('the owner presses HEAT', button('heater-on')),
    expect('the heater reads on', h => status(h)?.heater === 'on' || String(status(h)?.heater)),
    act('a moment passes, and the owner turns it off', async h => { await h.wait(1000); button('heater-off')(h); }),
    expect('the heater reads off', h => status(h)?.heater === 'off' || String(status(h)?.heater)),
    act('a moment later the owner presses HEAT again', async h => { await h.wait(1000); button('heater-on')(h); }),
    expect('the heater reads on again', h => status(h)?.heater === 'on' || String(status(h)?.heater)),
    expect('one session of two stretches under the default threshold', sessions(found => (found.length === 1 && found[0]?.stretches.length === 2) || `${String(found.length)} sessions`)),
    expect('a preview of another threshold answers, and changes nothing', sessions((found, gapMinutes) => (found.length === 1 && gapMinutes === 1) || `${String(found.length)} sessions at ${String(gapMinutes)}`, '?gapMinutes=1')),
    act('the operator sets the threshold through the dispatcher', h => dispatchOnce(h, 'operator', 'gap', {key: 'bunny.cmd.volcano-session-gap.volcano', draft: {type: 'org.bunny.volcano-session.gap.requested', subject: 'volcano', dataschema: 'https://bunny.invalid/events/volcano-session-gap/2.0', data: {gapMinutes: 30}}}, 'gap-30')),
    expect('it has a tracked outcome', h => recorded(h, 'gap-30', 'succeeded', 'observed')),
    expect('the status shows the new threshold', sessions((found, gapMinutes) => (found.length === 1 && gapMinutes === 30) || `${String(found.length)} sessions at ${String(gapMinutes)}`)),
    act('the collector goes away while the heater is on', button('collector-absent')),
    act('the feed goes stale', h => h.wait(16_000)),
    expect('the device reads unavailable and the heater unknown, not off', h => (status(h)?.availability === 'unavailable' && status(h)?.heater === 'unknown' && device(h)?.availability === 'unavailable') || `${String(status(h)?.availability)}, ${String(status(h)?.heater)}`),
    holds('nothing reads as off while it lasts', h => status(h)?.heater !== 'off' || 'it read off', 500),
    act('the collector returns', button('online')),
    expect('the device is available again', h => status(h)?.availability === 'available' || String(status(h)?.availability), 6000),
    act('the runtime restarts', h => h.restart()),
    expect('the threshold and the history survive', sessions((found, gapMinutes) => (found.length === 1 && gapMinutes === 30) || `${String(found.length)} sessions at ${String(gapMinutes)}`)),
    holds('the restart adds no session', async h => {
      const answer = await h.gateway({as: 'reader', method: 'GET', path: '/modules/volcano/content/sessions'});
      return bodyOf<{sessions: Session[]}>(answer)?.sessions.length === 1 || 'a session appeared';
    }, 500),
  ],
}];
