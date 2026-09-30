// Hub #336: the Moments card end to end in Chromium, against the real hub and the fixture's moment-capable 1.1 wall.
// It covers card presence, moods, presets and the status switch, one send per press, every result line, the uncertain lock,
// supersede, the live line on the fake device clock, the faster refresh and its limits, keyboard focus, axe and a 390 px layout.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {fixture} from './fixture.mjs';

const browser=await chromium.launch({headless:true});
const checks=[];
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function scenario(name,run,options={moments:true}){
 if(process.env.DASHBOARD_SCENARIO&&!name.includes(process.env.DASHBOARD_SCENARIO))return;
 const f=await fixture(options),context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'}),page=await context.newPage();
 page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(f.hub.url);await page.getByText('Use a separately provisioned access token').click();await page.getByLabel('Hub browser access token').fill(f.token);
  await page.getByRole('button',{name:'Connect',exact:true}).click();await page.locator('#main[data-received]:not([data-received="0"])').waitFor();
  await run(f,page);assert.deepEqual(errors,[]);checks.push(name);
 }catch(error){console.error(name,await page.locator('section:visible').innerText().catch(()=>''));throw error;}finally{await context.close();await f.close();}
}
const section=page=>page.locator('section:visible');
const card=page=>section(page).locator('div.edit[role=group]').filter({has:page.getByRole('heading',{name:'Moments',exact:true})});
const status=page=>card(page).locator(':scope>[role=status]');
const live=page=>card(page).locator('.moment-line');
const mood=(page,name)=>card(page).getByRole('button',{name,exact:true});
const moments=f=>f.writes.filter(w=>w.id==='wall'&&!w.integration&&w.command?.command?.kind==='moment').map(w=>w.command);
const wallReads=f=>f.requests.filter(r=>r.id==='wall'&&r.method==='GET'&&r.url.startsWith('/controller/v1/snapshot')).length;
async function openWall(page){await page.getByRole('link',{name:'wall nanoleaf',exact:true}).click();await card(page).waitFor();}
async function axe(page){await page.mouse.move(0,0);const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>`${n.target.join(' ')}: ${n.failureSummary}`)})),[]);}
/** The count of moment POSTs once it has held still for a second, so a late or repeated send is counted. */
async function settledMoments(f){let seen=moments(f).length,still=0;for(let waited=0;waited<10000&&still<4;waited+=250){await pause(250);const now=moments(f).length;still=now===seen?still+1:0;seen=now;}return seen;}
const accepted=/^Celebrate: (Scheduled on wall|Sent to wall)\.$/;

