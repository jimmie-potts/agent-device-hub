// The worker's test harness: a manual clock and scheduler in the runtime's shapes, SceneTest's fake device, and the
// replay of a worker case recorded from Python (recorded/worker.json, record.py's WorkerCase).
import assert from 'node:assert/strict';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import {pyJson, type Json, type JsonObject} from '../src/compat.js';
import {currentComet, pruneComets} from '../src/comets.js';
import {connectState, withState} from '../src/database.js';
import {DEFAULT} from '../src/devices.js';
import * as edits from '../src/edits.js';
import {dashboard, type Indication} from '../src/line-projection.js';
import {transactWith, type Outcome as ControlOutcome, type Report, type ScenesChanged, type Transact} from '../src/journal.js';
import {modeStatus, setMode as commandMode} from '../src/modes.js';
import type {RenderConfig} from '../src/renderer.js';
import {SceneRestorer} from '../src/scenes.js';
import {identityKey} from '../src/shared-input.js';
import {execute, rows, transaction, type Db, type SqlValue} from '../src/sqlite.js';
import {controlState} from '../src/store.js';
import type {LightAddress} from '../src/transport.js';
import {runWorker, type Sender, type WorkerOptions} from '../src/worker.js';
import {Feed, fixtureJson, temporary, write, type FeedChange} from './support.js';

/** SceneTest.setUp's configuration. */
export const SCENE: RenderConfig & {line_positions: number[][]} = {ip: '192.168.1.207', token: 'PRIVATE_TEST_TOKEN',
  line_groups: Array.from({length: 15}, (_, i) => [100 + i * 2, 101 + i * 2]), line_positions: Array.from({length: 15}, (_, i) => [i * 10, 0])};

/** The session key of a feed task. */
export const keyOf = (name: string): string =>
  identityKey({provider: 'codex', client: 'desktop', hostId: 'host', sourceId: 'source', sessionId: name});

/** A named error, as the Python tests' OSError and RuntimeError. */
export class NamedError extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

interface Timer {
  at: number;
  callback: () => void;
}

/**
 * The runtime's clock and scheduler, moved only by the test: now() is epoch milliseconds, starting at 1000 seconds.
 * The worker reads seconds as now() / 1000 and sleeps s seconds as after(s * 1000), so its instants match Python's
 * recorded ones exactly (record.MsClock).
 */
export class ManualClock {
  ms = 1_000_000;
  readonly timers = new Set<Timer>();
  readonly now = (): number => this.ms;
  readonly scheduler = {after: (delayMs: number, callback: () => void): (() => void) => {
    const timer = {at: this.ms + delayMs, callback};
    this.timers.add(timer);
    return () => { this.timers.delete(timer); };
  }};

  seconds(): number {
    return this.ms / 1000;
  }

  /** record.MsClock.sleep, for steps outside a worker run. */
  sleep(seconds: number): void {
    this.ms += seconds * 1000;
  }

  /** The earliest pending timer, removed. */
  next(): Timer | undefined {
    const timer = [...this.timers].sort((a, b) => a.at - b.at)[0];
    if (timer !== undefined) this.timers.delete(timer);
    return timer;
  }
}

/** The module's one database connection for a test, opened on the first call and closed when the test ends. */
export function moduleDatabase(context: TestContext, directory: string): () => Db {
  let db: Db | undefined;
  context.after(() => db?.close());
  return () => {
    db ??= connectState(directory);
    return db;
  };
}

/** Let every pending promise and immediate run, so the worker reaches its next timer or ends. */
export const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await new Promise(resolve => setImmediate(resolve));
};

export type Call = [number, string, string, unknown];

/** A request spec: method, endpoint and a key the body must have, each optional (record.SceneDevice.matches). */
export interface RequestSpec {
  method?: string;
  endpoint?: string;
  payload?: string;
}

