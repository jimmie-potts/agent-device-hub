// Actual module/core/gateway/dashboard with two synthetic plugs. No installed service or LAN requests.
import assert from 'node:assert/strict';
import {setTimeout as pause} from 'node:timers/promises';
import {chromium} from 'playwright';
import {type Page} from 'playwright';
import {feed,startWorld,holdDashboardStream} from './harness.ts';
const world=await startWorld({wemo:true}),browser=await chromium.launch({headless:true});
type Sent={path:string;target:string;keys:string;on:unknown};
/** Every power command the page sends, reduced to its route, target, data fields and value. */
function powerCommands(page:Page):Sent[]{
  const sent:Sent[]=[];
  page.on('request',request=>{const {pathname}=new URL(request.url());if(request.method()!=='POST'||!pathname.startsWith('/api/v2/commands/'))return;
    const body=JSON.parse(request.postData()??'{}') as {target:string;data:Record<string,unknown>};sent.push({path:pathname,target:body.target,keys:Object.keys(body.data).sort().join(','),on:body.data['on']});});
  return sent;
}
/**
 * A plug on Home's wide grid is a press panel (#1931): pointer, keyboard and touch each switch it with the full card's
 * command; its pressed state and its light follow the plug's observed power, and a lost reply leaves it locked.
 */
