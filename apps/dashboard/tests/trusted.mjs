import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {fixture} from './fixture.mjs';
// Hub #276: with browserAccess "trusted-loopback" a bookmark opens B.U.N.N.Y. signed in, and reloads and tabs stay signed in.
const browser=await chromium.launch({headless:true});
const output=process.env.DASHBOARD_RECEIPTS;if(output)await mkdir(output,{recursive:true});
const checks=[];
const signedIn=page=>page.getByText('Control enabled · Local',{exact:true}).waitFor();
async function until(condition,message){const deadline=Date.now()+10000;while(!condition()){if(Date.now()>deadline)throw new Error('condition-timeout: '+message);await new Promise(r=>setTimeout(r,25));}}
async function axe(page){const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(result.violations.map(v=>v.id),[]);}
try{
 {
  const f=await fixture({empty:true,browserAccess:'trusted-loopback'}),context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
  const errors=[];context.on('weberror',e=>errors.push(e.error().message));
  try{
   const page=await context.newPage();page.setDefaultTimeout(12000);
   await page.goto(f.hub.url);await signedIn(page);
   await page.getByRole('link',{name:'wall nanoleaf',exact:true}).waitFor();await page.getByRole('link',{name:'pixel pixoo',exact:true}).waitFor();
   assert.equal(await page.getByText('Use a separately provisioned access token').count(),0,'no login form');
   assert.equal(f.hub.resources().browserSessions,1);
   if(output)await page.screenshot({path:output+'/trusted-signed-in.png',fullPage:true});
   checks.push('a fresh context opens signed in');

   // Hub #277: a bookmarked page address is a route, not a launch code; it opens signed in on that page and keeps its address.
   const bookmark=await context.newPage();await bookmark.goto(f.hub.url+'/#/component/pixel');await signedIn(bookmark);
   await bookmark.locator('section:visible .section-heading h2',{hasText:/^pixel$/}).waitFor();assert.equal(new URL(bookmark.url()).hash,'#/component/pixel');
   await bookmark.close({runBeforeUnload:true});await until(()=>f.hub.resources().browserSessions===1,'the bookmark tab logs out');
   checks.push('a route bookmark opens signed in on its page');

   await page.reload();await signedIn(page);
   await until(()=>f.hub.resources().browserSessions===1,'the unloaded page’s session is logged out');
   checks.push('reload stays signed in without piling up sessions');

   const second=await context.newPage();await second.goto(f.hub.url);await signedIn(second);
   assert.equal(f.hub.resources().browserSessions,2,'each tab has its own session');
   await second.close({runBeforeUnload:true});await until(()=>f.hub.resources().browserSessions===1,'closing a tab logs its session out');
   checks.push('a second tab signs in and closing it logs out');

   const local=await context.newPage();await local.goto(f.hub.url.replace('127.0.0.1','localhost'));await signedIn(local);
   await local.close({runBeforeUnload:true});await until(()=>f.hub.resources().browserSessions===1,'the localhost tab logs out');
   checks.push('localhost opens signed in');

   // Headless Chromium does not reliably keep pages in the back-forward cache, so the page transition events are dispatched as a restored page receives them.
   await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
   await until(()=>f.hub.resources().browserSessions===0,'a page entering the back-forward cache logs out');
   await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
   await until(()=>f.hub.resources().browserSessions===1,'a restored page signs in again');
   await page.getByRole('button',{name:'Sign in again',exact:true}).waitFor({state:'detached'});await signedIn(page);
   checks.push('a page restored from the back-forward cache signs in again');

   // Sixteen more sessions evict this page's session; the dashboard offers one explicit click to sign in again.
   for(let index=0;index<16;index++){const response=await fetch(f.hub.url+'/api/dashboard/v1/session',{method:'POST',headers:{origin:f.hub.url,'content-type':'application/json','x-pixoo-request':'1'},body:'{}'});assert.equal(response.status,200);}
   const again=page.getByRole('button',{name:'Sign in again',exact:true});await again.waitFor();
   if(output)await page.screenshot({path:output+'/trusted-session-ended.png',fullPage:true});
   await again.click();await again.waitFor({state:'detached'});await signedIn(page);
   assert.equal(await page.getByRole('alert').count(),0,'the error clears with the new session');
   checks.push('an evicted session recovers with Sign in again');

   await page.getByRole('button',{name:'Disconnect',exact:true}).click();
   await page.getByText('You’re signed out.',{exact:true}).waitFor();
   assert.equal(await page.getByText('After a reload, run it again.',{exact:false}).count(),0,'no launcher reload hint in a trusted page');
   await axe(page);
   if(output)await page.screenshot({path:output+'/trusted-signed-out.png',fullPage:true});
   await page.getByRole('button',{name:'Sign in',exact:true}).click();await signedIn(page);
   checks.push('Disconnect offers Sign in, which restores the dashboard');
   assert.equal(f.writes.length,0,'signing in and inspecting send no device command');
   assert.deepEqual(errors,[]);
  }finally{await context.close();await f.close();}
 }
 {
  const f=await fixture({empty:true,browserAccess:'trusted-loopback'}),context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
  try{
   const page=await context.newPage();page.setDefaultTimeout(12000);
   await page.route('**/api/dashboard/v1/session',route=>route.fulfill({status:503,json:{error:{code:'capacity'}}}));
   await page.goto(f.hub.url);
   await page.getByRole('alert').filter({hasText:'B.U.N.N.Y. couldn’t sign you in. Reload to try again, or use the launcher.'}).waitFor();
   await page.getByText('Open B.U.N.N.Y. with the Hub launcher.',{exact:true}).waitFor();
   await axe(page);
   if(output)await page.screenshot({path:output+'/trusted-failed.png',fullPage:true});
   await page.getByText('Use a separately provisioned access token').click();await page.getByLabel('Hub browser access token').fill(f.token);await page.getByRole('button',{name:'Connect',exact:true}).click();await signedIn(page);
   checks.push('a failed sign-in shows the launcher and token fallbacks');
  }finally{await context.close();await f.close();}
 }
 {
  const f=await fixture({empty:true}),context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
  try{
   const page=await context.newPage();page.setDefaultTimeout(12000);
   await page.goto(f.hub.url);await page.getByText('Open B.U.N.N.Y. with the Hub launcher.',{exact:true}).waitFor();
   await page.getByText('The launcher opens this page and connects automatically. After a reload, run it again.',{exact:true}).waitFor();
   assert.equal(await page.getByRole('alert').count(),0,'a hub without the option shows no error');
   assert.equal(await page.getByRole('button',{name:'Sign in',exact:true}).count(),0);
   assert.equal(f.hub.resources().browserSessions,0);
   if(output)await page.screenshot({path:output+'/option-off.png',fullPage:true});
   checks.push('without the option the login page is unchanged');
  }finally{await context.close();await f.close();}
 }
 const receipt={synthetic:true,physical:false,passed:true,checks};
 if(output)await writeFile(output+'/trusted.json',JSON.stringify(receipt,null,2));
 console.log(JSON.stringify(receipt));
}finally{await browser.close();}
