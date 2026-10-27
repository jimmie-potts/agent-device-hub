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
  await card.getByRole('tab',{name:'Power',exact:true}).waitFor();
  assert.equal(await card.locator('.wemo-art').count(),1,'the connected-load illustration stays mounted');
  assert.doesNotMatch(await card.innerText(),/Smart plug|Reported by plug|Armed/);
  for(const colorScheme of ['light','dark'] as const){await page.emulateMedia({colorScheme});for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:1000});
    const powerBox=await card.boundingBox(),artBox=await card.locator('.wemo-art').boundingBox();
    await card.getByRole('tab',{name:'Auto-off',exact:true}).click();
    assert.deepEqual(await card.boundingBox(),powerBox,'tabs preserve card dimensions');
    assert.deepEqual(await card.locator('.wemo-art').boundingBox(),artBox,'tabs preserve artwork position');
    assert.equal(await card.getByRole('button',{name:'Turn on',exact:true}).isVisible(),false);
    await panel.getByLabel('Maximum on time (minutes)').fill('17');
    await card.getByRole('tab',{name:'Power',exact:true}).click();
    assert.equal(await panel.getByLabel('Maximum on time (minutes)').isVisible(),false);
    await card.getByRole('tab',{name:'Auto-off',exact:true}).click();
    assert.equal(await panel.getByLabel('Maximum on time (minutes)').inputValue(),'17','tabs preserve the draft');
    if(process.env.DASHBOARD_RECEIPTS!==undefined&&width!==320)await card.screenshot({path:process.env.DASHBOARD_RECEIPTS+`/wemo-auto-off-${colorScheme}-${width}.png`});
    await card.getByRole('tab',{name:'Power',exact:true}).click();
    if(process.env.DASHBOARD_RECEIPTS!==undefined&&width!==320)await card.screenshot({path:process.env.DASHBOARD_RECEIPTS+`/wemo-power-${colorScheme}-${width}.png`});
  }}
  await page.emulateMedia({colorScheme:'light'});
  await page.setViewportSize({width:1440,height:1000});
  assert.equal(await card.locator('[role=tabpanel]:not([hidden])').evaluate(element=>getComputedStyle(element).animationName),'none','reduced motion removes the flip');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await card.getByRole('tab',{name:'Auto-off',exact:true}).click();
  assert.equal(await card.locator('[role=tabpanel]:not([hidden])').evaluate(element=>getComputedStyle(element).animationName),'wemo-flip','ordinary motion flips only the control face');
  await card.getByRole('tab',{name:'Power',exact:true}).click();await page.emulateMedia({reducedMotion:'reduce'});
  const mutant=await page.evaluate(()=>{
    for(const [sheetIndex,sheet] of [...document.styleSheets].entries())for(const [ruleIndex,rule] of [...sheet.cssRules].entries()){
      if(rule instanceof CSSStyleRule&&rule.selectorText.includes('.wemo-faces')&&rule.selectorText.includes('[hidden]')){
        const original={sheetIndex,ruleIndex,value:rule.style.getPropertyValue('display'),priority:rule.style.getPropertyPriority('display')};
        rule.style.setProperty('display','none','important');return original;
      }
    }
    throw new Error('missing fixed-tab layout rule');
  });
  const mutantPower=await card.boundingBox();await card.getByRole('tab',{name:'Auto-off',exact:true}).click();
  assert.notEqual((await card.boundingBox())?.height,mutantPower?.height,'negative control: removing inactive-panel layout makes the size check detect a change');
  await page.evaluate(original=>{const rule=document.styleSheets[original.sheetIndex]?.cssRules[original.ruleIndex];if(!(rule instanceof CSSStyleRule))throw new Error('missing layout rule');rule.style.setProperty('display',original.value,original.priority);},mutant);
  await card.getByRole('tab',{name:'Auto-off',exact:true}).click();
  assert.doesNotMatch(await card.innerText(),/Armed|Requires the Hub running|Unknown elapsed time/);
  await panel.getByLabel('Enable maximum on time').waitFor();
  await page.waitForFunction(()=>document.querySelector<HTMLInputElement>('[data-device="desk-lamp"] input[type="checkbox"]')?.disabled===false);
  assert.equal(writes.length,0);assert.equal(world.wemo.state()['desk-lamp']?.writes??0,0);
  await panel.getByLabel('Maximum on time (minutes)').fill('1');const reply=page.waitForResponse(response=>response.request().method()==='PUT'&&response.url().includes('/power-limits/'));await panel.getByRole('button',{name:'Save limit',exact:true}).click();
  const savedReply=await reply;assert.equal(savedReply.status(),200,await savedReply.text());
  await panel.getByRole('status').filter({hasText:'Saved.'}).waitFor();assert.equal(writes.length,1);
  assert.equal(await panel.getByLabel('Enable maximum on time').isChecked(),false,'editing duration does not enable');
  await card.getByRole('tab',{name:'Power',exact:true}).click();
  await card.getByRole('button',{name:'Turn on',exact:true}).click();await card.getByRole('status').filter({hasText:'Completed: succeeded.'}).waitFor();
  const before=world.wemo.state()['desk-lamp']?.writes;assert.equal(before,1);
  // Select a short synthetic limit through the same authenticated management boundary, independently of the form's minutes.
  const saved=await page.evaluate(async()=>{const reply=await fetch('/api/v2/automation/power-limits/desk-lamp',{method:'PUT',headers:{'content-type':'application/json','bunny-request':'1'},body:JSON.stringify({enabled:true,durationMs:1000,expectedSettingsRevision:1})});return reply.status;});assert.equal(saved,200);
  await page.close();
  const deadline=Date.now()+15000;while((world.wemo.state()['desk-lamp']?.writes??0)<2&&Date.now()<deadline)await pause(50);
  assert.equal(world.wemo.state()['desk-lamp']?.power,false,'Hub enforces while page is closed');assert.equal(world.wemo.state()['desk-lamp']?.writes,2);
  assert.equal(world.wemo.state()['shelf-lamp']?.writes??0,0,'second plug remains independent');
  const reopened=await context.newPage();await reopened.goto(`${world.url}/#/component/desk-lamp`);await feed(reopened,'connected');
  await reopened.locator('[data-device="desk-lamp"]').getByRole('tab',{name:'Auto-off',exact:true}).click();
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
  await reopened.getByRole('link',{name:'Home',exact:true}).click();await shelf.getByRole('tab',{name:'Power',exact:true}).waitFor();
  assert.equal(await reopened.locator('.wemo-card').count(),2,'Home reuses the same card for both plugs');
  await shelf.getByRole('tab',{name:'Power',exact:true}).focus();await reopened.keyboard.press('End');
  assert.equal(await shelf.getByRole('tab',{name:'Auto-off',exact:true}).getAttribute('aria-selected'),'true','keyboard switches tabs');
  const shelfLimit=shelf.getByRole('region',{name:'Maximum on time'});
  await reopened.route('**/api/v2/automation/power-limits/shelf-lamp',async route=>{const answer=await route.fetch();assert.equal(answer.status(),200);await answer.dispose();await route.abort();});
  await shelfLimit.getByLabel('Maximum on time (minutes)').fill('5');
  await shelfLimit.getByRole('button',{name:'Save limit',exact:true}).click();
  await shelfLimit.getByRole('status').filter({hasText:'Settings have no confirmed reply.'}).waitFor();
  await shelf.getByRole('tab',{name:'Power',exact:true}).click();await shelf.getByRole('tab',{name:'Auto-off',exact:true}).click();
  assert.equal(await shelfLimit.getByLabel('Enable maximum on time').isDisabled(),true,'tab changes retain uncertain-save lock');
  await reopened.unroute('**/api/v2/automation/power-limits/shelf-lamp');
  await shelfLimit.getByRole('button',{name:'Refresh current limit',exact:true}).click();
  await shelfLimit.getByRole('status').filter({hasText:'Current settings refreshed.'}).waitFor();
  assert.equal(await shelfLimit.getByLabel('Maximum on time (minutes)').inputValue(),'5','refresh reads the committed setting without replay');
  assert.equal(await shelfLimit.getByLabel('Enable maximum on time').isChecked(),false);
  assert.equal(world.wemo.state()['shelf-lamp']?.writes,2,'metadata save, tab navigation and refresh send no power');
  await shelf.getByRole('tab',{name:'Power',exact:true}).click();
  await reopened.route('**/api/sdk/v1/sync',route=>route.abort());await reopened.route('**/api/sdk/v1/stream',route=>route.abort());world.dropDashboardStreams();
  await shelf.getByRole('status').filter({hasText:/^! Stale$/}).waitFor();
  assert.equal(await shelf.getByRole('button',{name:'Turn on',exact:true}).isDisabled(),true);
  await reopened.unroute('**/api/sdk/v1/sync');await reopened.unroute('**/api/sdk/v1/stream');await feed(reopened,'connected');
  await reopened.route('**/api/v2/authority?scope=control',route=>route.fulfill({status:403,contentType:'application/json',body:'{"error":{"code":"forbidden","retryable":false}}'}));
  await reopened.reload();await feed(reopened,'connected');
  assert.equal(await shelf.getByRole('button',{name:'Turn on',exact:true}).isDisabled(),true);
  await shelf.getByRole('tab',{name:'Auto-off',exact:true}).click();
  assert.equal(await shelf.getByLabel('Enable maximum on time').isDisabled(),true);
  await shelf.getByRole('tab',{name:'Power',exact:true}).click();
  const axe=await new AxeBuilder({page:reopened}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(axe.violations.map(value=>value.id),[],JSON.stringify(axe.violations.map(value=>({id:value.id,nodes:value.nodes})),null,2));
  await reopened.setViewportSize({width:390,height:844});const phone=await new AxeBuilder({page:reopened}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(phone.violations.map(value=>value.id),[]);
  if(process.env.DASHBOARD_RECEIPTS!==undefined)await reopened.screenshot({path:process.env.DASHBOARD_RECEIPTS+'/wemo-card-phone.png',fullPage:true});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({journey:'wemo-power-limit',writes:2,pageClosedEnforcement:true,independent:true,explicitHoldReleaseWithoutWrite:true,stableTabs:true,geometryNegativeControl:true,homeReuse:true,readOnly:true,stale:true,uncertainSave:true,axe:'desktop and phone passed'}));await context.close();
}finally{await browser.close();await world.close();}
