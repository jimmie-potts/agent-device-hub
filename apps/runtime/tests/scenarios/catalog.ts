// The runtime's scenario catalog (Hub #846): what a person or a device should see, as seeds plus named steps. This file
// holds the core's and the fixture modules' scenarios. Each registered module's scenarios live in its own file,
// `modules/<module>.ts`, which the catalog collects when it loads, so a module adds or changes its scenarios without
// editing this file (Hub #999). Scenarios build on the framework (`framework.ts`), which every run type's harness
// implements.
import {readdirSync} from 'node:fs';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {sessionEntityId, type Identity, type SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {CommandDraft} from '@jimmie-potts/sdk';
import {DEADLINES, type LogRecord} from '../../src/index.js';
import {dashboardScenarios} from './dashboard.js';
import {inboxScenarios} from './inbox.js';
import {operationScenarios} from './operations.js';
import {hubModeScenarios} from './hub-mode.js';
import {automationScenarios} from './automation.js';
import {
  OTHER, OTHER_ID, SESSION_ID, approvalPrompt, approvalResolved, runtimeEnded, sessionStarted, turnEnded, turnStarted, unknownApproval,
} from '../fixtures/agents.js';
import {switchLamp, type Lamp, type Power} from '../fixtures/lamp.js';
import {SIGN_SECTION, SYNTHETIC_TOKEN, type Availability, type Sign} from '../fixtures/sign.js';
import {
  CORE_FAMILIES, PRODUCER, StepFailure, act, answered, answers, bodyOf, byTransport, collected, dispatchOnce, endedAs, expect, failedOperation, holds,
  inboxOf, keep, logged, noPartToken, noToken, outcomesOf, publish, rawCommand, rawRequest, recorded, refusals, refusedWith, running, sendOnce,
  session, show, tracked, waiting, type GatewayCall, type Generational, type Harness, type HookPayload,
  type HookRun, type ModuleRun, type Outcome, type Role, type Scenario, type Seed, type Step,
} from './framework.js';

export * from './framework.js';

const lampPower = (h: Harness, power: Power): Outcome => h.devices().lamp.power['lamp-1'] === power || `lamp-1 is ${String(h.devices().lamp.power['lamp-1'])}`;
const indicator = (h: Harness, shown: 'idle' | 'attention'): Outcome => h.devices().lamp.indicator === shown || `the indicator shows ${h.devices().lamp.indicator}`;
const copied = (h: Harness, power: Power): Outcome => {
  const lamp = h.reader.states<Lamp>('lamp').find(state => state.data.id === 'lamp-1')?.data;
  return lamp?.power === power || `the reader's copy shows lamp-1 ${String(lamp?.power)}`;
};
const switches = (h: Harness): number => h.devices().lamp.calls.length;
/** The commands the lamp received, from the runtime's `from`th start on: it logs each as it begins to handle it. */
const commands = (h: Harness, from = 1): Generational<{record: LogRecord}>[] => logged(h, 'lamp', 'command.executing', from);
const received = (h: Harness, requestId: string): number =>
  commands(h).filter(entry => entry.record.attributes['bunny.request.id'] === requestId).length;
const acknowledgments = (h: Harness, from = 1): number => logged(h, 'lamp', 'outbox.acknowledged', from).length;
/**
 * The bus's records of one request in every generation, as `<event> <severity> <code>` (Hub #949). A request's records
 * must all carry one trace: its command's.
 */
function decided(h: Harness, requestId: string): string[] | string {
  const records = h.logs().map(({record}) => record)
    .filter(record => record.event_name.startsWith('runtime.command.') && record.attributes['bunny.request.id'] === requestId);
  const traces = new Set(records.map(record => `${String(record.trace_id)}:${String(record.span_id)}`));
  if (traces.size > 1) return `${requestId}'s records carry ${traces.size} traces`;
  return records.map(record => [record.event_name, record.severity_text, record.attributes['bunny.code']].filter(part => part !== undefined).join(' '));
}
const recordedAs = (h: Harness, requestId: string, expected: readonly string[]): Outcome => {
  const records = decided(h, requestId);
  return show(records) === show(expected) || `${requestId}: ${show(records)}`;
};
/** An outcome's first publication is recorded once, in its command's trace, however often a restart replays it. */
const publishedOnce = (h: Harness, requestIds: readonly string[]): Outcome => {
  for (const requestId of requestIds) {
    const records = logged(h, 'lamp', 'outcome.published').filter(({record}) => record.attributes['bunny.request.id'] === requestId);
    const commandTrace = h.logs().find(({record}) => record.event_name === 'runtime.command.admitted' && record.attributes['bunny.request.id'] === requestId)?.record.trace_id;
    if (records.length !== 1) return `${requestId}'s publication was recorded ${records.length} times`;
    if (records[0]?.record.trace_id !== commandTrace) return `${requestId}'s publication is outside its command's trace`;
  }
  return true;
};
const republished = (h: Harness, from: number): unknown[] =>
  logged(h, 'lamp', 'outbox.republished', from).map(entry => entry.record.attributes['bunny.outbox.republished_count']);
/** Every reader copy synced at least `times` times. */
const synced = (h: Harness, times: number): Outcome =>
  (h.reader.syncs('session') >= times && h.reader.syncs('lamp') >= times) || `synced ${h.reader.syncs('session')} and ${h.reader.syncs('lamp')} times`;
/**
 * The Harness contract's disconnect: remotely the same subscription heard of the gap once, as the SDK's reconnect tells
 * it; in process the part connected anew, so its subscription heard of none.
 */
const reconnectedAs = (h: Harness): Outcome => {
  const gaps = byTransport(h, {'in-process': 0, remote: 1});
  return h.reader.gaps() === gaps || `the reader's subscription heard ${h.reader.gaps()} gap notices, not ${gaps}`;
};
/** The reader heard no message twice. */
const heardOnce = (h: Harness): Outcome => {
  const ids = h.reader.heard().map(message => `${message.source} ${message.id}`);
  return new Set(ids).size === ids.length || `heard ${ids.length - new Set(ids).size} messages twice`;
};

/** Messages a scenario set aside, such as those published while the reader was away. */
const marks = new WeakMap<Harness, {published: number; gap: readonly Message[]}>();
const markGap = (h: Harness): void => { marks.set(h, {published: h.published().length, gap: []}); };
const closeGap = (h: Harness): void => {
  const mark = marks.get(h);
  if (mark === undefined) throw new StepFailure('no gap was marked');
  marks.set(h, {...mark, gap: h.published().slice(mark.published).map(entry => entry.message)});
};
const noReplay = (h: Harness): Outcome => {
  const gap = marks.get(h)?.gap ?? [];
  if (gap.length === 0) return 'nothing was published while the reader was away';
  const heard = new Set(h.reader.heard().map(message => `${message.source} ${message.id}`));
  const replayed = gap.filter(message => heard.has(`${message.source} ${message.id}`));
  return replayed.length === 0 || `replayed ${show(replayed.map(message => message.type))}`;
};

const FOLLOW_ALL: Seed['follows'] = [CORE_FAMILIES, ['lamp']];

const theApproval = [
  act('the hook observes the session start and an approval prompt', async h => {
    await publish(h, sessionStarted);
    await publish(h, approvalPrompt('approval-1'));
  }),
  expect('the core committed the session, and the reader holds it waiting for approval', h => waiting(h, ['approval-1'])),
  expect('the lamp shows attention on its device', h => indicator(h, 'attention')),
];

const approvalReachesEveryModule: Scenario = {
  id: 'approval-reaches-every-module',
  title: 'an approval prompt reaches every module',
  seed: {modules: ['core', 'lamp', 'chime'], follows: FOLLOW_ALL},
  steps: [
    ...theApproval,
    expect('the chime rang once for the approval', h => show(h.devices().chime.rings) === show([{session: SESSION_ID, attention: 'approval-1'}]) ||
      `rings ${show(h.devices().chime.rings)}`),
    expect('every module is running', h => running(h, ['core', 'lamp', 'chime'])),
    act('the runtime restarts cleanly while the approval still waits', h => h.restart()),
    expect('every module is running again, and the reader still holds the waiting session', h =>
      waiting(h, ['approval-1']) === true ? running(h, ['core', 'lamp', 'chime']) : waiting(h, ['approval-1'])),
    holds('the chime does not ring again for the same approval', h => h.devices().chime.rings.length === 1 || `${h.devices().chime.rings.length} rings`, 500),
    act('the hook observes the approval resolved', h => publish(h, approvalResolved('approval-1'))),
    expect('the reader\'s session no longer waits', h => waiting(h, [])),
    expect('the lamp shows idle again', h => indicator(h, 'idle')),
    holds('the chime rang only once', h => h.devices().chime.rings.length === 1 || `${h.devices().chime.rings.length} rings`, 500),
  ],
};

const commandWithTrackedOutcome: Scenario = {
  id: 'command-tracked-outcome',
  title: 'a command with a tracked outcome',
  seed: {modules: ['core', 'lamp'], follows: FOLLOW_ALL},
  steps: [
    act('the operator switches lamp-1 on as req-on, through the core\'s dispatcher', h => dispatchOnce(h, 'operator', 'on', switchLamp('lamp-1', 'on'), 'req-on')),
    expect('the lamp is on', h => lampPower(h, 'on')),
    expect('history holds one succeeded outcome for req-on, observed on the device', async h => (await recorded(h, 'req-on', 'succeeded', 'observed'))),
    expect('the core tracked req-on from sent to accepted to completed', h =>
      show(tracked(h, 'req-on')) === show(['command.queued INFO queued', 'command.admitted INFO accepted', 'command.completed INFO succeeded']) || show(tracked(h, 'req-on'))),
    expect('the reader\'s copy shows lamp-1 on', h => copied(h, 'on')),
    expect('the core acknowledged the outcome, and the lamp forgot it', h => acknowledgments(h) === 1 || `${acknowledgments(h)} acknowledgments`),
    act('the lamp cannot be reached for its next switch', h => { h.simulate({device: 'lamp', action: 'fail-next'}); }),
    act('the operator switches lamp-1 off as req-off; the lamp accepts it', h => dispatchOnce(h, 'operator', 'off', switchLamp('lamp-1', 'off'), 'req-off')),
    expect('history holds a failed outcome for req-off, with no evidence it reached the device', async h => (await recorded(h, 'req-off', 'failed', 'none'))),
    expect('the inbox holds the failed operation', h => failedOperation(h, 'req-off')),
    holds('the lamp stays on, and a succeeded operation never enters the inbox', h =>
      (lampPower(h, 'on') === true && inboxOf(h, 'req-on').length === 0) || `lamp-1 ${String(h.devices().lamp.power['lamp-1'])}`, 500),
  ],
};

const moduleFailsOthersContinue: Scenario = {
  id: 'module-fails-others-continue',
  title: 'a module fails while the others continue',
  seed: {modules: ['core', 'lamp', 'chime'], follows: FOLLOW_ALL},
  steps: [
    act('the chime\'s next ring hits a fault it does not handle', h => { h.simulate({device: 'chime', action: 'fault-next'}); }),
    ...theApproval,
    expect('the chime failed, and health says so', async h => {
      const chime = (await h.health()).find(module => module.name === 'chime');
      return (chime?.state === 'failed' && chime.reason?.detail === 'a handler threw') || `chime ${show(chime)}`;
    }),
    expect('the core and the lamp keep running', h => running(h, ['core', 'lamp'])),
    act('the operator switches lamp-1 on as req-on', h => dispatchOnce(h, 'operator', 'on', switchLamp('lamp-1', 'on'), 'req-on')),
    expect('the lamp is on, and history holds its outcome', async h => lampPower(h, 'on') === true ? (await recorded(h, 'req-on', 'succeeded', 'observed')) : lampPower(h, 'on')),
    act('the hook observes the approval resolved', h => publish(h, approvalResolved('approval-1'))),
    expect('the lamp shows idle again', h => indicator(h, 'idle')),
    holds('the chime stays failed and never rang', async h => {
      const chime = (await h.health()).find(module => module.name === 'chime');
      return (chime?.state === 'failed' && h.devices().chime.rings.length === 0) || `chime ${String(chime?.state)}, ${h.devices().chime.rings.length} rings`;
    }, 300),
  ],
};

const remotePartReconnects: Scenario = {
  id: 'reconnect-and-sync',
  title: 'a remote part reconnects and syncs, with nothing replayed',
  seed: {modules: ['core', 'lamp'], follows: FOLLOW_ALL},
  steps: [
    expect('the reader synced each copy once', h => (h.reader.syncs('session') === 1 && h.reader.syncs('lamp') === 1) || synced(h, 1)),
    act('the reader\'s connection drops', async h => {
      markGap(h);
      await h.disconnect('reader');
    }),
    act('while it is away, the operator switches lamp-1 on as req-away and the lamp accepts it', async h => {
      await dispatchOnce(h, 'operator', 'away', switchLamp('lamp-1', 'on'), 'req-away');
      closeGap(h);
    }),
    act('and the hook observes an approval prompt', h => publish(h, approvalPrompt('approval-1'))),
    expect('the reader reconnected and synced each copy again', h => synced(h, 2)),
    expect('remotely its own subscription heard of the gap; in process it connected anew', h => reconnectedAs(h)),
    expect('its copy shows the current state: lamp-1 on', h => copied(h, 'on')),
    expect('and the session waiting for approval', h => waiting(h, ['approval-1'])),
    holds('nothing published while it was away reached it', h => noReplay(h), 500),
  ],
};

const zeroModules: Scenario = {
  id: 'zero-modules',
  title: 'the runtime starts with zero modules',
  seed: {modules: [], follows: []},
  steps: [
    expect('health lists no module', async h => (await h.health()).length === 0 || `${(await h.health()).length} modules`),
    act('the hook publishes an observation that no module takes', h => publish(h, sessionStarted)),
    act('the operator asks for a lamp that no module serves', h => h.dispatch('operator', 'none', switchLamp('lamp-1', 'on'), 'req-none')),
    expect('the action is unavailable: no core runs to dispatch it', h => answered(h, 'none', 'unavailable')),
    expect('nothing reached the bus', h => recordedAs(h, 'req-none', [])),
    act('the reader asks for the sessions, and nobody serves them', async h => {
      const result = await h.sdk('reader').sync(['session'], () => {}, {timeoutMs: 1000});
      if (result.status === 'synced') {
        await result.copy.close();
        throw new StepFailure('a sync was served');
      }
      if (result.error.error.code !== 'unavailable') throw new StepFailure(`the sync is ${result.error.error.code}`);
    }),
  ],
};

/** The occurrences of `type` the reader heard from the core. */
const occurrences = (h: Harness, type: string): Message[] => h.reader.heard().filter(message => message.source === 'bunny/core' && message.type === type);
/** The `notice-acknowledge` command for the session's first notice, for `consumerId`. */
const acknowledgment = (h: Harness, consumerId: string): {key: string; draft: CommandDraft<object>} => ({
  key: `bunny.cmd.notice-acknowledge.${SESSION_ID}`,
  draft: {
    type: 'org.bunny.notice.acknowledge.requested', subject: SESSION_ID, dataschema: 'https://bunny.invalid/events/notice-acknowledge/2.0',
    data: {consumerId, noticeId: session(h)?.notices[0]?.id ?? ''},
  },
});
const acknowledgedBy = (h: Harness, consumers: readonly string[]): Outcome => {
  const held = session(h)?.notices[0]?.acknowledgedBy;
  return show(held) === show(consumers) || `the notice is acknowledged by ${show(held)}`;
};

/**
 * The agent-session core with zero device modules (Hub #831): hook observations become sessions, an approval prompt is
 * raised and cleared, a finished turn stays on its session record and never becomes an inbox item, a consumer
 * acknowledges a notice for itself only, a runtime end removes its session, and a restart leaves the sessions uncertain
 * until fresh evidence.
 */
const agentSessions: Scenario = {
  id: 'agent-sessions',
  title: 'the core alone turns hook observations into the sessions every reader syncs',
  seed: {modules: ['core'], follows: [CORE_FAMILIES]},
  steps: [
    expect('health lists the core running, and no device module', async h => {
      const report = await h.health();
      const devices = report.filter(module => module.name === 'lamp' || module.name === 'chime');
      return (report.find(module => module.name === 'core')?.state === 'running' && devices.length === 0) || show(report.map(module => [module.name, module.state]));
    }),
    act('the hook observes two sessions start, and a turn in the first', async h => {
      await publish(h, sessionStarted);
      await publish(h, sessionStarted, {identity: OTHER});
      await publish(h, turnStarted);
    }),
    expect('the reader holds both sessions, the first active', h =>
      (session(h)?.activity === 'active' && session(h, OTHER_ID) !== undefined) || `sessions ${show(h.reader.states('session').length)}, first ${String(session(h)?.activity)}`),
    act('the hook observes an approval prompt in the first', h => publish(h, approvalPrompt('approval-1'))),
    expect('the session waits for approval-1, and the reader heard it raised', h =>
      waiting(h, ['approval-1']) === true ? occurrences(h, 'org.bunny.attention.raised').length === 1 || 'no attention.raised' : waiting(h, ['approval-1'])),
    act('the hook observes the approval resolved', h => publish(h, approvalResolved('approval-1'))),
    expect('the session no longer waits, and the reader heard it cleared as resolved', h => {
      const cleared = occurrences(h, 'org.bunny.attention.cleared').map(message => (message.data as {cause: string}).cause);
      return waiting(h, []) === true ? show(cleared) === show(['resolved']) || `cleared ${show(cleared)}` : waiting(h, []);
    }),
    act('the hook observes the turn end', h => publish(h, turnEnded)),
    expect('the finished turn stays on the session record as one unread notice, and the reader heard turn.ended name it', h => {
      const record = session(h);
      const ended = occurrences(h, 'org.bunny.turn.ended').map(message => (message.data as {noticeId?: string}).noticeId);
      return (record?.activity === 'idle' && record.notices.length === 1 && record.notices[0]?.acknowledgedBy.length === 0 && show(ended) === show([record.notices[0]?.id])) ||
        `activity ${String(record?.activity)}, notices ${show(record?.notices)}, turn.ended ${show(ended)}`;
    }),
    holds('it is no inbox item', h => (h.reader.states('inbox-item').length === 0 && !h.reader.heard().some(message => message.dataschema.includes('/inbox-item/'))) ||
      `inbox ${show(h.reader.states('inbox-item').map(state => state.data))}`, 300),
    act('the panel acknowledges the notice for itself', h => sendOnce(h, 'panel', 'acknowledge', acknowledgment(h, 'panel'), 'req-acknowledge')),
    expect('the notice is acknowledged by the panel only', h => acknowledgedBy(h, ['panel'])),
    act('the operator tries to acknowledge it as the panel', h => h.send('operator', 'impersonate', acknowledgment(h, 'panel'), {timeoutMs: 5000, requestId: 'req-impersonate'})),
    expect('that is forbidden', h => answered(h, 'impersonate', 'forbidden')),
    act('the hook observes the second session\'s runtime end', h => publish(h, runtimeEnded, {identity: OTHER})),
    expect('the reader no longer holds it, and heard it end', h =>
      (session(h, OTHER_ID) === undefined && occurrences(h, 'org.bunny.session.ended').length === 1) || `second session ${show(session(h, OTHER_ID)?.activity)}`),
    act('the runtime restarts cleanly', h => h.restart()),
    expect('the reader synced again: the session is uncertain after the restart, its notice and acknowledgment kept', h => {
      const record = session(h);
      return (record?.restartUncertain === true && record.freshness === 'uncertain' && acknowledgedBy(h, ['panel']) === true) ||
        `restartUncertain ${String(record?.restartUncertain)}, freshness ${String(record?.freshness)}`;
    }),
    act('the hook observes a new turn', h => publish(h, turnStarted, {turn: 'turn-2'})),
    expect('fresh evidence makes it current again', h => (session(h)?.restartUncertain === false && session(h)?.freshness === 'current') || show(session(h)?.freshness)),
  ],
};

/**
 * The early end-to-end path (#827's plan): a hook observation, the committed session, the simulated device's update, a
 * tracked action through the core's dispatcher (#782), its outcome, history and inbox rows, then sync and read, with the
 * same action sent again, the deadline answers, a disconnect, a crash-restart on the same state directory, a failed
 * command and a lost acknowledgment. The core tracks every action and keeps history; stand-ins show its results until
 * #923's history read API and play the inbox items until #923.
 */
const endToEnd: Scenario = {
  id: 'end-to-end',
  title: 'the early end-to-end path, with a duplicate, the deadlines, a disconnect and a crash',
  seed: {modules: ['core', 'lamp'], follows: FOLLOW_ALL},
  steps: [
    ...theApproval,
    act('the operator switches lamp-1 on as req-1, through the core\'s dispatcher', h => dispatchOnce(h, 'operator', 'first', switchLamp('lamp-1', 'on'), 'req-1')),
    expect('the device switched lamp-1 on', h => lampPower(h, 'on')),
    expect('history holds its outcome, and the reader reads it', async h => (await recorded(h, 'req-1', 'succeeded', 'observed'))),
    expect('the bus recorded req-1\'s admission and the lamp\'s reply once each, at INFO, in its command\'s trace',
      h => recordedAs(h, 'req-1', ['runtime.command.admitted INFO', 'runtime.command.replied INFO'])),
    expect('the reader\'s copy of the lamp shows it on', h => copied(h, 'on')),

    act('the operator sends req-1 again: the same action, which the core answers itself', h => dispatchOnce(h, 'operator', 'again', switchLamp('lamp-1', 'on'), 'req-1')),
    holds('history keeps one outcome for req-1, and the device switched once', async h =>
      (await outcomesOf(h, 'req-1')).length === 1 && switches(h) === 1 ? true : `${(await outcomesOf(h, 'req-1')).length} outcomes, ${switches(h)} switches`, 500),
    expect('the core knew it for the same action and sent nothing: the lamp never got it again', h => {
      const duplicate = tracked(h, 'req-1').filter(record => record === 'command.completed INFO duplicate').length;
      return (duplicate === 1 && received(h, 'req-1') === 1) || `${duplicate} duplicate records, the lamp received req-1 ${received(h, 'req-1')} times`;
    }),

    act('the lamp cannot be reached for its next switch', h => { h.simulate({device: 'lamp', action: 'fail-next'}); }),
    act('the operator switches lamp-1 off as req-fail; the lamp accepts it', h => dispatchOnce(h, 'operator', 'fail', switchLamp('lamp-1', 'off'), 'req-fail')),
    expect('history holds a failed outcome for req-fail, with no evidence it reached the device', async h => (await recorded(h, 'req-fail', 'failed', 'none'))),
    expect('the inbox holds req-fail as a failed operation, and the reader reads it', h => failedOperation(h, 'req-fail')),
    holds('lamp-1 stays on, and the device got no switch for req-fail', h => (lampPower(h, 'on') === true && switches(h) === 1) || `${switches(h)} switches`, 300),

    act('the lamp\'s device holds every switch until released', h => { h.simulate({device: 'lamp', action: 'hold'}); }),
    act('the operator switches lamp-1 off as req-held', h => { void h.dispatch('operator', 'held', switchLamp('lamp-1', 'off'), 'req-held'); }),
    expect('the device has req-held and holds it', h => (h.devices().lamp.held && switches(h) === 2) || `held ${String(h.devices().lamp.held)}, ${switches(h)} switches`),
    act('the operator sends req-queued behind it', h => { void h.dispatch('operator', 'queued', switchLamp('lamp-1', 'on'), 'req-queued'); }),
    // `bunny-sdk` "Request and respond with expiry", which the remote transport keeps ("Deadlines"): the dispatcher sends
    // each device command with the device kind's 5 s reply deadline, on both transports.
    expect('req-queued is expired at its deadline: it never reached the lamp', h => answered(h, 'queued', 'expired'), DEADLINES.device.replyMs + 1500),
    expect('req-held is uncertain-result at its deadline: the lamp had it', h => answered(h, 'held', 'uncertain-result'), 3000),
    expect('the core recorded req-queued expired and req-held uncertain, and the inbox holds both', async h => {
      const queued = (await endedAs(h, 'req-queued', ['failed/none'])), held = (await endedAs(h, 'req-held', ['uncertain/none']));
      const items = [...inboxOf(h, 'req-queued'), ...inboxOf(h, 'req-held')].map(item => `${item.result} ${String(item.error?.code)}`);
      return queued !== true ? queued : held !== true ? held : show(items) === show(['failed expired', 'uncertain uncertain-result']) || `inbox ${show(items)}`;
    }),
    act('the device answers', h => { h.simulate({device: 'lamp', action: 'release'}); }),
    expect('lamp-1 turns off, and history records req-held\'s late outcome beside its uncertain end', async h =>
      lampPower(h, 'off') === true ? (await recorded(h, 'req-held', 'succeeded', 'observed')) : lampPower(h, 'off')),
    expect('the late outcome completes req-held\'s record, and nothing was sent again', h => {
      const steps = tracked(h, 'req-held');
      return show(steps) === show(['command.queued INFO queued', 'command.completed WARN uncertain', 'command.completed INFO succeeded']) || show(steps);
    }),
    holds('the lamp never received req-queued, and the device switched only twice', h =>
      (received(h, 'req-queued') === 0 && switches(h) === 2) || `${switches(h)} switches`, 500),
    // ADR 0012's levels: a queued expiry and an uncertain result are WARN.
    expect('the bus recorded each deadline answer once, at its level: req-queued expired, req-held uncertain', h => {
      const answers = [
        recordedAs(h, 'req-queued', ['runtime.command.admitted INFO', 'runtime.command.refused WARN expired']),
        recordedAs(h, 'req-held', ['runtime.command.admitted INFO', 'runtime.command.uncertain WARN uncertain-result']),
      ];
      return answers.find(answer => answer !== true) ?? true;
    }),

    act('the reader\'s connection drops', async h => {
      markGap(h);
      await h.disconnect('reader');
    }),
    act('while it is away, the operator switches lamp-1 on as req-gap and the lamp accepts it', async h => {
      await dispatchOnce(h, 'operator', 'gap', switchLamp('lamp-1', 'on'), 'req-gap');
      closeGap(h);
    }),
    expect('the reader reconnected and synced each copy again', h => synced(h, 2)),
    expect('remotely its own subscription heard of the gap; in process it connected anew', h => reconnectedAs(h)),
    expect('its copy shows lamp-1 on, and history holds req-gap', async h => copied(h, 'on') === true ? (await recorded(h, 'req-gap', 'succeeded', 'observed')) : copied(h, 'on')),
    holds('nothing published while it was away was replayed to it', h => noReplay(h), 500),

    act('the runtime will crash between the lamp\'s next commit and its publish', h => { h.armCrash(); }),
    act('the operator switches lamp-1 off as req-crash', h => { void h.dispatch('operator', 'crash', switchLamp('lamp-1', 'off'), 'req-crash'); }),
    expect('the runtime crashed and started again on the same state directory', h => h.generation() === 2 || `generation ${h.generation()}`),
    // The operator's HTTP call loses its connection with the runtime: its answer is lost, and the action's fate is the
    // tracker's to know.
    expect('req-crash\'s call lost its connection with the runtime', h => answered(h, 'crash', 'lost'), 5000),
    expect('at the restart the lamp republished its state, occurrence and outcome, once', h => {
      const counts = republished(h, 2);
      return show(counts) === show([3]) || `republished ${show(counts)}`;
    }),
    expect('history holds one outcome for req-crash, and the reader resynced to see lamp-1 off', async h =>
      (await recorded(h, 'req-crash', 'succeeded', 'observed')) === true ? copied(h, 'off') : (await recorded(h, 'req-crash', 'succeeded', 'observed'))),
    expect('the session still waits for approval, and the lamp shows attention again', h => waiting(h, ['approval-1']) === true ? indicator(h, 'attention') : waiting(h, ['approval-1'])),
    expect('the inbox still holds req-fail after the restart', h => failedOperation(h, 'req-fail')),
    holds('no command was sent again: the lamp received none after the restart, and switched lamp-1 off once for req-crash', h =>
      (commands(h, 2).length === 0 && received(h, 'req-crash') === 1 && switches(h) === 4 && lampPower(h, 'off') === true) ||
      `${commands(h, 2).length} commands after the restart, ${switches(h)} switches`, 500),
    holds('the reader never heard a message twice', h => heardOnce(h), 100),

    act('the core\'s next acknowledgment to the lamp is lost on its way', h => { h.loseAcknowledgment(); }),
    act('the operator switches lamp-1 on as req-lost; the lamp accepts it', h => dispatchOnce(h, 'operator', 'lost', switchLamp('lamp-1', 'on'), 'req-lost')),
    expect('history holds req-lost\'s outcome', async h => (await recorded(h, 'req-lost', 'succeeded', 'observed'))),
    act('the runtime restarts cleanly', h => h.restart()),
    expect('at the restart the lamp reported req-lost\'s outcome again, and nothing else', h => {
      const counts = republished(h, 3);
      return show(counts) === show([1]) || `republished ${show(counts)}`;
    }),
    expect('the core took it as a duplicate and acknowledged it again, so the lamp forgot it', h => {
      const duplicates = logged(h, 'core', 'message.received', 3)
        .filter(({record}) => record.attributes['bunny.outcome'] === 'duplicate' && record.attributes['bunny.request.id'] === 'req-lost').length;
      const acknowledged = acknowledgments(h, 3);
      return (duplicates === 1 && acknowledged === 1) || `${duplicates} duplicates, ${acknowledged} acknowledgments`;
    }),
    holds('history keeps one outcome each for req-crash and req-lost, and no command was sent again', async h =>
      ((await outcomesOf(h, 'req-crash')).length === 1 && (await outcomesOf(h, 'req-lost')).length === 1 && commands(h, 3).length === 0 && switches(h) === 5) ||
      `${(await outcomesOf(h, 'req-crash')).length} and ${(await outcomesOf(h, 'req-lost')).length} outcomes, ${switches(h)} switches`, 500),
    act('the runtime restarts cleanly again', h => h.restart()),
    expect('the lamp republished nothing, since the core acknowledged every outcome', h => {
      const counts = republished(h, 4);
      return show(counts) === show([0]) || `republished ${show(counts)}`;
    }),
    holds('each outcome\'s publication was recorded once, in its command\'s trace, though the crash, the lost acknowledgment and the restarts sent some again',
      h => publishedOnce(h, ['req-1', 'req-fail', 'req-held', 'req-gap', 'req-crash', 'req-lost']), 100),
    expect('the failed outcome\'s publication is a warning', h => {
      const levels = logged(h, 'lamp', 'outcome.published').filter(({record}) => record.attributes['bunny.request.id'] === 'req-fail').map(({record}) => record.severity_text);
      return show(levels) === show(['WARN']) || `req-fail's publication at ${show(levels)}`;
    }),
  ],
};

/** The reader's copy of sign-1's availability. */
const signShows = (h: Harness, availability: Availability): Outcome => {
  const sign = h.reader.states<Sign>('sign').find(state => state.data.id === 'sign-1')?.data;
  return sign?.availability === availability || `the reader's copy shows sign-1 ${String(sign?.availability)}`;
};
/** What the sign's section names, as the configuration file holds it. */
const SIGN_ADDRESS = SIGN_SECTION.signs[0].address;

/**
 * A configured module (Hub #919): the sign gets its own section, reads its token from the private file the section
 * names, and starts while its sign is offline (policy A). It reports the sign unavailable, reaches it once it comes
 * online, and shows the greeting it rendered in a worker thread, sent with the token. The token appears nowhere.
 */
const configuredModule: Scenario = {
  id: 'configured-module',
  title: 'a configured module starts while its device is offline, and reaches it once it is online',
  seed: {modules: ['core', 'sign'], follows: [CORE_FAMILIES, ['sign']], config: {sign: SIGN_SECTION}},
  steps: [
    expect('the core and the sign are running, though the sign is offline', h => running(h, ['core', 'sign'])),
    expect('the reader\'s copy shows sign-1 unavailable once the sign\'s deadline passed', h => signShows(h, 'unavailable'), 5000),
    holds('the sign shows nothing while it is offline', h => Object.keys(h.devices().sign.shown).length === 0 || `shown ${show(h.devices().sign.shown)}`, 300),
    act('the sign comes online', h => { h.simulate({device: 'sign', action: 'online'}); }),
    expect('the reader\'s copy shows sign-1 available', h => signShows(h, 'available'), 10_000),
    expect('the sign shows the configured greeting, rendered in a worker thread and sent with the token from the secret file', h => {
      const {shown, refused} = h.devices().sign;
      return (shown[SIGN_ADDRESS] === 'HELLO' && refused === 0) || `shown ${show(shown)}, ${refused} refused tokens`;
    }),
    expect('the sign is still running, and health is healthy', h => running(h, ['core', 'sign'])),
    holds('no log record, message, health entry or reader copy carries the token', h => noToken(h), 300),
  ],
};

/**
 * A module whose section the runtime refuses (Hub #919): a sign ID that is not a routing ID. Health shows the sign
 * refused with a registry code, it never reaches its device, and the core runs on.
 */
const misconfiguredModule: Scenario = {
  id: 'misconfigured-module',
  title: 'a module whose configuration is invalid is refused, and the others run',
  seed: {
    modules: ['core', 'sign'], follows: [CORE_FAMILIES], config: {sign: {...SIGN_SECTION, signs: [{id: 'Sign 1', address: SIGN_ADDRESS}]}}, refused: ['sign'],
  },
  steps: [
    expect('health shows the sign refused with invalid-request', async h => {
      const sign = (await h.health()).find(module => module.name === 'sign');
      return (sign?.state === 'refused' && sign.reason?.code === 'invalid-request') || `sign ${show(sign)}`;
    }),
    expect('the core keeps running', h => running(h, ['core'])),
    act('the hook observes a session start', h => publish(h, sessionStarted)),
    expect('the core committed it, and the reader holds the session', h => session(h) !== undefined || 'the reader holds no session'),
    holds('the refused sign never reached its device', h => h.devices().sign.attempts === 0 || `${h.devices().sign.attempts} attempts`, 300),
    holds('no log record, message, health entry or reader copy carries the token', async h => noToken(h), 100),
  ],
};

const LAMP_OWNER = 'bunny/modules/lamp';
const SIGN_OWNER = 'bunny/modules/sign';
/** The devices in the reader's copy of `device` from `owner`, as `<id> <availability>`. */
const devicesFrom = (h: Harness, owner: string): string[] =>
  h.reader.states<DeviceRecord>('device', owner).map(state => `${state.data.id} ${state.data.availability}`).sort();
const holdsDevices = (h: Harness, owner: string, expected: readonly string[]): Outcome =>
  show(devicesFrom(h, owner)) === show(expected) || `the copy from ${owner} holds ${show(devicesFrom(h, owner))}`;
/** The answers to the syncs a scenario asked for itself, by label: the refusal's code and the request's ID. */
const asked = new WeakMap<Harness, Map<string, {code: string; requestId: string}>>();
/** The reader asks once for `device`, naming `owner` if given, and keeps the refusal it expects under `label`. */
async function askForDevices(h: Harness, label: string, owner?: string): Promise<void> {
  const result = await h.sdk('reader').sync(['device'], () => {}, {timeoutMs: 1000, ...owner === undefined ? {} : {owner}});
  if (result.status === 'synced') {
    await result.copy.close();
    throw new StepFailure('the sync was served');
  }
  const answers = asked.get(h) ?? new Map<string, {code: string; requestId: string}>();
  answers.set(label, {code: result.error.error.code, requestId: result.requestId});
  asked.set(h, answers);
}
/** The sync under `label` was refused with `code`, and the runtime recorded its refusal as `records`, `<event> <severity> <code>`. */
const refusedSync = (h: Harness, label: string, code: string, records: readonly string[]): Outcome => {
  const answer = asked.get(h)?.get(label);
  if (answer === undefined) return `no ${label} sync was asked for`;
  if (answer.code !== code) return `the ${label} sync is ${answer.code}`;
  const recorded = h.logs().map(({record}) => record)
    .filter(record => record.event_name.startsWith('runtime.sync.') && record.attributes['bunny.request.id'] === answer.requestId)
    .map(record => [record.event_name, record.severity_text, record.attributes['bunny.code']].filter(part => part !== undefined).join(' '));
  return show(recorded) === show(records) || `the ${label} sync's records: ${show(recorded)}`;
};

/**
 * Two device modules serve `device`, each for its own devices (Hub #967): the lamp for lamp-1, and the configured sign,
 * offline at first, for sign-1. Both run, and the reader keeps one copy of each module's devices, synced by name, which
 * holds only that module's records, live changes included. A sync of `device` that names no owner is refused with
 * `invalid-request`, and one that names the core, which serves no devices, with `unavailable`.
 */
const deviceOwners: Scenario = {
  id: 'device-owners',
  title: 'two device modules serve their own device records, and a reader syncs each by name',
  seed: {
    modules: ['core', 'lamp', 'sign'], config: {sign: SIGN_SECTION},
    follows: [CORE_FAMILIES, {owner: LAMP_OWNER, families: ['device']}, {owner: SIGN_OWNER, families: ['device']}],
  },
  steps: [
    expect('the core, the lamp and the sign are running, though the lamp and the sign both serve device', h => running(h, ['core', 'lamp', 'sign'])),
    expect('health names the lamp and the sign, and no other module, as serving device', async h => {
      const owners = (await h.health()).filter(module => module.serves?.includes('device') === true).map(module => module.name);
      return show(owners) === show(['lamp', 'sign']) || `health names ${show(owners)}`;
    }),
    expect('the reader\'s copy from the lamp holds lamp-1 only', h => holdsDevices(h, LAMP_OWNER, ['lamp-1 unknown'])),
    expect('the reader\'s copy from the sign holds sign-1 only, unavailable once the sign\'s deadline passed', h => holdsDevices(h, SIGN_OWNER, ['sign-1 unavailable']), 5000),
    act('the sign comes online', h => { h.simulate({device: 'sign', action: 'online'}); }),
    expect('the copy from the sign shows sign-1 available', h => holdsDevices(h, SIGN_OWNER, ['sign-1 available']), 10_000),
    holds('the copy from the lamp still holds lamp-1 only, and each copy synced once', h => {
      const lamp = holdsDevices(h, LAMP_OWNER, ['lamp-1 unknown']);
      if (lamp !== true) return lamp;
      const syncs = [h.reader.syncs('device', LAMP_OWNER), h.reader.syncs('device', SIGN_OWNER)];
      return show(syncs) === show([1, 1]) || `the copies synced ${show(syncs)} times`;
    }, 300),
    act('the reader asks for device without naming an owner', h => askForDevices(h, 'unnamed')),
    expect('it is refused with invalid-request, and the runtime recorded the refusal once, at INFO', h =>
      refusedSync(h, 'unnamed', 'invalid-request', ['runtime.sync.refused INFO invalid-request'])),
    act('the reader asks for device from the core, which serves no devices', h => askForDevices(h, 'core', 'bunny/core')),
    expect('it is refused with unavailable, and the runtime recorded the refusal once, at WARN', h =>
      refusedSync(h, 'core', 'unavailable', ['runtime.sync.refused WARN unavailable'])),
    expect('the core, the lamp and the sign are still running', async h => running(h, ['core', 'lamp', 'sign'])),
  ],
};

// The gateway (Hub #835)

/** A raw HTTP client's `publish` call, as `as` from its own source, of a moment's end: an occurrence no hook may send. */
const rawMomentEnded = (h: Harness, as: Role, key: string): GatewayCall => ({as, method: 'POST', path: '/api/sdk/v1/publish', body: {schema: 'sdk-remote/1.0', key, message: {
  specversion: '1.0', bunnyprofile: '2.0', id: 'msg-forged-moment', source: `bunny/parts/${as}`, type: 'org.bunny.moment.ended', subject: 'wall',
  time: new Date(h.now()).toISOString(), kind: 'occurrence', datacontenttype: 'application/json', dataschema: 'https://bunny.invalid/events/moment-ended/2.0',
  traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01', data: {requestId: 'req-moment-1', momentId: 'moment-1', ending: 'preempted', endedAtMs: h.now()},
}}});

/** One MCP tool call as a client credential makes it: initialize, say initialized, call, and end the session. */
async function mcpCall(h: Harness, as: Role, tool: string, args: object): Promise<{status: number; result?: {structuredContent?: unknown; isError?: boolean}}> {
  const version = '2025-11-25';
  const headers = {accept: 'application/json, text/event-stream'};
  const init = await h.gateway({as, method: 'POST', path: '/mcp', headers, body: {
    jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: version, capabilities: {}, clientInfo: {name: 'scenario', version: '1.0.0'}},
  }});
  const sessionId = init.headers['mcp-session-id'];
  if (init.status !== 200 || sessionId === undefined) return {status: init.status};
  const inSession = {...headers, 'mcp-session-id': sessionId, 'mcp-protocol-version': version};
  await h.gateway({as, method: 'POST', path: '/mcp', headers: inSession, body: {jsonrpc: '2.0', method: 'notifications/initialized'}});
  const called = await h.gateway({as, method: 'POST', path: '/mcp', headers: inSession, body: {jsonrpc: '2.0', id: 2, method: 'tools/call', params: {name: tool, arguments: args}}});
  await h.gateway({as, method: 'DELETE', path: '/mcp', headers: inSession});
  keep(h, called);
  return {status: called.status, ...(called.status === 200 ? {result: bodyOf<{result?: {structuredContent?: unknown; isError?: boolean}}>(called)?.result ?? {}} : {})};
}

