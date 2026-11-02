import assert from 'node:assert/strict';
import {AxeBuilder} from '@axe-core/playwright';
import {chromium} from 'playwright';
import {expect} from 'playwright/test';
import {setTimeout as pause} from 'node:timers/promises';
import {feed,startWorld} from './harness.ts';
function heldItem(value:unknown):{id:string;revision:number}|undefined {
  if(Array.isArray(value)){for(const x of value){const found=heldItem(x);if(found!==undefined)return found;}return undefined;}
  if(typeof value!=='object'||value===null)return undefined;
  if('id'in value&&typeof value.id==='string'&&'revision'in value&&typeof value.revision==='number'&&'item'in value&&typeof value.item==='object'&&value.item!==null&&'command'in value.item&&typeof value.item.command==='string'&&value.item.command.startsWith('org.bunny.microduck.'))return {id:value.id,revision:value.revision};
  for(const child of Object.values(value)){const found=heldItem(child);if(found!==undefined)return found;}return undefined;
}
const world=await startWorld({microduck:true,companions:true}),browser=await chromium.launch({headless:true});
async function lostLocalRequests():Promise<void> {
  const own=await startWorld({microduck:true}),context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(15000);
  try {
    await page.goto(`${own.url}/#/module/microduck/controls`);await feed(page,'connected');
    const panel=page.getByRole('region',{name:'MicroDuck robot controls'}),stop=panel.getByRole('button',{name:'Stop expression',exact:true});
    await panel.getByRole('status').filter({hasText:'Simulator available'}).waitFor();
    const abort=async(name:string,family:string):Promise<void>=>{
      await page.route(`**/api/v2/commands/${family}`,route=>route.abort());
      const failed=page.waitForEvent('requestfailed',{predicate:r=>r.url().endsWith('/commands/'+family)});
      await panel.getByRole('button',{name,exact:true}).click();await failed;await pause(50);
      await page.unroute(`**/api/v2/commands/${family}`);
      assert.equal(await panel.getByRole('button',{name,exact:true}).isEnabled(),true,'a lost local response must allow a fresh explicit request');
    };
    await abort('Take over','microduck-control');await panel.getByRole('button',{name:'Take over',exact:true}).click();await panel.getByText(/Manual takeover/).waitFor();
    await abort('Disable automatic expression','microduck-control');await panel.getByRole('button',{name:'Disable automatic expression',exact:true}).click();
    await abort('Resume automatic expression','microduck-control');await panel.getByRole('button',{name:'Resume automatic expression',exact:true}).click();await panel.getByText(/^Automatic expression enabled/).waitFor();
    await panel.getByRole('button',{name:'Take over',exact:true}).click();await panel.getByText(/Manual takeover/).waitFor();
    await abort('Stop expression','microduck-stop');
    await panel.getByRole('button',{name:'Notice gesture',exact:true}).click();await panel.getByText(/Active notice outbound/).waitFor();
    await abort('Stop expression','microduck-stop');await stop.click();await panel.getByRole('checkbox').waitFor();
    assert.equal(own.microduck.effects.length,1,'new Stop must cancel the return without a hidden neutral');
    const retained=await page.evaluate(()=>sessionStorage.getItem('bunny-device-attempts')??'');
    const identities:unknown=JSON.parse(retained);assert.ok(Array.isArray(identities));assert.ok(identities.length>=5,'unconfirmed local identities remain retained');
    await page.reload();await feed(page,'connected');
    await expect(stop).toBeEnabled({timeout:15000});
    await expect(panel.getByRole('button',{name:'Take over',exact:true})).toBeEnabled({timeout:15000});
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('bunny-device-attempts')??''),retained,'reload neither removes nor replays uncertain requests');assert.equal(own.microduck.effects.length,1);
  }finally{await context.close();await own.close();}
}
try {
  await lostLocalRequests();
  const context=await browser.newContext({viewport:{width:390,height:1000},reducedMotion:'reduce'}),page=await context.newPage(),errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
  await page.goto(`${world.url}/#/module/microduck/controls`);await feed(page,'connected');
  const panel=page.getByRole('region',{name:'MicroDuck robot controls'});
  await panel.getByRole('status').filter({hasText:'Simulator available'}).waitFor();
  assert.equal(world.microduck.state().moves,0);assert.equal(await panel.getByRole('button',{name:'Notice gesture',exact:true}).isDisabled(),true);
  assert.match(JSON.stringify(await world.reachyMcp('microduck_status',{})),/simulated/);
  for(const family of ['microduck-gesture','microduck-stop','microduck-control','microduck-auto','microduck-dispatch'])assert.match(JSON.stringify(await world.reachyMcp('core_send_command',{family,target:'microduck-sim',data:{gesture:'notice'}})),/forbidden/);
  for(const family of ['microduck-gesture','microduck-stop','microduck-control','microduck-auto','microduck-dispatch'])assert.equal((await world.credentialAction(family,'microduck-sim',{gesture:'neutral'})).status,403,'machine HTTP credentials cannot bypass dashboard admission');
  assert.equal(world.microduck.effects.length,0);
  await panel.getByRole('button',{name:'Take over',exact:true}).focus();await page.keyboard.press('Enter');await panel.getByText(/Manual takeover/).waitFor();
  const observe=world.microduck.observation.bind(world.microduck);let healthy=false;
  world.microduck.observation=()=>({...observe(),healthy});await pause(200);
  assert.equal(await panel.getByRole('button',{name:'Notice gesture',exact:true}).isDisabled(),true,'unhealthy policy cannot offer an enabled head control');
  healthy=true;await pause(200);
  await panel.getByRole('button',{name:'Notice gesture',exact:true}).click();await panel.getByText(/Active notice outbound phase/).waitFor();await panel.getByText('No active program',{exact:true}).waitFor();
  assert.deepEqual(world.microduck.effects.map(x=>x.yaw),[.1,0]);
  await pause(600);await panel.getByRole('button',{name:'Attention gesture',exact:true}).click();await panel.getByText(/Active attention outbound phase/).waitFor();
  const stop=panel.getByRole('button',{name:'Stop expression',exact:true});assert.equal(await stop.isEnabled(),true);await stop.click();
  const acknowledgment=panel.getByRole('checkbox',{name:/I acknowledge this held operation/});await acknowledgment.waitFor();
  assert.equal(world.microduck.effects.length,3);assert.equal(world.microduck.effects.at(-1)?.yaw,-.1);
  const saved=heldItem(await world.reachyMcp('core_inbox',{}));assert.ok(saved);assert.match(JSON.stringify(await world.reachyMcp('core_handle_inbox',{id:saved.id,expectedRevision:saved.revision,action:'send-again'})),/forbidden/);
  assert.equal((await world.credentialAction('inbox-handle',saved.id,{action:'send-again',expectedRevision:saved.revision})).status,403);
  assert.equal(await world.credentialInboxResend(saved.id,saved.revision),true,'SDK inbox access cannot resend robot work');
  assert.equal(await page.evaluate(async saved=>{const response=await fetch('/api/v2/commands/inbox-handle',{method:'POST',headers:{'content-type':'application/json','bunny-request':'1'},body:JSON.stringify({target:saved.id,requestId:crypto.randomUUID(),data:{action:'send-again',expectedRevision:saved.revision}})});await response.arrayBuffer();return response.status;},saved),403,'browser saved-command resend is refused too');
  const neutral=panel.getByRole('button',{name:'Neutral head input',exact:true});assert.equal(await neutral.isDisabled(),true);await acknowledgment.check();await neutral.click();await acknowledgment.waitFor({state:'hidden'});
  await panel.getByText('Last operation: succeeded',{exact:true}).waitFor();assert.equal(world.microduck.effects.at(-1)?.yaw,0);
  world.microduck.loseReply=true;await neutral.click();await acknowledgment.waitFor();assert.equal(await stop.isEnabled(),true);
  await acknowledgment.check();await neutral.click();await page.waitForFunction(()=>document.querySelector<HTMLInputElement>('.microduck-panel input[type="checkbox"]')?.checked===false);
  assert.equal(await neutral.isDisabled(),true);world.microduck.loseReply=false;await acknowledgment.check();await neutral.click();await acknowledgment.waitFor({state:'hidden'});
  const before=world.microduck.effects.length;await page.reload();await feed(page,'connected');await panel.getByRole('status').filter({hasText:'Simulator available'}).waitFor();assert.equal(world.microduck.effects.length,before);
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  const axe=await new AxeBuilder({page}).analyze();assert.deepEqual(axe.violations,[]);assert.deepEqual(errors,[]);
  await panel.screenshot({path:'/tmp/microduck-browser.png'});
  world.microduck.act('offline');await panel.getByRole('status').filter({hasText:/Simulator (unavailable|stale)/}).waitFor();assert.equal(await stop.isEnabled(),true);assert.equal((await world.assistantRead()).status,200);
  console.log('MicroDuck browser passed: finite gestures, local Stop, exact held recovery, status-only MCP, passive reload, keyboard/narrow/reduced-motion and axe.');
}finally{await browser.close();await world.close();}
