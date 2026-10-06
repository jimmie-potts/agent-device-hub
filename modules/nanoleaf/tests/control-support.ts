// The control cases' harness: record.ControlCase's steps on the worker harness, with commands admitted through the
// port's admission instead of Python's controller ledger, and each Python receipt compared through MAPPING.md's
// controller receipt rule (recorded/controls.json).
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import type {Json} from '../src/compat.js';
import {admitCommand, discovered, Execution, Refused, sceneList} from '../src/controls.js';
import {DEFAULT} from '../src/devices.js';
import {expireQueued, type ErrorCode, type Outcome as ControlOutcome} from '../src/journal.js';
import {setMode} from '../src/modes.js';
import {execute, transaction} from '../src/sqlite.js';
import {overrides} from '../src/store.js';
import {fixtureJson} from './support.js';
import {outcomeOf, WorkerCase, type Call, type Outcome, type RequestSpec, type Step} from './worker-support.js';

/** What record.receipt_summary keeps of a Python receipt: the admission's status, the outcome, failure and effects. */
export interface Summary {
  code: number | null;
  outcome: string | null;
  failure: string | null;
  priorEffects: string | null;
  completed: string[] | null;
  uncertain: string[] | null;
}

interface RecordedCase {
  name: string;
  steps: Step[];
  outcomes: Outcome[];
  hooks: Outcome[][];
  calls: Call[];
  rows: Record<string, unknown[][]>;
  scene: unknown;
  device: {selected: string; brightness: number; on: boolean};
  receipts: Record<string, Summary>;
  clock: number;
}

const RECORDED = fixtureJson('recorded/controls.json') as {cases: RecordedCase[]};

/** The port's reply: accepted, or refused with a profile error code. */
export type Reply = 'accepted' | {refused: ErrorCode};

/** Python's admission failure codes that MAPPING.md's error table renames; the rest keep their name. */
const RENAMED: Record<string, ErrorCode | 'revision-conflict'> = {'unknown-device': 'not-found', 'stale-generation': 'revision-conflict',
  'request-order': 'revision-conflict', 'request-expired': 'expired'};

/** The reply for Python's admission: queued is accepted, and so is a mode command that needed no change. */
export function replyOf(summary: Summary): Reply {
  if (summary.code === 202 || (summary.code === 200 && summary.outcome === 'cancelled' && summary.failure === null)) return 'accepted';
  assert.ok(summary.failure !== null && summary.code !== null && summary.code >= 400, `Unexpected admission ${JSON.stringify(summary)}.`);
  return {refused: (RENAMED[summary.failure] ?? summary.failure) as ErrorCode};
}

/**
 * The outcome MAPPING.md's controller receipt rule gives a Python receipt, with the port's two documented differences:
 * a mode command that needed no change succeeds with observed evidence, and a native command that expired unsent fails
 * `expired`, where Python's listener wrote `transport-failure`. Null when the command has no outcome: it was refused or
 * is still queued.
 */
export function outcomeFor(id: string, summary: Summary, admission: Summary): ControlOutcome | null {
  const base = {type: 'outcome' as const, device: DEFAULT, requestId: id};
  if (replyOf(admission) !== 'accepted' || summary.outcome === 'queued') return null;
  if (admission.code === 200) return {...base, result: 'succeeded', evidence: 'observed'};
  // Rule 2: possible effects are uncertain, with no evidence.
  if (summary.priorEffects === 'possible') return {...base, result: 'uncertain', evidence: 'none', error: {code: 'uncertain-result'}};
  const evidence = summary.priorEffects === 'confirmed-transmission' ? 'transmitted' : 'none';
  switch (summary.outcome ?? '') {
    case 'sent': return {...base, result: 'succeeded', evidence: 'transmitted'};
    case 'partially-applied':
    case 'uncertain': return {...base, result: 'uncertain', evidence, error: {code: 'uncertain-result'}};
    case 'cancelled': return {...base, result: 'failed', evidence, error: {code: 'cancelled'}};
    case 'failed': {
      const failure = summary.failure ?? 'internal';
      if (evidence === 'transmitted' && (failure === 'uncertain-result' || failure === 'transport-failure')) {
        return {...base, result: 'uncertain', evidence, error: {code: 'uncertain-result'}};
      }
      const code = failure === 'transport-failure' ? 'expired' : (RENAMED[failure] ?? failure);
      return {...base, result: 'failed', evidence, error: {code: code as ErrorCode}};
    }
    default: throw new Error(`Unexpected receipt ${JSON.stringify(summary)}.`);
  }
}

/** record.PANELS_REGISTRY: a Panels device registered beside the Lines. */
const PANELS_REGISTRY = {panels: {kind: 'panels', ip: '192.168.1.208', token_ref: 'panels_token'}};

const known = (value: unknown): Json => (value === null ? {status: 'unknown'} : {status: 'known', value: value as Json});

