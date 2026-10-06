// Choosing and following the task source: legacy input or the shared session state (shared_source.py).
// Each function runs inside the caller's immediate transaction. Fetching, polling, acknowledging notices
// to the owner and the command line are not ported; the runtime replaces them (PORTING.md).
import {dumps} from './compat.js';
import {FeedError} from './errors.js';
import type {Metadata} from './project-map.js';
import {checkEnvelope, projectEnvelope, restoreLegacyTasks, saveLegacyTasks, selected, state, validateConfig,
  type Envelope, type SharedConfig, type SharedState} from './shared-input.js';
import {execute, first, type Db} from './sqlite.js';
import {markDirty} from './store.js';

/** Save a validated configuration; it takes effect at the next selection of shared input. */
export function configureSource(db: Db, value: unknown): SharedConfig {
  const config = validateConfig(value);
  if (selected(db)) throw new FeedError('select-legacy-before-configure');
  if (first(db, 'SELECT 1 FROM shared_ack WHERE result IS NULL') !== undefined) throw new FeedError('acknowledgment-pending-use-explicit-retry');
  execute(db, "UPDATE shared_input SET config=?,generation=generation+1,envelope=NULL,received=NULL,connection='unavailable',error=NULL WHERE id=1",
    dumps(config));
  execute(db, 'DELETE FROM shared_ack');
  execute(db, 'DELETE FROM shared_evictions');
  return config;
}

/** The shared input state; refused until a configuration is saved. */
export function sourceConfig(db: Db): SharedState & {config: SharedConfig} {
  const value = state(db);
  if (value.config === null) throw new FeedError('not-configured');
  return {...value, config: value.config};
}

interface Observed {
  /** The generation the caller read before obtaining its envelope; a different one means another switch won. */
  generation?: number;
}

export type Selection = Observed & ({source: 'legacy'} | {
  source: 'shared';
  /** A validated snapshot envelope from the owner. */
  envelope: Envelope;
  instant: number;
  /** The registered devices, the original Lines device first; a completion queues a comet on each one in Work. */
  targets: readonly string[];
  metadata?: Metadata | null;
});

/** Switch the task source, keeping only explicitly bound tasks across the switch; repeating the current source does nothing. */
export function selectSource(db: Db, selection: Selection): void {
  const before = sourceConfig(db);
  if (before.source === selection.source) return;
  if (selection.source === 'shared') {
    checkEnvelope(selection.envelope, before.envelope?.snapshot.revision ?? 0);
    if (selection.envelope.snapshot.collector !== 'running') throw new FeedError('collector-unavailable');
    selection.metadata?.refresh();
  }
  if (selection.generation !== undefined && before.generation !== selection.generation) throw new FeedError('selection-changed');
  if (first(db, 'SELECT 1 FROM comets WHERE started IS NOT NULL LIMIT 1') !== undefined) throw new FeedError('active-comet');
  const config = before.config;
  if (selection.source === 'shared') {
    // Only explicitly bound local presentation continuity crosses over.
    saveLegacyTasks(db, config.bindings);
    execute(db, "UPDATE shared_input SET source='shared',generation=generation+1,envelope=NULL,connection='unavailable' WHERE id=1");
    execute(db, 'DELETE FROM shared_stale');
    projectEnvelope(db, selection.envelope, config, selection.instant,
      {resync: true, targets: selection.targets, metadata: selection.metadata ?? null});
  } else {
    restoreLegacyTasks(db, config.bindings);
    execute(db, 'DELETE FROM comets');
    execute(db, 'DELETE FROM receipts');
    execute(db, 'DELETE FROM shared_stale');
    execute(db, 'INSERT INTO shared_stale SELECT id FROM sessions');
    execute(db, "UPDATE shared_input SET source='legacy',generation=generation+1,connection='unavailable',error=NULL WHERE id=1");
  }
  execute(db, 'DELETE FROM shared_suppressed_waves');
  execute(db, 'DELETE FROM shared_evictions');
  // Switching the task source resets every device's comets and display cache.
  execute(db, 'DELETE FROM display_v3');
  markDirty(db);
}

export interface Acceptance extends Observed {
  instant: number;
  /** Treat the envelope as a fresh start: retained epochs survive, no wave or comet replays. */
  resync?: boolean;
  /** The registered devices, the original Lines device first. */
  targets: readonly string[];
  metadata?: Metadata | null;
}

/** Project a new envelope while shared input is selected; false when legacy input or another generation is current. */
export function acceptEnvelope(db: Db, envelope: Envelope, acceptance: Acceptance): boolean {
  acceptance.metadata?.refresh();
  const current = state(db);
  if (current.source !== 'shared' || (acceptance.generation !== undefined && current.generation !== acceptance.generation)) return false;
  if (current.config === null) throw new FeedError('not-configured');
  checkEnvelope(envelope, current.envelope?.snapshot.revision ?? 0);
  projectEnvelope(db, envelope, current.config, acceptance.instant,
    {resync: acceptance.resync ?? false, targets: acceptance.targets, metadata: acceptance.metadata ?? null});
  return true;
}

/** Record that the shared state is unavailable: every task freezes steadily and queued comets are dropped. */
export function markFailed(db: Db, generation: number, code = 'feed-unavailable'): void {
  const current = state(db);
  if (current.source !== 'shared' || current.generation !== generation) return;
  execute(db, 'UPDATE shared_input SET connection=?,error=? WHERE id=1', current.envelope === null ? 'unavailable' : 'stale', code);
  execute(db, 'INSERT OR IGNORE INTO shared_stale SELECT id FROM sessions');
  execute(db, 'DELETE FROM comets');
  markDirty(db);
}
