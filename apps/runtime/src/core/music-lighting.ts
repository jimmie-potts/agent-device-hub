// #1272: the core owns each Nanoleaf light's Music lighting session (design D3, first-trial policy in #40). Saving an
// explicit Start or Stop completes the operator command; the light's module then gets one tracked work command. The
// session settles from the work reply and from the module's synced `music-lighting-device` record. Nothing here ever
// resumes, resends or picks another light or input: work goes out only in direct answer to an operator command.
import {createHash, randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {MessageValidator, errorBody, isErrorCode, type ErrorCode, type Message} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import type {LightingControl, LightingDeviceState, LightingEnded, LightingState, LightingWork} from '@jimmie-potts/event-contracts/v2/music-lighting';
import {Outcome, fullDisk, recordLog, type Cancel, type Command, type ModuleScheduler, type Reply, type StateDraft, type SyncedCopy, type TraceContext} from '@jimmie-potts/sdk';
import {Backoff} from './backoff.js';
import type {CoreHandle, CorePart} from './core.js';
import type {ModeParticipant} from './mode-participants.js';
import {pending} from './operations.js';
import type {CoreTransaction} from './store.js';
import type {CompletedOutcome, Tracked} from './tracker.js';

const SCHEMA = 'https://bunny.invalid/events/';
const STATE_SCHEMA = `${SCHEMA}music-lighting-state/2.0`;
const WORK_SCHEMA = `${SCHEMA}music-lighting-work/2.0`;
const OWNER = 'bunny/modules/nanoleaf';
const stateDraft = (data: LightingState): StateDraft<LightingState> => ({type: 'org.bunny.music-lighting.updated', subject: data.id, dataschema: STATE_SCHEMA, data});
const idle = (id: string): LightingState => ({id, revision: 0, session: {status: 'idle'}, last: null});

/** The core's capture session a Start binds to: present only while the endpoint is available and its session active. */
export type ActiveCapture = {endpointId: string; generation: string; input: 'music' | 'microphone'};

/** Private constructor authority, bound by core.ts to its tracker, as the Hub mode's is. */
export type LightingAdmission = {
  admit(command: Command<LightingControl>): boolean;
  complete(tx: CoreTransaction, command: Command<LightingControl>, result: Omit<CompletedOutcome, 'requestId'>): () => void;
  end(command: Command<LightingControl>): void;
};

/** Stable bounded work identity for one operator command and light: a duplicate operator command derives the same one. */
export const lightingWorkRequestId = (requestId: string, target: string): string =>
  `lighting-${createHash('sha256').update(JSON.stringify(['music-lighting-work', requestId, target])).digest('hex')}`;

type Follower = {fresh: boolean; pending: Promise<void>; retry: Backoff; cancel?: Cancel; copy?: SyncedCopy<LightingDeviceState>};
/**
 * Private per-session facts, stored beside the published record and never published: the current generation's Start
 * and latest Stop work IDs, and whether the module ever reported that generation.
 */
type Notes = {startWork?: string; stopWork?: string; reported?: boolean};
type Row = {state: LightingState; notes: Notes};

export class MusicLightingPart implements CorePart {
  readonly families = ['music-lighting-state'] as const;
  readonly #admission: LightingAdmission;
  readonly #scheduler: ModuleScheduler;
  readonly #capture: () => ActiveCapture | undefined;
  readonly #validator = new MessageValidator();
  #core: CoreHandle | undefined;
  #database: DatabaseSync | undefined;
  #targets: readonly string[] = [];
  #closed = false;
  #queue: Promise<unknown> = Promise.resolve();
  #follower: Follower | undefined;
  readonly #timers = new Set<Cancel>();
  /** The owner's latest record per light, from the synced copy's changes in order. */
  readonly #devices = new Map<string, LightingDeviceState>();

  constructor(admission: LightingAdmission, scheduler: ModuleScheduler, capture: () => ActiveCapture | undefined) {
    this.#admission = admission;
    this.#scheduler = scheduler;
    this.#capture = capture;
    registerCoreFamilies(this.#validator);
  }

  /** The qualified Nanoleaf lights, after host startup. Assignment sends nothing; it starts following their records. */
  setParticipants(participants: readonly ModeParticipant[]): void {
    this.#targets = Object.freeze(participants.filter(participant => participant.kind === 'nanoleaf').map(participant => participant.id));
    this.#follow();
  }

  open(database: DatabaseSync): void {
    database.exec('CREATE TABLE IF NOT EXISTS music_lighting (id TEXT PRIMARY KEY, record TEXT NOT NULL, notes TEXT NOT NULL DEFAULT \'{}\') STRICT');
    const columns = database.prepare('PRAGMA table_info(music_lighting)').all() as {name: string}[];
    if (!columns.some(column => column.name === 'notes')) database.exec('ALTER TABLE music_lighting ADD COLUMN notes TEXT NOT NULL DEFAULT \'{}\'');
    this.#database = database;
  }

  states(families: readonly string[]): StateDraft[] {
    if (!families.includes('music-lighting-state') || this.#database === undefined) return [];
    return this.#targets.map(id => stateDraft(this.#row(id).state));
  }

  /**
   * The tracker's change to one of this part's work commands, in that change's transaction. A Start the module never
   * admitted ends once its command can no longer be admitted; a Stop whose accepted work failed or timed out without a
   * device ending leaves the session uncertain. Reply refusals and lost replies are settled from the reply instead.
   */
  readonly tracked: Tracked = ({operation}, tx) => {
    if (operation.family !== 'music-lighting-work' || this.#database === undefined || this.#core === undefined || this.#closed) return;
    const row = this.#row(operation.target), session = row.state.session;
    if (session.status === 'idle' || session.generation !== operation.data.generation) return;
    if (operation.requestId === row.notes.startWork) {
      const ending = session.status === 'starting' || session.status === 'uncertain' ? this.#unheard(row, tx.atMs) : undefined;
      if (ending !== undefined) this.#end(tx, row, ending, operation);
    } else if (operation.requestId === row.notes.stopWork && session.status === 'stopping' && operation.reply === 'accepted' &&
      (operation.result === Outcome.failed || operation.result === Outcome.uncertain)) {
      this.#save(tx, {...row.state, session: {...session, status: 'uncertain'}}, row.notes, operation);
    }
  };

  start(core: CoreHandle): Promise<unknown> {
    this.#core = core;
    this.#follow();
    return core.sdk.respond<LightingControl>('bunny.cmd.music-lighting-control.*', command => this.#control(command));
  }

  /** At startup, before the gateway serves: every session not idle becomes uncertain. Nothing is sent again. */
  async recover(): Promise<void> {
    await this.#serial(async () => {
      const core = this.#required();
      const rows = await core.transaction(tx => {
        const rows = this.#rows();
        for (const row of rows) {
          if (row.state.session.status !== 'idle' && row.state.session.status !== 'uncertain') this.#save(tx, {...row.state, session: {...row.state.session, status: 'uncertain'}}, row.notes);
        }
        return rows;
      });
      // A Start whose reply was lost before the restart is decided at its outcome deadline, as before it.
      for (const {state, notes} of rows) {
        if (state.session.status !== 'idle' && notes.startWork !== undefined) this.#expireAt(state.id, state.session.generation, notes.startWork);
      }
      // A copy that synced before recovery finished settles the uncertain sessions now.
      if (this.#follower?.fresh === true) await this.#reconcile();
    }).catch(() => {this.#failed();});
  }

  async close(): Promise<void> {
    this.#closed = true;
    const follow = this.#follower;
    this.#follower = undefined;
    for (const cancel of this.#timers) cancel();
    this.#timers.clear();
    if (follow !== undefined) {follow.cancel?.();await follow.pending;await follow.copy?.close();}
    await this.#queue.catch(() => {});
  }

  #serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(work);
    this.#queue = result.catch(() => {});
    return result;
  }
  #required(): CoreHandle {if (this.#core === undefined) throw new Error('lighting-core-unavailable');return this.#core;}
  #db(): DatabaseSync {if (this.#database === undefined) throw new Error('lighting-store-unavailable');return this.#database;}
  #row(id: string): Row {
    const row = this.#db().prepare('SELECT record, notes FROM music_lighting WHERE id = ?').get(id) as {record: string; notes: string} | undefined;
    return row === undefined ? {state: idle(id), notes: {}} : {state: JSON.parse(row.record) as LightingState, notes: JSON.parse(row.notes) as Notes};
  }
  #rows(): Row[] {
    return (this.#db().prepare('SELECT record, notes FROM music_lighting ORDER BY id').all() as {record: string; notes: string}[])
      .map(row => ({state: JSON.parse(row.record) as LightingState, notes: JSON.parse(row.notes) as Notes}));
  }
  #save(tx: CoreTransaction, record: LightingState, notes: Notes, parent?: TraceContext): void {
    const next: LightingState = {...record, revision: tx.revision()};
    this.#db().prepare('INSERT INTO music_lighting VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET record = excluded.record, notes = excluded.notes')
      .run(next.id, JSON.stringify(next), JSON.stringify(notes));
    tx.add(`bunny.state.music-lighting-state.${next.id}`, {kind: 'state', ...stateDraft(next)}, parent === undefined ? undefined : {parent});
  }
  /** Keeps a private note without publishing: the record itself did not change. */
  #note(id: string, notes: Notes): void {
    this.#db().prepare('UPDATE music_lighting SET notes = ? WHERE id = ?').run(JSON.stringify(notes), id);
  }
  #end(tx: CoreTransaction, row: Row, last: LightingEnded, parent?: TraceContext): void {
    this.#save(tx, {...row.state, session: {status: 'idle'}, last}, row.notes, parent);
  }
  /** Whether the copy is fresh and the module holds no session of this generation. */
  #absent(id: string, generation: string): boolean {
    return this.#follower?.fresh === true && this.#devices.get(id)?.session?.generation !== generation;
  }
  /** Whether the module ever held this session: it reported the generation, or accepted its Start. */
  #heard({state, notes}: Row): boolean {
    if (notes.reported === true || state.session.status === 'active') return true;
    return notes.startWork !== undefined && this.#core?.operation(notes.startWork)?.reply === 'accepted';
  }
  /**
   * The ending of a Start the module never held, once that is certain: the copy is fresh and shows no session of this
   * generation, and the Start command was refused or has passed its outcome deadline. A command carries its expiry and
   * the module refuses an expired Start, so a Start past its deadline can no longer be admitted later. The ending is
   * `refused` with the refusal's code when one is known, otherwise `expired`.
   */
  #unheard(row: Row, atMs: number): LightingEnded | undefined {
    const session = row.state.session;
    if (session.status === 'idle' || row.notes.startWork === undefined || this.#heard(row) || !this.#absent(row.state.id, session.generation)) return undefined;
    const operation = this.#core?.operation(row.notes.startWork);
    if (operation === undefined || pending(operation)) return undefined;
    const refusal = operation.reply !== undefined && operation.reply !== 'accepted' ? operation.reply : undefined;
    if (refusal === undefined && atMs < operation.deadlineAtMs) return undefined;
    const reported = refusal ?? operation.error?.code;
    const code = isErrorCode(reported) && reported !== 'uncertain-result' && reported !== 'internal' ? reported : undefined;
    return {generation: session.generation, reason: code === undefined || code === 'expired' ? 'expired' : 'refused', restoration: 'none', atMs,
      ...(code === undefined ? {} : {code})};
  }
  /** Checks a lost Start again at its outcome deadline, when no tracker change may come. */
  #expireAt(target: string, generation: string, workId: string): void {
    const core = this.#core, operation = core?.operation(workId);
    if (core === undefined || operation === undefined || this.#closed) return;
    let timer: Cancel;
    try {timer = this.#scheduler.after(Math.max(0, operation.deadlineAtMs - core.clock.now()) + 1, () => {
      this.#timers.delete(timer);
      void this.#serial(async () => {
        if (this.#closed) return;
        await core.transaction(tx => {
          const row = this.#row(target), session = row.state.session;
          if (session.status !== 'starting' && session.status !== 'uncertain' || session.generation !== generation || row.notes.startWork !== workId) return;
          const ending = this.#unheard(row, tx.atMs);
          if (ending !== undefined) this.#end(tx, row, ending);
        });
      }).catch(() => {this.#failed();});
    });} catch {
      // The module is stopping, and its scheduler refuses new timers: nothing is left to settle in this run.
      return;
    }
    this.#timers.add(timer);
  }
  #failed(): void {
    const core = this.#core;
    if (core !== undefined && !this.#closed) recordLog(core.log, 'operation.failed', {'bunny.operation': 'storage', 'bunny.outcome': Outcome.failed, 'bunny.code': 'internal'});
  }

  async #control(input: Command<LightingControl>): Promise<Reply> {
    const checked = this.#validator.validate(input);
    if (!checked.ok) return errorBody(checked.error.code, {detail: 'the request is not a valid music lighting command'});
    if (!this.#admission.admit(input)) return errorBody('forbidden', {detail: 'this music lighting command has no dispatcher admission'});
    const command: Command<LightingControl> = {...input, data: structuredClone(input.data)};
    try {
      return await this.#serial(() => this.#decide(command));
    } catch (error) {
      this.#failed();
      return errorBody(fullDisk(error) ? 'capacity' : 'internal', {detail: 'the music lighting session could not be saved; the light was not addressed'});
    } finally {
      this.#admission.end(command);
    }
  }

  async #decide(command: Command<LightingControl>): Promise<Reply> {
    const core = this.#required();
    await core.ready;
    if (this.#closed || this.#database === undefined) return errorBody('unavailable', {detail: 'the music lighting owner is not running'});
    const target = command.subject, data = command.data;
    const requestId = lightingWorkRequestId(data.requestId, target);
    let committed: (() => void) | undefined, work: LightingWork | undefined;
    const answer = await core.transaction(tx => {
      if (Date.parse(command.expiresat ?? '') <= tx.atMs) return errorBody('expired', {detail: 'the music lighting command expired before it was taken'});
      if (!this.#targets.includes(target)) return errorBody('unavailable', {detail: 'the target is not a qualified Nanoleaf light'});
      const row = this.#row(target), current = row.state;
      if (data.expectedRevision !== current.revision) return errorBody('revision-conflict', {detail: 'the light\'s music lighting session changed; read it again'});
      let session: LightingState['session'], notes: Notes;
      if (data.action === 'start') {
        if (current.session.status !== 'idle') return errorBody('invalid-state', {detail: 'a music lighting session is already under way on this light'});
        const capture = this.#capture();
        if (capture === undefined) return errorBody('unavailable', {detail: 'no Music capture session is active'});
        if (capture.input !== 'music') return errorBody('unsupported-capability', {detail: 'live lighting renders the Music capture only, never a microphone'});
        if (capture.endpointId !== data.capture.endpointId || capture.generation !== data.capture.generation) {
          return errorBody('revision-conflict', {detail: 'the Music capture session changed; read it again'});
        }
        const generation = randomUUID(), bound = {endpointId: capture.endpointId, generation: capture.generation};
        session = {status: 'starting', generation, operationId: data.requestId, capture: bound, presetId: data.presetId, startedAtMs: tx.atMs};
        work = {requestId, generation, action: 'start', capture: bound, presetId: data.presetId};
        notes = {startWork: requestId, reported: false};
      } else {
        const previous = current.session;
        // A Stop while stopping is a new explicit command with its own work: a stop row can expire unseen.
        if (previous.status === 'idle') return errorBody('invalid-state', {detail: 'no music lighting session can be stopped on this light'});
        session = {...previous, status: 'stopping', operationId: data.requestId};
        work = {requestId, generation: previous.generation, action: 'stop'};
        notes = {...row.notes, stopWork: requestId};
      }
      this.#save(tx, {...current, session}, notes, command);
      tx.take(command);
      committed = this.#admission.complete(tx, command, {result: Outcome.succeeded, evidence: Outcome.observed});
      return {status: 'accepted'} as const;
    });
    if ('error' in answer) return answer;
    committed?.();
    if (work !== undefined) void this.#send(target, work, command);
    return answer;
  }

  /** One tracked work command; its refusal or loss settles only the session generation it was sent for. */
  async #send(target: string, work: LightingWork, parent: Command<LightingControl>): Promise<void> {
    const core = this.#required();
    let code: ErrorCode;
    try {
      const answer = await core.dispatch({key: `bunny.cmd.music-lighting-work.${target}`, requestedBy: core.sdk.source, requestId: work.requestId, parent,
        draft: {type: 'org.bunny.music-lighting.work.requested', subject: target, dataschema: WORK_SCHEMA, data: work}});
      if (work.action === 'start') this.#expireAt(target, work.generation, work.requestId);
      if (!('error' in answer)) return;
      code = answer.error.code;
    } catch {
      code = 'uncertain-result';
    }
    await this.#serial(() => this.#replied(target, work, code, parent)).catch(() => {this.#failed();});
  }

  async #replied(target: string, work: LightingWork, code: ErrorCode, parent: TraceContext): Promise<void> {
    if (this.#closed) return;
    const lost = code === 'uncertain-result' || code === 'internal';
    await this.#required().transaction(tx => {
      const row = this.#row(target), current = row.state, session = current.session;
      if (session.status === 'idle' || session.generation !== work.generation) return;
      if (work.action === 'start') {
        if (session.status !== 'starting' || row.notes.startWork !== work.requestId) return;
        if (lost) this.#save(tx, {...current, session: {...session, status: 'uncertain'}}, row.notes, parent);
        else this.#end(tx, row, {generation: work.generation, reason: code === 'expired' ? 'expired' : 'refused', restoration: 'none', atMs: tx.atMs, code}, parent);
        return;
      }
      // Only the latest Stop's reply decides; a superseded one changes nothing.
      if (session.status !== 'stopping' || row.notes.stopWork !== work.requestId) return;
      if (code !== 'invalid-state') {this.#save(tx, {...current, session: {...session, status: 'uncertain'}}, row.notes, parent);return;}
      // The module has no such session any more: its record decides, and without an ending the Stop stands.
      const device = this.#devices.get(target)?.session;
      this.#end(tx, row, device?.status === 'ended' && device.generation === work.generation ? device.ended
        : {generation: work.generation, reason: 'stopped', restoration: 'none', atMs: tx.atMs}, parent);
    });
  }

  /** One SDK copy of the Nanoleaf owner's records, with a capped backoff after a refusal or a failed copy. */
  #follow(): void {
    if (this.#core === undefined || this.#closed || this.#follower !== undefined || this.#targets.length === 0) return;
    const follow: Follower = {fresh: false, pending: Promise.resolve(), retry: new Backoff(1000, 30_000)};
    this.#follower = follow;
    this.#sync(follow);
  }
  #sync(follow: Follower): void {
    const core = this.#core;
    if (core === undefined || this.#closed || this.#follower !== follow) return;
    follow.pending = core.sdk.sync<LightingDeviceState>(['music-lighting-device'], change => {
      if (change.type === 'failed') {this.#retry(follow);return;}
      if (change.type === 'synced') {
        follow.fresh = true;
        void this.#serial(async () => {if (follow.fresh && this.#follower === follow) await this.#reconcile();}).catch(() => {this.#failed();});
        return;
      }
      if (change.type === 'removed') {this.#devices.delete(change.entity.id);return;}
      const message = change.message;
      if (message.source !== OWNER || message.subject !== message.data.id) return;
      this.#devices.set(message.subject, structuredClone(message.data));
      void this.#serial(() => this.#observe(message)).catch(() => {this.#failed();});
    }, {owner: OWNER, timeoutMs: 5000, onRestarted: () => {follow.fresh = false;}}).then(async result => {
      if (result.status !== 'synced') this.#retry(follow);
      else if (this.#closed || this.#follower !== follow) await result.copy.close();
      else {follow.copy = result.copy;follow.retry.reset();}
    }, () => {this.#retry(follow);});
  }
  #retry(follow: Follower): void {
    const core = this.#core;
    if (core === undefined || this.#closed || this.#follower !== follow || follow.cancel !== undefined) return;
    follow.fresh = false;
    const copy = follow.copy;
    delete follow.copy;
    void copy?.close();
    const now = core.clock.now();
    follow.retry.failed(now);
    try {
      follow.cancel = this.#scheduler.after(follow.retry.next - now, () => {
        delete follow.cancel;
        this.#sync(follow);
      });
    } catch {
      // The module is stopping (its scheduler refuses new timers); a stopped core follows nothing.
    }
  }

  /** The session's next record from its own generation's device record, or undefined when it does not change it. */
  #settled(record: LightingState, device: LightingDeviceState['session']): LightingState | undefined {
    const session = record.session;
    if (session.status === 'idle' || device === null || device.generation !== session.generation) return undefined;
    if (device.status === 'ended') return {...record, session: {status: 'idle'}, last: device.ended};
    if (device.status === 'playing' && (session.status === 'starting' || session.status === 'uncertain')) return {...record, session: {...session, status: 'active'}};
    return undefined;
  }

  /** A live device record: only its own generation's evidence moves the session. */
  async #observe(message: Message<LightingDeviceState>): Promise<void> {
    const core = this.#required();
    await core.ready;
    if (this.#closed || this.#database === undefined) return;
    await core.transaction(tx => {
      const row = this.#row(message.subject);
      this.#heardFrom(tx, row, message.data.session, message);
    });
  }

  /** Applies a device record of this session's own generation, noting that the module held it. */
  #heardFrom(tx: CoreTransaction, row: Row, device: LightingDeviceState['session'], parent?: TraceContext): boolean {
    const session = row.state.session;
    if (session.status === 'idle' || device === null || device.generation !== session.generation) return false;
    const notes = row.notes.reported === true ? row.notes : {...row.notes, reported: true};
    const next = this.#settled(row.state, device);
    if (next !== undefined) this.#save(tx, next, notes, parent);
    else if (notes !== row.notes) this.#note(row.state.id, notes);
    return true;
  }

  /**
   * A fresh copy: every session settles from its own generation's record. A session the owner no longer holds, once it
   * was active, stopping or uncertain, ended with the owner's restart if the owner ever held it; a Start it never held
   * ends `expired` or `refused` once that is certain, and waits otherwise. A Start still waits for its reply.
   */
  async #reconcile(): Promise<void> {
    const core = this.#required();
    await core.ready;
    if (this.#closed || this.#database === undefined) return;
    await core.transaction(tx => {
      for (const row of this.#rows()) {
        const session = row.state.session;
        if (session.status === 'idle' || this.#heardFrom(tx, row, this.#devices.get(row.state.id)?.session ?? null) || session.status === 'starting') continue;
        const ending = this.#heard(row) ? {generation: session.generation, reason: 'restart' as const, restoration: 'none' as const, atMs: tx.atMs} : this.#unheard(row, tx.atMs);
        if (ending !== undefined) this.#end(tx, row, ending);
      }
    });
  }
}
