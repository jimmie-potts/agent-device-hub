// The runtime's scenario catalog (Hub #846): what a person or a device should see, as seeds plus named steps. Each run
// type has one execution adapter that runs these definitions unchanged: the in-memory harness (`memory.ts`, tier 1, in
// CI) and #920's disposable runs (tier 2). A step acts through the harness, expects an observation within a time bound,
// or expects one to hold for a while. Time is virtual in memory and real in a run; only the harness differs.
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {InboxItem, PlaybackState, SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {SIMULATED_SECTION, controlPlayback, type SimulatedKind, type SpeakersState} from '@jimmie-potts/playback';
import {LIFX_SIMULATED_SECTION, PACKET, type LifxDeviceState} from '@jimmie-potts/lifx';
import type {CommandDraft, Participant} from '@jimmie-potts/sdk';
import {
  SIMULATED_API_KEY, SIMULATED_DEVICE, SIMULATED_SECTION as TIDBYT_SIMULATED_SECTION, nowPlayingFrame, nowPlayingView, picture, statusFrame, statusView,
  type CloudState,
} from '@jimmie-potts/tidbyt';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import type {LogRecord, ModuleHealth} from '../../src/index.js';
import {
  OTHER, OTHER_ID, SESSION_ID, approvalPrompt, approvalResolved, observation, runtimeEnded, sessionStarted, turnEnded, turnStarted, type ObservationOptions,
} from '../fixtures/agents.js';
import type {ChimeDeviceState} from '../fixtures/chime.js';
import type {HistoryEntry} from '../fixtures/core.js';
import {switchLamp, type Lamp, type LampDeviceState, type Power} from '../fixtures/lamp.js';
import {SIGN_SECTION, SYNTHETIC_TOKEN, type Availability, type Sign, type SignDeviceState} from '../fixtures/sign.js';

export const TRANSPORTS = ['in-process', 'remote'] as const;
/** How the scenario's parts reach the runtime: on its bus, or through its SDK edge over SSE and HTTP. */
export type TransportName = (typeof TRANSPORTS)[number];
/** The parts a scenario plays: an agent hook, two control surfaces and a reader such as the dashboard. */
export const ROLES = ['hook', 'operator', 'panel', 'reader'] as const;
export type Role = (typeof ROLES)[number];
/** The modules a run can start, each built by its factory with its simulated transport. */
export type ModuleName = 'core' | 'lamp' | 'chime' | 'sign' | 'playback' | 'lifx' | 'tidbyt';

/**
 * One copy the reader keeps: one owner's families, synced from their only owner, or from the owner named by its source
 * when several owners serve one of them, as every device module serves `device` (Hub #967).
 */
export type Follow = readonly string[] | {readonly owner: string; readonly families: readonly string[]};

export type Seed = {
  /** The modules the runtime starts with, in order. The core comes first (#831). */
  readonly modules: readonly ModuleName[];
  /** The families the reader keeps a copy of, one entry per owner. */
  readonly follows: readonly Follow[];
  /**
   * The runtime's configuration file, when the seed has one (Hub #919): each configured module's section, without its
   * `secrets` member. Each harness writes the file privately, with a token file per module holding the synthetic token,
   * and starts the runtime with it (`writeConfiguration`).
   */
  readonly config?: Readonly<Partial<Record<ModuleName, object>>>;
  /**
   * The modules the runtime should refuse at start, such as one the seed configures badly. A harness refuses to start a
   * scenario in which any other module is unhealthy.
   */
  readonly refused?: readonly ModuleName[];
};

/** What the reader has: its copies' current states and the occurrences and outcomes it heard. */
export interface ReaderView {
  /** Every family the reader copies, as the seed's `follows` names them. */
  families(): readonly string[];
  /**
   * The current state messages of one family in the reader's copies: in every copy that holds it, or only in the copy
   * synced from `owner` when one is named.
   */
  states<T>(family: string, owner?: string): Message<T>[];
  /** How often the copy that holds `family`, from `owner` when one is named, has synced, the first sync included. */
  syncs(family: string, owner?: string): number;
  /** Every occurrence and outcome the reader heard, in order. */
  heard(): readonly Message[];
  /**
   * How many gap notices the reader's subscription heard. A remote part's subscription hears one when its stream is
   * lost and restored; an in-process part that connects anew starts a new subscription, which has heard none.
   */
  gaps(): number;
}

/** What the simulated devices show. Plain data, so a disposable run can report it too. */
export type DeviceStates = {lamp: LampDeviceState; chime: ChimeDeviceState; sign: SignDeviceState; playback: SpeakersState; lifx: LifxDeviceState; tidbyt: CloudState};
/** What a scenario can make a simulated device do. */
export type Simulation =
  | {device: 'lamp'; action: 'hold' | 'release' | 'fail-next'}
  | {device: 'chime'; action: 'fault-next'}
  | {device: 'sign'; action: 'online' | 'offline'}
  /**
   * The playback module's simulated speakers (Hub #929): the phone plays `title` to one over AirPlay, it pauses, stops or
   * switches to another input, it stops answering, answers each call 400 ms late (#930) or answers again at once, or its
   * next command is refused or never answered.
   */
  | {device: 'playback'; speaker: SimulatedKind; action: 'play' | 'pause' | 'stop' | 'other-input' | 'silent' | 'slow' | 'answer' | 'refuse-next' | 'hang-next'; title?: string}
  /** The simulated LIFX bulb at `address` goes off the network, as one switched off at the wall, or comes back. */
  | {device: 'lifx'; action: 'online' | 'offline'; address: string}
  /** The simulated Tidbyt cloud stops answering, or answers again (Hub #930). */
  | {device: 'tidbyt'; action: 'online' | 'offline'};
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
  /**
   * Loses the core's next acknowledgment to the lamp on its way, as a dropped message would be. The lamp keeps that
   * outcome and reports it again at its next start, and the core must take it as a duplicate and acknowledge it again.
   */
  loseAcknowledgment(): void;
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
/** The expectation for the harness's transport, where the two transports end a case differently. */
const byTransport = <T>(h: Harness, answers: Readonly<Record<TransportName, T>>): T => answers[h.transport];
/**
 * How long past its deadline a remote requester waits for the edge before it settles a command itself: the SDK's
 * `REQUESTER_GRACE_MS`, which the package does not export.
 */
const REQUESTER_GRACE_MS = 1000;
const answered = (h: Harness, label: string, expected: string): Outcome => h.answer(label) === expected || `${label} is ${h.answer(label)}`;
const sendOnce = async (h: Harness, role: Role, label: string, command: {key: string; draft: CommandDraft<object>}, requestId: string): Promise<void> => {
  const answer = await h.send(role, label, command, {timeoutMs: 5000, requestId});
  if (answer !== 'accepted') throw new Error(`${label} is ${answer}`);
};
const publish = async (h: Harness, event: Parameters<typeof observation>[0], options: ObservationOptions = {}): Promise<void> => {
  const {key, draft} = observation(event, h.now(), options);
  await h.sdk('hook').publish(key, draft);
};

const session = (h: Harness, id = SESSION_ID): SessionRecord | undefined =>
  h.reader.states<SessionRecord>('session').find(state => state.data.id === id)?.data;
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
/** The inbox holds the request as one failed operation, with the `unavailable` error. */
const failedOperation = (h: Harness, requestId: string): Outcome => {
  const items = inboxOf(h, requestId);
  const item = items[0];
  return (items.length === 1 && item?.kind === 'operation' && item.result === 'failed' && item.error?.code === 'unavailable') || `inbox ${show(items)}`;
};
const switches = (h: Harness): number => h.devices().lamp.calls.length;
/** The named module's records of `event`, from the runtime's `from`th start on. */
const logged = (h: Harness, module: string, event: string, from = 1): Generational<{record: LogRecord}>[] =>
  h.logs().filter(entry => entry.generation >= from && entry.record.attributes['bunny.module'] === module && entry.record.event_name === event);
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
async function running(h: Harness, names: readonly string[]): Promise<Outcome> {
  const report = await h.health();
  const states = names.map(name => `${name} ${report.find(module => module.name === name)?.state ?? 'missing'}`);
  return states.every(state => state.endsWith(' running')) || states.join(', ');
}
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
    act('the runtime restarts cleanly while the approval still waits', h => h.restart()),
    expect('every module is running again, and the reader still holds the waiting session', async h =>
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
    act('the operator switches lamp-1 on as req-on', h => sendOnce(h, 'operator', 'on', switchLamp('lamp-1', 'on'), 'req-on')),
    expect('the lamp is on', h => lampPower(h, 'on')),
    expect('history holds one succeeded outcome for req-on, observed on the device', h => recorded(h, 'req-on', 'succeeded', 'observed')),
    expect('the reader\'s copy shows lamp-1 on', h => copied(h, 'on')),
    expect('the core acknowledged the outcome, and the lamp forgot it', h => acknowledgments(h) === 1 || `${acknowledgments(h)} acknowledgments`),
    act('the lamp cannot be reached for its next switch', h => { h.simulate({device: 'lamp', action: 'fail-next'}); }),
    act('the operator switches lamp-1 off as req-off; the lamp accepts it', h => sendOnce(h, 'operator', 'off', switchLamp('lamp-1', 'off'), 'req-off')),
    expect('history holds a failed outcome for req-off, with no evidence it reached the device', h => recorded(h, 'req-off', 'failed', 'none')),
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
    act('the operator asks for a lamp that no module serves', h => h.send('operator', 'none', switchLamp('lamp-1', 'on'), {timeoutMs: 5000, requestId: 'req-none'})),
    expect('the request is unavailable', h => answered(h, 'none', 'unavailable')),
    expect('the bus recorded the refusal once, at WARN', h => recordedAs(h, 'req-none', ['runtime.command.refused WARN unavailable'])),
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
 * command, its outcome, history and inbox rows, then sync and read, with a duplicate command, the deadline answers, a
 * disconnect, a crash-restart on the same state directory, a failed command and a lost acknowledgment. Stand-ins play
 * history until #782 and the inbox items until #923; the core owns the sessions (#831).
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
    expect('the bus recorded req-1\'s admission and the lamp\'s reply once each, at INFO, in its command\'s trace',
      h => recordedAs(h, 'req-1', ['runtime.command.admitted INFO', 'runtime.command.replied INFO'])),
    expect('the reader\'s copy of the lamp shows it on', h => copied(h, 'on')),

    act('the operator sends req-1 again, a duplicate; the lamp accepts it', h => sendOnce(h, 'operator', 'again', switchLamp('lamp-1', 'on'), 'req-1')),
    holds('history keeps one outcome for req-1, and the device switched once', h =>
      historyOf(h, 'req-1').length === 1 && switches(h) === 1 ? true : `${historyOf(h, 'req-1').length} outcomes, ${switches(h)} switches`, 500),
    expect('the lamp knew it for a duplicate', h => {
      const duplicates = logged(h, 'lamp', 'command.completed').filter(entry => entry.record.attributes['bunny.outcome'] === 'duplicate').length;
      return duplicates === 1 || `${duplicates} duplicates`;
    }),

    act('the lamp cannot be reached for its next switch', h => { h.simulate({device: 'lamp', action: 'fail-next'}); }),
    act('the operator switches lamp-1 off as req-fail; the lamp accepts it', h => sendOnce(h, 'operator', 'fail', switchLamp('lamp-1', 'off'), 'req-fail')),
    expect('history holds a failed outcome for req-fail, with no evidence it reached the device', h => recorded(h, 'req-fail', 'failed', 'none')),
    expect('the inbox holds req-fail as a failed operation, and the reader reads it', h => failedOperation(h, 'req-fail')),
    holds('lamp-1 stays on, and the device got no switch for req-fail', h => (lampPower(h, 'on') === true && switches(h) === 1) || `${switches(h)} switches`, 300),

    act('the lamp\'s device holds every switch until released', h => { h.simulate({device: 'lamp', action: 'hold'}); }),
    act('the operator switches lamp-1 off as req-held, with a 2 s deadline', h => { void h.send('operator', 'held', switchLamp('lamp-1', 'off'), {timeoutMs: 2000, requestId: 'req-held'}); }),
    expect('the device has req-held and holds it', h => (h.devices().lamp.held && switches(h) === 2) || `held ${String(h.devices().lamp.held)}, ${switches(h)} switches`),
    act('the operator sends req-queued behind it, with a 500 ms deadline', h => { void h.send('operator', 'queued', switchLamp('lamp-1', 'on'), {timeoutMs: 500, requestId: 'req-queued'}); }),
    act('the panel sends req-closed behind both, with a 5 s deadline', h => { void h.send('panel', 'closed', switchLamp('lamp-1', 'on'), {timeoutMs: 5000, requestId: 'req-closed'}); }),
    act('the panel gives up and closes', h => h.closePart('panel')),
    // `bunny-sdk` "One conformance suite for every transport" fixes this case per transport.
    expect('req-closed ends as the transport says: cancelled in process, uncertain-result remotely',
      h => answered(h, 'closed', byTransport(h, {'in-process': 'cancelled', remote: 'uncertain-result'}))),
    // `bunny-sdk` "Request and respond with expiry", which the remote transport keeps ("Deadlines").
    expect('req-queued is expired at its deadline, on both transports: it never reached the lamp', h => answered(h, 'queued', 'expired'), 1500),
    expect('req-held is uncertain-result at its deadline, on both transports: the lamp had it', h => answered(h, 'held', 'uncertain-result'), 3000),
    act('the device answers', h => { h.simulate({device: 'lamp', action: 'release'}); }),
    expect('lamp-1 turns off, and history records req-held\'s late outcome', h => lampPower(h, 'off') === true ? recorded(h, 'req-held', 'succeeded', 'observed') : lampPower(h, 'off')),
    holds('the lamp never received req-queued or req-closed, and the device switched only twice', h =>
      (received(h, 'req-queued') + received(h, 'req-closed') === 0 && switches(h) === 2) || `${switches(h)} switches`, 500),
    // ADR 0012's levels: a queued expiry and an uncertain result are WARN, an expected cancellation INFO. In process the
    // bus cancels req-closed; remotely the panel may drop its call before the edge reads it, before the bus queues it or
    // while it waits, and the bus records only what it decided.
    expect('the bus recorded each deadline answer once, at its level: req-queued expired, req-held uncertain, req-closed cancelled', h => {
      const cancelled = ['runtime.command.admitted INFO', 'runtime.command.cancelled INFO cancelled'];
      const closed = decided(h, 'req-closed');
      const answers = [
        recordedAs(h, 'req-queued', ['runtime.command.admitted INFO', 'runtime.command.refused WARN expired']),
        recordedAs(h, 'req-held', ['runtime.command.admitted INFO', 'runtime.command.uncertain WARN uncertain-result']),
        byTransport(h, {'in-process': [cancelled], remote: [[], cancelled.slice(1), cancelled]}).some(expected => show(expected) === show(closed)) ||
          `req-closed: ${show(closed)}`,
      ];
      return answers.find(answer => answer !== true) ?? true;
    }),

    act('the reader\'s connection drops', async h => {
      markGap(h);
      await h.disconnect('reader');
    }),
    act('while it is away, the operator switches lamp-1 on as req-gap and the lamp accepts it', async h => {
      await sendOnce(h, 'operator', 'gap', switchLamp('lamp-1', 'on'), 'req-gap');
      closeGap(h);
    }),
    expect('the reader reconnected and synced each copy again', h => synced(h, 2)),
    expect('remotely its own subscription heard of the gap; in process it connected anew', h => reconnectedAs(h)),
    expect('its copy shows lamp-1 on, and history holds req-gap', h => copied(h, 'on') === true ? recorded(h, 'req-gap', 'succeeded', 'observed') : copied(h, 'on')),
    holds('nothing published while it was away was replayed to it', h => noReplay(h), 500),

    act('the runtime will crash between the lamp\'s next commit and its publish', h => { h.armCrash(); }),
    act('the operator switches lamp-1 off as req-crash', h => { void h.send('operator', 'crash', switchLamp('lamp-1', 'off'), {timeoutMs: 5000, requestId: 'req-crash'}); }),
    expect('the runtime crashed and started again on the same state directory', h => h.generation() === 2 || `generation ${h.generation()}`),
    // A remote requester survives the crash: the remote client settles a call whose connection dropped as
    // uncertain-result, at the latest at the command's deadline plus its grace. An in-process requester dies with the
    // runtime; `lost` is the harness's label for that, not an answer the SDK gives.
    expect('req-crash ends as the transport allows: its in-process requester died with the runtime, a remote one is uncertain-result',
      h => answered(h, 'crash', byTransport(h, {'in-process': 'lost', remote: 'uncertain-result'})), 5000 + REQUESTER_GRACE_MS),
    expect('at the restart the lamp republished its state, occurrence and outcome, once', h => {
      const counts = republished(h, 2);
      return show(counts) === show([3]) || `republished ${show(counts)}`;
    }),
    expect('history holds one outcome for req-crash, and the reader resynced to see lamp-1 off', h =>
      recorded(h, 'req-crash', 'succeeded', 'observed') === true ? copied(h, 'off') : recorded(h, 'req-crash', 'succeeded', 'observed')),
    expect('the session still waits for approval, and the lamp shows attention again', h => waiting(h, ['approval-1']) === true ? indicator(h, 'attention') : waiting(h, ['approval-1'])),
    expect('the inbox still holds req-fail after the restart', h => failedOperation(h, 'req-fail')),
    holds('no command was sent again: the lamp received none after the restart, and switched lamp-1 off once for req-crash', h =>
      (commands(h, 2).length === 0 && received(h, 'req-crash') === 1 && switches(h) === 4 && lampPower(h, 'off') === true) ||
      `${commands(h, 2).length} commands after the restart, ${switches(h)} switches`, 500),
    holds('the reader never heard a message twice', h => heardOnce(h), 100),

    act('the core\'s next acknowledgment to the lamp is lost on its way', h => { h.loseAcknowledgment(); }),
    act('the operator switches lamp-1 on as req-lost; the lamp accepts it', h => sendOnce(h, 'operator', 'lost', switchLamp('lamp-1', 'on'), 'req-lost')),
    expect('history holds req-lost\'s outcome', h => recorded(h, 'req-lost', 'succeeded', 'observed')),
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
    holds('history keeps one outcome each for req-crash and req-lost, and no command was sent again', h =>
      (historyOf(h, 'req-crash').length === 1 && historyOf(h, 'req-lost').length === 1 && commands(h, 3).length === 0 && switches(h) === 5) ||
      `${historyOf(h, 'req-crash').length} and ${historyOf(h, 'req-lost').length} outcomes, ${switches(h)} switches`, 500),
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
/**
 * No log record, published message, health entry or message the reader holds carries the synthetic token, which the
 * configured modules' secret files hold. The answer names where it appears, never the token.
 */
async function noToken(h: Harness): Promise<Outcome> {
  const places: [string, unknown][] = [
    ['a log record', h.logs()], ['a published message', h.published()], ['health', await h.health()], ['a message the reader heard', h.reader.heard()],
    ...h.reader.families().map((family): [string, unknown] => [`the reader's copy of ${family}`, h.reader.states(family)]),
  ];
  const carrying = places.filter(([, value]) => JSON.stringify(value).includes(SYNTHETIC_TOKEN)).map(([place]) => place);
  return carrying.length === 0 || `the token appears in ${carrying.join(', ')}`;
}
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
    holds('no log record, message, health entry or reader copy carries the token', h => noToken(h), 100),
  ],
};

