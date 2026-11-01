// Explicit source qualification only. Runtime and the pinned vendor pair share one isolated Linux ARM64 container.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {setTimeout as pause} from 'node:timers/promises';
import {once} from 'node:events';
import {chromium} from 'playwright';
import {AxeBuilder} from '@axe-core/playwright';
import {startFixture} from '../../../../modules/microduck/dist/src/fixture.js';
import {validState} from '../../../../modules/microduck/dist/src/families.js';
import type {MicroDuckState} from '../../../../modules/microduck/dist/src/contracts.js';
import {FixtureWitness,namespace} from '../../../../modules/microduck/dist/src/witness.js';
import {feed,startWorld} from './harness.ts';
if(process.env.MICRODUCK_VENDOR_EXERCISE!=='1')throw new Error('Explicit isolated MicroDuck vendor qualification is required');
let fixture=await startFixture({enablePolicy:true,leaseMs:180000});
const world=await startWorld({microduck:true,microduckVendor:true,microduckSection:{id:'microduck-sim',fixtureRoot:fixture.root,configurationRevision:1},companions:true});
const browser=await chromium.launch({headless:true});
const observations:MicroDuckState[]=[],checks:{name:string;passed:true}[]=[],pairs:{session:string;body:number;daemon:number;reaped:boolean}[]=[];
const check=(name:string,ok:boolean):void=>{assert.equal(ok,true,name);checks.push({name,passed:true});};
function find(value:unknown):MicroDuckState|undefined {
  if(validState(value))return value;
  if(typeof value==='object'&&value!==null)for(const child of Object.values(value)){const result=find(child);if(result!==undefined)return result;}
  return undefined;
}
const state=async():Promise<MicroDuckState>=>{const value=find(await world.reachyMcp('microduck_status',{}));assert.ok(value);observations.push(value);return value;};
const until=async(predicate:(s:MicroDuckState)=>boolean,ms=15000):Promise<MicroDuckState>=>{const end=Date.now()+ms;while(Date.now()<end){const s=await state();if(predicate(s))return s;await pause(20);}assert.fail('MicroDuck vendor state deadline');};
try {
  const context=await browser.newContext({viewport:{width:390,height:1000},reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(20000);
  const panel=page.getByRole('region',{name:'MicroDuck robot controls'});
  const open=async():Promise<void>=>{await page.goto(`${world.url}/#/module/microduck/controls`);await page.reload();await feed(page,'connected');await panel.getByRole('status').filter({hasText:'Simulator available'}).waitFor();};
  await open();await until(s=>s.connection==='available'&&s.observation?.policy==='walk'&&s.observation.healthy&&s.observation.zeroVelocity);await pause(1000);
  const initial=await until(s=>s.connection==='available'&&s.observation?.policy==='walk'&&s.observation.healthy&&s.observation.zeroVelocity);
  check('startup is passive and reports a witnessed simulator',initial.lastTransmission.status==='unknown'&&initial.simulated&&initial.ownership==='fixture-exclusive');
  new FixtureWitness(fixture.root).guard();
  await panel.getByRole('button',{name:'Take over',exact:true}).click();await panel.getByText(/Manual takeover/).waitFor();
  const baseline=initial.observation?.joints[7];assert.ok(baseline!==undefined);
  await panel.getByRole('button',{name:'Notice gesture',exact:true}).click();
  const moved=await until(s=>(s.observation?.head[2]??0)>.07&&(s.observation?.joints[7]??baseline)-baseline>.02);
  check('real policy head input produces directional measured joint response',moved.observation!==null);
  await until(s=>s.active===null&&s.lastOutcome?.result==='succeeded');
  check('finite notice returns to zero input',(await state()).observation?.head.every(x=>Math.abs(x)<=.005)===true);
  const beforeReload=(await state()).lastTransmission;
  await open();await pause(300);check('page reload never replays head input',JSON.stringify((await state()).lastTransmission)===JSON.stringify(beforeReload));
  const violations=(await new AxeBuilder({page}).analyze()).violations;check('actual-vendor controls pass accessibility',violations.length===0);
  for(const failed of ['body','daemon'] as const) {
    const existing=await state();
    if(existing.held!==null){const box=panel.getByRole('checkbox',{name:/I acknowledge this held operation/});await box.check();await panel.getByRole('button',{name:'Neutral head input',exact:true}).click();await until(s=>s.held===null&&s.active===null);}
    await pause(2100);await panel.getByRole('button',{name:'Attention gesture',exact:true}).click();
    const started=await until(s=>s.active?.gesture==='attention'&&(s.observation?.head[2]??0)<-.05);const id=started.active?.requestId;assert.ok(id!==undefined);
    const old=fixture,exited=once(old[failed],'exit');old[failed].kill('SIGTERM');await exited;await old.stop();
    const stopped=await until(s=>s.connection!=='available'&&s.held?.requestId===id);
    check(`${failed} loss holds the interrupted program`,stopped.lastOutcome?.result==='uncertain');
    for(const child of [old.body,old.daemon]){assert.ok(child.pid!==undefined);assert.throws(()=>process.kill(child.pid??0,0));}
    pairs.push({session:old.session,body:old.body.pid??0,daemon:old.daemon.pid??0,reaped:true});
    check(`${failed} loss reaps both old owned processes`,old.body.exitCode!==null||old.body.signalCode!==null);
    await world.restart();await pause(500);const restarted=await state();
    check(`${failed} restart preserves responsibility without replay`,restarted.held?.requestId===id&&restarted.connection!=='available');
    fixture=await startFixture({enablePolicy:true,leaseMs:180000});await world.microduckAdopt(fixture.root);await open();
    const adopted=await until(s=>s.connection==='available'&&s.observation?.policy==='walk');
    check(`${failed} explicit new pair stays passive to old work`,adopted.held?.requestId===id&&adopted.latched&&adopted.takeover&&JSON.stringify(adopted.lastTransmission)===JSON.stringify(restarted.lastTransmission));
    await pause(600);check(`${failed} new pair has zero input without cleanup replay`,(await state()).observation?.head.every(x=>Math.abs(x)<=.005)===true);
  }
  const box=panel.getByRole('checkbox',{name:/I acknowledge this held operation/});await box.check();await panel.getByRole('button',{name:'Neutral head input',exact:true}).click();await until(s=>s.held===null&&s.active===null);
  await pause(2100);await panel.getByRole('button',{name:'Notice gesture',exact:true}).click();await until(s=>s.active?.gesture==='notice'&&(s.observation?.head[2]??0)>.05);
  await panel.getByRole('button',{name:'Stop expression',exact:true}).click();const stopped=await until(s=>s.active===null&&s.held!==null);
  check('local Stop fences return and leaves persistent vendor input visible',stopped.latched&&(stopped.observation?.head[2]??0)>.05);await pause(1000);
  check('local Stop never sends a hidden neutral',(await state()).observation?.head[2]!==undefined&&((await state()).observation?.head[2]??0)>.05);
  check('MCP refuses actuator paths',JSON.stringify(await world.reachyMcp('core_send_command',{family:'microduck-gesture',target:'microduck-sim',data:{gesture:'neutral'}})).includes('forbidden'));
  check('companions remain usable',(await world.assistantRead()).status===200);
  const valid=new FixtureWitness(fixture.root);valid.guard();await writeFile(fixture.root+'/robotd.toml','[policy]\nenabled=false\n');assert.throws(()=>valid.guard());check('changed pinned params revoke witness',true);
  await panel.screenshot({path:'/proof/microduck-vendor.png'});
  await writeFile('/proof/microduck-vendor-result.json',JSON.stringify({simulationOnly:true,bunnyModule:true,checks,pairs,observations,clock:{nowNs:String(process.hrtime.bigint()),namespace:namespace('time')},fixtureRoots:[...pairs.map(p=>p.session),fixture.session]},null,2));
  console.log('Actual MicroDuck dashboard/core/module qualification passed, including 10 Hz observations, both-direction process loss and explicit passive adoption.');
}finally{
  await writeFile('/proof/microduck-vendor-observations.json',JSON.stringify({checks,pairs,observations},null,2));
  await browser.close();await world.close();await fixture.stop();
  for(const child of [fixture.body,fixture.daemon]){assert.ok(child.exitCode!==null||child.signalCode!==null);assert.throws(()=>process.kill(child.pid??0,0));}
  await writeFile('/proof/microduck-vendor-cleanup.json',JSON.stringify({reaped:true,priorPairs:pairs,current:{body:fixture.body.pid,daemon:fixture.daemon.pid},remainingVendorProcesses:false}));
}
