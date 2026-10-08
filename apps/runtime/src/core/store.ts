// The core's store (Hub #831): agent-state's storage adapter, with the core's outbox, history and published records in
// the same SQLite file, so each change and the messages it publishes commit in one transaction (ADR 0012, "Ownership and
// publication").
//
// Provenance: the lease, `load` and `commit` are copied from the old Hub's adapter, apps/hub/src/storage.ts, at main
// 9f3d60f, which keeps running on it until #839. They keep its format: the durable 2.1 state as one JSON row in the table
// `state`, checked by agent-state's `validateExport` on every load and commit, under a compare-and-swap on the revision,
// and the lease as an exclusive transaction held open on a separate lock database. What differs:
// - The store lives in the core module's own database, `modules/core.sqlite`, not a directory of its own, and its lock
//   database sits beside it as `core.sqlite-owner`, with no rollback journal, so taking the lock writes nothing. A second
//   holder, in another process or this one, is waited for until agent-state's deadline instead of refused at once, so a
//   runtime that restarts in the same process takes over. The runtime opens the store's file with exclusive locking
//   (Hub #972), so a second runtime's core is refused when it opens the file, before it reaches the lease.
// - The lock lasts from the first lease until the core stops, not one lease: an owner opened again after a failed
//   commit takes a new lease on the store it never let go of.
// - The Hub's fence and automation tables are the old Hub's own and are not copied.
// - Each commit also derives the 2.0 messages it publishes and writes them, the published records, the history rows and
//   the (source, id) of the intake it took, in the commit's own transaction, through the SDK's outbox.
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {DatabaseSync, type StatementSync} from 'node:sqlite';
import {validateExport, type Commit, type DurableState, type Session, type Storage, type StorageLease} from '@jimmie-potts/agent-state';
import {MessageValidator, compareDelivery, errorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import {
  registerCoreFamilies, type AgentOccurrence, type Attention, type AttentionCleared, type AttentionRaised, type KnownId, type LifecycleObservation,
  type SessionRecord, type TurnEnded,
} from '@jimmie-potts/event-contracts/v2/families';
import {Outbox, SdkError, type AddMessage, type Clock, type Draft, type Logger, type OutboxOptions, type Sdk, type SpanRecorder} from '@jimmie-potts/sdk';
import {
  REMOVAL_SCHEMA, SESSION_SCHEMA, attentionAdded, changed, entityOf, project, turnsUncertainAt,
} from './mapping.js';

/**
 * What the core is doing when a change commits: a hook's observation, whose occurrences, `(source, id)` and trace the
 * change it causes takes, or a command, such as an acknowledgment, whose trace the change joins.
 */
export type Cause = {
  readonly message: Message<unknown>;
  /** The journal kind of the change it causes, such as `turn.ended` or `notice.acknowledged`. */
  readonly kind: string;
  /** Its session's entity ID. */
  readonly entity: string;
  /** The hook's observation, when a lifecycle observation causes the change. */
  readonly observation?: LifecycleObservation;
};

/** One committed change of the core: the revision it carries and the messages it publishes, in order. */
export type CoreChange = {readonly revision: number; readonly messages: readonly Message[]};

/** A part's view of one core transaction (Hub #782's tracker and history, #923's inbox). */
export interface CoreTransaction {
  /** The core store's database, inside the transaction. A part writes only its own tables. */
  readonly database: DatabaseSync;
  /** The transaction's instant, which every message it adds carries as its `time`. */
  readonly atMs: number;
  /** The revision this transaction's changes carry: the core's next revision, the same for every call. */
  revision(): number;
  /** Stores a message in the core's outbox, in this transaction. It goes out after the commit, in order. */
  readonly add: AddMessage;
  /** Records `message` as taken by its `(source, id)`, kept for `keepForMs` or for good, so a later copy is a duplicate. */
  take(message: Message<unknown>, keepForMs?: number): void;
  /** Keeps `message` in the core's history. */
  history(message: Message<unknown>): void;
}

/** Rows a part derives from a committed core change, in the change's own transaction. */
export type Deriver = (change: CoreChange, tx: CoreTransaction) => void;

export type StoreOptions = {
  /** The core module's own database. */
  database: DatabaseSync;
  /** The core's participant: the outbox publishes with `publishMessage`, so a message keeps its stored `id` and `time`. */
  sdk: Pick<Sdk, 'source' | 'publishMessage'>;
  clock: Clock;
  /**
   * The core's logger and tracing, which its outbox records with (Hub #949): a refused publish, committed and awaiting
   * publication, as `outbox.deferred`, once per run of refusals.
   */
  log?: Logger;
  trace?: SpanRecorder;
  /** Without a logger, hears that a publish was refused after its commit: committed, and awaiting publication. */
  onError?: OutboxOptions['onError'];
  /** Parts' derivers, run in each core change's transaction. */
  derivers?: readonly Deriver[];
  /** Parts' tables, created once the lease is held. */
  open?: readonly ((database: DatabaseSync) => void)[];
  /** Runs right after each commit that has messages to publish, before any goes out. A crash test kills the process here. */
  beforePublish?: () => void;
};

/** Why the last commit failed: the disk was full, or something else. */
export type StoreFailure = 'full' | 'failed';

/** The core's revision of a family's records, the same counter for every family it serves. */
type Plan = {
  durable: DurableState | undefined;
  revision: number | undefined;
  records: SessionRecord[];
  removed: string[];
  restarted: Set<string>;
  hostSessions: Map<string, string>;
  messages: {key: string; draft: Draft<object>; history: boolean}[];
  cause: Cause | undefined;
};

const ID = /^[A-Za-z0-9_.-]{1,128}$/;
const MAX_STATE_BYTES = 16 * 1024 * 1024;
const JOURNAL_ROWS = 10_000;
// SQLite's result codes, from a node:sqlite error's `errcode`.
const SQLITE_BUSY = 5;
const SQLITE_FULL = 13;
const LEASE_POLL_MS = 20;
const errcode = (error: unknown): number | undefined =>
  typeof error === 'object' && error !== null && 'errcode' in error && typeof error.errcode === 'number' ? error.errcode : undefined;
const sameTurn = (a: KnownId, b: KnownId): boolean => a.status === 'known' && b.status === 'known' && a.id === b.id;
const occurrenceKey = (family: string, entity: string): string => `bunny.event.${family}.${entity}`;
const sessionKey = (entity: string): string => `bunny.state.session.${entity}`;
const identityKey = (session: Pick<Session, 'identity'>): string => {
  const {provider, client, hostId, sourceId, sessionId} = session.identity;
  return JSON.stringify([provider, client, hostId, sourceId, sessionId]);
};

/** The durable state after `change`, applied to the last committed state as the Hub's adapter applies it. */
function apply(prior: DurableState | undefined, change: Commit, ownerId: string): DurableState {
  if ((prior?.revision ?? null) !== change.expectedRevision) throw new Error('revision-conflict');
  let next: DurableState;
  if (change.replace !== undefined) next = structuredClone(change.replace);
  else {
    if (prior === undefined) throw new Error('missing-state');
    next = structuredClone(prior);
    const {session, journal} = change;
    if (session !== undefined) {
      const index = next.sessions.findIndex(item => identityKey(item) === identityKey(session));
      if (index < 0) next.sessions.push(structuredClone(session));
      else next.sessions[index] = structuredClone(session);
    }
    if (journal !== undefined) next.journal.push(structuredClone(journal));
    next.revision = change.revision;
    next.lastCommitAtMs = change.atMs;
  }
  next.journal = next.journal.filter(row => row.atMs > change.pruneBeforeMs).slice(-JOURNAL_ROWS);
  const checked = validateExport(next);
  if (!checked.ok || next.ownerId !== ownerId || next.revision !== change.revision) throw new Error('invalid-state');
  return next;
}

export class CoreStore implements Storage {
  readonly #db: DatabaseSync;
  readonly #options: StoreOptions;
  readonly #validator = new MessageValidator();
  #opened: {outbox: Outbox; statements: Statements} | undefined;
  #leased = false;
  /** The store's lock, held from the first lease until `close`. */
  #lock: Lock | undefined;
  /** The owner's current lease, if any. */
  #lease: {released: boolean} | undefined;
  /** The last committed agent-state, as the lease loaded and committed it. */
  #durable: DurableState | undefined;
  /** The published session records, by entity ID. */
  #records = new Map<string, SessionRecord>();
  #revision = 0;
  /** How many transactions the store has committed: a transaction that did not commit leaves it unchanged. */
  #commits = 0;
  /** Sessions loaded at the core's start that have had no fresh lifecycle evidence since: restart uncertainty. */
  #restarted = new Set<string>();
  #loaded = false;
  /** Each root session's latest host session ID, kept with its record. */
  #hostSessions = new Map<string, string>();
  #cause: Cause | undefined;
  /** The instant every message of the transaction under way is stamped with. */
  #frozen: number | undefined;
  #failure: StoreFailure | undefined;
  /** Publications still going out, so a stop can let them finish. */
  readonly #sending = new Set<Promise<unknown>>();

  constructor(options: StoreOptions) {
    this.#db = options.database;
    this.#options = options;
    registerCoreFamilies(this.#validator);
  }

  /** The core's current revision: every record it serves carries this one or an earlier one. */
  get revision(): number {
    return this.#revision;
  }

  /** The published session records. */
  records(): SessionRecord[] {
    return [...this.#records.values()];
  }

  /** Whether the store is open, so parts may use it. */
  get open(): boolean {
    return this.#opened !== undefined;
  }

  /** How a message with this `(source, id)` was taken before: `new`, an exact `duplicate`, or a `conflict`. */
  received(message: Message<unknown>): ReturnType<typeof compareDelivery> {
    const row = this.#statements().taken.get(message.source, message.id) as {message: string} | undefined;
    return compareDelivery(row === undefined ? undefined : JSON.parse(row.message) as Message<unknown>, message);
  }

  /** Why the last commit failed, once; undefined when none has since this was last asked. */
  takeFailure(): StoreFailure | undefined {
    const failure = this.#failure;
    this.#failure = undefined;
    return failure;
  }

  /** Runs `work`, during which the change `cause` makes commits as its answer: in its trace, with its occurrences. */
  async during<T>(cause: Cause, work: () => Promise<T>): Promise<T> {
    this.#cause = cause;
    try {
      return await work();
    } finally {
      this.#cause = undefined;
    }
  }

  /** The next instant a current record turns uncertain, or undefined when none will. */
  nextTurn(): number | undefined {
    const instants = [...this.#records.values()].flatMap(record => turnsUncertainAt(record) ?? []);
    return instants.length === 0 ? undefined : Math.min(...instants);
  }

  /**
   * Publishes each record whose freshness or children changed by now, at a new revision, in one core transaction. Owners
   * compute freshness at each message's envelope time and raise the revision first when it changed (MAPPING.md). True
   * when it published.
   */
  async refresh(): Promise<boolean> {
    if (this.#durable === undefined) return false;
    const atMs = this.#options.clock.now();
    const plan = this.#plan(undefined, atMs);
    if (plan.revision === undefined) return false;
    await this.#commit(plan, atMs, () => {});
    return true;
  }

  /** Runs a part's `work` in one core transaction; its messages go out after the commit. */
  async transaction<R>(work: (tx: CoreTransaction) => R): Promise<R> {
    const atMs = this.#options.clock.now();
    let result: R | undefined;
    const plan: Plan = {
      durable: undefined, revision: undefined, records: [], removed: [], restarted: this.#restarted, hostSessions: this.#hostSessions, messages: [], cause: undefined,
    };
    await this.#commit(plan, atMs, tx => { result = work(tx); });
    return result as R;
  }

  /** Publishes, in order, what a crash kept from going out. Rejects while the store is not open, as on a full disk. */
  republish(): Promise<number> {
    try {
      return this.#outbox().republish();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /** Waits for every publication under way. */
  async drain(): Promise<void> {
    while (this.#sending.size > 0) await Promise.allSettled([...this.#sending]);
  }

  /**
   * Gives agent-state's owner a lease on the store. The store takes its lock on the first one and keeps it until
   * `close`, so the core can open its owner again after a failed commit without letting go of the store, and without
   * writing anything: another runtime waiting for the lock never gets it while this core runs. Every lease reloads the
   * store's revision, commit count and records from the file, and the store's tables are written only once the file is
   * known to be this owner's or empty.
   */
  async acquire(ownerId: string, signal: AbortSignal): Promise<StorageLease> {
    if (!ID.test(ownerId)) throw new Error('storage-unavailable');
    // One lease at a time: an attempt still under way, or a lease not yet released, is waited for.
    while (this.#leased) {
      signal.throwIfAborted();
      await wait(LEASE_POLL_MS);
    }
    signal.throwIfAborted();
    this.#leased = true;
    this.#failure = undefined;
    try {
      this.#lock ??= await takeLock(this.#db.location(), signal);
      this.#checkOwner(ownerId);
      this.#openTables();
      this.#loadCaches();
    } catch (error) {
      this.#leased = false;
      // A store that cannot create its tables on a full disk, as at a first start, is full, not broken (Hub #972).
      if (errcode(error) === SQLITE_FULL) this.#failure = 'full';
      throw new Error('storage-unavailable', {cause: error});
    }
    const lease = {released: false};
    this.#lease = lease;
    const check = (abort?: AbortSignal): void => {
      abort?.throwIfAborted();
      if (lease.released) throw new Error('store-released');
    };
    return {
      load: abort => {
        check(abort);
        return Promise.resolve(this.#load(ownerId));
      },
      commit: async (change, abort) => {
        check(abort);
        await this.#commitChange(change, ownerId);
      },
      release: () => {
        this.#endLease(lease);
        return Promise.resolve();
      },
    };
  }

  /**
   * Ends the owner's lease without letting go of the store, as after a faulted owner whose own release did not finish,
   * so a new owner can take the next lease.
   */
  abandonLease(): void {
    if (this.#lease !== undefined) this.#endLease(this.#lease);
  }

  /** Lets go of the store's lock once the core stops. */
  close(): void {
    this.abandonLease();
    this.#lock?.release();
    this.#lock = undefined;
  }

  #endLease(lease: {released: boolean}): void {
    if (lease.released) return;
    lease.released = true;
    if (this.#lease === lease) this.#lease = undefined;
    this.#leased = false;
  }

  /** Refuses a file that holds another owner's state before anything is written to it. */
  #checkOwner(ownerId: string): void {
    const table = this.#db.prepare('SELECT 1 FROM sqlite_master WHERE type = \'table\' AND name = \'state\'').get();
    if (table === undefined) return;
    const row = this.#db.prepare('SELECT payload FROM state WHERE id = 1').get() as {payload: unknown} | undefined;
    if (row === undefined) return;
    let stored: unknown;
    try {
      stored = typeof row.payload === 'string' ? JSON.parse(row.payload) : undefined;
    } catch {
      stored = undefined;
    }
    const owner = typeof stored === 'object' && stored !== null && 'ownerId' in stored ? stored.ownerId : undefined;
    if (owner !== ownerId) throw new Error('invalid-store');
  }

  #openTables(): void {
    if (this.#opened !== undefined) return;
    const db = this.#db;
    db.exec(`PRAGMA busy_timeout = 0;
      CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS core_revision (only INTEGER PRIMARY KEY CHECK (only = 1), value INTEGER NOT NULL, commits INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS core_records (family TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, record TEXT NOT NULL,
        PRIMARY KEY (family, id)) STRICT;
      CREATE TABLE IF NOT EXISTS core_history (seq INTEGER PRIMARY KEY AUTOINCREMENT, revision INTEGER NOT NULL, at_ms INTEGER NOT NULL,
        message_id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, type TEXT NOT NULL, subject TEXT NOT NULL, message TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS core_taken (source TEXT NOT NULL, id TEXT NOT NULL, message TEXT NOT NULL, expires_at_ms INTEGER,
        PRIMARY KEY (source, id)) STRICT;
      CREATE INDEX IF NOT EXISTS core_taken_expiry ON core_taken (expires_at_ms) WHERE expires_at_ms IS NOT NULL`);
    for (const open of this.#options.open ?? []) open(db);
    const statements = prepare(db);
    const outbox = new Outbox({
      sdk: this.#options.sdk, database: db,
      ...(this.#options.log === undefined ? {} : {log: this.#options.log}),
      ...(this.#options.trace === undefined ? {} : {trace: this.#options.trace}),
      ...(this.#options.onError === undefined ? {} : {onError: this.#options.onError}),
      // Every message of one transaction carries the instant its freshness was computed at.
      clock: {now: () => this.#frozen ?? this.#options.clock.now()},
    });
    this.#opened = {outbox, statements};
  }

  /** The revision, commit count and published records as the file holds them. */
  #loadCaches(): void {
    const statements = this.#statements();
    const stored = statements.revision.get() as {value: number; commits: number} | undefined;
    this.#revision = stored?.value ?? 0;
    this.#commits = stored?.commits ?? 0;
    this.#records = new Map();
    this.#hostSessions = new Map();
    for (const row of statements.records.all() as {record: string}[]) {
      const record = JSON.parse(row.record) as SessionRecord;
      this.#records.set(record.id, record);
      if (record.hostSessionId !== undefined) this.#hostSessions.set(record.id, record.hostSessionId);
    }
  }

  #statements(): Statements {
    if (this.#opened === undefined) throw new SdkError(errorBody('unavailable', {detail: 'the core store is not open'}));
    return this.#opened.statements;
  }

  #outbox(): Outbox {
    if (this.#opened === undefined) throw new SdkError(errorBody('unavailable', {detail: 'the core store is not open'}));
    return this.#opened.outbox;
  }

  #load(ownerId: string): DurableState | null {
    const row = this.#statements().state.get() as {payload: unknown} | undefined;
    let loaded: DurableState | undefined;
    if (row !== undefined) {
      if (typeof row.payload !== 'string' || Buffer.byteLength(row.payload) > MAX_STATE_BYTES) throw new Error('invalid-state');
      const checked = validateExport(JSON.parse(row.payload));
      if (!checked.ok || checked.value.ownerId !== ownerId) throw new Error('invalid-state');
      loaded = structuredClone(checked.value);
    }
    this.#durable = loaded;
    // The first load is the core's start: every stored session is uncertain until fresh evidence, as agent-state's
    // snapshots say after a restart. Reopening the owner later, after a failed commit, is no restart.
    if (!this.#loaded) {
      this.#loaded = true;
      this.#restarted = new Set((loaded?.sessions ?? []).map(entityOf));
    }
    return loaded === undefined ? null : structuredClone(loaded);
  }

  async #commitChange(change: Commit, ownerId: string): Promise<void> {
    const next = apply(this.#durable, change, ownerId);
    const payload = JSON.stringify(next);
    if (Buffer.byteLength(payload) > MAX_STATE_BYTES) throw new Error('state-capacity');
    const atMs = this.#options.clock.now();
    const plan = this.#plan({change, next}, atMs);
    const statements = this.#statements();
    await this.#commit(plan, atMs, () => {
      const stored = statements.stateRevision.get() as {revision: number} | undefined;
      if ((stored?.revision ?? null) !== change.expectedRevision) throw new Error('revision-conflict');
      statements.writeState.run(next.revision, payload);
    });
  }

  /**
   * Commits the plan and `extra` work in one transaction, then publishes its messages through the outbox. Resolves once
   * the transaction has committed, without waiting for the publication: committed is not published, and a refused
   * publish is reported once, as `outbox.deferred`, and goes out later, unchanged. Rejects, with nothing changed, when the
   * transaction does not commit.
   */
  async #commit(plan: Plan, atMs: number, extra: (tx: CoreTransaction) => void): Promise<void> {
    const statements = this.#statements();
    const outbox = this.#outbox();
    let revision = plan.revision;
    const commits = this.#commits + 1;
    // A failure names only the commit it came from.
    this.#failure = undefined;
    const added: Message[] = [];
    let addTo: AddMessage = () => { throw new Error('add a message only inside the transaction'); };
    let adds = 0;
    const tx: CoreTransaction = {
      database: this.#db, atMs,
      revision: () => {
        revision ??= this.#revision + 1;
        return revision;
      },
      add: (key, draft, options) => {
        adds += 1;
        return addTo(key, draft, options);
      },
      take: (message, keepForMs) => { statements.take.run(message.source, message.id, JSON.stringify(message), keepForMs === undefined ? null : atMs + keepForMs); },
      history: message => {
        statements.history.run(revision ?? this.#revision, atMs, message.id, message.kind, message.type, message.subject, JSON.stringify(message));
      },
    };
    this.#frozen = atMs;
    let sent: Promise<void>;
    try {
      sent = outbox.transaction(add => {
        addTo = add;
        extra(tx);
        for (const {key, draft, history} of plan.messages) {
          const message = tx.add(key, draft, plan.cause === undefined ? {} : {parent: plan.cause.message}) as Message;
          // A message the profile refuses rolls the whole change back: the core never commits what it cannot publish.
          const checked = this.#validator.validate(message);
          if (!checked.ok) throw new SdkError({error: checked.error});
          added.push(message);
          if (history) tx.history(message);
        }
        for (const record of plan.records) statements.writeRecord.run('session', record.id, record.revision, JSON.stringify(record));
        for (const id of plan.removed) statements.deleteRecord.run('session', id);
        const observation = plan.cause?.observation;
        if (plan.cause !== undefined && observation !== undefined) {
          statements.prune.run(atMs);
          // Kept as long as agent-state still admits the observation, which it judges by the hook's own instant.
          tx.take(plan.cause.message, Math.max(0, observation.observedAtMs - atMs) + TAKEN_LIFECYCLE_MS);
        }
        if (added.length > 0) {
          const change: CoreChange = {revision: tx.revision(), messages: added};
          for (const derive of this.#options.derivers ?? []) derive(change, tx);
        }
        statements.writeRevision.run(revision ?? this.#revision, commits);
      });
    } finally {
      this.#frozen = undefined;
      addTo = () => { throw new Error('add a message only inside the transaction'); };
    }
    // The outbox commits before it returns, or returns a rejection with the transaction rolled back, and it resolves
    // only once the publication ends. The commit counter tells the two apart at once, so the publication is not awaited.
    // A rollback that failed leaves the transaction open with its writes in it, where the counter would read as
    // committed: roll it back here, and report the change as not committed.
    const open = this.#db.isTransaction;
    if (open) {
      try {
        this.#db.exec('ROLLBACK');
      } catch {
        // The connection's next transaction fails in turn; nothing is reported committed.
      }
    }
    const stored = open ? undefined : statements.revision.get() as {commits: number} | undefined;
    if (stored?.commits !== commits) {
      try {
        await sent;
      } catch (error) {
        this.#failure = errcode(error) === SQLITE_FULL ? 'full' : 'failed';
        throw error;
      }
      throw new Error('the core store did not commit');
    }
    this.#commits = commits;
    if (plan.durable !== undefined) this.#durable = plan.durable;
    if (revision !== undefined) this.#revision = revision;
    for (const record of plan.records) this.#records.set(record.id, record);
    for (const id of plan.removed) this.#records.delete(id);
    this.#restarted = plan.restarted;
    this.#hostSessions = plan.hostSessions;
    if (adds > 0) this.#options.beforePublish?.();
    const sending = sent.catch(() => {});
    this.#sending.add(sending);
    void sending.finally(() => { this.#sending.delete(sending); });
  }

  /** What a commit, or a refresh when `committed` is undefined, changes and publishes at `atMs`. */
  #plan(committed: {change: Commit; next: DurableState} | undefined, atMs: number): Plan {
    const prior = this.#durable;
    const next = committed?.next ?? prior;
    const change = committed?.change;
    const restarted = new Set(this.#restarted);
    const hostSessions = new Map(this.#hostSessions);
    const cause = change === undefined ? undefined : this.#matches(change, prior, committed?.next);
    const intake = cause?.observation === undefined ? undefined : {...cause, observation: cause.observation};
    const before = new Map((prior?.sessions ?? []).map(session => [entityOf(session), session]));
    const after = new Map((next?.sessions ?? []).map(session => [entityOf(session), session]));
    if (intake !== undefined && change?.replace === undefined) {
      const session = after.get(intake.entity), old = before.get(intake.entity);
      if (session !== undefined) {
        // Fresh lifecycle evidence ends restart uncertainty; read evidence and a repeat that refreshed nothing do not.
        const fresh = intake.kind !== 'read.observed' &&
          (old === undefined || session.lastEvidenceAtMs !== old.lastEvidenceAtMs || session.observedAtMs !== old.observedAtMs);
        if (fresh) restarted.delete(intake.entity);
        // As agent-state keeps it in memory: a committed 1.2 observation sets the host session ID when present and clears
        // it when absent, and a record whose parent is known never carries one. The core keeps it with the record.
        const host = intake.observation.hostSessionId;
        if (session.parent.status === 'known' || host === undefined) hostSessions.delete(intake.entity);
        else hostSessions.set(intake.entity, host);
      }
    }
    for (const id of [...restarted]) if (!after.has(id)) restarted.delete(id);
    for (const id of [...hostSessions.keys()]) if (!after.has(id)) hostSessions.delete(id);
    const projected = project([...after.values()], {restarted, hostSessions}, atMs);
    const updated = [...projected.values()].filter(record => changed(this.#records.get(record.id), record));
    const removed = [...this.#records.keys()].filter(id => !projected.has(id));
    const ended: Draft<object>[] = [];
    const occurrences: Draft<object>[] = [];
    // The revision is raised only for a change that publishes something.
    const revision = Math.max(this.#revision + 1, change?.revision ?? 0);
    if (intake !== undefined && change?.replace !== undefined) {
      const session = before.get(intake.entity);
      if (session !== undefined) ended.push(occurrence('session-ended', 'org.bunny.session.ended', observed(intake, session, revision)));
    }
    for (const [id, session] of after) {
      const old = before.get(id);
      const raised = attentionAdded(old?.attention ?? [], session.attention);
      const cleared = attentionAdded(session.attention, old?.attention ?? []);
      if (intake !== undefined && change?.replace === undefined && id === intake.entity) {
        const base = observed(intake, session, revision);
        const turn = intake.observation.turn;
        for (const attention of raised) occurrences.push(occurrence('attention-raised', 'org.bunny.attention.raised', {...base, attention} satisfies AttentionRaised));
        for (const attention of cleared) {
          occurrences.push(occurrence('attention-cleared', 'org.bunny.attention.cleared', {...base, attention, cause: causeOf(intake.kind, attention, turn)} satisfies AttentionCleared));
        }
        if (intake.kind === 'turn.ended') {
          const noticeId = noticeOf(old?.notices ?? [], session.notices, turn);
          occurrences.push(occurrence('turn-ended', 'org.bunny.turn.ended', {...base, ...(noticeId === undefined ? {} : {noticeId})} satisfies TurnEnded));
        }
      } else if (old !== undefined && cleared.length > 0 && change !== undefined) {
        // No observation started this change: an explicit approval recovery, or startup settling approvals on retired
        // turns. See ownerStarted for what such an occurrence carries.
        const cause = change.replace === undefined && change.journal?.kind === 'attention.resolved' ? 'recovered' : 'turn-retired';
        for (const attention of cleared) {
          occurrences.push(occurrence('attention-cleared', 'org.bunny.attention.cleared', {...ownerStarted(session, change.atMs, revision), attention, cause} satisfies AttentionCleared));
        }
      }
    }
    const removals = removed.map(id => {
      const retired = (next?.retirements ?? []).some(item => entityOf(item) === id && item.atMs === change?.atMs);
      return {
        key: sessionKey(id), history: true,
        draft: {kind: 'removal', type: 'org.bunny.session.removed', subject: id, dataschema: REMOVAL_SCHEMA,
          data: {entity: {family: 'session', id}, revision, reason: retired ? 'retired' : 'expired'}} satisfies Draft<object>,
      };
    });
    const publishes = updated.length + removed.length + ended.length + occurrences.length > 0;
    // The revision follows the ID, as the session family lists it.
    const records = updated.map(({id, ...rest}): SessionRecord => ({id, revision, ...rest}));
    return {
      durable: committed?.next, revision: publishes ? revision : undefined, records, removed, restarted, hostSessions, cause,
      messages: [
        ...ended.map(draft => ({key: occurrenceKey(familyOf(draft), draft.subject), draft, history: true})),
        ...removals,
        ...records.map(record => ({key: sessionKey(record.id), history: false, draft: stateDraft(record)})),
        ...occurrences.map(draft => ({key: occurrenceKey(familyOf(draft), draft.subject), draft, history: true})),
      ],
    };
  }

  /** The cause this commit answers, if any: the change its kind names, on its session. */
  #matches(change: Commit, prior: DurableState | undefined, next: DurableState | undefined): Cause | undefined {
    const intake = this.#cause;
    if (intake === undefined) return undefined;
    if (change.replace === undefined) {
      return change.session !== undefined && entityOf(change.session) === intake.entity && change.journal?.kind === intake.kind ? intake : undefined;
    }
    // A runtime end retires the session's tree in one replacement, with a retirement guard at the commit's instant.
    const ended = intake.kind === 'runtime.ended' && (prior?.sessions ?? []).some(session => entityOf(session) === intake.entity) &&
      !(next?.sessions ?? []).some(session => entityOf(session) === intake.entity) &&
      (next?.retirements ?? []).some(item => entityOf(item) === intake.entity && item.atMs === change.atMs);
    return ended ? intake : undefined;
  }
}

/** A held lease: the lock database's open exclusive transaction, released once. */
export type Lock = {release: () => void};
/** The lock files this process holds a lease on. */
const held = new Set<string>();
const wait = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });

/**
 * Takes the store's lease, as the Hub's adapter does: an exclusive transaction held open on a lock database beside the
 * store, `<store>-owner`, private to its owner. Another holder, in another process or in this one, is waited for until
 * `signal` aborts at agent-state's deadline. The store's own file keeps the locking its opener gave it. An in-memory store,
 * which no other connection can open, has no lock file. Offline tools take it through `holdRuntimeLease` (Hub #931).
 */
export async function takeLock(location: string | null, signal: AbortSignal): Promise<Lock> {
  if (location === null || location === '') return {release: () => {}};
  const path = `${location}-owner`;
  for (;;) {
    // A lease this process holds is waited for without opening the file: closing any descriptor of it would drop the
    // holder's POSIX lock.
    if (held.has(path)) {
      signal.throwIfAborted();
      await wait(LEASE_POLL_MS);
      continue;
    }
    held.add(path);
    try {
      const file = await open(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
      try {
        const info = await file.stat();
        if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) throw new Error('invalid-store');
      } finally {
        await file.close();
      }
      const lock = new DatabaseSync(path);
      try {
        // No rollback journal: the lock database holds no data, so taking the lock writes nothing, even on a full disk.
        lock.exec('PRAGMA busy_timeout = 0; PRAGMA journal_mode = MEMORY; BEGIN EXCLUSIVE');
      } catch (error) {
        lock.close();
        throw error;
      }
      let released = false;
      return {release: () => {
        if (released) return;
        released = true;
        if (lock.isTransaction) lock.exec('ROLLBACK');
        lock.close();
        held.delete(path);
      }};
    } catch (error) {
      held.delete(path);
      if (errcode(error) !== SQLITE_BUSY) throw error;
      signal.throwIfAborted();
      await wait(LEASE_POLL_MS);
    }
  }
}

/** How long the core keeps a lifecycle observation's `(source, id)`: as long as an observation can still be admitted. */
const TAKEN_LIFECYCLE_MS = 86_400_000;

type Statements = {
  state: StatementSync; stateRevision: StatementSync; writeState: StatementSync; revision: StatementSync; writeRevision: StatementSync;
  records: StatementSync; writeRecord: StatementSync; deleteRecord: StatementSync; history: StatementSync;
  taken: StatementSync; take: StatementSync; prune: StatementSync;
};

// Statements are prepared once for the lease's life: per-call preparation keeps native allocations until GC notices.
function prepare(db: DatabaseSync): Statements {
  return {
    state: db.prepare('SELECT payload FROM state WHERE id = 1'),
    stateRevision: db.prepare('SELECT revision FROM state WHERE id = 1'),
    writeState: db.prepare('INSERT INTO state VALUES (1, ?, ?) ON CONFLICT (id) DO UPDATE SET revision = excluded.revision, payload = excluded.payload'),
    revision: db.prepare('SELECT value, commits FROM core_revision WHERE only = 1'),
    writeRevision: db.prepare('INSERT INTO core_revision VALUES (1, ?, ?) ON CONFLICT (only) DO UPDATE SET value = excluded.value, commits = excluded.commits'),
    records: db.prepare('SELECT record FROM core_records WHERE family = \'session\' ORDER BY id'),
    writeRecord: db.prepare('INSERT INTO core_records VALUES (?, ?, ?, ?) ON CONFLICT (family, id) DO UPDATE SET revision = excluded.revision, record = excluded.record'),
    deleteRecord: db.prepare('DELETE FROM core_records WHERE family = ? AND id = ?'),
    history: db.prepare('INSERT INTO core_history (revision, at_ms, message_id, kind, type, subject, message) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    taken: db.prepare('SELECT message FROM core_taken WHERE source = ? AND id = ?'),
    take: db.prepare('INSERT INTO core_taken VALUES (?, ?, ?, ?)'),
    prune: db.prepare('DELETE FROM core_taken WHERE expires_at_ms IS NOT NULL AND expires_at_ms <= ?'),
  };
}

const familyOf = (draft: Draft<object>): string => draft.dataschema.slice('https://bunny.invalid/events/'.length).split('/')[0] ?? '';

function stateDraft(record: SessionRecord): Draft<SessionRecord> {
  return {kind: 'state', type: 'org.bunny.session.updated', subject: record.id, dataschema: SESSION_SCHEMA, data: record};
}

function occurrence<T extends object>(family: string, type: string, data: T & {session: string}): Draft<T> {
  return {kind: 'occurrence', type, subject: data.session, dataschema: `https://bunny.invalid/events/${family}/2.0`, data};
}

/** What an occurrence of an observation carries: its session, identity, turn, evidence and the committing revision. */
function observed(intake: {observation: LifecycleObservation}, session: Session, revision: number): AgentOccurrence {
  const {turn, observedAtMs, occurredAtMs, ordering} = intake.observation;
  return {session: entityOf(session), identity: session.identity, turn, observedAtMs, ...(occurredAtMs === undefined ? {} : {occurredAtMs}), ordering, revision};
}

/**
 * What an owner-started clearing carries as its observation (Hub #831's decision, MAPPING.md): no observation started
 * it, so its `turn` is the session's current turn when the owner cleared the item, its `observedAtMs` the owner's
 * instant of the change, and its `ordering` unknown, because the owner is no provider and has no sequence to claim.
 */
function ownerStarted(session: Session, atMs: number, revision: number): AgentOccurrence {
  return {session: entityOf(session), identity: session.identity, turn: session.turn, observedAtMs: atMs, ordering: {status: 'unknown'}, revision};
}

/** Why a reduction cleared an item: its own turn's resolution or end, or a newer turn retiring the item's turn. */
function causeOf(kind: string, item: Attention, turn: KnownId): AttentionCleared['cause'] {
  if (sameTurn(item.turn, turn) && kind === 'attention.resolved') return 'resolved';
  if (sameTurn(item.turn, turn) && kind === 'turn.ended') return 'turn-ended';
  return 'turn-retired';
}

/** The notice a turn end retained: the one it added, or the one already held for its known turn. */
function noticeOf(before: Session['notices'], after: Session['notices'], turn: KnownId): string | undefined {
  const added = after.filter(notice => !before.some(old => old.id === notice.id));
  if (added.length === 1) return added[0]?.id;
  return after.find(notice => sameTurn(notice.turn, turn))?.id;
}