// The playback module (Hub #929): one owner for the HT-A9 and the Move, presenting the speaker the phone plays to.

/** The playback section: the factory's simulated section, the Move first, then the HT-A9. */
export const PLAYBACK_SECTION = SIMULATED_SECTION;
const playbackCommand = (action: 'play' | 'pause' | 'next' | 'previous') => controlPlayback(PLAYBACK_SECTION.id, action);
/** The reader's copy of the playback record, as `availability player "title" [controls]`. */
const playbackShown = (h: Harness): string => {
  const record = h.reader.states<PlaybackState>('playback').find(state => state.data.id === PLAYBACK_SECTION.id)?.data;
  if (record === undefined) return 'no playback record';
  const {playback} = record;
  return playback.status === 'unknown' ? `${record.availability} unknown` :
    `${record.availability} ${playback.player} ${JSON.stringify(playback.title ?? '')} [${playback.controls.join(',')}]`;
};
const playbackShows = (h: Harness, expected: string): Outcome => playbackShown(h) === expected || `the reader's copy shows ${playbackShown(h)}`;
/** The actions each simulated speaker received, as `move [..] ht-a9 [..]`. */
const speakerCommands = (h: Harness): string => {
  const {sonos, sony} = h.devices().playback;
  return `move [${sonos.commands.join(',')}] ht-a9 [${sony.commands.join(',')}]`;
};
const speakersGot = (h: Harness, expected: string): Outcome => speakerCommands(h) === expected || speakerCommands(h);
const playbackRecords = (h: Harness, event: string): string[] =>
  logged(h, 'playback', event).map(({record}) => `${record.severity_text} ${String(record.attributes['bunny.device.id'])}`);
