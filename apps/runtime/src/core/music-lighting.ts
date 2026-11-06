// #1272: the core owns each Nanoleaf light's Music lighting session (design D3, first-trial policy in #40). Saving an
// explicit Start or Stop completes the operator command; the light's module then gets one tracked work command. The
// session settles from the work reply and from the module's synced `music-lighting-device` record. Nothing here ever
// resumes, resends or picks another light or input: work goes out only in direct answer to an operator command.
import {createHash, randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {MessageValidator, errorBody, type ErrorCode, type Message} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import type {LightingControl, LightingDeviceState, LightingEnded, LightingState, LightingWork} from '@jimmie-potts/event-contracts/v2/music-lighting';
import {Outcome, fullDisk, recordLog, type Cancel, type Command, type ModuleScheduler, type Reply, type StateDraft, type SyncedCopy, type TraceContext} from '@jimmie-potts/sdk';
import {Backoff} from './backoff.js';
import type {CoreHandle, CorePart} from './core.js';
import type {ModeParticipant} from './mode-participants.js';
import type {CoreTransaction} from './store.js';
import type {CompletedOutcome} from './tracker.js';

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
    database.exec('CREATE TABLE IF NOT EXISTS music_lighting (id TEXT PRIMARY KEY, record TEXT NOT NULL) STRICT');
    this.#database = database;
  }

  states(families: readonly string[]): StateDraft[] {
    if (!families.includes('music-lighting-state') || this.#database === undefined) return [];
    return this.#targets.map(id => stateDraft(this.#read(id)));
  }

  start(core: CoreHandle): Promise<unknown> {
    this.#core = core;
    this.#follow();
    return core.sdk.respond<LightingControl>('bunny.cmd.music-lighting-control.*', command => this.#control(command));
  }

  /** At startup, before the gateway serves: every session not idle becomes uncertain. Nothing is sent again. */
  async recover(): Promise<void> {
    await this.#serial(async () => {
      const core = this.#required();
      await core.transaction(tx => {
        for (const record of this.#records()) {
          if (record.session.status !== 'idle' && record.session.status !== 'uncertain') this.#save(tx, {...record, session: {...record.session, status: 'uncertain'}});
        }
      });
      // A copy that synced before recovery finished settles the uncertain sessions now.
      if (this.#follower?.fresh === true) await this.#reconcile();
    }).catch(() => {this.#failed();});
  }

  async close(): Promise<void> {
    this.#closed = true;
    const follow = this.#follower;
    this.#follower = undefined;
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
  #read(id: string): LightingState {
    const row = this.#db().prepare('SELECT record FROM music_lighting WHERE id = ?').get(id) as {record: string} | undefined;
    return row === undefined ? idle(id) : JSON.parse(row.record) as LightingState;
  }
  #records(): LightingState[] {
    return this.#db().prepare('SELECT record FROM music_lighting ORDER BY id').all().map(row => JSON.parse(String(row.record)) as LightingState);
  }
  #save(tx: CoreTransaction, record: LightingState, parent?: TraceContext): void {
    const next: LightingState = {...record, revision: tx.revision()};
    this.#db().prepare('INSERT INTO music_lighting VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET record = excluded.record').run(next.id, JSON.stringify(next));
    tx.add(`bunny.state.music-lighting-state.${next.id}`, {kind: 'state', ...stateDraft(next)}, parent === undefined ? undefined : {parent});
  }
  #end(tx: CoreTransaction, record: LightingState, last: LightingEnded, parent?: TraceContext): void {
    this.#save(tx, {...record, session: {status: 'idle'}, last}, parent);
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
      const current = this.#read(target);
      if (data.expectedRevision !== current.revision) return errorBody('revision-conflict', {detail: 'the light\'s music lighting session changed; read it again'});
      let session: LightingState['session'];
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
      } else {
        const previous = current.session;
        if (previous.status !== 'starting' && previous.status !== 'active' && previous.status !== 'uncertain') {
          return errorBody('invalid-state', {detail: 'no music lighting session can be stopped on this light'});
        }
        session = {...previous, status: 'stopping', operationId: data.requestId};
        work = {requestId, generation: previous.generation, action: 'stop'};
      }
      this.#save(tx, {...current, session}, command);
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
      const current = this.#read(target), session = current.session;
      if (session.status === 'idle' || session.generation !== work.generation) return;
      if (work.action === 'start') {
        if (session.status !== 'starting') return;
        if (lost) this.#save(tx, {...current, session: {...session, status: 'uncertain'}}, parent);
        else this.#end(tx, current, {generation: work.generation, reason: code === 'expired' ? 'expired' : 'refused', restoration: 'none', atMs: tx.atMs}, parent);
        return;
      }
      if (session.status !== 'stopping') return;
      if (code !== 'invalid-state') {this.#save(tx, {...current, session: {...session, status: 'uncertain'}}, parent);return;}
      // The module has no such session any more: its record decides, and without an ending the Stop stands.
      const device = this.#devices.get(target)?.session;
      this.#end(tx, current, device?.status === 'ended' && device.generation === work.generation ? device.ended
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
    follow.cancel = this.#scheduler.after(follow.retry.next - now, () => {
      delete follow.cancel;
      this.#sync(follow);
    });
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
      const next = this.#settled(this.#read(message.subject), message.data.session);
      if (next !== undefined) this.#save(tx, next, message);
    });
  }

  /**
   * A fresh copy: every session settles from its own generation's record, and a session the owner no longer holds,
   * once it was active, stopping or uncertain, ended with the owner's restart. A Start still waits for its reply.
   */
  async #reconcile(): Promise<void> {
    const core = this.#required();
    await core.ready;
    if (this.#closed || this.#database === undefined) return;
    await core.transaction(tx => {
      for (const record of this.#records()) {
        const session = record.session;
        if (session.status === 'idle') continue;
        const device = this.#devices.get(record.id)?.session ?? null;
        const next = this.#settled(record, device);
        if (next !== undefined) this.#save(tx, next);
        else if (session.status !== 'starting' && (device === null || device.generation !== session.generation)) {
          this.#end(tx, record, {generation: session.generation, reason: 'restart', restoration: 'none', atMs: tx.atMs});
        }
      }
    });
  }
}