/** A step argument that names a request, or an op. */
function textOf(value: Json | undefined): string {
  if (typeof value !== 'string') throw new TypeError('A step names its request with text.');
  return value;
}

/** record.ControlCase: a worker case whose commands go through the port's admission on the module's connection. */
export class ControlCase extends WorkerCase {
  /** Each hook's step outcomes, in the order the hooks were set. */
  readonly hookResults: Outcome[][] = [];

  constructor(readonly context: TestContext) {
    super(context);
  }

  override async apply(step: Step): Promise<unknown> {
    const [first, ...args] = step;
    const op = typeof first === 'string' ? first : '';
    const db = this.database();
    switch (op) {
      case 'controller': return null;
      case 'command':
      case 'play': return this.admit(textOf(args[0]), args[1], args.length > 2 ? textOf(args[2]) : undefined);
      case 'layout':
        writeFileSync(join(this.directory, 'layout.json'), JSON.stringify(args[0]));
        return null;
      case 'register': {
        // A registered Panels device (record.PANELS_REGISTRY); the port keeps no ledger to configure for it.
        const path = join(this.directory, 'config.json');
        const config = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
        writeFileSync(path, JSON.stringify({...config, devices: PANELS_REGISTRY, panels_token: 'PRIVATE_PANELS_TOKEN'}));
        return null;
      }
      case 'attempting':
        // A worker stopped after it recorded the attempt and before its result.
        transaction(db, () => execute(db, "UPDATE control_journal SET phase='attempting', uncertain=1 WHERE id=?", textOf(args[0])));
        return null;
      case 'discover': return transaction(db, () => discovered(db, args[0] as string[], DEFAULT, this.report));
      case 'expire':
        await this.transact(report => expireQueued(db, DEFAULT, this.clock.seconds(), report));
        return null;
      case 'expireAll': return this.expireAll();
      case 'deviceState': return {brightness: this.device.brightness, on: this.device.on, selected: this.device.selected};
      case 'desired': {
        const desired = overrides(db);
        return {power: known(desired.power), brightness: known(desired.brightness)};
      }
      case 'sceneIds': {
        const ids = sceneList(db).map(scene => scene.id);
        return [ids.length, ids.every(id => id.length <= 128 && id.startsWith('scene-'))];
      }
      case 'calls': return structuredClone(this.device.calls);
      case 'hook': {
        const spec = args[0] as unknown as RequestSpec & {complete?: boolean; step: Step};
        const results: Outcome[] = [];
        this.hookResults.push(results);
        const run = (): void => {
          results.push(this.hookStep(spec.step));
        };
        if (spec.complete === true) this.completeHook(run);
        else this.device.hooks.push({spec, run});
        return null;
      }
      case 'run': {
        const result = await super.apply(step) as {outcome: Outcome; scheduled: Outcome[]};
        // Python's worker returned None where the port's ends with true.
        if ('result' in result.outcome && result.outcome.result === true) result.outcome = {result: null};
        return result;
      }
      default: return super.apply(step);
    }
  }

  /**
   * Admit a command as the runtime's responder does, in one transaction. Python's scene index picks the port's own ID,
   * and its public device ID names the port's device: `device` was the Lines.
   */
  admit(id: string, value: unknown, target?: string): Reply {
    const command = structuredClone(value) as Record<string, unknown>;
    const db = this.database();
    if ('sceneIndex' in command) {
      const index = command.sceneIndex;
      delete command.sceneIndex;
      command.sceneId = typeof index === 'number' ? sceneList(db)[index]?.id : index;
    }
    if (command.kind === 'mode.set') command.mode = String(command.mode).toLowerCase();
    const instant = this.clock.seconds();
    try {
      const device = target === undefined || target === 'device' ? {} : {device: target};
      transaction(db, () => admitCommand(db, this.directory, {id, command, instant, expires: instant + 30, ...device}, this.report));
      return 'accepted';
    } catch (error) {
      if (error instanceof Refused) return {refused: error.code};
      throw error;
    }
  }

  /** The listener's expiry with every queued command past its time, as test_expiry_during_unread_* ran it. */
  expireAll(): null {
    const db = this.database();
    transaction(db, () => expireQueued(db, DEFAULT, Infinity, this.report));
    return null;
  }

  /** A hook's step runs inside a device request or an execution's completion, so it is synchronous. */
  hookStep(step: Step): Outcome {
    try {
      if (step[0] === 'command') return {result: this.admit(textOf(step[1]), step[2])};
      if (step[0] === 'expireAll') return {result: this.expireAll()};
      if (step[0] === 'mode') {
        const db = this.database();
        transaction(db, () => setMode(db, textOf(step[1]), this.clock.seconds(), this.report));
        return {result: null};
      }
      throw new Error(`Unknown hook step ${textOf(step[0])}.`);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      return {error: error.name, message: error.message};
    }
  }

