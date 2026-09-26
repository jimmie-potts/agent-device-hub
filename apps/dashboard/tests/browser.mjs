import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {fixture} from './fixture.mjs';
import {textOverlaps,controlReach} from './layout.mjs';
const f=await fixture();const browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
const output=process.env.DASHBOARD_RECEIPTS??'/tmp/gh6-dashboard-receipts';await mkdir(output,{recursive:true});
// Successful sequential edits start only after the owning snapshot is observed.
// The separate concurrent-edit scenario deliberately retains its stale draft.
async function applyNano(act){
 const previous=f.nano.revision;
 const refreshed=page.waitForResponse(async response=>response.url().endsWith('/api/controllers/v1/wall/integration/snapshot')&&response.status()===200&&(await response.json()).revision!==previous);
 await act();await refreshed;
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
const timings=[],renderTimings=[];let feedConnections=0;page.on('request',r=>{if(r.url().endsWith('/changes'))feedConnections++;});
try {
 await page.route('**/api/dashboard/v1/context',async route=>{const response=await route.fetch();if(response.status()!==200){await route.fulfill({response});return;}const value=await response.json();for(const id of ['synthetic','activity','connections'])value.components.push({id,kind:'sensor',controllerId:'test',deviceId:id,health:'unknown',pending:0});await route.fulfill({response,json:value});});
 await page.route(/\/api\/controllers\/v1\/(synthetic|activity|connections)\/snapshot$/,async route=>{const value=structuredClone(f.states.wall);value.identity={controllerId:'test',deviceId:'sensor',sourceId:'test',controllerEpoch:'epoch'};value.capabilities={power:{supported:false},brightness:{supported:false},media:{supported:false},zones:{supported:false},scenes:{supported:false},preview:{supported:false},modes:{supported:false}};await route.fulfill({json:value});});
 await page.goto(f.hub.url);await page.getByText('Use a separately provisioned access token').click();await page.getByLabel('Hub browser access token').fill(f.token);await page.getByRole('button',{name:'Connect',exact:true}).click();
 await page.getByRole('heading',{name:'Build the integration',exact:true}).waitFor();
 const places=page.getByRole('navigation',{name:'Places'});
 assert.deepEqual(await places.locator('a, [aria-current=page]').allTextContents(),
  ['Guide','Architecture','Atlas','Reference','B.U.N.N.Y.Local','WallLocal']);
 assert.equal(await places.getByRole('link',{name:'Wall Local'}).getAttribute('href'),'http://127.0.0.1:8765/');
 assert.equal(await places.getByRole('link',{name:'Guide'}).getAttribute('href'),'https://jimmie-potts.github.io/agent-device-guide/');
 assert.equal(f.writes.length,0,'Places are read-only navigation');
 // Hub #277: the home is a widget grid whose component widgets, their quick actions and the sessions sit in the first screen at 1440 px.
 await page.getByRole('heading',{name:'Home',exact:true}).waitFor();
 const widgets=page.locator('article[data-widget=component-status]');await widgets.first().getByLabel('Device mode').waitFor();
 assert.deepEqual(await widgets.evaluateAll(all=>all.map(w=>w.querySelector('h2').textContent)),['wall','pixel','synthetic','activity','connections']);
 assert.ok(await widgets.evaluateAll(all=>all.every(w=>w.getBoundingClientRect().top<innerHeight)),'every component widget starts in the first screen');
 assert.ok(await page.locator('article[data-widget=sessions]').evaluate(w=>w.getBoundingClientRect().top<innerHeight),'the sessions widget starts in the first screen');
 for(const id of ['wall','pixel'])assert.ok(await widgets.filter({has:page.getByRole('heading',{name:id,exact:true})}).evaluate(w=>[...w.querySelectorAll('select,button')].every(b=>b.getBoundingClientRect().bottom<innerHeight)),id+' quick actions end in the first screen');
 assert.ok(await controlReach(page)>=0.7,'the home fills the width');assert.deepEqual(await textOverlaps(page),[],'home text never overlaps');
 await page.screenshot({path:output+'/home-desktop.png',fullPage:true});
 // Hash routes: every page has an address, the back button walks the history, and a component alias named like a built-in page opens only that component (Hub #247).
 assert.equal(new URL(page.url()).hash,'');
 await page.getByRole('link',{name:'activity sensor',exact:true}).click();await page.locator('section:visible .section-heading h2',{hasText:/^activity$/}).waitFor();
 assert.equal(new URL(page.url()).hash,'#/component/activity');assert.deepEqual(await page.locator('nav a[aria-current=page]').allTextContents(),['activitysensor']);
 assert.equal(await page.getByRole('heading',{name:'Home',exact:true}).filter({visible:true}).count(),0,'the home is not shown for the activity alias');
 assert.equal(await page.locator('section:visible .section-heading h2').textContent(),'activity','the page switched in the click event, before the deferred hashchange');
 await page.getByRole('link',{name:'connections sensor',exact:true}).focus();await page.keyboard.press('Enter');await page.locator('section:visible .section-heading h2',{hasText:/^connections$/}).waitFor();
 assert.equal(new URL(page.url()).hash,'#/component/connections');assert.deepEqual(await page.locator('nav a[aria-current=page]').allTextContents(),['connectionssensor'],'keyboard activation selects only the connections component');
 assert.equal(await page.getByRole('heading',{name:'Connections',exact:true}).filter({visible:true}).count(),0,'the Connections page is not shown for the connections alias');
 await page.getByRole('link',{name:'Connections',exact:true}).click();await page.getByRole('heading',{name:'Connections',exact:true}).waitFor();assert.equal(new URL(page.url()).hash,'#/connections');
 assert.deepEqual(await page.locator('nav a[aria-current=page]').allTextContents(),['Connections']);
 const cards=await page.locator('.cards.two>.card').evaluateAll(all=>all.map(c=>c.getBoundingClientRect().toJSON()));assert.equal(cards.length,2);assert.ok(cards[1].left>cards[0].right,'the connection cards sit side by side at 1440');
 await page.screenshot({path:output+'/connections-desktop.png',fullPage:true});
 await page.goBack();await page.locator('section:visible .section-heading h2',{hasText:/^connections$/}).waitFor();assert.equal(new URL(page.url()).hash,'#/component/connections');
 await page.goBack();await page.locator('section:visible .section-heading h2',{hasText:/^activity$/}).waitFor();
 await page.goBack();await page.getByRole('heading',{name:'Home',exact:true}).waitFor();assert.equal(new URL(page.url()).hash,'');
 await page.evaluate(()=>{location.hash='#/component/nothing';});await page.getByRole('heading',{name:'No component named nothing',exact:true}).waitFor();
 await page.getByRole('link',{name:'Go to the home',exact:true}).click();await page.getByRole('heading',{name:'Home',exact:true}).waitFor();
 assert.equal(f.writes.length,0,'routing commands nothing');
 await page.getByLabel('Find a session').fill('no-match');await page.getByRole('heading',{name:'No matching sessions'}).waitFor();await page.getByLabel('Find a session').fill('');
 await page.getByRole('link',{name:'wall nanoleaf',exact:true}).click();await page.getByLabel('Device mode').first().waitFor();assert.deepEqual(await textOverlaps(page),[],'wall text never overlaps');
 assert.equal(f.writes.length,0,'opening/filtering/selecting does not command controllers');
 await page.getByRole('link',{name:'synthetic sensor',exact:true}).click();await page.locator('section:visible').getByText('Settings unavailable: this component has no supported integration extension.',{exact:true}).waitFor();assert.equal(await page.locator('section:visible').locator('select:not(:disabled),button:not(:disabled)').count(),0,'an undeclared component offers no enabled control');await page.locator('section:visible').getByText('No general controls: this controller declares no power, brightness, media or scenes.',{exact:true}).waitFor();assert.deepEqual(await textOverlaps(page),[],'synthetic text never overlaps');await page.getByRole('link',{name:'wall nanoleaf',exact:true}).click();
 await page.screenshot({path:output+'/component-desktop.png',fullPage:true});
 // Hub #277: at 1280 px wide the wall and pixel pages fit in under 2,000 px (the wall page was 3,624 px at ba08043), and their controls reach across the column at 1440 px.
 await page.setViewportSize({width:1280,height:900});const heights={};
 for(const [name,label,ready] of [['wall','wall nanoleaf','Device mode'],['pixel','pixel pixoo','Label / ID filter']]){await page.getByRole('link',{name:label,exact:true}).click();await page.getByLabel(ready).first().waitFor();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));heights[name]=await page.evaluate(()=>document.documentElement.scrollHeight);}
 assert.ok(heights.wall<2000,`wall page height ${heights.wall}`);assert.ok(heights.pixel<2000,`pixel page height ${heights.pixel}`);
 await page.setViewportSize({width:1440,height:1000});
 for(const [label,ready] of [['pixel pixoo','Label / ID filter'],['wall nanoleaf','Device mode']]){await page.getByRole('link',{name:label,exact:true}).click();await page.getByLabel(ready).first().waitFor();assert.ok(await controlReach(page)>=0.7,label+' fills the width');if(label==='pixel pixoo')await page.screenshot({path:output+'/component-pixel-desktop.png',fullPage:true});}
 const mode=page.getByLabel('Device mode').first();await mode.selectOption('Quiet');
 await page.locator('section:visible [role=status]').filter({hasText:/^(Queued\. The device hasn’t received it yet\.|Sent to the device\.)/}).first().waitFor();assert.equal(f.writes.length,1);assert.equal(f.writes[0].command.command.mode,'Quiet');
 await applyNano(()=>page.getByLabel('Layout style').selectOption('project'));await page.getByText('Saved. B.U.N.N.Y. can’t see the device, so check it to confirm.',{exact:true}).waitFor();
 assert.equal(f.writes[1].command.command.style,'project');
 await applyNano(()=>page.getByLabel('Signature').filter({visible:true}).selectOption('1'));await page.waitForFunction(()=>Array.from(document.querySelectorAll('[role=status]')).filter(x=>x.textContent==='Saved. B.U.N.N.Y. can’t see the device, so check it to confirm.').length>=2);assert.equal(f.nano.elements[0].projectId,f.nano.projects[0].id);await page.getByText('Current assignment: '+f.nano.projects[0].id+'; signature on.',{exact:true}).waitFor();
 await applyNano(()=>page.getByLabel('Task project').selectOption(f.nano.projects[0].id));assert.equal(await page.getByLabel('Task project').inputValue(),f.nano.projects[0].id);await page.waitForFunction(()=>Array.from(document.querySelectorAll('[role=status]')).filter(x=>x.textContent==='Saved. B.U.N.N.Y. can’t see the device, so check it to confirm.').length>=3);assert.equal(f.writes.find(x=>x.command.command?.kind==='task.assign')?.command.command.projectId,f.nano.projects[0].id,'submitted task mapping preserves chosen project');assert.equal(f.nano.tasks[0].overrideProjectId,f.nano.projects[0].id);await page.getByText('Current override: '+f.nano.projects[0].id+'; source project: '+f.nano.projects[0].id+'.',{exact:true}).waitFor();
 await page.getByLabel('Color project').selectOption(f.nano.projects[1].id);assert.equal(await page.locator('input[type=color]:visible').inputValue(),'#ff0000');await applyNano(()=>page.locator('input[type=color]:visible').fill('#112233'));await page.waitForFunction(()=>Array.from(document.querySelectorAll('[role=status]')).filter(x=>x.textContent==='Saved. B.U.N.N.Y. can’t see the device, so check it to confirm.').length>=4);assert.equal(f.nano.projects[1].color,'#112233');

 await page.getByRole('link',{name:'pixel pixoo',exact:true}).click();await page.getByLabel('Label / ID filter').waitFor();assert.deepEqual(await textOverlaps(page),[],'Pixoo text never overlaps');await page.getByLabel('Label / ID filter').fill('chosen');await page.getByLabel('Label / ID filter').press('Tab');await page.locator('section:visible').getByText('Saved. B.U.N.N.Y. can’t see the device, so check it to confirm.',{exact:true}).waitFor();assert.equal(f.pixoo.configuration.filter.q,'chosen');
 await page.getByRole('link',{name:/^Home/}).click();await page.locator('article.session details>summary').first().click();const label=page.getByLabel('Chosen label');await label.fill('My deliberate label');await label.focus();
 const before=f.writes.length;
 for(let i=0;i<5;i++){const start=performance.now();await f.event('session.started');timings.push(performance.now()-start);}
 await page.waitForTimeout(1500);assert.equal(await label.inputValue(),'My deliberate label');assert.equal(await label.evaluate(el=>el===document.activeElement),true);assert.equal(f.writes.length,before);
 const feedBefore=feedConnections;f.reconnect();await page.waitForTimeout(1800);assert.ok(feedConnections>feedBefore,'stream reconnects');assert.equal(await label.inputValue(),'My deliberate label');assert.equal(f.writes.length,before,'reconnect never replays writes');
 await label.press('Enter');await page.getByRole('heading',{name:'My deliberate label',exact:true}).waitFor();
 await page.screenshot({path:output+'/activity-desktop.png',fullPage:true});
 for(let i=0;i<10;i++){const start=performance.now();const result=await f.event('session.started');await page.waitForFunction(revision=>Number(document.getElementById('main').dataset.revision)>=revision,result.revision);renderTimings.push(performance.now()-start);}
 const a11y=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(a11y.violations.map(v=>({id:v.id,nodes:v.nodes.length})),[]);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:output+'/activity-mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile has no horizontal overflow');
 const mobile=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(mobile.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>`${n.target.join(' ')}: ${n.failureSummary}`)})),[]);
 await page.getByRole('link',{name:'wall nanoleaf',exact:true}).click();const concurrent={apiVersion:'1.0',controllerId:f.states.wall.identity.controllerId,deviceId:'wall',requestId:f.states.wall.nextRequestId,expectedConfigurationRevision:f.states.wall.configurationRevision,expectedGeneration:f.states.wall.generation,command:{kind:'mode.set',mode:'Work'}};const concurrentResult=await fetch(f.hub.url+'/api/controllers/v1/wall/commands',{method:'POST',headers:f.headers,body:JSON.stringify(concurrent)});assert.equal(concurrentResult.status,200);
 await page.waitForTimeout(5500);assert.equal(await page.getByLabel('Device mode').first().inputValue(),'Work','the control shows the other client’s change; there is no draft to keep');const beforeFree=f.writes.length;await page.getByLabel('Device mode').first().selectOption('Free');await page.locator('section:visible [role=status]').filter({hasText:/^(Queued\. The device hasn’t received it yet\.|Sent to the device\.)/}).first().waitFor();assert.equal(f.writes.length,beforeFree+1);assert.equal(f.writes.at(-1).command.command.mode,'Free');assert.equal(f.writes.at(-1).command.expectedConfigurationRevision,f.states.wall.configurationRevision-1,'the change carries the guards of a fresh read taken after the other client’s change');
 f.setOffline(true);await page.waitForTimeout(5500);await page.getByRole('link',{name:'pixel pixoo',exact:true}).click();await page.locator('section:visible').getByText('Stale / unavailable',{exact:true}).waitFor();
 f.setOffline(false);await page.waitForTimeout(5500);
 await page.getByRole('link',{name:'wall nanoleaf',exact:true}).click();f.setUncertain(true);const submitted=f.writes.length;await page.getByLabel('Device mode').first().selectOption('Quiet');await page.locator('section:visible').getByText('Result unknown: this may have reached the device',{exact:false}).waitFor();await page.waitForTimeout(5500);assert.equal(f.writes.length,submitted+1,'uncertain command is not retried');f.setUncertain(false);
 await page.getByRole('link',{name:/^Home/}).click();
 await f.event('question.continuing',{event:{kind:'question.continuing',attention:{status:'known',id:'question'}}});
 await f.event('attention.approval',{event:{kind:'attention.approval',attention:{status:'known',id:'approval'}}});
 await f.event('session.started',{identity:{...f.identity,sessionId:'child'},parent:{status:'known',identity:f.identity},label:{origin:'user',value:'Synthetic subagent'}});
 await page.getByRole('heading',{name:'Synthetic subagent',exact:true}).waitFor();await page.getByText('Question · continuing',{exact:true}).waitFor();await page.getByText('approval · blocked attention',{exact:true}).waitFor();
 assert.equal(await page.getByText('1 active / 0 uncertain',{exact:true}).count(),1);
 await f.event('turn.ended');await page.getByRole('heading',{name:'Retained notices',exact:true}).waitFor();
 const parent=page.locator('article.session').filter({has:page.getByRole('heading',{name:'My deliberate label',exact:true})});const ackWrites=f.writes.length;
 // An acknowledgment cannot be undone, so a keyboard step never commits on a pause: only Enter (or leaving the select) sends it.
 const ack=parent.getByLabel('Acknowledge for');await ack.focus();await page.keyboard.press('ArrowDown');await page.waitForTimeout(500);assert.equal(await ack.inputValue(),'dashboard');await parent.getByText('Acknowledged by: none.',{exact:false}).waitFor();
 await page.keyboard.press('Enter');await parent.getByText('Acknowledged by: dashboard.',{exact:false}).waitFor();assert.equal(f.writes.length,ackWrites,'monitor acknowledgment never commands a device');
 const snapshot=await (await fetch(f.hub.url+'/api/monitor/v1/sessions',{headers:f.headers})).json();assert.equal(snapshot.snapshot.sessions.find(x=>x.identity.sessionId==='task-one').read,'unknown','acknowledgment cannot mark provider read');
 await page.screenshot({path:output+'/activity-evidence.png',fullPage:true});
 await page.getByRole('button',{name:'Disconnect',exact:true}).click();await page.getByText('Use a separately provisioned access token').click();await page.getByLabel('Hub browser access token').fill(f.reader);await page.getByRole('button',{name:'Connect',exact:true}).click();await page.getByRole('heading',{name:'My deliberate label',exact:true}).waitFor();await page.getByRole('link',{name:'wall nanoleaf',exact:true}).click();await page.getByText('Unavailable: Your credential is read-only',{exact:true}).first().waitFor();
 assert.equal(await page.locator('section:visible [role=status]').filter({hasText:'Result unknown'}).count(),0,'the previous session’s uncertain lock does not show in the next session');assert.equal(await page.locator('section:visible').getByRole('button',{name:'Reload current values',exact:true}).count(),0);assert.equal(await page.getByLabel('Device mode').first().isDisabled(),true);
 await page.keyboard.press('Tab');assert.ok(await page.evaluate(()=>document.activeElement!==document.body),'keyboard focus remains reachable');
 assert.deepEqual(errors,[]);
 await writeFile(output+'/receipt.json',JSON.stringify({synthetic:true,physical:false,tests:'browser controls, no-write inspection, draft/focus, conflict, offline, desktop/mobile axe',ingestRoundTripMs:timings,eventToRenderedSnapshotMs:renderTimings,feedConnections,a11yViolations:0,pageHeightsAt1280:heights},null,2));
 console.log(JSON.stringify({passed:true,output,writes:f.writes.length,ingestRoundTripMs:timings}));
}catch(error){console.error(await page.locator('section:visible').innerText());throw error;}finally{await page.close();await browser.close();await f.close();}