/** No published message, reader copy or log record names a speaker's address or kind. */
function noSpeakerAddress(h: Harness): Outcome {
  const places: [string, unknown][] = [
    ['a published message', h.published()], ['the reader\'s copy', h.reader.states('playback')], ['a message the reader heard', h.reader.heard()],
  ];
  const addresses = PLAYBACK_SECTION.sources.map(source => source.endpoint);
  const carrying = places.filter(([, value]) => addresses.some(address => JSON.stringify(value).includes(address))).map(([place]) => place);
  const logs = h.logs().some(({record}) => addresses.some(address => JSON.stringify(record).includes(address)));
  return (carrying.length === 0 && !logs) || `a speaker address appears in ${[...carrying, ...(logs ? ['a log record'] : [])].join(', ')}`;
}

/**
 * The playback module follows the speaker the phone plays to and controls it (Hub #929): the HT-A9 alone, then the Move
 * once the phone switches AirPlay to it; a pause goes to the presented speaker only; a Move that goes silent mid-song
 * turns the record stale with its song kept and commands refused, logs one degradation and one recovery, and a command
 * the Move never answers is uncertain, kept in the inbox and never sent again. Time is real in a run, so the 30-second step to
 * `unavailable` is left to the module's own tests.
 */
const speakerPlayback: Scenario = {
  id: 'speaker-playback',
  title: 'the playback module follows the speaker the phone plays to, pauses it, and turns a silent one stale',
  seed: {modules: ['core', 'playback'], follows: [CORE_FAMILIES, ['playback']], config: {playback: PLAYBACK_SECTION}},
  steps: [
    expect('the core and the playback module are running', h => running(h, ['core', 'playback'])),
    expect('the reader\'s copy shows the speakers available with nothing playing over AirPlay', h => playbackShows(h, 'available inactive "" []'), 5000),
    act('the phone plays a song to the HT-A9', h => { h.simulate({device: 'playback', speaker: 'sony', action: 'play', title: 'HT-A9 Song'}); }),
    expect('the reader sees the HT-A9\'s song playing, with pause, next and previous', h => playbackShows(h, 'available playing "HT-A9 Song" [pause,next,previous]'), 5000),
    act('the operator pauses it as req-pb-pause', h => sendOnce(h, 'operator', 'pb-pause', playbackCommand('pause'), 'req-pb-pause')),
    expect('the pause went to the HT-A9 only, once', h => speakersGot(h, 'move [] ht-a9 [pause]')),
    expect('history holds req-pb-pause as succeeded, transmitted', h => recorded(h, 'req-pb-pause', 'succeeded', 'transmitted')),
    expect('the reader sees the HT-A9 paused, offering next and previous only', h => playbackShows(h, 'available paused "HT-A9 Song" [next,previous]'), 5000),
    act('the phone switches AirPlay to the Move: the HT-A9 leaves AirPlay and the Move plays another song', h => {
      h.simulate({device: 'playback', speaker: 'sony', action: 'other-input'});
      h.simulate({device: 'playback', speaker: 'sonos', action: 'play', title: 'Move Song'});
    }),
    expect('the reader sees the Move\'s song', h => playbackShows(h, 'available playing "Move Song" [pause,next,previous]'), 5000),
    act('the operator pauses again as req-pb-move', h => sendOnce(h, 'operator', 'pb-move', playbackCommand('pause'), 'req-pb-move')),
    expect('the pause went to the Move only', h => speakersGot(h, 'move [pause] ht-a9 [pause]')),
    expect('the reader sees the Move paused, offering play, next and previous', h => playbackShows(h, 'available paused "Move Song" [play,next,previous]'), 5000),
    act('the Move stops answering mid-song', h => { h.simulate({device: 'playback', speaker: 'sonos', action: 'silent'}); }),
    expect('the reader sees the record stale, still showing the Move\'s song', h => playbackShows(h, 'stale paused "Move Song" [play,next,previous]'), 9000),
    act('the operator asks the Move to play as req-pb-stale', h => h.send('operator', 'pb-stale', playbackCommand('play'), {timeoutMs: 5000, requestId: 'req-pb-stale'})),
    expect('req-pb-stale is refused unavailable, and no speaker heard it', h => answered(h, 'pb-stale', 'unavailable') === true ? speakersGot(h, 'move [pause] ht-a9 [pause]') : answered(h, 'pb-stale', 'unavailable')),
    expect('the playback module logged one degradation for the Move', h => show(playbackRecords(h, 'device.unavailable')) === show(['WARN living-room.sonos']) || show(playbackRecords(h, 'device.unavailable'))),
    act('the Move answers again', h => { h.simulate({device: 'playback', speaker: 'sonos', action: 'answer'}); }),
    expect('the reader sees the Move available again', h => playbackShows(h, 'available paused "Move Song" [play,next,previous]'), 6000),
    expect('the playback module logged one recovery, and no other degradation', h => {
      const [down, up] = [playbackRecords(h, 'device.unavailable'), playbackRecords(h, 'device.available')];
      return (show(down) === show(['WARN living-room.sonos']) && show(up) === show(['INFO living-room.sonos'])) || `${show(down)} then ${show(up)}`;
    }),
    act('the Move will never answer its next command', h => { h.simulate({device: 'playback', speaker: 'sonos', action: 'hang-next'}); }),
    // The module answers once the Move's call reaches its deadline, so the step does not wait for the answer.
    act('the operator asks the Move to play as req-pb-hang', h => { void h.send('operator', 'pb-hang', playbackCommand('play'), {timeoutMs: 5000, requestId: 'req-pb-hang'}); }),
    expect('req-pb-hang is accepted once the Move\'s call reaches its deadline', h => answered(h, 'pb-hang', 'accepted'), 5000),
    expect('history and the inbox hold req-pb-hang as uncertain', h => {
      const items = inboxOf(h, 'req-pb-hang');
      const item = items[0];
      const inbox = (items.length === 1 && item?.kind === 'operation' && item.result === 'uncertain' && item.error?.code === 'uncertain-result') || `inbox ${show(items)}`;
      return recorded(h, 'req-pb-hang', 'uncertain', 'none') === true ? inbox : recorded(h, 'req-pb-hang', 'uncertain', 'none');
    }, 5000),
    act('the operator sends req-pb-hang again', h => sendOnce(h, 'operator', 'pb-again', playbackCommand('play'), 'req-pb-hang')),
    holds('the Move heard play once: an uncertain command is never sent again', h => speakersGot(h, 'move [pause,play] ht-a9 [pause]'), 500),
    holds('no message, reader copy or log record names a speaker\'s address, and nothing carries the token', async h => {
      const address = noSpeakerAddress(h);
      return address === true ? noToken(h) : address;
    }, 100),
  ],
};

