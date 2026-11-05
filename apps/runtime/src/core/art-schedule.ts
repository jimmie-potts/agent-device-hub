import {createHash,randomUUID} from 'node:crypto';
import {errorBody,type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import type {ArtRecord,ArtworkSummary} from '@jimmie-potts/event-contracts/v2/art-state';
import type {RainNotice} from '@jimmie-potts/event-contracts/v2/art-notice';
import {rainNoticeRefusal} from '@jimmie-potts/event-contracts/v2/art-notice';
import type {ArtOpportunity,ArtScheduleAttempt,ArtScheduleRecord,ArtSuppression} from '@jimmie-potts/event-contracts/v2/art-schedule';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {WeatherState} from '@jimmie-potts/weather';
import type {Cancel,ModuleScheduler,TraceContext} from '@jimmie-potts/sdk';
import {Outcome} from '@jimmie-potts/sdk';
import {AutomationError,inQuietHours,type AutomationSettings} from './automation.js';
import type {AutomationStore} from './automation-store.js';
import type {CoreHandle} from './core.js';
import type {ArtPlan,ArtPlans,ArtSurface} from './art-plans.js';
import {artPolicyWrite,GENERATION_MS,planArtDay,PREPARATION_MS,rainForecast,savedArtwork,START_TOLERANCE_MS,wakingDay,nextArtStart} from './art-schedule-model.js';
import {ArtScheduleStore,type ArtScheduleData} from './art-schedule-store.js';

type Inputs={art():ArtRecord|undefined;weather():WeatherState|undefined;set(policy:ArtScheduleRecord['policy']):void};
type Options={store:ArtScheduleStore;shared:AutomationStore;core:CoreHandle;scheduler:ModuleScheduler;active:()=>boolean;
  plans:ArtPlans;current:(id:string)=>DeviceRecord|undefined;settings:()=>AutomationSettings;attention:()=>boolean;
  inputs:Inputs;choice?:()=>number;failed:()=>void};
type Pending={opportunity:ArtOpportunity;settingsRevision:number;saved:ArtworkSummary|undefined;generationRequestId:string|null;
  notice:RainNotice|undefined;preparing:boolean;used:Set<string>};
type Grant={pending:Pending;target:string;compositionId:string;expiresAtMs:number};
const opaque=(value:string):string=>createHash('sha256').update(value).digest('hex');
const opportunityId=(kind:string,start:number):string=>`art-${kind}-${opaque(String(start))}`;
const composition=(art:ArtworkSummary,kind:string)=>art.compositions.find(item=>item.target===kind&&item.outcome===Outcome.succeeded&&item.compositionId!==null&&item.renditions.length>0)?.compositionId??undefined;
const attempt=(pending:Pending):ArtScheduleAttempt=>({...pending.opportunity,artworkId:null,reason:null,generationRequestId:pending.generationRequestId,browserRequestId:null,displays:[]});

/** One schedule inside the existing automation owner. Durable claims are never recovered as executable work. */
export function createArtSchedule(options:Options) {
  const {store,core}=options,choice=options.choice??Math.random;
  let closed=false,cancel:Cancel|undefined,serial=Promise.resolve(),pending:Pending|undefined,ambientRunning=false,weatherTrigger:number|undefined;
  const effects=new Set<Promise<void>>(),grants=new Map<string,Grant>();
  const now=()=>core.clock.now(),active=()=>!closed&&options.active();
  const launch=(work:Promise<void>):void=>{effects.add(work);void work.catch(()=>{options.failed();}).finally(()=>effects.delete(work));};
  const enqueue=(work:()=>Promise<void>):Promise<void>=>{
    const next=serial.then(async()=>{if(active())await work();});serial=next.catch(()=>{options.failed();});return next;
  };
  const state=()=>store.get();
  const weatherStatus=(data:ArtScheduleData):ArtScheduleRecord['weather']=>{
    if(!data.record.policy.enabled||!data.record.policy.weather)return 'disabled';
    const weather=options.inputs.weather();return weather?.status!=='available'?'unavailable':weather.observedAtMs>now()||weather.staleAtMs<=now()?'stale':'fresh';
  };
  const restriction=(item:Pending,surface?:ArtSurface):ArtSuppression|undefined=>{
    const data=state(),policy=data.record.policy,settings=options.settings(),at=now();
    if(!active()||!policy.enabled)return 'disabled';
    if(data.record.settingsRevision!==item.settingsRevision)return 'policy-changed';
    if(at>item.opportunity.startAtMs+item.opportunity.toleranceMs)return 'expired';
    if(wakingDay(at,policy)===undefined||inQuietHours(settings.quietHours,at)||inQuietHours(settings.quietHours,item.opportunity.startAtMs))return 'quiet-hours';
    if(options.attention())return 'attention';
    if(settings.noFlourishes&&item.notice===undefined)return 'no-flourishes';
    if(item.notice!==undefined) {
      const current=options.inputs.weather();
      if(!policy.weather||current?.status!=='available'||current.revision!==item.notice.weatherRevision
        ||rainNoticeRefusal(item.notice,{startAtMs:item.opportunity.startAtMs,toleranceMs:item.opportunity.toleranceMs,durationMs:30_000},at)!==undefined)return 'source-unavailable';
    }
    if(item.opportunity.kind==='appearance') {
      if(options.shared.reservedUsage(at-3_600_000,item.opportunity.id)>=settings.budgets.globalHour)return 'budget';
      if(surface?.kind==='display') {
        const latest=options.shared.reservedLatest(surface.target,item.opportunity.id);
        if(latest!==undefined&&item.opportunity.startAtMs-latest<settings.budgets.deviceSpacingMs)return 'spacing';
      }
    }
    if(surface?.kind==='browser'&&!policy.browser)return 'no-surfaces';
    if(surface?.kind==='display'&&!policy.targets.includes(surface.target))return 'no-surfaces';
    return undefined;
  };
  const permit=(item:Pending,surface:ArtSurface):ErrorBody|undefined=>{
    const key=surface.kind==='browser'?'browser':surface.target;
    const denied=restriction(item,surface);
    if(denied!==undefined)return errorBody('invalid-state',{detail:`scheduled art is suppressed: ${denied}`});
    if(item.used.has(key))return errorBody('invalid-state',{detail:'scheduled art already used this surface'});
    try{if(!store.handoff(item.opportunity,key))return errorBody('invalid-state',{detail:'scheduled art already used this surface'});}
    catch{options.failed();return errorBody('unavailable');}
    item.used.add(key);return undefined;
  };
  const persistFailure=async(item:Pending,reason:ArtSuppression):Promise<void>=>{
    await store.change(data=>{if(data.record.settingsRevision!==item.settingsRevision)return;
      data.record.lastOpportunity={...attempt(item),reason};data.record.status=data.record.policy.enabled?'idle':'disabled';data.record.notice=null;});
  };
  const generated=(item:Pending):ArtworkSummary|undefined=>{
    const catalog=options.inputs.art(),job=catalog?.jobs.find(value=>value.requestId===item.generationRequestId);
    return job?.status==='finished'&&(job.outcome===Outcome.succeeded||job.outcome==='partial')
      ?catalog?.artworks.find(art=>art.artworkId===job.artworkId&&art.feedback!=='dismiss'&&art.feedback!=='less'):undefined;
  };
  async function present(item:Pending):Promise<void> {
    const denied=restriction(item);if(denied!==undefined){await persistFailure(item,denied);return;}
    const artwork=generated(item)??item.saved;if(artwork===undefined){await persistFailure(item,'no-art');return;}
    const policy=state().record.policy;
    const displays=options.plans.targets().filter(target=>policy.targets.includes(target.target)).flatMap(target=>{
      const id=composition(artwork,target.kind);return id===undefined?[]:[{target:target.target,compositionId:id,durationMs:target.kind==='tidbyt'?30_000:10_000}];});
    const ui=policy.browser?composition(artwork,'ui'):undefined;
    if(displays.length===0&&ui===undefined){await persistFailure(item,'no-surfaces');return;}
    const plan:ArtPlan={id:item.opportunity.id,artworkId:artwork.artworkId,startAtMs:item.opportunity.startAtMs,
      prepareUntilMs:item.opportunity.startAtMs-1000,toleranceMs:item.opportunity.toleranceMs,
      mood:item.notice===undefined?'celebrate':'reminder',priorityClass:policy.coversStatus||item.notice!==undefined?'event':'flourish',coversStatus:policy.coversStatus,
      displays,...(ui===undefined?{}:{browser:{compositionId:ui}}),...(item.notice===undefined?{}:{notice:item.notice})};
    // The immutable plan and all target identities commit before preparation or browser selection can start.
    await store.change(data=>{if(data.record.settingsRevision!==item.settingsRevision)throw new AutomationError('revision-conflict',409);
      if(!store.claim({...item.opportunity,id:`${item.opportunity.id}-targets`}))throw new AutomationError('duplicate-conflict',409);
      data.record.lastOpportunity={...attempt(item),artworkId:artwork.artworkId,displays:displays.map(value=>({target:value.target,prepareRequestId:null,momentRequestId:null,error:null}))};
      data.record.status='preparing';});
    if(!active())return;
    const result=await options.plans.present(plan,surface=>permit(item,surface));
    if(!active())return;
    await store.change(data=>{
      if(data.record.settingsRevision!==item.settingsRevision)return;
      if('error' in result){data.record.lastOpportunity={...attempt(item),artworkId:artwork.artworkId,reason:'unavailable'};data.record.status='idle';return;}
      const browser=result.browser?.status==='tracked'?result.browser.requestId:null;
      data.record.lastOpportunity={...attempt(item),artworkId:artwork.artworkId,browserRequestId:browser,displays:result.displays.map(value=>({target:value.target,
        prepareRequestId:value.prepare.status==='tracked'?value.prepare.requestId:null,momentRequestId:value.moment.status==='tracked'?value.moment.requestId:null,
        error:value.moment.status==='not-requested'?value.moment.error.error.code:null}))};
      data.record.status='presenting';
      data.record.notice=item.notice===undefined||ui===undefined||browser===null?null:{opportunityId:item.opportunity.id,artworkId:artwork.artworkId,compositionId:ui,
        browserRequestId:browser,startAtMs:item.opportunity.startAtMs,expiresAtMs:Math.min(item.opportunity.startAtMs+30_000,item.notice.staleAtMs,item.notice.forecastEndAtMs),forecast:item.notice};
    });
    changed();
  }
  async function begin(startAtMs:number):Promise<void> {
    const before=state();
    const item:Pending={opportunity:{id:opportunityId('appearance',startAtMs),kind:'appearance',startAtMs,toleranceMs:START_TOLERANCE_MS},
      settingsRevision:before.record.settingsRevision,saved:savedArtwork(options.inputs.art(),choice),generationRequestId:null,
      notice:before.record.policy.weather?rainForecast(options.inputs.weather(),now(),startAtMs,START_TOLERANCE_MS):undefined,preparing:false,used:new Set()};
    let claimed=false;
    await store.change(data=>{
      if(data.record.settingsRevision!==item.settingsRevision||data.day===null||data.day.claimed>=data.record.policy.appearances)return;
      data.day.starts=data.day.starts.filter(at=>at!==startAtMs);
      if(!store.claim(item.opportunity))return;
      data.day.claimed++;claimed=true;
      const prior=data.latestStartMs;data.latestStartMs=Math.max(prior??0,startAtMs+item.opportunity.toleranceMs);
      const denied=prior!==null&&startAtMs<nextArtStart(prior)?'spacing':restriction(item);
      if(denied!==undefined){data.record.lastOpportunity={...attempt(item),reason:denied};claimed=false;return;}
      options.shared.reserveMoment(item.opportunity.id,data.record.policy.targets,startAtMs,startAtMs+item.opportunity.toleranceMs);
      if(data.record.policy.generation)item.generationRequestId=`${item.opportunity.id}-generate`;
      data.record.lastOpportunity=attempt(item);data.record.status='waiting';
    });
    if(!claimed)return;
    pending=item;
    const generationRequestId=item.generationRequestId;
    if(generationRequestId!==null) {
      const targets=new Set<'ui'|'pixoo'|'tidbyt'>();const policy=state().record.policy;
      if(policy.browser)targets.add('ui');for(const target of options.plans.targets())if(policy.targets.includes(target.target))targets.add(target.kind);
      if(targets.size>0&&restriction(item)===undefined)launch((async()=>{
        await core.dispatch({requestId:generationRequestId,key:'bunny.cmd.art-auto.art',requestedBy:'bunny/core',
          draft:{type:'org.bunny.art.auto.requested',subject:'art',dataschema:'https://bunny.invalid/events/art-auto/2.2',
            data:{action:'start',purpose:'appearance',origin:{kind:'schedule'},targets:[...targets],weatherUse:policy.weather?'current':'omit'}}});
      })());
    }
  }
  async function ambient():Promise<void> {
    const data=state(),policy=data.record.policy,at=now();
    if(!policy.ambient||ambientRunning||pending!==undefined)return;
    const weather=weatherTrigger;weatherTrigger=undefined;
    if(at<data.ambientAtMs+3_600_000&&(weather===undefined||weather<=data.weatherRevision))return;
    const item:Pending={opportunity:{id:`art-ambient-${randomUUID()}`,kind:'ambient',startAtMs:at+30_000,toleranceMs:START_TOLERANCE_MS},settingsRevision:data.record.settingsRevision,
      saved:savedArtwork(options.inputs.art(),choice),generationRequestId:null,notice:undefined,preparing:true,used:new Set()};
    if(restriction(item)!==undefined)return;
    const art=item.saved;if(art===undefined)return;
    await store.change(current=>{if(current.record.settingsRevision!==item.settingsRevision)throw new AutomationError('revision-conflict',409);
      if(!store.claim(item.opportunity))throw new AutomationError('duplicate-conflict',409);current.ambientAtMs=at;
      if(weather!==undefined)current.weatherRevision=Math.max(current.weatherRevision,weather);
      current.record.lastOpportunity={...attempt(item),artworkId:art.artworkId};});
    ambientRunning=true;
    launch((async()=>{try {
      const targets=options.plans.targets().filter(value=>value.kind==='tidbyt'&&policy.targets.includes(value.target));
      for(const target of targets) {
        const id=composition(art,'tidbyt');if(id===undefined||restriction(item,{kind:'display',target:target.target})!==undefined)continue;
        const authorization=randomUUID();grants.set(authorization,{pending:item,target:target.target,compositionId:id,expiresAtMs:item.opportunity.startAtMs});
        await core.dispatch({requestId:`${item.opportunity.id}-ambient`,key:'bunny.cmd.art-auto.art',requestedBy:'bunny/core',draft:{
          type:'org.bunny.art.auto.requested',subject:'art',dataschema:'https://bunny.invalid/events/art-auto/2.2',
          data:{action:'ambient',artworkId:art.artworkId,compositionId:id,target:target.target,authorization}}});
      }
      const ui=policy.browser?composition(art,'ui'):undefined;
      if(ui!==undefined&&permit(item,{kind:'browser'})===undefined)await core.dispatch({requestId:`${item.opportunity.id}-browser`,key:'bunny.cmd.art-auto.art',requestedBy:'bunny/core',
        draft:{type:'org.bunny.art.auto.requested',subject:'art',dataschema:'https://bunny.invalid/events/art-auto/2.1',data:{action:'present',artworkId:art.artworkId,compositionId:ui}}});
    }finally{ambientRunning=false;}})());
  }
  async function tick():Promise<void> {
    let data=state();options.inputs.set(data.record.policy);
    const at=now(),weather=weatherStatus(data);
    const notice=data.record.notice;
    if(data.record.weather!==weather||notice!==null&&(at>=notice.expiresAtMs||weather!=='fresh'||options.inputs.weather()?.revision!==notice.forecast.weatherRevision
      ||core.operation(notice.browserRequestId)?.result===Outcome.failed)) {
      await store.change(value=>{value.record.weather=weather;if(value.record.notice!==null&&(at>=value.record.notice.expiresAtMs||weather!=='fresh'||options.inputs.weather()?.revision!==value.record.notice.forecast.weatherRevision||core.operation(value.record.notice.browserRequestId)?.result===Outcome.failed))value.record.notice=null;});data=state();
    }
    if(!data.record.policy.enabled)return;
    const day=wakingDay(at,data.record.policy);if(day===undefined)return;
    if(data.day===null||day.startAtMs>=data.day.endAtMs&&day.startAtMs>=data.dayWatermarkMs) {
      await store.change(value=>{value.day={...day,settingsRevision:value.record.settingsRevision,claimed:0,
        starts:planArtDay(day,value.record.policy.appearances,at,value.latestStartMs,options.settings().quietHours,choice)};value.dayWatermarkMs=Math.max(value.dayWatermarkMs,day.startAtMs);});data=state();
    }
    const current=data.day;
    if(current===null||day.key!==current.key)return;
    // A restart or a forward clock jump never replays a past opportunity.
    if(current.starts.some(start=>start<=at)) {await store.change(value=>{if(value.day!==null)value.day.starts=value.day.starts.filter(start=>start>at);});data=state();}
    const next=data.day?.starts[0];
    if(pending===undefined&&next!==undefined&&at>=next-(data.record.policy.generation?GENERATION_MS:PREPARATION_MS))await begin(next);
    if(pending!==undefined&&!pending.preparing&&at>=pending.opportunity.startAtMs-PREPARATION_MS) {
      const item=pending;item.preparing=true;
      launch(present(item).finally(()=>{if(pending===item)pending=undefined;changed();}));
    }
    if(pending===undefined)await ambient();
    data=state();const upcoming=data.day?.starts[0];
    const nextOpportunity=upcoming===undefined?null:{id:opportunityId('appearance',upcoming),kind:'appearance' as const,startAtMs:upcoming,toleranceMs:START_TOLERANCE_MS};
    if(JSON.stringify(data.record.nextOpportunity)!==JSON.stringify(nextOpportunity))await store.change(value=>{value.record.nextOpportunity=nextOpportunity;});
    for(const [id,grant]of grants)if(at>grant.expiresAtMs)grants.delete(id);
  }
  function schedule():void {
    cancel?.();cancel=undefined;if(!active()||!state().record.policy.enabled)return;
    const data=state(),next=data.day?.starts[0];
    const deadlines=[now()+60_000,...(next===undefined?[]:[next-(data.record.policy.generation?GENERATION_MS:PREPARATION_MS)]),
      ...(pending===undefined||pending.preparing?[]:[pending.opportunity.startAtMs-PREPARATION_MS])].filter(at=>at>now());
    cancel=options.scheduler.after(Math.max(1,Math.min(...deadlines)-now()),changed);
  }
  function changed():void {void enqueue(tick).finally(schedule).catch(()=>{});}
  const controls={
    get:():ArtScheduleRecord=>structuredClone(state().record),
    save:async(input:unknown,parent?:TraceContext):Promise<ArtScheduleRecord>=>{
      const parsed=artPolicyWrite(input,options.plans.targets().map(target=>target.target));
      if(!active())throw new AutomationError('unavailable',503);
      await store.change(data=>{if(data.record.settingsRevision!==parsed.expectedSettingsRevision)throw new AutomationError('revision-conflict',409);
        data.record.settingsRevision++;data.record.policy=parsed.policy;data.record.status=parsed.policy.enabled?'idle':'disabled';data.record.notice=null;
        data.record.nextOpportunity=null;data.record.weather=parsed.policy.enabled&&parsed.policy.weather?'unavailable':'disabled';
        if(data.day!==null){const day=wakingDay(now(),parsed.policy);data.day.starts=day?.key===data.day.key?planArtDay(day,parsed.policy.appearances,now(),data.latestStartMs,options.settings().quietHours,choice).slice(0,Math.max(0,parsed.policy.appearances-data.day.claimed)):[];data.day.settingsRevision=data.record.settingsRevision;}
      },parent);
      pending=undefined;grants.clear();options.inputs.set(parsed.policy);await enqueue(tick);schedule();return controls.get();
    },
    authorizeAmbient:(authorization:string,target:string,compositionId:string):ErrorBody|undefined=>{
      const grant=grants.get(authorization);grants.delete(authorization);
      if(grant===undefined||grant.target!==target||grant.compositionId!==compositionId||now()>grant.expiresAtMs)return errorBody('forbidden');
      return permit(grant.pending,{kind:'display',target});
    },
    changed,
    weatherChanged:(revision:number):void=>{if(revision>state().weatherRevision){weatherTrigger=revision;changed();}},
    settled:async():Promise<void>=>{await serial;},
    close:async():Promise<void>=>{closed=true;cancel?.();pending=undefined;grants.clear();await serial;},
  };
  // Saved claims are evidence only. No pending object or initial grant is reconstructed on open.
  changed();return controls;
}
export type ArtSchedule = ReturnType<typeof createArtSchedule>;
