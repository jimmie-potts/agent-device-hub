import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {fixture} from './fixture.mjs';
const output=process.env.DASHBOARD_RECEIPTS;
if(output)await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const f=await fixture({catalog:true,browserAccess:'trusted-loopback',empty:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(20000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(f.hub.url+'/#/component/pixel');
 const component=page.getByRole('region',{name:'pixel',exact:true}),grid=component.locator('[data-widget=pixoo-media]'),playlists=component.locator('[data-widget=pixoo-playlists]');
 await grid.getByRole('button',{name:/Aurora variable/}).waitFor();
 await grid.getByRole('button',{name:/Aurora variable/}).click();
 await grid.getByText('20 frames · 2000 ms per loop').waitFor();
 assert.equal(await grid.getByRole('button',{name:'Play preview',exact:true}).count(),1,'reduced motion prevents autoplay');
 const pixels=await grid.locator('.pixoo-animation canvas').evaluate(c=>Array.from(c.getContext('2d').getImageData(1,1,1,1).data));assert.deepEqual(pixels,[4,4,2,255]);
 await grid.getByRole('button',{name:'Play preview',exact:true}).click();await grid.getByRole('button',{name:'Pause preview',exact:true}).waitFor();await grid.getByRole('button',{name:'Pause preview',exact:true}).click();
 await playlists.getByRole('button',{name:/Evening colors/}).click();await playlists.getByText('3 plays',{exact:true}).waitFor();assert.equal(await playlists.locator('.pixoo-filmstrip li').count(),3);
 await playlists.getByRole('button',{name:/00000000-0000-4000-8000-000000000101/}).click();await playlists.getByRole('heading',{name:'00000000-0000-4000-8000-000000000101'}).waitFor();
 await playlists.getByRole('button',{name:/Evening colors/}).click();
 assert.equal(await grid.getByText('Preview available · playback outside configured profile',{exact:true}).count(),2);
 await grid.getByRole('button',{name:'Next page',exact:true}).click();await grid.getByText('26–30 of 30',{exact:true}).waitFor();assert.equal(await grid.locator('.pixoo-media-grid li').count(),5);
 await grid.getByRole('button',{name:'Previous page',exact:true}).click();await grid.getByRole('button',{name:/Aurora variable/}).waitFor();await grid.getByRole('button',{name:/Aurora variable/}).click();await grid.getByText('20 frames · 2000 ms per loop').waitFor();
 // Read-only source state changes are discovered by the established five-second integration poll.
 const frameReads=f.catalogData.reads.filter(path=>path.includes('/frames/')).length;
 f.catalogData.media[0].name='Updated aurora.gif';f.catalogData.revision++;
 await grid.getByRole('button',{name:/Updated aurora/}).waitFor();
 await grid.getByText('20 frames · 2000 ms per loop').waitFor();
 assert.equal(f.catalogData.reads.filter(path=>path.includes('/frames/')).length,frameReads,'catalog rename retains immutable frame buffers');
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});
  const violations=(await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations;assert.deepEqual(violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(output)await page.screenshot({path:`${output}/353-pixoo-${width}.png`,fullPage:true});
 }
 await page.getByRole('link',{name:/Home/}).first().click();
 await page.getByRole('region',{name:'Home',exact:true}).getByRole('heading',{name:'Pixoo now showing',exact:true}).waitFor();
 // Hidden catalog widgets stop frame and thumbnail reads. The visible now-showing widget may load its own rendition.
 await page.getByRole('link',{name:'Connections',exact:true}).click();await page.waitForTimeout(200);const count=f.catalogData.reads.length;await page.waitForTimeout(500);assert.equal(f.catalogData.reads.length,count);
 assert.deepEqual(errors,[]);assert.deepEqual(f.writes,[]);
 if(output)await writeFile(`${output}/353-browser.json`,JSON.stringify({checks:'pixels,20 frames,variable timing,reduced motion,playlist order,unnamed fallback,paging,revision,visibility,axe,overflow,no writes',passed:true},null,2));
 console.log('Pixoo media browser checks passed');
}finally{await context.close();await f.close();await browser.close();}