/**
 * The gateway's reads and refusals (Hub #835): a part reads sessions on `/api/v2` and through MCP, and every refusal is
 * the shared error body with a registry code: an invalid request, a made-up token, a page on another site, a caller
 * without the scope, and a route of the old Hub, which is logged with the route it asked for.
 */
const gatewayReads: Scenario = {
  id: 'gateway-reads',
  title: 'a part reads sessions on /api/v2 and through MCP, and every refusal is a registry code',
  seed: {modules: ['core'], follows: [CORE_FAMILIES]},
  steps: [
    act('the hook observes a session start', h => publish(h, sessionStarted)),
    expect('the reader holds the session', h => session(h) !== undefined || 'the reader holds no session'),
    expect('the operator reads the session on /api/v2/families/session', answers({as: 'operator', method: 'GET', path: '/api/v2/families/session'}, answer => {
      const records = bodyOf<{schema?: string; records?: {id: string}[]}>(answer);
      return (answer.status === 200 && records?.schema === 'family-read/2.0' && records.records?.some(record => record.id === SESSION_ID) === true) ||
        `${answer.status} ${answer.text.slice(0, 200)}`;
    })),
    expect('the snapshot read API answers the core\'s sessions at its revision', answers({as: 'reader', method: 'GET', path: '/api/v2/snapshot?families=session'}, answer => {
      const snapshot = bodyOf<{revision?: number; records?: {session?: {id: string}[]}}>(answer);
      return (answer.status === 200 && (snapshot?.revision ?? 0) > 0 && snapshot?.records?.session?.some(record => record.id === SESSION_ID) === true) ||
        `${answer.status} ${answer.text.slice(0, 200)}`;
    })),
    expect('the operator reads the session through the core_sessions MCP tool', async h => {
      const {status, result} = await mcpCall(h, 'operator', 'core_sessions', {});
      const sessions = (result?.structuredContent as {kind?: string; data?: {result?: {sessions?: {id: string}[]}}} | undefined)?.data?.result?.sessions;
      return (status === 200 && result?.isError === false && sessions?.some(record => record.id === SESSION_ID) === true) || `${status} ${show(result).slice(0, 300)}`;
    }),
    expect('a malformed family name is invalid-request', answers({as: 'operator', method: 'GET', path: '/api/v2/families/Not_A_Family'}, answer => refusedWith(answer, 400, 'invalid-request'))),
    expect('an unknown family is not-found', answers({as: 'operator', method: 'GET', path: '/api/v2/families/no-such-family'}, answer => refusedWith(answer, 404, 'not-found'))),
    expect('a made-up token is unauthenticated', answers({as: 'stranger', method: 'GET', path: '/api/v2/families/session'}, answer => refusedWith(answer, 401, 'unauthenticated'))),
    expect('no credential at all is unauthenticated', answers({as: 'anonymous', method: 'GET', path: '/api/v2/families/session'}, answer => refusedWith(answer, 401, 'unauthenticated'))),
    expect('a credential used from a page on another site is forbidden', answers({as: 'operator', method: 'GET', path: '/api/v2/families/session', origin: 'other'},
      answer => refusedWith(answer, 403, 'forbidden'))),
    expect('a browser session used from a page on another site is forbidden', answers({as: 'browser', method: 'GET', path: '/api/v2/families/session', origin: 'other'},
      answer => refusedWith(answer, 403, 'forbidden'))),
    expect('the hook, which may only send observations, may not read', answers({as: 'hook', method: 'GET', path: '/api/v2/families/session'}, answer => refusedWith(answer, 403, 'forbidden'))),
    expect('a route of the old Hub is not-found', answers({as: 'operator', method: 'GET', path: '/api/monitor/v1/sessions'}, answer => refusedWith(answer, 404, 'not-found'))),
    expect('and is logged with the route it asked for, never its path\'s values', h => {
      const logged = refusals(h, '/api/monitor/v1/sessions');
      return show(logged) === show(['/api/monitor/v1/sessions not-found INFO']) || `logged ${show(logged)}`;
    }),
    holds('no log record, message, health entry or answer carries a token', h => noPartToken(h, collected.get(h)), 100),
  ],
};