// The LIFX module (Hub #928)

/** The LIFX module's section (Hub #919, #928): its factory's simulated section, `pendant-1` and the unqualified Beam. */
export const LIFX_SECTION = LIFX_SIMULATED_SECTION;
const PENDANT_AT = '192.0.2.40';
const BEAM_AT = '192.0.2.41';
/** The documentation network every simulated bulb's address is in, so a leak of any bulb's address shows. */
const BULB_NETWORK = '192.0.2.';
/** The hue in degrees each agent status paints, from the shared status colors. */
const STATUS_HUE = {attention: 38, working: 218, done: 135} as const;
/** A command the operator sends one bulb, as the dashboard would. */
const bulbCommand = (family: string, type: string, id: string, data: object, dataschema = `https://bunny.invalid/events/${family}/2.0`): {key: string; draft: CommandDraft<object>} =>
  ({key: `bunny.cmd.${family}.${id}`, draft: {type, subject: id, dataschema, data}});
const lifxMode = (mode: string): {key: string; draft: CommandDraft<object>} => bulbCommand('device-mode-set', 'org.bunny.device-mode.set.requested', 'pendant-1', {mode});
/** How many writes, paints and commands alike, the simulated bulb at `address` got. */
const lifxWrites = (h: Harness, address = PENDANT_AT): number =>
  h.devices().lifx.packets.filter(packet => packet.address === address && (packet.type === PACKET.setColor || packet.type === PACKET.setPower)).length;
