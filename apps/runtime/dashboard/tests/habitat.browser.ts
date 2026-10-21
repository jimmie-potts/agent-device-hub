// Synthetic sessions only. The habitat reads the shell connection and never commands an agent or device.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {AxeBuilder} from '@axe-core/playwright';
import {changes,feed,startWorld} from './harness.ts';
import {IDENTITY} from '../../dist/tests/fixtures/agents.js';
const world=await startWorld(),browser=await chromium.launch({headless:true});
const output=process.env.DASHBOARD_RECEIPTS;if(output!==undefined)await mkdir(output,{recursive:true});
try{
 for(let n=0;n<12;n++)await world.observe({kind:'session-started'},{identity:{...IDENTITY,sessionId:`habitat-${n}`},title:{value:`Synthetic agent ${n}`,source:'provider'}});
 await world.observe({kind:'turn-ended'},{identity:{...IDENTITY,sessionId:'habitat-11'}});
 const context=await browser.newContext({viewport:{width:1440,height:1100},reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(12000);
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));const sent=changes(page);let streams=0;page.on('request',request=>{if(request.url().endsWith('/api/sdk/v1/stream'))streams++;});
 await page.goto(world.url);await feed(page,'connected');const before=streams;
 await page.getByRole('link',{name:'Habitat',exact:true}).click();await page.locator('#habitat[data-ready=true]').waitFor();
 await page.getByText('10 assigned · 0 free spots · 2 waiting',{exact:true}).waitFor();assert.equal(streams,before,'the habitat reuses the shell connection');
 assert.equal(await page.locator('.habitat-root .agent[data-assigned=true]').count(),10);
 assert.equal(await page.locator('#all-work').isDisabled(),true);assert.equal(await page.locator('#motion').textContent(),'Reduced motion');
 const names=await page.locator('.habitat-root .agent-name').allTextContents();
 const selected=page.locator('#agent-0');await selected.focus();await page.keyboard.press('Enter');await page.keyboard.press('Enter');await page.locator('#conversation-hint').filter({hasText:'not connected yet'}).waitFor();
 await page.locator('#music-view').click();await page.locator('#workshop-view').click();
 await world.observe({kind:'turn-started'},{identity:{...IDENTITY,sessionId:'habitat-11'},turn:'turn-2'});await page.locator('#agent-0[data-state=working]').waitFor();assert.deepEqual(await page.locator('.habitat-root .agent-name').allTextContents(),names);
 // Moving an already assigned session swaps residents rather than duplicating it.
 await page.locator('#live-bunny').selectOption('1');await page.locator('#live-session').selectOption({label:'Synthetic agent 11 · Claude Code'});await page.locator('#live-bind').click();
 assert.equal(await page.locator('#agent-1 .agent-name').textContent(),'Synthetic agent 11');assert.equal(await page.locator('#agent-0 .agent-name').textContent(),names[1]);
 await page.locator('#live-bunny').selectOption('9');await page.locator('#live-unbind').click();await page.getByText(/9 assigned · 1 free spots · 3 waiting · Automatic filling paused/).waitFor();assert.equal(await page.locator('#live-auto').isChecked(),false);
 await page.locator('#live-auto').check();await page.getByText('10 assigned · 0 free spots · 2 waiting',{exact:true}).waitFor();
 const saved=await page.evaluate(()=>localStorage.getItem('bunny.burrow.live-bindings.v2'));
 await page.route('**/api/sdk/v1/stream',route=>route.abort());world.dropDashboardStreams();await page.getByText('Session evidence uncertain',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>localStorage.getItem('bunny.burrow.live-bindings.v2')),saved);assert.equal(await page.locator('.agent[data-uncertain=true]').count(),10);
 await page.unroute('**/api/sdk/v1/stream');await feed(page,'connected');await page.getByText('10 assigned · 0 free spots · 2 waiting',{exact:true}).waitFor();
 await page.locator('#live-mode').selectOption('demo');
 await page.locator('#demo').click();await page.locator('.habitat-root .click-pulse').waitFor();
 const pulse=await page.locator('.habitat-root .click-pulse').evaluate(element=>{const style=getComputedStyle(element);return {position:style.position,width:style.width,border:style.borderTopWidth};});assert.deepEqual(pulse,{position:'fixed',width:'40px',border:'3px'});
 await page.locator('#all-idle').click();assert.equal(await page.locator('#demo-cursor').isVisible(),false);assert.equal(await page.locator('.habitat-root .click-pulse').count(),0,'taking over cancels the pulse and its timer');
 assert.equal(await page.locator('#all-work').isEnabled(),true);await page.locator('#all-work').click();
 await page.locator('#live-mode').selectOption('live');assert.equal(await page.locator('#all-work').isDisabled(),true);assert.equal(await page.evaluate(()=>localStorage.getItem('bunny.burrow.live-bindings.v2')),saved);
 await page.getByText('Move your habitat settings',{exact:true}).click();
 const importedSession=await page.locator('#live-session option').filter({hasText:'Synthetic agent 11 · Claude Code'}).getAttribute('value');assert.ok(importedSession!==null);
 const colors=Array<string>(10).fill('#345678'),settings=JSON.stringify({schema:'bunny-habitat-settings/1.0',preferences:{'bunny.burrow.aprons.v1':JSON.stringify(colors),'bunny.burrow.live-binding.v1':JSON.stringify({sessionId:importedSession,bunnyId:6})}});
 await page.getByLabel('Import habitat settings',{exact:true}).setInputFiles({name:'settings.json',mimeType:'application/json',buffer:Buffer.from(settings)});
 await page.getByText('Settings imported. Previous settings are backed up in this browser.',{exact:true}).waitFor();await page.locator('#habitat[data-ready=true]').waitFor();assert.equal(await page.locator('#apron-color').inputValue(),'#345678');assert.equal(await page.locator('#agent-6 .agent-name').textContent(),'Synthetic agent 11','legacy file replaces receiving v2 assignments at the imported slot');
 const axe=async():Promise<void>=>{const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);};
 for(const colorScheme of ['dark','light'] as const){await page.emulateMedia({colorScheme});await axe();await page.setViewportSize({width:390,height:844});await axe();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);if(output!==undefined)await page.screenshot({path:`${output}/habitat-${colorScheme}-phone.png`,fullPage:true});await page.setViewportSize({width:1440,height:1100});}
 if(output!==undefined)await page.screenshot({path:`${output}/habitat-desktop.png`,fullPage:true});
 await page.emulateMedia({reducedMotion:'no-preference'});await page.locator('#motion').filter({hasText:'Pause motion'}).waitFor();
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
 const hiddenFrames=await page.locator('#habitat').getAttribute('data-frames');await page.waitForTimeout(200);assert.equal(await page.locator('#habitat').getAttribute('data-frames'),hiddenFrames,'hidden documents do not redraw');
 await page.evaluate(()=>{Reflect.deleteProperty(document,'hidden');document.dispatchEvent(new Event('visibilitychange'));});
 const oldCanvas=await page.locator('#habitat').elementHandle();assert.ok(oldCanvas!==null);await page.getByRole('link',{name:'Home',exact:true}).click();await page.waitForTimeout(100);const stopped=await oldCanvas.getAttribute('data-frames');await page.waitForTimeout(200);assert.equal(await oldCanvas.getAttribute('data-frames'),stopped,'unmounted renderer stops drawing');
 await page.getByRole('link',{name:'Habitat',exact:true}).click();await page.locator('#habitat[data-ready=true]').waitFor();assert.equal(await page.locator('.habitat-root .agent').count(),10);assert.deepEqual(sent,[]);assert.deepEqual(errors,[]);
 const fallback=await context.newPage();await fallback.addInitScript(()=>{HTMLCanvasElement.prototype.getContext=()=>null;});await fallback.goto(world.url+'/#/habitat');await feed(fallback,'connected');await fallback.getByRole('region',{name:'Habitat session list'}).waitFor();await fallback.waitForFunction(()=>document.querySelector('[aria-label="Habitat session list"]')?.querySelectorAll('li').length===12);await fallback.close();
 const failedArt=await context.newPage();await failedArt.route('**/habitat/habitat-desk-entry.webp',route=>route.abort());await failedArt.goto(world.url+'/#/habitat');await failedArt.getByRole('region',{name:'Habitat session list'}).waitFor();await failedArt.close();
 // A pending local file read must not write preferences after leaving this page.
 await page.evaluate(()=>{File.prototype.text=async function(this:File):Promise<string>{await new Promise(resolve=>setTimeout(resolve,500));return new TextDecoder().decode(await this.arrayBuffer());};});
 await page.getByText('Move your habitat settings',{exact:true}).click();
 const late=JSON.stringify({schema:'bunny-habitat-settings/1.0',preferences:{'bunny.burrow.aprons.v1':JSON.stringify(Array<string>(10).fill('#998877'))}});
 await page.getByLabel('Import habitat settings',{exact:true}).setInputFiles({name:'late.json',mimeType:'application/json',buffer:Buffer.from(late)});await page.getByRole('link',{name:'Home',exact:true}).click();await page.waitForTimeout(600);assert.equal(await page.evaluate(()=>localStorage.getItem('bunny.burrow.aprons.v1')),JSON.stringify(colors));
 const native='00000000-0000-4000-8000-000000000099';await world.observe({kind:'session-started'},{identity:{...IDENTITY,provider:'codex',client:'desktop',sourceId:'codex-desktop',sessionId:native},title:{value:'Synthetic desktop conversation',source:'provider'}});
 const windows=await browser.newContext({reducedMotion:'reduce'});await windows.addInitScript(()=>{Object.defineProperty(navigator,'platform',{get:()=> 'Win32'});});const desktop=await windows.newPage(),desktopSent=changes(desktop),cdp=await windows.newCDPSession(desktop),navigations:string[]=[];await cdp.send('Page.enable');cdp.on('Page.frameRequestedNavigation',(event:{url:string})=>{if(event.url.startsWith('codex:'))navigations.push(event.url);});
 await desktop.goto(world.url+'/#/habitat');await feed(desktop,'connected');await desktop.locator('#habitat[data-ready=true]').waitFor();await desktop.locator('#live-session').selectOption({label:'Synthetic desktop conversation · Codex Desktop'});await desktop.locator('#live-bunny').selectOption('0');await desktop.locator('#live-bind').click();
 await desktop.locator('#agent-0').click();assert.equal(navigations.length,0);await desktop.waitForTimeout(650);await desktop.locator('#agent-0').click();await desktop.waitForTimeout(100);assert.deepEqual(navigations,[`codex://threads/${native}`]);
 await desktop.locator('#agent-0').focus();await desktop.keyboard.press('Enter');assert.equal(navigations.length,1);await desktop.keyboard.press('Space');await desktop.waitForTimeout(100);assert.equal(navigations.length,2);assert.deepEqual(desktopSent,[]);await windows.close();
 await context.close();process.stdout.write(JSON.stringify({journey:'shared-habitat',capacity:10,overflow:2,singleConnection:true,reconnect:true,import:true,cleanup:true,axe:'dark/light desktop/390px',commands:0,physical:false})+'\n');
}finally{await browser.close();await world.close();}
