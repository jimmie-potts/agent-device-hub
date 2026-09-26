import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {fixture} from './fixture.mjs';
import {textOverlaps} from './layout.mjs';
const f=await fixture(),browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1280,height:1000},reducedMotion:'reduce'});
const output=process.env.DASHBOARD_RECEIPTS??'/tmp/hub-title-preview';await mkdir(output,{recursive:true});
try{
 await f.event('turn.started',{apiVersion:'1.1',identity:{...f.identity,sessionId:'titled'},title:{value:'Réviser les prompts du moniteur',source:'provider'},project:'divoom-app-upgrade'});
 await f.event('turn.started',{identity:{...f.identity,sessionId:'untitled'}});
 await f.event('turn.started',{apiVersion:'1.1',title:{value:'Provider title underneath the owner label',source:'provider'},project:'agent-device-hub'});
 await page.goto(f.hub.url);await page.getByText('Use a separately provisioned access token').click();await page.getByLabel('Hub browser access token').fill(f.token);await page.getByRole('button',{name:'Connect',exact:true}).click();
 await page.getByRole('heading',{name:'Réviser les prompts du moniteur',exact:true}).waitFor({timeout:5000});
 await page.getByRole('heading',{name:'Build the integration',exact:true}).waitFor();await page.getByRole('heading',{name:'untitled',exact:true}).waitFor();
 assert.equal(await page.getByRole('heading',{name:'Provider title underneath the owner label',exact:true}).count(),0);
 const row=page.locator('article.session').filter({has:page.getByRole('heading',{name:'Réviser les prompts du moniteur',exact:true})});
 assert.ok((await row.textContent()).includes('divoom-app-upgrade'));
 const field=row.getByLabel('Chosen label');await field.fill('x'.repeat(81));await field.press('Tab');assert.equal(await field.evaluate(e=>e.checkValidity()),false);
 await field.fill('😀'.repeat(80));assert.equal(await field.evaluate(e=>e.checkValidity()),true);
 // Restore the synthetic candidate before screenshots, without submitting a label.
 await field.fill('');await field.press('Tab');
 const search=page.getByRole('searchbox',{name:'Find a session'});await search.fill('divoom-app-upgrade');await page.waitForFunction(()=>[...document.querySelectorAll('article.session')].filter(e=>e.offsetParent!==null).length===1);assert.equal(await page.locator('article.session:visible').count(),1);await search.fill('');await page.waitForFunction(()=>[...document.querySelectorAll('article.session')].filter(e=>e.offsetParent!==null).length===3);
 assert.deepEqual(await textOverlaps(page),[]);await page.screenshot({path:output+'/session-titles-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.deepEqual(await textOverlaps(page),[]);await page.screenshot({path:output+'/session-titles-mobile.png',fullPage:true});
 assert.equal(f.writes.length,0,'metadata inspection sends no device writes');
 console.log('Shared title, project, label precedence, untitled fallback, scalar bounds and responsive previews passed.');
}finally{await browser.close();await f.close();}
