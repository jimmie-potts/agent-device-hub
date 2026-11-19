import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import type {Locator,Page} from 'playwright';
import {expect} from 'playwright/test';
import {setTimeout as pause} from 'node:timers/promises';
import {join} from 'node:path';
import {browserArtifactDirectory} from './browser-artifacts.ts';
import {feed,startWorld} from './harness.ts';
import {worldClock,type WorldClock} from './world-clock.ts';
// Each world runs on its own world clock (Hub #1708): the simulator's observations, the module's freshness, hold and
// confirmation timers and the runtime move only when the journey advances them. On the real clock a stall of this
// process of half a second, which a busy runner can give, aged the last observation while the acknowledged neutral
// input confirmed its zero head input. The module then fenced the transmitted input as uncertain and held it again, so
// the acknowledgement never hid (#1946).
function heldItem(value:unknown):{id:string;revision:number}|undefined {
  if(Array.isArray(value)){for(const x of value){const found=heldItem(x);if(found!==undefined)return found;}return undefined;}
  if(typeof value!=='object'||value===null)return undefined;
  if('id'in value&&typeof value.id==='string'&&'revision'in value&&typeof value.revision==='number'&&'item'in value&&typeof value.item==='object'&&value.item!==null&&'command'in value.item&&typeof value.item.command==='string'&&value.item.command.startsWith('org.bunny.microduck.'))return {id:value.id,revision:value.revision};
  for(const child of Object.values(value)){const found=heldItem(child);if(found!==undefined)return found;}return undefined;
}
/** Names what the browser showed when a held-checkbox wait failed, so a hosted log can tell a stale-record refusal, a feed resync, a new hold and a module failure apart (#1492, #1946). */
async function heldWaitEvidence(page:Page,panel:Locator,effects:readonly {yaw:number}[],step:string):Promise<string> {
  // Each read is bounded so a wedged page cannot hide the original timeout behind a job timeout.
  const read=async(value:Promise<unknown>):Promise<string>=>{try{return JSON.stringify(await Promise.race([value,pause(2000,undefined,{ref:false}).then(()=>{throw new Error('no answer within 2 s');})]));}catch(error){return 'unreadable: '+(error instanceof Error?error.message:String(error));}};
  return [`MicroDuck held-checkbox wait failed after ${step}. Evidence:`,
    '  dashboard feed: '+await read(page.locator('main#main').getAttribute('data-feed',{timeout:1000})),
    '  command feedback: '+await read(panel.locator('.microduck-feedback').allInnerTexts()),
    '  panel buttons: '+await read(panel.getByRole('button').evaluateAll(nodes=>nodes.map(node=>`${node.textContent??''}${node instanceof HTMLButtonElement&&node.disabled?' (disabled)':''}`))),
    '  panel text: '+await read(panel.innerText({timeout:1000}).then(text=>text.split('\n').filter(line=>line.trim()!==''))),
    '  simulator effects (yaw): '+JSON.stringify(effects.map(x=>x.yaw))].join('\n');
}
/** Waits for `wait`, and on failure logs what the panel showed after `step`. */
async function held(page:Page,panel:Locator,effects:readonly {yaw:number}[],step:string,wait:Promise<unknown>):Promise<void> {
  await wait.catch(async(error:unknown)=>{console.error(await heldWaitEvidence(page,panel,effects,step));throw error;});
}
/** The simulator connects at once and needs two observations, 50 ms apart on the world clock, before it is available. */
async function available(clock:WorldClock,panel:Locator):Promise<void> {
  await clock.advance(200);await panel.getByRole('status').filter({hasText:'Simulator available'}).waitFor();
}
/**
 * An admitted neutral input confirms zero head input from the next observations and holds for 800 ms of world time.
 * Time moves only once the input is sent (`effects` grew past `before`), so the hold starts before time does.
 */