const matches = (spec: RequestSpec, method: string, endpoint: string, payload: unknown): boolean =>
  (spec.method ?? method) === method && (spec.endpoint ?? endpoint) === endpoint
  && (spec.payload === undefined || (typeof payload === 'object' && payload !== null && spec.payload in payload));

/** test_scene_restore.Device: saved scenes, the playing selection and brightness, and every request with its time. */
export class SceneDevice {
  names = ['Beach Waves', 'Cotton Candy'];
  selected = 'Beach Waves';
  brightness = 43;
  on = true;
  calls: Call[] = [];
  /** A request to refuse once; any key may be left out. */
  fail: RequestSpec | null = null;
  loseSelectionReply = false;
  /** Each runs once, as a matching request reaches the device; Python's tests patched the request to do this. */
  hooks: {spec: RequestSpec; run: () => void}[] = [];

  constructor(readonly clock: {seconds(): number}) {}

  readonly request = (_address: LightAddress, method: string, endpoint = '', payload?: unknown): Promise<unknown> => {
    for (const hook of [...this.hooks]) {
      if (!matches(hook.spec, method, endpoint, payload)) continue;
      this.hooks = this.hooks.filter(item => item !== hook);
      hook.run();
    }
    this.calls.push([this.clock.seconds(), method, endpoint, payload === undefined ? null : structuredClone(payload)]);
    const fail = this.fail;
    if (fail !== null && matches(fail, method, endpoint, payload)) {
      this.fail = null;
      return Promise.reject(new NamedError('OSError', 'Device unavailable'));
    }
    const body = (payload ?? {}) as {brightness?: {value: number}; on?: {value: boolean}; select?: string; write?: {animType: string}};
    if (method === 'GET' && endpoint === '/effects') return Promise.resolve({select: this.selected, effectsList: [...this.names]});
    if (method === 'GET' && endpoint === '/state') return Promise.resolve({brightness: {value: this.brightness}, on: {value: this.on}});
    if (method === 'PUT' && endpoint === '/state') {
      if (body.brightness !== undefined) this.brightness = body.brightness.value;
      if (body.on !== undefined) this.on = body.on.value;
    } else if (method === 'PUT' && endpoint === '/effects') {
      if (body.select !== undefined) {
        assert.ok(this.names.includes(body.select));
        this.selected = body.select;
        if (this.loseSelectionReply) {
          this.loseSelectionReply = false;
          return Promise.reject(new NamedError('OSError', 'Response lost after selection succeeded'));
        }
      } else {
        this.selected = body.write?.animType === 'custom' ? '*Dynamic*' : '*Static*';
      }
    } else {
      throw new Error(`Unexpected request ${method} ${endpoint}.`);
    }
    return Promise.resolve(null);
  };
}

export type Outcome = {result: unknown} | {error: string; message: string} | {stopped: number};

export async function outcomeOf(call: () => unknown): Promise<Outcome> {
  try {
    return {result: (await call()) ?? null};
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return {error: error.name, message: error.message};
  }
}

export type Step = Json[];
interface RecordedCase {
  name: string;
  steps: Step[];
  outcomes: Outcome[];
  calls: Call[];
  sends: [unknown, number, boolean][];
  rows: Record<string, unknown[][]>;
  scene: unknown;
  device: {selected: string; brightness: number; on: boolean; names: string[]};
  clock: number;
}

const RECORDED = fixtureJson('recorded/worker.json') as {cases: RecordedCase[]};

const WORKER_ROWS: Record<string, string> = {
  sessions: 'id,turn,status,updated', activity: 'session,turn,status,started', task_info: 'session,project,manual_project,turn,started',
  slots: 'session,slot,device', comets: 'session,turn,queued,source,started,device', locate: 'line_id,started,device',
  map_pending: 'payload,device', map_settings: 'style,coverage,rotation,flip_x,flip_y,device', palette: 'role,color', meta: 'key,value',
  display_v3: 'snapshot,looping,rendered,device'};

/** JSON that may hold Python's infinite floats, which the recording keeps as text. */
const parseDisplay = (text: string): unknown => JSON.parse(text.replace(/(-?Infinity|NaN)/g, '"$1"'));

