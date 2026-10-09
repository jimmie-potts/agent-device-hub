// Hub #925: one live occurrence through authenticated controls, arbitration, dispatch and the Lines worker.
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {Operation} from '../../src/core/operations.js';
import {LINES_ADDRESS, NANOLEAF_FAMILIES, type SimulatedState} from '@jimmie-potts/nanoleaf';
import {approvalPrompt, approvalResolved, sessionStarted, turnEnded, turnStarted} from '../fixtures/agents.js';
import {
  CORE_FAMILIES, StepFailure, act, bodyOf, deviceState, dispatchOnce, expect, holds, publish, recorded, running, waiting,
  type GatewayCall, type Harness, type Outcome, type Scenario,
} from './framework.js';
import {NANOLEAF_SECTION} from './modules/nanoleaf.js';

type Run = {ruleId: string; requestId?: string; base?: {name: string; brightness: number; writes: number}; syncs?: number};
const runs = new WeakMap<Harness, Run>();
const runOf = (h: Harness): Run => {
  const run = runs.get(h);
  if (run === undefined) throw new StepFailure('automation setup did not complete');
  return run;
};
const lines = (h: Harness): SimulatedState['devices'][string] => {
  const device = deviceState<SimulatedState>(h, 'nanoleaf').devices[LINES_ADDRESS];
  if (device === undefined) throw new StepFailure('the simulated Lines are missing');
  return device;
};
const wall = (h: Harness): DeviceRecord | undefined =>
  h.reader.states<DeviceRecord>('device', 'bunny/modules/nanoleaf').find(state => state.data.id === 'wall')?.data;
// SDK requests are routed privately, not broadcast to the publication watcher. Admission records observe the real dispatch.
const commands = (h: Harness) => h.logs().filter(({record}) => record.event_name === 'runtime.command.admitted' &&
  record.attributes['bunny.routing.key'] === 'bunny.cmd.moment-play.wall' && record.attributes['bunny.participant'] === 'bunny/core');
const operation = (h: Harness): OperationRecord | undefined =>
  h.reader.states<OperationRecord>('operation', 'bunny/core').find(state => state.data.requestId === runOf(h).requestId)?.data;
const baseWrites = (h: Harness) => {
  const base = runOf(h).base;
  if (base === undefined) throw new StepFailure('the named Free base was not observed');
  const device = lines(h), count = device.writes - base.writes;
  if (count < 0 || count > device.recent.length) throw new StepFailure('the simulator no longer holds the bounded write evidence');
  return count === 0 ? [] : device.recent.slice(-count);
};
async function control(h: Harness, method: GatewayCall['method'], path: string, body: object, status = 200): Promise<Record<string, unknown>> {
  const answer = await h.gateway({as: 'operator', method, path: `/api/v2/automation/${path}`, headers: {'bunny-request': '1'}, body});
  const value = bodyOf<Record<string, unknown>>(answer);
  if (answer.status !== status || value?.schema !== 'automation/2.0') throw new StepFailure('the authenticated automation control was refused');
  return value;
}
const oneEffect = (h: Harness): Outcome =>
  commands(h).length === 1 && baseWrites(h).filter(write => write.endpoint === '/effects' && write.animType === 'custom').length === 1 ||
  'the occurrence did not produce exactly one dispatched moment and one simulated effect write';