async function pressPanel(browser:Awaited<ReturnType<typeof chromium.launch>>,url:string,plugs:typeof world):Promise<Record<string,unknown>>{
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(15000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const sent=powerCommands(page);
  await page.goto(`${url}/#/component/shelf-lamp`);await feed(page,'connected');
  const card=page.locator('[data-device="shelf-lamp"]');await card.getByRole('button',{name:'Turn on',exact:true}).click();
  await card.getByRole('status').filter({hasText:'Completed: succeeded.'}).waitFor();
  const reference=sent.splice(0);assert.deepEqual(reference.map(item=>item.path),['/api/v2/commands/power-set']);
  const same=async(on:boolean,label:string):Promise<void>=>{
    const deadline=Date.now()+15000;while(sent.length===0&&Date.now()<deadline)await pause(50);
    assert.deepEqual(sent.splice(0),[{...reference[0],on}],`${label} sends the full card's command once`);
  };
  await page.goto(url);await feed(page,'connected');
  const panel=page.locator('[data-plug-panel="shelf-lamp"]'),button=panel.getByRole('button',{name:'Shelf lamp power',exact:true}),lamp=panel.locator('.plug-icon');
  const shows=async(on:boolean):Promise<void>=>{
    await panel.locator('.plug-press small').filter({hasText:on?/^On · observed$/:/^Off · observed$/}).waitFor();
    assert.equal(await button.getAttribute('aria-pressed'),String(on));assert.equal(await lamp.getAttribute('data-glass-lamp'),on?'0.8':'0','the light follows the observed power');
    await page.waitForFunction(()=>document.querySelector<HTMLButtonElement>('[data-plug-panel="shelf-lamp"] .plug-press')?.disabled===false);
  };
  await shows(true);
  assert.equal(await panel.getByRole('link',{name:'Open Shelf lamp',exact:true}).getAttribute('href'),'#/component/shelf-lamp');
  await button.click();await same(false,'a pointer press');
  // Right after the command completes, before the plug's next report: the panel shows the request, and a press acts
  // on it, so a second press switches back rather than sending the same command again.
  await page.waitForFunction(()=>document.querySelector<HTMLButtonElement>('[data-plug-panel="shelf-lamp"] .plug-press')?.disabled===false);
  const early=await panel.evaluate(node=>({pressed:node.querySelector('.plug-press')?.getAttribute('aria-pressed'),state:node.querySelector('.plug-press small')?.textContent}));
  assert.equal(early.pressed,'false','the panel shows the request at once');assert.match(early.state??'',/^(Requested off · observed on|Off · observed)$/);
  await button.focus();await page.keyboard.press('Space');await same(true,'Space right after');await shows(true);
  await button.focus();await page.keyboard.press('Enter');await same(false,'Enter');await shows(false);
  assert.equal(plugs.wemo.state()['shelf-lamp']?.power,false);
  // Touch: a tap switches it.
  const touch=await browser.newContext({viewport:{width:1440,height:1000},hasTouch:true}),phone=await touch.newPage();phone.setDefaultTimeout(15000);
  const tapped=powerCommands(phone);await phone.goto(url);await feed(phone,'connected');
  const touchButton=phone.locator('[data-plug-panel="shelf-lamp"]').getByRole('button',{name:'Shelf lamp power',exact:true});
  await phone.waitForFunction(()=>document.querySelector<HTMLButtonElement>('[data-plug-panel="shelf-lamp"] .plug-press')?.disabled===false);
  await touchButton.tap();
  const deadline=Date.now()+15000;while(tapped.length===0&&Date.now()<deadline)await pause(50);
  assert.deepEqual(tapped,[{...reference[0],on:true}],'a tap sends the full card\'s command once');
  await touch.close();await shows(true);
  // A lost reply: the panel says so, it cannot be pressed, and nothing is sent again.
  plugs.wemoLoseReply();await button.click();await same(false,'a press whose reply is lost');
  await panel.locator('.plug-result').filter({hasText:'Uncertain result.'}).waitFor();
  assert.equal(await button.isDisabled(),true,'an uncertain plug cannot be pressed');
  await page.waitForTimeout(300);assert.deepEqual(sent,[],'nothing is sent again');
  assert.deepEqual(errors,[]);await context.close();
  return {pointer:true,keyboard:true,touch:true,observedPressed:true,uncertain:true,readOnly:true};
}
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
  // The wide Home grid shows each plug as a press panel (#1931), whose Open leads to its device page; Home in one
  // column keeps the full card.
  await reopened.getByRole('link',{name:'Home',exact:true}).click();
  assert.equal(await reopened.getByRole('link',{name:'Open Shelf lamp',exact:true}).getAttribute('href'),'#/component/shelf-lamp');
  await reopened.setViewportSize({width:560,height:1000});await shelf.getByRole('tab',{name:'Power',exact:true}).waitFor();
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
  await reopened.route('**/api/sdk/v1/sync',route=>route.abort());const releaseStream=await holdDashboardStream(reopened);world.dropDashboardStreams();
  await shelf.getByRole('status').filter({hasText:/^! Stale$/}).waitFor();
  assert.equal(await shelf.getByRole('button',{name:'Turn on',exact:true}).isDisabled(),true);
  await reopened.unroute('**/api/sdk/v1/sync');releaseStream();await feed(reopened,'connected');
  await reopened.route('**/api/v2/authority?scope=control',route=>route.fulfill({status:403,contentType:'application/json',body:'{"error":{"code":"forbidden","retryable":false}}'}));
  await reopened.reload();await feed(reopened,'connected');
  assert.equal(await shelf.getByRole('button',{name:'Turn on',exact:true}).isDisabled(),true);
  await shelf.getByRole('tab',{name:'Auto-off',exact:true}).click();
  assert.equal(await shelf.getByLabel('Enable maximum on time').isDisabled(),true);
  await shelf.getByRole('tab',{name:'Power',exact:true}).click();
  await reopened.setViewportSize({width:390,height:844});
  if(process.env.DASHBOARD_RECEIPTS!==undefined)await reopened.screenshot({path:process.env.DASHBOARD_RECEIPTS+'/wemo-card-phone.png',fullPage:true});
  // The press panel (#1931) on the wide grid: read-only shows the observed state and sends nothing.
  await reopened.setViewportSize({width:1440,height:1000});
  const readOnlyPanel=reopened.locator('[data-plug-panel="shelf-lamp"]');
  assert.equal(await readOnlyPanel.getByRole('button',{name:'Shelf lamp power',exact:true}).isDisabled(),true,'a read-only press panel is disabled');
  await readOnlyPanel.getByText('Read-only',{exact:true}).waitFor();
  const press=await pressPanel(browser,world.url,world);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({journey:'wemo-power-limit',press,writes:2,pageClosedEnforcement:true,independent:true,explicitHoldReleaseWithoutWrite:true,stableTabs:true,geometryNegativeControl:true,homeReuse:true,readOnly:true,stale:true,uncertainSave:true}));await context.close();
}finally{await browser.close();await world.close();}