  /**
   * Run `step` once as an execution completes, before it records its end, as
   * test_control_committed_between_journaled_sends_is_applied_before_idle_exit patched Execution.complete.
   */
  completeHook(run: () => void): void {
    const descriptor = Object.getOwnPropertyDescriptor(Execution.prototype, 'complete');
    assert.ok(descriptor !== undefined);
    const original = descriptor.value as (this: Execution) => Promise<void>;
    let pending = true;
    Object.defineProperty(Execution.prototype, 'complete', {...descriptor, value(this: Execution): Promise<void> {
      if (pending) {
        pending = false;
        run();
      }
      return original.call(this);
    }});
    this.context.after(() => {
      Object.defineProperty(Execution.prototype, 'complete', descriptor);
    });
  }

  /** The last outcome reported for each request ID. */
  outcomes(): Map<string, ControlOutcome> {
    const result = new Map<string, ControlOutcome>();
    for (const message of this.reported) if (message.type === 'outcome') result.set(message.requestId, message);
    return result;
  }
}

/** A recorded step's outcome in the port's terms: a command's receipt becomes its reply, also inside a worker run. */
function translated(step: Step, outcome: Outcome, admissions: Map<string, Summary>): Outcome {
  if (!('result' in outcome)) return outcome;
  const [op, ...args] = step;
  if (op === 'command' || op === 'play') {
    const summary = outcome.result as Summary;
    admissions.set(textOf(args[0]), summary);
    return {result: replyOf(summary)};
  }
  if (op === 'run') {
    const value = outcome.result as {outcome: Outcome; scheduled: Outcome[]};
    const scheduled = (args[1] ?? []) as [number, Step][];
    return {result: {outcome: value.outcome, scheduled: value.scheduled.map((item, index) => translated(scheduled[index]?.[1] ?? [], item, admissions))}};
  }
  return outcome;
}

export interface ControlReplay {
  run: ControlCase;
  outcomes: Outcome[];
  recorded: RecordedCase;
}

/**
 * Replay a recorded control case in the port and check it against Python: every step's outcome, with each command's
 * receipt as its reply; each hook's; every device request, row, the scene file, the device and the clock; and each
 * command's last outcome through MAPPING.md's controller receipt rule. A command ends at most once.
 */
export async function replayControls(context: TestContext, name: string): Promise<ControlReplay> {
  const recorded = RECORDED.cases.find(item => item.name === name);
  assert.ok(recorded !== undefined, `No recorded control case ${name}.`);
  const run = new ControlCase(context);
  const outcomes: Outcome[] = [];
  for (const step of recorded.steps) outcomes.push(await outcomeOf(() => run.apply(step)));
  const admissions = new Map<string, Summary>();
  assert.deepEqual(outcomes, recorded.steps.map((step, index) => translated(step, recorded.outcomes[index] ?? {result: null}, admissions)),
    `${name}: outcomes`);
  const hookSteps = recorded.steps.filter(step => step[0] === 'hook').map(step => (step[1] as {step: Step}).step);
  assert.deepEqual(run.hookResults, recorded.hooks.map((results, index) => results.map(item => translated(hookSteps[index] ?? [], item, admissions))),
    `${name}: hooks`);
  assert.deepEqual(run.device.calls, recorded.calls, `${name}: device requests`);
  assert.deepEqual(run.rows(), recorded.rows, `${name}: rows`);
  assert.deepEqual(run.scene(), recorded.scene, `${name}: scene file`);
  assert.deepEqual({selected: run.device.selected, brightness: run.device.brightness, on: run.device.on}, recorded.device, `${name}: device`);
  assert.equal(run.clock.seconds(), recorded.clock, `${name}: clock`);
  const expected = new Map<string, ControlOutcome>();
  for (const [id, summary] of Object.entries(recorded.receipts)) {
    const admission = admissions.get(id);
    assert.ok(admission !== undefined, `${name}: ${id} has no admission`);
    const outcome = outcomeFor(id, summary, admission);
    if (outcome !== null) expected.set(id, outcome);
  }
  assert.deepEqual(run.outcomes(), expected, `${name}: outcomes through the mapping`);
  const ended = run.reported.flatMap(message => (message.type === 'outcome' ? [message] : []));
  assert.deepEqual(ended.map(message => message.requestId).sort(), [...run.outcomes().keys()].sort(), `${name}: a command ends once`);
  for (const message of ended) {
    // The profile's outcome rules: a succeeded outcome has transmitted or observed evidence and no error; any other has
    // an error, and an uncertain one is uncertain-result.
    if (message.result === 'succeeded') assert.ok(message.error === undefined && message.evidence !== 'none', name);
    else assert.ok(message.error !== undefined, name);
    if (message.result === 'uncertain') assert.equal(message.error?.code, 'uncertain-result', name);
  }
  return {run, outcomes, recorded};
}

/** The PUT requests in `calls` as [endpoint, payload]. */
export const puts = (calls: readonly Call[]): [string, unknown][] =>
  calls.filter(([, method]) => method === 'PUT').map(([, , endpoint, payload]) => [endpoint, payload]);
