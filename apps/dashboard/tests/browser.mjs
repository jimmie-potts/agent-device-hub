import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {fixture} from './fixture.mjs';
const f=await fixture();const browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
const output=process.env.DASHBOARD_RECEIPTS??'/tmp/gh6-dashboard-receipts';await mkdir(output,{recursive:true});
// Successful sequential edits start only after the owning snapshot is observed.
// The separate concurrent-edit scenario deliberately retains its stale draft.
async function applyNano(name){
 const previous=f.nano.revision;
 const refreshed=page.waitForResponse(async response=>response.url().endsWith('/api/controllers/v1/wall/integration/snapshot')&&response.status()===200&&(await response.json()).revision!==previous);
 await page.getByRole('button',{name,exact:true}).click();await refreshed;
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
const timings=[],renderTimings=[];let feedConnections=0;page.on('request',r=>{if(r.url().endsWith('/changes'))feedConnections++;});
try {
 await page.route('**/api/dashboard/v1/context',async route=>{const response=await route.fetch();if(response.status()!==200){await route.fulfill({response});return;}const value=await response.json();value.components.push({id:'synthetic',kind:'sensor',controllerId:'test',deviceId:'sensor',health:'unknown',pending:0});await route.fulfill({response,json:value});});
 await page.route('**/api/controllers/v1/synthetic/snapshot',async route=>{const value=structuredClone(f.states.wall);value.identity={controllerId:'test',deviceId:'sensor',sourceId:'test',controllerEpoch:'epoch'};value.capabilities.modes={supported:false};await route.fulfill({json:value});});
 await page.goto(f.hub.url);await page.getByLabel('Hub browser access token').fill(f.token);await page.getByRole('button',{name:'Connect',exact:true}).click();
 await page.getByRole('heading',{name:'Build the integration',exact:true}).waitFor();
 await page.getByLabel('Find a session').fill('no-match');await page.getByRole('heading',{name:'No matching sessions'}).waitFor();await page.getByLabel('Find a session').fill('');
 await page.getByRole('button',{name:'wall nanoleaf',exact:true}).click();await page.getByLabel('Device mode').first().waitFor();
 assert.equal(f.writes.length,0,'opening/filtering/selecting does not command controllers');
 await page.getByRole('button',{name:'synthetic sensor',exact:true}).click();await page.getByText('Settings unavailable: this component has no supported integration extension.',{exact:true}).waitFor();assert.equal(await page.locator('section:visible').getByRole('button',{name:/^Apply/,disabled:false}).count(),0,'an undeclared component offers no enabled control');await page.locator('section:visible').getByText('Unavailable: Power is not declared by this controller',{exact:true}).waitFor();await page.getByRole('button',{name:'wall nanoleaf',exact:true}).click();
 await page.screenshot({path:output+'/component-desktop.png',fullPage:true});
 const mode=page.getByLabel('Device mode').first();await mode.selectOption('Quiet');await page.getByRole('button',{name:'Apply mode',exact:true}).first().click();
 await page.getByText('queued. Physical result is not confirmed.',{exact:true}).waitFor();assert.equal(f.writes.length,1);assert.equal(f.writes[0].command.command.mode,'Quiet');
 await page.getByLabel('Layout style').selectOption('project');await applyNano('Apply integration settings');await page.getByText('applied. Physical result is not confirmed.',{exact:true}).waitFor();
 assert.equal(f.writes[1].command.command.style,'project');
 await page.getByLabel('Signature').filter({visible:true}).selectOption('1');await applyNano('Apply element mapping');await page.waitForFunction(()=>Array.from(document.querySelectorAll('[role=status]')).filter(x=>x.textContent==='applied. Physical result is not confirmed.').length>=2);assert.equal(f.nano.elements[0].projectId,f.nano.projects[0].id);await page.getByText('Current assignment: '+f.nano.projects[0].id+'; signature on.',{exact:true}).waitFor();
 await page.getByLabel('Task project').selectOption(f.nano.projects[0].id);assert.equal(await page.getByLabel('Task project').inputValue(),f.nano.projects[0].id);await applyNano('Apply task mapping');await page.waitForFunction(()=>Array.from(document.querySelectorAll('[role=status]')).filter(x=>x.textContent==='applied. Physical result is not confirmed.').length>=3);assert.equal(f.writes.find(x=>x.command.command?.kind==='task.assign')?.command.command.projectId,f.nano.projects[0].id,'submitted task mapping preserves chosen project');assert.equal(f.nano.tasks[0].overrideProjectId,f.nano.projects[0].id);await page.getByText('Current override: '+f.nano.projects[0].id+'; source project: '+f.nano.projects[0].id+'.',{exact:true}).waitFor();
 await page.getByLabel('Color project').selectOption(f.nano.projects[1].id);assert.equal(await page.locator('input[type=color]:visible').inputValue(),'#ff0000');assert.equal(await page.getByRole('button',{name:'Apply project color',exact:true}).isDisabled(),true);await page.locator('input[type=color]:visible').fill('#112233');await applyNano('Apply project color');await page.waitForFunction(()=>Array.from(document.querySelectorAll('[role=status]')).filter(x=>x.textContent==='applied. Physical result is not confirmed.').length>=4);assert.equal(f.nano.projects[1].color,'#112233');

 await page.getByRole('button',{name:'pixel pixoo',exact:true}).click();await page.getByLabel('Label / ID filter').waitFor();await page.getByLabel('Label / ID filter').fill('chosen');await page.getByRole('button',{name:'Apply monitor view',exact:true}).click();await page.getByText('configuration accepted. Physical result is not confirmed.',{exact:true}).waitFor();assert.equal(f.pixoo.configuration.filter.q,'chosen');
 await page.getByRole('button',{name:/^Activity/}).click();const label=page.getByLabel('Chosen label');await label.fill('My deliberate label');await label.focus();
 const before=f.writes.length;
 for(let i=0;i<5;i++){const start=performance.now();await f.event('session.started');timings.push(performance.now()-start);}
 await page.waitForTimeout(1500);assert.equal(await label.inputValue(),'My deliberate label');assert.equal(await label.evaluate(el=>el===document.activeElement),true);assert.equal(f.writes.length,before);
 const feedBefore=feedConnections;f.reconnect();await page.waitForTimeout(1800);assert.ok(feedConnections>feedBefore,'stream reconnects');assert.equal(await label.inputValue(),'My deliberate label');assert.equal(f.writes.length,before,'reconnect never replays writes');
 await page.getByRole('button',{name:'Apply label',exact:true}).click();await page.getByRole('heading',{name:'My deliberate label',exact:true}).waitFor();
 await page.screenshot({path:output+'/activity-desktop.png',fullPage:true});
 for(let i=0;i<10;i++){const start=performance.now();const result=await f.event('session.started');await page.waitForFunction(revision=>Number(document.getElementById('main').dataset.revision)>=revision,result.revision);renderTimings.push(performance.now()-start);}
 const a11y=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(a11y.violations.map(v=>({id:v.id,nodes:v.nodes.length})),[]);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:output+'/activity-mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile has no horizontal overflow');
 const mobile=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(mobile.violations.map(v=>v.id),[]);
 await page.getByRole('button',{name:'wall nanoleaf',exact:true}).click();await page.locator('section:visible').getByRole('button',{name:'Discard edit / load current'}).first().click();await page.getByLabel('Device mode').first().selectOption('Free');const concurrent={apiVersion:'1.0',controllerId:f.states.wall.identity.controllerId,deviceId:'wall',requestId:f.states.wall.nextRequestId,expectedConfigurationRevision:f.states.wall.configurationRevision,expectedGeneration:f.states.wall.generation,command:{kind:'mode.set',mode:'Work'}};const concurrentResult=await fetch(f.hub.url+'/api/controllers/v1/wall/commands',{method:'POST',headers:f.headers,body:JSON.stringify(concurrent)});assert.equal(concurrentResult.status,200);
 await page.waitForTimeout(5500);await page.locator('section:visible').getByText('Changed by another client.',{exact:false}).first().waitFor();assert.equal(await page.getByLabel('Device mode').first().inputValue(),'Free');assert.equal(await page.getByRole('button',{name:'Apply mode',exact:true}).first().isDisabled(),true);
 f.setOffline(true);await page.waitForTimeout(5500);await page.getByRole('button',{name:'pixel pixoo',exact:true}).click();await page.getByText('Stale / unavailable',{exact:true}).waitFor();
 f.setOffline(false);await page.waitForTimeout(5500);
 await page.getByRole('button',{name:'wall nanoleaf',exact:true}).click();await page.locator('section:visible').getByRole('button',{name:'Discard edit / load current'}).first().click();await page.getByLabel('Device mode').first().selectOption('Quiet');f.setUncertain(true);const submitted=f.writes.length;await page.getByRole('button',{name:'Apply mode',exact:true}).first().click();await page.getByText('Uncertain result. Do not repeat this command.',{exact:false}).waitFor();await page.waitForTimeout(5500);assert.equal(f.writes.length,submitted+1,'uncertain command is not retried');f.setUncertain(false);
 await page.getByRole('button',{name:/^Activity/}).click();
 await f.event('question.continuing',{event:{kind:'question.continuing',attention:{status:'known',id:'question'}}});
 await f.event('attention.approval',{event:{kind:'attention.approval',attention:{status:'known',id:'approval'}}});
 await f.event('session.started',{identity:{...f.identity,sessionId:'child'},parent:{status:'known',identity:f.identity},label:{origin:'user',value:'Synthetic subagent'}});
 await page.getByRole('heading',{name:'Synthetic subagent',exact:true}).waitFor();await page.getByText('Question · continuing',{exact:true}).waitFor();await page.getByText('approval · blocked attention',{exact:true}).waitFor();
 assert.equal(await page.getByText('1 active / 0 uncertain',{exact:true}).count(),1);
 await f.event('turn.ended');await page.getByRole('heading',{name:'Retained notices',exact:true}).waitFor();
 const parent=page.locator('article.session').filter({has:page.getByRole('heading',{name:'My deliberate label',exact:true})});const ackWrites=f.writes.length;
 await parent.getByLabel('Acknowledge for').selectOption('dashboard');await parent.getByRole('button',{name:'Apply monitor acknowledgment',exact:true}).click();await parent.getByText('Acknowledged by: dashboard.',{exact:false}).waitFor();assert.equal(f.writes.length,ackWrites,'monitor acknowledgment never commands a device');
 const snapshot=await (await fetch(f.hub.url+'/api/monitor/v1/sessions',{headers:f.headers})).json();assert.equal(snapshot.snapshot.sessions.find(x=>x.identity.sessionId==='task-one').read,'unknown','acknowledgment cannot mark provider read');
 await page.screenshot({path:output+'/activity-evidence.png',fullPage:true});
 await page.getByRole('button',{name:'Disconnect',exact:true}).click();await page.getByLabel('Hub browser access token').fill(f.reader);await page.getByRole('button',{name:'Connect',exact:true}).click();await page.getByRole('heading',{name:'My deliberate label',exact:true}).waitFor();await page.getByRole('button',{name:'wall nanoleaf',exact:true}).click();await page.getByText('Unavailable: Your credential is read-only',{exact:true}).first().waitFor();assert.equal(await page.getByRole('button',{name:'Apply mode',exact:true}).first().isDisabled(),true);
 await page.keyboard.press('Tab');assert.ok(await page.evaluate(()=>document.activeElement!==document.body),'keyboard focus remains reachable');
 assert.deepEqual(errors,[]);
 await writeFile(output+'/receipt.json',JSON.stringify({synthetic:true,physical:false,tests:'browser controls, no-write inspection, draft/focus, conflict, offline, desktop/mobile axe',ingestRoundTripMs:timings,eventToRenderedSnapshotMs:renderTimings,feedConnections,a11yViolations:0},null,2));
 console.log(JSON.stringify({passed:true,output,writes:f.writes.length,ingestRoundTripMs:timings}));
}catch(error){console.error(await page.locator('section:visible').innerText());throw error;}finally{await page.close();await browser.close();await f.close();}
