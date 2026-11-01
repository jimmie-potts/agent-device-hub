// Weekly routines (#483, #1297) over the actual gateway and durable core: shared management with a simulated LIFX
// consumer, and one ordered action list that starts a Pixoo playlist only in Media and paints a LIFX bulb.
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {LIFX_SIMULATED_SECTION, type LifxDeviceState} from '@jimmie-potts/lifx';
import {FAMILIES as PIXOO, type PlaylistRecord} from '@jimmie-potts/pixoo';
import {CORE_FAMILIES, StepFailure, act, bodyOf, deviceState, dispatchOnce, expect, holds, running, type GatewayCall, type Harness, type Outcome, type Scenario} from './framework.js';
import {PIXOO_FAMILIES, PIXOO_ID, PIXOO_SECTION, completedAs, pixooDisplay, pixooMode, pixooPlaylist, shownFrames} from './modules/pixoo.js';
import {PLAYBACK_SECTION} from './modules/playback.js';

type Action={target:string;family:string;data:Record<string,unknown>;requireMode?:string};
type Saved={id:string;name:string;enabled:boolean;days:number[];time:string;actions:Action[];next?:{atMs:number}};
type LogEntry={seq:number;ruleId:string;target:string;outcome:string;reason?:string;requestId?:string;family?:string;index?:number;requireMode?:string;event:{kind:string}};
const saved=new WeakMap<Harness,Saved & {plannedAtMs?:number}>();
const savedOf=(h:Harness)=>{const value=saved.get(h);if(value===undefined) throw new StepFailure('routine missing');return value;};
async function control(h:Harness,method:GatewayCall['method'],path:string,body?:object,status=200):Promise<Saved> {
  const answer=await h.gateway({as:'operator',method,path:`/api/v2/automation/routines${path}`,headers:{'bunny-request':'1'},...(body===undefined?{}:{body})});
  const value=bodyOf<Saved & {schema:string}>(answer);
  if(answer.status!==status || value?.schema!=='automation/2.0') throw new StepFailure('routine control was refused');
  return value;
}
const entries=async(h:Harness):Promise<LogEntry[]>=>{
  const answer=await h.gateway({as:'reader',method:'GET',path:'/api/v2/automation/log?limit=100'});
  return bodyOf<{entries:LogEntry[]}>(answer)?.entries.filter(entry=>entry.ruleId===saved.get(h)?.id).reverse()??[];
};
const pendantOn:Action={target:'pendant-1',family:'power-set',data:{on:true}};
const definition=(h:Harness)=>({name:'Reading light',days:[(new Date(h.now()).getDay()+1)%7],time:'17:00',actions:[pendantOn]});
/** Every command of any family the core admitted for the pendant. */
const commands=(h:Harness)=>h.logs().filter(({record})=>record.event_name==='runtime.command.admitted' && record.attributes['bunny.participant']==='bunny/core' &&
  typeof record.attributes['bunny.routing.key']==='string' && /^bunny\.cmd\.[a-z-]+\.pendant-1$/.test(record.attributes['bunny.routing.key'])).length;

/** Shared management of routines: disabled creation, read-only refusal, edits that keep the enabled state, no catch-up after a restart. */
const weeklyRoutines:Scenario={
  id:'weekly-routines',title:'shared routine controls persist without catch-up or page-driven writes',
  seed:{modules:['core','lifx'],config:{lifx:LIFX_SIMULATED_SECTION},follows:[{owner:'bunny/core',families:['operation']},{owner:'bunny/modules/lifx',families:['device']}]},
  steps:[
    expect('the configured generic power consumer is available',async h=>{
      const ready=await running(h,['core','lifx']);
      return ready===true?h.reader.states<DeviceRecord>('device','bunny/modules/lifx').some(state=>state.data.id==='pendant-1' && state.data.capabilities.power.supported) || 'power capability has not synced':ready;
    },10000),
    act('the owner saves a disabled future weekly routine',async h=>{
      const value=await control(h,'POST','',definition(h),201);
      if(value.enabled || value.next!==undefined || value.actions.length!==1) throw new StepFailure('creation activated a routine');saved.set(h,value);
    }),
    act('the read-only client cannot enable or run the saved routine',async h=>{
      const value=savedOf(h);
      for(const action of ['enable','run']) {
        const answer=await h.gateway({as:'reader',method:'POST',path:`/api/v2/automation/routines/${value.id}/${action}`,headers:{'bunny-request':'1'},body:{}});
        if(answer.status!==403) throw new StepFailure('read-only control was not refused');
      }
    }),
    act('the owner explicitly enables and edits the future definition',async h=>{
      const value=savedOf(h);
      await control(h,'POST',`/${value.id}/enable`,{});
      const edited=await control(h,'PUT',`/${value.id}`,{...definition(h),time:'21:00',actions:[pendantOn,{target:'pendant-1',family:'brightness-set',data:{percent:30}}]});
      if(!edited.enabled || edited.next===undefined || edited.next.atMs<=h.now() || edited.actions.length!==2) throw new StepFailure('definition did not retain enabled with a future occurrence');
      saved.set(h,edited);
    }),
    holds('saving and enabling send no command',h=>commands(h)===0 || 'a control operation sent a command immediately',300),
    act('the runtime restarts with its saved definitions',h=>h.restart()),
    expect('the restarted core retains the enabled definition and schedules only a future occurrence',async h=>{
      const ready=await running(h,['core','lifx']);if(ready!==true) return ready;
      const current=await control(h,'GET',`/${savedOf(h).id}`);
      const next=current.next===undefined?undefined:new Date(current.next.atMs);
      return current.enabled && current.time==='21:00' && next!==undefined && next.getTime()>h.now() && next.getHours()===21 && next.getMinutes()===0 || 'saved definition or recomputed 21:00 occurrence missing';
    },10000),
    holds('restart and SDK resync dispatch no catch-up command',h=>commands(h)===0 || 'restart replayed a command',300),
    act('the owner disables and removes the routine',async h=>{
      const value=savedOf(h);
      const disabled=await control(h,'POST',`/${value.id}/disable`,{});
      if(disabled.enabled || disabled.next!==undefined) throw new StepFailure('disabled routine retained a next occurrence');
      await control(h,'DELETE',`/${value.id}`);
    }),
  ],
};