/** Whether pendant-1 shows `expected`, each value in degrees, percent or kelvin, within one unit. */
const pendantShows = (h: Harness, expected: {hue?: number; saturation?: number; brightness?: number; kelvin?: number}): Outcome => {
  const color = h.devices().lifx.bulbs[PENDANT_AT]?.color;
  if (color === undefined) return 'pendant-1 is not simulated yet';
  const shown = {
    hue: Math.round((color.hue * 360) / 65535), saturation: Math.round((color.saturation * 100) / 65535),
    brightness: Math.round((color.brightness * 100) / 65535), kelvin: color.kelvin,
  };
  const close = Object.entries(expected).every(([key, value]) => Math.abs(shown[key as keyof typeof shown] - value) <= 1);
  return close || `pendant-1 shows ${show(shown)}`;
};
/** The LIFX module's source: `device` is a shared family, so its reader names the owner it syncs from (Hub #967). */
const LIFX_OWNER = 'bunny/modules/lifx';
const lifxDevice = (h: Harness, id: string): DeviceRecord | undefined =>
  h.reader.states<DeviceRecord>('device', LIFX_OWNER).find(state => state.data.id === id)?.data;

/**
 * The LIFX module (Hub #928) with a simulated pendant-1 and Beam: in Work the bulb follows the core's sessions, painting
 * only when the shown status changes; a restart writes nothing; in Free nothing paints it; a color command reaches it;
 * switched off at the wall, it is reported unavailable and a command to it ends uncertain, in the inbox. The Beam is
 * listed with no controls and never reached, and no address leaves the module.
 */
