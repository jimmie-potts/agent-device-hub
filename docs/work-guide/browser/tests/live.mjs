// Exercise the checked-in source candidate, including its real issue inventory.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {checkCandidate,defaultOutput} from '../build.mjs';
const checked=await checkCandidate();
const dataset=JSON.parse(await readFile(join(defaultOutput,'releases',checked.releaseId.slice(7),'records.json'),'utf8'));
const audit=JSON.parse(await readFile(join(defaultOutput,'audit.json'),'utf8'));
const primary=dataset.issues.filter(x=>x.state==='OPEN'&&dataset.repositories.some(r=>r.name===x.repository&&r.scope==='primary'));
assert.equal(new Set(audit.placements.map(x=>x.id)).size,primary.length);
assert.deepEqual(audit.placements.map(x=>x.id).sort(),primary.map(x=>x.id).sort());
const evidence=resolve(process.env.GUIDE_BROWSER_EVIDENCE??'.local/evidence/gh-511-browser');await mkdir(evidence,{recursive:true});
const server=createServer(async(req,res)=>{try{const path=resolve(defaultOutput,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!path.startsWith(defaultOutput+'/'))throw Error('invalid path');const bytes=await readFile(path.endsWith('/')?join(path,'index.html'):path);res.setHeader('content-type',path.endsWith('.json')?'application/json':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(bytes);}catch{res.statusCode=404;res.end('missing');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1280,height:800},reducedMotion:'reduce'});const page=await context.newPage();const errors=[],external=[];
page.on('pageerror',x=>errors.push(x.message));page.on('request',r=>{if(!r.url().startsWith(origin)&&!r.url().startsWith('blob:'))external.push(r.url());});
try{
 await page.goto(origin+'/index.html');await page.waitForFunction(()=>window.guide);
 assert.equal(await page.evaluate(()=>window.guide.releaseId),checked.releaseId);
 assert.match(await page.locator('#freshness').textContent(),new RegExp(primary.length+' unique open primary issues'));
 await page.screenshot({path:join(evidence,'live-home-desktop.png')});
 await page.getByRole('link',{name:'All issues',exact:true}).click();
 const open=dataset.issues.filter(x=>x.state==='OPEN');assert.match(await page.locator('.total').first().textContent(),new RegExp(open.length+' total'));
 const target=primary.at(-1);await page.getByRole('searchbox').fill(target.id);
 assert.equal(await page.locator('.issue[data-record="'+target.id+'"]').count(),1);
 await page.locator('.issue[data-record="'+target.id+'"]').getByRole('link',{name:'Task brief',exact:true}).click();assert.equal(await page.locator('textarea').count(),4);
 assert.ok((await page.locator('textarea').first().inputValue()).includes(target.url));
 await page.goBack();assert.equal(await page.getByRole('searchbox').inputValue(),target.id);
 assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(x=>x.id),[]);
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:join(evidence,'live-mobile.png')});
 assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(x=>x.id),[]);
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 await writeFile(join(evidence,'live.json'),JSON.stringify({...checked,primaryOpen:primary.length,retainedOpen:open.length,epics:audit.epicCount,primaryPlacements:audit.placements.length,axeViolations:0,externalRequests:0,passed:true},null,2));
 console.log(`Live candidate browser passed: ${primary.length} unique primary placements, ${open.length} retained open issues, ${audit.epicCount} explicit epics, desktop/mobile, search/brief/Back, no external requests, axe clean.`);
}finally{await browser.close();await new Promise(r=>server.close(r));}
