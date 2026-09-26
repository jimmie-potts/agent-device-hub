import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {fixture} from './fixture.mjs';
import {textOverlaps} from './layout.mjs';
const f=await fixture(),browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1280,height:1000},reducedMotion:'reduce',hasTouch:true});
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
 const sessionsBox=await page.locator('[data-widget=sessions]').boundingBox(),deviceBox=await page.locator('[data-widget=component-status]').first().boundingBox();
 assert.ok(Math.abs(sessionsBox.y-deviceBox.y)<4,'sessions start beside the first device, without an empty column');
 assert.equal(await row.getByLabel('Chosen label').isVisible(),false,'label editing stays behind Details');
 const indicator=row.getByRole('button',{name:'Active',exact:true});await indicator.hover();await row.getByRole('tooltip').waitFor();
 assert.match(await row.getByRole('tooltip').textContent(),/Last observation/);
 await page.screenshot({path:output+'/session-titles-hover.png',fullPage:true});
 await page.keyboard.press('Escape');assert.equal(await row.getByRole('tooltip').count(),0,'Escape dismisses hover information');
 await page.mouse.move(0,0);await indicator.focus();await row.getByRole('tooltip').waitFor();
 await indicator.press('Escape');assert.equal(await row.getByRole('tooltip').count(),0,'Escape also dismisses keyboard information');
 await row.locator('summary').click();
 const field=row.getByLabel('Chosen label');await field.fill('x'.repeat(81));await field.press('Tab');assert.equal(await field.evaluate(e=>e.checkValidity()),false);
 await field.fill('😀'.repeat(80));assert.equal(await field.evaluate(e=>e.checkValidity()),true);
 // Restore the synthetic candidate before screenshots, without submitting a label.
 await field.fill('');await field.press('Tab');
 await row.locator('summary').click();
 const search=page.getByRole('searchbox',{name:'Find a session'});await search.fill('divoom-app-upgrade');await page.waitForFunction(()=>[...document.querySelectorAll('article.session')].filter(e=>e.offsetParent!==null).length===1);assert.equal(await page.locator('article.session:visible').count(),1);await search.fill('');await page.waitForFunction(()=>[...document.querySelectorAll('article.session')].filter(e=>e.offsetParent!==null).length===3);
 await search.blur();assert.deepEqual(await textOverlaps(page),[]);await page.screenshot({path:output+'/session-titles-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await indicator.tap();await row.getByRole('tooltip').waitFor();const tipBox=await row.getByRole('tooltip').boundingBox();assert.ok(tipBox.x>=0&&tipBox.x+tipBox.width<=390,'touch information stays within the viewport for a wrapped long title');await page.keyboard.press('Escape');await row.locator('summary').tap();assert.equal(await field.isVisible(),true,'touch exposes the same editable details');await row.locator('summary').tap();assert.deepEqual(await textOverlaps(page),[]);await page.screenshot({path:output+'/session-titles-mobile.png',fullPage:true});
 assert.equal(f.writes.length,0,'metadata inspection sends no device writes');
 console.log('Shared title, project, label precedence, untitled fallback, scalar bounds and responsive previews passed.');
}finally{await browser.close();await f.close();}
