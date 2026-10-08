// The real Hub-mode owner and the existing Nanoleaf/Pixoo simulations, over the catalog's two transports.
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {Mode, ModeState, OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {modeChildRequestId} from '../../src/core/mode-participants.js';
import {NANOLEAF_SECTION} from './modules/nanoleaf.js';
import {PIXOO_SECTION} from './modules/pixoo.js';
import {act, answered, dispatchOnce, expect, holds, show, type Harness, type Outcome, type Scenario} from './framework.js';

const selection = (h: Harness): ModeState | undefined => h.reader.states<ModeState>('mode').map(state => state.data).find(record => record.id === 'hub');
const request = (mode: Mode) => ({key: 'bunny.cmd.mode-set.hub', draft: {type: 'org.bunny.mode.set.requested', subject: 'hub', dataschema: 'https://bunny.invalid/events/mode-set/2.0', data: {mode}}});
const children = (h: Harness): OperationRecord[] => h.reader.states<OperationRecord>('operation').map(state => state.data).filter(record => record.family === 'device-mode-set' && record.requestedBy === 'bunny/core');
const device = (h: Harness, owner: string, id: string): DeviceRecord | undefined => h.reader.states<DeviceRecord>('device', owner).map(state => state.data).find(record => record.id === id);
const mapped = async (h: Harness, requestId: string): Promise<Outcome> => {
  const expected = await Promise.all(['wall', PIXOO_SECTION.device.id].map(async target => [target, await modeChildRequestId(requestId, target)] as const));
  return expected.every(([target, id]) => children(h).some(record => record.requestId === id && record.target === target && record.result === 'succeeded')) || `children: ${show(children(h))}`;
};
const observedMode = (h: Harness, owner: string, id: string, mode: string): Outcome => {
  const desired = device(h, owner, id)?.desired.mode;
  return desired?.status === 'known' && desired.value === mode || `${id} mode: ${show(desired)}`;
};

export const hubModeScenarios: readonly Scenario[] = [{
  id: 'hub-mode', title: 'the saved Hub selection maps to fixed native writers without implicit application or replay',
  seed: {modules: ['core', 'nanoleaf', 'pixoo'], config: {nanoleaf: NANOLEAF_SECTION, pixoo: PIXOO_SECTION}, follows: [
    ['mode', 'operation'], {owner: 'bunny/modules/nanoleaf', families: ['device']}, {owner: 'bunny/modules/pixoo', families: ['device']},
  ]},
  steps: [
    expect('first start serves Free without any core device-mode command', h => selection(h)?.mode === 'free' && children(h).length === 0 || `mode ${show(selection(h))}, children ${children(h).length}`),
    act('the operator explicitly selects Work', h => dispatchOnce(h, 'operator', 'mode-work', request('work'), 'req-hub-work')),
    expect('the selection was accepted', h => answered(h, 'mode-work', 'accepted')),
    expect('Work is saved and both native commands succeed independently', async h => selection(h)?.mode === 'work' ? mapped(h, 'req-hub-work') : `mode ${show(selection(h))}`, 10_000),
    expect('Nanoleaf uses Work and Pixoo uses Monitor', h => observedMode(h, 'bunny/modules/nanoleaf', 'wall', 'work') === true
      ? observedMode(h, 'bunny/modules/pixoo', PIXOO_SECTION.device.id, 'monitor') : observedMode(h, 'bunny/modules/nanoleaf', 'wall', 'work')),
    act('the operator submits the duplicate request and the reader reconnects', async h => {await dispatchOnce(h, 'operator', 'mode-duplicate', request('work'), 'req-hub-work'); await h.disconnect('reader');}),
    expect('the reader has synced the same saved choice and child results again', h => selection(h)?.mode === 'work' && children(h).length === 2 || 'the replacement copies are not synced yet'),
    holds('duplicate and reconnect keep exactly the first two child operations', h => children(h).length === 2 || `children ${children(h).length}`, 300),
    act('the operator explicitly reapplies Work with a new request ID', h => dispatchOnce(h, 'operator', 'mode-reapply', request('work'), 'req-hub-reapply')),
    expect('both new child commands complete', h => mapped(h, 'req-hub-reapply'), 10_000),
    act('the operator selects Free', h => dispatchOnce(h, 'operator', 'mode-free', request('free'), 'req-hub-free')),
    expect('Free is saved and both new commands complete', async h => selection(h)?.mode === 'free' ? mapped(h, 'req-hub-free') : `mode ${show(selection(h))}`, 10_000),
    expect('Nanoleaf uses Free and Pixoo uses Media', h => observedMode(h, 'bunny/modules/nanoleaf', 'wall', 'free') === true
      ? observedMode(h, 'bunny/modules/pixoo', PIXOO_SECTION.device.id, 'media') : observedMode(h, 'bunny/modules/nanoleaf', 'wall', 'free')),
    act('the runtime restarts on its saved state', h => h.restart()),
    expect('the reader syncs the restored Free selection and six child operations', h => selection(h)?.mode === 'free' && children(h).length === 6 || 'the restored copies are not synced yet'),
    holds('Free stays saved with six child operations and nothing sent again', h => selection(h)?.mode === 'free' && children(h).length === 6 || `mode ${show(selection(h))}, children ${children(h).length}`, 300),
  ],
}];
