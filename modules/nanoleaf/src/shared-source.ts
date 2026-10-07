// Configuring and following the shared session state (shared_source.py). The port reads shared input only (owner
// decision, Hub #26, 2026-10-06), so legacy input and its task backup are not ported. Each function runs inside the
// caller's immediate transaction. Fetching, polling, acknowledging notices to the owner and the command line are not
// ported either; the runtime module replaces them with the SDK's session sync and the core's `notice-acknowledge`
// command (PORTING.md). The previous envelope lives in the module's in-memory `SharedCopy`, never in a saved row.
import {dumps} from './compat.js';
import {FeedError} from './errors.js';
import type {Metadata} from './project-map.js';
import {checkEnvelope, NOT_SELECTED, projectEnvelope, selected, state, validateConfig, type Envelope, type SharedConfig, type SharedCopy,
  type SharedState} from './shared-input.js';
import {execute, first, type Db} from './sqlite.js';
import {markDirty} from './store.js';

const activeComet = (db: Db): boolean => first(db, 'SELECT 1 FROM comets WHERE started IS NOT NULL LIMIT 1') !== undefined;

/**
 * Stop following the shared state until the next selection, as leaving shared input did, without the legacy task
 * restore: comets and completion receipts are dropped, every task is held stale, and evictions and display caches go.
 */
function pause(db: Db): void {
  if (activeComet(db)) throw new FeedError('active-comet');
  execute(db, 'DELETE FROM comets');
  execute(db, 'DELETE FROM receipts');
  execute(db, 'DELETE FROM shared_stale');
  execute(db, 'INSERT INTO shared_stale SELECT id FROM sessions');
  execute(db, "UPDATE shared_input SET source=?,generation=generation+1,connection='unavailable',error=NULL WHERE id=1", NOT_SELECTED);
  execute(db, 'DELETE FROM shared_suppressed_waves');
  execute(db, 'DELETE FROM shared_evictions');
  execute(db, 'DELETE FROM display_v3');
  markDirty(db);
}

/**
 * Save a validated configuration; it takes effect at the next selection of shared input. While shared input is
 * selected, it is paused first, as Python's only route to a new configuration (legacy input, then configure) did, and
 * the caller selects it again to resume. The copy of the core's sessions empties, as Python's saved envelope did.
 */
export function configureSource(db: Db, copy: SharedCopy, value: unknown): SharedConfig {
  const config = validateConfig(value);
  if (first(db, 'SELECT 1 FROM shared_ack WHERE result IS NULL') !== undefined) throw new FeedError('acknowledgment-pending-use-explicit-retry');
  if (selected(db)) pause(db);
  execute(db, "UPDATE shared_input SET config=?,generation=generation+1,envelope=NULL,received=NULL,connection='unavailable',error=NULL WHERE id=1",
    dumps(config));
  execute(db, 'DELETE FROM shared_ack');
  execute(db, 'DELETE FROM shared_evictions');
  copy.envelope = null;
  return config;
}

/** The shared input state; refused until a configuration is saved. */
export function sourceConfig(db: Db): SharedState & {config: SharedConfig} {
  const value = state(db);
  if (value.config === null) throw new FeedError('not-configured');
  return {...value, config: value.config};
}

interface Observed {
  /** The generation the caller read before obtaining its envelope; a different one means another change won. */
  generation?: number;
}

export interface Selection extends Observed {
  /** The module's in-memory copy of the core's sessions. */
  copy: SharedCopy;
  /** A validated snapshot envelope from the owner. */
  envelope: Envelope;
  instant: number;
  /** The registered devices, the original Lines device first; a completion queues a comet on each one in Work. */
  targets: readonly string[];
  metadata?: Metadata | null;
}

/**
 * Start following the shared state: project the envelope as a fresh start, in which retained epochs survive and no
 * wave or comet replays. Selecting it again while it is selected does nothing.
 */
export function selectShared(db: Db, selection: Selection): void {
  const before = sourceConfig(db);
  if (before.source === 'shared') return;
  const {copy} = selection;
  checkEnvelope(selection.envelope, copy.envelope?.snapshot.revision ?? 0);
  if (selection.envelope.snapshot.collector !== 'running') throw new FeedError('collector-unavailable');
  selection.metadata?.refresh();
  if (selection.generation !== undefined && before.generation !== selection.generation) throw new FeedError('selection-changed');
  if (activeComet(db)) throw new FeedError('active-comet');
  execute(db, "UPDATE shared_input SET source='shared',generation=generation+1,envelope=NULL,connection='unavailable' WHERE id=1");
  copy.envelope = null;
  // The stale delete and `resync: true` follow Python's statements, whose order the trace replay compares, but cannot
  // change the outcome: with no previous envelope and an unavailable connection the projection resyncs anyway, and it
  // clears or forgets every stale task.
  execute(db, 'DELETE FROM shared_stale');
  projectEnvelope(db, copy, selection.envelope, before.config, selection.instant,
    {resync: true, targets: selection.targets, metadata: selection.metadata ?? null});
  execute(db, 'DELETE FROM shared_suppressed_waves');
  execute(db, 'DELETE FROM shared_evictions');
  // Selecting the shared state resets every device's comets and display cache.
  execute(db, 'DELETE FROM display_v3');
  markDirty(db);
}

export interface Acceptance extends Observed {
  /** The module's in-memory copy of the core's sessions. */
  copy: SharedCopy;
  instant: number;
  /** Treat the envelope as a fresh start: retained epochs survive, no wave or comet replays. */
  resync?: boolean;
  /** The registered devices, the original Lines device first. */
  targets: readonly string[];
  metadata?: Metadata | null;
}

/** Project a new envelope while shared input is selected; false when it is not, or another generation is current. */
export function acceptEnvelope(db: Db, envelope: Envelope, acceptance: Acceptance): boolean {
  acceptance.metadata?.refresh();
  const current = state(db);
  if (current.source !== 'shared' || (acceptance.generation !== undefined && current.generation !== acceptance.generation)) return false;
  if (current.config === null) throw new FeedError('not-configured');
  checkEnvelope(envelope, acceptance.copy.envelope?.snapshot.revision ?? 0);
  projectEnvelope(db, acceptance.copy, envelope, current.config, acceptance.instant,
    {resync: acceptance.resync ?? false, targets: acceptance.targets, metadata: acceptance.metadata ?? null});
  return true;
}

/**
 * Record that the shared state is unavailable: every task freezes steadily and queued comets are dropped. A report
 * carrying the generation from before a new configuration or selection changes nothing.
 */
export function markFailed(db: Db, copy: SharedCopy, generation: number, code = 'feed-unavailable'): void {
  const current = state(db);
  if (current.source !== 'shared' || current.generation !== generation) return;
  execute(db, 'UPDATE shared_input SET connection=?,error=? WHERE id=1', copy.envelope === null ? 'unavailable' : 'stale', code);
  execute(db, 'INSERT OR IGNORE INTO shared_stale SELECT id FROM sessions');
  execute(db, 'DELETE FROM comets');
  markDirty(db);
}
