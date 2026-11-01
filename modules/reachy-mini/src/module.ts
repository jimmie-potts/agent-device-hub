import {createHash, randomUUID} from 'node:crypto';
import {errorBody, type ErrorCode, type Message} from '@jimmie-potts/event-contracts/v2';
import type {CompletedOutcome, DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {ModeState, SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {CompanionOpportunity} from '@jimmie-potts/event-contracts/v2/companions';
import {Outbox, Outcome, fullDisk, recordLog, type AddMessage, type BunnyModule, type StateDraft, type Keyed, type Cancel, type Command, type ModuleContext, type Reply, type SyncedCopy} from '@jimmie-potts/sdk';
import {configureReachy, type ReachyConfig} from './configuration.js';
import {families, gestures, controls, stages, schemaOf, typeOf, type Family, type Gesture, type Control, type Guards, type Observation, type ReachyState} from './contracts.js';
import {reachyValidator, stateSchema} from './families.js';
import {ReachyStore, type Row} from './store.js';
import {BeforeSendError, HttpReachy, type ReachyTransport, type MoveEvent} from './transport.js';
type Action = {kind: 'gesture'; gesture: Gesture; automatic: boolean; opportunityId?: string} | {kind: 'control'; action: Control} | {kind: 'stop'};
type Work = {command: Command<Guards>; row: Row; action: Action};
type Candidate = {expiresAtMs:number; id: string; value: CompanionOpportunity; parent: Message<CompanionOpportunity>};
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isGesture = (value: unknown): value is Gesture => gestures.some(item => item === value);
const isControl = (value: unknown): value is Control => controls.some(item => item === value);
const unknown = {status: 'unknown'} as const;
const unsupported = {supported: false} as const;
export function createReachyModule(options: {transport?: ReachyTransport} = {}): BunnyModule<ReachyConfig> {
  let owner: Owner | undefined;
  return {manifest: {name: 'reachy-mini', apiVersion: '1.3', configure: configureReachy,
    pages: [{id: 'controls', title: 'Reachy robot', presentation: 'react'}],
    tools: [{name: 'status', description: 'Read cached Reachy simulator availability, ownership and task evidence. Reading never moves the robot. Task cancellation and simulator pose do not establish physical stopping.',
      input: {type: 'object', additionalProperties: false, properties: {}}, output: stateSchema, read: () => owner?.status() ?? errorBody('unavailable')}],
  }, start: async context => {owner = new Owner(context, options.transport); await owner.start();}, stop: () => owner?.stop()};
}
class Owner {
  readonly #context: ModuleContext<ReachyConfig>;
  readonly #config: ReachyConfig;
  readonly #transport: ReachyTransport;
  readonly #store: ReachyStore;
  readonly #validator = reachyValidator();
  readonly #outbox: Outbox;
  readonly #abort = new AbortController();
  #state: ReachyState;
  #latest: (Observation & {observedAtMs: number}) | undefined;
  #connectionClose: (() => void) | undefined;
  #reconnect: Cancel | undefined;
  #stale: Cancel | undefined;
  #copy: SyncedCopy<SessionRecord | ModeState> | undefined;
  #synced = false;
  #closed = false;
  #storageDown = false;
  #serial: Promise<void> = Promise.resolve();
  #active: {work: Work; cancel: AbortController; promise: Promise<void>} | undefined;
  readonly #cancellations = new Map<string, Promise<void>>();
  #terminal = new Map<string, MoveEvent['type']>();
  #lastAutoAt = -Infinity;
  #candidate: Candidate | undefined;
  #offering=false;
  #candidateTimer: Cancel | undefined;
  #connectionAttempt = 0;
  constructor(context: ModuleContext<ReachyConfig>, transport?: ReachyTransport) {
    if (context.config === undefined) throw new Error('Reachy needs configuration');
    this.#context = context; this.#config = context.config; this.#transport = transport ?? new HttpReachy(context.config.endpoint);
    this.#store = new ReachyStore(context.database());this.#lastAutoAt=this.#store.lastAutomaticAt()??-Infinity;
    const prior = this.#store.state();
    this.#state = {id: this.#config.id, revision: prior?.revision ?? 0, configurationRevision: this.#config.configurationRevision,
      generation: {epoch: randomUUID(), sequence: 0}, simulated: true, connection: 'unknown', enabled: prior?.enabled ?? false,
      takeover: prior !== undefined, observation: null, active: null, pending: 0, held: prior?.held ?? null, lastRecovery:prior?.lastRecovery??null, lastOutcome: prior?.lastOutcome ?? null, lastTransmission: prior?.lastTransmission ?? unknown};
    this.#outbox = new Outbox({...context, database: context.database(), validator: this.#validator});
  }
  status(): ReachyState {return structuredClone(this.#state);}
  #device(): DeviceRecord {
    return {id: this.#state.id, kind: 'reachy-mini-simulated', revision: this.#state.revision, configurationRevision: this.#config.configurationRevision,
      generation: this.#state.generation, availability: this.#state.connection === 'available' ? this.#state.held === null ? 'available' : 'degraded' : 'unavailable',
      ...(this.#state.held === null ? {} : {held: {requestId: this.#state.held.requestId, heldAtMs: this.#state.held.heldAtMs}}),
      capabilities: {power: unsupported, brightness: unsupported, modes: unsupported, moments: unsupported, media: unsupported, scenes: unsupported, zones: unsupported, preview: unsupported},
      desired: {power: unknown, brightness: unknown, mode: unknown}, observed: unknown, pending: this.#state.pending,
      pendingKinds: [...new Set(this.#store.unfinished().map(row => row.family))],
      lastOutcome: this.#state.lastOutcome === null ? unknown : {status: 'known', outcome: this.#state.lastOutcome},
      lastTransmission: this.#state.lastTransmission, externalControl: unknown};
  }
  #drafts(): StateDraft<Keyed>[] {return [{type: 'org.bunny.device.updated', subject: this.#state.id, dataschema: schemaOf('device').replace('/2.0', '/2.1'), data: this.#device()},
    {type: 'org.bunny.reachy-state.updated', subject: this.#state.id, dataschema: schemaOf('reachy-state'), data: this.status()}];}
  #change(work: (add: AddMessage) => void, parent?: {traceparent: string}): Promise<void> {
    const task = this.#serial.then(async () => {
      if (this.#storageDown) throw new Error('Reachy storage unavailable');
      const before = this.status();
      try {
        await this.#outbox.transaction(add => {
          work(add); this.#state.pending = this.#store.unfinished().length; this.#state.revision++; this.#store.saveState(this.#state);
          for (const draft of this.#drafts()) add(`bunny.state.${draft.type === 'org.bunny.device.updated' ? 'device' : 'reachy-state'}.${this.#state.id}`, {kind: 'state', ...draft}, parent === undefined ? {} : {parent});
        });
      } catch (error) {this.#state = before; this.#storageDown = true; this.#interrupt(); recordLog(this.#context.log, 'operation.failed', {'bunny.operation': 'storage', 'bunny.code': 'internal'}, parent); throw error;}
    });
    this.#serial = task.catch(() => {}); return task;
  }
  async start(): Promise<void> {
    for (const family of families) await this.#context.sdk.respond<Guards>(`bunny.cmd.${family}.*`, command => this.#admit(family, command));
    await this.#context.sdk.serveSync(['device', 'reachy-state'], request => ({revision: this.#state.revision,
      states: this.#drafts().filter(draft => request.data.families.includes(draft.type === 'org.bunny.device.updated' ? 'device' : 'reachy-state'))}));
    for (const row of this.#store.unfinished()) await this.#finish(row, {requestId: row.requestId, result: row.started ? Outcome.uncertain : Outcome.failed, evidence: Outcome.none, error: errorBody(row.started ? 'uncertain-result' : 'cancelled').error});
    await this.#change(() => {}); await this.#outbox.republish();
    this.#context.scheduler.after(0, () => {void this.#connect(); void this.#follow();});
    await this.#context.sdk.subscribe<CompanionOpportunity>('bunny.event.companion-opportunity.reachy', message => this.#opportunity(message));
  }
  async #follow(): Promise<void> {
    if (this.#closed) return;
    this.#synced = false;
    try {
      const result = await this.#context.sdk.sync<SessionRecord | ModeState>(['session', 'mode'], change => {
        if (change.type === 'failed') {this.#synced = false; this.#interruptAutomatic(); this.#context.scheduler.after(1000, () => {void this.#follow();});}
        else {if (change.type === 'synced') this.#synced = true; this.#checkAutomatic();}
      }, {owner: 'bunny/core', timeoutMs: 2000, onRestarted: () => {this.#synced = false; this.#interruptAutomatic();}});
      if (this.#closed) {if (result.status === 'synced') await result.copy.close(); return;}
      if (result.status === 'synced') {await this.#copy?.close(); this.#copy = result.copy; this.#synced = true; this.#checkAutomatic();}
      else this.#context.scheduler.after(1000, () => {void this.#follow();});
    } catch {if (!this.#closed) this.#context.scheduler.after(1000, () => {void this.#follow();});}
  }
  async #connect(): Promise<void> {
    if (this.#closed || this.#storageDown) return;
    const attempt = ++this.#connectionAttempt;
    try {
      this.#connectionClose?.();
      this.#connectionClose = await this.#transport.connect({
        state: value => {
          if (this.#closed || attempt !== this.#connectionAttempt) return;
          this.#latest = {...value, observedAtMs: this.#context.clock.now()};
          this.#stale?.();
          this.#stale = this.#context.scheduler.after(2000, () => {this.#lost('stale');});
          if (this.#state.connection !== 'available' || this.#context.clock.now() - (this.#state.observation?.observedAtMs ?? 0) >= 500) void this.#change(() => {if (this.#state.connection !== 'available') this.#state.generation.sequence++; this.#state.connection = 'available'; this.#state.observation = this.#latest ?? null;}).catch(() => {});
        },
        event: value => {if (attempt !== this.#connectionAttempt || this.#closed) return; this.#terminal.set(value.uuid, value.type); if (this.#terminal.size > 16) this.#terminal.delete(this.#terminal.keys().next().value ?? '');},
        lost: mismatch => {if (attempt === this.#connectionAttempt) this.#lost(mismatch === true ? 'mismatch' : 'unavailable');},
      }, this.#abort.signal);
    } catch {if(attempt===this.#connectionAttempt)this.#lost('unavailable');}
  }
  #lost(connection: ReachyState['connection']): void {
    if (this.#closed) return;
    this.#connectionAttempt++;this.#connectionClose?.();this.#connectionClose=undefined;this.#stale?.();
    this.#latest = undefined; this.#interrupt();
    void this.#change(() => {this.#state.connection = connection; this.#state.observation = null; this.#state.generation.sequence++;}).catch(() => {});
    this.#reconnect?.(); this.#reconnect = this.#context.scheduler.after(1000, () => {void this.#connect();});
  }
  #fresh(): boolean {const now = this.#context.clock.now(); return this.#state.connection === 'available' && this.#latest !== undefined && now >= this.#latest.observedAtMs && now - this.#latest.observedAtMs < 2000;}
  #mode(): string | undefined {return this.#copy?.states().map(x => x.data).find((x): x is ModeState => 'mode' in x)?.mode;}
  #eligible(event: CompanionOpportunity): boolean {
    if (!this.#synced || this.#mode() === undefined || this.#mode() === 'quiet' || event.context !== 'live' || event.session === null || this.#context.clock.now() >= event.validUntilMs) return false;
    const session = this.#copy?.states().map(x => x.data).find((x): x is SessionRecord => 'identity' in x && x.id === event.session);
    if (session === undefined || session.freshness !== 'current' || session.restartUncertain || session.generation !== event.generation) return false;
    if (event.category === 'coding-attention') return event.attention !== null && session.attention.some(x => x.kind === event.attention?.kind && JSON.stringify(x.id) === JSON.stringify(event.attention?.id));
    return event.category === 'coding-notice' && event.noticeId !== null && session.notices.some(x => x.id === event.noticeId && !x.acknowledgedBy.includes('reachy-mini'));
  }
  #checkAutomatic(): void {if(!this.#synced||this.#mode()===undefined||this.#mode()==='quiet'){this.#interruptAutomatic();return;}if (this.#active?.work.action.kind === 'gesture' && this.#active.work.action.automatic && !this.#candidateEligible(this.#active.work.action.opportunityId)) this.#interruptAutomatic();}
  readonly #opportunities = new Map<string, {event:CompanionOpportunity;expiresAtMs:number}>();
  #candidateEligible(id?: string): boolean {const event = id === undefined ? undefined : this.#opportunities.get(id); return event !== undefined && this.#context.clock.now() < event.expiresAtMs && this.#eligible(event.event);}
  async #opportunity(message: Message<CompanionOpportunity>): Promise<void> {
    if (this.#closed || message.source !== 'bunny/core' || !this.#validator.validate(message).ok) return;
    const id = createHash('sha256').update(message.data.origin.source + ':' + message.data.origin.id).digest('hex');
    const expiresAtMs=Math.min(this.#context.clock.now()+5000,message.data.validUntilMs);
    let first=false;
    try {await this.#change(()=>{first=this.#store.consume(id);},message);}catch{return;}
    if(!first||this.#closed||this.#context.clock.now()>=expiresAtMs||!this.#eligible(message.data)||!this.#state.enabled||this.#state.takeover||!this.#fresh()||this.#state.held!==null)return;
    const value = {expiresAtMs, id, value: message.data, parent: message};
    if (this.#candidate !== undefined && this.#candidate.value.category === 'coding-attention' && message.data.category !== 'coding-attention') return;
    this.#candidate = value; this.#opportunities.set(id, {event:value.value,expiresAtMs:value.expiresAtMs});
    if (this.#opportunities.size > 32) this.#opportunities.delete(this.#opportunities.keys().next().value ?? '');
    this.#candidateTimer?.(); this.#candidateTimer = this.#context.scheduler.after(Math.max(0,expiresAtMs-this.#context.clock.now()), () => {if (this.#candidate?.id === id) this.#candidate = undefined;});
    void this.#offer();
  }
  async #offer(): Promise<void> {
    if(this.#offering)return;
    const candidate = this.#candidate;
    if (candidate === undefined || this.#state.active !== null) return;
    if (this.#context.clock.now() - this.#lastAutoAt < 30000) {this.#candidate = undefined; return;}
    this.#candidate = undefined;
    if (this.#context.clock.now() >= candidate.expiresAtMs || !this.#eligible(candidate.value) || !this.#fresh() || !this.#state.enabled || this.#state.takeover || this.#state.held !== null) return;
    this.#offering=true;
    try {
    try {await this.#change(() => {this.#store.automaticAt(this.#context.clock.now());},candidate.parent);} catch {return;}
    this.#lastAutoAt = this.#context.clock.now();
    const requestId = randomUUID();
    await this.#context.sdk.request('bunny.cmd.reachy-dispatch.reachy', {type: 'org.bunny.reachy.dispatch.requested', subject: 'reachy',
      dataschema: schemaOf('reachy-dispatch'), data: {target: this.#config.id, gesture: candidate.value.category === 'coding-attention' ? 'attention' : 'notice', opportunityId: candidate.id, validUntilMs:candidate.expiresAtMs,
        expectedConfigurationRevision: this.#state.configurationRevision, expectedGeneration: this.#state.generation}},
    {requestId, timeoutMs: Math.max(1, Math.min(5000, candidate.value.validUntilMs - this.#context.clock.now())), parent: candidate.parent}).catch(() => {});
    }finally{this.#offering=false;if(this.#candidate!==undefined)void this.#offer();}
  }
  #interrupt(): void {this.#opportunities.clear();this.#candidate = undefined; this.#active?.cancel.abort();}
  #interruptAutomatic(): void {this.#opportunities.clear();this.#candidate = undefined; if (this.#active?.work.action.kind === 'gesture' && this.#active.work.action.automatic) this.#active.cancel.abort();}
  #guard(command: Command<Guards>, action: Action): ErrorCode | undefined {
    const data = command.data;
    if (command.subject !== this.#config.id) return 'not-found';
    if (this.#closed || this.#storageDown) return 'unavailable';
    if (Date.parse(command.expiresat ?? '') <= this.#context.clock.now()) return 'expired';
    if (data.expectedConfigurationRevision !== undefined && data.expectedConfigurationRevision !== this.#state.configurationRevision ||
      data.expectedGeneration !== undefined && JSON.stringify(data.expectedGeneration) !== JSON.stringify(this.#state.generation)) return 'revision-conflict';
    if (action.kind === 'control' && ['disable-auto', 'takeover'].includes(action.action)) return undefined;
    if (action.kind !== 'stop' && !this.#fresh()) return 'unavailable';
    if (this.#state.held === null && data.recovered === true) return 'invalid-state';
    if (this.#state.held !== null && (data.recovered !== true || data.heldRequestId !== this.#state.held.requestId || data.expectedGeneration === undefined || data.expectedConfigurationRevision === undefined || action.kind === 'control')) return 'invalid-state';
    if (action.kind === 'stop' && this.#state.held !== null && this.#state.held.moveId === null) return 'invalid-state';
    if (action.kind === 'gesture') {
      if (action.automatic && (typeof data.validUntilMs !== 'number' || data.validUntilMs <= this.#context.clock.now())) return 'expired';
      if (action.automatic) return command.source !== 'bunny/core' ? 'forbidden' : !this.#state.enabled || this.#state.takeover || !this.#candidateEligible(action.opportunityId) ? 'invalid-state' : undefined;
      if (!this.#state.takeover) return 'invalid-state';
    }
    if (action.kind === 'control' && ['enable-auto','resume-auto'].includes(action.action) && (data.expectedGeneration === undefined || data.expectedConfigurationRevision === undefined)) return 'invalid-request';
    if (action.kind === 'control' && ['enable-auto','resume-auto'].includes(action.action) && (!this.#synced || this.#mode() === undefined || this.#state.active !== null)) return 'invalid-state';
    if (action.kind === 'control' && action.action === 'enable-auto' && this.#state.takeover) return 'invalid-state';
    return undefined;
  }
  async #admit(family: Family, command: Command<Guards>): Promise<Reply> {
    if (!this.#validator.validate(command).ok || command.type !== typeOf(family) || command.dataschema !== schemaOf(family)) return errorBody('invalid-message');
    const data: unknown = command.data;
    if (!object(data)) return errorBody('invalid-message');
    let action: Action;
    if (family === 'reachy-stop') action = {kind: 'stop'};
    else if (family === 'reachy-control' && isControl(data.action)) action = {kind: 'control', action: data.action};
    else if ((family === 'reachy-gesture' || family === 'reachy-auto') && isGesture(data.gesture)) action = {kind: 'gesture', gesture: data.gesture, automatic: family === 'reachy-auto', ...(typeof data.opportunityId === 'string' ? {opportunityId: data.opportunityId} : {})};
    else return errorBody('invalid-message');
    const digest = createHash('sha256').update(JSON.stringify({source: command.source, family, target: command.subject, data: command.data})).digest('hex');
    const row: Row = {requestId: command.data.requestId, family, digest, traceparent: command.traceparent, started: false, moveId: null};
    let refusal: ErrorCode | undefined, accepted = false;
    try {
      await this.#change(() => {
        const old = this.#store.row(row.requestId);
        if (old !== undefined) {refusal = 'duplicate-conflict'; return;}
        refusal = this.#guard(command, action); if (refusal !== undefined) return;
        if (action.kind === 'gesture' && (this.#state.active !== null || this.#state.pending > 0)) {refusal = 'capacity'; return;}
        if (this.#state.pending >= (action.kind === 'stop' ? 128 : 127)) {refusal = 'capacity'; return;}
        if (this.#state.held !== null && command.data.recovered === true && command.data.heldRequestId === this.#state.held.requestId && action.kind !== 'control') row.recoveryOf = this.#state.held.requestId;
        this.#store.save(row);
        if (action.kind === 'gesture') this.#state.active = {requestId:row.requestId,gesture:action.gesture,moveId:null,automatic:action.automatic};
        accepted = true;
      }, command);
    } catch (error) {return errorBody(fullDisk(error) ? 'capacity' : 'internal');}
    if (!accepted) return errorBody(refusal ?? 'internal');
    const work = {command, row, action};
    if (action.kind === 'gesture') {
      const cancel = new AbortController();
      const promise = Promise.resolve().then(() => this.#execute(work, cancel.signal)).finally(() => {if (this.#active?.work === work) this.#active = undefined; void this.#offer();});
      this.#active = {work, cancel, promise};
    } else void this.#control(work).catch(() => {});
    return {status: 'accepted'};
  }
  async #control(work: Work): Promise<void> {
    const {action,row,command}=work;if(action.kind==='gesture')return;
    let refusal:ErrorCode|undefined,cancellation:string|null=null,afterLatch:string|undefined;
    try {
      await this.#change(()=>{
        refusal=this.#guard(command,action);if(refusal!==undefined)return;
        if(action.kind==='stop'||action.action==='takeover'){
          const uuid=this.#state.active?.moveId??(action.kind==='stop'?this.#state.held?.moveId:undefined);
          this.#interrupt();this.#state.enabled=false;this.#state.takeover=true;this.#state.generation.sequence++;afterLatch=JSON.stringify(this.#state.generation);
          if(uuid!==undefined&&uuid!==null){cancellation=uuid;row.started=true;row.moveId=uuid;this.#store.save(row);}
        }else if(action.action==='disable-auto'){this.#interruptAutomatic();this.#state.enabled=false;}
        else {this.#state.enabled=true;this.#state.takeover=false;}
      },command);
      if(refusal!==undefined){await this.#finish(row,{requestId:row.requestId,result:Outcome.failed,evidence:Outcome.none,error:errorBody(refusal).error});return;}
      if(cancellation!==null){await this.#cancelOwned(cancellation,row,()=>{if(this.#closed||this.#storageDown||Date.parse(command.expiresat??'')<=this.#context.clock.now()||JSON.stringify(this.#state.generation)!==afterLatch)throw new BeforeSendError('cancellation fenced');});await this.#transmitted(row);}
      await this.#finish(row,{requestId:row.requestId,result:Outcome.succeeded,evidence:row.started?Outcome.transmitted:Outcome.observed});
    }catch(error){const uncertain=row.started&&!(error instanceof BeforeSendError);await this.#finish(row,{requestId:row.requestId,result:uncertain?Outcome.uncertain:Outcome.failed,evidence:Outcome.none,error:errorBody(uncertain?'uncertain-result':'unavailable').error});}
  }
  #sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const fail = (): void => {cancel(); signal.removeEventListener('abort', fail); reject(new Error('cancelled'));};
      const cancel = this.#context.scheduler.after(ms, () => {signal.removeEventListener('abort', fail); resolve();});
      signal.addEventListener('abort', fail, {once: true}); if (signal.aborted) fail();
    });
  }
  async #vendor<T>(row:Row,operation:string,work:()=>Promise<T>):Promise<T> {const span=this.#context.trace.start('bunny.device.call',{parent:row,kind:'client',attributes:{'bunny.device.id':this.#config.id,'bunny.operation':operation}});try{const result=await work();span.end('unset');return result;}catch(error){span.end('error');throw error;}}
  async #execute(work: Work, signal: AbortSignal): Promise<void> {
    const {row, command, action} = work; if (action.kind !== 'gesture') return;
    let sent = false, transmitted = false, pendingWrite = false, code: ErrorCode = 'uncertain-result';
    try {
      signal.throwIfAborted();
      for (const target of stages(action.gesture)) {
        const guard = this.#guard(command, action); if (guard !== undefined) {code = guard; throw new Error('fenced');}
        signal.throwIfAborted();
        await this.#change(() => {row.started = true; row.moveId = null; this.#store.save(row);}, command);
        const final = this.#guard(command, action); if (final !== undefined) {code = final; throw new Error('fenced');}
        signal.throwIfAborted();
        const saved = this.#store.row(row.requestId); if (saved?.digest !== row.digest || saved.outcome !== undefined) {code = 'internal'; throw new Error('fence changed');}
        const start = this.#context.clock.now();
        pendingWrite = false;
        const uuid = await this.#vendor(row,'moment',()=>this.#transport.move(target, AbortSignal.any([signal, this.#abort.signal, AbortSignal.timeout(2000)]), () => {const guarded = this.#guard(command,action); if (guarded !== undefined || signal.aborted) {code = guarded ?? 'cancelled'; throw new Error('effect fenced');} sent = true; pendingWrite = true;}));
        row.moveId = uuid; pendingWrite = false; transmitted = true;
        await this.#transmitted(row);
        await this.#change(() => {this.#store.save(row); if (this.#state.active?.requestId === row.requestId) this.#state.active.moveId = uuid;}, command);
        while (true) {
          const live = this.#guard(command, action); if (live !== undefined) {code = live; throw new Error('fenced');}
          signal.throwIfAborted();
          const terminal = this.#terminal.get(uuid);
          if (terminal === 'move_failed' || terminal === 'move_cancelled') {code = 'cancelled'; throw new Error('task ended');}
          if (terminal === 'move_completed' && this.#latest !== undefined && this.#latest.observedAtMs >= start &&
            this.#latest.antennas.every((value, index) => Math.abs(value - (target[index] ?? 0)) < .08)) break;
          if (this.#context.clock.now() - start > 1800) throw new Error('missing task evidence');
          await this.#sleep(20, signal);
        }
        this.#terminal.delete(uuid); row.moveId = null;
        await this.#change(() => {this.#store.save(row); if(this.#state.active?.requestId === row.requestId) this.#state.active.moveId = null;}, command);
      }
      await this.#finish(row, {requestId: row.requestId, result: Outcome.succeeded, evidence: Outcome.transmitted});
    } catch {
      if (signal.aborted && !pendingWrite) code = 'cancelled';
      if (row.moveId !== null) {
        try {await this.#cancelOwned(row.moveId,row);}
        catch {code = 'uncertain-result';}
      }
      const uncertain = sent && (pendingWrite || code === 'uncertain-result');
      await this.#finish(row, {requestId: row.requestId, result: uncertain ? Outcome.uncertain : Outcome.failed, evidence: transmitted ? Outcome.transmitted : Outcome.none,
        error: errorBody(uncertain ? 'uncertain-result' : signal.aborted ? 'cancelled' : code).error});
    }
  }
  async #cancelOwned(uuid: string,row:Row,beforeEffect?:()=>void): Promise<void> {
    const key=row.recoveryOf===undefined?uuid:uuid+'@'+row.requestId;
    let pending = this.#cancellations.get(key);
    if (pending === undefined) {pending = this.#vendor(row,'moment',()=>this.#transport.cancel(uuid, AbortSignal.any([this.#abort.signal, AbortSignal.timeout(2000)]),beforeEffect)); this.#cancellations.set(key,pending);if(this.#cancellations.size>64)this.#cancellations.delete(this.#cancellations.keys().next().value??'');}
    await pending;
  }
  async #transmitted(row: Row): Promise<void> {await this.#change(() => {this.#state.lastTransmission = {status:'known',requestId:row.requestId,transmittedAtMs:this.#context.clock.now(),operationIds:[]};},row);}
  async #finish(row: Row, outcome: CompletedOutcome): Promise<void> {
    try {await this.#change(add => {
      row.outcome = outcome; this.#store.save(row);
      if (outcome.result === Outcome.uncertain) {this.#state.held = {requestId: row.requestId, heldAtMs: this.#context.clock.now(), moveId: row.moveId}; this.#state.enabled = false; this.#state.takeover = true;}
      else if (outcome.result === Outcome.succeeded && row.recoveryOf !== undefined && this.#state.held?.requestId === row.recoveryOf) {this.#state.held=null;this.#state.lastRecovery={requestId:row.requestId,heldRequestId:row.recoveryOf};this.#state.generation.sequence++;}
      if (this.#state.active?.requestId === row.requestId) {this.#state.active = null; this.#state.pending = 0;}
      this.#state.lastOutcome = outcome; this.#state.observation = this.#latest ?? null;
      add(`bunny.event.${row.family}.${this.#config.id}`, {kind: 'outcome', type: typeOf(row.family).replace('.requested', '.completed'), subject: this.#config.id, dataschema: schemaOf('outcome'), data: outcome}, {parent: row});
    }, row);
    recordLog(this.#context.log, 'command.completed', {'bunny.device.id': this.#config.id, 'bunny.request.id': row.requestId, 'bunny.outcome': outcome.result}, row);
    } catch {/* Storage remains fenced; no command is replayed. */}
  }
  async stop(): Promise<void> {
    this.#closed = true; this.#interrupt(); this.#abort.abort(); this.#stale?.(); this.#reconnect?.(); this.#candidateTimer?.(); this.#connectionClose?.();
    await this.#active?.promise; await this.#copy?.close(); await this.#serial;
  }
}
