import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
import {fixture,linesGeometry,panelsGeometry} from './fixture.mjs';
import {textOverlaps} from './layout.mjs';
// Hub #355: the shared Nanoleaf device art on the component pages, with the fake controllers serving geometry.
const browser=await chromium.launch({headless:true});
const output=process.env.DASHBOARD_RECEIPTS??'/tmp/gh355-art-receipts';await mkdir(output,{recursive:true});
const checks=[];
async function axe(page){const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>`${n.target.join(' ')}: ${n.failureSummary}`)})),[]);}
async function until(condition){const deadline=Date.now()+10000;while(!condition()){if(Date.now()>deadline)throw new Error('condition-timeout');await new Promise(r=>setTimeout(r,25));}}
async function scenario(name,run,{options={},viewport={width:1280,height:900},reducedMotion='reduce'}={}){
 const f=await fixture(options),context=await browser.newContext({viewport,reducedMotion}),page=await context.newPage();page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{await page.goto(f.hub.url);await page.getByText('Use a separately provisioned access token').click();await page.getByLabel('Hub browser access token').fill(f.token);await page.getByRole('button',{name:'Connect',exact:true}).click();await page.locator('#main[data-received]:not([data-received="0"])').waitFor();await run(f,page);assert.deepEqual(errors,[]);checks.push(name);}
 catch(error){console.error(name,await page.locator('section:visible').innerText().catch(()=>''));throw error;}finally{await context.close();await f.close();}
}
const geometryReads=(f,id)=>f.requests.filter(r=>r.id===id&&r.url.startsWith('/controller/integration/v1/geometry')).length;
const stopColor=(page,index,zone)=>page.locator(`[data-paint="${index}-${zone}"]`).first().getAttribute('stop-color');
try {
 await scenario('the Lines are drawn from the geometry route with reservation colors, labels, selection and one geometry read',async(f,page)=>{
  f.nano.settings.style='project';
  await page.getByRole('button',{name:'wall nanoleaf',exact:true}).click();
  const art=page.locator('figure.device-art[data-art-kind=lines]');await art.locator('svg.prism-scene').waitFor();
  await page.waitForFunction(()=>document.querySelector('figure.device-art figcaption')?.textContent.includes('Signature zones show reservation colors.'));
  assert.equal(await art.locator('[data-control]').count(),15);assert.equal(await art.locator('[data-node]').count(),12);
  assert.equal(await art.locator('svg').getAttribute('data-prism-mode'),'work');assert.equal(await art.locator('svg').getAttribute('data-reduced-motion'),'true');
  assert.equal(await stopColor(page,0,0),f.nano.projects[0].color,'the first element\'s signature zone shows its reservation');assert.equal(await stopColor(page,0,1),'#193cff','the other zone is the no-task base');
  assert.equal(await stopColor(page,2,0),'#193cff');assert.equal(await stopColor(page,2,1),'#193cff');
  assert.equal(await art.locator('[data-control="0"]').getAttribute('aria-label'),`Line 1 · Reserved: ${f.nano.projects[0].id} · No task shown`);
  assert.equal(await art.locator('[data-control="2"]').getAttribute('aria-label'),'Line 3 · Shared pool · No task shown');
  assert.match(await art.locator('figcaption').innerText(),/15 Lines from the controller’s saved layout\. Mode Work\. Signature zones show reservation colors\. Task status isn’t in the hub snapshot, so no task is shown\./);
  assert.deepEqual(await textOverlaps(page),[],'wall text never overlaps with the art');
  // Selection is the art's own; it also picks the element in the mapping form and sends nothing.
  await art.locator('[data-control="2"]').click();assert.equal(await art.locator('[data-control="2"]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('.mapping-views select').first().inputValue(),'105:106');
  await art.locator('[data-control="2"]').focus();await page.keyboard.press('Tab');assert.ok(await art.locator('[data-control="3"]').evaluate(el=>el===document.activeElement),'elements are reachable by keyboard in order');
  await page.keyboard.press('Enter');assert.equal(await page.locator('.mapping-views select').first().inputValue(),'107:108');
  // A pending wall edit marks its element; a mode change follows the snapshot.
  f.nano.wallPending={settings:{},elements:[{id:'103:104',projectId:f.nano.projects[1].id}],tasks:[]};f.nano.mode='Quiet';f.states.wall.state.desired.mode={status:'known',value:'Quiet'};
  await page.waitForFunction(()=>document.querySelector('figure.device-art svg')?.dataset.prismMode==='quiet');assert.ok(await art.locator('[data-control="1"]').evaluate(el=>el.classList.contains('pending')));
  assert.equal(f.writes.length,0,'opening, selecting and polling send no command');
  await page.screenshot({path:output+'/art-lines-desktop.png',fullPage:true});
  await axe(page);
  await page.waitForTimeout(6000);assert.equal(geometryReads(f,'wall'),1,'the geometry is read once, not on every poll');
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'phone width has no horizontal overflow');await page.screenshot({path:output+'/art-lines-phone.png',fullPage:true});await axe(page);
  assert.equal(await art.locator('[data-control]').count(),15);
 });
 await scenario('a stale controller keeps the art marked stale, never an empty wall',async(f,page)=>{
  await page.getByRole('button',{name:'wall nanoleaf',exact:true}).click();const art=page.locator('figure.device-art');await art.locator('svg.prism-scene').waitFor();
  f.setOffline(true,'wall');await page.getByText('Stale / unavailable',{exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('figure.device-art')?.dataset.artState==='stale');
  assert.equal(await art.locator('[data-control]').count(),15);await art.locator('figcaption').getByText('Stale: showing the last snapshot.').waitFor();
  f.setOffline(false);await page.waitForFunction(()=>document.querySelector('figure.device-art')?.dataset.artState==='drawn');assert.equal(geometryReads(f,'wall'),1);
 });
 await scenario('the NL22 Panels are drawn as 18 triangles and stay drawable while their snapshot is unavailable',async(f,page)=>{
  await page.getByRole('button',{name:'panels nanoleaf',exact:true}).click();const art=page.locator('figure.device-art[data-art-kind=panels]');await art.locator('svg.prism-panels').waitFor();
  assert.equal(await art.locator('[data-control]').count(),18);assert.equal(await art.locator('[data-control="0"]').getAttribute('aria-label'),'Panel 1 · No task shown');
  assert.match(await art.locator('figcaption').innerText(),/18 Panels from the controller’s saved layout\./);
  await art.locator('[data-control="4"]').click();assert.equal(await art.locator('[data-control="4"]').getAttribute('aria-pressed'),'true');
  assert.deepEqual(await textOverlaps(page),[]);await axe(page);assert.equal(f.writes.length,0);
  await page.screenshot({path:output+'/art-panels-desktop.png',fullPage:true});
  // The Lines page in the same session draws its own device.
  await page.getByRole('button',{name:'wall nanoleaf',exact:true}).click();await page.locator('figure.device-art[data-art-kind=lines] svg.prism-scene').waitFor();assert.equal(await page.locator('figure.device-art[data-art-kind=lines] [data-control]').count(),15);
 },{options:{panels:true}});
 await scenario('a device without a saved layout draws the schematic strip and says why',async(f,page)=>{
  f.nano.settings.style='project';await page.getByRole('button',{name:'wall nanoleaf',exact:true}).click();const art=page.locator('figure.device-art');await art.locator('ol.art-strip').waitFor();
  await page.waitForFunction(()=>document.querySelector('figure.device-art')?.dataset.artState==='schematic'&&document.querySelector('figure.device-art figcaption')?.textContent.includes('Signature zones show reservation colors.'));
  assert.equal(await art.locator('button.art-cell').count(),15);assert.equal(await art.locator('svg.prism-scene').count(),0);
  assert.match(await art.locator('figcaption').innerText(),/Physical layout unavailable: the controller has no saved layout\. Showing one cell per element\. Mode Work\./);
  const first=art.locator('button.art-cell').first();assert.equal(await first.getAttribute('aria-label'),`Line 1 · Reserved: ${f.nano.projects[0].id} · No task shown`);
  assert.equal(await first.locator('span').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(169, 195, 255)');
  await art.locator('button.art-cell').nth(2).click();assert.equal(await page.locator('.mapping-views select').first().inputValue(),'105:106');assert.equal(await art.locator('button.art-cell').nth(2).getAttribute('aria-pressed'),'true');
  assert.deepEqual(await textOverlaps(page),[]);await axe(page);await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await axe(page);
  await page.screenshot({path:output+'/art-strip-phone.png',fullPage:true});assert.equal(f.writes.length,0);
 },{options:{geometry:'none'}});
 await scenario('an owner that predates the geometry route gets the strip once, with no retry',async(f,page)=>{
  await page.getByRole('button',{name:'wall nanoleaf',exact:true}).click();const art=page.locator('figure.device-art');await art.locator('ol.art-strip').waitFor();
  assert.match(await art.locator('figcaption').innerText(),/Physical layout unavailable: the controller predates the geometry route\./);
  await page.waitForTimeout(6000);assert.equal(geometryReads(f,'wall'),1,'a 422 is final for the session');assert.equal(f.writes.length,0);
 },{options:{geometry:'older'}});
 // Component harness: status and activity are inputs the pages leave empty today; a consumer with a source drives the marks and the Work flow.
 const bundle=await build({entryPoints:['apps/dashboard/tests/art-harness.tsx'],bundle:true,write:false,format:'esm',target:'es2022',outdir:'out'});
 const js=bundle.outputFiles.find(x=>x.path.endsWith('.js')).text,css=bundle.outputFiles.find(x=>x.path.endsWith('.css')).text;
 const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Device art harness</title><style>${css}</style></head><body><div id="root"></div><script type="module">${js}</script></body></html>`;
 const snapshot={mode:'Work',settings:{style:'project',coverage:'whole'},projects:[{id:'project-a',color:'#a9c3ff'}],elements:linesGeometry().elements.map((e,index)=>({id:e.id,projectId:index===0?'project-a':null,signature:0})),wallPending:null};
 const props={title:'wall',read:{geometry:linesGeometry(),final:true},snapshot,stale:false,status:{'101:102':'working','103:104':'blocked','105:106':'question'},activity:['101:102'],selection:[],assemble:false};
 for(const reducedMotion of ['no-preference','reduce']){
  const context=await browser.newContext({viewport:{width:1000,height:700},reducedMotion}),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.setContent(html);await page.waitForFunction(()=>typeof window.mountArt==='function');await page.evaluate(p=>window.mountArt(p),props);
   const art=page.locator('figure.device-art');await art.locator('svg.prism-scene').waitFor();
   assert.equal(await art.locator('svg').getAttribute('data-reduced-motion'),String(reducedMotion==='reduce'));assert.equal(await art.locator('svg').getAttribute('data-prism-mode'),'work');
   assert.equal(await stopColor(page,0,0),'#a9c3ff');assert.equal(await stopColor(page,0,1),'#00ff00','the status color fills the other zone');
   // In the project style an unreserved signature zone stays the base color while the other zone carries the status, as on the wall map for a Line whose task project is unknown.
   assert.equal(await stopColor(page,1,0),'#193cff');assert.equal(await stopColor(page,1,1),'#ff0000');assert.equal(await stopColor(page,2,1),'#ffff00');
   assert.equal(await art.locator('[data-control="0"]').getAttribute('aria-label'),'Line 1 · Reserved: project-a · working, active');assert.equal(await art.locator('[data-control="0"]').getAttribute('data-status'),'working');assert.equal(await art.locator('[data-control="1"]').getAttribute('data-status'),'blocked');
   assert.equal(await art.locator('figcaption').innerText(),'15 Lines from the controller’s saved layout. Mode Work. Signature zones show reservation colors.');
   const packet=()=>page.locator('[data-packet="0"][data-zone="0"]').first().evaluate(el=>Number(el.getAttribute('opacity')));
   if(reducedMotion==='reduce'){await page.waitForTimeout(400);assert.equal(await packet(),0,'reduced motion stops the flow');}
   else{await until(()=>true);let seen=false;const deadline=Date.now()+3000;while(Date.now()<deadline){if(await packet()>0){seen=true;break;}await page.waitForTimeout(50);}assert.ok(seen,'the Work flow runs on the active element');}
   assert.equal(await page.locator('[data-packet="1"][data-zone="0"]').first().evaluate(el=>Number(el.getAttribute('opacity'))),0,'an inactive element has no packet');
   await page.evaluate(p=>window.mountArt(p),{...props,snapshot:{...snapshot,mode:'Quiet'}});await page.waitForFunction(()=>document.querySelector('figure.device-art svg')?.dataset.prismMode==='quiet');await page.waitForTimeout(100);assert.equal(await packet(),0,'Quiet stops the flow');
   await page.evaluate(p=>window.mountArt(p),{...props,snapshot:{...snapshot,mode:'Free'}});await page.waitForFunction(()=>document.querySelector('figure.device-art svg')?.dataset.prismMode==='free');
   await page.evaluate(p=>window.mountArt(p),{...props,stale:true});await page.waitForFunction(()=>document.querySelector('figure.device-art')?.dataset.artState==='stale');
   // The Panels pulse on the same clock from the same inputs.
   await page.evaluate(p=>window.mountArt(p),{...props,read:{geometry:panelsGeometry(),final:true},snapshot:{...snapshot,elements:[]},status:{'4001':'working'},activity:['4001']});
   const panels=art.locator('svg.prism-panels');await panels.waitFor();assert.equal(await art.locator('[data-control]').count(),18);assert.equal(await panels.getAttribute('data-flow'),String(reducedMotion!=='reduce'));
   assert.equal(await art.locator('[data-part="light"][data-light="0"]').getAttribute('fill'),'#00ff00');assert.equal(await art.locator('[data-control="0"]').getAttribute('aria-label'),'Panel 1 · Shared pool · working, active');
   await axe(page);assert.deepEqual(errors,[]);
   if(reducedMotion==='no-preference')await page.screenshot({path:output+'/art-harness-status.png'});
   checks.push('harness status/activity ('+reducedMotion+')');
  }finally{await context.close();}
 }
 console.log(JSON.stringify({passed:true,checks,output}));
}finally{await browser.close();}