type Options = {scenes?: boolean; send?: 'capture' | 'fail' | 'failAfterFirst'};

/** record.WorkerCase: one scripted case on SceneTest's Lines and fake device, with shared input selected at 1000. */
export class WorkerCase {
  readonly directory: string;
  /** The module's one connection, as ModuleContext.database gives it. */
  readonly database: () => Db;
  readonly clock = new ManualClock();
  readonly device = new SceneDevice(this.clock);
  readonly feed = new Feed();
  readonly sends: [Indication[], number, boolean][] = [];
  /** Every outcome and scene list change the worker and steps reported, in order. */
  readonly reported: (ControlOutcome | ScenesChanged)[] = [];
  readonly report: Report = message => {
    this.reported.push(message);
  };
  /** The runtime's transactions, on the module's connection, with their messages collected. */
  readonly transact: Transact = work => transactWith(this.database(), this.report)(work);

  constructor(context: TestContext) {
    this.directory = temporary(context);
    const config = {...SCENE, metadata_path: join(this.directory, 'metadata.json'), title_index_path: join(this.directory, 'session_index.jsonl')};
    writeFileSync(join(this.directory, 'config.json'), JSON.stringify(config));
    writeFileSync(join(this.directory, 'layout.json'), JSON.stringify({line_groups: SCENE.line_groups, line_positions: SCENE.line_positions}));
    this.feed.select(this.directory, this.clock.seconds());
    this.database = moduleDatabase(context, this.directory);
  }

  query(sql: string, params: readonly SqlValue[] = []): SqlValue[][] {
    return write(this.directory, db => rows(db, sql, ...params).map(row => [...row]));
  }

  async apply(step: Step): Promise<unknown> {
    const [first, ...args] = step;
    const op = typeof first === 'string' ? first : '';
    const text = (index: number): string => {
      const value = args[index];
      if (typeof value !== 'string') throw new TypeError(`Step argument ${String(index)} is not text.`);
      return value;
    };
    switch (op) {
      case 'feed': return this.feed.publish(this.directory, text(0) as FeedChange, args.length > 1 ? text(1) : '', this.clock.seconds());
      case 'mode': {
        const db = this.database();
        transaction(db, () => commandMode(db, text(0), this.clock.seconds(), this.report, args.length > 1 ? text(1) : DEFAULT));
        return null;
      }
      case 'status': return withState(this.directory, db => modeStatus(db));
      case 'sleep':
        this.clock.sleep(Number(args[0]));
        return null;
      case 'sql':
      case 'query': {
        const result = this.query(text(0), (args[1] ?? []) as SqlValue[]);
        return op === 'query' ? result : null;
      }
      case 'device': {
        if (args[0] === 'clearCalls') this.device.calls = [];
        else if (args[0] === 'remove') this.device.names = this.device.names.filter(name => name !== args[1]);
        else if (args[0] === 'scene') [this.device.selected, this.device.brightness] = [text(1), Number(args[2])];
        else if (args[0] === 'fail') this.device.fail = args[1] as RequestSpec;
        else if (args[0] === 'selected') this.device.selected = text(1);
        else if (args[0] === 'names') this.device.names = [...args[1] as string[]];
        else throw new Error(`Unknown device step ${text(0)}.`);
        return null;
      }
      case 'selected': return this.device.selected;
      case 'countPuts': return this.device.calls.filter(call => call[1] === 'PUT').length;
      case 'scene': return this.scene();
      case 'takeover': {
        const manager = new SceneRestorer(this.directory, {...SCENE}, this.device.request);
        await manager.observe();
        await manager.send({...SCENE}, [['working', 1000], ...Array.from({length: 14}, () => null)], 1000, true);
        return null;
      }
      case 'cache':
        write(this.directory, db => {
          const snapshot = dashboard(db, {...SCENE}, this.clock.seconds());
          execute(db, 'INSERT INTO display_v3 (snapshot, looping, rendered) VALUES (?, 1, ?)', pyJson(snapshot), this.clock.seconds());
        });
        return null;
      case 'prepare':
        return write(this.directory, db => {
          pruneComets(db, this.clock.seconds(), controlState(db).mode);
          dashboard(db, {...SCENE}, this.clock.seconds());
          return currentComet(db, this.clock.seconds());
        });
      case 'edit':
        return write(this.directory, db => {
          switch (text(0)) {
            case 'settings': return edits.settings(db, {...SCENE}, args[1]);
            case 'assign': return edits.assign(db, {...SCENE}, args[1]);
            case 'locate': return edits.locate(db, {...SCENE}, args[1]);
            case 'projectColor': return edits.projectColor(db, args[1], args[2]);
            case 'taskProject': return edits.taskProject(db, {...SCENE}, keyOf(text(1)), args[2]);
            default: throw new Error(`Unknown edit ${text(0)}.`);
          }
        });
      case 'second': return runWorker({directory: this.directory, database: this.database, clock: this.clock, scheduler: this.clock.scheduler,
        signal: new AbortController().signal, request: this.device.request, transact: this.transact});
      case 'run': return this.run(Number(args[0]), (args[1] ?? []) as [number, Step][], (args[2] ?? {}) as Options);
      default: throw new Error(`Unknown step ${op}.`);
    }
  }