/**
 * Each part may use only what its grant allows (Hub #835): a hook's credential may not request a command or read, and
 * publishes lifecycle observations only; the reader's may not command; the operator's requests only the core's own
 * operator commands directly, each with a subject that is its key's last token, and sends every device command through
 * the core's dispatcher (#782). A command that a raw HTTP client sends again is refused as a duplicate, and the core
 * runs it once.
 */
const grantsAndDuplicates: Scenario = {
  id: 'grants-and-duplicates',
  title: 'a token outside its grant is refused, and a command sent again runs once',
  seed: {modules: ['core', 'lamp'], follows: FOLLOW_ALL},
  steps: [
    expect('the hook\'s credential may not request a lamp command', answers(rawRequest('hook', switchLamp('lamp-1', 'on').key,
      {}), answer => refusedWith(answer, 403, 'forbidden'))),
    expect('nor may the reader\'s', async h => refusedWith(keep(h, await h.gateway(rawRequest('reader', switchLamp('lamp-1', 'on').key,
      rawCommand(h, 'bunny/parts/reader', switchLamp('lamp-1', 'on'), 'req-reader', 'msg-reader')))), 403, 'forbidden')),
    expect('nor may the operator\'s: a device\'s command goes through the core\'s dispatcher, which tracks it', async h =>
      refusedWith(keep(h, await h.gateway(rawRequest('operator', switchLamp('lamp-1', 'on').key,
        rawCommand(h, 'bunny/parts/operator', switchLamp('lamp-1', 'on'), 'req-direct', 'msg-direct')))), 403, 'forbidden')),
    expect('nor may the operator send, on a session\'s key, a recovery whose subject names another session: it is invalid-message', async h =>
      refusedWith(keep(h, await h.gateway(rawRequest('operator', `bunny.cmd.approval-recover.${SESSION_ID}`,
        rawCommand(h, 'bunny/parts/operator', recoverIn(OTHER_ID), 'req-misrouted', 'msg-misrouted')))), 400, 'invalid-message')),
    holds('no lamp switched', h => switches(h) === 0 || `${switches(h)} switches`, 200),
    expect('the hook may publish lifecycle observations only: another family on a lifecycle key is forbidden', async h =>
      refusedWith(keep(h, await h.gateway(rawMomentEnded(h, 'hook', 'bunny.event.lifecycle.wall'))), 403, 'forbidden')),
    holds('and nobody heard it', h => !h.reader.heard().some(message => message.type === 'org.bunny.moment.ended') || 'the reader heard the forged moment', 200),
    act('the hook observes a finished turn', async h => {
      await publish(h, sessionStarted);
      await publish(h, turnStarted);
      await publish(h, turnEnded);
    }),
    expect('the reader holds the finished turn\'s notice', h => session(h)?.notices.length === 1 || 'no notice'),
    act('the panel sends a raw command acknowledging the notice for itself', async h => {
      const answer = keep(h, await h.gateway(rawRequest('panel', acknowledgment(h, 'panel').key, rawCommand(h, 'bunny/parts/panel', acknowledgment(h, 'panel'), 'req-raw', 'msg-raw-1'))));
      const result = bodyOf<{result?: {status?: string}}>(answer)?.result;
      if (answer.status !== 200 || result?.status !== 'accepted') throw new StepFailure(`${answer.status} ${answer.text.slice(0, 200)}`);
    }),
    expect('the notice is acknowledged by the panel', h => session(h)?.notices[0]?.acknowledgedBy.includes('panel') === true || show(session(h)?.notices)),
    expect('the same message sent again is refused as duplicate-conflict', async h => refusedWith(keep(h, await h.gateway(rawRequest('panel', acknowledgment(h, 'panel').key,
      rawCommand(h, 'bunny/parts/panel', acknowledgment(h, 'panel'), 'req-raw', 'msg-raw-1')))), 409, 'duplicate-conflict')),
    holds('the core ran it once', h => {
      const ran = logged(h, 'core', 'command.completed').filter(({record}) => record.attributes['bunny.request.id'] === 'req-raw').length;
      return ran === 1 || `the core ran req-raw ${ran} times`;
    }, 300),
    holds('no log record, message, health entry or answer carries a token', h => noPartToken(h, collected.get(h)), 100),
  ],
};