async function neutralCompletes(clock:WorldClock,panel:Locator,effects:readonly {yaw:number}[],before:number):Promise<void> {
  await panel.getByText('Active neutral neutral phase',{exact:true}).waitFor();
  await expect.poll(()=>effects.length,{message:'the neutral input is sent'}).toBe(before+1);await clock.advance(900);
}
const screenshot = join(await browserArtifactDirectory(), 'microduck-browser.png');
const clock=worldClock(),world=await startWorld({microduck:true,companions:true,clock}),browser=await chromium.launch({headless:true});
async function lostLocalRequests():Promise<void> {
  const time=worldClock(),own=await startWorld({microduck:true,clock:time}),context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(15000);
  try {
    await time.install(page);
    await page.goto(`${own.url}/#/module/microduck/controls`);await feed(page,'connected');
    const panel=page.getByRole('region',{name:'MicroDuck robot controls'}),stop=panel.getByRole('button',{name:'Stop expression',exact:true});
    await available(time,panel);
    const abort=async(name:string,family:string):Promise<void>=>{
      await page.route(`**/api/v2/commands/${family}`,route=>route.abort());
      const failed=page.waitForEvent('requestfailed',{predicate:r=>r.url().endsWith('/commands/'+family)});
      await panel.getByRole('button',{name,exact:true}).click();await failed;
      await page.unroute(`**/api/v2/commands/${family}`);
      await expect(panel.getByRole('button',{name,exact:true}),'a lost local response must allow a fresh explicit request').toBeEnabled();
    };
    await abort('Take over','microduck-control');await panel.getByRole('button',{name:'Take over',exact:true}).click();await panel.getByText(/Manual takeover/).waitFor();
    await abort('Disable automatic expression','microduck-control');await panel.getByRole('button',{name:'Disable automatic expression',exact:true}).click();
    await abort('Resume automatic expression','microduck-control');await panel.getByRole('button',{name:'Resume automatic expression',exact:true}).click();await panel.getByText(/^Automatic expression enabled/).waitFor();
    await panel.getByRole('button',{name:'Take over',exact:true}).click();await panel.getByText(/Manual takeover/).waitFor();
    await abort('Stop expression','microduck-stop');
    // World time stands still, so the notice holds in its outbound phase until Stop ends it.
    await panel.getByRole('button',{name:'Notice gesture',exact:true}).click();await panel.getByText(/Active notice outbound/).waitFor();
    await expect.poll(()=>own.microduck.effects.length,{message:'the notice outbound input is sent'}).toBe(1);
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
  page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);await clock.install(page);
  await page.goto(`${world.url}/#/module/microduck/controls`);await feed(page,'connected');
  const panel=page.getByRole('region',{name:'MicroDuck robot controls'}),notice=panel.getByRole('button',{name:'Notice gesture',exact:true});
  await available(clock,panel);
  assert.equal(world.microduck.nowNs(),BigInt(clock.clock.now())*1000000n,'the simulator observes on the world clock, so real time cannot age an observation');
  assert.equal(world.microduck.state().moves,0);assert.equal(await notice.isDisabled(),true);
  assert.match(JSON.stringify(await world.reachyMcp('microduck_status',{})),/simulated/);
  for(const family of ['microduck-gesture','microduck-stop','microduck-control','microduck-auto','microduck-dispatch'])assert.match(JSON.stringify(await world.reachyMcp('core_send_command',{family,target:'microduck-sim',data:{gesture:'notice'}})),/forbidden/);
  for(const family of ['microduck-gesture','microduck-stop','microduck-control','microduck-auto','microduck-dispatch'])assert.equal((await world.credentialAction(family,'microduck-sim',{gesture:'neutral'})).status,403,'machine HTTP credentials cannot bypass dashboard admission');
  assert.equal(world.microduck.effects.length,0);
  await panel.getByRole('button',{name:'Take over',exact:true}).focus();await page.keyboard.press('Enter');await panel.getByText(/Manual takeover/).waitFor();
  const observe=world.microduck.observation.bind(world.microduck);let healthy=false;
  world.microduck.observation=()=>({...observe(),healthy});
  await clock.advance(200);await panel.getByText('Waiting for fresh healthy balancing policy and zero velocity',{exact:true}).waitFor();
  assert.equal(await notice.isDisabled(),true,'unhealthy policy cannot offer an enabled head control');
  healthy=true;await clock.advance(200);await panel.getByText('Head input ready',{exact:true}).waitFor();
  await notice.click();
  await panel.getByText(/Active notice outbound phase/).waitFor();
  await expect.poll(()=>world.microduck.effects.length,{message:'the notice outbound input is sent'}).toBe(1);
  // The outbound input holds for 800 ms, the return follows, and its zero input confirms and holds for 800 ms more.
  await clock.advance(1700);
  await expect.poll(() => world.microduck.effects.map(effect => effect.yaw), {
    timeout: 2000,
    message: 'Notice gesture must send the outbound and return inputs',
  }).toEqual([0.1, 0]);
  await panel.getByText('No active program',{exact:true}).waitFor();
  // Manual cues keep a two-second minimum interval from the notice's admission.
  await clock.advance(400);await panel.getByRole('button',{name:'Attention gesture',exact:true}).click();await panel.getByText(/Active attention outbound phase/).waitFor();
  await expect.poll(()=>world.microduck.effects.length,{message:'the attention outbound input is sent'}).toBe(3);
  const stop=panel.getByRole('button',{name:'Stop expression',exact:true});assert.equal(await stop.isEnabled(),true);await stop.click();
  const acknowledgment=panel.getByRole('checkbox',{name:/I acknowledge this held operation/});await acknowledgment.waitFor();
  assert.equal(world.microduck.effects.length,3);assert.equal(world.microduck.effects.at(-1)?.yaw,-.1);
  const saved=heldItem(await world.reachyMcp('core_inbox',{}));assert.ok(saved);assert.match(JSON.stringify(await world.reachyMcp('core_handle_inbox',{id:saved.id,expectedRevision:saved.revision,action:'send-again'})),/forbidden/);
  assert.equal((await world.credentialAction('inbox-handle',saved.id,{action:'send-again',expectedRevision:saved.revision})).status,403);
  assert.equal(await world.credentialInboxResend(saved.id,saved.revision),true,'SDK inbox access cannot resend robot work');
  assert.equal(await page.evaluate(async saved=>{const response=await fetch('/api/v2/commands/inbox-handle',{method:'POST',headers:{'content-type':'application/json','bunny-request':'1'},body:JSON.stringify({target:saved.id,requestId:crypto.randomUUID(),data:{action:'send-again',expectedRevision:saved.revision}})});await response.arrayBuffer();return response.status;},saved),403,'browser saved-command resend is refused too');
  const neutral=panel.getByRole('button',{name:'Neutral head input',exact:true});assert.equal(await neutral.isDisabled(),true);await acknowledgment.check();
  let sent=world.microduck.effects.length;await neutral.click();
  await neutralCompletes(clock,panel,world.microduck.effects,sent);await held(page,panel,world.microduck.effects,'the acknowledged neutral input',acknowledgment.waitFor({state:'hidden'}));
  await panel.getByText('Last operation: succeeded',{exact:true}).waitFor();assert.equal(world.microduck.effects.at(-1)?.yaw,0);
  world.microduck.loseReply=true;await neutral.click();await held(page,panel,world.microduck.effects,'the lost-reply neutral command',acknowledgment.waitFor());assert.equal(await stop.isEnabled(),true);
  await acknowledgment.check();await neutral.click();await page.waitForFunction(()=>document.querySelector<HTMLInputElement>('.microduck-panel input[type="checkbox"]')?.checked===false);
  assert.equal(await neutral.isDisabled(),true);world.microduck.loseReply=false;await acknowledgment.check();
  sent=world.microduck.effects.length;await neutral.click();
  await neutralCompletes(clock,panel,world.microduck.effects,sent);await held(page,panel,world.microduck.effects,'the second acknowledged neutral input',acknowledgment.waitFor({state:'hidden'}));
  const before=world.microduck.effects.length;await page.reload();await feed(page,'connected');await panel.getByRole('status').filter({hasText:'Simulator available'}).waitFor();assert.equal(world.microduck.effects.length,before);
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  assert.deepEqual(errors,[],'MicroDuck controls page must have no uncaught page errors');
  await panel.screenshot({path:screenshot});
  console.log('MicroDuck browser artifacts: '+screenshot);
  world.microduck.act('offline');await panel.getByRole('status').filter({hasText:/Simulator (unavailable|stale)/}).waitFor();assert.equal(await stop.isEnabled(),true);assert.equal((await world.assistantRead()).status,200);
  console.log('MicroDuck browser passed: finite gestures, local Stop, exact held recovery, status-only MCP, passive reload and keyboard/narrow.');
}finally{await browser.close();await world.close();}
