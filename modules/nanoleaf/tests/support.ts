// Shared helpers for the translated Nanoleaf suites: temporary state, recorded Python fixtures and the shared-input steps
// the Python tests drove through shared_source with a state directory.
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, test as nodeTest, type TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';
import {copyJson, isObject, sha256Hex, type Json, type JsonObject} from '../src/compat.js';
import {registeredDevices} from '../src/configuration.js';
import {withState} from '../src/database.js';
import {columns, DEFAULT, deviceOf, elements, type DeviceConfig} from '../src/devices.js';
import * as edits from '../src/edits.js';
import {readJson} from '../src/jsonfile.js';
import {setMode as commandMode} from '../src/modes.js';
import {fallbackTitle, Metadata, owners, palette, pending, settings, taskProjects, type MapSettings, type Patch, type Role} from '../src/project-map.js';
import {evictionToken, presented, selected, state, visibleTasks, type Envelope, type SharedConfig, type SharedSession, type SharedState,
  type Snapshot} from '../src/shared-input.js';
import {acceptEnvelope, configureSource, markFailed, selectShared as select, sourceConfig} from '../src/shared-source.js';
import {execute, rows, transaction, type Db, type Row, type SqlValue} from '../src/sqlite.js';
import {controlState, markDirty} from '../src/store.js';

/** node:test's test(), whose returned promise the runner awaits itself. */
export function test(name: string, body: (context: TestContext) => void | Promise<void>): void {
  void nodeTest(name, body);
}

export function suite(name: string, body: () => void): void {
  void describe(name, body);
}

/** The module's tests/fixtures directory, from the compiled test under dist/tests. */
export const FIXTURES = fileURLToPath(new URL('../../tests/fixtures/', import.meta.url));

export const fixtureJson = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as unknown;

/** A private temporary directory removed after the test. */
export function temporary(context: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), 'nanoleaf-'));
  context.after(() => rmSync(directory, {recursive: true, force: true}));
  return directory;
}

/** Every row of a query on the saved state, as Python's `rows(sql)` helpers read it. */
export const query = (directory: string, sql: string, ...params: readonly SqlValue[]): Row[] =>
  withState(directory, db => rows(db, sql, ...params));

/** Run `body` in one immediate transaction on the saved state. */
export const write = <T>(directory: string, body: (db: Db) => T): T => withState(directory, db => transaction(db, () => body(db)));

export interface TableDump {
  columns: string[];
  rows: SqlValue[][];
}
export type Dump = Record<string, TableDump>;

/** State the Python implementation saved in a test's setUp (recorded/setups.json). */
export function recordedSetup(name: string): Dump {
  const setups = fixtureJson('recorded/setups.json');
  if (!isObject(setups) || !isObject(setups[name])) throw new Error(`No recorded setup ${name}.`);
  return setups[name] as unknown as Dump;
}

/** Replace every table the port owns with the recorded rows; tables the port does not create are skipped. */
export function loadDump(directory: string, dump: Dump): void {
  write(directory, db => {
    for (const [table, value] of Object.entries(dump)) {
      if (columns(db, table).length === 0) continue;
      execute(db, `DELETE FROM "${table}"`);
      const names = value.columns.map(name => `"${name}"`).join(',');
      for (const row of value.rows) {
        execute(db, `INSERT INTO "${table}" (${names}) VALUES (${value.columns.map(() => '?').join(',')})`, ...row);
      }
    }
  });
}

/** The first case of the released agent-state corpus as a 1.1 snapshot with generations (test_shared_input.fixture). */
export function fixture(): Snapshot {
  const snapshot = copyJson(fixtureJson('snapshot-v1.json') as Json) as unknown as Snapshot;
  snapshot.apiVersion = '1.1';
  for (const session of snapshot.sessions) session.generation = 0;
  return snapshot;
}

export function envelope(snapshot: Snapshot = fixture()): Envelope {
  return {apiVersion: '1.0', ownerId: 'owner', connection: 'current', snapshot, admissionRejected: 0, nextRequestId: 'request-1'};
}

export const clone = <T>(value: T): T => structuredClone(value);

export function firstSession(value: Envelope): SharedSession {
  const session = value.snapshot.sessions[0];
  if (session === undefined) throw new Error('The envelope has no session.');
  return session;
}

