// The framework of the runtime's scenario catalog (Hub #846, #999): the harness every run type implements, a scenario's
// seed and steps, the runner, and the observations scenarios share. The catalog (`catalog.ts`) holds the core's and the
// fixture modules' scenarios, and each registered module's scenarios live in `modules/<module>.ts`, which the catalog
// collects; both build on this file alone. Each run type has one execution adapter that runs the scenarios unchanged: the
// in-memory harness (`memory.ts`, tier 1, in CI) and #920's disposable runs (tier 2). A step acts through the harness,
// expects an observation within a time bound, or expects one to hold for a while. Time is virtual in memory and real in
// a run; only the harness differs.
import type {Message} from '@jimmie-potts/event-contracts/v2';
import type {InboxItem, SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {SdkError, errorType, type CommandDraft, type DeviceAction, type Participant} from '@jimmie-potts/sdk';
import type {LogRecord, ModuleHealth} from '../../src/index.js';
import {SESSION_ID, observation, type ObservationOptions} from '../fixtures/agents.js';
import type {ChimeDeviceState} from '../fixtures/chime.js';
import type {HistoryRow} from '../../src/core/history.js';
type HistoryEntry = {source: string; requestId: string; result: 'succeeded' | 'failed' | 'uncertain'; evidence: 'transmitted' | 'observed' | 'none'};
import type {LampDeviceState} from '../fixtures/lamp.js';
import {SYNTHETIC_TOKEN, type SignDeviceState} from '../fixtures/sign.js';

export const TRANSPORTS = ['in-process', 'remote'] as const;
/** How the scenario's parts reach the runtime: on its bus, or through its SDK edge over SSE and HTTP. */
export type TransportName = (typeof TRANSPORTS)[number];
/** The parts a scenario plays: an agent hook, two control surfaces and a reader such as the dashboard. */
export const ROLES = ['hook', 'operator', 'panel', 'reader'] as const;
export type Role = (typeof ROLES)[number];
/**
 * A module a run can start, built with its simulated transport: the core, a fixture module (`lamp`, `chime`, `sign`),
 * or a registered module by its name (Hub #999).
 */
export type ModuleName = string;

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
  readonly config?: Readonly<Record<ModuleName, object>>;
  /** Complete sections for modules that use no secret file; no synthetic secret is injected. */
  readonly sections?: Readonly<Record<ModuleName, object>>;
  /** Private collector files selected explicitly by Wispr's bounded file-handoff scenarios. */
  readonly wisprFixture?: {readonly observation: 'fresh' | 'stale' | 'missing'; readonly exposeToDashboard?: boolean};
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

/**
 * Who calls the runtime's gateway (Hub #835): a part, with its client credential; `producer`, with the agent hooks'
 * converted producer credential (Hub #926); `browser`, with a session that a trusted loopback page opened; `stranger`,
 * with a made-up token; or `anonymous`, with neither.
 */
export type Caller = Role | 'producer' | 'browser' | 'stranger' | 'anonymous';
/** One HTTP call to the gateway. `origin: 'other'` sends it as a page on another site would. */
export type GatewayCall = {
  as: Caller; method: 'GET' | 'POST' | 'PUT' | 'DELETE'; path: string; body?: unknown; headers?: Readonly<Record<string, string>>; origin?: 'other';
};
/** What the gateway answered: its status, its headers in lowercase and its body as text. */
export type GatewayAnswer = {status: number; headers: Readonly<Record<string, string>>; text: string};

/**
 * Each part's grant at the edge, as a run seeds it and the in-memory harness configures it (Hub #835): the old Hub's
 * scopes, with no device grant, since no grant limits a part to some devices (owner decision, 2026-10-07). The hook may
 * only publish lifecycle observations; the reader may only read; the operator and the panel read every record and
 * command every device and the core's operator commands.
 */
export const GRANTS: Readonly<Record<Role, {scopes: readonly ('read' | 'control' | 'ingest')[]}>> = {
  hook: {scopes: ['ingest']},
  operator: {scopes: ['read', 'control']},
  panel: {scopes: ['read', 'control']},
  reader: {scopes: ['read']},
};
/**
 * The synthetic prefix of every part's token in a harness: no record, message, health entry, answer or proof may carry
 * it (Hub #835).
 */
export const TOKEN_PREFIX = 'tok_SYNTHETIC835';
/**
 * The agent hooks' producer (Hub #926): a synthetic Claude Code source configuration, as the Hub's setup writes it into
 * `producer.json`. Each harness grants its converted credential (`ingest`) and writes an unchanged 1.x producer file for
 * the 2.0 hook script, with a token in the Hub's form that carries `TOKEN_PREFIX`.
 */
export const PRODUCER = {provider: 'claude', client: 'code', hostId: 'host-sim', sourceId: 'claude-code-hooks', hook: 'SessionStart'} as const;

/**
 * What the simulated devices show, as plain data so a disposable run can report it too: the fixture modules' devices,
 * and each registered module's by its name, as its simulation's `state` gives it (`deviceState`).
 */
export type DeviceStates = {readonly lamp: LampDeviceState; readonly chime: ChimeDeviceState; readonly sign: SignDeviceState} & {readonly [device: string]: unknown};
/**
 * What a scenario can make a simulated device do: a fixture module's device, or a registered module's, which names one
 * of its simulation's actions and any fields the action takes (Hub #999).
 */
export type Simulation =
  | {device: 'lamp'; action: 'hold' | 'release' | 'fail-next'}
  | {device: 'chime'; action: 'fault-next'}
  | {device: 'sign'; action: 'online' | 'offline'}
  | DeviceAction;
/** A hook's JSON, as Claude Code passes it to a hook command on stdin. */
export type HookPayload = Readonly<Record<string, unknown>>;
/** How one run of the hook script ended: its exit, everything it wrote, and how long it took from its start. */
export type HookRun = {code: number | null; signal: string | null; output: string; elapsedMs: number};
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
   * Sends a command as `role` straight through the SDK and records how it ends under `label`. Resolves with the answer,
   * which a step may also leave to `answer`. A remote grant may request only the core's own operator commands this way
   * (#782); every device command goes through `dispatch`.
   */
  send(role: Role, label: string, command: {key: string; draft: CommandDraft<object>}, options: {timeoutMs: number; requestId: string}): Promise<string>;
  /**
   * Sends a device's command, a moment or a mode change as `role` through the core's dispatcher, on the gateway's action
   * route `POST /api/v2/commands/<family>` (#782), on both transports, and records how it ends under `label`. The
   * command's key names its family and target, and its draft's payload is the action's data.
   */
  dispatch(role: Role, label: string, command: {key: string; draft: CommandDraft<object>}, requestId: string): Promise<string>;
  /**
   * How the request or action under `label` ended: `accepted`, the refusal's or uncertain result's error code,
   * `pending`, or `lost` when its requester died with the runtime or its HTTP call lost its connection.
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
  /** Calls the runtime's gateway over HTTP, on both transports (Hub #835). */
  gateway(call: GatewayCall): Promise<GatewayAnswer>;
  /**
   * Runs the 2.0 agent hook script once (Hub #926), as a client's hook command does: a new Node process with the
   * harness's unchanged 1.x producer file, which names the runtime's port, and `payload` on stdin. With
   * `runtime: 'stopped'` the runtime is stopped while the hook runs, as when the service is down, and starts again on the
   * same state directory afterwards.
   */
  hook(payload: HookPayload, options?: {runtime?: 'running' | 'stopped'}): Promise<HookRun>;
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

/**
 * A disposable run a module adds to the runs every catalog scenario seeds (tier 2): the shipped runtime with each shipped
 * module's simulated section, which `prepare` readies once the run's directories exist, as an installer's step before the
 * runtime's first start would, such as a migration of the module's installed data.
 */
export type ModuleRun = {readonly description: string; readonly prepare: (dataDir: string) => Promise<void>};
export type Scenario = {readonly id: string; readonly title: string; readonly seed: Seed; readonly steps: readonly Step[]};
export type StepResult = {name: string; kind: Step['kind']; outcome: 'passed' | 'failed'; detail?: string};
export type ScenarioResult = {
  id: string; title: string; tier: Harness['tier']; transport: TransportName; outcome: 'passed' | 'failed'; steps: StepResult[];
};

/** How often a step looks again: virtual milliseconds in memory, real ones in a run. */
export const POLL_MS = 10;

/**
 * A step's or a harness's own failure, with fixed text from the code that raised it. A run keeps each step's detail in
 * its proof, so any other exception is named only by its registry code or its type (ADR 0012, "Safe errors"; Hub #954).
 */
export class StepFailure extends Error {}

/** How a step or a harness names a failure: its own fixed text, an SDK refusal's registry code, or the exception's type. */
export function failureOf(error: unknown): string {
  if (error instanceof StepFailure) return error.message;
  if (error instanceof SdkError) return `SdkError ${error.body.error.code}`;
  return errorType(error);
}

async function attempt(check: () => Outcome | Promise<Outcome>): Promise<Outcome> {
  try {
    return await check();
  } catch (error) {
    return error instanceof StepFailure ? error.message : `threw ${failureOf(error)}`;
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


export const show = (value: unknown): string => JSON.stringify(value);
/** The expectation for the harness's transport, where the two transports end a case differently. */
export const byTransport = <T>(h: Harness, answers: Readonly<Record<TransportName, T>>): T => answers[h.transport];
export const answered = (h: Harness, label: string, expected: string): Outcome => h.answer(label) === expected || `${label} is ${h.answer(label)}`;
export const sendOnce = async (h: Harness, role: Role, label: string, command: {key: string; draft: CommandDraft<object>}, requestId: string): Promise<void> => {
  const answer = await h.send(role, label, command, {timeoutMs: 5000, requestId});
  if (answer !== 'accepted') throw new StepFailure(`${label} is ${answer}`);
};
/** Sends a device's command through the core's dispatcher (#782) and expects it accepted. */
export const dispatchOnce = async (h: Harness, role: Role, label: string, command: {key: string; draft: CommandDraft<object>}, requestId: string): Promise<void> => {
  const answer = await h.dispatch(role, label, command, requestId);
  if (answer !== 'accepted') throw new StepFailure(`${label} is ${answer}`);
};
export const publish = async (h: Harness, event: Parameters<typeof observation>[0], options: ObservationOptions = {}): Promise<void> => {
  const {key, draft} = observation(event, h.now(), options);
  await h.sdk('hook').publish(key, draft);
};

export const session = (h: Harness, id = SESSION_ID): SessionRecord | undefined =>
  h.reader.states<SessionRecord>('session').find(state => state.data.id === id)?.data;
export const waiting = (h: Harness, approvals: readonly string[]): Outcome => {
  const record = session(h);
  if (record === undefined) return 'the reader holds no session';
  const held = record.attention.flatMap(item => item.kind === 'approval' && item.id.status === 'known' ? [item.id.id] : []);
  return show(held) === show(approvals) || `the session waits for ${show(held)}`;
};
/**
 * What retained history recorded of a tracked action through the core's read API: each outcome
 * the tracker took, and each result the action reached without one.
 */
export const historyOf = async (h: Harness, requestId: string): Promise<HistoryEntry[]> => {
  const answer = await h.gateway({as: 'reader', method: 'GET', path: '/api/v2/history'});
  if (answer.status !== 200) return [];
  const {rows} = JSON.parse(answer.text) as {rows: HistoryRow[]};
  return rows.filter(row => row.requestId === requestId).flatMap(row => {
    if (row.kind === 'outcome') {
      const data = row.record.data as Omit<HistoryEntry, 'source'>;
      return [{...data, source: row.source}];
    }
    if (row.kind !== 'operation') return [];
    const step = row.record as {event: string; result?: HistoryEntry['result']; evidence?: HistoryEntry['evidence']};
    return step.event !== 'outcome' && step.result !== undefined ? [{source: 'bunny/core', requestId, result: step.result, evidence: step.evidence ?? 'none'}] : [];
  });
};
export const outcomesOf = async (h: Harness, requestId: string): Promise<HistoryEntry[]> => (await historyOf(h, requestId)).filter(entry => entry.source !== 'bunny/core');
export const recorded = async (h: Harness, requestId: string, result: HistoryEntry['result'], evidence: HistoryEntry['evidence']): Promise<Outcome> => {
  const rows = (await outcomesOf(h, requestId)).map(entry => `${entry.result}/${entry.evidence}`);
  return show(rows) === show([`${result}/${evidence}`]) || `history holds ${show(rows)} for ${requestId}`;
};
export const endedAs = async (h: Harness, requestId: string, expected: readonly string[]): Promise<Outcome> => {
  const rows = (await historyOf(h, requestId)).filter(entry => entry.source === 'bunny/core').map(entry => `${entry.result}/${entry.evidence}`);
  return show(rows) === show(expected) || `the core recorded ${show(rows)} for ${requestId}`;
};
export const inboxOf = (h: Harness, requestId: string): InboxItem['item'][] =>
  h.reader.states<InboxItem>('inbox-item').map(state => state.data.item).filter(item => item.kind === 'operation' && item.requestId === requestId);
/** The inbox holds the request as one failed operation, with the `unavailable` error. */
export const failedOperation = (h: Harness, requestId: string): Outcome => {
  const items = inboxOf(h, requestId);
  const item = items[0];
  return (items.length === 1 && item?.kind === 'operation' && item.result === 'failed' && item.error?.code === 'unavailable') || `inbox ${show(items)}`;
};
/** The named module's records of `event`, from the runtime's `from`th start on. */
export const logged = (h: Harness, module: string, event: string, from = 1): Generational<{record: LogRecord}>[] =>
  h.logs().filter(entry => entry.generation >= from && entry.record.attributes['bunny.module'] === module && entry.record.event_name === event);
/** The core's tracker records of one action in every generation, as `<event> <severity> <outcome>` (#782). */
export const tracked = (h: Harness, requestId: string): string[] => h.logs().map(({record}) => record)
  .filter(record => record.attributes['bunny.module'] === 'core' && record.attributes['bunny.request.id'] === requestId && record.event_name.startsWith('command.'))
  .map(record => `${record.event_name} ${record.severity_text} ${String(record.attributes['bunny.outcome'])}`);
export async function running(h: Harness, names: readonly string[]): Promise<Outcome> {
  const report = await h.health();
  const states = names.map(name => `${name} ${report.find(module => module.name === name)?.state ?? 'missing'}`);
  return states.every(state => state.endsWith(' running')) || states.join(', ');
}

/** What a registered module's simulated device shows now, as its simulation's `state` gives it, by the module's name. */
export function deviceState<T>(h: Harness, device: string): T {
  const state = h.devices()[device];
  if (state === undefined) throw new StepFailure(`no simulated ${device} device`);
  return state as T;
}

/** The core's families a reader keeps a copy of; retained history is read through the gateway. */
export const CORE_FAMILIES = ['session', 'inbox-item'] as const;
/**
 * No log record, published message, health entry or message the reader holds carries the synthetic token, which the
 * configured modules' secret files hold. The answer names where it appears, never the token.
 */
export async function noToken(h: Harness): Promise<Outcome> {
  const places: [string, unknown][] = [
    ['a log record', h.logs()], ['a published message', h.published()], ['health', await h.health()], ['a message the reader heard', h.reader.heard()],
    ...h.reader.families().map((family): [string, unknown] => [`the reader's copy of ${family}`, h.reader.states(family)]),
  ];
  const carrying = places.filter(([, value]) => JSON.stringify(value).includes(SYNTHETIC_TOKEN)).map(([place]) => place);
  return carrying.length === 0 || `the token appears in ${carrying.join(', ')}`;
}

// The gateway (Hub #835)

export type ErrorAnswer = {error?: {code?: unknown; retryable?: unknown}};
/** The answer's JSON body, or undefined when it is not JSON. */
export const bodyOf = <T>(answer: GatewayAnswer): T | undefined => {
  try {
    return JSON.parse(answer.text) as T;
  } catch {
    return undefined;
  }
};
/** The answer is the shared error body with `code`, its registry flag and `status`. */
export function refusedWith(answer: GatewayAnswer, status: number, code: string, retryable = false): Outcome {
  const error = bodyOf<ErrorAnswer>(answer)?.error;
  return (answer.status === status && error?.code === code && error.retryable === retryable) || `${answer.status} ${answer.text.slice(0, 200)}`;
}
/** The gateway's refusal records of a route, as `<route> <code> <severity>`. */
export const refusals = (h: Harness, route: string): string[] => h.logs().map(({record}) => record)
  .filter(record => record.event_name === 'runtime.edge.refused' && record.attributes['http.route'] === route)
  .map(record => `${String(record.attributes['http.route'])} ${String(record.attributes['bunny.code'])} ${record.severity_text}`);
/**
 * No log record, published message, health entry or message the reader holds carries a part's token, whose prefix is
 * the synthetic marker, and neither does any answer `answers` collected.
 */
export async function noPartToken(h: Harness, answers: readonly GatewayAnswer[] = []): Promise<Outcome> {
  const places: [string, unknown][] = [
    ['a log record', h.logs()], ['a published message', h.published()], ['health', await h.health()], ['a message the reader heard', h.reader.heard()],
    ['an answer', answers],
  ];
  const carrying = places.filter(([, value]) => JSON.stringify(value).includes(TOKEN_PREFIX)).map(([place]) => place);
  return carrying.length === 0 || `a token appears in ${carrying.join(', ')}`;
}

/** The answers a scenario collected, to scan them for a token at the end. */
export const collected = new WeakMap<Harness, GatewayAnswer[]>();
export const keep = (h: Harness, answer: GatewayAnswer): GatewayAnswer => {
  collected.set(h, [...collected.get(h) ?? [], answer]);
  return answer;
};
/** Calls the gateway, keeping the answer for the token scan, and checks it. */
export const answers = (call: GatewayCall, check: (answer: GatewayAnswer) => Outcome) => async (h: Harness): Promise<Outcome> =>
  check(keep(h, await h.gateway(call)));

/** A command message as a raw HTTP client builds it, from `source`, with its own ID, time and expiry. */
export function rawCommand(h: Harness, source: string, {draft}: {key: string; draft: CommandDraft<object>}, requestId: string, id: string): object {
  const time = h.now();
  return {
    specversion: '1.0', bunnyprofile: '2.0', id, source, type: draft.type, subject: draft.subject, time: new Date(time).toISOString(), kind: 'command',
    datacontenttype: 'application/json', dataschema: draft.dataschema, traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    expiresat: new Date(time + 10_000).toISOString(), data: {...draft.data, requestId},
  };
}
/** A raw HTTP client's `request` call to the SDK edge, as `as`, carrying `command`. */
export const rawRequest = (as: Role, key: string, command: object): GatewayCall =>
  ({as, method: 'POST', path: '/api/sdk/v1/request', body: {schema: 'sdk-remote/1.0', key, command}});
