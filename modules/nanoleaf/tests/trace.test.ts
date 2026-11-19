// Behavior the translated tests leave open, compared with Python on recorded inputs. recorded/trace.json holds three
// random sequences (selecting shared input, owner revisions, feed loss, Line placement, evictions, comets, modes,
// reservations and Codex metadata changes) and two scripted ones (comet queueing and cancellation; Line placement), run
// through the Python bridge on shared input only. After each step the port must return the same result and save the same
// rows in these tables: sessions, activity, task_info, slots, comets, waits, receipts, shared_stale,
// shared_suppressed_waves, shared_evictions, projects, line_prefs, map_settings, meta and display_v3, all in rowid order.
// It must also save the same shared_input source, generation, received, connection and error, and an envelope with the
// same hash. The palette, map_pending, locate and shared_ack tables, shared_input.config and the legacy task backup in
// shared_input.backup are not compared.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {dumps, sha256Hex, type JsonObject} from '../src/compat.js';
import {registeredDevices} from '../src/configuration.js';
import {withState} from '../src/database.js';
import type {DeviceConfig} from '../src/devices.js';
import {writeJson} from '../src/jsonfile.js';
import {dashboard} from '../src/line-projection.js';
import {decode, evict, evictionToken, identityKey, presented, state, visibleTasks, type Envelope, type PresentedTask, type StoredEnvelope,
  type StoredSession} from '../src/shared-input.js';
import {acceptEnvelope, markFailed, selectShared} from '../src/shared-source.js';
import {execute, rows, transaction, type SqlValue, type Synchronous} from '../src/sqlite.js';
import {markDirty} from '../src/store.js';
import {copyOf, FIXTURES, fixtureJson, hubEnvelope, hubSession, loadDump, metadataReader, suite, temporary, test, type Dump, type RecordEnvelope,
  type RecordSession} from './support.js';

const TABLES = ['sessions', 'activity', 'task_info', 'slots', 'comets', 'waits', 'receipts', 'shared_stale', 'shared_suppressed_waves',
  'shared_evictions', 'projects', 'line_prefs', 'map_settings', 'meta', 'display_v3'];

type CompactEnvelope = Omit<Envelope, 'snapshot'> & {snapshot: Omit<Envelope['snapshot'], 'sessions'> & {sessions: string[]}};
type Operation =
  | {op: 'select'; source: 'shared'; instant: number; envelope: CompactEnvelope}
  | {op: 'accept'; instant: number; resync: boolean; envelope: CompactEnvelope}
  | {op: 'failed'}
  | {op: 'dashboard'; device: string; instant: number}
  | {op: 'evict'; device: string; pick: number}
  | {op: 'sql'; sql: string; params: SqlValue[]}
  | {op: 'metadata'; files: Record<string, string>};

interface Trace {
  /** A random sequence's seed, or the name of a scripted one. */
  seed: number | string;
  constant: JsonObject;
  sessions: Record<string, JsonObject>;
  start: Dump;
  layouts: Record<string, DeviceConfig & {line_groups: number[][]}>;
  steps: {operation: Operation; result: unknown; changed: Record<string, unknown>}[];
}

/** A recorded envelope with its sessions in full, as the Python bridge read it. */
function recordedEnvelope(trace: Trace, compact: CompactEnvelope): RecordEnvelope {
  const sessions = compact.snapshot.sessions.map(key => {
    const session = trace.sessions[key];
    if (session === undefined) throw new Error(`Unknown recorded session ${key}.`);
    return {...structuredClone(session), ...structuredClone(trace.constant)} as unknown as RecordSession;
  });
  return {...structuredClone(compact), snapshot: {...structuredClone(compact.snapshot), sessions}};
}

/**
 * Each state directory's recorded sessions by identity key, as the last projected envelope gave them, so the copy, which
 * holds what the feed gives the projection (`hubSession`), is compared in the form Python saved it.
 */
const recordedSessions = new Map<string, Map<string, RecordSession>>();

/** A recorded envelope as the feed gives it, remembering its recorded sessions for the copy's comparison. */
function expand(directory: string, trace: Trace, compact: CompactEnvelope): Envelope {
  const recorded = recordedEnvelope(trace, compact);
  const known = recordedSessions.get(directory) ?? new Map<string, RecordSession>();
  recordedSessions.set(directory, known);
  for (const session of recorded.snapshot.sessions) known.set(identityKey(session.identity), session);
  return hubEnvelope(recorded);
}

