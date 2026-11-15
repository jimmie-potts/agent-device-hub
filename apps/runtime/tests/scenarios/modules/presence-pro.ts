import {FAMILY, SOURCE, type PresenceObservation} from '@jimmie-potts/presence-pro/contracts';
import {SYNTHETIC_SECTION} from '@jimmie-potts/presence-pro/testing';
import {act, answers, bodyOf, expect, holds, running, type Harness, type Scenario} from '../framework.js';

const state = (h: Harness, id: string) => h.reader.states<PresenceObservation>(FAMILY, SOURCE).find(message => message.data.id === id)?.data;
export const scenarios: readonly Scenario[] = [{
  id: 'presence-pro-reports', title: 'two stock sensor reports preserve anonymous approximate points and disconnect uncertainty',
  seed: {modules: ['core', 'presence-pro'], sections: {'presence-pro': SYNTHETIC_SECTION}, follows: [{owner: SOURCE, families: [FAMILY]}]},
  steps: [
    expect('core and both configured report sources run', h => running(h, ['core', 'presence-pro'])),
    expect('both cached occupancy reports populate independently', h => ['presence-a', 'presence-b'].every(id => state(h, id)?.occupancy.value === 'occupied') || 'initial reports missing'),
    expect('the reader sees approximate calibrated XZ with receipt times', answers({as: 'reader', method: 'GET', path: `/api/v2/families/${FAMILY}`}, answer => {
      const records = bodyOf<{records: PresenceObservation[]}>(answer)?.records;
      return answer.status === 200 && records?.length === 2 && records.every(record => record.targets[0]?.apartmentMeters.status === 'known' && record.occupancy.receivedAtMs.status === 'known') || 'authenticated calibrated records missing';
    })),
    act('one sensor disconnects', h => h.simulate({device: 'presence-pro', action: 'offline', id: 'presence-a'})),
    expect('the disconnected sensor is unknown and the second is usable', h => state(h, 'presence-a')?.occupancy.value === 'unknown' && state(h, 'presence-a')?.connection === 'disconnected'
      && state(h, 'presence-b')?.occupancy.value === 'occupied' || 'disconnect claimed absence or affected the second sensor'),
    act('the first source becomes reachable', h => h.simulate({device: 'presence-pro', action: 'online', id: 'presence-a'})),
    expect('one bounded retry reconnects', h => state(h, 'presence-a')?.connection === 'connected' || 'reconnect pending', 6000),
    act('the stock slot becomes inactive then active without new coordinates', async h => {
      await h.simulate({device: 'presence-pro', action: 'report', id: 'presence-a', key: 4, value: false});
      await h.simulate({device: 'presence-pro', action: 'report', id: 'presence-a', key: 4, value: true});
    }),
    expect('the reader receives the slot reset', h => state(h, 'presence-a')?.targets[0]?.apartmentMeters.status === 'unknown' || 'reset report pending'),
    holds('a reactivated source slot cannot borrow its old coordinates', h => state(h, 'presence-a')?.targets[0]?.apartmentMeters.status === 'unknown' || 'old axes revived', 100),
  ],
}];
