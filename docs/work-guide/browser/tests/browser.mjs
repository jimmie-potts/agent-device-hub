import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {buildCandidate} from '../build.mjs';
import {parseMetadata} from '../collector.mjs';
import {datasetIdentity,placementOf} from '../runtime/records.mjs';
import {routeFor} from '../renderer.mjs';
const output=resolve('.local/scratch/gh-511-browser');
const evidence=resolve(process.env.GUIDE_BROWSER_EVIDENCE??'.local/evidence/gh-511-browser');
await mkdir(evidence,{recursive:true});
function largeFixture(d){
 const sample=d.issues.find(x=>x.state==='OPEN'&&x.placement.state==='epic'&&!x.labels.includes('epic'));
 for(let i=0;i<240;i++) {const x=structuredClone(sample);x.number=920000+i;x.id=x.repository+'#'+x.number;x.url=`https://github.com/${x.repository}/issues/${x.number}`;x.nodeId='browser-large-'+i;x.title='Large epic work '+i;x.children.ids=[];x.children.evidence.pagination.itemCount=x.children.evidence.pagination.totalCount=0;d.issues.push(x);}
 d.issues.find(x=>x.number===920239).title='<img src=x onerror="window.injected=true"> Literal unsafe title';
 for(const r of d.repositories){r.inventory.pagination.itemCount=r.inventory.pagination.totalCount=d.issues.filter(x=>x.repository===r.name&&x.state==='OPEN').length;}
 d.datasetId=datasetIdentity(d);return {d,sample};
}
const base=JSON.parse(await readFile(new URL('../../contracts/epic-guide/fixtures/dataset.json',import.meta.url),'utf8'));
const {d,sample}=largeFixture(base);
const bodies=JSON.parse(await readFile(new URL('./brief-bodies.json',import.meta.url),'utf8'));
const briefIds={};
for(const [index,[state,body]] of Object.entries(bodies).entries()) {
 const issue=d.issues.filter(x=>x.state==='OPEN'&&!x.labels.includes('epic'))[index];issue.body=body;
 const [parsed]=await parseMetadata([issue]);issue.story=parsed.story;issue.planning=parsed.planning;briefIds[state]=issue.id;
}
d.repositories[0].recentClosures.complete=false;d.repositories[0].recentClosures.reason='Fixture partial history';
d.datasetId=datasetIdentity(d);
let manifest=await buildCandidate(d,{output});
const server=createServer(async(req,res)=>{try{const path=resolve(output,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!path.startsWith(output+'/'))throw Error('invalid path');const bytes=await readFile(path.endsWith('/')?join(path,'index.html'):path);res.setHeader('content-type',path.endsWith('.json')?'application/json':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(bytes);}catch{res.statusCode=404;res.end('missing');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1280,height:800},reducedMotion:'reduce'});
const page=await context.newPage();const errors=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
try {
 await page.goto(origin+'/index.html');await page.waitForFunction(()=>window.guide);
 const pinned=await page.evaluate(()=>window.guide.releaseId);
 assert.ok(requests.every(url=>url.startsWith(origin)||url.startsWith('blob:')),'fresh open made an external/model request');
 for(const [state,id] of Object.entries(briefIds)) {
  await page.goto(origin+'/index.html?page=all%2F#'+id.replace('#','/'));await page.waitForFunction(()=>window.guide);
  assert.equal(await page.locator('textarea').count(),4);
    if(state==='current')assert.ok((await page.locator('textarea').first().inputValue()).includes('Execution guidance:'));
  else {assert.match(await page.locator('.brief > .evidence').textContent(),/Generic commands/);assert.ok(!(await page.locator('textarea').first().inputValue()).includes('Execution guidance:'));}
 }
 await page.goto(origin+'/index.html?page=not-in-epic%2F');await page.waitForFunction(()=>window.guide);
 assert.match(await page.locator('#content').textContent(),/partial history|Partial history/);
 await page.goto(origin+'/index.html');await page.waitForFunction(()=>window.guide);
 await page.getByRole('link',{name:'All issues',exact:true}).click();
 await page.getByRole('searchbox').fill('Large epic work 239'); // global search includes last, initially unrendered record
 await page.getByRole('searchbox').fill('Literal unsafe title');
 assert.equal(await page.locator('.issue').count(),1);assert.equal(await page.locator('#content img').count(),0);
 assert.equal(await page.evaluate(()=>window.injected),undefined);
 await page.getByRole('link',{name:'Task brief',exact:true}).click();
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw Error('denied');}},configurable:true}));
 await page.getByRole('button',{name:'Copy Explain',exact:true}).click();
 assert.match(await page.locator('.command').first().textContent(),/Clipboard unavailable/);
 assert.match(await page.locator('textarea').first().inputValue(),/Explain https:\/\/github.com/);
 await page.goBack();assert.equal(await page.getByRole('searchbox').inputValue(),'Literal unsafe title');
 await page.getByRole('searchbox').fill('');
 const epicPage=routeFor(d.issues.find(x=>x.id===sample.placement.epic)).epic;
 await page.goto(origin+'/index.html?page='+encodeURIComponent(epicPage));await page.waitForFunction(()=>window.guide);
 const total=d.issues.filter(x=>x.state==='OPEN'&&x.placement.epic===sample.placement.epic).length;
 assert.ok(await page.locator('.issue').count()<total,'large epic initial DOM is unbounded');
 assert.match(await page.locator('.epic').first().textContent(),new RegExp(total+' open'));
 let clicks=0;while(await page.locator('button.more:visible').count()){await page.locator('button.more:visible').first().click();if(++clicks>100)throw Error('pagination did not terminate');}
 assert.equal(await page.locator('.issue[data-record*="#920"]').count(),240);
 await page.evaluate(()=>dispatchEvent(new Event('beforeprint')));
 assert.equal(await page.locator('.issue[data-record*="#920"]').count(),240);
 await page.pdf({path:join(evidence,'epic-print.pdf'),format:'A4'});
 await page.evaluate(()=>dispatchEvent(new Event('afterprint')));
 await page.getByRole('button',{name:'Toggle theme'}).click();const theme=await page.evaluate(()=>document.documentElement.dataset.theme);
 await page.reload();await page.waitForFunction(()=>window.guide);assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),theme);
 await page.keyboard.press('Tab');await page.keyboard.press('Enter');assert.equal(await page.locator('#page-title').evaluate(x=>document.activeElement===x),true);
 assert.ok(await page.locator('.issue').count()>0,'Skip to content must retain the current view');
 const axe=await new AxeBuilder({page}).analyze();assert.deepEqual(axe.violations.map(x=>x.id),[]);
 await page.screenshot({path:join(evidence,'desktop.png'),fullPage:false});
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Navigation',exact:true}).click();
 assert.ok(await page.getByRole('link',{name:'All issues',exact:true}).isVisible());
 await page.getByRole('link',{name:'All issues',exact:true}).click();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:join(evidence,'mobile.png'),fullPage:false});
 const axeMobile=await new AxeBuilder({page}).analyze();assert.deepEqual(axeMobile.violations.map(x=>x.id),[]);
 // Replace the deployment while the client remains open, and remove its old assets.
 const changed=JSON.parse(await readFile(new URL('../../contracts/epic-guide/fixtures/dataset.json',import.meta.url),'utf8'));
 changed.issues[0].title='New deployed title';changed.datasetId=datasetIdentity(changed);
 manifest=await buildCandidate(changed,{output});
 await rm(join(output,'releases',pinned.slice(7)),{recursive:true,force:true});
 await page.getByRole('button',{name:'Check for updates'}).click();await page.waitForFunction(()=>!document.getElementById('update').hidden);
 assert.match(await page.locator('#update').textContent(),/newer release/);
 await page.getByRole('searchbox').fill('Literal unsafe title');assert.equal(await page.locator('.issue').count(),1);
 await page.getByRole('link',{name:'Task brief',exact:true}).click();assert.equal(await page.evaluate(()=>window.guide.releaseId),pinned);
 // Unsupported manifest and mixed asset hash fail a fresh open, without corrupting the old client.
 const entry=await readFile(output+'/index.html','utf8');
 await writeFile(output+'/index.html',entry.replace('guide-records/2.0','guide-records/99.0'));
 const second=await context.newPage();await second.goto(origin+'/index.html');await second.waitForFunction(()=>document.getElementById('content').textContent.includes('unavailable'));
 assert.match(await second.locator('#content').textContent(),/unsupported release/);
 await writeFile(output+'/index.html',entry.replace(manifest.releaseId,'sha256:'+'0'.repeat(64)));
 await second.reload();await second.waitForFunction(()=>document.getElementById('content').textContent.includes('unavailable'));
 assert.match(await second.locator('#content').textContent(),/manifest identity/);
 await writeFile(output+'/index.html',entry);await writeFile(join(output,'releases',manifest.releaseId.slice(7),'records.json'),'{}');
 await second.reload();await second.waitForFunction(()=>document.getElementById('content').textContent.includes('unavailable'));assert.match(await second.locator('#content').textContent(),/mixed-release asset/);
 assert.deepEqual(errors,[]);
 await writeFile(join(evidence,'browser.json'),JSON.stringify({passed:true,totalLargeEpic:total,showMoreClicks:clicks,axeViolations:0,pinnedRelease:pinned,newRelease:manifest.releaseId,externalRequests:requests.filter(x=>!x.startsWith(origin)&&!x.startsWith('blob:')).length},null,2));
 console.log('Epic browser checks passed: large epic, literal text, briefs, Back, theme, keyboard, mobile, axe, print, retained release, unsupported/mixed negative controls.');
} finally {await browser.close();await new Promise(r=>server.close(r));await rm(output,{recursive:true,force:true});}