/** An approval recovery addressed to the session `subject`, on whatever key it is sent. */
const recoverIn = (subject: string): {key: string; draft: CommandDraft<object>} => ({
  key: `bunny.cmd.approval-recover.${subject}`,
  draft: {type: 'org.bunny.approval.recover.requested', subject, dataschema: 'https://bunny.invalid/events/approval-recover/2.0', data: {turnId: 'turn-1', expectedRevision: 1}},
});

/** The approval-recover command's draft for the session in the reader's copy. */
const recovery = (record: SessionRecord): object => ({session: record.id, turnId: 'turn-1', expectedRevision: record.revision});

/**
 * The operator's approval recovery (Hub #835, carried from the old Hub's `recover-approval`): an approval without an
 * ID stays waiting across a restart, which leaves the session's evidence uncertain, and the operator retires it with the
 * 2.0 command through the gateway. The hook may not.
 */
const approvalRecovery: Scenario = {
  id: 'approval-recovery',
  title: 'an operator recovers an approval left uncertain by a restart',
  seed: {modules: ['core'], follows: [CORE_FAMILIES]},
  steps: [
    act('the hook observes a turn start and an approval without an ID', async h => {
      await publish(h, turnStarted);
      await publish(h, unknownApproval);
    }),
    expect('the reader holds the session waiting for the approval', h => session(h)?.attention.length === 1 || `attention ${show(session(h)?.attention)}`),
    act('the runtime restarts', h => h.restart()),
    expect('the session is uncertain since the restart', h => session(h)?.restartUncertain === true || `record ${show(session(h)).slice(0, 200)}`),
    expect('the hook may not recover it', async h => {
      const record = session(h);
      if (record === undefined) return 'no session';
      return refusedWith(keep(h, await h.gateway({as: 'hook', method: 'POST', path: '/api/v2/commands/approval-recover', body: recovery(record)})), 403, 'forbidden');
    }),
    expect('a stale revision is revision-conflict', async h => {
      const record = session(h);
      if (record === undefined) return 'no session';
      const stale = {...recovery(record), expectedRevision: record.revision - 1};
      return refusedWith(keep(h, await h.gateway({as: 'operator', method: 'POST', path: '/api/v2/commands/approval-recover', body: stale})), 409, 'revision-conflict');
    }),
    act('the operator recovers it with the revision it read', async h => {
      const record = session(h);
      if (record === undefined) throw new StepFailure('no session');
      const answer = keep(h, await h.gateway({as: 'operator', method: 'POST', path: '/api/v2/commands/approval-recover', body: {...recovery(record), requestId: 'req-recover'}}));
      if (answer.status !== 200 || bodyOf<{status?: string}>(answer)?.status !== 'accepted') throw new StepFailure(`${answer.status} ${answer.text.slice(0, 200)}`);
    }),
    expect('the reader\'s session waits for nothing', h => session(h)?.attention.length === 0 || `attention ${show(session(h)?.attention)}`),
    expect('the reader heard the approval cleared as recovered', h => h.reader.heard().some(message =>
      message.type === 'org.bunny.attention.cleared' && (message.data as {cause?: string}).cause === 'recovered') || 'no recovered clearing'),
    holds('no log record, message, health entry or answer carries a token', h => noPartToken(h, collected.get(h)), 100),
  ],
};

