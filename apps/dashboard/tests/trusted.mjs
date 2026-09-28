import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {fixture} from './fixture.mjs';
// Hub #276: with browserAccess "trusted-loopback" a bookmark opens B.U.N.N.Y. signed in, and reloads and tabs stay signed in.
// Hub #561: so does a link from another loopback app on the same host name.
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
 {
  // Hub #561: a link from another loopback app, like the wall's B.U.N.N.Y. link, opens the dashboard signed in, in a new tab.
  // That app cannot frame the dashboard, and a link from another host name is cross-site and stays refused.
  const f=await fixture({empty:true,browserAccess:'trusted-loopback'}),context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
  const hubPort=new URL(f.hub.url).port;
  const other=createServer((req,res)=>{
   const url=new URL(req.url,'http://other'),target=`http://${url.searchParams.get('to')==='localhost'?'localhost':'127.0.0.1'}:${hubPort}/`;
   res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
   res.end(`<!doctype html><html lang="en"><title>Another local app</title><a href="${target}" target="_blank" rel="noopener noreferrer">B.U.N.N.Y.</a>${url.pathname==='/framed'?`<iframe title="Framed B.U.N.N.Y." src="${target}"></iframe>`:''}</html>`);
  });
  await new Promise(resolve=>other.listen(0,'127.0.0.1',resolve));
  const otherPort=other.address().port,toHub=response=>new URL(response.url()).port===hubPort;
  /** Opens a page of the other app and clicks its B.U.N.N.Y. link, as the owner does. Returns the new tab and the Hub's answer to its navigation. */
  async function follow(from){
   const page=await context.newPage();page.setDefaultTimeout(12000);await page.goto(from);
   const [tab,response]=await Promise.all([context.waitForEvent('page'),context.waitForEvent('response',r=>r.request().isNavigationRequest()&&toHub(r)),page.getByRole('link',{name:'B.U.N.N.Y.',exact:true}).click()]);
   tab.setDefaultTimeout(12000);
   return {page,tab,response,site:(await response.request().allHeaders())['sec-fetch-site']};
  }
  const errors=[];context.on('weberror',e=>errors.push(e.error().message));
  try{
   for(const [from,name] of [[`http://127.0.0.1:${otherPort}/`,'127.0.0.1'],[`http://localhost:${otherPort}/?to=localhost`,'localhost']]){
    const {page,tab,response,site}=await follow(from);
    assert.equal(site,'same-site',`Chromium sends a ${name} link to another port as same-site`);
    assert.equal(response.status(),200,`the Hub serves the page linked from another ${name} app`);
    await signedIn(tab);
    assert.equal(f.hub.resources().browserSessions,1,'the linked tab signs in once');
    if(output)await tab.screenshot({path:`${output}/linked-${name}.png`,fullPage:true});
    await tab.close({runBeforeUnload:true});await page.close();await until(()=>f.hub.resources().browserSessions===0,'closing the linked tab logs its session out');
   }
   checks.push('a link from another loopback app opens the dashboard signed in');

   {
    const {page,tab,response,site}=await follow(`http://localhost:${otherPort}/`);
    assert.equal(site,'cross-site','a localhost page linking to 127.0.0.1 is cross-site');
    assert.equal(response.status(),403,'the Hub refuses a cross-site link');
    await tab.getByText('forbidden',{exact:false}).waitFor();
    assert.equal(f.hub.resources().browserSessions,0);
    await tab.close();await page.close();
   }
   checks.push('a link from another host name is refused');

   {
    const page=await context.newPage();page.setDefaultTimeout(12000);
    const framed=page.waitForResponse(toHub);await page.goto(`http://127.0.0.1:${otherPort}/framed`);
    const response=await framed;
    assert.equal((await response.request().allHeaders())['sec-fetch-dest'],'iframe');
    assert.equal(response.status(),403,'the Hub refuses to be framed by another loopback app');
    await page.frameLocator('iframe').getByText('forbidden',{exact:false}).waitFor();
    assert.equal(await page.frameLocator('iframe').getByText('Control enabled · Local',{exact:true}).count(),0);
    assert.equal(f.hub.resources().browserSessions,0,'a framed page never signs in');
    await page.close();
   }
   checks.push('another loopback app cannot frame the dashboard');
   assert.equal(f.writes.length,0,'following links sends no device command');
   assert.deepEqual(errors,[]);
  }finally{await context.close();await new Promise(resolve=>{other.close(resolve);other.closeAllConnections();});await f.close();}
 }
 const receipt={synthetic:true,physical:false,passed:true,checks};
 if(output)await writeFile(output+'/trusted.json',JSON.stringify(receipt,null,2));
 console.log(JSON.stringify(receipt));
}finally{await browser.close();}