const lifxBulbs: Scenario = {
  id: 'lifx-bulbs',
  title: 'the LIFX bulbs follow agent status in Work, rest in Free, take a color, and report an unreachable bulb',
  seed: {modules: ['core', 'lifx'], follows: [CORE_FAMILIES, {owner: LIFX_OWNER, families: ['device', 'lifx-light']}], config: {lifx: LIFX_SECTION}},
  steps: [
    expect('the core and the LIFX module are running', h => running(h, ['core', 'lifx'])),
    expect('the reader holds pendant-1 available, in free, with its controls, and the Beam with none', h => {
      const pendant = lifxDevice(h, 'pendant-1'), beam = lifxDevice(h, 'beam');
      const ready = pendant?.availability === 'available' && pendant.desired.mode.status === 'known' && pendant.desired.mode.value === 'free' && pendant.capabilities.power.supported;
      return (ready && beam !== undefined && Object.values(beam.capabilities).every(capability => !capability.supported)) ||
        `pendant-1 ${String(pendant?.availability)}, beam ${show(beam?.capabilities)}`;
    }),
    act('the operator sets pendant-1 to work as req-work', h => sendOnce(h, 'operator', 'work', lifxMode('work'), 'req-work')),
    expect('history holds req-work succeeded, and the reader shows pendant-1 in work', h =>
      recorded(h, 'req-work', 'succeeded', 'transmitted') === true ? show(lifxDevice(h, 'pendant-1')?.desired.mode) === show({status: 'known', value: 'work'}) || 'not in work' :
        recorded(h, 'req-work', 'succeeded', 'transmitted')),
    expect('pendant-1 paints idle: warm white at half brightness', h => pendantShows(h, {saturation: 0, brightness: 50, kelvin: 2700})),
    act('the hook observes a session start and a turn', async h => {
      await publish(h, sessionStarted);
      await publish(h, turnStarted);
    }),
    expect('pendant-1 paints working blue', h => pendantShows(h, {hue: STATUS_HUE.working, brightness: 50})),
    act('the hook observes an approval prompt', h => publish(h, approvalPrompt('approval-1'))),
    expect('pendant-1 paints attention amber', h => pendantShows(h, {hue: STATUS_HUE.attention, brightness: 50})),
    holds('pendant-1 got one paint per change: idle, working and attention', h => lifxWrites(h) === 3 || `${lifxWrites(h)} writes`, 500),
    act('the runtime restarts cleanly while the approval still waits', h => h.restart()),
    expect('the core and the LIFX module are running again', h => running(h, ['core', 'lifx'])),
    holds('the restart wrote nothing to pendant-1, which still shows attention', h =>
      (lifxWrites(h) === 3 && pendantShows(h, {hue: STATUS_HUE.attention}) === true) || `${lifxWrites(h)} writes`, 1000),
    act('the operator sets pendant-1 to free as req-free', h => sendOnce(h, 'operator', 'free', lifxMode('free'), 'req-free')),
    expect('history holds req-free succeeded', h => recorded(h, 'req-free', 'succeeded', 'transmitted')),
    act('the hook observes the approval resolved', h => publish(h, approvalResolved('approval-1'))),
    expect('the reader\'s session no longer waits', h => waiting(h, [])),
    holds('in free nothing paints pendant-1, which keeps its amber', h =>
      (lifxWrites(h) === 3 && pendantShows(h, {hue: STATUS_HUE.attention}) === true) || `${lifxWrites(h)} writes`, 1000),
    act('the operator sets pendant-1 to hue 120 at full saturation as req-color', h =>
      sendOnce(h, 'operator', 'color', bulbCommand('lifx-color-set', 'org.bunny.lifx-color.set.requested', 'pendant-1', {hue: 120, saturation: 100}), 'req-color')),
    expect('pendant-1 shows green, and history holds req-color succeeded', h =>
      pendantShows(h, {hue: 120, saturation: 100}) === true ? recorded(h, 'req-color', 'succeeded', 'transmitted') : pendantShows(h, {hue: 120, saturation: 100})),
    act('pendant-1 is switched off at the wall', h => { h.simulate({device: 'lifx', action: 'offline', address: PENDANT_AT}); }),
    act('the operator switches pendant-1 off as req-off; the module accepts it', h =>
      sendOnce(h, 'operator', 'off', bulbCommand('power-set', 'org.bunny.power.set.requested', 'pendant-1', {on: false}), 'req-off')),
    expect('history holds req-off uncertain, with no evidence it reached the bulb, and the inbox holds it', h => {
      const rows = historyOf(h, 'req-off').map(entry => `${entry.result}/${entry.evidence}`);
      const items = inboxOf(h, 'req-off');
      return (show(rows) === show(['uncertain/none']) && items.length === 1) || `history ${show(rows)}, inbox ${show(items)}`;
    }, 5000),
    expect('the reader shows pendant-1 unavailable', h => lifxDevice(h, 'pendant-1')?.availability === 'unavailable' || String(lifxDevice(h, 'pendant-1')?.availability)),
    act('the operator asks the Beam to switch on', h => h.send('operator', 'beam', bulbCommand('power-set', 'org.bunny.power.set.requested', 'beam', {on: true}), {timeoutMs: 5000, requestId: 'req-beam'})),
    expect('the Beam refuses it: it offers no power control', h => answered(h, 'beam', 'unsupported-capability')),
    holds('the Beam got no packet, and no message or record carries a bulb\'s address', h => {
      const places = [h.logs(), h.published(), h.reader.heard(), ...h.reader.families().map(family => h.reader.states(family))];
      const leaked = places.some(value => JSON.stringify(value).includes(BULB_NETWORK));
      const packets = h.devices().lifx.packets.filter(packet => packet.address === BEAM_AT).length;
      return (packets === 0 && !leaked) || `${packets} packets to the Beam, address leaked: ${String(leaked)}`;
    }, 300),
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
    throw new Error('the sync was served');
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
    expect('the core, the lamp and the sign are still running', h => running(h, ['core', 'lamp', 'sign'])),
  ],
};