const PENDANT_AT='192.0.2.40';
const pendantColor=(h:Harness):Outcome=>{
  const color=deviceState<LifxDeviceState>(h,'lifx').bulbs[PENDANT_AT]?.color;
  return (color!==undefined && color.saturation===65535 && Math.abs(color.hue-21845)<=2) || `pendant color ${JSON.stringify(color)}`;
};
/** The next local minute at least ten seconds away, as the routine's day and time; chosen right before enabling, so earlier steps cannot outrun it. */
const nextMinute=(h:Harness):{days:number[];time:string;atMs:number}=>{
  const at=new Date(h.now()+10000);at.setSeconds(0,0);at.setMinutes(at.getMinutes()+1);
  return {days:[at.getDay()],time:`${String(at.getHours()).padStart(2,'0')}:${String(at.getMinutes()).padStart(2,'0')}`,atMs:at.getTime()};
};
const rowsOf=(found:LogEntry[],kind:string)=>found.filter(entry=>entry.event.kind===kind).map(entry=>`${entry.index ?? '-'} ${entry.target} ${entry.outcome}${entry.reason===undefined?'':` ${entry.reason}`}`);

/**
 * One routine with an ordered action list: a Pixoo playlist start, which the Pixoo module and the core refuse while
 * Monitor shows, and a LIFX color, which runs regardless; then the same routine at its minute, once, and nothing after a
 * restart.
 */
