import {decideReadReceipt, type ReadReceiptObservation, type ReadReceiptQualification} from '@jimmie-potts/event-contracts/v2/read-receipts';
import {viewRevision} from '../read-receipts/qualification.js';
// The core's store (Hub #831, #1865): the core's sessions, retirement guards, outbox, history and published records in
// the core module's own database, `modules/core.sqlite`, so each change and the messages it publishes commit in one
// transaction (ADR 0012, "Ownership and publication").
//
// - Sessions: one row per stored session in `core_sessions` and one per retirement guard in `core_session_guards`
//   (#1865). The session logic in `session/` computes each change; the store commits its whole result, with the
//   records it publishes, in one transaction, and derives no cause and no occurrence of its own.
// - Opening: `open` runs in the core's start, before the core serves a sync or republishes. It borrows the runtime's
//   ownership of the lease on `core.sqlite-owner`, or takes that lease when no ownership was passed, then creates every
//   core part's tables, runs the one-time session reset when the old agent-state `state` table is still there, and
//   loads its caches. The lease and SQLite exclusive locking (Hub #972) keep one writer: a second runtime is refused at
//   the lease, or when it opens the file. The lock lasts until the core stops.
// - Each commit also derives the 2.0 messages it publishes and writes them, the published records, the history rows and
//   the (source, id) of the intake it took, in the commit's own transaction, through the SDK's outbox. History (#782)
//   keeps every message the core publishes, a state as a compact change event, and what a part records.
// - A session's `session/3.0` record publishes only when its public meaning changes (#1865 step 9, design decision 5),
//   its evidence time counted at `SESSION_LIMITS.evidenceResolutionMs` (Hub #1947): a work observation that only moves
//   the evidence time by less than that writes the session row, publishes nothing and adds no history row.
// - Each save of session rows is timed, and a slow one is recorded (Hub #976; see `SAVE_COST`).
import type {DatabaseSync, StatementSync} from 'node:sqlite';
import {compareDelivery, errorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import {
  coreValidator, sessionEntityId, type Identity, type LifecycleObservation, type Session30Record, type Title,
} from '@jimmie-potts/event-contracts/v2/families';
import {occurrenceSchemaOf, sessionSchemaOf} from '@jimmie-potts/event-contracts/v2/session';
import {
  fullDisk, Outbox, recordLog, SdkError, type AddMessage, type Clock, type Draft, type LogFields, type Logger, type OutboxOptions, type Sdk, type SpanRecorder,
} from '@jimmie-potts/sdk';
import {errorFields} from '../log.js';
import {takeLock, type Lock} from './lock.js';
import {borrowRuntimeOwnership, type CoreOwnership} from '../runtime-ownership.js';
import {History, type HistoryEntry, type HistoryRules, type WrittenChange, type OperationStep} from './history.js';
import {HistoryAlarm, type HistoryDevice} from './history-alarm.js';
import {REMOVAL_SCHEMA} from './schemas.js';
import {DEFAULT_CONSUMERS, SESSION_LIMITS, type Consumer, type RetirementGuard, type StoredSession} from './session/model.js';
import {meaningChanged, publicRecords} from './session/record.js';
import {expiryOf, transition, type Occurrence, type SessionInput, type TransitionResult} from './session/transition.js';

export {takeLock, type Lock} from './lock.js';

/**
 * What the core is doing when a change commits: a hook's observation, whose `(source, id)` and trace the change takes,
 * or a command, such as an acknowledgment, whose trace the change joins.
 */
export type Cause = {
  readonly message: Message<unknown>;
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
  /** Installs a part's in-memory state after a verified commit, before publication. */
  afterCommit?(apply: () => void): void;
  /**
   * Stores a message in the core's outbox, in this transaction. It goes out after the commit, in order, and history
   * keeps it (#782): a state as a compact change event, anything else whole.
   */
  readonly add: AddMessage;
  /** Requires the exact retained history fact for a message added by this transaction. */
  requireRetained?(message: Message<unknown>): void;
  /** Records `message` as taken by its `(source, id)`, kept for `keepForMs` or for good, so a later copy is a duplicate. */
  take(message: Message<unknown>, keepForMs?: number): void;
  /** Keeps another participant's message in the core's history, as `add` keeps the core's own. */
  record(message: Message<unknown>): void;
  /** Keeps one step of a tracked action in the core's history. */
  step(step: OperationStep): void;
}

/** Rows a part derives from a committed core change, in the change's own transaction. */
export type Deriver = (change: CoreChange, tx: CoreTransaction) => void;

/** Work a session change's caller completes in that change's own transaction, such as a tracked operator action. */
export type Completion = (change: CoreChange, tx: CoreTransaction) => void;

export type StoreOptions = {
  /** Internal early-runtime ownership; only the bound core can consume it, once. */
  ownership?: CoreOwnership;
  /** The core module's own database. */
  database: DatabaseSync;
  /** The core's participant: the outbox publishes with `publishMessage`, so a message keeps its stored `id` and `time`. */
  sdk: Pick<Sdk, 'source' | 'publishMessage'>;
  clock: Clock;
  /** The consumers acknowledgments are recorded for: `DEFAULT_CONSUMERS` by default. */
  consumers?: readonly Consumer[];
  /** Whether current archive evidence covers a Codex Desktop identity or one of its ancestors (Hub #990). */
  archived?: (identity: Identity, ancestors: readonly Identity[]) => boolean;
  /**
   * The core's logger and tracing, which its outbox records with (Hub #949): a refused publish, committed and awaiting
   * publication, as `outbox.deferred`, once per run of refusals. The store records a slow save and the reset with it.
   */
  log?: Logger;
  trace?: SpanRecorder;
  /** Without a logger, hears that a publish was refused after its commit: committed, and awaiting publication. */
  onError?: OutboxOptions['onError'];
  statePublication?: OutboxOptions['statePublication'];
  /**
   * Hears the published session records once each open has loaded them, before the start transaction, so parts that keep
   * a copy of the sessions from committed changes start from every stored session, not only those a start republishes.
   */
  opened?: (records: readonly Session30Record[]) => void;
  /** Parts' derivers, run in each core change's transaction. */
  derivers?: readonly Deriver[];
  /** Parts' tables, created once the lease is held. */
  open?: readonly ((database: DatabaseSync) => void)[];
  /** Runs right after each commit that has messages to publish, before any goes out. A crash test kills the process here. */
  beforePublish?: () => void;
  /** New commits only; returned cleanup runs when their original publication batch ends. Never called by republication or sync. */
  committed?: (change: CoreChange) => void | (() => void);
  /** When a save is slow: `SAVE_COST` by default. */
  saveCost?: SaveCost;
  /** Monotonic milliseconds that saves are timed with: `performance.now` by default. */
  timer?: () => number;
  /** What history needs to know of the families it keeps (#1772): `DEFAULT_HISTORY_RULES` by default. */
  history?: HistoryRules;
  /** Neutral routing IDs admitted by the module host before any producer starts. */
  historyDevices?: readonly HistoryDevice[];
};

/** When a save of session rows is slow: past `saveMs` of work. */
export type SaveCost = {readonly saveMs: number};

/** Why the last commit failed: the disk was full, or something else. */
export type StoreFailure = 'full' | 'failed';

/** What a session change did: taken with its outcome at the core's revision, or refused, changing nothing. */
export type SessionOutcome = {ok: true; revision: number; outcome: 'applied' | 'duplicate' | 'stale' | 'ambiguous'} |
  {ok: false; code: NonNullable<TransitionResult['refusal']> | 'invalid-request' | 'storage-failed'};

/** What one commit writes and publishes, and what it installs in memory once it has committed. */
type Plan = {
  /** The revision the commit publishes at, or undefined when it publishes nothing. */
  revision: number | undefined;
  records: Session30Record[];
  removed: string[];
  messages: {key: string; draft: Draft<object>}[];
  cause: Cause | undefined;
  /** Writes the plan's session and guard rows, in the transaction. */
  write?: (statements: Statements) => void;
  /** Installs the plan's sessions after the commit, before publication. */
  install?: () => void;
  completing?: Completion | undefined;
};

/**
 * A save is slow (Hub #976) once it takes longer than 100 ms of the event loop, which every module and the gateway share.
 * A save is one session change's commit: it serializes the changed session rows, plans the messages, and commits the one
 * transaction, the parts' rows, history and outbox included. Publication follows the commit and is not part of it. With
 * one row per session and at most 128 sessions, no save can approach the size the old state block was bounded by, so
 * the size condition retired with that block (#1865).
 */
export const SAVE_COST: SaveCost = Object.freeze({saveMs: 100});
/** A record's durations are bounded to one day, as the diagnostic contract bounds them. */
const MAX_DURATION_MS = 86_400_000;
/** How long the core's start waits for the lease that another holder, in this process or another, has. */
export const LEASE_WAIT_MS = 3000;
const occurrenceKey = (family: string, entity: string): string => `bunny.event.${family}.${entity}`;
const sessionKey = (entity: string): string => `bunny.state.session.${entity}`;
/** The routing-key prefixes of the session family's messages, whose pending copies the one-time reset deletes. */
const SESSION_ROUTING = ['bunny.state.session.', 'bunny.event.attention-raised.', 'bunny.event.attention-cleared.', 'bunny.event.turn-ended.', 'bunny.event.session-ended.'];

export class CoreStore {
  readonly #db: DatabaseSync;
  readonly #options: StoreOptions;
  readonly #validator = coreValidator();
  readonly #consumers: readonly Consumer[];
  /**
   * The store's tables, outbox, statements and history once open has created them. Nothing uses them until `#opened`
   * is set, which happens only after the reset and the cache load have succeeded too.
   */
  #tables: Opened | undefined;
  #opened: Opened | undefined;
  /** The store's lock, held from its open until `close`. */
  #lock: Lock | undefined;
  /** The stored sessions, by entity ID, in the order they were first stored. */
  #sessions = new Map<string, StoredSession>();
  /** The retirement guards, oldest first. */
  #guards: RetirementGuard[] = [];
  /** The published session records, by entity ID. */
  #records = new Map<string, Session30Record>();
  /**
   * The sessions whose stored record a release before the switch to `session/3.0` published (#1865 step 9). The store
   * serves each as its `session/3.0` record from the start, and the next change publishes it, or its removal.
   */
  #legacy = new Set<string>();
  #revision = 0;
  /** How many transactions the store has committed: a transaction that did not commit leaves it unchanged. */
  #commits = 0;
  /** The instant of the store's open, the core's start (design decision 4): held in memory only, never stored. */
  #startedAtMs = 0;
  /** Whether the start transaction, which marks running work unconfirmed, has yet to commit since the open. */
  #starting = false;
  /** The latest instant a session change took: a change's instant never goes back before it. */
  #floorMs = 0;
  /** The instant every message of the transaction under way is stamped with. */
  #frozen: number | undefined;
  #failure: StoreFailure | undefined;
  /** Publications still going out, so a stop can let them finish. */
  readonly #sending = new Set<Promise<unknown>>();
  readonly #timer: () => number;
  readonly #historyAlarm: HistoryAlarm | undefined;
  /** Whether the last save took too long: recorded once a run. */
  #slow = false;

  constructor(options: StoreOptions) {
    this.#db = options.database;
    this.#options = options;
    this.#consumers = options.consumers ?? DEFAULT_CONSUMERS;
    this.#timer = options.timer ?? (() => performance.now());
    this.#historyAlarm = options.log === undefined ? undefined : new HistoryAlarm(options.log, options.historyDevices ?? []);
  }

  /** The core's current revision: every record it serves carries this one or an earlier one. */
  get revision(): number {
    return this.#revision;
  }

  /** The published session records. */
  records(): Session30Record[] {
    return [...this.#records.values()];
  }

  /** The stored sessions, private bookkeeping included, as copies. */
  sessions(): StoredSession[] {
    return structuredClone([...this.#sessions.values()]);
  }

  /**
   * Whether the store is open, so parts may use it: not before its open has fully succeeded, and not once its database
   * closed, as a crash closes it.
   */
  get isOpen(): boolean {
    return this.#opened !== undefined && this.#db.isOpen;
  }

  /** The core's history (#782), once the store is open. */
  get history(): History {
    if (this.#opened === undefined) throw new SdkError(errorBody('unavailable', {detail: 'the core store is not open'}));
    return this.#opened.history;
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

  /**
   * Opens the store, once: borrows the runtime's ownership of the lease, or takes the lease, waiting for another holder
   * until `signal` aborts; then creates every core part's tables, runs the one-time session reset when it applies, and
   * loads the revision, commit count, sessions, guards and records. The start transaction, which marks running work
   * unconfirmed, commits before any other session change (see `refresh`). A store that cannot open, as on a full disk at
   * a first start or at the reset, rejects with its failure named and can be opened again. Until an open succeeds whole, the store exposes nothing: its intake, transactions, history and
   * republication refuse with `unavailable`, so nothing it holds goes out and nothing commits before the reset.
   */
  async open(signal: AbortSignal = AbortSignal.timeout(LEASE_WAIT_MS)): Promise<void> {
    if (this.#opened !== undefined) return;
    this.#failure = undefined;
    try {
      this.#lock ??= this.#options.ownership === undefined
        ? await takeLock(this.#db.location(), signal) : borrowRuntimeOwnership(this.#options.ownership, this.#db.location());
      const tables = this.#tables ??= this.#openTables();
      this.#reset();
      this.#loadCaches(tables.statements);
      this.#startedAtMs = this.#options.clock.now();
      this.#starting = true;
      this.#opened = tables;
      this.#options.opened?.(this.records());
    } catch (error) {
      // A store that cannot create its tables or run its reset on a full disk, as at a first start, is full, not broken (Hub #972).
      if (fullDisk(error)) this.#failure = 'full';
      throw new Error('storage-unavailable', {cause: error});
    }
  }

  /** The next instant a session expires or a guard lapses, or undefined when none will. */
  nextDue(): number | undefined {
    return expiryOf(this.#sessions.values(), this.#guards);
  }

  /**
   * Commits what has fallen due by now, each in its own core transaction: after an open, the start transaction that
   * marks running work unconfirmed; the sessions a day without lifecycle evidence expire with the guards a day old;
   * then each record whose public meaning differs from the one
   * last published, as every record of a release before the switch to `session/3.0` does, is published at a new
   * revision. True when it published. Rejects, changing nothing more, when the store refuses a commit.
   */
  async refresh(): Promise<boolean> {
    if (this.#opened === undefined) return false;
    const before = this.#revision;
    if (!await this.#start()) throw new Error('the core store refused the start transaction');
    if (await this.#due() === 'failed') throw new Error('the core store refused a due transition');
    const atMs = this.#options.clock.now();
    const plan = this.#plan(undefined, atMs, undefined);
    if (plan.revision !== undefined) await this.#commit(plan, atMs, () => {});
    return this.#revision > before;
  }

  /**
   * Commits the start transaction if it is still pending, so a caller reads the records as they stand. False while it
   * cannot commit, as on a full disk; `takeFailure` then names why.
   */
  settle(): Promise<boolean> {
    return this.#opened === undefined ? Promise.resolve(false) : this.#start();
  }

  /**
   * The start transaction (design decision 4), once after each open and before any other session change: every stored
   * session whose work runs becomes unconfirmed, and the changed records are published, with no occurrence and no cause.
   * False while it cannot commit, as on a full disk, so the change that asked for it is refused with nothing changed.
   */
  async #start(): Promise<boolean> {
    if (!this.#starting) return true;
    const outcome = await this.#change({kind: 'start'}, undefined);
    if (outcome.ok) this.#starting = false;
    return outcome.ok;
  }

  /**
   * Commits what has fallen due, as the core does before every observation: expiry, in its own transaction (the aging
   * table of design decision 4, which has no work deadline since Hub #1947).
   */
  async #due(): Promise<'published' | 'nothing' | 'failed'> {
    const before = this.#revision;
    const expiry = expiryOf(this.#sessions.values(), this.#guards);
    if (expiry !== undefined && expiry <= this.#nowMs() && !(await this.#change({kind: 'expiry'}, undefined)).ok) return 'failed';
    return this.#revision > before ? 'published' : 'nothing';
  }

  /** Takes one lifecycle observation through the session logic, after expiring what is due. */
  async observe(message: Message<LifecycleObservation>): Promise<SessionOutcome> {
    const observation = message.data;
    if (Buffer.byteLength(JSON.stringify(observation)) > SESSION_LIMITS.observationBytes) return {ok: false, code: 'invalid-request'};
    // Commit what is due before admission, so a freed slot or a fresh record replaces the expired one.
    if (await this.#due() === 'failed') return {ok: false, code: 'storage-failed'};
    return this.#change({kind: 'observation', observation}, {message, observation});
  }

  /** Provider title evidence from the Codex Desktop module: display metadata only. */
  title(message: Message<LifecycleObservation>, title: Title): Promise<SessionOutcome> {
    const observation = message.data;
    return this.#change({kind: 'title', id: sessionEntityId(observation.identity), title, observedAtMs: observation.observedAtMs}, {message, observation});
  }

  /** Sets or clears a session's user label, completing `completing` in the same transaction. */
  label(command: Message<unknown>, id: string, label: string | null, completing?: Completion): Promise<SessionOutcome> {
    return this.#change({kind: 'label', id, label}, {message: command}, completing);
  }

  /** Records one consumer's acknowledgment of a notice. */
  acknowledge(command: Message<unknown>, id: string, noticeId: string, consumerId: string): Promise<SessionOutcome> {
    return this.#change({kind: 'acknowledge', id, noticeId, consumerId}, {message: command});
  }

  /** Acknowledges the session's latest notice for every configured consumer, completing `completing` in the same transaction. */
  acknowledgeAll(command: Message<unknown>, id: string, noticeId: string, completing?: Completion): Promise<SessionOutcome> {
    return this.#change({kind: 'acknowledge-all', id, noticeId}, {message: command}, completing);
  }

  /** Retires the one approval marker without an attention ID on `turnId`, while the session's work claim is unconfirmed. */
  recoverApproval(command: Message<unknown>, id: string, turnId: string): Promise<SessionOutcome> {
    return this.#change({kind: 'recover-approval', id, turnId}, {message: command});
  }

  /**
   * The core calls this on its serialized intake. A pending start transaction commits first, so eligibility is judged
   * against the record as it then stands. Only that settling awaits before the target is read; the target is checked
   * again inside the receipt's own transaction, where a change between the two rolls the receipt back.
   */
  async readReceipt(message: Message<ReadReceiptObservation>, qualification: ReadReceiptQualification): Promise<boolean> {
    if (!await this.#start()) throw new Error('the core store refused the start transaction');
    const before = this.#records.get(message.subject), observation = message.data, atMs = this.#options.clock.now();
    // The stored session's own evidence time, which progress may have advanced since the record was published.
    const evidenceAtMs = this.#sessions.get(message.subject)?.lastEvidenceAtMs ?? 0;
    if (before === undefined || decideReadReceipt(message, before, qualification).status !== 'eligible' ||
      observation.observedAtMs <= atMs - TAKEN_LIFECYCLE_MS || evidenceAtMs <= atMs - TAKEN_LIFECYCLE_MS) return false;
    const receipt = observation.event.receipt, previous = before.outcome.readReceipt;
    if (receipt.kind === 'owned-ui') {
      if (receipt.viewRevision !== viewRevision(before)) return false;
    } else {
      if (receipt.seenRevision === receipt.acceptedRevision) return false;
      if (previous?.source === message.source && previous.noticeId === observation.event.noticeId &&
        previous.receipt.kind === 'provider-client' && previous.receipt.seenRevision === receipt.seenRevision &&
        previous.receipt.acceptedRevision === receipt.acceptedRevision) return false;
    }
    const provenance = {noticeId: observation.event.noticeId, observedAtMs: observation.observedAtMs, source: message.source, receipt: structuredClone(receipt)};
    const outcome = await this.#change({kind: 'read-receipt', id: before.id, receipt: provenance}, {message}, undefined, tx => {
      if (this.#records.get(before.id)?.revision !== before.revision) throw new Error('read-target-changed');
      tx.take(message, TAKEN_LIFECYCLE_MS);
    });
    if (!outcome.ok) throw new Error('the core store did not commit the read receipt');
    return true;
  }

  /** A session change's instant: the clock, never before an earlier change's. */
  #nowMs(): number {
    return Math.max(this.#options.clock.now(), this.#floorMs);
  }

  /**
   * Runs one input through the session logic and commits its result in one transaction: the session and guard rows, the
   * records and messages it publishes, its history and the intake it took. A refusal or an input that changes nothing
   * commits nothing. A commit that fails changes nothing, here or in memory, and is reported as `storage-failed`.
   */
  async #change(input: SessionInput, cause: Cause | undefined, completing?: Completion, extra: (tx: CoreTransaction) => void = () => {}): Promise<SessionOutcome> {
    if (input.kind !== 'start' && !await this.#start()) return {ok: false, code: 'storage-failed'};
    const began = this.#timer();
    const atMs = this.#options.clock.now();
    const nowMs = Math.max(atMs, this.#floorMs);
    const result = transition({sessions: this.#sessions, guards: this.#guards, revision: this.#revision}, input, {
      nowMs, wallMs: atMs, startedAtMs: this.#startedAtMs, consumers: this.#consumers,
      ...(this.#options.archived === undefined ? {} : {archived: this.#options.archived}),
    });
    if (result.outcome === 'refused') return {ok: false, code: result.refusal ?? 'capacity'};
    if (result.changed.length === 0 && result.removed.length === 0 && result.guards === undefined) {
      return {ok: true, revision: this.#revision, outcome: result.outcome};
    }
    const plan = this.#plan(result, atMs, cause, completing);
    const install = plan.install;
    plan.install = () => {
      install?.();
      this.#floorMs = Math.max(this.#floorMs, nowMs);
    };
    try {
      const committedAt = await this.#commit(plan, atMs, extra);
      this.#saved(committedAt - began);
    } catch {
      return {ok: false, code: 'storage-failed'};
    }
    return {ok: true, revision: this.#revision, outcome: result.outcome === 'ambiguous' ? 'ambiguous' : 'applied'};
  }

  /**
   * What a session change, or a refresh when `result` is undefined, writes and publishes at `atMs`: the `session-ended`
   * occurrences, then the removals, then every record whose public meaning changed, then the attention and turn
   * occurrences, all at one new revision, which is raised only for a change that publishes something. A change that
   * publishes nothing still writes its sessions.
   */
  #plan(result: TransitionResult | undefined, atMs: number, cause: Cause | undefined, completing?: Completion): Plan {
    const sessions = new Map(this.#sessions);
    const reasons = new Map<string, 'expired' | 'retired'>();
    for (const {id, reason} of result?.removed ?? []) {
      sessions.delete(id);
      reasons.set(id, reason);
    }
    for (const session of result?.changed ?? []) sessions.set(session.id, session);
    const revision = this.#revision + 1;
    const projected = publicRecords(sessions.values(), revision);
    const records = [...projected.values()].filter(record => this.#legacy.has(record.id) || meaningChanged(this.#records.get(record.id), record));
    const removed = [...new Set([...this.#records.keys(), ...this.#legacy])].filter(id => !projected.has(id));
    const draft = ({family, data}: Occurrence): Draft<object> & {subject: string} => occurrence(family, {...data, revision});
    const ended = (result?.ended ?? []).map(draft);
    const occurrences = (result?.occurrences ?? []).map(draft);
    const removals = removed.map(id => ({
      key: sessionKey(id),
      draft: {kind: 'removal', type: 'org.bunny.session.removed', subject: id, dataschema: REMOVAL_SCHEMA,
        data: {entity: {family: 'session', id}, revision, reason: reasons.get(id) ?? 'expired'}} satisfies Draft<object>,
    }));
    const publishes = records.length + removed.length + ended.length + occurrences.length > 0;
    const written = result?.changed ?? [], guards = result?.guards;
    return {
      revision: publishes ? revision : undefined, records, removed, cause, completing,
      messages: [
        ...ended.map(item => ({key: occurrenceKey(familyOf(item), item.subject), draft: item})),
        ...removals,
        ...records.map(record => ({key: sessionKey(record.id), draft: stateDraft(record)})),
        ...occurrences.map(item => ({key: occurrenceKey(familyOf(item), item.subject), draft: item})),
      ],
      ...(result === undefined ? {} : {
        write: (statements: Statements): void => {
          const at = publishes ? revision : this.#revision;
          for (const session of written) statements.writeSession.run(session.id, at, session.generation, JSON.stringify(session));
          for (const id of reasons.keys()) statements.deleteSession.run(id);
          if (guards !== undefined) {
            statements.clearGuards.run();
            for (const guard of guards) statements.writeGuard.run(guard.id, guard.atMs, JSON.stringify(guard));
          }
        },
        install: (): void => {
          this.#sessions = sessions;
          if (guards !== undefined) this.#guards = [...guards];
        },
      }),
    };
  }

  /** What a committed save cost (Hub #976): a WARN once one save takes too long, once per run, and an INFO once one is quick again. */
  #saved(ms: number): void {
    const limits = this.#options.saveCost ?? SAVE_COST;
    const holds = ms > limits.saveMs;
    if (holds === this.#slow) return;
    this.#slow = holds;
    // Whole milliseconds rounded up, so a recorded time is past the limit exactly when the save was.
    const fields: LogFields = {'bunny.operation': 'storage', 'bunny.save.duration_ms': Math.min(MAX_DURATION_MS, Math.ceil(Math.max(0, ms)))};
    try {
      if (this.#options.log !== undefined) recordLog(this.#options.log, holds ? 'storage.cost.high' : 'storage.cost.normal', fields);
    } catch {
      // Telemetry never changes a save that committed.
    }
  }

  /** Runs a part's `work` in one core transaction; its messages go out after the commit. */
  async transaction<R>(work: (tx: CoreTransaction) => R): Promise<R> {
    const atMs = this.#options.clock.now();
    let result: R | undefined;
    const plan: Plan = {revision: undefined, records: [], removed: [], messages: [], cause: undefined};
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

  /** Ends storage use; an early runtime owner's borrowed lock remains held until process exit. */
  close(): void {
    this.#lock?.release();
    this.#lock = undefined;
  }

  /** Creates the store's and every core part's tables, its outbox and history, once. */
  #openTables(): Opened {
    const db = this.#db;
    db.exec(`PRAGMA busy_timeout = 0;
      CREATE TABLE IF NOT EXISTS core_revision (only INTEGER PRIMARY KEY CHECK (only = 1), value INTEGER NOT NULL, commits INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS core_records (family TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, record TEXT NOT NULL,
        PRIMARY KEY (family, id)) STRICT;
      CREATE TABLE IF NOT EXISTS core_sessions (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, generation INTEGER NOT NULL, session TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS core_session_guards (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, at_ms INTEGER NOT NULL, guard TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS core_taken (source TEXT NOT NULL, id TEXT NOT NULL, message TEXT NOT NULL, expires_at_ms INTEGER,
        PRIMARY KEY (source, id)) STRICT;
      CREATE INDEX IF NOT EXISTS core_taken_expiry ON core_taken (expires_at_ms) WHERE expires_at_ms IS NOT NULL`);
    const history = new History(db, this.#options.history);
    for (const open of this.#options.open ?? []) open(db);
    const statements = prepare(db);
    const outbox = new Outbox({
      sdk: this.#options.sdk, database: db,
      ...(this.#options.statePublication === undefined ? {} : {statePublication: this.#options.statePublication}),
      ...(this.#options.log === undefined ? {} : {log: this.#options.log}),
      ...(this.#options.trace === undefined ? {} : {trace: this.#options.trace}),
      ...(this.#options.onError === undefined ? {} : {onError: this.#options.onError}),
      // Every message of one transaction carries the transaction's instant.
      clock: {now: () => this.#frozen ?? this.#options.clock.now()},
    });
    return {outbox, statements, history};
  }

  /**
   * The one-time session reset (#1865, design decision 12): the first open that finds agent-state's old `state` table
   * drops it, empties the core's session and guard tables, and deletes the session family's published records, its
   * latest-history and span rows and the pending outbox messages of session states, removals and agent occurrences, in
   * one transaction. It raises the core's revision by one and publishes nothing, so the next sync serves the empty session
   * family at a revision no earlier payload carried. The old data's presence is its only key: once the table is gone, a
   * later open finds nothing to drop. Every other table and row stays, history fact rows and taken `(source, id)`s too.
   */
  #reset(): void {
    const db = this.#db;
    if (db.prepare('SELECT 1 FROM sqlite_master WHERE type = \'table\' AND name = \'state\'').get() === undefined) return;
    const routing = SESSION_ROUTING.map(prefix => `routing_key GLOB '${prefix}*'`).join(' OR ');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`DROP TABLE state;
        DELETE FROM core_sessions;
        DELETE FROM core_session_guards;
        DELETE FROM core_records WHERE family = 'session';
        DELETE FROM core_history_latest WHERE family = 'session';
        DELETE FROM core_history_span WHERE family = 'session';
        DELETE FROM bunny_outbox WHERE ${routing};
        INSERT INTO core_revision VALUES (1, 1, 1) ON CONFLICT (only) DO UPDATE SET value = value + 1, commits = commits + 1`);
      db.exec('COMMIT');
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
    try {
      if (this.#options.log !== undefined) recordLog(this.#options.log, 'operation.completed', {'bunny.operation': 'storage'});
    } catch {
      // Telemetry never changes a reset that committed.
    }
  }

  /** The revision, commit count, sessions, guards and published records as the file holds them. */
  #loadCaches(statements: Statements): void {
    const stored = statements.revision.get() as {value: number; commits: number} | undefined;
    const revision = stored?.value ?? 0, commits = stored?.commits ?? 0;
    const records = new Map<string, Session30Record>();
    const legacy: {id: string; revision: number}[] = [];
    for (const row of statements.records.all() as {record: string}[]) {
      const record = JSON.parse(row.record) as Session30Record | {id: string; revision: number};
      if ('status' in record) records.set(record.id, record);
      else legacy.push({id: record.id, revision: record.revision});
    }
    const sessions = new Map<string, StoredSession>();
    for (const row of statements.sessions.all() as {session: string}[]) {
      const session = JSON.parse(row.session) as StoredSession;
      sessions.set(session.id, session);
    }
    // A record a release before the switch to `session/3.0` published (#1865 step 9) is served as the session's
    // `session/3.0` record at the revision it was published at, so parts, commands, expiry and removals all find it. The
    // next change publishes it as `session/3.0`, or its removal, and history keeps that against its last `session/2.x` row.
    const built = publicRecords(sessions.values(), 0);
    for (const {id, revision: published} of legacy) {
      const record = built.get(id);
      if (record !== undefined) records.set(id, {...record, revision: published});
    }
    this.#legacy = new Set(legacy.map(({id}) => id));
    const guards = (statements.guards.all() as {guard: string}[]).map(row => JSON.parse(row.guard) as RetirementGuard);
    this.#revision = revision;
    this.#commits = commits;
    this.#records = records;
    this.#sessions = sessions;
    this.#guards = guards;
    this.#floorMs = Math.max(0, ...[...sessions.values()].map(session => session.lastEvidenceAtMs), ...guards.map(guard => guard.atMs));
  }

  #statements(): Statements {
    if (this.#opened === undefined) throw new SdkError(errorBody('unavailable', {detail: 'the core store is not open'}));
    return this.#opened.statements;
  }

  #outbox(): Outbox {
    if (this.#opened === undefined) throw new SdkError(errorBody('unavailable', {detail: 'the core store is not open'}));
    return this.#opened.outbox;
  }

  /**
   * Commits the plan and `extra` work in one transaction, then publishes its messages through the outbox. Resolves once
   * the transaction has committed, with the store's timer at the commit, without waiting for the publication: committed
   * is not published, and a refused publish is reported once, as `outbox.deferred`, and goes out later, unchanged.
   * Rejects, with nothing changed, when the transaction does not commit.
   */
  async #commit(plan: Plan, atMs: number, extra: (tx: CoreTransaction) => void): Promise<number> {
    const statements = this.#statements();
    const outbox = this.#outbox();
    const {history} = this;
    // What history keeps of this transaction, in the order it happened, written at its end with its revision.
    const entries: HistoryEntry[] = [];
    const required = new Set<Message<unknown>>();
    const historyChanges: WrittenChange[] | undefined = this.#historyAlarm === undefined ? undefined : [];
    let revision = plan.revision;
    const commits = this.#commits + 1;
    // A failure names only the commit it came from.
    this.#failure = undefined;
    const added: Message[] = [];
    let addTo: AddMessage = () => { throw new Error('add a message only inside the transaction'); };
    let adds = 0;
    const afterCommit: (() => void)[] = [];
    const tx: CoreTransaction = {
      database: this.#db, atMs,
      revision: () => {
        revision ??= this.#revision + 1;
        return revision;
      },
      afterCommit: apply => { afterCommit.push(apply); },
      add: (key, draft, options) => {
        adds += 1;
        const message = addTo(key, draft, options);
        entries.push({kind: 'message', message});
        return message;
      },
      requireRetained: message => { required.add(message); },
      take: (message, keepForMs) => { statements.take.run(message.source, message.id, JSON.stringify(message), keepForMs === undefined ? null : atMs + keepForMs); },
      record: message => { entries.push({kind: 'message', message}); },
      step: step => { entries.push({kind: 'operation', step}); },
    };
    this.#frozen = atMs;
    let sent: Promise<void>;
    try {
      sent = outbox.transaction(add => {
        addTo = add;
        extra(tx);
        for (const {key, draft} of plan.messages) {
          const message = tx.add(key, draft, plan.cause === undefined ? {} : {parent: plan.cause.message}) as Message;
          // A message the profile refuses rolls the whole change back: the core never commits what it cannot publish.
          const checked = this.#validator.validate(message);
          if (!checked.ok) throw new SdkError({error: checked.error});
          added.push(message);
        }
        plan.write?.(statements);
        for (const record of plan.records) statements.writeRecord.run('session', record.id, record.revision, JSON.stringify(record));
        for (const id of plan.removed) statements.deleteRecord.run('session', id);
        const observation = plan.cause?.observation;
        if (plan.cause !== undefined && observation !== undefined) {
          statements.prune.run(atMs);
          // Kept as long as the session logic still admits the observation, which it judges by the hook's own instant.
          tx.take(plan.cause.message, Math.max(0, observation.observedAtMs - atMs) + TAKEN_LIFECYCLE_MS);
        }
        // Only the operator's own save completes its action; tracked projections must be staged before derivation.
        plan.completing?.({revision: revision ?? this.#revision, messages: added}, tx);
        if (added.length > 0 || revision !== undefined) {
          const change: CoreChange = {revision: tx.revision(), messages: added};
          for (const derive of this.#options.derivers ?? []) derive(change, tx);
        }
        history.write(entries, atMs, revision ?? this.#revision, historyChanges, required);
        if (Number(statements.writeRevision.run(revision ?? this.#revision, commits).changes) !== 1) {
          throw new Error('the core commit revision was not stored');
        }
      });
    } finally {
      this.#frozen = undefined;
      addTo = () => { throw new Error('add a message only inside the transaction'); };
    }
    // The outbox has committed or rolled back by now; its sends start only once this synchronous work has returned.
    const committedAt = this.#timer();
    // A database that closed under the store, as a crash closes it, committed nothing; the outbox's refusal is taken
    // here, so it is never left unhandled.
    if (!this.#db.isOpen) {
      await sent.catch(() => {});
      this.#failure = 'failed';
      throw new Error('the core store\'s database is closed');
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
        this.#failure = fullDisk(error) ? 'full' : 'failed';
        throw error;
      }
      throw new Error('the core store did not commit');
    }
    this.#commits = commits;
    if (revision !== undefined) this.#revision = revision;
    for (const record of plan.records) {
      this.#records.set(record.id, record);
      this.#legacy.delete(record.id);
    }
    for (const id of plan.removed) {
      this.#records.delete(id);
      this.#legacy.delete(id);
    }
    plan.install?.();
    for (const apply of afterCommit) {
      try { apply(); }
      catch (error) {
        try {
          if (this.#options.log !== undefined) recordLog(this.#options.log, 'operation.failed',
            {'bunny.operation': 'automation', 'bunny.code': 'internal', ...errorFields(error)});
        } catch { /* A diagnostic failure cannot change a committed result. */ }
      }
    }
    if (historyChanges !== undefined) this.#historyAlarm?.committed(historyChanges, atMs);
    const publicationEnded=this.#options.committed?.({revision:this.#revision,messages:added});
    if (adds > 0) this.#options.beforePublish?.();
    const sending = sent.catch(() => {});
    this.#sending.add(sending);
    void sending.finally(() => {
      this.#sending.delete(sending);
      if(typeof publicationEnded==='function') publicationEnded();
    });
    return committedAt;
  }
}

/** How long the core keeps a lifecycle observation's `(source, id)`: as long as an observation can still be admitted. */
const TAKEN_LIFECYCLE_MS = 86_400_000;

type Opened = {outbox: Outbox; statements: Statements; history: History};

type Statements = {
  revision: StatementSync; writeRevision: StatementSync;
  records: StatementSync; writeRecord: StatementSync; deleteRecord: StatementSync;
  sessions: StatementSync; writeSession: StatementSync; deleteSession: StatementSync;
  guards: StatementSync; clearGuards: StatementSync; writeGuard: StatementSync;
  taken: StatementSync; take: StatementSync; prune: StatementSync;
};

// Statements are prepared once for the store's life: per-call preparation keeps native allocations until GC notices.
function prepare(db: DatabaseSync): Statements {
  return {
    revision: db.prepare('SELECT value, commits FROM core_revision WHERE only = 1'),
    writeRevision: db.prepare('INSERT INTO core_revision VALUES (1, ?, ?) ON CONFLICT (only) DO UPDATE SET value = excluded.value, commits = excluded.commits'),
    records: db.prepare('SELECT record FROM core_records WHERE family = \'session\' ORDER BY id'),
    writeRecord: db.prepare('INSERT INTO core_records VALUES (?, ?, ?, ?) ON CONFLICT (family, id) DO UPDATE SET revision = excluded.revision, record = excluded.record'),
    deleteRecord: db.prepare('DELETE FROM core_records WHERE family = ? AND id = ?'),
    // Sessions keep the order they were first stored in, which their records are published in.
    sessions: db.prepare('SELECT session FROM core_sessions ORDER BY rowid'),
    writeSession: db.prepare(`INSERT INTO core_sessions VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET revision = excluded.revision,
      generation = excluded.generation, session = excluded.session`),
    deleteSession: db.prepare('DELETE FROM core_sessions WHERE id = ?'),
    guards: db.prepare('SELECT guard FROM core_session_guards ORDER BY seq'),
    clearGuards: db.prepare('DELETE FROM core_session_guards'),
    writeGuard: db.prepare('INSERT INTO core_session_guards (id, at_ms, guard) VALUES (?, ?, ?)'),
    taken: db.prepare('SELECT message FROM core_taken WHERE source = ? AND id = ?'),
    take: db.prepare('INSERT INTO core_taken VALUES (?, ?, ?, ?)'),
    prune: db.prepare('DELETE FROM core_taken WHERE expires_at_ms IS NOT NULL AND expires_at_ms <= ?'),
  };
}

const familyOf = (draft: Draft<object>): string => draft.dataschema.slice('https://bunny.invalid/events/'.length).split('/')[0] ?? '';

function stateDraft(record: Session30Record): Draft<Session30Record> {
  // The lowest version that expresses the record (Hub #505, #2054): native records are session/3.1, or 3.2 once they name
  // their companions, every other one 3.0.
  return {kind: 'state', type: 'org.bunny.session.updated', subject: record.id, dataschema: sessionSchemaOf(record), data: record};
}

/** Each agent occurrence family's message type. */
const OCCURRENCE_TYPES: Record<Occurrence['family'], string> = {
  'attention-raised': 'org.bunny.attention.raised', 'attention-cleared': 'org.bunny.attention.cleared', 'turn-ended': 'org.bunny.turn.ended',
  'session-ended': 'org.bunny.session.ended',
};

function occurrence<T extends object>(family: Occurrence['family'], data: T & {session: string; identity: Identity}): Draft<T> & {subject: string} {
  // A native session's occurrences are 2.1, every other one's 2.0 (Hub #505).
  return {kind: 'occurrence', type: OCCURRENCE_TYPES[family], subject: data.session, dataschema: occurrenceSchemaOf(family, data.identity), data};
}