/** The copy in the form Python saved its envelope: each session as recorded, which `hubSession` must give the copy's. */
function recordedCopy(directory: string, copied: StoredEnvelope): unknown {
  const known = recordedSessions.get(directory);
  const sessions = copied.snapshot.sessions.map(session => {
    const recorded = known?.get(identityKey(session.identity));
    if (recorded === undefined) throw new Error('The copy holds a session no envelope gave.');
    assert.deepEqual(session, decode(dumps(hubSession(recorded))), 'the copy holds the session as the feed gave it');
    return recorded;
  });
  return {...copied, snapshot: {...copied.snapshot, sessions}};
}

/** The saved rows record.py compares after each step. */
function savedState(directory: string): Record<string, unknown> {
  return withState(directory, db => {
    const saved: Record<string, unknown> = {};
    for (const table of TABLES) saved[table] = rows(db, `SELECT * FROM ${table} ORDER BY rowid`);
    const current = state(db);
    // Python saved the envelope; the port keeps it in the module's in-memory copy, whose text it compares (Hub #844).
    const copied = copyOf(directory).envelope;
    saved.shared_input = {source: current.source, generation: current.generation, received: current.received, connection: current.connection,
      error: current.error, envelope: copied === null ? null : sha256Hex(dumps(recordedCopy(directory, copied)))};
    return saved;
  });
}

/**
 * Design decision 10's rule for the Lines, restated apart from the port (Hub #1865): a member's attention, and otherwise
 * the root's hub status, give the status a task shows; the wall holds it steady only for the root's own unconfirmed work.
 */
function hubTask(members: readonly StoredSession[]): {status: string; steady: boolean} {
  const [root] = members;
  const owner = (details: readonly string[]): boolean => members.some(item => item.status.class === 'needs-owner' && details.includes(item.status.detail));
  const status = owner(['approval', 'input']) ? 'blocked' : owner(['question']) ? 'question' : root?.status.class === 'working' ? 'working'
    : root?.status.class === 'finished' ? 'unread' : 'idle';
  return {status, steady: status === 'working' && root?.work.state === 'active' && root.work.confidence === 'unconfirmed'};
}

/**
 * After a projection, every task's saved status and steady hold follow the hub's status of its members, and no other rule.
 * A recorded 1.x envelope whose collector does not run holds every task steady, as a lost copy does.
 */
function followsHubStatus(directory: string, label: string): void {
  const copied = copyOf(directory).envelope;
  assert.ok(copied !== null, label);
  const frozen = copied.snapshot.collector !== 'running';
  const tasks = new Map<string, {status: string; steady: boolean}>();
  for (const [key, [root, children, orphan]] of presented(copied.snapshot)) {
    const task = hubTask([root, ...children]);
    if (!orphan || task.status === 'blocked' || task.status === 'question') tasks.set(key, task);
  }
  withState(directory, db => {
    assert.deepEqual(Object.fromEntries(rows(db, 'SELECT id,status FROM sessions')),
      Object.fromEntries([...tasks].map(([key, task]) => [key, task.status])), `${label}: the hub's status`);
    assert.deepEqual(new Set(rows(db, 'SELECT session FROM shared_stale').map(([key]) => key)),
      new Set([...tasks].filter(([, task]) => frozen || task.steady).map(([key]) => key)), `${label}: held steady only for unconfirmed work`);
  });
}

function apply(directory: string, trace: Trace, operation: Operation): unknown {
  const write = <T>(body: (db: Parameters<typeof dashboard>[0]) => Synchronous<T>): T => withState(directory, db => transaction<T>(db, () => body(db)));
  try {
    switch (operation.op) {
      case 'select': {
        const metadata = metadataReader(directory);
        const value = expand(directory, trace, operation.envelope);
        write(db => selectShared(db, {copy: copyOf(directory), envelope: value, instant: operation.instant, targets: registeredDevices(directory), metadata}));
        return null;
      }
      case 'accept': {
        const metadata = metadataReader(directory);
        const value = expand(directory, trace, operation.envelope);
        return write(db => acceptEnvelope(db, value, {copy: copyOf(directory), instant: operation.instant, resync: operation.resync,
          targets: registeredDevices(directory), metadata}));
      }
      case 'failed':
        write(db => markFailed(db, copyOf(directory), state(db).generation));
        return null;
      case 'dashboard': {
        const layout = trace.layouts[operation.device];
        if (layout === undefined) throw new Error('Unknown layout.');
        return write(db => dashboard(db, layout, operation.instant));
      }
      case 'evict':
        return write(db => {
          const current = state(db);
          const copied = copyOf(directory).envelope;
          const visible = visibleTasks(db, operation.device).map(row => row[0]);
          const tasks = copied === null ? new Map<string, PresentedTask>() : presented(copied.snapshot);
          const candidates = visible.filter(key => tasks.has(key));
          if (candidates.length === 0) return 'none';
          const key = candidates[Math.floor(operation.pick * candidates.length)] ?? '';
          const root = tasks.get(key)?.[0];
          if (root === undefined) throw new Error('No task.');
          evict(db, copyOf(directory), operation.device, {id: key, evictionToken: evictionToken(current, root)});
          markDirty(db);
          return key;
        });
      case 'sql':
        write(db => execute(db, operation.sql, ...operation.params));
        return null;
      case 'metadata':
        for (const [name, text] of Object.entries(operation.files)) writeFileSync(join(directory, name), text);
        return null;
    }
  } catch (error) {
    if (error instanceof Error && (error.name === 'FeedError' || error.name === 'ValueError')) return {error: error.name, message: error.message};
    throw error;
  }
}