/** shared_source.metadata_reader: the Codex metadata paths named in the configuration, read only. */
export function metadataReader(directory: string): Metadata {
  let config: unknown;
  try {
    config = readJson(join(directory, 'config.json'), true);
  } catch {
    config = {};
  }
  return new Metadata(isObject(config) ? config : {});
}

/** The shared configuration SelectionTest saves, without the legacy binding Python's had (PORTING.md). */
export function selectionConfig(directory: string): JsonObject {
  return {version: 1, ownerId: 'owner', consumerId: 'nanoleaf', endpoint: 'http://127.0.0.1:12345/api/monitor/v1',
    tokenFile: join(directory, 'token'), clearOnNewTurn: true,
    qualifiedSources: [{provider: 'codex', client: 'desktop', hostId: 'host', sourceId: 'source'}]};
}

export const configure = (directory: string, config: unknown): SharedConfig => write(directory, db => configureSource(db, config));

/** shared_source.select_source(directory, 'shared', fetch=...): the envelope stands in for a successful preflight. */
export function selectShared(directory: string, value: Envelope = envelope(), instant = 1000): void {
  const metadata = metadataReader(directory);
  write(directory, db => select(db, {envelope: value, instant, targets: registeredDevices(directory), metadata}));
}

export interface Accept {
  generation?: number;
  resync?: boolean;
}

/** shared_source.accept with a fresh metadata reader and the registered devices. */
export function accept(directory: string, value: Envelope, instant: number, options: Accept = {}): boolean {
  const metadata = metadataReader(directory);
  return write(directory, db => acceptEnvelope(db, value, {instant, targets: registeredDevices(directory), metadata, ...options}));
}

export const failed = (directory: string, generation: number): void => write(directory, db => markFailed(db, generation));

export const sharedState = (directory: string): SharedState => withState(directory, db => state(db));

export const generation = (directory: string): number => withState(directory, db => sourceConfig(db).generation);

/**
 * SelectionTest.setUp for shared input only: the local project recorded from Python, then the shared configuration.
 * Python's setUp also prompted a legacy task and bound it to the shared one; that is not ported (PORTING.md).
 */
export function selectionSetup(context: TestContext): {path: string; config: JsonObject} {
  const path = temporary(context);
  loadDump(path, recordedSetup('selection'));
  const config = selectionConfig(path);
  configure(path, config);
  return {path, config};
}

export const exists = existsSync;

export type FeedChange = 'prompt' | 'stop' | 'read' | 'question' | 'permission' | 'resolve' | 'interrupt' | 'end' | 'touch';

/**
 * The owner's shared sessions for scripted tests, all from the qualified Codex source (record.Feed). Each change publishes
 * the next revision and the caller accepts it. A completion adds a fresh notice and marks the session unread; read
 * evidence then stays until the next completion. `end` removes the session, as the owner does when it retires one.
 */
export class Feed {
  readonly sessions = new Map<string, SharedSession>();
  revision = 1;

  envelope(): Envelope {
    return {apiVersion: '1.0', ownerId: 'owner', connection: 'current', admissionRejected: 0, nextRequestId: `request-${String(this.revision)}`,
      snapshot: {apiVersion: '1.2', revision: this.revision, asOfMs: 1000, collector: 'running', lossCount: 0,
        sessions: [...this.sessions.values()].map(session => clone(session))}};
  }

  change(op: FeedChange, name = ''): void {
    let session = this.sessions.get(name);
    const known = (): SharedSession => {
      if (session === undefined) throw new Error(`No shared session ${name}.`);
      return session;
    };
    switch (op) {
      case 'prompt':
        if (session === undefined) {
          session = {identity: {provider: 'codex', client: 'desktop', hostId: 'host', sourceId: 'source', sessionId: name},
            turn: {status: 'known', id: 't1'}, parent: {status: 'unknown'}, activity: 'idle', attention: [], notices: [], read: 'unknown',
            unavailable: [], ordering: {status: 'unknown'}, lastEvidenceAtMs: 1000, observedAtMs: 1000, observationAgeMs: 0,
            freshness: 'current', restartUncertain: false, children: {active: 0, uncertain: 0}, generation: 0};
          this.sessions.set(name, session);
        } else {
          const turn = session.turn.status === 'known' ? Number(session.turn.id.slice(1)) : 0;
          session.turn = {status: 'known', id: `t${String(turn + 1)}`};
        }
        // Read evidence stays as it was until the next completion.
        Object.assign(session, {activity: 'active', attention: []});
        break;
      case 'stop': {
        const current = known();
        const id = sha256Hex(name + ':' + (current.turn.status === 'known' ? current.turn.id : ''));
        const notices = [...current.notices, {id, kind: 'turn-ended' as const, turn: clone(current.turn), acknowledgedBy: []}].slice(-3);
        Object.assign(current, {activity: 'idle', attention: [], notices, read: 'unread'});
        break;
      }
      case 'read': known().read = 'read'; break;
      case 'question':
      case 'permission': {
        const current = known();
        current.attention = [{id: {status: 'known', id: 'ask'}, kind: op === 'question' ? 'question' : 'approval', turn: clone(current.turn)}];
        break;
      }
      case 'resolve': known().attention = []; break;
      case 'interrupt': Object.assign(known(), {activity: 'interrupted', attention: []}); break;
      case 'end': this.sessions.delete(name); break;
      case 'touch': break;
    }
    this.revision += 1;
  }

