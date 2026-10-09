// Hub #925: live core occurrences -> the reused arbitration -> tracked runtime dispatch.
import {createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {AgentOccurrence, SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {CoreHandle, CorePart} from './core.js';
import {AutomationStore} from './automation-store.js';
import {AutomationError, createAutomation, DEFAULT_INTERRUPT_SET, DEFAULT_SETTINGS, type Automation, type LogEntry} from './automation.js';
import type {ModeParticipant} from './mode-participants.js';
import type {CoreChange} from './store.js';
import type {Operation} from './operations.js';

const KINDS = new Map([
  ['org.bunny.attention.raised','attention-raised'], ['org.bunny.attention.cleared','attention-cleared'],
  ['org.bunny.turn.ended','turn-ended'], ['org.bunny.session.ended','session-ended'],
]);
const opaque = (value: string): string => createHash('sha256').update(value).digest('hex');
export type AutomationControls = Omit<Automation,'submit'|'close'|'log'> & {log(limit:number,before?:number):(LogEntry & {operation?:Operation})[]};

export class AutomationPart implements CorePart {
  #handle: CoreHandle | undefined;
  #automation: Automation | undefined;
  #closed = false;
  #participants: readonly ModeParticipant[] = [];
  readonly #devices = new Map<string, Message<DeviceRecord>>();
  readonly #sessions = new Map<string, SessionRecord>();
  // Only a committed live reduction can mint eligibility. Consumed on first publication; not reconstructed at start.
  readonly #live = new Set<string>();
  readonly #publishing = new Set<string>();
  setParticipants(participants: readonly ModeParticipant[]): void { this.#participants=participants; }
  open(database: DatabaseSync): void {
    const handle=this.#handle;
    if (handle===undefined) throw new Error('automation-not-started');
    const store=new AutomationStore(database,()=>{if(this.#closed) throw new Error('automation-closed');},
      {settings:DEFAULT_SETTINGS,interruptSet:[...DEFAULT_INTERRUPT_SET]});
    this.#automation=createAutomation({store,clock:()=>handle.clock.now(),monotonic:()=>handle.clock.now(),active:()=>!this.#closed,
      routed:()=>this.#participants.map(p=>p.id),
      targets:id=>{
        const participant=this.#participants.find(p=>p.id===id), message=this.#devices.get(id);
        const record=message?.data;
        if(participant===undefined || message?.source!==`bunny/modules/${participant.kind}` || record===undefined || record.availability!=='available' || record.held!==undefined)
          return Promise.resolve({presentation:'unknown',alert:'unknown',moments:'unknown',unavailable:true});
        const mode=record.desired.mode.status==='known'?record.desired.mode.value:undefined;
        return Promise.resolve({presentation:mode==='quiet'?'quiet':mode==='work'?'status':mode==='free'?'content':'quiet',
          alert:[...this.#sessions.values()].some(s=>s.attention.length>0)?'active':'none',
          moments:record.capabilities.moments.supported?'supported':'unsupported'});
      },
      sender:async(target,moment)=>{
        const {startAtHubMs=handle.clock.now(),...data}=moment;
        const requestId=`automation-${opaque(`${moment.momentId}\0${target}`)}`;
        const answer=await handle.dispatch({requestId,key:`bunny.cmd.moment-play.${target}`,requestedBy:'bunny/core',
          draft:{type:'org.bunny.moment.play.requested',subject:target,dataschema:'https://bunny.invalid/events/moment-play/2.0',
            data:{...data,startAtMs:startAtHubMs,toleranceMs:10000}}});
        return 'error' in answer ? (answer.error.code==='uncertain-result' || answer.error.code==='internal') ? {kind:'uncertain',momentId:moment.momentId,requestId} : {kind:'not-sent',momentId:moment.momentId,reason:answer.error.code,requestId}
          : {kind:'receipt',momentId:moment.momentId,requestId:answer.requestId,status:'accepted'};
      }});
  }
  /** Only the first attempt of the original batch can deliver an eligible live occurrence. */
  publishing(message:Message<unknown>):()=>void {
    if(this.#live.delete(message.id)) {
      this.#publishing.add(message.id);
      if(this.#publishing.size>4096) {const oldest=this.#publishing.values().next().value;if(oldest!==undefined) this.#publishing.delete(oldest);}
    }
    return ()=>{this.#publishing.delete(message.id);this.#live.clear();};
  }
  publicationEnded(change:CoreChange):void {
    for(const message of change.messages) this.#live.delete(message.id);
  }
  committed(change: CoreChange): void {
    for (const message of change.messages) {
      if(message.kind==='state' && message.type==='org.bunny.session.updated') this.#sessions.set(message.subject,message.data as SessionRecord);
      if(message.kind==='removal') this.#sessions.delete(message.subject);
      if(message.kind==='occurrence' && KINDS.has(message.type)) {
        this.#live.add(message.id);
        // Bound unpublishable live marks. Dropping an eligible occurrence is safe; replaying one is not.
        if(this.#live.size>4096) {const oldest=this.#live.values().next().value;if(oldest!==undefined) this.#live.delete(oldest);}
      }
    }
  }
  async start(handle: CoreHandle): Promise<void> {
    this.#handle=handle;
    await Promise.all([
      handle.sdk.subscribe<DeviceRecord>('bunny.state.device.*', message=>{
        if(message.kind!=='state' || !message.source.startsWith('bunny/modules/')) return;
        const old=this.#devices.get(message.data.id);
        if(old===undefined || old.source!==message.source || message.data.revision>old.data.revision) this.#devices.set(message.data.id,message);
      }),
      ...[...KINDS.values()].map(kind=>handle.sdk.subscribe<AgentOccurrence>(`bunny.event.${kind}.*`,message=>{
        if(this.#closed || message.source!==handle.sdk.source || !this.#publishing.delete(message.id)) return;
        const data=message.data;
        this.#automation?.submit({id:message.id,source:'core',kind,delivery:'live',agent:opaque(JSON.stringify(data.identity)),
          ...(data.turn.status==='known'?{task:opaque(`${data.session}\0${data.turn.id}`)}:{})});
      },{onOverflow:()=>{this.#publishing.clear();this.#live.clear();}})),
    ]);
  }
  get controls(): AutomationControls {
    const engine=this.#automation;
    if(engine===undefined || this.#closed) throw new AutomationError('unavailable',503);
    return {
      rules:()=>engine.rules(),rule:id=>engine.rule(id),
      create:(value,owner,authorize)=>engine.create(value,owner,authorize),
      update:(id,value,authorize)=>engine.update(id,value,authorize),
      setEnabled:(id,enabled)=>engine.setEnabled(id,enabled),remove:id=>engine.remove(id),
      interruptSet:()=>engine.interruptSet(),replaceInterruptSet:value=>engine.replaceInterruptSet(value),
      settings:()=>engine.settings(),replaceSettings:value=>engine.replaceSettings(value),settled:()=>engine.settled(),
      log:(limit,before)=>engine.log(limit,before).map(entry=>{
      const operation=entry.requestId===undefined?undefined:this.#handle?.operation(entry.requestId);
      return {...entry,...(operation===undefined?{}:{operation})};
    })};
  }
  async close(): Promise<void> {this.#closed=true;this.#live.clear();this.#publishing.clear();await this.#automation?.close();}
}