try {
 await scenario('card presence, moods, presets, switch and the undeclared line; browsing sends nothing',async(f,page)=>{
  await section(page).getByRole('heading',{name:'Home',exact:true}).waitFor();
  assert.equal(await section(page).getByRole('heading',{name:'Moments',exact:true}).count(),0,'the home widget has no Moments card');
  await openWall(page);
  assert.deepEqual(await card(page).locator('.actions button').allTextContents(),['Celebrate','Setback','Reminder']);
  const more=card(page).getByRole('combobox',{name:'More moods'});
  assert.deepEqual(await more.locator('option').allTextContents(),['Choose a mood to play','Cozy','Storm']);
  const duration=card(page).getByRole('combobox',{name:'Duration'});
  assert.deepEqual(await duration.locator('option').allTextContents(),['5 s','10 s']);assert.equal(await duration.inputValue(),'10000');
  const cover=card(page).getByRole('switch',{name:'Play over agent status'});assert.equal(await cover.isChecked(),true);
  assert.equal(await live(page).textContent(),'No moment yet.');
  await section(page).getByText('Not declared by this controller: media.',{exact:true}).waitFor();
  // The Moments card comes after the general cards in the same grid.
  assert.deepEqual(await section(page).locator('.cards').first().locator(':scope>*>h3').allTextContents(),['Mode','Power','Brightness','Scenes','Moments']);
  await axe(page);
  await page.getByRole('link',{name:'pixel pixoo',exact:true}).click();await section(page).getByText('Not declared by this controller: scenes and moments.',{exact:true}).waitFor();
  assert.equal(await card(page).count(),0,'a 1.0 controller has no Moments card');
  await openWall(page);
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow at 390 px');
  const box=await card(page).boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=390,'the card fits a phone width');
  await axe(page);
  assert.equal(await settledMoments(f),0);assert.equal(f.writes.length,0,'browsing and polling send no command');
 },{moments:{moods:['celebrate','setback','reminder','cozy','storm'],maxDurationMs:20000,coversStatus:true}});

 await scenario('a core-only device has no menu; a device that cannot cover status has no switch and sends coversStatus false',async(f,page)=>{
  await openWall(page);
  assert.equal(await card(page).getByRole('combobox',{name:'More moods'}).count(),0);
  assert.deepEqual(await card(page).getByRole('combobox',{name:'Duration'}).locator('option').allTextContents(),['5 s','10 s','30 s']);
  assert.equal(await card(page).getByRole('switch').count(),0);
  await f.setMode('wall','Free');
  await mood(page,'Reminder').click();await status(page).filter({hasText:/^Reminder: (Scheduled on wall|Sent to wall)\.$/}).waitFor();
  assert.equal(await settledMoments(f),1);assert.equal(moments(f)[0].command.coversStatus,false);
 },{moments:{coversStatus:false}});

 await scenario('each press, menu choice and preset sends exactly one moment and nothing else sends',async(f,page)=>{
  await openWall(page);
  await mood(page,'Celebrate').click();await status(page).filter({hasText:accepted}).waitFor();
  assert.equal(await settledMoments(f),1,'one press sends one moment');
  await live(page).filter({hasText:/^Playing Celebrate, \d+ s left$/}).waitFor();
  const [first]=moments(f);
  assert.equal(first.apiVersion,'1.1');
  assert.deepEqual({mood:first.command.mood,durationMs:first.command.durationMs,coversStatus:first.command.coversStatus,priorityClass:first.command.priorityClass,palette:'palette' in first.command},{mood:'celebrate',durationMs:10000,coversStatus:true,priorityClass:'event',palette:false});
  // A menu choice by pointer sends at once; a keyboard step sends only on Enter.
  const more=card(page).getByRole('combobox',{name:'More moods'});
  await more.selectOption('cozy');await status(page).filter({hasText:/^Cozy: (Scheduled on wall|Sent to wall)\.$/}).waitFor();
  assert.equal(await settledMoments(f),2);assert.equal(moments(f)[1].command.mood,'cozy');
  assert.equal(await more.inputValue(),'','the menu clears so the same mood can be chosen again');
  await more.focus();await page.keyboard.press('ArrowDown');await pause(800);
  assert.equal(moments(f).length,2,'a keyboard step in the menu sends nothing');
  await page.keyboard.press('Enter');await status(page).filter({hasText:/^Cozy: (Scheduled on wall|Sent to wall)\.$/}).waitFor();
  assert.equal(await settledMoments(f),3);
  await card(page).getByRole('combobox',{name:'Duration'}).selectOption('5000');
  assert.equal(await settledMoments(f),3,'choosing a duration sends nothing');
  await card(page).getByRole('switch',{name:'Play over agent status'}).click();
  assert.equal(await settledMoments(f),3,'the switch sends nothing');
  await card(page).getByRole('switch',{name:'Play over agent status'}).click();
  // Keyboard activation keeps focus on the pressed mood.
  await mood(page,'Reminder').focus();await page.keyboard.press('Enter');await status(page).filter({hasText:/^Reminder: (Scheduled on wall|Sent to wall)\.$/}).waitFor();
  await page.waitForFunction(()=>document.activeElement?.textContent==='Reminder');
  assert.equal(await settledMoments(f),4);assert.equal(moments(f)[3].command.durationMs,5000);
  // A double click is one press while the first is running.
  await mood(page,'Setback').dblclick();await status(page).filter({hasText:/^Setback: (Scheduled on wall|Sent to wall)\.$/}).waitFor();
  assert.equal(await settledMoments(f),5);
  assert.equal(new Set(moments(f).map(m=>m.command.momentId)).size,5,'every press is a new moment');
  assert.equal(f.writes.length,5,'only the presses sent commands');
 },{moments:{moods:['celebrate','setback','reminder','cozy','storm']}});

 await scenario('blocked, missed and 1.0-only results have their lines and are never resent',async(f,page)=>{
  await openWall(page);
  await card(page).getByRole('switch',{name:'Play over agent status'}).click();
  await mood(page,'Setback').click();await status(page).filter({hasText:'Not played: wall is in Work.'}).waitFor();
  assert.equal(moments(f)[0].command.coversStatus,false);
  await card(page).getByRole('switch',{name:'Play over agent status'}).click();
  await f.setMode('wall','Quiet');
  await mood(page,'Reminder').click();await status(page).filter({hasText:'Not played: wall is in Quiet.'}).waitFor();
  await f.setMode('wall','Work');
  f.wallMoments.stallNext(20000);
  await mood(page,'Celebrate').click();await status(page).filter({hasText:'Not played: it missed its start window.'}).waitFor();
  assert.equal(await live(page).textContent(),'No moment yet.','nothing played');
  // The controller answers the hub's own read as a 1.0-only controller would, after the page's fresh read.
  await page.route('**/api/controllers/v1/wall/moment',route=>{f.wallMoments.refuseNextVersionedRead();return route.continue();});
  await mood(page,'Celebrate').click();await status(page).filter({hasText:'Not sent: this controller serves API 1.0.'}).waitFor();
  await page.unroute('**/api/controllers/v1/wall/moment');
  assert.equal(await settledMoments(f),3,'the not-sent press made no moment POST and nothing was resent');
  assert.equal(await mood(page,'Celebrate').isDisabled(),false,'a definite result leaves the card usable');
 });

 await scenario('an uncertain result locks the card until Reload current values and is never resent',async(f,page)=>{
  await openWall(page);
  f.setUncertain(true);
  await mood(page,'Celebrate').focus();await page.keyboard.press('Enter');
  await status(page).filter({hasText:/^Result unknown: this may have reached the device \(uncertain-result\)\./}).waitFor();
  for(const name of ['Celebrate','Setback','Reminder'])assert.equal(await mood(page,name).isDisabled(),true,`${name} is locked`);
  const reload=card(page).getByRole('button',{name:'Reload current values',exact:true});
  await page.waitForFunction(()=>document.activeElement?.textContent==='Reload current values');
  await pause(5500);
  assert.equal(await settledMoments(f),1,'the uncertain moment reached the controller once and was not retried');
  f.setUncertain(false);
  await reload.click();await mood(page,'Celebrate').and(page.locator(':enabled')).waitFor();
  assert.equal(await status(page).textContent(),'');
  assert.equal(await settledMoments(f),1,'the reload sent nothing');
 });

 await scenario('a second press supersedes the playing moment and the live line says so',async(f,page)=>{
  await openWall(page);
  await mood(page,'Celebrate').click();await live(page).filter({hasText:/^Playing Celebrate, \d+ s left$/}).waitFor();
  await mood(page,'Setback').click();
  await live(page).filter({hasText:/^Playing Setback, \d+ s left · Last: Celebrate, superseded (just now|\d+ s ago)$/}).waitFor();
  assert.equal(await settledMoments(f),2);
 });

 await scenario('the live line moves from scheduled to playing to its ending; the faster refresh is bounded and only while visible',async(f,page)=>{
  await openWall(page);
  f.wallMoments.lead(4000);
  await card(page).getByRole('combobox',{name:'Duration'}).selectOption('5000');
  await mood(page,'Celebrate').click();await status(page).filter({hasText:'Celebrate: Scheduled on wall.'}).waitFor();
  await live(page).filter({hasText:'Scheduled: Celebrate'}).waitFor();
  // While a moment is current the page reads the wall every second.
  let before=wallReads(f);await pause(3200);
  assert.ok(wallReads(f)-before>=3,`faster refresh while scheduled: ${wallReads(f)-before} reads in 3.2 s`);
  f.wallMoments.lead(0);f.wallMoments.advance(4000);
  await live(page).filter({hasText:/^Playing Celebrate, \d+ s left$/}).waitFor();
  f.wallMoments.advance(6000);
  await live(page).filter({hasText:/^Last: Celebrate, completed (just now|\d+ s ago)$/}).waitFor();
  const ended=Date.now();
  // The faster refresh stops within 5 s of the end; afterwards only the 5 s poll reads.
  await pause(Math.max(0,5000-(Date.now()-ended)));
  before=wallReads(f);await pause(4000);
  assert.ok(wallReads(f)-before<=1,`after the linger only the normal poll reads: ${wallReads(f)-before} reads in 4 s`);
  // A moment this page did not send is not named.
  const direct=await fetch(f.hub.url+'/api/controllers/v1/wall/moment',{method:'POST',headers:f.headers,body:JSON.stringify({mood:'setback',durationMs:5000,coversStatus:true})});
  assert.equal((await direct.json()).kind,'receipt');
  await live(page).filter({hasText:/^Playing Setback, \d+ s left · Last: Celebrate, completed/}).waitFor();
  f.wallMoments.advance(6000);
  await live(page).filter({hasText:/^Last moment: completed (just now|\d+ s ago)$/}).waitFor();
  // An alert on status pre-empts a playing moment.
  await mood(page,'Reminder').click();await live(page).filter({hasText:/^Playing Reminder/}).waitFor();
  f.wallMoments.alert('attention');
  await live(page).filter({hasText:/^Last: Reminder, pre-empted by an alert/}).waitFor();
  f.wallMoments.alert('none');
  // A card on a hidden page makes no extra reads while a moment plays.
  await mood(page,'Celebrate').click();await live(page).filter({hasText:/^Playing Celebrate/}).waitFor();
  await page.getByRole('link',{name:/^Home/}).click();await section(page).getByRole('heading',{name:'Home',exact:true}).waitFor();
  await pause(500);before=wallReads(f);await pause(4000);
  assert.ok(wallReads(f)-before<=1,`a hidden card makes no extra reads: ${wallReads(f)-before} reads in 4 s`);
  assert.equal(await settledMoments(f),4);
 });

 const output=process.env.DASHBOARD_RECEIPTS??'/tmp/gh6-dashboard-receipts';await mkdir(output,{recursive:true});
 const receipt={synthetic:true,physical:false,passed:true,checks};await writeFile(output+'/moments.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
}finally{await browser.close();}
