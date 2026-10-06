// The runtime's scenario catalog (Hub #846): what a person or a device should see, as seeds plus named steps. Each run
// type has one execution adapter that runs these definitions unchanged: the in-memory harness (`memory.ts`, tier 1, in
// CI) and #920's disposable runs (tier 2). A step acts through the harness, expects an observation within a time bound,
// or expects one to hold for a while. Time is virtual in memory and real in a run; only the harness differs.
import type {InboxItem, SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {CommandDraft, Participant} from '@jimmie-potts/sdk';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import type {LogRecord, ModuleHealth} from '../../src/index.js';
import {SESSION_ID, approvalPrompt, approvalResolved, observation, sessionStarted} from '../fixtures/agents.js';
import type {ChimeDeviceState} from '../fixtures/chime.js';
import type {HistoryEntry} from '../fixtures/core.js';
import {switchLamp, type Lamp, type LampDeviceState, type Power} from '../fixtures/lamp.js';

export const TRANSPORTS = ['in-process', 'remote'] as const;
/** How the scenario's parts reach the runtime: on its bus, or through its SDK edge over SSE and HTTP. */
export type TransportName = (typeof TRANSPORTS)[number];
/** The parts a scenario plays: an agent hook, two control surfaces and a reader such as the dashboard. */
export const ROLES = ['hook', 'operator', 'panel', 'reader'] as const;
export type Role = (typeof ROLES)[number];
/** The modules a run can start, each built by its factory with its simulated transport. */
export type ModuleName = 'core' | 'lamp' | 'chime';

export type Seed = {
  /** The modules the runtime starts with, in order. The stand-in core comes first, as the real core will (#831). */
  readonly modules: readonly ModuleName[];
  /** The families the reader keeps a copy of, one list per owner. */
  readonly follows: readonly (readonly string[])[];
};

/** What the reader has: its copies' current states and the occurrences and outcomes it heard. */
export interface ReaderView {
  /** The current state messages of one family in the reader's copy. */
  states<T>(family: string): Message<T>[];
  /** How often the copy that holds `family` has synced, the first sync included. */
  syncs(family: string): number;
  /** Every occurrence and outcome the reader heard, in order. */
  heard(): readonly Message[];
}

/** What the simulated devices show. Plain data, so a disposable run can report it too. */
export type DeviceStates = {lamp: LampDeviceState; chime: ChimeDeviceState};
/** What a scenario can make a simulated device do. */
export type Simulation =
  | {device: 'lamp'; action: 'hold' | 'release' | 'fail-next'}
  | {device: 'chime'; action: 'fault-next'};
export type Generational<T> = {generation: number} & T;

/** What a scenario can touch. Each run type implements it; the in-memory harness is `memory.ts`. */
export interface Harness {
  readonly tier: 'memory' | 'run';
  readonly transport: TransportName;
  /** The run's clock, in epoch milliseconds: virtual in memory, the wall clock in a run. */
  now(): number;
  /** How many times the runtime has started: 1 at first, and one more after each crash or restart. */
  generation(): number;
  /** The role's participant now: a new one in process after a reconnect or restart, the same one remotely. */
  sdk(role: Role): Participant;
  /**
   * Sends a command as `role` and records how it ends under `label`. Resolves with the answer, which a step may also
   * leave to `answer`.
   */
  send(role: Role, label: string, command: {key: string; draft: CommandDraft<object>}, options: {timeoutMs: number; requestId: string}): Promise<string>;
  /**
   * How the request under `label` ended: `accepted`, the refusal's or uncertain result's error code, `pending`, or
   * `lost` when its requester died with the runtime.
   */
  answer(label: string): string;
  readonly reader: ReaderView;
  devices(): DeviceStates;
  simulate(simulation: Simulation): void;
  health(): Promise<readonly ModuleHealth[]>;
  /** The runtime's log records so far, each with the generation that wrote it. */
  logs(): readonly Generational<{record: LogRecord}>[];
  /** Every message published on the runtime's bus so far, each with its generation. */
  published(): readonly Generational<{message: Message}>[];
  /** Lets `ms` pass: virtual time in memory, real time in a run. */
  wait(ms: number): Promise<void>;
  /**
   * Drops the role's connection. Remotely the edge ends its stream, and the remote part reconnects; in process its
   * participant closes, and the part connects again shortly. Either way its copies sync again, and nothing it missed
   * is replayed.
   */
  disconnect(role: Role): Promise<void>;
  /** Closes the role's participant for good, as a requester that gives up. */
  closePart(role: Role): Promise<void>;
  /**
   * Makes the runtime crash right after the lamp's next commit, before it publishes anything. The runtime then starts
   * again on the same state directory, as the service manager restarts it.
   */
  armCrash(): void;
  /** Stops the runtime cleanly and starts it again on the same state directory. */
  restart(): Promise<void>;
}

// Steps

export type Outcome = true | string;
export type Check = (h: Harness) => Outcome | Promise<Outcome>;
export type Step =
  | {kind: 'act'; name: string; run: (h: Harness) => unknown}
  | {kind: 'expect'; name: string; check: Check; withinMs: number}
  | {kind: 'holds'; name: string; check: Check; forMs: number};

export const act = (name: string, run: (h: Harness) => unknown): Step => ({kind: 'act', name, run});
/** Passes as soon as `check` answers true, within `withinMs`. */
export const expect = (name: string, check: Check, withinMs = 3000): Step => ({kind: 'expect', name, check, withinMs});
/** Passes when `check` answers true throughout `forMs`. */
export const holds = (name: string, check: Check, forMs = 1000): Step => ({kind: 'holds', name, check, forMs});

export type Scenario = {readonly id: string; readonly title: string; readonly seed: Seed; readonly steps: readonly Step[]};
export type StepResult = {name: string; kind: Step['kind']; outcome: 'passed' | 'failed'; detail?: string};
export type ScenarioResult = {
  id: string; title: string; tier: Harness['tier']; transport: TransportName; outcome: 'passed' | 'failed'; steps: StepResult[];
};

/** How often a step looks again: virtual milliseconds in memory, real ones in a run. */
export const POLL_MS = 10;

async function attempt(check: () => Outcome | Promise<Outcome>): Promise<Outcome> {
  try {
    return await check();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function poll(h: Harness, check: Check, withinMs: number): Promise<Outcome> {
  for (let waited = 0; ; waited += POLL_MS) {
    const outcome = await attempt(() => check(h));
    if (outcome === true || waited >= withinMs) return outcome;
    await h.wait(POLL_MS);
  }
}

/** Runs a scenario's steps in order. A failed step names what it observed and stops the scenario. */
export async function runScenario(scenario: Scenario, h: Harness, onStep?: (result: StepResult) => void): Promise<ScenarioResult> {
  const steps: StepResult[] = [];
  const finish = (outcome: ScenarioResult['outcome']): ScenarioResult =>
    ({id: scenario.id, title: scenario.title, tier: h.tier, transport: h.transport, outcome, steps});
  for (const step of scenario.steps) {
    let outcome: Outcome;
    switch (step.kind) {
      case 'act':
        outcome = await attempt(async (): Promise<Outcome> => {
          await step.run(h);
          return true;
        });
        break;
      case 'expect':
        outcome = await poll(h, step.check, step.withinMs);
        break;
      case 'holds':
        outcome = true;
        for (let waited = 0; outcome === true && waited <= step.forMs; waited += POLL_MS) {
          outcome = await attempt(() => step.check(h));
          if (outcome === true && waited < step.forMs) await h.wait(POLL_MS);
        }
        break;
    }
    const result: StepResult = {name: step.name, kind: step.kind, outcome: outcome === true ? 'passed' : 'failed', ...(outcome === true ? {} : {detail: outcome})};
    steps.push(result);
    onStep?.(result);
    if (outcome !== true) return finish('failed');
  }
  return finish('passed');
}

// Observations the scenarios share

const show = (value: unknown): string => JSON.stringify(value);
/** The answer a transport's contract fixes for a case, from the `bunny-sdk` conformance requirement (#883). */
const byTransport = (h: Harness, answers: Readonly<Record<TransportName, string>>): string => answers[h.transport];
const answered = (h: Harness, label: string, expected: string): Outcome => h.answer(label) === expected || `${label} is ${h.answer(label)}`;
const sendOnce = async (h: Harness, role: Role, label: string, command: {key: string; draft: CommandDraft<object>}, requestId: string): Promise<void> => {
  const answer = await h.send(role, label, command, {timeoutMs: 5000, requestId});
  if (answer !== 'accepted') throw new Error(`${label} is ${answer}`);
};
const publish = async (h: Harness, event: Parameters<typeof observation>[0]): Promise<void> => {
  const {key, draft} = observation(event, h.now());
  await h.sdk('hook').publish(key, draft);
};

const session = (h: Harness): SessionRecord | undefined =>
  h.reader.states<SessionRecord>('session').find(state => state.data.id === SESSION_ID)?.data;
const waiting = (h: Harness, approvals: readonly string[]): Outcome => {
  const record = session(h);
  if (record === undefined) return 'the reader holds no session';
  const held = record.attention.flatMap(item => item.kind === 'approval' && item.id.status === 'known' ? [item.id.id] : []);
  return show(held) === show(approvals) || `the session waits for ${show(held)}`;
};
const lampPower = (h: Harness, power: Power): Outcome => h.devices().lamp.power['lamp-1'] === power || `lamp-1 is ${String(h.devices().lamp.power['lamp-1'])}`;
const indicator = (h: Harness, shown: 'idle' | 'attention'): Outcome => h.devices().lamp.indicator === shown || `the indicator shows ${h.devices().lamp.indicator}`;
const copied = (h: Harness, power: Power): Outcome => {
  const lamp = h.reader.states<Lamp>('lamp').find(state => state.data.id === 'lamp-1')?.data;
  return lamp?.power === power || `the reader's copy shows lamp-1 ${String(lamp?.power)}`;
};
const historyOf = (h: Harness, requestId: string): HistoryEntry[] =>
  h.reader.states<HistoryEntry>('stand-in-history').map(state => state.data).filter(entry => entry.requestId === requestId);
const recorded = (h: Harness, requestId: string, result: HistoryEntry['result'], evidence: HistoryEntry['evidence']): Outcome => {
  const rows = historyOf(h, requestId).map(entry => `${entry.result}/${entry.evidence}`);
  return show(rows) === show([`${result}/${evidence}`]) || `history holds ${show(rows)} for ${requestId}`;
};
const inboxOf = (h: Harness, requestId: string): InboxItem['item'][] =>
  h.reader.states<InboxItem>('inbox-item').map(state => state.data.item).filter(item => item.kind === 'operation' && item.requestId === requestId);
const switches = (h: Harness): number => h.devices().lamp.calls.length;
const logged = (h: Harness, event: string, from = 1): Generational<{record: LogRecord}>[] =>
  h.logs().filter(entry => entry.generation >= from && entry.record.event_name === event);
const received = (h: Harness, requestId: string, from = 1): number =>
  logged(h, 'lamp.command.received', from).filter(entry => entry.record.attributes.requestId === requestId).length;
async function running(h: Harness, names: readonly string[]): Promise<Outcome> {
  const report = await h.health();
  const states = names.map(name => `${name} ${report.find(module => module.name === name)?.state ?? 'missing'}`);
  return states.every(state => state.endsWith(' running')) || states.join(', ');
}
/** Every reader copy synced at least `times` times. */
const synced = (h: Harness, times: number): Outcome =>
  (h.reader.syncs('session') >= times && h.reader.syncs('lamp') >= times) || `synced ${h.reader.syncs('session')} and ${h.reader.syncs('lamp')} times`;
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
  if (mark === undefined) throw new Error('no gap was marked');
  marks.set(h, {...mark, gap: h.published().slice(mark.published).map(entry => entry.message)});
};
const noReplay = (h: Harness): Outcome => {
  const gap = marks.get(h)?.gap ?? [];
  if (gap.length === 0) return 'nothing was published while the reader was away';
  const heard = new Set(h.reader.heard().map(message => `${message.source} ${message.id}`));
  const replayed = gap.filter(message => heard.has(`${message.source} ${message.id}`));
  return replayed.length === 0 || `replayed ${show(replayed.map(message => message.type))}`;
};

const CORE_FAMILIES = ['session', 'inbox-item', 'stand-in-history'] as const;
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
    act('the operator switches lamp-1 on as req-on', h => sendOnce(h, 'operator', 'on', switchLamp('lamp-1', 'on'), 'req-on')),
    expect('the lamp is on', h => lampPower(h, 'on')),
    expect('history holds one succeeded outcome for req-on, observed on the device', h => recorded(h, 'req-on', 'succeeded', 'observed')),
    expect('the reader\'s copy shows lamp-1 on', h => copied(h, 'on')),
    expect('the core acknowledged the outcome, and the lamp forgot it', h => logged(h, 'lamp.outcome.acknowledged').length === 1 ||
      `${logged(h, 'lamp.outcome.acknowledged').length} acknowledgments`),
    act('the lamp cannot be reached for its next switch', h => { h.simulate({device: 'lamp', action: 'fail-next'}); }),
    act('the operator switches lamp-1 off as req-off; the lamp accepts it', h => sendOnce(h, 'operator', 'off', switchLamp('lamp-1', 'off'), 'req-off')),
    expect('history holds a failed outcome for req-off, with no evidence it reached the device', h => recorded(h, 'req-off', 'failed', 'none')),
    expect('the inbox holds the failed operation', h => {
      const items = inboxOf(h, 'req-off');
      const item = items[0];
      return (items.length === 1 && item?.kind === 'operation' && item.result === 'failed' && item.error?.code === 'unavailable') || `inbox ${show(items)}`;
    }),
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
    act('the operator switches lamp-1 on as req-on', h => sendOnce(h, 'operator', 'on', switchLamp('lamp-1', 'on'), 'req-on')),
    expect('the lamp is on, and history holds its outcome', h => lampPower(h, 'on') === true ? recorded(h, 'req-on', 'succeeded', 'observed') : lampPower(h, 'on')),
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
      await sendOnce(h, 'operator', 'away', switchLamp('lamp-1', 'on'), 'req-away');
      closeGap(h);
    }),
    act('and the hook observes an approval prompt', h => publish(h, approvalPrompt('approval-1'))),
    expect('the reader reconnected and synced each copy again', h => synced(h, 2)),
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
    act('the operator asks for a lamp that no module serves', h => h.send('operator', 'none', switchLamp('lamp-1', 'on'), {timeoutMs: 5000, requestId: 'req-none'})),
    expect('the request is unavailable', h => answered(h, 'none', 'unavailable')),
    act('the reader asks for the sessions, and nobody serves them', async h => {
      const result = await h.sdk('reader').sync(['session'], () => {}, {timeoutMs: 1000});
      if (result.status === 'synced') {
        await result.copy.close();
        throw new Error('a sync was served');
      }
      if (result.error.error.code !== 'unavailable') throw new Error(`the sync is ${result.error.error.code}`);
    }),
  ],
};