const routineActions:Scenario={
  id:'routine-actions',title:'a routine starts a Pixoo playlist only in Media and paints a LIFX bulb, on Run now and once at its minute',
  seed:{modules:['core','playback','pixoo','lifx'],follows:[CORE_FAMILIES,PIXOO_FAMILIES,{owner:'bunny/modules/lifx',families:['device']},{owner:'bunny/core',families:['operation']}],
    config:{playback:PLAYBACK_SECTION,pixoo:PIXOO_SECTION,lifx:LIFX_SIMULATED_SECTION}},
  steps:[
    expect('the core, the playback module, the Pixoo and the LIFX module are running with their devices available',async h=>{
      const ready=await running(h,['core','playback','pixoo','lifx']);if(ready!==true) return ready;
      const pixoo=h.reader.states<DeviceRecord>('device','bunny/modules/pixoo').find(state=>state.data.id===PIXOO_ID)?.data;
      const pendant=h.reader.states<DeviceRecord>('device','bunny/modules/lifx').find(state=>state.data.id==='pendant-1')?.data;
      return (pixoo?.availability==='available' && pendant?.availability==='available') || `pixoo ${String(pixoo?.availability)}, pendant ${String(pendant?.availability)}`;
    },10000),
    expect('automation follows the device owners without a refused sync of the playback-only owner',h=>
      !h.logs().some(({record})=>record.event_name==='runtime.sync.refused' && record.attributes['bunny.participant']==='bunny/core' &&
        record.attributes['bunny.pattern']==='sync device') || 'the core tried a device sync that was refused'),
    ...pixooPlaylist(),
    act('the operator selects Monitor on the Pixoo',h=>dispatchOnce(h,'operator','routine-monitor',pixooMode('monitor'),'routine-monitor-1')),
    expect('Monitor shows',h=>completedAs(h,'routine-monitor-1','succeeded','observed')===true && pixooDisplay(h)?.mode==='monitor' || `display ${JSON.stringify(pixooDisplay(h)?.mode)}`),
    act('the owner saves a disabled routine: start the playlist on the Pixoo, then paint the pendant green',async h=>{
      const [list]=h.reader.states<PlaylistRecord>(PIXOO.playlist);if(list===undefined) throw new StepFailure('no playlist');
      const value=await control(h,'POST','',{name:'Evening',days:[(new Date(h.now()).getDay()+1)%7],time:'17:00',actions:[
        {target:PIXOO_ID,family:'media-start',data:{playlistId:list.data.id}},{target:'pendant-1',family:'lifx-color-set',data:{hue:120,saturation:100}}]},201);
      if(value.enabled || value.actions[0]?.requireMode!=='media' || value.actions[1]?.requireMode!==undefined) throw new StepFailure('the content action did not default to Media');
      saved.set(h,value);
    }),
    act('the owner runs the routine now while Monitor shows',async h=>{
      const answer=await h.gateway({as:'operator',method:'POST',path:`/api/v2/automation/routines/${savedOf(h).id}/run`,headers:{'bunny-request':'1'},body:{}});
      if(answer.status!==200) throw new StepFailure('run now was refused');
    }),
    expect('the log shows the playlist action skipped for the mode and the color action accepted, in order',async h=>{
      const rows=rowsOf(await entries(h),'routine-run');
      const first=rows[0]??'';
      // The core's own precondition skips the start; the Pixoo's admission check (#1276) is the second line and is not reached.
      return (rows.length===2 && first==='0 pixoo-1 blocked mode' && rows[1]==='1 pendant-1 receipt') || `rows ${JSON.stringify(rows)}`;
    }),
    // Monitor paints its own dashboard, so the Pixoo's send counts cannot tell a start apart; the module's own player state can.
    expect('the Pixoo selected no playlist and stays in Monitor; the pendant shows green',h=>
      (pixooDisplay(h)?.player.playlistId===null && pixooDisplay(h)?.mode==='monitor' && pendantColor(h)===true) || `player ${JSON.stringify(pixooDisplay(h)?.player)}, mode ${String(pixooDisplay(h)?.mode)}, ${String(pendantColor(h))}`,5000),
    act('the operator selects Media on the Pixoo',h=>dispatchOnce(h,'operator','routine-media',pixooMode('media'),'routine-media-1')),
    expect('Media shows',h=>completedAs(h,'routine-media-1','succeeded','observed')===true && pixooDisplay(h)?.mode==='media' || `display ${JSON.stringify(pixooDisplay(h)?.mode)}`),
    act('the owner runs the routine now while Media shows',async h=>{
      const answer=await h.gateway({as:'operator',method:'POST',path:`/api/v2/automation/routines/${savedOf(h).id}/run`,headers:{'bunny-request':'1'},body:{}});
      if(answer.status!==200) throw new StepFailure('run now was refused');
    }),
    expect('the playlist start is accepted and completes once the media reached the Pixoo, which shows the picture',async h=>{
      const found=(await entries(h)).filter(entry=>entry.event.kind==='routine-run' && entry.index===0);
      const latest=found.at(-1);
      if(found.length!==2 || latest?.outcome!=='receipt' || latest.requestId===undefined) return `starts ${JSON.stringify(found.map(entry=>entry.outcome))}`;
      const done=completedAs(h,latest.requestId,'succeeded','transmitted');
      return done===true?shownFrames(h,1):done;
    },8000),
    act('the owner moves the routine to the next minute and enables it',async h=>{
      const value=savedOf(h),when=nextMinute(h);
      const moved=await control(h,'PUT',`/${value.id}`,{name:value.name,days:when.days,time:when.time,actions:value.actions});
      const enabled=await control(h,'POST',`/${moved.id}/enable`,{});
      if(enabled.next?.atMs!==when.atMs) throw new StepFailure('the next occurrence is not the chosen minute');
      saved.set(h,{...enabled,plannedAtMs:when.atMs});
    }),
    expect('at its minute the routine runs both actions once, in order',async h=>{
      const rows=rowsOf(await entries(h),'routine-scheduled');
      return (rows.length===2 && rows[0]==='0 pixoo-1 receipt' && rows[1]==='1 pendant-1 receipt') || `rows ${JSON.stringify(rows)}`;
    },75000),
    holds('the occurrence is not offered twice',async h=>rowsOf(await entries(h),'routine-scheduled').length===2 || 'a second occurrence ran',500),
    act('the runtime restarts after the minute',h=>h.restart()),
    expect('the restarted core keeps the routine with a later occurrence',async h=>{
      const ready=await running(h,['core','playback','pixoo','lifx']);if(ready!==true) return ready;
      const current=await control(h,'GET',`/${savedOf(h).id}`);
      return (current.enabled && current.next!==undefined && current.next.atMs>(savedOf(h).plannedAtMs??0)) || 'no later occurrence';
    },10000),
    holds('the restart runs nothing',async h=>rowsOf(await entries(h),'routine-scheduled').length===2 || 'the restart replayed the routine',500),
    act('the owner disables and removes the routine',async h=>{
      const value=savedOf(h);
      await control(h,'POST',`/${value.id}/disable`,{});
      await control(h,'DELETE',`/${value.id}`);
    }),
  ],
};

export const powerScheduleScenarios:readonly Scenario[]=[weeklyRoutines,routineActions];