  /**
   * record.WorkerCase.run: the worker until `until` seconds, with scheduled steps taken at the first wake-up at or after
   * their time, as Python's sleep took them, and then the stop signal at the first wake-up at or after `until`.
   */
  async run(until: number, scheduled: readonly [number, Step][], options: Options = {}): Promise<{outcome: Outcome; scheduled: Outcome[]}> {
    const pending = [...scheduled];
    const results: Outcome[] = [];
    const controller = new AbortController();
    const send: Sender = (_config, snapshot, instant, loop) => {
      if (options.send === 'fail' || (options.send === 'failAfterFirst' && this.sends.length > 0)) throw new NamedError('RuntimeError', 'offline');
      this.sends.push([snapshot.map(item => (item === null ? null : [...item]) as Indication), instant, loop]);
      return undefined;
    };
    let settled = false;
    const running = outcomeOf(() => runWorker({directory: this.directory, database: this.database, clock: this.clock, scheduler: this.clock.scheduler,
      signal: controller.signal, request: this.device.request, scenes: options.scenes ?? true, transact: this.transact,
      ...(options.send === undefined ? {} : {send})})).finally(() => { settled = true; });
    for (;;) {
      await settle();
      if (settled) break;
      const timer = this.clock.next();
      if (timer === undefined) throw new Error('The worker neither waits nor ends.');
      this.clock.ms = timer.at;
      while (pending.length > 0 && this.clock.seconds() >= (pending[0]?.[0] ?? Infinity)) {
        const [, step] = pending.shift() ?? [0, []];
        results.push(await outcomeOf(() => this.apply(step)));
      }
      if (this.clock.seconds() >= until) controller.abort();
      timer.callback();
    }
    const outcome = await running;
    return {outcome: controller.signal.aborted && 'result' in outcome && outcome.result === true ? {stopped: this.clock.seconds()} : outcome,
      scheduled: results};
  }

  rows(): Record<string, unknown[][]> {
    const result: Record<string, unknown[][]> = {};
    for (const [table, columns] of Object.entries(WORKER_ROWS)) result[table] = this.query(`SELECT ${columns} FROM ${table} ORDER BY rowid`);
    result.map_pending = (result.map_pending ?? []).map(([payload, device]) => [JSON.parse(String(payload)) as unknown, device]);
    result.display_v3 = (result.display_v3 ?? []).map(([text, ...rest]) => [parseDisplay(String(text)), ...rest]);
    return result;
  }

  scene(): unknown {
    const path = join(this.directory, 'scene-state.json');
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as JsonObject : null;
  }
}