// The Tidbyt module (Hub #930): agent status and now playing as two tiles in the Tidbyt's rotation, on a simulated cloud.

/** The Tidbyt section: its factory's simulated section, following the playback module's simulated record. */
export const TIDBYT_SECTION = TIDBYT_SIMULATED_SECTION;
/** The Tidbyt module's source, which a reader of the shared `device` family names as its copy's owner (#967). */
const TIDBYT_OWNER = 'bunny/modules/tidbyt';
const STATUS_TILE = TIDBYT_SECTION.statusInstallation;
const CARD_TILE = TIDBYT_SECTION.nowPlaying.installation;
/** The least time between two writes of one tile. */
const TILE_GATE_MS = 15_000;
const tidbytDevice = (h: Harness): DeviceRecord | undefined =>
  h.reader.states<DeviceRecord>('device', TIDBYT_OWNER).find(state => state.data.id === TIDBYT_SECTION.id)?.data;
/** What one installation of the simulated Tidbyt shows, and how often it was pushed, with each push's time. */
const tile = (h: Harness, installation: string): {picture: string[]; pushes: number; pushedAtMs: number[]} | undefined =>
  h.devices().tidbyt.installations[installation];
/** The status tile the reader's copy of the sessions calls for: the picture of the frame the module draws from them. */
const expectedStatus = (h: Harness): string[] =>
  picture(statusFrame(statusView({synced: true, sessions: h.reader.states<SessionRecord>('session').map(state => state.data)})).rgb);
/** Whether the status tile shows what the reader's sessions call for, after `pushes` pushes. */
function statusShown(h: Harness, pushes: number): Outcome {
  const shown = tile(h, STATUS_TILE);
  if (shown === undefined) return 'the status tile is not in the rotation';
  if (shown.pushes !== pushes) return `the status tile was pushed ${shown.pushes} times`;
  return show(shown.picture) === show(expectedStatus(h)) || `the status tile shows ${show(shown.picture)}`;
}
/** Whether the now-playing tile shows the reader's playback record as a card, after `pushes` pushes. */
function cardShown(h: Harness, pushes: number): Outcome {
  const record = h.reader.states<PlaybackState>('playback').find(state => state.data.id === TIDBYT_SECTION.nowPlaying.playback)?.data;
  const view = nowPlayingView({record, following: true, lostForMs: 0});
  if (!view.card) return 'the reader\'s playback record shows no card';
  const shown = tile(h, CARD_TILE);
  if (shown === undefined) return 'the now-playing tile is not in the rotation';
  if (shown.pushes !== pushes) return `the now-playing tile was pushed ${shown.pushes} times`;
  return show(shown.picture) === show(picture(nowPlayingFrame(view).rgb)) || `the now-playing tile shows ${show(shown.picture)}`;
}
/** Whether the now-playing tile was pushed once and never removed: its one write is the first push. */
function cardStood(h: Harness): Outcome {
  const writes = h.devices().tidbyt.calls.filter(call => call.installation === CARD_TILE && call.method !== 'GET').map(call => call.method);
  return (show(writes) === show(['POST']) && tile(h, CARD_TILE)?.pushes === 1) || `the now-playing tile's writes were ${show(writes)}`;
}
/** The times between one tile's pushes. */
const gaps = (h: Harness, installation: string): number[] => {
  const times = tile(h, installation)?.pushedAtMs ?? [];
  return times.slice(1).map((at, index) => at - (times[index] ?? at));
};

/**
 * The Tidbyt module (Hub #930) on a simulated cloud: an idle start leaves the rotation alone; the status tile follows the
 * core's sessions, and a burst of changes inside the 15-second gate makes one later push of the latest state; the
 * now-playing tile follows the playback module's record through play and pause, each tile behind its own gate, and is
 * removed when the music stops. A restart while the card has stood past its gate, with the Move answering late, neither
 * removes nor pushes it, and brings the status rows back dimmed as uncertain. The reader holds the Tidbyt's device
 * record with no control, and neither the API key nor the cloud device appears anywhere.
 */
