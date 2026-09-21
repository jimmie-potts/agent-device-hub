import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {fixture} from './fixture.mjs';
import {validate} from '@jimmie-potts/device-contracts';
const browser=await chromium.launch({headless:true});
const checks=[];let independentDeviceReadMs;
async function scenario(name,run,options){const f=await fixture(options),context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));try{await page.goto(f.hub.url);await page.getByLabel('Hub browser access token').fill(f.token);await page.getByRole('button',{name:'Connect',exact:true}).click();await page.locator('#main[data-received]:not([data-received="0"])').waitFor();await run(f,page);assert.deepEqual(errors,[]);checks.push(name);}catch(error){console.error(name,await page.locator('section:visible').innerText());throw error;}finally{await context.close();await f.close();}}
async function until(condition){const deadline=Date.now()+10000;while(!condition()){if(Date.now()>deadline)throw new Error('condition-timeout');await new Promise(r=>setTimeout(r,25));}}
async function axe(page){const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(result.violations.map(v=>v.id),[]);}
try {
 await scenario('empty sessions retain useful controls; keyboard and all view accessibility',async(f,page)=>{
  await page.getByRole('heading',{name:'No sessions observed',exact:true}).waitFor();
  const wall=page.getByRole('button',{name:'wall nanoleaf',exact:true});await wall.focus();await page.keyboard.press('Enter');await page.getByLabel('Device mode').first().waitFor();await axe(page);
  await page.getByLabel('Device mode').first().focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('Tab');assert.ok(await page.getByRole('button',{name:'Apply mode',exact:true}).first().evaluate(el=>el===document.activeElement));await page.keyboard.press('Enter');await page.getByText('queued. Physical result is not confirmed.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'pixel pixoo',exact:true}).click();await page.getByLabel('Monitor provider').waitFor();await axe(page);await page.setViewportSize({width:390,height:844});await axe(page);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.getByRole('button',{name:'Connections',exact:true}).click();await axe(page);
 },{empty:true});
 await scenario('slow device serializes explicit commands while another device remains responsive',async(f,page)=>{
  await page.getByRole('button',{name:'pixel pixoo',exact:true}).click();const mode=page.getByLabel('Device mode').filter({visible:true});await mode.waitFor();f.setDelay(800);const startCount=f.requests.length;
  await until(()=>f.requests.slice(startCount).some(r=>r.id==='pixel'&&r.url==='/controller/v1/snapshot'));
  const start=performance.now();const wall=await fetch(f.hub.url+'/api/controllers/v1/wall/snapshot',{headers:f.headers});assert.equal(wall.status,200);independentDeviceReadMs=performance.now()-start;assert.ok(independentDeviceReadMs<700,'wall does not await pixel');
  await mode.selectOption('Monitor');await page.getByRole('button',{name:'Apply mode',exact:true}).filter({visible:true}).click();await page.getByText('queued. Physical result is not confirmed.',{exact:true}).waitFor();assert.equal(f.writes.at(-1).command.command.mode,'Monitor');assert.equal(await page.getByText('Not applied: capacity.',{exact:false}).count(),0);
  f.setDelay(0);await page.waitForFunction(()=>Array.from(document.querySelectorAll('dd')).some(el=>el.textContent.startsWith('Mode Monitor ·')));await page.getByRole('button',{name:'Discard edit / load current'}).filter({visible:true}).click();await mode.selectOption('Media');await page.getByRole('button',{name:'Apply mode',exact:true}).filter({visible:true}).click();await page.getByText('queued. Physical result is not confirmed.',{exact:true}).waitFor();assert.equal(f.writes.at(-1).command.command.mode,'Media');
 });
 await scenario('terminal integration failures, known evidence and external control are visible',async(f,page)=>{
  await page.getByRole('button',{name:'wall nanoleaf',exact:true}).click();await page.getByLabel('Layout style').waitFor();f.setQueued(true);await page.getByLabel('Layout style').selectOption('project');await page.getByRole('button',{name:'Apply integration settings',exact:true}).click();await page.getByText('queued. Physical result is not confirmed.',{exact:true}).waitFor();
  const ticket=f.nano.pending[0].requestId;f.nano.pending=[];f.nano.outcomes=[{apiVersion:f.nano.apiVersion,requestId:ticket,outcome:'failed',priorEffects:'none',physicalOutcome:'unknown',failure:{code:'revision-conflict'}}];
  await page.getByText('Result updated: failed · revision-conflict. Physical result is not confirmed.',{exact:true}).waitFor();await page.getByText('failed · revision-conflict',{exact:true}).waitFor();
  f.pixoo.lastOutcome={generation:f.pixoo.generation,renditionGeneration:1,status:'failed',code:'transport-failure'};
  const state=f.states.pixel;state.state.externalControl={status:'known',owner:'external',clock:state.sampleClock};state.state.observation={status:'known',clock:state.sampleClock,evidenceAgeMs:10000,power:{status:'known',value:true},brightness:{status:'known',value:50}};state.state.lastSuccessfulSend={status:'known',requestId:state.nextRequestId,clock:state.sampleClock,operationIds:['mode']};
  await page.getByRole('button',{name:'pixel pixoo',exact:true}).click();await page.getByText('failed · transport-failure',{exact:true}).waitFor();await page.getByText('Sent mode · physical result unknown',{exact:true}).waitFor();const observation=page.locator('dl>div').filter({has:page.getByText('Observation age',{exact:true})}).filter({visible:true});assert.match(await observation.locator('dd').innerText(),/^1[0-9]s$/);await page.getByText('Unavailable: Device is externally controlled',{exact:true}).first().waitFor();assert.equal(await page.getByRole('button',{name:'Apply mode',exact:true}).filter({visible:true}).isDisabled(),true);
 });
 await scenario('rejected older snapshots cannot refresh evidence; expired cursor resync preserves drafts',async(f,page)=>{
  const label=page.getByLabel('Chosen label');await label.fill('Keep my draft');const received=await page.locator('#main').getAttribute('data-received');let stale=true;
  await page.route('**/api/monitor/v1/sessions',async route=>{const response=await route.fetch();const value=await response.json();if(stale)value.snapshot.revision=0;await route.fulfill({response,json:value});});f.reconnect();
  await page.getByRole('alert').filter({hasText:'stale-snapshot'}).waitFor();assert.equal(await page.locator('#main').getAttribute('data-received'),received);assert.equal(await label.inputValue(),'Keep my draft');assert.equal(await page.getByRole('button',{name:'Apply label',exact:true}).isDisabled(),true);
  let expired=false;await page.route('**/api/monitor/v1/changes',async route=>{expired=true;await route.continue({headers:{...route.request().headers(),'last-event-id':'expired:999'}});});stale=false;f.reconnect();await until(()=>expired);await page.waitForFunction(()=>!document.querySelector('[role=alert]'));assert.equal(await label.inputValue(),'Keep my draft');assert.equal(f.writes.length,0);
  const response=await fetch(f.hub.url+'/api/monitor/v1/changes',{headers:{...f.headers,'last-event-id':'expired:999'},signal:AbortSignal.timeout(3000)});const reader=response.body.getReader();assert.match(new TextDecoder().decode((await reader.read()).value),/event: resync/);await reader.cancel();
 });
 await scenario('partial receipt preserves confirmed transmission in browser feedback',async(f,page)=>{
  await page.getByRole('button',{name:'wall nanoleaf',exact:true}).click();await page.getByLabel('Device mode').first().waitFor();
  await page.route('**/api/controllers/v1/wall/commands',async route=>{const request=route.request().postDataJSON();const receipt={apiVersion:'1.0',controllerId:request.controllerId,deviceId:request.deviceId,requestId:request.requestId,configurationRevision:0,generation:request.expectedGeneration,outcome:'partially-applied',priorEffects:'confirmed-transmission',completedOperations:['mode'],uncertainOperations:['refresh'],failure:{code:'transport-failure'}};assert.equal(validate('receipt',receipt),true);await route.fulfill({status:503,json:receipt});});
  await page.getByLabel('Device mode').first().selectOption('Quiet');await page.getByRole('button',{name:'Apply mode',exact:true}).first().click();await page.getByText('partially-applied. Prior effects: confirmed-transmission.',{exact:false}).waitFor();assert.equal(await page.getByText('Not applied:',{exact:false}).count(),0);
 });
 const receipt={synthetic:true,physical:false,passed:true,checks,pixelReadDelayMs:800,independentDeviceReadMs};const output=process.env.DASHBOARD_RECEIPTS??'/tmp/gh6-dashboard-receipts';await mkdir(output,{recursive:true});await writeFile(output+'/matrix.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
}finally{await browser.close();}
