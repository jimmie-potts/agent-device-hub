// Runs only after the outside supervisor acquires our namespace-init pidfd.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer,request} from 'node:http';
import {connect} from 'node:net';
import {createHash} from 'node:crypto';
import {mkdir,writeFile,readFile,access} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {performance} from 'node:perf_hooks';
import {evaluate,targets,writeReport} from './standalone-report.mjs';
console.log('{"ready":true}');
await new Promise(resolve=>process.stdin.once('data',bytes=>{assert.equal(bytes.toString(),'1');resolve();}));
const report={formatVersion:1,profiles:[],scenarios:{},failures:[],allHookMs:[],peakHubRssMiB:0,observations:{},
 boundaries:{hook:'Driver monotonic spawn through process close, including stdin and admission.',receipt:'Driver monotonic forwarding-start through real consumer projection reply; conservative proxy and IPC overhead included.',polling:'Nanoleaf real Poller one-second cadence; Pixoo facade refresh once per second. Driver inspects at 25 ms intervals.',p99:'Not reported: 200 warm samples per profile are not enough for tail qualification.',physical:false,installedClient:false}};
const env={PATH:'/usr/bin',HOME:'/tmp',TMPDIR:'/tmp',NODE_NO_WARNINGS:'1'},children=new Set(),servers=[];
let hub,nano,pixoo,presentation,browser,context,page,stalled,hubUrl,nanoOffline=false,lastPixoo=0,sequence=0;
const token='q'.repeat(43),headers={authorization:'Bearer '+token,'content-type':'application/json','x-pixoo-request':'1'};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const bounded=async(p,ms=5000)=>{let t;try{return await Promise.race([p,new Promise((_,reject)=>{t=setTimeout(()=>reject(new Error('operation-timeout')),ms);})]);}finally{clearTimeout(t);}};
function child(exe,args){
 const c=spawn(exe,args,{env,stdio:['pipe','pipe','pipe']});children.add(c);
 const lines=[],pending=[];let size=0,stderr='';
 const exited=new Promise(resolve=>{c.once('error',()=>resolve({code:null,error:true}));c.once('close',(code,signal)=>{children.delete(c);while(pending.length)pending.shift().reject(new Error('child-exited'));resolve({code,signal});});});
 c.stderr.on('data',b=>{stderr+=b;if(stderr.length>65536)c.kill('SIGKILL');});
 const rl=createInterface({input:c.stdout});rl.on('line',line=>{size+=line.length;if(size>64_000_000){c.kill('SIGKILL');return;}let value;try{value=JSON.parse(line);}catch{c.kill('SIGKILL');return;}if(pending.length)pending.shift().resolve(value);else lines.push(value);});
 const next=()=>bounded(lines.length?Promise.resolve(lines.shift()):new Promise((resolve,reject)=>pending.push({resolve,reject})));
 return {c,exited,next,stderr:()=>stderr,call:async value=>{c.stdin.write(JSON.stringify(value)+'\n');return next();},stop:async()=>{c.kill('SIGTERM');return bounded(exited);}};
}
async function json(url,path='/api/monitor/v1/sessions',body){const r=await fetch(url+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(3000)});assert.equal(r.status,200,'HTTP '+path);return r.json();}
const admissions=new Map();
async function proxy(nanoleaf=false){
 const server=createServer(async(req,res)=>{
  if(nanoleaf&&nanoOffline){req.resume();res.writeHead(503);res.end('{}');return;}
  const parts=[];let bytes=0;for await(const part of req){bytes+=part.length;if(bytes>65536){res.writeHead(413);res.end();return;}parts.push(part);}
  const body=Buffer.concat(parts);
  if(req.url==='/api/monitor/v1/events'){
   const e=JSON.parse(body);admissions.set(e.identity.sessionId+'|'+e.turn.id,{started:performance.now(),observedAtMs:e.observedAtMs,status:null,revision:null});
  }
  const outgoing=request(hubUrl+req.url,{method:req.method,headers:{...req.headers,host:new URL(hubUrl).host}},response=>{
   const output=[];response.on('data',chunk=>output.push(chunk));response.on('end',()=>{
    const data=Buffer.concat(output);
    if(req.url==='/api/monitor/v1/events'){const e=JSON.parse(body),a=admissions.get(e.identity.sessionId+'|'+e.turn.id);a.status=response.statusCode;try{a.revision=JSON.parse(data).revision;}catch{}}
    res.writeHead(response.statusCode,{'content-type':'application/json'});res.end(data);
   });
  });outgoing.setTimeout(2900,()=>outgoing.destroy());outgoing.on('error',()=>{res.writeHead(503);res.end('{}');});outgoing.end(body);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));servers.push(server);return 'http://127.0.0.1:'+server.address().port;
}
// A browser-only streaming gateway can sever its feed without disturbing consumers.
async function browserGateway(){
 let offline=false,connections=0;const feeds=new Set();
 const server=createServer((req,res)=>{
  if(offline){req.resume();res.writeHead(503);res.end();return;}
  const forwarded={...req.headers,host:new URL(hubUrl).host};
  if(forwarded.origin)forwarded.origin=hubUrl;
  const upstream=request(hubUrl+req.url,{method:req.method,headers:forwarded},response=>{
   res.writeHead(response.statusCode,response.headers);response.pipe(res);
   if(req.url==='/api/monitor/v1/changes'){connections++;feeds.add(res);res.once('close',()=>feeds.delete(res));}
  });
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(503);res.end();});
  res.once('close',()=>upstream.destroy());req.pipe(upstream);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));servers.push(server);
 return {url:'http://127.0.0.1:'+server.address().port,connections:()=>connections,
  disconnect(){offline=true;for(const res of feeds)res.destroy();},reconnect(){offline=false;}};
}
async function rss(){if(!hub)return;try{const s=await readFile('/proc/'+hub.c.pid+'/status','utf8');report.peakHubRssMiB=Math.max(report.peakHubRssMiB,Number(/^VmHWM:\s+(\d+)/m.exec(s)?.[1])/1024);}catch{}}
async function start(){const start=performance.now();hub=child('/node',['/runtime/hub/apps/hub/dist/cli.js','serve','/state/hub.json']);const value=await hub.next();assert.equal(value.ready,true);hubUrl=value.url;const ms=performance.now()-start;assert(ms<=targets.readinessMs);return ms;}
async function hook(session,turn,kind='UserPromptSubmit',config='/state/producer.json',holdInput=false){
 const started=performance.now(),c=spawn('/node',['/runtime/hub/apps/hub/bin/monitor-hook.mjs',config],{env,stdio:['pipe','pipe','pipe']});children.add(c);let output='';c.stdout.on('data',b=>output+=b);c.stderr.on('data',b=>output+=b);
 const exited=new Promise((resolve,reject)=>{c.once('error',reject);c.once('close',(code,signal)=>{children.delete(c);resolve({code,signal});});});
 if(!holdInput)c.stdin.end(JSON.stringify({hook_event_name:kind,session_id:session,turn_id:turn,prompt:'PRIVATE_CANARY'}));
 try{const result=await bounded(exited,3200);const ms=performance.now()-started;report.allHookMs.push(ms);assert.equal(result.code,0);assert.equal(result.signal,null);assert.equal(output,'');assert(ms<=targets.hardHookMs,'hard-hook-deadline');return {session,turn,hookMs:ms};}
 finally{c.stdin.destroy();if(c.exitCode===null&&c.signalCode===null){c.kill('SIGKILL');await exited;}}
}
async function receive(events,{nanoRequired=true}={}){
 const deadline=performance.now()+5000,records=events.map(e=>({...e}));let nv,pv;
 while(performance.now()<deadline){
  if(performance.now()-lastPixoo>=1000){await pixoo.refresh();lastPixoo=performance.now();}
  pv=pixoo.view();presentation.submit(pv);nv=await nano.call({operation:'poll'});assert(!nv.error,'nanoleaf-poll');
  for(const e of records){const a=admissions.get(e.session+'|'+e.turn);e.admissionRevision=a?.revision;e.observedAtMs=a?.observedAtMs;assert(a&&a.status===200&&Number.isInteger(a.revision),'event-not-admitted');
   if(e.pixooMs===undefined&&pv.connection==='current'&&pv.snapshot?.revision>=a.revision&&pv.snapshot?.sessions.some(s=>s.identity.sessionId===e.session&&s.observedAtMs===a.observedAtMs))e.pixooMs=performance.now()-a.started;
   if(e.nanoleafMs===undefined&&nv.view.connection==='current'&&nv.snapshot?.revision>=a.revision&&nv.snapshot?.sessions.some(s=>s.identity.sessionId===e.session&&s.observedAtMs===a.observedAtMs))e.nanoleafMs=performance.now()-a.started;
  }
  if(records.every(e=>e.pixooMs!==undefined&&(!nanoRequired||e.nanoleafMs!==undefined))){await rss();return {records,nv,pv};}
  await wait(25);
 }
 report.observations.receiptTimeout={wanted:events,pixoo:pv,nanoleaf:nv};throw new Error('consumer-receipt-timeout');
}
async function batch(tasks){const n=sequence++;const events=await Promise.all(Array.from({length:tasks},(_,i)=>hook('task-'+i,'turn-'+n)));return receive(events);}
async function scenario(name,run){try{await run();report.scenarios[name]=true;}catch(e){report.scenarios[name]=false;report.failures.push(name+':'+e.message);throw e;}}
try{
 await scenario('confinement',async()=>{
  for(const p of ['/home/jimmie','/mnt/c','/run/user'])await assert.rejects(access(p));
  await assert.rejects(new Promise((resolve,reject)=>{const socket=connect({host:'192.0.2.1',port:80});socket.setTimeout(100,()=>socket.destroy(new Error('no-external-route')));socket.once('connect',()=>{socket.destroy();resolve();});socket.once('error',reject);}));
  report.observations.netNamespace=await readFile('/proc/net/route','utf8');
 });
 await mkdir('/state/hub',{mode:0o700});
 const {startPixoo}=await import('./standalone-pixoo.mjs');presentation=await startPixoo();
 const options={directory:'/state/hub',ownerId:'qualification',consumers:[{id:'pixoo',clearOnNewTurn:true},{id:'nanoleaf',clearOnNewTurn:true},{id:'stalled',clearOnNewTurn:true}],controllers:[presentation.config],port:0,credentials:[{id:'qualification',digest:createHash('sha256').update(token).digest('hex'),scopes:['read','ingest','control'],devices:['pixoo']}]};
 await writeFile('/state/hub.json',JSON.stringify(options),{mode:0o600});
 await scenario('startup',async()=>{report.observations.startupMs=await start();});
 options.port=Number(new URL(hubUrl).port);await writeFile('/state/hub.json',JSON.stringify(options),{mode:0o600});
 const endpoint=await proxy(),nanoEndpoint=await proxy(true);
 await writeFile('/state/producer.json',JSON.stringify({enabled:true,qualified:true,endpoint:endpoint+'/api/monitor/v1/events',source:{provider:'codex',client:'cli',hostId:'synthetic',sourceId:'qualification',hook:'UserPromptSubmit'},token}),{mode:0o600});
 const {createSessionSource}=await import('/runtime/pixoo/apps/server/dist/monitor-source.js');
 const {DashboardPager}=await import('/runtime/pixoo/apps/server/dist/agent-dashboard.js');
 pixoo=await createSessionSource('/state/pixoo',{version:1,mode:'remote',ownerId:'qualification',endpoint:hubUrl+'/api/monitor/v1',token});
 nano=child('/usr/bin/python3',['-B','/runtime/hub/scripts/performance/standalone-nanoleaf.py']);assert.equal((await nano.next()).ready,true);
 const configured=await nano.call({operation:'configure',endpoint:nanoEndpoint+'/api/monitor/v1',token});assert(!configured.error,JSON.stringify(configured));
 report.observations.firstCall=(await batch(1)).records[0];
 for(const tasks of [1,10]){const profile={tasks,samples:[]};report.profiles.push(profile);for(let i=0;i<(process.argv.includes('--smoke')?20:targets.samples)/tasks;i++)profile.samples.push(...(await batch(tasks)).records);}
 await scenario('burst',async()=>{
  const events=await Promise.all(Array.from({length:50},(_,i)=>hook('burst-'+i,'burst')));
  const admitted=events.filter(e=>admissions.get(e.session+'|'+e.turn)?.status===200);
  const rejected=events.filter(e=>!admitted.includes(e));
  assert(rejected.every(e=>[429,503].includes(admissions.get(e.session+'|'+e.turn)?.status)));
  if(admitted.length)await receive(admitted);
  const snapshot=await json(hubUrl);report.observations.burst={sent:50,admitted:admitted.length,rejected:rejected.length,reportedRejected:snapshot.admissionRejected,lossCount:snapshot.snapshot.lossCount};
  assert(snapshot.admissionRejected>=rejected.length);assert(new DashboardPager('pixoo').layout(pixoo.view(),Date.now()).rows.length<=8);
 });
 await scenario('stalledConsumer',async()=>{
  stalled=await new Promise((resolve,reject)=>{const req=request(hubUrl+'/api/monitor/v1/changes',{headers},res=>{res.pause();resolve({req,res});});req.on('error',reject);req.end();});
  await batch(10);stalled.res.destroy();stalled.req.destroy();stalled=null;
  const r=await fetch(hubUrl+'/api/monitor/v1/changes',{headers:{...headers,'last-event-id':'expired:0'},signal:AbortSignal.timeout(3000)});const reader=r.body.getReader();assert(new TextDecoder().decode((await reader.read()).value).includes('event: resync'));await reader.cancel();report.observations.stalled='Paused SSE reader did not delay either real consumer; expired cursor received resync.';
 });
 await scenario('offlineConsumer',async()=>{
  nanoOffline=true;await wait(1100);const before=await nano.call({operation:'poll'});assert.equal(before.view.connection,'stale');
  const e=await hook('offline','turn-offline');await receive([e],{nanoRequired:false});
  nanoOffline=false;const begin=performance.now();await receive([e]);report.observations.consumerRecoveryMs=performance.now()-begin;assert(report.observations.consumerRecoveryMs<=5000);
 });
 await scenario('dashboard',async()=>{
  const {chromium}=await import('playwright');browser=await chromium.launch({executablePath:'/browser/chrome-headless-shell',headless:true,args:['--no-sandbox']});context=await browser.newContext();page=await context.newPage();page.setDefaultTimeout(5000);
  const gateway=await browserGateway();await page.goto(gateway.url);await page.getByText('Use a separately provisioned access token').click();await page.getByLabel('Hub browser access token').fill(token);await page.getByRole('button',{name:'Connect',exact:true}).click();await page.getByRole('heading',{name:'Your work, at a glance.'}).waitFor();
  await batch(10);await page.getByRole('button',{name:'Connections',exact:true}).click();
  const facts=page.locator('section:visible');await facts.getByText('Connected',{exact:true}).waitFor();
  const before=gateway.connections();assert(before>0);gateway.disconnect();
  await facts.getByText('Reconnecting',{exact:true}).waitFor();
  const event=await hook('dashboard-reconnect','turn-reconnect');await receive([event]);
  const expected=admissions.get(event.session+'|'+event.turn).revision;
  const begin=performance.now();gateway.reconnect();
  await facts.getByText('Connected',{exact:true}).waitFor();
  await page.waitForFunction(revision=>Number(document.querySelector('#main')?.getAttribute('data-revision'))>=revision,expected);
  const recoveryMs=performance.now()-begin;assert(recoveryMs<=targets.readinessMs);assert(gateway.connections()>before);
  report.observations.dashboardReconnect={observedDisconnected:true,connectionsBefore:before,connectionsAfter:gateway.connections(),postOutageRevision:expected,receivedRevision:Number(await page.locator('#main').getAttribute('data-revision')),recoveryMs};
  await page.getByRole('button',{name:/^Activity/}).click();
 });
 await scenario('control',async()=>{
  const before=await json(hubUrl,'/api/controllers/v1/pixoo/integration/snapshot');
  const ingestion=batch(10);
  const changed=await json(hubUrl,'/api/controllers/v1/pixoo/integration/commands',{apiVersion:before.apiVersion,controllerId:'qualification-pixoo',deviceId:'pixoo-local',requestId:before.nextRequestId,expectedConfigurationRevision:before.configurationRevision,expectedGeneration:before.generation,action:{operation:'view',filter:{provider:'codex'},cadenceMs:1000}});
  await ingestion;assert.equal(changed.configuration.filter.provider,'codex');assert(changed.configurationRevision>before.configurationRevision);
  report.observations.integrationControl='Hub routed a guarded monitor filter change to the real Pixoo controller, ControlService and MonitorPresentation while both consumers received ten events.';
  assert(presentation.frames()>0);report.observations.fakePixooFrames=presentation.frames();
  assert((await nano.call({operation:'poll'})).activity.length>0);

  await page.getByLabel('Find a session').fill('task-0');const label=page.getByLabel('Chosen label').filter({visible:true}).first();await label.fill('Qualification label');
  const concurrent=batch(1);await page.getByRole('button',{name:'Apply label',exact:true}).filter({visible:true}).first().click();await concurrent;
  const deadline=performance.now()+5000;while(performance.now()<deadline){if((await json(hubUrl)).snapshot.sessions.some(s=>s.label==='Qualification label'))return;await wait(50);}throw new Error('label-not-retained');
 });
 await page.close();await browser.close();browser=null;
 const ended=await hook('task-0','turn-notice','Stop');await receive([ended]);
 const beforeRestart=await json(hubUrl);assert(beforeRestart.snapshot.sessions.some(s=>s.notices.length));
 await scenario('exclusiveOwner',async()=>{const other=child('/node',['/runtime/hub/apps/hub/dist/cli.js','serve','/state/hub.json']);const outcome=await bounded(other.exited);assert.equal(outcome.code,1);assert(other.stderr().includes('hub-start-failed'));});
 await scenario('hostOutage',async()=>{
  await rss();assert.equal((await hub.stop()).code,0);hub=null;
  const config=JSON.parse(await readFile('/state/producer.json','utf8'));config.endpoint=hubUrl+'/api/monitor/v1/events';await writeFile('/state/offline-producer.json',JSON.stringify(config),{mode:0o600});
  await hook('outage','turn','UserPromptSubmit','/state/offline-producer.json');await hook('hung-input','turn','UserPromptSubmit','/state/offline-producer.json',true);
  await pixoo.refresh();assert.equal(pixoo.view().connection,'stale');await wait(1100);assert.equal((await nano.call({operation:'poll'})).view.connection,'stale');
 });
 await scenario('restart',async()=>{
  const begin=performance.now();await start();const view=await json(hubUrl);assert(view.snapshot.revision>=beforeRestart.snapshot.revision);
  assert(view.snapshot.sessions.some(s=>s.label==='Qualification label'));assert(view.snapshot.sessions.some(s=>s.notices.length));
  await pixoo.refresh();await wait(1100);const n=await nano.call({operation:'poll'});assert.equal(n.view.connection,'current');assert.equal(pixoo.view().connection,'current');
  report.observations.restartMs=performance.now()-begin;assert(report.observations.restartMs<=5000);
 });
 await scenario('noReplay',async()=>{
  const a=await nano.call({operation:'poll'});await wait(1100);const b=await nano.call({operation:'poll'});assert.equal(a.comets,0);assert.equal(b.comets,0);assert.deepEqual(a.activity,b.activity);
  const pager=new DashboardPager('pixoo');const one=pager.layout(pixoo.view(),Date.now());await pixoo.refresh();const two=pager.layout(pixoo.view(),Date.now());assert.equal(one.revision,two.revision);report.observations.noReplay='Nanoleaf reconnect leaves no comets and preserves activity epochs; Pixoo projects the same current revision. Existing presentation regressions cover physical-writer seams separately.';
 });
 await rss();assert(!JSON.stringify(await json(hubUrl)).includes('PRIVATE_CANARY'));
}catch(error){report.failures.push('run:'+error.message);}
finally{
 if(stalled){stalled.res.destroy();stalled.req.destroy();}
 await presentation?.close().catch(()=>{report.failures.push('pixoo-presentation-cleanup');});
 await browser?.close().catch(()=>{});await pixoo?.close().catch(()=>{});await rss();
 if(hub)await hub.stop().catch(()=>{report.failures.push('hub-cleanup');});
 if(nano)await nano.stop().catch(()=>{report.failures.push('nanoleaf-cleanup');});
 for(const s of servers){s.closeAllConnections();await new Promise(r=>s.close(r));}
 for(const c of children)c.kill('SIGKILL');
 report.evaluation=evaluate(report);await writeReport(report);
 process.exit(report.evaluation.qualified?0:1);
}