const tidbytTiles: Scenario = {
  id: 'tidbyt-tiles',
  title: 'the Tidbyt shows agent status and now playing, each tile pushed at most once every 15 seconds',
  seed: {
    modules: ['core', 'playback', 'tidbyt'], follows: [CORE_FAMILIES, ['playback'], {families: ['device'], owner: TIDBYT_OWNER}],
    config: {playback: PLAYBACK_SECTION, tidbyt: TIDBYT_SECTION},
  },
  steps: [
    expect('the core, the playback module and the Tidbyt module are running', h => running(h, ['core', 'playback', 'tidbyt'])),
    expect('the reader holds the Tidbyt available, with no control, once the cloud listed its installations', h => {
      const device = tidbytDevice(h);
      return (device?.availability === 'available' && Object.values(device.capabilities).every(capability => !capability.supported)) ||
        `the Tidbyt is ${String(device?.availability)}`;
    }, 5000),
    holds('an idle start pushes and removes nothing', h => {
      const writes = h.devices().tidbyt.calls.filter(call => call.method !== 'GET').length;
      return writes === 0 || `${writes} writes`;
    }, 500),
    act('the hook observes a session start and a turn', async h => {
      await publish(h, sessionStarted);
      await publish(h, turnStarted);
    }),
    // The start's listing counts against the tile's 15-second gate, as the runner's did, so the first push may wait for it.
    expect('the status tile shows the working session', h => statusShown(h, 1), 17_000),
    act('within the gate, the hook observes an approval prompt, its answer and a second prompt', async h => {
      await publish(h, approvalPrompt('approval-1'));
      await publish(h, approvalResolved('approval-1'));
      await publish(h, approvalPrompt('approval-2'));
    }),
    expect('the reader\'s session waits for the second approval', h => waiting(h, ['approval-2'])),
    holds('the burst pushes nothing more inside the gate', h => tile(h, STATUS_TILE)?.pushes === 1 || `${String(tile(h, STATUS_TILE)?.pushes)} pushes`, 9000),
    expect('once the gate opens, one push shows the latest state: the session asking', h => statusShown(h, 2), 9000),
    expect('the two pushes are at least 15 seconds apart', h => gaps(h, STATUS_TILE).every(gap => gap >= TILE_GATE_MS) || show(gaps(h, STATUS_TILE))),
    act('the phone plays a song to the Move', h => { h.simulate({device: 'playback', speaker: 'sonos', action: 'play', title: 'Move Song'}); }),
    expect('the now-playing tile shows the song, behind its own gate', h => cardShown(h, 1), 8000),
    holds('the song plays on past the card\'s 15-second gate, and nothing more is written to it', h => cardStood(h), TILE_GATE_MS + 1000),
    // A restart while the song plays, with the Move answering late: the HT-A9, on another input, answers first. The
    // playback record waits for the Move's first read, so nothing tells the Tidbyt module the song stopped.
    act('the Move answers each call 400 ms late', h => { h.simulate({device: 'playback', speaker: 'sonos', action: 'slow'}); }),
    act('the runtime restarts cleanly while the song plays', h => h.restart()),
    holds('through the restart and the Move\'s slow first read, the card is never removed or pushed again', h => cardStood(h), 3000),
    expect('the reader\'s playback record shows the song playing on the Move', h => playbackShows(h, 'available playing "Move Song" [pause,next,previous]')),
    act('the Move answers at once again', h => { h.simulate({device: 'playback', speaker: 'sonos', action: 'answer'}); }),
    expect('once its gate opens, the status tile shows the session dimmed as uncertain after the restart', h => statusShown(h, 3), 18_000),
    act('the phone pauses the Move', h => { h.simulate({device: 'playback', speaker: 'sonos', action: 'pause'}); }),
    expect('the reader\'s playback record shows the song paused', h => playbackShows(h, 'available paused "Move Song" [play,next,previous]'), 6000),
    expect('once its gate opens, the now-playing tile shows the pause marker', h => cardShown(h, 2), 18_000),
    act('the phone stops the Move', h => { h.simulate({device: 'playback', speaker: 'sonos', action: 'stop'}); }),
    expect('the now-playing tile leaves the rotation, and the status tile stays', h =>
      (tile(h, CARD_TILE) === undefined && tile(h, STATUS_TILE) !== undefined) || `installations ${show(Object.keys(h.devices().tidbyt.installations))}`, 18_000),
    expect('every push of each tile was at least 15 seconds after the one before', h =>
      [STATUS_TILE, CARD_TILE].every(installation => gaps(h, installation).every(gap => gap >= TILE_GATE_MS)) || 'a push came early'),
    holds('neither the API key nor the cloud device appears in a log record, a message, health or a reader copy', async h => {
      const places = [h.logs(), h.published(), await h.health(), h.reader.heard(), ...h.reader.families().map(family => h.reader.states(family))];
      const leaked = places.some(value => JSON.stringify(value).includes(SIMULATED_API_KEY) || JSON.stringify(value).includes(SIMULATED_DEVICE));
      return (!leaked && h.devices().tidbyt.refusedKeys === 0) || 'the key or the device appears, or the cloud refused the key';
    }, 100),
  ],
};

/** The catalog, in the order a reader meets it. Every runtime story adds its scenarios here. */
export const SCENARIOS: readonly Scenario[] = [
  approvalReachesEveryModule, commandWithTrackedOutcome, moduleFailsOthersContinue, remotePartReconnects, zeroModules, agentSessions, endToEnd,
  configuredModule, misconfiguredModule, speakerPlayback, lifxBulbs, deviceOwners, tidbytTiles,
];

export const scenario = (id: string): Scenario | undefined => SCENARIOS.find(entry => entry.id === id);
