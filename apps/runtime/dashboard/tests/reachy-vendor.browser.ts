// Opt-in, disposable actual-vendor acceptance. Dedicated loopback MuJoCo only; never hardware.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {setTimeout as pause} from 'node:timers/promises';
import {chromium} from 'playwright';
import {HttpReachy,type ReachyTransport} from '@jimmie-potts/reachy-mini';
import {feed,startWorld} from './harness.ts';
if(process.env.REACHY_VENDOR_EXERCISE!=='1')throw new Error('explicit dedicated simulator qualification required');
const endpoint='http://127.0.0.1:18861',vendor=new HttpReachy(endpoint),effects:{kind:string;id?:string;target?:readonly number[]}[]=[],observations:{antennas:[number,number]}[]=[];
const identity:unknown=await (await fetch(endpoint+'/api/daemon/status')).json();
assert.ok(typeof identity==='object'&&identity!==null&&'simulation_enabled'in identity&&identity.simulation_enabled===true&&'no_media'in identity&&identity.no_media===true);
const transport:ReachyTransport={connect:(observer,signal)=>vendor.connect({...observer,state:value=>{observations.push(value);observer.state(value);}},signal),
 move:async(target,signal,beforeEffect)=>{const id=await vendor.move(target,signal,()=>{beforeEffect?.();effects.push({kind:'move',target});});const last=effects.at(-1);if(last!==undefined)last.id=id;return id;},
 cancel:async(id,signal)=>{effects.push({kind:'cancel',id});await vendor.cancel(id,signal);}};
const world=await startWorld({reachy:true,reachyTransport:transport}),browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(30000);await page.goto(world.url+'/#/module/reachy-mini/controls');await feed(page,'connected');
 const panel=page.getByRole('region',{name:'Reachy robot controls'});await panel.getByRole('status').filter({hasText:'Simulator available'}).waitFor();assert.equal(effects.length,0);
 await panel.getByRole('button',{name:'Take over',exact:true}).click();await panel.getByText('Manual takeover',{exact:true}).waitFor();
 await panel.getByRole('button',{name:'Notice gesture',exact:true}).click();await panel.getByText(/^Completed: succeeded\./).first().waitFor();assert.equal(effects.filter(x=>x.kind==='move').length,2);assert.ok(observations.some(value=>value.antennas[0]>.08&&value.antennas[1]<-.08),'streamed simulator pose reflects the first target');await panel.getByText(/^Simulated antennas:/).waitFor();
 await panel.getByRole('button',{name:'Attention gesture',exact:true}).click();await panel.getByText('Active attention task',{exact:true}).waitFor();
 const deadline=Date.now()+5000;while(!effects.some(x=>x.kind==='move'&&x.target?.[1]===.2&&x.id!==undefined)){assert.ok(Date.now()<deadline);await pause(5);}
 await panel.getByRole('button',{name:'Stop task',exact:true}).click();await panel.getByText('No active task',{exact:true}).waitFor();assert.equal(effects.filter(x=>x.kind==='cancel').length,1);
 const count=effects.length;await page.reload();await feed(page,'connected');await panel.getByRole('status').filter({hasText:'Simulator available'}).waitFor();assert.equal(effects.length,count);
 await writeFile('/tmp/reachy-vendor-phase','await-daemon-loss');
 await panel.getByRole('status').filter({hasText:/Simulator (unavailable|stale)/}).waitFor({timeout:60000});
 assert.equal(await panel.getByRole('button',{name:'Notice gesture',exact:true}).isDisabled(),true);await writeFile('/tmp/reachy-vendor-phase','await-daemon-restart');
 await panel.getByRole('status').filter({hasText:'Simulator available'}).waitFor({timeout:60000});await pause(1000);assert.equal(effects.length,count,'whole-daemon restart cannot replay or resume movement');
 await writeFile('/tmp/reachy-vendor-result.json',JSON.stringify({identity,effects,observationCount:observations.length,wholeDaemonRestart:true,simulationOnly:true},null,2));await writeFile('/tmp/reachy-vendor-phase','passed');console.log('Actual MuJoCo dashboard gesture, observed state, priority cancellation and daemon restart/no replay passed');
}finally{await browser.close();await world.close();}
