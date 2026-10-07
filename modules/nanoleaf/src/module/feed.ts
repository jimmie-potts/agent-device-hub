// The module's input (Hub #844): the core's `session/2.0` records, which the SDK's sync keeps current, projected onto the
// wall by the port's shared-input projection. The sync replaces the 1.x monitor feed: a sync that completes, the first or
// one after an overflow, is projected as a fresh start (resync), so nothing missed across a gap replays as a comet or a
// wave; each live change after it is projected as the next local revision, so the projection's own gap rules never fire.
// The module keeps the copy in memory and saves only the state it owns.
import type {SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {DEFAULT} from '../devices.js';
import {FeedError} from '../errors.js';
import type {Metadata} from '../project-map.js';
import {selected, SharedCopy, state, validateConfig, type Envelope, type SharedConfig, type SharedSession, type Source} from '../shared-input.js';
import {acceptEnvelope, configureSource, markFailed, selectShared} from '../shared-source.js';
import {transaction, type Db} from '../sqlite.js';

/** The core's owner ID, which eviction tokens name. */
export const CORE_OWNER = 'bunny-core';
/** The consumer the core records the wall's acknowledgments for: the module's own name, which its source ends in. */
export const CONSUMER = 'nanoleaf';

/** The shared-input configuration the module's section gives. */
export function sharedConfig(qualifiedSources: readonly Source[]): SharedConfig {
  return validateConfig({version: 1, ownerId: CORE_OWNER, consumerId: CONSUMER, clearOnNewTurn: true, qualifiedSources});
}

/** One `session/2.0` record as the projection reads a session; the derived observation age is not used. */
export function sharedSession(record: SessionRecord): SharedSession {
  return {
    identity: {...record.identity}, turn: record.turn, parent: record.parent,
    ...(record.label === undefined ? {} : {label: record.label.value, labelOrigin: record.label.origin}),
    ...(record.projectId === undefined ? {} : {projectId: record.projectId}), ...(record.project === undefined ? {} : {project: record.project}),
    ...(record.title === undefined ? {} : {title: record.title}),
    activity: record.activity, attention: record.attention, notices: record.notices, read: record.read,
    unavailable: record.unavailable.map(item => ({kind: 'evidence.unavailable', dimension: item.dimension, reason: item.reason})),
    ordering: record.ordering, lastEvidenceAtMs: record.lastEvidenceAtMs, observedAtMs: record.observedAtMs, observationAgeMs: 0,
    freshness: record.freshness, restartUncertain: record.restartUncertain, children: record.children, generation: record.generation,
  };
}

/**
 * The records as the projection's envelope, at the module's own `revision`. The sync is the owner's whole membership, so
 * `lossCount` and `admissionRejected` stay 0, and the collector runs while the copy follows the core.
 */
export function envelopeOf(records: Iterable<SessionRecord>, revision: number): Envelope {
  const sessions = [...records].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map(sharedSession);
  return {apiVersion: '2.0', ownerId: CORE_OWNER, connection: 'current', admissionRejected: 0, nextRequestId: 'sync',
    snapshot: {apiVersion: '2.0', revision, asOfMs: 0, collector: 'running', lossCount: 0, sessions}};
}

export type FeedOptions = {
  database: () => Db;
  /** Seconds since the epoch on the runtime's clock. */
  now: () => number;
  /** The registered devices, the Lines first; a completion queues a comet on each one in Work. */
  targets: readonly string[];
  metadata: Metadata | null;
};

/** What a projection did: selected shared input as a fresh start, followed a change, or was refused. */
export type Projected = 'selected' | 'followed' | 'stale-generation';

/**
 * The module's session feed: its in-memory copy of the core's sessions and the shared-input selection it projects them
 * through. `generation` is the selection's generation the feed last saw: a step that carries another one changes nothing.
 */
export class SessionFeed {
  readonly copy = new SharedCopy();
  /** The records the current sync copy holds, by entity ID. */
  readonly records = new Map<string, SessionRecord>();
  generation = 0;
  #revision = 0;
  readonly #options: FeedOptions;

  constructor(options: FeedOptions) {
    this.#options = options;
  }

  /**
   * Applies the section's shared-input configuration when it differs from the saved one. A new configuration pauses
   * shared input (#26 slice 3a): the next projection selects it again as a fresh start. True when it changed.
   */
  configure(config: SharedConfig): boolean {
    const db = this.#options.database();
    return transaction(db, () => {
      const saved = state(db);
      const changed = saved.config === null || JSON.stringify(saved.config) !== JSON.stringify(config);
      if (changed) configureSource(db, this.copy, config);
      this.generation = state(db).generation;
      return changed;
    });
  }

  /** A new sync copy starts from nothing: the records of the last one are gone with it. */
  restart(): void {
    this.records.clear();
  }

  /**
   * Projects the copy's records. Shared input not selected, at the first sync or after a new configuration, is selected
   * as a fresh start; otherwise the records are accepted, as a resync when a sync completed since the last projection.
   * A failure empties the copy, so the next projection is a fresh start. `onSelected` runs inside a selection's own
   * transaction, so what it records commits with the selection or not at all.
   */
  project(resync: boolean, onSelected: () => void = () => {}): Projected {
    const db = this.#options.database();
    const {now, targets, metadata} = this.#options;
    this.#revision = Math.max(this.#revision, this.copy.envelope?.snapshot.revision ?? 0) + 1;
    const envelope = envelopeOf(this.records.values(), this.#revision);
    try {
      return transaction(db, (): Projected => {
        if (!selected(db)) {
          selectShared(db, {copy: this.copy, envelope, instant: now(), targets, metadata, generation: this.generation});
          onSelected();
          this.generation = state(db).generation;
          return 'selected';
        }
        const accepted = acceptEnvelope(db, envelope, {copy: this.copy, instant: now(), resync, targets, metadata, generation: this.generation});
        return accepted ? 'followed' : 'stale-generation';
      });
    } catch (error) {
      this.copy.envelope = null;
      throw error;
    }
  }

  /** The copy stopped following the core: every task freezes steadily and queued comets go, until a sync completes. */
  failed(): void {
    const db = this.#options.database();
    transaction(db, () => { markFailed(db, this.copy, this.generation, 'feed-unavailable'); });
  }
}

/** Whether a projection failed only because a comet still runs, so the selection must wait for it to end. */
export const waitsForComet = (error: unknown): boolean => error instanceof FeedError && error.message === 'active-comet';

/** The Lines device, which animations, favorites and machine edits belong to. */
export const LINES = DEFAULT;