/**
 * A module's contributions (Hub #835, module API 1.2): the sign's page, the preview it loads by reference, its settings
 * and its MCP tool are served from its manifest. A browser session opens the page; a caller without one is refused.
 */
const moduleContributions: Scenario = {
  id: 'module-contributions',
  title: 'a module\'s page, content, settings and MCP tool are served from its manifest',
  seed: {modules: ['core', 'sign'], follows: [CORE_FAMILIES, ['sign']], config: {sign: SIGN_SECTION}},
  steps: [
    expect('the core and the sign are running', h => running(h, ['core', 'sign'])),
    expect('the module list shows the operator the sign\'s page, tool and settings', answers({as: 'operator', method: 'GET', path: '/api/v2/modules'}, answer => {
      const sign = bodyOf<{modules?: {name: string; pages: {path: string}[]; tools: string[]; settings: boolean}[]}>(answer)?.modules?.find(module => module.name === 'sign');
      return (sign?.pages[0]?.path === '/modules/sign/preview' && sign.tools.includes('sign_status') && sign.settings) || `${answer.status} ${answer.text.slice(0, 300)}`;
    })),
    expect('the hook, whose grant may not read, is refused the sign\'s settings, which name its address', answers({as: 'hook', method: 'GET', path: '/api/v2/modules/sign/settings'},
      answer => (refusedWith(answer, 403, 'forbidden') === true && !answer.text.includes('192.0.2.10')) || `${answer.status} ${answer.text.slice(0, 200)}`)),
    expect('a browser session opens the sign\'s page, which refers to its preview by reference', answers({as: 'browser', method: 'GET', path: '/modules/sign/preview'}, answer =>
      (answer.status === 200 && (answer.headers['content-type'] ?? '').startsWith('text/html') && answer.text.includes('src="content/preview.png"') &&
        (answer.headers['content-security-policy'] ?? '').includes('script-src') === false) || `${answer.status} ${answer.text.slice(0, 200)}`)),
    expect('and loads the preview from the sign\'s content', answers({as: 'browser', method: 'GET', path: '/modules/sign/content/preview.png'}, answer =>
      (answer.status === 200 && answer.headers['content-type'] === 'image/png') || `${answer.status} ${answer.headers['content-type'] ?? ''}`)),
    expect('without a session the page is refused', answers({as: 'anonymous', method: 'GET', path: '/modules/sign/preview'}, answer => refusedWith(answer, 401, 'unauthenticated'))),
    expect('the operator reads the sign\'s settings: what its configuration accepted, without its token', answers({as: 'operator', method: 'GET', path: '/api/v2/modules/sign/settings'},
      answer => {
        const shown = bodyOf<{settings?: {greeting?: string; signs?: {id: string}[]}}>(answer)?.settings;
        return (answer.status === 200 && shown?.greeting === 'hello' && shown.signs?.[0]?.id === 'sign-1' && !answer.text.includes(SYNTHETIC_TOKEN)) ||
          `${answer.status} ${answer.text.slice(0, 200)}`;
      })),
    expect('the operator calls the sign_status MCP tool', async h => {
      const {status, result} = await mcpCall(h, 'operator', 'sign_status', {});
      const signs = (result?.structuredContent as {data?: {result?: {signs?: {id: string}[]}}} | undefined)?.data?.result?.signs;
      return (status === 200 && result?.isError === false && signs?.[0]?.id === 'sign-1') || `${status} ${show(result).slice(0, 300)}`;
    }),
    expect('a tool call with an argument the tool does not take is refused before it runs', async h => {
      const {status, result} = await mcpCall(h, 'operator', 'sign_status', {address: '192.0.2.10'});
      const code = (result?.structuredContent as {code?: string} | undefined)?.code;
      return (status === 200 && result?.isError === true && code === 'invalid-request') || `${status} ${show(result).slice(0, 300)}`;
    }),
    holds('no log record, message, health entry or answer carries a token', async h => {
      const outcome = await noToken(h);
      return outcome === true ? noPartToken(h, collected.get(h)) : outcome;
    }, 100),
  ],
};

