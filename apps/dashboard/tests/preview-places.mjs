import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {mkdir} from 'node:fs/promises';
import {fixture} from './fixture.mjs';
// Hub #495: a verification preview's Places lead to its paired runs or nowhere, never to an installed service.
const INSTALLED=[8788,8765,8787,8791,41230,41231];
const browser=await chromium.launch({headless:true});
const output=process.env.DASHBOARD_RECEIPTS;if(output)await mkdir(output,{recursive:true});
const checks=[];
/** The Places entries in order, each with its href (null for the current place). */
const placesOf=page=>page.getByRole('navigation',{name:'Places'}).locator('a, [aria-current=page]').evaluateAll(all=>all.map(e=>({text:e.textContent,href:e.getAttribute('href')})));
async function open(options,name){
 const f=await fixture({browserAccess:'trusted-loopback',editorLinks:{},...options}),context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
 const errors=[];context.on('weberror',e=>errors.push(e.error().message));
 const page=await context.newPage();page.setDefaultTimeout(12000);
 await page.goto(f.hub.url);await page.getByText('Control enabled · Local',{exact:true}).waitFor();
 await page.getByRole('heading',{name:'Build the integration',exact:true}).waitFor();
 const places=await placesOf(page);
 if(output)await page.screenshot({path:`${output}/${name}.png`,fullPage:true});
 const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
 return {f,context,page,places,errors,violations:axe.violations.map(v=>v.id)};
}
const PUBLIC=[['Architecture','https://jimmie-potts.github.io/agent-device-guide/architecture/arch-shared-system.html'],['Atlas','https://jimmie-potts.github.io/agent-device-guide/atlas/'],['Reference','https://jimmie-potts.github.io/agent-device-guide/atlas/reference/']];
try{
 {
  const paired='http://127.0.0.1:47123/';
  const run=await open({placeLinks:{wall:paired}},'preview-places-paired');
  try{
   assert.deepEqual(run.places.map(p=>p.text),['Architecture','Atlas','Reference','B.U.N.N.Y.Local','WallLocal']);
   assert.deepEqual(run.places.slice(0,3).map(p=>[p.text,p.href]),PUBLIC,'the public destinations are unchanged');
   assert.equal(run.places[3].href,null,'B.U.N.N.Y. is the current place, not a link');
   assert.equal(run.places[4].href,paired,'Wall leads to the paired wall run');
   assert.equal(await run.page.getByRole('navigation',{name:'Places'}).getByRole('link',{name:'Wall Local'}).getAttribute('target'),'_blank');
   assert.deepEqual(run.violations,[]);assert.deepEqual(run.errors,[]);
   assert.equal(run.f.writes.length,0,'Places send no controller command');
   checks.push('a paired preview links Wall to its paired run');
  }finally{await run.context.close();await run.f.close();}
 }
 {
  const run=await open({placeLinks:{}},'preview-places-hub-only');
  try{
   assert.deepEqual(run.places.map(p=>p.text),['Architecture','Atlas','Reference','B.U.N.N.Y.Local'],'a Hub-only preview has no Wall link');
   assert.equal(run.places.some(p=>p.href&&INSTALLED.includes(Number(new URL(p.href,'http://x').port))),false,'no Places link leads to an installed port');
   assert.deepEqual(run.violations,[]);assert.deepEqual(run.errors,[]);
   assert.equal(run.f.writes.length,0,'Places send no controller command');
   checks.push('a Hub-only preview omits Wall');
  }finally{await run.context.close();await run.f.close();}
 }
 {
  const run=await open({},'preview-places-unconfigured');
  try{
   assert.deepEqual(run.places.map(p=>[p.text,p.href]).slice(3),[['B.U.N.N.Y.Local',null],['WallLocal','http://127.0.0.1:8765/']],'without preview links the fixed destinations stay');
   checks.push('an unconfigured Hub keeps the fixed destinations');
  }finally{await run.context.close();await run.f.close();}
 }
 console.log(JSON.stringify({previewPlaces:checks}));
}finally{await browser.close();}