/**
 * The early end-to-end path (#827's plan): a hook observation, the committed session, the simulated device's update, a
 * command, its outcome, history and inbox rows, then sync and read, with a duplicate command, the deadline answers, a
 * disconnect and a crash-restart on the same state directory. Stand-ins play the session owner, history and inbox
 * until #831 and #782 replace them.
 */
const endToEnd: Scenario = {
  id: 'end-to-end',
  title: 'the early end-to-end path, with a duplicate, the deadlines, a disconnect and a crash',
  seed: {modules: ['core', 'lamp'], follows: FOLLOW_ALL},
  steps: [
    ...theApproval,
    act('the operator switches lamp-1 on as req-1', h => sendOnce(h, 'operator', 'first', switchLamp('lamp-1', 'on'), 'req-1')),
    expect('the device switched lamp-1 on', h => lampPower(h, 'on')),
    expect('history holds its outcome, and the reader reads it', h => recorded(h, 'req-1', 'succeeded', 'observed')),
    expect('the reader\'s copy of the lamp shows it on', h => copied(h, 'on')),

    act('the operator sends req-1 again, a duplicate; the lamp accepts it', h => sendOnce(h, 'operator', 'again', switchLamp('lamp-1', 'on'), 'req-1')),
    expect('the lamp knew it for a duplicate', h => logged(h, 'lamp.command.duplicate').length === 1 || `${logged(h, 'lamp.command.duplicate').length} duplicates`),
    holds('history keeps one outcome for req-1, and the device switched once', h =>
      historyOf(h, 'req-1').length === 1 && switches(h) === 1 ? true : `${historyOf(h, 'req-1').length} outcomes, ${switches(h)} switches`, 500),

    act('the lamp\'s device holds every switch until released', h => { h.simulate({device: 'lamp', action: 'hold'}); }),
    act('the operator switches lamp-1 off as req-held, with a 2 s deadline', h => { void h.send('operator', 'held', switchLamp('lamp-1', 'off'), {timeoutMs: 2000, requestId: 'req-held'}); }),
    expect('the device has req-held and holds it', h => (h.devices().lamp.held && switches(h) === 2) || `held ${String(h.devices().lamp.held)}, ${switches(h)} switches`),
    act('the operator sends req-queued behind it, with a 500 ms deadline', h => { void h.send('operator', 'queued', switchLamp('lamp-1', 'on'), {timeoutMs: 500, requestId: 'req-queued'}); }),
    act('the panel sends req-closed behind both, with a 5 s deadline', h => { void h.send('panel', 'closed', switchLamp('lamp-1', 'on'), {timeoutMs: 5000, requestId: 'req-closed'}); }),
    act('the panel gives up and closes', h => h.closePart('panel')),
    expect('req-closed ends as the transport says: cancelled in process, uncertain-result remotely',
      h => answered(h, 'closed', byTransport(h, {'in-process': 'cancelled', remote: 'uncertain-result'}))),
    expect('req-queued is expired at its deadline, on both transports: it never reached the lamp', h => answered(h, 'queued', 'expired'), 1500),
    expect('req-held is uncertain-result at its deadline, on both transports: the lamp had it', h => answered(h, 'held', 'uncertain-result'), 3000),
    act('the device answers', h => { h.simulate({device: 'lamp', action: 'release'}); }),
    expect('lamp-1 turns off, and history records req-held\'s late outcome', h => lampPower(h, 'off') === true ? recorded(h, 'req-held', 'succeeded', 'observed') : lampPower(h, 'off')),
    holds('the lamp never received req-queued or req-closed, and the device switched only twice', h =>
      (received(h, 'req-queued') + received(h, 'req-closed') === 0 && switches(h) === 2) || `${switches(h)} switches`, 500),

    act('the reader\'s connection drops', async h => {
      markGap(h);
      await h.disconnect('reader');
    }),
    act('while it is away, the operator switches lamp-1 on as req-gap and the lamp accepts it', async h => {
      await sendOnce(h, 'operator', 'gap', switchLamp('lamp-1', 'on'), 'req-gap');
      closeGap(h);
    }),
    expect('the reader reconnected and synced each copy again', h => synced(h, 2)),
    expect('its copy shows lamp-1 on, and history holds req-gap', h => copied(h, 'on') === true ? recorded(h, 'req-gap', 'succeeded', 'observed') : copied(h, 'on')),
    holds('nothing published while it was away was replayed to it', h => noReplay(h), 500),

    act('the runtime will crash between the lamp\'s next commit and its publish', h => { h.armCrash(); }),
    act('the operator switches lamp-1 off as req-crash', h => { void h.send('operator', 'crash', switchLamp('lamp-1', 'off'), {timeoutMs: 5000, requestId: 'req-crash'}); }),
    expect('the runtime crashed and started again on the same state directory', h => h.generation() === 2 || `generation ${h.generation()}`),
    expect('req-crash ends as the transport allows: its in-process requester died with the runtime, a remote one is uncertain-result',
      h => answered(h, 'crash', byTransport(h, {'in-process': 'lost', remote: 'uncertain-result'}))),
    expect('at the restart the lamp republished its state, occurrence and outcome, once', h => {
      const counts = logged(h, 'lamp.outbox.republished', 2).map(entry => entry.record.attributes.count);
      return show(counts) === show([3]) || `republished ${show(counts)}`;
    }),
    expect('history holds one outcome for req-crash, and the reader resynced to see lamp-1 off', h =>
      recorded(h, 'req-crash', 'succeeded', 'observed') === true ? copied(h, 'off') : recorded(h, 'req-crash', 'succeeded', 'observed')),
    expect('the session still waits for approval, and the lamp shows attention again', h => waiting(h, ['approval-1']) === true ? indicator(h, 'attention') : waiting(h, ['approval-1'])),
    holds('no command was sent again: the lamp received none after the restart, and switched lamp-1 off once for req-crash', h =>
      (logged(h, 'lamp.command.received', 2).length === 0 && received(h, 'req-crash') === 1 && switches(h) === 4 && lampPower(h, 'off') === true) ||
      `${logged(h, 'lamp.command.received', 2).length} commands after the restart, ${switches(h)} switches`, 500),
    holds('the reader never heard a message twice', h => heardOnce(h), 100),

    act('the runtime restarts cleanly', h => h.restart()),
    expect('the lamp republished nothing, since the core acknowledged the outcome', h => {
      const counts = logged(h, 'lamp.outbox.republished', 3).map(entry => entry.record.attributes.count);
      return show(counts) === show([0]) || `republished ${show(counts)}`;
    }),
    holds('history still holds one outcome for req-crash, and no command was sent again', h =>
      (historyOf(h, 'req-crash').length === 1 && logged(h, 'lamp.command.received', 2).length === 0 && switches(h) === 4) ||
      `${historyOf(h, 'req-crash').length} outcomes, ${switches(h)} switches`, 500),
  ],
};

/** The catalog, in the order a reader meets it. Every runtime story adds its scenarios here. */
export const SCENARIOS: readonly Scenario[] = [
  approvalReachesEveryModule, commandWithTrackedOutcome, moduleFailsOthersContinue, remotePartReconnects, zeroModules, endToEnd,
];

export const scenario = (id: string): Scenario | undefined => SCENARIOS.find(entry => entry.id === id);