// Agent hooks (Hub #926)

/** How long one hook may take from its start to its exit: its own 2.9 s budget, inside the clients' 3 s hook timeout. */
const HOOK_EXIT_MS = 3000;
/** Content a hook carries that the normalizers' allowlist drops: no record or message may hold it. */
const DROPPED = 'PRIVATE_SCENARIO_926';
const HOOKED = 'hook-sim-1';
const HOOKED_IDENTITY: Identity = {provider: PRODUCER.provider, client: PRODUCER.client, hostId: PRODUCER.hostId, sourceId: PRODUCER.sourceId, sessionId: HOOKED};
const HOOKED_ID = sessionEntityId(HOOKED_IDENTITY);
const claudeHook = (name: string, extra: Record<string, unknown> = {}): HookPayload =>
  ({hook_event_name: name, session_id: HOOKED, cwd: '/home/owner/projects/demo', ...extra});
/** Why a hook run broke the hook's contract, or undefined: it exits 0 on its own, writes nothing and ends in time. */
export function hookProblem(ran: HookRun): string | undefined {
  if (ran.code !== 0 || ran.signal !== null) return `the hook exited with ${String(ran.code)} ${String(ran.signal)}`;
  // Its output may be a crash's stack, which the proof never quotes: its length says it wrote something (Hub #954).
  if (ran.output !== '') return `the hook wrote ${ran.output.length} characters`;
  return ran.elapsedMs < HOOK_EXIT_MS ? undefined : `the hook took ${Math.round(ran.elapsedMs)} ms`;
}
const hooked = (name: string, payload: HookPayload, options: {runtime?: 'running' | 'stopped'} = {}): Step => act(name, async h => {
  const problem = hookProblem(await h.hook(payload, options));
  if (problem !== undefined) throw new StepFailure(problem);
});
const hookedSession = (h: Harness): SessionRecord | undefined => session(h, HOOKED_ID);

