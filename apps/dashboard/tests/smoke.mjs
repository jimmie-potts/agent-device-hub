import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {mkdir} from 'node:fs/promises';
import {fixture} from './fixture.mjs';
// Hub #827: CI's smoke check of the built dashboard. The full browser suite (`npm run test:dashboard:browser`) runs locally.
// One trusted-loopback page: the built bundle loads and signs in, the home renders the fixture's session and device
// widgets and passes axe, and one widget control sends exactly one guarded command.
const started=performance.now();
const f=await fixture({browserAccess:'trusted-loopback'});
const browser=await chromium.launch({headless:true});
const output=process.env.DASHBOARD_RECEIPTS;if(output)await mkdir(output,{recursive:true});
const checks=[];
try{
 const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
 const errors=[];context.on('weberror',e=>errors.push(e.error().message));
 const page=await context.newPage();page.setDefaultTimeout(12000);
 const response=await page.goto(f.hub.url);
 assert.equal(response.status(),200);
 assert.equal(await page.locator('script[type=module][src="/dashboard.js"]').count(),1,'the Hub serves the built dashboard page');
 checks.push('the built dashboard loads');

 await page.getByText('Control enabled · Local',{exact:true}).waitFor();
 assert.equal(await page.getByText('Use a separately provisioned access token').count(),0,'no login form');
 assert.equal(f.hub.resources().browserSessions,1);
 checks.push('trusted-loopback opens signed in');

 await page.getByRole('heading',{name:'Home',exact:true}).waitFor();
 await page.locator('article[data-widget=sessions]').getByRole('heading',{name:'Build the integration',exact:true}).waitFor();
 const widgets=page.locator('article[data-widget=component-status]');
 await widgets.first().getByLabel('Device mode').waitFor();
 assert.deepEqual(await widgets.evaluateAll(all=>all.map(w=>w.querySelector('h2').textContent)),['wall','pixel']);
 assert.equal(f.writes.length,0,'loading and inspecting send no device command');
 checks.push('the home renders the fixture session and device widgets');

 const a11y=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
 assert.deepEqual(a11y.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>`${n.target.join(' ')}: ${n.failureSummary}`)})),[]);
 if(output)await page.screenshot({path:output+'/smoke-home.png',fullPage:true});
 checks.push('the home passes axe');

 const wall=widgets.filter({has:page.getByRole('heading',{name:'wall',exact:true})});
 const status=wall.locator('form.edit').filter({has:page.getByRole('heading',{name:'Mode',exact:true})}).locator(':scope>[role=status]');
 const guard={requestId:structuredClone(f.states.wall.nextRequestId),expectedConfigurationRevision:f.states.wall.configurationRevision,expectedGeneration:structuredClone(f.states.wall.generation)};
 await wall.getByLabel('Device mode').selectOption('Quiet');
 await status.filter({hasText:/^(Queued\. The device hasn’t received it yet\.|Sent to the device\.)/}).waitFor();
 assert.deepEqual(f.writes,[{id:'wall',integration:false,command:{apiVersion:'1.0',controllerId:'wall-controller',deviceId:'wall',...guard,command:{kind:'mode.set',mode:'Quiet'}}}]);
 checks.push('the wall widget sends one guarded mode command');

 assert.deepEqual(errors,[]);
 await context.close();
 console.log(JSON.stringify({passed:true,checks,seconds:Math.round((performance.now()-started)/100)/10}));
}finally{await browser.close();await f.close();}
