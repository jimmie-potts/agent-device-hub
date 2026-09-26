import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {startHub} from '../../hub/dist/server.js';
import {loadHostConfig,startLocalControllers} from '../../local-controllers/dist/index.js';
import {TOKENS,bulb,fakeHub,fakeLifx,fakeTidbyt,privateFiles,writes} from '../../local-controllers/tests/helpers.mjs';
import {textOverlaps} from './layout.mjs';

// Hub #289: the real local controller host with fake Tidbyt and LIFX transports behind the real hub and dashboard.
const hash=x=>createHash('sha256').update(x).digest('hex');
const output=process.env.DASHBOARD_RECEIPTS??join(tmpdir(),'gh289-dashboard-receipts');await mkdir(output,{recursive:true});
const cleanup=[];const t={after:fn=>cleanup.push(fn)};
const browser=await chromium.launch({headless:true});
try {
 const s=privateFiles(t,await fakeHub(t)),lifx=fakeLifx(),tidbyt=fakeTidbyt();
 // `shelf` has no qualified model evidence, so it declares nothing and is never read. `desk` reads as off; every `lamp` exchange fails.
 const host={...s.host,credentials:s.host.credentials.map(c=>({...c,devices:c.devices.includes('desk')?[...c.devices,'lamp']:c.devices})),
  lifx:{...s.host.lifx,bulbs:[bulb('desk','192.0.2.10'),{deviceId:'shelf',address:'192.0.2.11'},bulb('lamp','192.0.2.12')]}};
 lifx.mode.power=false;lifx.mode.failFor.add('lamp');
 const local=await startLocalControllers(loadHostConfig(s.write('host.json',host)),{tidbyt:{connection:tidbyt.connection,leaseRoot:s.locks},lifx:{transportFactory:lifx.transportFactory,leaseRoot:s.locks}});
 cleanup.push(()=>local.close());
 const directory=await mkdtemp(join(tmpdir(),'dashboard-local-'));const token='d'.repeat(43),reader='r'.repeat(43),devices=['tidbyt','desk','shelf','lamp'];
 const endpoint=local.url+'/controller/v1';
 const hub=await startHub({directory,ownerId:'fixture-owner',consumers:[{id:'dashboard',clearOnNewTurn:false}],
  credentials:[{id:'browser',digest:hash(token),scopes:['read','control'],devices},{id:'reader',digest:hash(reader),scopes:['read'],devices}],
  controllers:[{id:'tidbyt',kind:'tidbyt',controllerId:'tidbyt-status',deviceId:'tidbyt',endpoint,token:TOKENS.hub},
   {id:'desk',kind:'lifx',controllerId:'lifx',deviceId:'desk',endpoint,token:TOKENS.hub},{id:'shelf',kind:'lifx',controllerId:'lifx',deviceId:'shelf',endpoint,token:TOKENS.hub},{id:'lamp',kind:'lifx',controllerId:'lifx',deviceId:'lamp',endpoint,token:TOKENS.hub}]});
 cleanup.push(async()=>{await hub.close();await rm(directory,{recursive:true,force:true});});
 async function open(credential,{width=1280,height=1000,setup}={}){
  const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(12000);
  const errors=[],posts=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/controllers/'))posts.push({path:new URL(r.url()).pathname,body:r.postDataJSON()});});
  await setup?.(page);
  await page.goto(hub.url);await page.getByText('Use a separately provisioned access token').click();await page.getByLabel('Hub browser access token').fill(credential);await page.getByRole('button',{name:'Connect',exact:true}).click();
  await page.getByRole('heading',{name:'No sessions observed',exact:true}).waitFor();
  return {page,errors,posts,close:()=>context.close()};
 }
 const section=page=>page.locator('section:visible');
 // A full-page capture taken while scrolled would draw the off-screen skip link mid-page, so capture from the top.
 // Every captured view is also checked for overlapping text.
 const capture=async(page,name)=>{assert.deepEqual(await textOverlaps(page),[],name+': no text overlaps');await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:join(output,name),fullPage:true});};
 const axe=async page=>{const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target.join(' '))})),[]);};

 const none='No general controls: this controller declares no power, brightness, media or scenes.';
 // Tidbyt: status only; one line instead of four disabled forms, and no editor or integration settings.
 const control=await open(token);const {page}=control;
 await page.getByRole('link',{name:'tidbyt tidbyt',exact:true}).click();
 await section(page).getByText('The local controller host publishes the agent status and now-playing tiles to this Tidbyt.',{exact:false}).waitFor();
 await section(page).getByText(none,{exact:true}).waitFor();
 assert.equal(await section(page).getByRole('button',{name:/^Apply|^Start|^Activate/}).count(),0,'Tidbyt shows no dead forms');
 assert.equal(await section(page).getByText(/Advanced editor|Settings unavailable|Rendition selection/).count(),0);
 await axe(page);await capture(page,'tidbyt-desktop.png');

 // LIFX: the page's first read queues one bulb read; the next refresh shows the bulb is off, and Power starts there.
 await page.getByRole('link',{name:'desk lifx',exact:true}).click();
 const form=name=>section(page).getByRole('form',{name,exact:true});
 const hue=section(page).getByLabel('Hue (°)'),saturation=section(page).getByLabel('Saturation (%)'),kelvin=section(page).getByLabel('Color temperature (K)');
 await hue.waitFor();
 const powerGroup=section(page).getByRole('group',{name:'Power',exact:true});
 await powerGroup.getByText(/^Last read: off, .+ ago\./).waitFor();
 assert.equal(await powerGroup.getByRole('button',{name:'Turn on',exact:true}).isDisabled(),false);
 assert.equal(await powerGroup.getByRole('button',{name:'Turn off',exact:true}).count(),0,'a bulb read as off offers only Turn on');
 await section(page).getByText('Not declared by this controller: media and scenes.',{exact:true}).waitFor();
 assert.equal(await section(page).getByRole('button',{name:/^Start playlist|^Activate scene/}).count(),0,'no dead media or scene form');
 assert.equal(await section(page).getByLabel('Brightness (%)').isDisabled(),false);
 assert.equal(await section(page).getByText(/Advanced editor|Settings unavailable|Rendition selection/).count(),0);
 assert.deepEqual([await kelvin.getAttribute('min'),await kelvin.getAttribute('max')],['1500','9000']);
 await axe(page);await capture(page,'lifx-desktop.png');

 // Turn on from the observed Off sends one power command.
 const colors=(on,name)=>section(on).getByRole('button',{name,exact:true}).evaluate(el=>{const c=getComputedStyle(el);return [el.matches(':disabled'),c.backgroundColor,c.color,c.opacity];});
 await powerGroup.getByRole('button',{name:'Turn on',exact:true}).click();
 await powerGroup.getByRole('status').filter({hasText:/^Turn on: Sent to the device\./}).waitFor();
 await powerGroup.getByRole('button',{name:'Turn off',exact:true,disabled:false}).waitFor();const enabledColors=await colors(page,'Turn off');
 assert.deepEqual(control.posts.filter(p=>p.path==='/api/controllers/v1/desk/commands').map(p=>p.body.command),[{kind:'power.set',on:true}]);

 // One color change: a fresh lighting read supplies the guards, and exactly one profile request is sent.
 const before=await (await fetch(hub.url+'/api/controllers/v1/desk/lighting/snapshot',{headers:{authorization:`Bearer ${token}`}})).json();const traffic=lifx.log.length;
 await hue.fill('200');await saturation.fill('80');
 await form('Color').getByRole('status').filter({hasText:/^Sent to the device\./}).waitFor();
 const lighting=control.posts.filter(p=>p.path==='/api/controllers/v1/desk/lighting/commands');
 assert.equal(lighting.length,1);
 assert.deepEqual(lighting[0].body,{apiVersion:'1.0',controllerId:'lifx',deviceId:'desk',requestId:before.controller.nextRequestId,expectedConfigurationRevision:before.controller.configurationRevision,expectedGeneration:before.controller.generation,profile:{profileId:'lifx-light',profileVersion:'1.0.0'},command:{kind:'lifx.color.set',hue:200,saturation:80}});
 assert.deepEqual(lifx.log.slice(traffic),[['desk',101],['desk',102]],'a color change never sends power');
 await section(page).locator('dl>div').filter({has:page.getByText('Observed color',{exact:true})}).locator('dd').filter({hasText:/^Hue \d+° · saturation \d+% · \d+ K · read/}).waitFor();
 await capture(page,'lifx-after-color.png');

 // Color temperature is its own single request; brightness still uses the controller v1 route.
 await kelvin.fill('2700');
 await form('Color temperature').getByRole('status').filter({hasText:/^Sent to the device\./}).waitFor();
 assert.deepEqual(control.posts.filter(p=>p.path.endsWith('/lighting/commands')).map(p=>p.body.command),[{kind:'lifx.color.set',hue:200,saturation:80},{kind:'lifx.temperature.set',kelvin:2700}]);
 await section(page).getByLabel('Brightness (%)').fill('35');
 await new Promise(resolve=>{const wait=()=>control.posts.some(p=>p.body.command?.kind==='brightness.set')?resolve():setTimeout(wait,25);wait();});
 assert.deepEqual(control.posts.find(p=>p.body.command?.kind==='brightness.set').body.command,{kind:'brightness.set',percent:35});

 // An unqualified bulb declares nothing: one line for general controls and one for lighting, and no forms.
 await page.getByRole('link',{name:'shelf lifx',exact:true}).click();
 await section(page).getByText(none,{exact:true}).waitFor();
 await section(page).getByText('No lighting controls: this bulb’s model is not qualified for color or color temperature.',{exact:true}).waitFor();
 assert.equal(await section(page).getByRole('button',{name:/^Apply|^Start|^Activate/}).count(),0);
 await capture(page,'lifx-unqualified.png');

 // A bulb whose reads fail keeps unknown power: Power starts empty, says so, and either choice is one explicit command.
 await page.getByRole('link',{name:'lamp lifx',exact:true}).click();
 const lampPower=section(page).getByRole('group',{name:'Power',exact:true});await lampPower.getByText(/Current power is unknown/).waitFor();
 assert.deepEqual(await lampPower.getByRole('button').allTextContents(),['Turn on','Turn off'],'an unknown state offers both choices and never a guessed value');
 await axe(page);await capture(page,'lifx-unknown-power.png');
 await lampPower.getByRole('button',{name:'Turn on',exact:true}).click();
 await new Promise(resolve=>{const wait=()=>control.posts.some(p=>p.path==='/api/controllers/v1/lamp/commands')?resolve():setTimeout(wait,25);wait();});
 assert.deepEqual(control.posts.filter(p=>p.path==='/api/controllers/v1/lamp/commands').map(p=>p.body.command),[{kind:'power.set',on:true}]);
 assert.deepEqual(control.errors,[]);await control.close();

 // A read-only credential sees the controls disabled with its scope named.
 const viewer=await open(reader);
 await viewer.page.getByRole('link',{name:'desk lifx',exact:true}).click();
 await section(viewer.page).getByLabel('Hue (°)').waitFor();
 assert.ok(await section(viewer.page).getByText('Unavailable: Your credential is read-only',{exact:false}).count()>=2);
 assert.equal(await section(viewer.page).getByLabel('Hue (°)').isDisabled(),true);
 // Disabled and enabled buttons look different: the read-only credential's Turn on against the control credential's.
 const disabledColors=await colors(viewer.page,'Turn off');
 assert.deepEqual([enabledColors[0],disabledColors[0]],[false,true]);
 assert.notEqual(disabledColors[1],enabledColors[1],'disabled background differs');assert.notEqual(disabledColors[2],enabledColors[2],'disabled text differs');assert.equal(disabledColors[3],'1','not transparency alone');
 const narrow=await open(token,{width:390,height:844});
 await narrow.page.getByRole('link',{name:'desk lifx',exact:true}).click();await section(narrow.page).getByLabel('Hue (°)').waitFor();
 assert.equal(await narrow.page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'no horizontal scroll at phone width');
 await capture(narrow.page,'lifx-phone.png');
 // An unreachable bulb shows both unavailable messages under their section labels without overlap.
 const unreachable=await open(token,{setup:page=>page.route('**/api/controllers/v1/lamp/lighting/snapshot',route=>route.fulfill({status:503,json:{error:{code:'controller-unavailable'}}}))});
 await unreachable.page.getByRole('link',{name:'lamp lifx',exact:true}).click();
 await section(unreachable.page).getByText('General controls unavailable: no controller snapshot.',{exact:true}).waitFor();
 await section(unreachable.page).getByText('Lighting controls unavailable: no lighting snapshot.',{exact:true}).waitFor();
 await capture(unreachable.page,'lifx-unreachable.png');
 assert.deepEqual([...viewer.errors,...narrow.errors,...unreachable.errors],[]);await viewer.close();await narrow.close();await unreachable.close();
 assert.equal(lifx.log.filter(([id])=>id==='shelf').length,0,'an unqualified bulb gets no traffic');
 assert.deepEqual(writes(lifx.log).filter(([id])=>id==='desk'),[['desk',21],['desk',102],['desk',102],['desk',102]],'only explicit commands write');
 console.log(JSON.stringify({localControllers:'passed',screenshots:output}));
} finally {
 await browser.close();
 for(const fn of cleanup.reverse())await fn();
}
