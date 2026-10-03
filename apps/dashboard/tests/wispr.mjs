import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {mkdir,readFile} from 'node:fs/promises';
import {wisprFixture} from './wispr-fixture.mjs';
import {textOverlaps} from './layout.mjs';
const output=process.env.DASHBOARD_RECEIPTS??'apps/dashboard/.local/wispr-receipts';await mkdir(output,{recursive:true});
const f=await wisprFixture(),browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',hasTouch:true}),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));let writes=0;page.on('request',r=>{if(r.method()!=='GET'&&!r.url().endsWith('/logout')&&!r.url().endsWith('/session'))writes++;});
const signIn=async(token=f.token)=>{await page.getByText('Use a separately provisioned access token').click();await page.getByLabel('Hub browser access token').fill(token);await page.getByRole('button',{name:'Connect',exact:true}).click();};
const open=()=>page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:/Wispr/}).click();
const view=()=>page.getByRole('region',{name:'Wispr analytics'});
const fact=async(label)=>view().locator('dl>div').filter({has:page.locator('dt',{hasText:new RegExp('^'+label+'$')})}).locator('dd').first().textContent();
try{
 await page.goto(f.hub.url);await signIn();await page.getByRole('heading',{name:'Wispr today'}).waitFor();await page.locator('[data-widget="wispr-summary"]').locator('dd').filter({hasText:/^180$/}).waitFor();
 await page.screenshot({path:output+'/wispr-home.png',fullPage:true});
 await open();await view().getByText('hello world',{exact:true}).waitFor();
 assert.equal(await fact('Words'),'190');assert.equal(await fact('Dictations'),'4');assert.equal(await fact('Speaking minutes'),'1.7');assert.equal(await fact('Weighted speech WPM'),'114');
 assert.equal(await page.getByLabel('Period',{exact:true}).inputValue(),'7d');assert.ok((await view().textContent()).includes('America/New_York'));
 for(const [corpus,term] of [['raw','hello there'],['observed','hello friend'],['cleaned','hello world']]){await page.getByLabel('Text stage').selectOption(corpus);await view().getByText(term,{exact:true}).waitFor();}
 const cleanup=view().locator('.card').filter({has:page.getByRole('heading',{name:'Flow cleanup',exact:true})});await cleanup.getByRole('cell',{name:'there',exact:true}).waitFor();await cleanup.getByRole('cell',{name:'world',exact:true}).waitFor();
 const edits=view().locator('.card').filter({has:page.getByRole('heading',{name:'Observed edits',exact:true})});await edits.getByRole('cell',{name:'world',exact:true}).waitFor();await edits.getByRole('cell',{name:'friend',exact:true}).waitFor();
 await page.getByLabel('Period',{exact:true}).selectOption('all');await page.waitForFunction(()=>Array.from(document.querySelectorAll('.wispr-page dt')).find(x=>x.textContent==='Words')?.nextElementSibling?.textContent==='195');
 await page.getByLabel('App',{exact:true}).selectOption('slack');await page.waitForFunction(()=>Array.from(document.querySelectorAll('.wispr-page dt')).find(x=>x.textContent==='Words')?.nextElementSibling?.textContent==='180');
 const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download numeric JSON'}).click();const downloaded=await downloading;const exported=JSON.parse(await readFile(await downloaded.path(),'utf8'));assert.equal(exported.data.totals.words,180);assert.equal(exported.filters.app,'slack');assert.ok(!JSON.stringify(exported).includes('hello'));assert.equal(exported.revision,f.snapshot.revision);
 const csvWait=page.waitForEvent('download');await page.getByRole('button',{name:'Download numeric CSV'}).click();const csv=await readFile(await(await csvWait).path(),'utf8');assert.match(csv,/"data.totals.words","180"/);assert.ok(!csv.includes('hello'));
 await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:/^Home/}).click();await page.getByRole('heading',{name:'Wispr today'}).waitFor();assert.equal(await page.locator('body').textContent().then(s=>s.includes('hello world')),false,'navigation drops hidden text');await page.locator('[data-widget="wispr-summary"]').locator('dd').filter({hasText:/^180$/}).waitFor();await open();await view().getByText('hello world',{exact:true}).waitFor();assert.equal(await page.getByLabel('Period',{exact:true}).inputValue(),'all');assert.equal(await page.getByLabel('App',{exact:true}).inputValue(),'slack');
 await page.getByLabel('App',{exact:true}).selectOption('all');await page.getByLabel('Period',{exact:true}).selectOption('7d');await view().getByText('hello world',{exact:true}).waitFor();
 for(const width of [1440,900,390]){
  await page.setViewportSize({width,height:1000});await page.getByLabel('Period',{exact:true}).focus();assert.equal(await page.getByLabel('Period',{exact:true}).evaluate(e=>e===document.activeElement),true);
  const daily=view().getByText(/^Daily values/);await daily.focus();if(width===390)await daily.tap();else await daily.press('Enter');await view().getByRole('table',{name:'Captured daily totals'}).waitFor();if(width===390)await daily.tap();else await daily.press('Enter');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no page overflow '+width);assert.deepEqual(await textOverlaps(page),[],'no overlapping text '+width);
  const a11y=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(a11y.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[],'axe '+width);await page.screenshot({path:output+`/wispr-${width}.png`,fullPage:true});
 }
 await page.getByLabel('Category',{exact:true}).selectOption('email');await view().getByText('No captured dictations match this selection.',{exact:true}).waitFor();await view().getByText(/Low sample:/).waitFor();assert.equal(await fact('Words'),'0');assert.equal(await fact('Weighted speech WPM'),'Unavailable');await page.getByLabel('Category',{exact:true}).selectOption('all');await view().getByText('hello world',{exact:true}).waitFor();
 // A failed collector keeps dated numeric evidence and retires text.
 await f.fail();await page.waitForFunction(()=>document.querySelector('.wispr-page')?.textContent.includes('Stale collection.'),{},{timeout:15000});assert.equal(await fact('Words'),'190');await page.waitForFunction(()=>!document.body.textContent.includes('hello world'),{},{timeout:15000});
 await f.replaceSource();await view().getByText(/Collection status is unavailable or invalid/).first().waitFor({timeout:15000});assert.ok(!(await page.locator('body').textContent()).includes('hello world'));assert.equal(await fact('Words'),'190','replacement preserves only labelled last-good numeric evidence');
 // A denied final status cannot reintroduce a previously received language response.
 await f.optOut();await page.waitForFunction(()=>!document.body.textContent.includes('hello world')&&!document.body.textContent.includes('hello friend'),{},{timeout:15000});await view().getByText('Language collection or sharing is off.',{exact:true}).first().waitFor();
 assert.equal(await fact('Words'),'190');
 await f.clear();await view().getByText('Analytics have been cleared.',{exact:true}).waitFor({timeout:15000});assert.equal(await page.getByRole('button',{name:'Download numeric JSON'}).isDisabled(),true);assert.ok(!(await page.locator('body').textContent()).includes('hello world'));
 f.hub.replaceCredentials([f.credential(f.token,['other']),f.credential(f.wrong,['other'])]);await page.getByRole('region',{name:'Not found'}).waitFor();assert.equal(await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:/Wispr/}).count(),0);assert.equal(await page.locator('.wispr-page').count(),0);
 await page.getByRole('button',{name:'Disconnect',exact:true}).click();assert.equal(await page.locator('[data-widget="wispr-summary"]').count(),0);await signIn(f.wrong);await page.getByRole('region',{name:'Not found'}).waitFor();assert.equal(await page.getByRole('heading',{name:'Wispr today'}).count(),0);
 assert.equal(writes,0,'all analytics operations are reads');assert.deepEqual(errors,[]);console.log('Wispr real synthetic collector/Hub/browser: totals, stages, edits, numeric exports, independent filters, privacy retirement, responsive/axe passed.');
}catch(error){await page.screenshot({path:output+'/failure.png',fullPage:true});console.error(await page.locator('body').innerText());throw error;}finally{await context.close();await browser.close();await f.close();}

