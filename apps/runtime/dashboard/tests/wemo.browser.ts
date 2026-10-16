// Actual module/core/gateway/dashboard with two synthetic plugs. No installed service or LAN requests.
import assert from 'node:assert/strict';
import {setTimeout as pause} from 'node:timers/promises';
import {AxeBuilder} from '@axe-core/playwright';
import {chromium} from 'playwright';
import {feed,startWorld} from './harness.ts';
const world=await startWorld({wemo:true}),browser=await chromium.launch({headless:true});
try{
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(15000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const writes:string[]=[];page.on('request',request=>{if(request.method()!=='GET'&&new URL(request.url()).pathname.startsWith('/api/v2/automation/'))writes.push(request.url());});
  await page.goto(`${world.url}/#/component/desk-lamp`);await feed(page,'connected');
  const card=page.locator('[data-device="desk-lamp"]'),panel=card.getByRole('region',{name:'Maximum on time'});
  await card.getByRole('button',{name:'Turn on',exact:true}).waitFor();await panel.getByLabel('Enable maximum on time').waitFor();
  await page.waitForFunction(()=>document.querySelector<HTMLInputElement>('[data-device="desk-lamp"] input[type="checkbox"]')?.disabled===false);
  assert.equal(writes.length,0);assert.equal(world.wemo.state()['desk-lamp']?.writes??0,0);
  await panel.getByLabel('Maximum on time (minutes)').fill('1');const reply=page.waitForResponse(response=>response.request().method()==='PUT'&&response.url().includes('/power-limits/'));await panel.getByRole('button',{name:'Save maximum on time'}).click();
  const savedReply=await reply;assert.equal(savedReply.status(),200,await savedReply.text());
  await panel.getByRole('status').filter({hasText:'Settings saved.'}).waitFor();assert.equal(writes.length,1);
  assert.equal(await panel.getByLabel('Enable maximum on time').isChecked(),false,'editing duration does not enable');
  await card.getByRole('button',{name:'Turn on',exact:true}).click();await card.getByRole('status').filter({hasText:'Completed: succeeded.'}).waitFor();
  const before=world.wemo.state()['desk-lamp']?.writes;assert.equal(before,1);
  // Select a short synthetic limit through the same authenticated management boundary, independently of the form's minutes.
  const saved=await page.evaluate(async()=>{const reply=await fetch('/api/v2/automation/power-limits/desk-lamp',{method:'PUT',headers:{'content-type':'application/json','bunny-request':'1'},body:JSON.stringify({enabled:true,durationMs:1000,expectedSettingsRevision:1})});return reply.status;});assert.equal(saved,200);
  await page.close();
  const deadline=Date.now()+15000;while((world.wemo.state()['desk-lamp']?.writes??0)<2&&Date.now()<deadline)await pause(50);
  assert.equal(world.wemo.state()['desk-lamp']?.power,false,'Hub enforces while page is closed');assert.equal(world.wemo.state()['desk-lamp']?.writes,2);
  assert.equal(world.wemo.state()['shelf-lamp']?.writes??0,0,'second plug remains independent');
  const reopened=await context.newPage();await reopened.goto(`${world.url}/#/component/desk-lamp`);await feed(reopened,'connected');
  await reopened.locator('[data-device="desk-lamp"]').getByLabel('Enable maximum on time').waitFor();
  await pause(1000);assert.equal(world.wemo.state()['desk-lamp']?.writes,2,'reload sends nothing again');
  await reopened.goto(`${world.url}/#/component/shelf-lamp`);await feed(reopened,'connected');
  const shelf=reopened.locator('[data-device="shelf-lamp"]');world.wemoLoseReply();
  await shelf.getByRole('button',{name:'Turn on',exact:true}).click();await shelf.getByRole('status').filter({hasText:'Uncertain result.'}).waitFor();
  assert.equal(world.wemo.state()['shelf-lamp']?.writes,1);await reopened.reload();await feed(reopened,'connected');
  await shelf.getByRole('button',{name:'Release Wemo hold',exact:true}).waitFor();
  await shelf.getByRole('button',{name:'Release Wemo hold',exact:true}).click();await shelf.getByRole('status').filter({hasText:'Completed: succeeded.'}).waitFor();
  assert.equal(world.wemo.state()['shelf-lamp']?.writes,1,'hold release reads fresh state but sends no power');
  await shelf.getByRole('button',{name:'Turn off',exact:true}).click();await shelf.getByRole('status').filter({hasText:'Completed: succeeded.'}).waitFor();assert.equal(world.wemo.state()['shelf-lamp']?.writes,2);
  const axe=await new AxeBuilder({page:reopened}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(axe.violations.map(value=>value.id),[]);
  await reopened.setViewportSize({width:390,height:844});const phone=await new AxeBuilder({page:reopened}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(phone.violations.map(value=>value.id),[]);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({journey:'wemo-power-limit',writes:2,pageClosedEnforcement:true,independent:true,explicitHoldReleaseWithoutWrite:true,axe:'desktop and phone passed'}));await context.close();
}finally{await browser.close();await world.close();}