/**
 * Run a worker on `clock` until it ends or `until` seconds pass, then stop it; true when it was stopped or ended, false
 * when another instance held its device.
 */
export async function runUntil(context: TestContext,
  options: Omit<WorkerOptions, 'clock' | 'scheduler' | 'signal' | 'database' | 'transact'> & Partial<Pick<WorkerOptions, 'database' | 'transact'>>,
  clock: ManualClock, until: number): Promise<boolean> {
  const controller = new AbortController();
  let settled = false;
  const database = options.database ?? moduleDatabase(context, options.directory);
  // Without a transact of its own, the run's messages are dropped: these cases journal no command.
  const transact: Transact = options.transact ?? (work => transactWith(database(), () => {})(work));
  const running = runWorker({...options, database, transact, clock, scheduler: clock.scheduler, signal: controller.signal})
    .finally(() => { settled = true; });
  for (;;) {
    await settle();
    if (settled) return running;
    const timer = clock.next();
    if (timer === undefined) throw new Error('The worker neither waits nor ends.');
    clock.ms = timer.at;
    if (clock.seconds() >= until) controller.abort();
    timer.callback();
  }
}

export interface Replay {
  run: WorkerCase;
  outcomes: Outcome[];
  recorded: RecordedCase;
}

/** Replay a recorded worker case in the port and check it against Python: every outcome, request, send and row. */
export async function replay(context: TestContext, name: string): Promise<Replay> {
  const recorded = RECORDED.cases.find(item => item.name === name);
  assert.ok(recorded !== undefined, `No recorded worker case ${name}.`);
  const run = new WorkerCase(context);
  const outcomes: Outcome[] = [];
  for (const step of recorded.steps) outcomes.push(await outcomeOf(() => run.apply(step)));
  assert.deepEqual(outcomes, recorded.outcomes, `${name}: outcomes`);
  assert.deepEqual(run.device.calls, recorded.calls, `${name}: device requests`);
  assert.deepEqual(run.sends, recorded.sends, `${name}: sends`);
  assert.deepEqual(run.rows(), recorded.rows, `${name}: rows`);
  assert.deepEqual(run.scene(), recorded.scene, `${name}: scene file`);
  assert.deepEqual({selected: run.device.selected, brightness: run.device.brightness, on: run.device.on, names: run.device.names},
    recorded.device, `${name}: device`);
  assert.equal(run.clock.seconds(), recorded.clock, `${name}: clock`);
  return {run, outcomes, recorded};
}

/** The scheduled steps' outcomes of the recorded case's `index`th worker run. */
export function scheduledOf(result: Replay, index = 0): unknown[] {
  const runs = result.recorded.steps.flatMap((step, position) => (step[0] === 'run' ? [result.outcomes[position]] : []));
  const run = runs[index];
  assert.ok(run !== undefined && 'result' in run);
  return ((run.result as {scheduled: Outcome[]}).scheduled).map(item => ('result' in item ? item.result : item));
}

/** The `/effects` frame writes at or after `since`, decoded by panel. */
export function effects(calls: readonly Call[], since = 0): [number, Map<number, number[][]>][] {
  return calls.filter(([at, method, endpoint, payload]) => at >= since && method === 'PUT' && endpoint === '/effects'
    && typeof payload === 'object' && payload !== null && 'write' in payload)
    .map(([at, , , payload]) => [at, decodePayload(payload)]);
}

function decodePayload(payload: unknown): Map<number, number[][]> {
  const values = String((payload as {write: {animData: string}}).write.animData).split(/\s+/).filter(text => text !== '').map(Number);
  const panels = new Map<number, number[][]>();
  let offset = 1;
  for (let count = values[0] ?? 0; count > 0; count -= 1) {
    const [panel = 0, frames = 0] = values.slice(offset, offset + 2);
    offset += 2;
    panels.set(panel, Array.from({length: frames}, (_, i) => values.slice(offset + i * 5, offset + i * 5 + 5)));
    offset += frames * 5;
  }
  return panels;
}