  /** Change the feed and accept the owner's next revision at `instant`. */
  publish(directory: string, op: FeedChange, name: string, instant: number): boolean {
    this.change(op, name);
    return accept(directory, this.envelope(), instant);
  }

  /** Configure shared input and select it with the feed's current envelope (record.select_feed). */
  select(directory: string, instant: number): void {
    configure(directory, selectionConfig(directory));
    selectShared(directory, this.envelope(), instant);
  }
}

/** modes.set_mode: an explicit mode command for one device, without the worker launch. */
export const setMode = (directory: string, mode: string, instant = 1000, device: string = DEFAULT): boolean =>
  write(directory, db => commandMode(db, mode, instant, device));

/**
 * A new working task saved as rows, for tests whose subject is not task input. They are the rows Python's prompt hook event
 * saved (recorded/setups.json taskRow checks them).
 */
export function taskRow(db: Db, session: string, turn: string, instant: number): void {
  execute(db, 'INSERT INTO sessions VALUES (?, ?, ?, ?)', session, turn, 'working', instant);
  execute(db, 'INSERT INTO activity VALUES (?, ?, ?, ?)', session, turn, 'working', instant);
  execute(db, 'INSERT INTO task_info VALUES (?,?,?,?,?,?,?)', session, '', '', null, null, turn, instant);
  markDirty(db);
}

/**
 * A task's completion saved as rows, for tests whose subject is not task input: the task unread, its completion receipt, a
 * queued comet on each target device in Work, and its unread epoch. They are the rows Python's Stop hook event saved for
 * a working task with nothing waiting (recorded/setups.json completion checks them).
 */
export function completion(db: Db, session: string, turn: string, instant: number, targets: readonly string[] = [DEFAULT]): void {
  execute(db, 'INSERT OR REPLACE INTO receipts VALUES (?, ?, ?, 0)', session, turn, instant);
  execute(db, 'INSERT OR REPLACE INTO sessions VALUES (?, ?, ?, ?)', session, turn, 'unread', instant);
  for (const device of targets) {
    if (controlState(db, device).mode === 'work') {
      execute(db, 'INSERT OR IGNORE INTO comets (session, turn, queued, source, started, device) VALUES (?, ?, ?, NULL, NULL, ?)',
        session, turn, instant, device);
    }
  }
  execute(db, 'INSERT OR REPLACE INTO activity VALUES (?, ?, ?, ?)', session, turn, 'unread', instant);
  markDirty(db);
}

export interface WallTask {
  id: string;
  title: string;
  project: SqlValue;
  status: SqlValue;
  started: SqlValue;
  line: string | null;
  manual: SqlValue;
  evictionToken?: string;
  statusEvidence?: 'current' | 'uncertain';
}

export interface WallProject {
  id: SqlValue;
  name: SqlValue;
  color: SqlValue;
  assigned: number;
  active: number;
  waiting: number;
}

export interface WallView {
  tasks: WallTask[];
  projects: WallProject[];
  settings: MapSettings;
  palette: Record<Role, string>;
  mode: string;
  pending: Patch | null;
}

/**
 * The wall map's state (wall_server.App.state) read from the ported state: its tasks, projects, map settings, palette,
 * mode and pending wall edit. The wall pages and their view move with the Nanoleaf module (Hub #844); the translated
 * tests observe the projection through the same rows.
 */