const traces = fixtureJson('recorded/trace.json') as Trace[];
const covered = new Set<string>();

/**
 * A step whose result or rows differ from Python's because the wall follows the hub's shared status (Hub #1865): Python
 * retained a task's earlier status while its evidence was silent and counted a notice a known later turn superseded. It
 * holds the port's result and the rows the step changed. `NANOLEAF_RECORD_HUB_STATUS=1` records them again from the
 * port, for the steps where it differs from Python, into recorded/trace-hub-status.json.
 */
type HubStatusStep = {seed: number | string; step: number; result: unknown; changed: Record<string, unknown>};
const HUB_STATUS = 'recorded/trace-hub-status.json';
const recording = process.env.NANOLEAF_RECORD_HUB_STATUS === '1';
const hubStatusSteps = recording ? [] : fixtureJson(HUB_STATUS) as HubStatusStep[];
const recorded: HubStatusStep[] = [];

suite('Python trace replay', () => {
  for (const trace of traces) {
    test(`seed ${trace.seed} saves the same rows as the Python bridge after every step, or the hub status's where it decides`, context => {
      const directory = temporary(context);
      writeJson(join(directory, 'config.json'), {ip: '192.0.2.1', token: 'fake', panelsToken: 'other',
        metadata_path: join(directory, 'metadata.json'), title_index_path: join(directory, 'session_index.jsonl'),
        devices: {panels: {kind: 'panels', ip: '192.0.2.2', token_ref: 'panelsToken'}}});
      loadDump(directory, trace.start);
      let previous = savedState(directory);
      trace.steps.forEach(({operation, result, changed}, index) => {
        const label = `seed ${trace.seed} step ${index} (${operation.op})`;
        const actual = apply(directory, trace, operation);
        if ((operation.op === 'select' && actual === null) || (operation.op === 'accept' && actual === true)) followsHubStatus(directory, label);
        const current = savedState(directory);
        const asPython = isDeepStrictEqual(actual, result)
          && Object.entries(current).every(([key, value]) => isDeepStrictEqual(value, Object.hasOwn(changed, key) ? changed[key] : previous[key]));
        const delta = Object.fromEntries(Object.entries(current).filter(([key, value]) => !isDeepStrictEqual(value, previous[key])));
        if (recording) {
          if (!asPython) recorded.push({seed: trace.seed, step: index, result: actual, changed: delta});
        } else {
          const hub = hubStatusSteps.find(item => item.seed === trace.seed && item.step === index);
          if (hub !== undefined) assert.equal(asPython, false, `${label}: the hub status step is still needed`);
          const expected = hub ?? {result, changed};
          assert.deepEqual(actual, expected.result, label);
          for (const [key, value] of Object.entries(current)) {
            assert.deepEqual(value, Object.hasOwn(expected.changed, key) ? expected.changed[key] : previous[key], `${label}: ${key}`);
          }
        }
        previous = current;
        if (typeof trace.seed === 'number') covered.add(operation.op);
      });
    });
  }

  test('the random traces cover every kind of step', () => {
    assert.deepEqual([...covered].sort(), ['accept', 'dashboard', 'evict', 'failed', 'metadata', 'select', 'sql']);
  });

  test('every hub status step names a recorded step', () => {
    if (recording) {
      writeFileSync(join(FIXTURES, HUB_STATUS), JSON.stringify(recorded) + '\n');
      return;
    }
    for (const {seed, step} of hubStatusSteps) assert.ok(traces.some(trace => trace.seed === seed && trace.steps[step] !== undefined), `${seed} ${step}`);
  });
});