// Missing configuration and unreadable initial source remain distinct from an empty capture.
for(const scenario of ['no source','malformed source','in-flight opt-out','empty source','sharing off','collection opt-in off','unsupported schema']){
 const fixture=await wisprFixture({configured:scenario!=='no source',share:scenario!=='sharing off',empty:scenario==='empty source'}),browser=await chromium.launch({headless:true}),context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(15000);let reads=0;
 page.on('request',r=>{if(r.url().includes('/api/wispr/'))reads++;});
 try{
  if(scenario==='collection opt-in off')await fixture.optOut();
  if(scenario==='unsupported schema')await fixture.unsupported();
  if(scenario==='malformed source')await fixture.malformed();
  if(scenario==='in-flight opt-out'){
   let once=true;await page.route('**/api/wispr/v1/language?*',async route=>{
    const response=await route.fetch();if(once){once=false;await fixture.optOut();}await route.fulfill({response});
   });
  }
  await page.goto(fixture.hub.url+'/#/wispr/dictation');await page.getByText('Use a separately provisioned access token').click();await page.getByLabel('Hub browser access token').fill(fixture.token);await page.getByRole('button',{name:'Connect',exact:true}).click();
  if(scenario==='no source'){await page.getByRole('region',{name:'Not found'}).waitFor();assert.equal(reads,0);assert.equal(await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:/Wispr/}).count(),0);}
  else if(scenario==='malformed source'){await page.getByText(/The configured source is unavailable/).waitFor();assert.equal(await page.locator('.wispr-page dt').count(),0);}
  else if(scenario==='empty source'){await page.getByText('The source has no eligible captured dictations.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Download numeric JSON'}).isDisabled(),true);}
  else if(scenario==='unsupported schema'){await page.getByText(/The Wispr source schema is unsupported/).first().waitFor();assert.ok(!(await page.locator('body').textContent()).includes('hello world'));}
  else{await page.getByText('Language collection or sharing is off.',{exact:true}).first().waitFor();assert.ok(!(await page.locator('body').textContent()).includes('hello world'));assert.ok(!(await page.locator('body').textContent()).includes('hello friend'));}
  console.log('Wispr browser: '+scenario+' passed.');
 }finally{await context.close();await browser.close();await fixture.close();}
}