/**
 * Agent hooks through the 2.0 hook script (Hub #926): an unchanged 1.x producer file drives the script, each observation
 * commits the session it reports, an approval prompt is raised and cleared, the producer's converted credential may only
 * publish lifecycle observations, and a hook that runs while the runtime is stopped exits quietly within its budget, its
 * observation lost as hooks fail open.
 */
const agentHooks: Scenario = {
  id: 'agent-hooks',
  title: 'agent hooks reach the core through the 2.0 hook script, and exit quietly while the runtime is stopped',
  seed: {modules: ['core'], follows: [CORE_FAMILIES]},
  steps: [
    hooked('the hook script reports a new Claude Code session', claudeHook('SessionStart')),
    expect('the reader holds the session, with its project', h => {
      const record = hookedSession(h);
      return (record?.activity === 'active' && record.project === 'demo') || `session ${show(record === undefined ? undefined : {activity: record.activity, project: record.project})}`;
    }),
    hooked('a prompt starts a turn', claudeHook('UserPromptSubmit', {prompt_id: 'prompt-1', prompt: DROPPED})),
    expect('the session holds the turn', h => (hookedSession(h)?.turn.status === 'known' && show(hookedSession(h)?.turn) === show({status: 'known', id: 'prompt-1'})) || show(hookedSession(h)?.turn)),
    hooked('a permission dialog opens', claudeHook('PermissionRequest', {prompt_id: 'prompt-1', tool_name: 'Bash', tool_input: {command: DROPPED}})),
    expect('the approval prompt is raised on the turn, and the reader heard it', h => {
      const attention = hookedSession(h)?.attention ?? [];
      const raised = occurrences(h, 'org.bunny.attention.raised').filter(message => message.subject === HOOKED_ID).length;
      return (show(attention) === show([{id: {status: 'unknown'}, kind: 'approval', turn: {status: 'known', id: 'prompt-1'}}]) && raised === 1) || `attention ${show(attention)}, raised ${raised}`;
    }),
    hooked('the tool finishes', claudeHook('PostToolUse', {prompt_id: 'prompt-1', tool_use_id: 'tool-1', tool_response: {output: DROPPED}})),
    expect('the approval prompt is cleared as resolved', h => {
      const cleared = occurrences(h, 'org.bunny.attention.cleared').filter(message => message.subject === HOOKED_ID).map(message => (message.data as {cause: string}).cause);
      return (hookedSession(h)?.attention.length === 0 && show(cleared) === show(['resolved'])) || `attention ${show(hookedSession(h)?.attention)}, cleared ${show(cleared)}`;
    }),
    hooked('the turn ends', claudeHook('Stop', {prompt_id: 'prompt-1'})),
    expect('the session is idle with its finished turn', h => (hookedSession(h)?.activity === 'idle' && hookedSession(h)?.notices.length === 1) || show(hookedSession(h)?.activity)),
    expect('the producer\'s credential may not send a command', answers({as: 'producer', method: 'POST', path: '/api/sdk/v1/request', body: {
      schema: 'sdk-remote/1.0', key: `bunny.cmd.approval-recover.${HOOKED_ID}`, command: {},
    }}, answer => refusedWith(answer, 403, 'forbidden'))),
    expect('nor read the sessions', answers({as: 'producer', method: 'GET', path: '/api/v2/families/session'}, answer => refusedWith(answer, 403, 'forbidden'))),
    expect('the gateway confirms it holds ingest', answers({as: 'producer', method: 'GET', path: '/api/v2/authority?scope=ingest'}, answer =>
      (answer.status === 200 && bodyOf<{scope?: string}>(answer)?.scope === 'ingest') || `${answer.status} ${answer.text.slice(0, 200)}`)),
    hooked('a hook while the runtime is stopped exits quietly within its budget', claudeHook('UserPromptSubmit', {prompt_id: 'prompt-2'}), {runtime: 'stopped'}),
    expect('the runtime is back, and the observation sent while it was stopped was lost: hooks fail open', h => {
      const record = hookedSession(h);
      return (h.generation() === 2 && show(record?.turn) === show({status: 'known', id: 'prompt-1'}) && record?.restartUncertain === true) ||
        `generation ${h.generation()}, turn ${show(record?.turn)}, restartUncertain ${String(record?.restartUncertain)}`;
    }),
    hooked('the next hook reaches the restarted runtime', claudeHook('UserPromptSubmit', {prompt_id: 'prompt-2'})),
    expect('fresh evidence makes the session current again on the new turn', h => {
      const record = hookedSession(h);
      return (show(record?.turn) === show({status: 'known', id: 'prompt-2'}) && record?.restartUncertain === false) || `turn ${show(record?.turn)}, restartUncertain ${String(record?.restartUncertain)}`;
    }),
    holds('nothing the allowlist drops reached the runtime', h =>
      ![h.logs(), h.published(), h.reader.heard()].some(value => JSON.stringify(value).includes(DROPPED)) || 'dropped content reached the runtime', 100),
    holds('no log record, message, health entry or answer carries a token', async h => noPartToken(h, collected.get(h)), 100),
  ],
};

