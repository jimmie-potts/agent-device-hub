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
import {dumps, sha256Hex, type JsonObject} from '../src/compat.js';
import {registeredDevices} from '../src/configuration.js';
import {withState} from '../src/database.js';
import type {DeviceConfig} from '../src/devices.js';
import {writeJson} from '../src/jsonfile.js';
import {dashboard} from '../src/line-projection.js';
import {evict, evictionToken, presented, state, visibleTasks, type Envelope, type PresentedTask, type SharedSession} from '../src/shared-input.js';
import {acceptEnvelope, markFailed, selectShared} from '../src/shared-source.js';
import {execute, rows, transaction, type SqlValue, type Synchronous} from '../src/sqlite.js';
import {markDirty} from '../src/store.js';
import {copyOf, fixtureJson, loadDump, metadataReader, suite, temporary, test, type Dump} from './support.js';

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

function expand(trace: Trace, compact: CompactEnvelope): Envelope {
  const sessions = compact.snapshot.sessions.map(key => {
    const session = trace.sessions[key];
    if (session === undefined) throw new Error(`Unknown recorded session ${key}.`);
    return {...structuredClone(session), ...structuredClone(trace.constant)} as unknown as SharedSession;
  });
  return {...structuredClone(compact), snapshot: {...structuredClone(compact.snapshot), sessions}};
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
      error: current.error, envelope: copied === null ? null : sha256Hex(dumps(copied))};
    return saved;
  });
}

function apply(directory: string, trace: Trace, operation: Operation): unknown {
  const write = <T>(body: (db: Parameters<typeof dashboard>[0]) => Synchronous<T>): T => withState(directory, db => transaction<T>(db, () => body(db)));
  try {
    switch (operation.op) {
      case 'select': {
        const metadata = metadataReader(directory);
        const value = expand(trace, operation.envelope);
        write(db => selectShared(db, {copy: copyOf(directory), envelope: value, instant: operation.instant, targets: registeredDevices(directory), metadata}));
        return null;
      }
      case 'accept': {
        const metadata = metadataReader(directory);
        const value = expand(trace, operation.envelope);
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

suite('Python trace replay', () => {
  for (const trace of traces) {
    test(`seed ${trace.seed} saves the same rows as the Python bridge after every step`, context => {
      const directory = temporary(context);
      writeJson(join(directory, 'config.json'), {ip: '192.0.2.1', token: 'fake', panelsToken: 'other',
        metadata_path: join(directory, 'metadata.json'), title_index_path: join(directory, 'session_index.jsonl'),
        devices: {panels: {kind: 'panels', ip: '192.0.2.2', token_ref: 'panelsToken'}}});
      loadDump(directory, trace.start);
      let previous = savedState(directory);
      trace.steps.forEach(({operation, result, changed}, index) => {
        const label = `seed ${trace.seed} step ${index} (${operation.op})`;
        assert.deepEqual(apply(directory, trace, operation), result, label);
        const current = savedState(directory);
        for (const [key, value] of Object.entries(current)) {
          assert.deepEqual(value, Object.hasOwn(changed, key) ? changed[key] : previous[key], `${label}: ${key}`);
        }
        previous = current;
        if (typeof trace.seed === 'number') covered.add(operation.op);
      });
    });
  }

  test('the random traces cover every kind of step', () => {
    assert.deepEqual([...covered].sort(), ['accept', 'dashboard', 'evict', 'failed', 'metadata', 'select', 'sql']);
  });
});
