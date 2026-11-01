import assert from 'node:assert/strict';
import {AxeBuilder} from '@axe-core/playwright';
import {chromium} from 'playwright';
import {setTimeout as pause} from 'node:timers/promises';
import {feed,startWorld} from './harness.ts';
function heldItem(value:unknown):{id:string;revision:number}|undefined {
  if(Array.isArray(value)){for(const x of value){const found=heldItem(x);if(found!==undefined)return found;}return undefined;}
  if(typeof value!=='object'||value===null)return undefined;
  if('id'in value&&typeof value.id==='string'&&'revision'in value&&typeof value.revision==='number'&&'item'in value&&typeof value.item==='object'&&value.item!==null&&'command'in value.item&&typeof value.item.command==='string'&&value.item.command.startsWith('org.bunny.microduck.'))return {id:value.id,revision:value.revision};
  for(const child of Object.values(value)){const found=heldItem(child);if(found!==undefined)return found;}return undefined;
}
const world=await startWorld({microduck:true,companions:true}),browser=await chromium.launch({headless:true});
try {
  const context=await browser.newContext({viewport:{width:390,height:1000},reducedMotion:'reduce'}),page=await context.newPage(),errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
  await page.goto(`${world.url}/#/module/microduck/controls`);await feed(page,'connected');
  const panel=page.getByRole('region',{name:'MicroDuck robot controls'});
  await panel.getByRole('status').filter({hasText:'Simulator available'}).waitFor();
  assert.equal(world.microduck.state().moves,0);assert.equal(await panel.getByRole('button',{name:'Notice gesture',exact:true}).isDisabled(),true);
  assert.match(JSON.stringify(await world.reachyMcp('microduck_status',{})),/simulated/);
  for(const family of ['microduck-gesture','microduck-stop','microduck-control','microduck-auto','microduck-dispatch'])assert.match(JSON.stringify(await world.reachyMcp('core_send_command',{family,target:'microduck-sim',data:{gesture:'notice'}})),/forbidden/);
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
