import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {startHub} from '../../hub/dist/server.js';
import {loadHostConfig,startLocalControllers} from '../../local-controllers/dist/index.js';
import {TOKENS,bulb,fakeHub,fakeLifx,fakeTidbyt,privateFiles} from '../../local-controllers/tests/helpers.mjs';

// Hub #289: the real local controller host with fake Tidbyt and LIFX transports behind the real hub and dashboard.
const hash=x=>createHash('sha256').update(x).digest('hex');
const output=process.env.DASHBOARD_RECEIPTS??join(tmpdir(),'gh289-dashboard-receipts');await mkdir(output,{recursive:true});
const cleanup=[];const t={after:fn=>cleanup.push(fn)};
const browser=await chromium.launch({headless:true});
try {
 const s=privateFiles(t,await fakeHub(t)),lifx=fakeLifx(),tidbyt=fakeTidbyt();
 // `shelf` has no qualified model evidence, so it declares nothing.
 const host={...s.host,lifx:{...s.host.lifx,bulbs:[bulb('desk','192.0.2.10'),{deviceId:'shelf',address:'192.0.2.11'}]}};
 const local=await startLocalControllers(loadHostConfig(s.write('host.json',host)),{tidbyt:{connection:tidbyt.connection,leaseRoot:s.locks},lifx:{transportFactory:lifx.transportFactory,leaseRoot:s.locks}});
 cleanup.push(()=>local.close());
 const directory=await mkdtemp(join(tmpdir(),'dashboard-local-'));const token='d'.repeat(43),reader='r'.repeat(43),devices=['tidbyt','desk','shelf'];
 const endpoint=local.url+'/controller/v1';
 const hub=await startHub({directory,ownerId:'fixture-owner',consumers:[{id:'dashboard',clearOnNewTurn:false}],
  credentials:[{id:'browser',digest:hash(token),scopes:['read','control'],devices},{id:'reader',digest:hash(reader),scopes:['read'],devices}],
  controllers:[{id:'tidbyt',kind:'tidbyt',controllerId:'tidbyt-status',deviceId:'tidbyt',endpoint,token:TOKENS.hub},
   {id:'desk',kind:'lifx',controllerId:'lifx',deviceId:'desk',endpoint,token:TOKENS.hub},{id:'shelf',kind:'lifx',controllerId:'lifx',deviceId:'shelf',endpoint,token:TOKENS.hub}]});
 cleanup.push(async()=>{await hub.close();await rm(directory,{recursive:true,force:true});});
 async function open(credential,{width=1280,height=1000}={}){
  const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(12000);
  const errors=[],posts=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/controllers/'))posts.push({path:new URL(r.url()).pathname,body:r.postDataJSON()});});
  await page.goto(hub.url);await page.getByText('Use a separately provisioned access token').click();await page.getByLabel('Hub browser access token').fill(credential);await page.getByRole('button',{name:'Connect',exact:true}).click();
  await page.getByRole('heading',{name:'No sessions observed',exact:true}).waitFor();
  return {page,errors,posts,close:()=>context.close()};
 }
 const section=page=>page.locator('section:visible');
 // A full-page capture taken while scrolled would draw the off-screen skip link mid-page, so capture from the top.
 const capture=async(page,name)=>{await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:join(output,name),fullPage:true});};
 const axe=async page=>{const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target.join(' '))})),[]);};

 // Tidbyt: status only, every control explained, no editor or integration settings.
 const control=await open(token);const {page}=control;
 await page.getByRole('button',{name:'tidbyt tidbyt',exact:true}).click();
 await section(page).getByText('The local controller host publishes the agent status and now-playing tiles to this Tidbyt.',{exact:false}).waitFor();
 for(const reason of ['Power is not declared by this controller','Brightness is not declared by this controller'])await section(page).getByText('Unavailable: '+reason,{exact:false}).first().waitFor();
 assert.equal(await section(page).getByRole('button',{name:/^Apply/,disabled:false}).count(),0,'Tidbyt offers no enabled control');
 assert.equal(await section(page).getByText(/Advanced editor|Settings unavailable|Rendition selection/).count(),0);
 await axe(page);await capture(page,'tidbyt-desktop.png');

 // LIFX: power, brightness, color and color temperature; the observed color stays unknown until a read.
 await page.getByRole('button',{name:'desk lifx',exact:true}).click();
 const form=name=>section(page).getByRole('form',{name,exact:true});
 const hue=section(page).getByLabel('Hue (°)'),saturation=section(page).getByLabel('Saturation (%)'),kelvin=section(page).getByLabel('Color temperature (K)');
 await hue.waitFor();
 await section(page).locator('dl>div').filter({has:page.getByText('Observed color',{exact:true})}).getByText('Unknown',{exact:true}).waitFor();
 assert.equal(await section(page).getByRole('combobox',{name:'Power',exact:true}).isDisabled(),false);
 assert.equal(await section(page).getByLabel('Brightness (%)').isDisabled(),false);
 assert.equal(await section(page).getByText(/Advanced editor|Settings unavailable|Rendition selection/).count(),0);
 assert.deepEqual([await kelvin.getAttribute('min'),await kelvin.getAttribute('max')],['1500','9000']);
 await axe(page);await capture(page,'lifx-desktop.png');

 // One color change: a fresh lighting read supplies the guards, and exactly one profile request is sent.
 const before=await (await fetch(hub.url+'/api/controllers/v1/desk/lighting/snapshot',{headers:{authorization:`Bearer ${token}`}})).json();
 await hue.fill('200');await saturation.fill('80');await section(page).getByRole('button',{name:'Apply color',exact:true}).click();
 await form('Color').getByRole('status').filter({hasText:/^Sent to the device\./}).waitFor();
 const lighting=control.posts.filter(p=>p.path==='/api/controllers/v1/desk/lighting/commands');
 assert.equal(lighting.length,1);
 assert.deepEqual(lighting[0].body,{apiVersion:'1.0',controllerId:'lifx',deviceId:'desk',requestId:before.controller.nextRequestId,expectedConfigurationRevision:before.controller.configurationRevision,expectedGeneration:before.controller.generation,profile:{profileId:'lifx-light',profileVersion:'1.0.0'},command:{kind:'lifx.color.set',hue:200,saturation:80}});
 assert.deepEqual(lifx.log,[['desk',101],['desk',102]],'a color change never sends power');
 await section(page).locator('dl>div').filter({has:page.getByText('Observed color',{exact:true})}).locator('dd').filter({hasText:/^Hue \d+° · saturation \d+% · \d+ K · read/}).waitFor();
 await capture(page,'lifx-after-color.png');

 // Color temperature is its own single request; brightness still uses the controller v1 route.
 await kelvin.fill('2700');await section(page).getByRole('button',{name:'Apply color temperature',exact:true}).click();
 await form('Color temperature').getByRole('status').filter({hasText:/^Sent to the device\./}).waitFor();
 assert.deepEqual(control.posts.filter(p=>p.path.endsWith('/lighting/commands')).map(p=>p.body.command),[{kind:'lifx.color.set',hue:200,saturation:80},{kind:'lifx.temperature.set',kelvin:2700}]);
 await section(page).getByLabel('Brightness (%)').fill('35');await section(page).getByRole('button',{name:'Apply brightness',exact:true}).click();
 await new Promise(resolve=>{const wait=()=>control.posts.some(p=>p.path==='/api/controllers/v1/desk/commands')?resolve():setTimeout(wait,25);wait();});
 assert.deepEqual(control.posts.find(p=>p.path==='/api/controllers/v1/desk/commands').body.command,{kind:'brightness.set',percent:35});

 // An unqualified bulb declares nothing: every control, including lighting, names why it is unavailable.
 await page.getByRole('button',{name:'shelf lifx',exact:true}).click();
 await section(page).getByText('Unavailable: Color is not declared for this bulb’s qualified model',{exact:false}).waitFor();
 await section(page).getByText('Unavailable: Color temperature is not declared for this bulb’s qualified model',{exact:false}).waitFor();
 assert.equal(await section(page).getByRole('button',{name:/^Apply/,disabled:false}).count(),0);
 await capture(page,'lifx-unqualified.png');
 assert.deepEqual(control.errors,[]);await control.close();

 // A read-only credential sees the controls disabled with its scope named.
 const viewer=await open(reader);
 await viewer.page.getByRole('button',{name:'desk lifx',exact:true}).click();
 await section(viewer.page).getByLabel('Hue (°)').waitFor();
 assert.ok(await section(viewer.page).getByText('Unavailable: Your credential is read-only',{exact:false}).count()>=2);
 assert.equal(await section(viewer.page).getByLabel('Hue (°)').isDisabled(),true);
 const narrow=await open(token,{width:390,height:844});
 await narrow.page.getByRole('button',{name:'desk lifx',exact:true}).click();await section(narrow.page).getByLabel('Hue (°)').waitFor();
 assert.equal(await narrow.page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'no horizontal scroll at phone width');
 await capture(narrow.page,'lifx-phone.png');
 assert.deepEqual([...viewer.errors,...narrow.errors],[]);await viewer.close();await narrow.close();
 assert.equal(lifx.log.filter(([id])=>id==='shelf').length,0);
 console.log(JSON.stringify({localControllers:'passed',screenshots:output}));
} finally {
 await browser.close();
 for(const fn of cleanup.reverse())await fn();
}