export function wallView(directory: string, config: DeviceConfig, now: number): WallView {
  return withState(directory, db => transaction(db, () => {
    const shared = selected(db);
    if (!shared) {
      const metadata = new Metadata({});
      metadata.refresh();
      if (metadata.sync(db)) markDirty(db);
    }
    const device = deviceOf(config);
    const prefs = owners(db, config);
    const items = elements(config);
    const memberships = taskProjects(db);
    const slots = new Map(rows(db, 'SELECT session,slot FROM slots WHERE device=?', device).map(([session = null, slot = null]) => [session, slot]));
    const details = new Map(rows(db, 'SELECT session,title,cwd,manual_project,started FROM task_info').map(row => [row[0] ?? null, row]));
    let uncertain = new Set<SqlValue>();
    const tokens = new Map<string, string>();
    if (shared) {
      const current = state(db);
      if (current.envelope !== null) {
        for (const [key, [root]] of presented(current.envelope.snapshot)) tokens.set(key, evictionToken(current, root));
      }
      const received = current.received;
      const sessions = rows(db, current.connection !== 'current' || typeof received !== 'number' || now - received > 4
        ? 'SELECT id FROM sessions' : 'SELECT session FROM shared_stale');
      uncertain = new Set(sessions.map(row => row[0] ?? null));
    }
    const tasks = visibleTasks(db, device).map(([id, , status]): WallTask => {
      const [, title = '', , manual = null, started = null] = details.get(id) ?? [];
      const slot = slots.get(id);
      const element = typeof slot === 'number' && slot < prefs.length ? items[slot] : undefined;
      const task: WallTask = {id, title: typeof title === 'string' && title !== '' ? title : fallbackTitle('codex', id),
        project: memberships.get(id) ?? null, status, started, line: element?.id ?? null, manual};
      const token = tokens.get(id);
      if (token !== undefined) task.evictionToken = token;
      if (shared) task.statusEvidence = uncertain.has(id) ? 'uncertain' : 'current';
      return task;
    });
    const projects = rows(db, 'SELECT id,name,color FROM projects ORDER BY name COLLATE NOCASE').map(([id = null, name = null, color = null]) => {
      const members = tasks.filter(task => task.project === id);
      return {id, name, color, assigned: prefs.filter(owner => owner[0] === id).length, active: members.length,
        waiting: members.filter(task => task.line === null).length};
    });
    return {tasks, projects, settings: settings(db, device), palette: palette(db), mode: controlState(db, device).mode,
      pending: pending(db, device)};
  }, 'BEGIN'));
}

/** The wall's evict action on one device: edits.evict in its own transaction. */
export const evictTask = (directory: string, device: string, payload: unknown): void =>
  write(directory, db => edits.evict(db, {device}, payload));

/** test_bridge.decode: each panel's frames ([r, g, b, w, transition]) from a display payload's animData. */
export function decode(payload: {write: {animData: string}}): Map<number, number[][]> {
  // Python's int() of each token: anything but an optionally signed run of decimal digits fails.
  const values = payload.write.animData.split(/\s+/).filter(text => text !== '').map(token => {
    if (!/^[+-]?[0-9]+$/.test(token)) throw new Error(`animData token ${JSON.stringify(token)} is not an integer.`);
    return Number(token);
  });
  const panels = new Map<number, number[][]>();
  let offset = 1;
  for (let count = values[0] ?? 0; count > 0; count -= 1) {
    const [panel, frames] = values.slice(offset, offset + 2);
    if (panel === undefined || frames === undefined) throw new Error('Malformed animData.');
    offset += 2;
    panels.set(panel, Array.from({length: frames}, (_, i) => values.slice(offset + i * 5, offset + i * 5 + 5)));
    offset += frames * 5;
  }
  if (offset !== values.length) throw new Error('Malformed animData.');
  return panels;
}

/** One panel's frames from a decoded payload; a missing panel fails the test. */
export function framesOf(panels: ReadonlyMap<number, number[][]>, panel: number | undefined): number[][] {
  const frames = panel === undefined ? undefined : panels.get(panel);
  if (frames === undefined) throw new Error(`No frames for panel ${String(panel)}.`);
  return frames;
}

/** A light request that fails the test: nothing here may reach a device (test_devices.refuse). */
export const refuse = (): Promise<never> => Promise.reject(new Error('The device must not be contacted.'));

/** test_bridge.Clock: a test clock that starts at 1000 and only moves when slept. */
export class Clock {
  value = 1000.0;
  now = (): number => this.value;
  sleep = (seconds: number): void => {
    this.value += seconds;
  };
}

/** A copy of a list of rows as plain arrays, for comparing tuples with lists. */
export const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown;