const liveMoment: Scenario = {
  id: 'automation-lines-moment',
  title: 'a live turn end runs one tracked Celebrate moment without a page and restores the named Free base',
  seed: {modules: ['core', 'nanoleaf'], follows: [{owner: 'bunny/core', families: [...CORE_FAMILIES, 'operation']},
    {owner: 'bunny/modules/nanoleaf', families: ['device', NANOLEAF_FAMILIES.wall.family, NANOLEAF_FAMILIES.animations.family]}],
  config: {nanoleaf: NANOLEAF_SECTION}},
  steps: [
    expect('the core and Nanoleaf run with available Lines that advertise moments', async h => {
      const ready = await running(h, ['core', 'nanoleaf']);
      return ready === true ? wall(h)?.availability === 'available' && wall(h)?.capabilities.moments.supported === true || 'the wall is not ready for moments' : ready;
    }, 10_000),
    act('the operator creates a fresh disabled rule through the authenticated gateway', async h => {
      const rule = await control(h, 'POST', 'rules', {name: 'Turn end Celebrate', kind: 'event', enabled: false,
        trigger: {source: 'core', kind: 'turn-ended'}, action: {mood: 'celebrate', priorityClass: 'event', durationMs: 1000, targets: ['wall']}}, 201);
      if (typeof rule.id !== 'string' || rule.enabled !== false) throw new StepFailure('the new rule was not disabled');
      runs.set(h, {ruleId: rule.id});
    }),
    act('the operator selects the interrupt set and explicitly enables the saved rule', async h => {
      const interrupt = await control(h, 'PUT', 'interrupt-set', {kinds: ['turn-ended']});
      if (!Array.isArray(interrupt.kinds) || interrupt.kinds.length !== 1 || interrupt.kinds[0] !== 'turn-ended') throw new StepFailure('the interrupt set did not save');
      const enabled = await control(h, 'POST', `rules/${runOf(h).ruleId}/enable`, {});
      if (enabled.enabled !== true) throw new StepFailure('the explicit enable did not save');
    }),
    act('the hook starts a turn and raises an approval prompt', async h => {
      await publish(h, sessionStarted); await publish(h, turnStarted); await publish(h, approvalPrompt('approval-925'));
    }),
    expect('the active approval retains priority and no moment is dispatched', h => {
      const attention = waiting(h, ['approval-925']);
      const tasks = h.reader.states<{id: string; tasks: {status: string; element: string | null}[]}>(NANOLEAF_FAMILIES.wall.family, 'bunny/modules/nanoleaf')
        .find(state => state.data.id === 'wall')?.data.tasks;
      return attention === true ? tasks?.some(task => task.status === 'blocked' && task.element !== null) === true && commands(h).length === 0 ||
        'the wall has not shown the approval without a moment' : attention;
    }, 5000),
    act('the hook resolves the approval before the turn ends', h => publish(h, approvalResolved('approval-925'))),
    expect('the core clears the approval', h => waiting(h, [])),
    act('the operator selects Free through the tracked dispatcher', h => dispatchOnce(h, 'operator', 'automation-free', {
      key: 'bunny.cmd.device-mode-set.wall', draft: {type: 'org.bunny.device-mode.set.requested', subject: 'wall',
        dataschema: 'https://bunny.invalid/events/device-mode-set/2.0', data: {mode: 'free'}},
    }, 'req-925-free')),
    expect('Free is tracked as observed and the controller reports a restorable named scene', async h => {
      const tracked = await recorded(h, 'req-925-free', 'succeeded', 'observed'), device = lines(h), desired = wall(h)?.desired.mode;
      if (tracked !== true) return tracked;
      return desired?.status === 'known' && desired.value === 'free' && !device.select.startsWith('*') && device.scenes.includes(device.select) ||
        'the Lines have not restored a named Free scene';
    }, 5000),
    act('the hook ends the turn with no Automation page connected', async h => {
      const device = lines(h); runOf(h).base = {name: device.select, brightness: device.brightness, writes: device.writes};
      await publish(h, turnEnded);
    }),
    expect('arbitration records admission separately from the tracked command', async h => {
      const answer = await h.gateway({as: 'reader', method: 'GET', path: '/api/v2/automation/log?limit=10'});
      const log = bodyOf<{schema: string; entries: {ruleId: string; target: string; requestId?: string; receipt?: {status: string; requestId: string}; operation?: Operation}[]}>(answer);
      const entry = log?.entries.find(item => item.ruleId === runOf(h).ruleId && item.target === 'wall');
      if (answer.status !== 200 || log?.schema !== 'automation/2.0' || entry?.receipt?.status !== 'accepted' || entry.requestId !== entry.receipt.requestId)
        return 'the automation log has no correlated admission receipt';
      runOf(h).requestId = entry.requestId;
      const command = commands(h)[0]?.record, tracked = entry.operation;
      return commands(h).length === 1 && command?.attributes['bunny.request.id'] === entry.requestId &&
        tracked?.requestId === entry.requestId && tracked.family === 'moment-play' && tracked.target === 'wall' && tracked.requestedBy === 'bunny/core' &&
        tracked.data.mood === 'celebrate' && tracked.data.durationMs === 1000 ||
        'the live occurrence did not dispatch the configured one-second Celebrate';
    }, 5000),
    expect('the existing worker actually writes the temporary effect to the simulated Lines', h => {
      const single = oneEffect(h);
      return single === true ? lines(h).select === '*Dynamic*' && lines(h).effect === 'custom' || 'the Lines are not showing the temporary effect' : single;
    }, 5000),
    expect('completion is tracked as transmitted after the worker restores the named scene and brightness', async h => {
      const base = runOf(h).base, record = operation(h), device = lines(h), writes = baseWrites(h);
      const effect = writes.find(write => write.endpoint === '/effects' && write.animType === 'custom');
      const restored = writes.find(write => write.endpoint === '/effects' && write.select === base?.name);
      if (base === undefined || effect === undefined || restored === undefined || restored.atMs - effect.atMs < 1000 ||
          device.select !== base.name || device.brightness !== base.brightness) return 'the simulator has not shown the bounded effect followed by restoration';
      if (record?.family !== 'moment-play' || record.target !== 'wall' || record.requestedBy !== 'bunny/core' ||
          record.status !== 'completed' || record.result !== 'succeeded' || record.evidence !== 'transmitted') return 'the correlated operation has not completed as transmitted';
      return recorded(h, runOf(h).requestId ?? '', 'succeeded', 'transmitted');
    }, 7000),
    act('the reader reconnects and syncs current state', async h => {
      runOf(h).syncs = h.reader.syncs('operation', 'bunny/core'); await h.disconnect('reader');
    }),
    expect('the operation copy syncs again', h => h.reader.syncs('operation', 'bunny/core') > (runOf(h).syncs ?? 0) || 'the operation copy has not resynced'),
    holds('sync starts no second moment or effect', h => oneEffect(h), 1500),
    act('the runtime restarts on its existing private scenario state', h => h.restart()),
    expect('the restarted owners run and the reader receives the completed operation', async h => {
      const ready = await running(h, ['core', 'nanoleaf']);
      return ready === true ? operation(h)?.status === 'completed' || 'the restarted copy has not shown completion' : ready;
    }, 10_000),
    holds('restart and sync replay no moment and preserve the named Free base', h => {
      const single = oneEffect(h), base = runOf(h).base;
      return single === true ? lines(h).select === base?.name && lines(h).brightness === base.brightness || 'restart changed the restored Free base' : single;
    }, 1500),
  ],
};

export const automationScenarios: readonly Scenario[] = [liveMoment];