/** A module's scenario file, `modules/<module>.ts`: its scenarios, and any disposable run of its own (tier 2). */
export type ModuleScenarios = {readonly scenarios: readonly Scenario[]; readonly runs?: Readonly<Record<string, ModuleRun>>};

/** The core's and the fixture modules' scenarios, in the order a reader meets them. */
const CORE_SCENARIOS: readonly Scenario[] = [
  approvalReachesEveryModule, commandWithTrackedOutcome, moduleFailsOthersContinue, remotePartReconnects, zeroModules, agentSessions, endToEnd,
  configuredModule, misconfiguredModule, deviceOwners, gatewayReads, grantsAndDuplicates, approvalRecovery, moduleContributions, agentHooks,
  ...dashboardScenarios, ...operationScenarios, ...inboxScenarios, ...hubModeScenarios, ...automationScenarios,
];

/** Every module scenario file in `folder`, by its name without `.js`, in name order. */
export async function collectModuleFiles(folder: URL): Promise<Record<string, ModuleScenarios>> {
  const files = readdirSync(folder).filter(file => file.endsWith('.js')).sort();
  return Object.fromEntries(await Promise.all(files.map(async file =>
    [file.slice(0, -'.js'.length), await import(new URL(file, folder).href) as ModuleScenarios] as const)));
}

/** Every module's scenario file, from `modules/` beside this file once built, by its name, in name order. */
export const MODULE_FILES: Readonly<Record<string, ModuleScenarios>> = await collectModuleFiles(new URL('./modules/', import.meta.url));

/** The catalog: the core's scenarios, then each module file's, in file-name order. */
export const SCENARIOS: readonly Scenario[] = [...CORE_SCENARIOS, ...Object.values(MODULE_FILES).flatMap(file => file.scenarios)];

export const scenario = (id: string): Scenario | undefined => SCENARIOS.find(entry => entry.id === id);
