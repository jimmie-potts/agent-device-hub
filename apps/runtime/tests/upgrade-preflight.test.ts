import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {test} from 'node:test';
const run = promisify(execFile);

void test('composed upgrade preflight binds original observations and the exact locked plan', async t => {
  const root = await mkdtemp(join(tmpdir(), 'bunny-upgrade-preflight-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const script = `import {createRuntimeUpgradePreflight} from './apps/runtime/bin/runtime-upgrade-preflight.mjs';
import {parseUpgradeRequest} from './apps/runtime/dist/src/upgrade-paths.js';
import {canonical,sha256} from './apps/hub/dist/install/files.js';
import {readPrivateFile} from './apps/runtime/dist/src/state.js';
import {MODULE_API_VERSION} from '@jimmie-potts/sdk';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const [root,scenario]=process.argv.slice(1); const requestFile=join(root,'request-'+scenario+'.json');
const release={kind:'release',sourceRevision:'a'.repeat(40),version:'0.1.0',archiveSha256:'b'.repeat(64),manifestSha256:'c'.repeat(64)};
const artifact={identity:join(root,'identity'),directory:join(root,'releases',release.sourceRevision),archive:join(root,'archive')};
const request={schema:'runtime-upgrade-request/1.0',operation:scenario==='upgrade'?'upgrade':'adoption',installationId:'synthetic',installationRoot:root,
 tokenFile:join(root,'existing-read-token'),admissionFile:join(root,'provenance/admission'),installedBaselineClosureFile:join(root,'provenance/closure'),
 qualificationRevision:release.sourceRevision,releases:{previous:artifact,target:artifact,recovery:artifact},formatInventoryFiles:{previous:join(root,'p'),target:join(root,'t'),recovery:join(root,'r'),qualification:join(root,'q')},
 execution:{operationId:'synthetic',backupDirectory:join(root,'backups/synthetic'),stopTimeoutMs:30000,
 postStart:{attempts:5,timeoutMs:15000,intervalMs:500},startupEffects:{assessment:{path:join(root,'provenance/effects'),sha256:'a'.repeat(64)},authority:{path:join(root,'provenance/authority'),sha256:'b'.repeat(64)}},
 adoption:scenario==='upgrade'?null:{draftFile:join(root,'provenance/draft'),overrideFile:join(root,'unit.d/anchor.conf'),originals:[{path:join(root,'provenance/original'),sha256:'c'.repeat(64)}],restoration:{path:join(root,'provenance/restoration'),sha256:'d'.repeat(64)}}}};
if(scenario==='unknown-field') request.observations={passed:true};
await writeFile(requestFile,JSON.stringify(request),{mode:0o600});
const owner={service:'bunny-runtime.service',pid:123,startTicks:'100',options:{port:8788,stateDir:join(root,'state'),config:join(root,'config'),edge:true,simulate:false,environment:'production',lagLimitMs:10000}};
const listener={pid:123,inode:'socket-1'};
const stamp={schema:'runtime-build/2.0',revision:release.sourceRevision,version:'0.1.0',dirty:false,builtAt:'2026-10-09T00:00:00.000Z'};
const source={expected:{installationId:'synthetic',provenanceDirectory:join(root,'provenance'),releases:{previous:release,target:release,recovery:release},formats:{}},
 stamps:{previous:stamp,target:stamp,recovery:stamp},inputs:[],artifacts:{previous:{identity:release,root:artifact.directory,entries:[]},target:{root:artifact.directory},recovery:{root:artifact.directory}}};
const admission={schema:'runtime-proof-admission/1.0',admissionSha256:'d'.repeat(64),installedBaselineClosure:{path:request.installedBaselineClosureFile,sha256:'e'.repeat(64)}};
const configured=['codex-desktop','lifx','nanoleaf','pixoo','playback','tidbyt'];
const health={schema:'runtime-health/1.0',status:'degraded',moduleApiVersion:MODULE_API_VERSION,startedAtMs:1000,lagCheck:{status:'active',limitMs:10000},
 modules:[...['core',...configured].map(name=>({name,apiVersion:MODULE_API_VERSION,state:'running',healthy:true,reasonCode:null})),{name:'wispr',apiVersion:MODULE_API_VERSION,state:'refused',healthy:false,reasonCode:'not-found'}].sort((a,b)=>a.name.localeCompare(b.name))};
if(scenario.startsWith('bb8-') || scenario==='configured-bb8') {
 health.modules.push({name:'bb8',apiVersion:MODULE_API_VERSION,state:scenario==='bb8-running'?'running':'refused',healthy:scenario==='bb8-healthy',reasonCode:scenario==='bb8-wrong-reason'?'unavailable':'not-found'});
 if(scenario==='bb8-wrong-status') health.status='ok';
 if(scenario==='configured-bb8') configured.push('bb8');
}
if(scenario.startsWith('roborock-') || scenario==='configured-roborock') {
 health.modules.push({name:'roborock',apiVersion:MODULE_API_VERSION,state:scenario==='roborock-running'?'running':'refused',healthy:scenario==='roborock-healthy',reasonCode:scenario==='roborock-wrong-reason'?'unavailable':'not-found'});
 if(scenario==='roborock-wrong-status') health.status='ok';
 if(scenario==='configured-roborock') configured.push('roborock');
}
if(scenario==='configured-refusal') {health.modules.find(row=>row.name==='pixoo').state='refused';health.modules.find(row=>row.name==='pixoo').healthy=false;}
if(scenario==='unknown-module') health.modules.push({name:'onn',apiVersion:MODULE_API_VERSION,state:'refused',healthy:false,reasonCode:'not-found'});
if(scenario==='stopped-watchdog') health.lagCheck.status='stopped';
if(scenario==='configured-wispr') configured.push('wispr');
await writeFile(owner.options.config,JSON.stringify({edge:{credentials:join(root,'credentials')},modules:{}}),{mode:0o600});
await writeFile(request.tokenFile,'synthetic-secret-never-public',{mode:0o600});
await writeFile(join(root,'credentials'),'synthetic credential inventory',{mode:0o600});
const configSha256=sha256(await readPrivateFile(owner.options.config,1024*1024));
const credentialsSha256=sha256(await readPrivateFile(join(root,'credentials'),65536));
const state={configSha256,configured,durableOwners:['core','lifx','nanoleaf','pixoo','playback','tidbyt']};
const counters={owner:0,listener:0,source:0,admission:0,baseline:0,paths:0,hooks:0,state:0,receipts:0,http:0,lock:0,execution:0}; let afterHttp=false; const observations=[];
const drift=(name,count)=>scenario===name+'-drift'&&count>1||scenario==='late-'+name+'-drift'&&counters.http>1;
const io={privateFile:readPrivateFile,parseRequest:parseUpgradeRequest,canonical,sha256,
 execution:async()=>{counters.execution++;return drift('execution',counters.execution)?{...request.execution,stopTimeoutMs:10000}:request.execution;},
 lock:async()=>{counters.lock++;if(scenario==='missing-lock') throw new Error('missing');},
 owner:async()=>{counters.owner++;return scenario==='owner-drift'&&afterHttp?{...owner,pid:124}:owner;},
 listener:async()=>{counters.listener++;return scenario==='listener-drift'&&afterHttp?{...listener,inode:'socket-2'}:listener;},
 source:async()=>{counters.source++;return drift('source',counters.source)?{...source,inputs:[{changed:true}]}:source;},
 admission:async()=>{counters.admission++;return drift('admission',counters.admission)?{...admission,admissionSha256:'0'.repeat(64)}:admission;},
 baseline:async()=>{counters.baseline++;return {baselineRoot:drift('baseline',counters.baseline)?join(root,'changed-baseline'):artifact.directory,closureSha256:admission.installedBaselineClosure.sha256};},
 config:async()=>({edge:{credentials:join(root,'credentials')},modules:{}}),paths:async()=>{counters.paths++;return {selection:{kind:drift('paths',counters.paths)?'changed':request.operation==='adoption'?'absent':'previous'}};},
 hooks:async()=>{counters.hooks++;return {closureSha256:admission.installedBaselineClosure.sha256,hooks:drift('hook',counters.hooks)?[{changed:true}]:[]};},
 state:async()=>{counters.state++;if(scenario==='request-drift'&&counters.state>1) await writeFile(requestFile,JSON.stringify({...request,tokenFile:join(root,'changed-token')}));return drift('state',counters.state)?{...state,durableOwners:[...state.durableOwners,'unknown']}:state;},
 receipts:async()=>{counters.receipts++;return drift('receipt',counters.receipts)?[{name:'new.json',sha256:'0'.repeat(64)}]:[];},
 http:async(observed,token,expected,recheck,context)=>{observations.push(context);counters.http++;if(token!==request.tokenFile) throw new Error('wrong token selection');await recheck();afterHttp=true;
 if(counters.http>1&&scenario==='token-drift') await writeFile(request.tokenFile,'changed synthetic secret');
 if(counters.http>1&&scenario==='credentials-drift') await writeFile(join(root,'credentials'),'changed synthetic inventory');
 if(counters.http>1&&scenario==='config-drift') await writeFile(owner.options.config,JSON.stringify({changed:true}));
 const result={build:stamp,health,configSha256:state.configSha256,credentialsSha256};
 if(scenario==='health-drift'&&counters.http>1) return {...result,health:{...health,lagCheck:{status:'stopped',limitMs:10000}}};return result;}};
const preflight=createRuntimeUpgradePreflight(io);
try {let plan;
 if(['locked','wrong-plan','missing-lock'].includes(scenario)) {plan=await preflight(requestFile);const approved=join(root,'approved-'+scenario+'.json');await writeFile(approved,JSON.stringify(scenario==='wrong-plan'?{...plan,planSha256:'0'.repeat(64)}:plan),{mode:0o600});plan=await preflight(requestFile,approved);}
 else plan=await preflight(requestFile);
 process.stdout.write(JSON.stringify({plan,counters,observations}));}
catch(error){process.stdout.write(JSON.stringify({code:error.message,counters}));process.exitCode=2;}`;
  const inspect = (scenario: string) => run(process.execPath, ['--input-type=module', '-e', script, root, scenario], {cwd: process.cwd(), timeout: 10000});
  const first = JSON.parse((await inspect('adoption')).stdout) as {plan: {operation: string; planSha256: string}; counters: {http: number; lock: number}; observations: {operationId: string; trace: {traceparent: string}}[]};
  assert.ok(!(await inspect('adoption')).stdout.includes('synthetic-secret-never-public'));
  assert.equal((JSON.parse((await inspect('bb8-absent')).stdout) as {plan: {operation: string}}).plan.operation, 'adoption');
  assert.equal((JSON.parse((await inspect('roborock-absent')).stdout) as {plan: {operation: string}}).plan.operation, 'adoption');
  assert.equal(first.plan.operation, 'adoption'); assert.match(first.plan.planSha256, /^[0-9a-f]{64}$/);
  assert.equal(first.counters.http, 2); assert.equal(first.counters.lock, 0);
  assert.equal(first.observations.length, 2);
  assert.deepEqual(first.observations[0], first.observations[1]);
  assert.equal(first.observations[0]?.operationId, 'synthetic');
  assert.match(first.observations[0]?.trace.traceparent ?? '', /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  assert.ok(!JSON.stringify(first.plan).includes('traceparent'));
  const repeated = JSON.parse((await inspect('adoption')).stdout) as typeof first;
  assert.equal(first.plan.planSha256, repeated.plan.planSha256);
  assert.notEqual(first.observations[0]?.trace.traceparent, repeated.observations[0]?.trace.traceparent);
  assert.equal((JSON.parse((await inspect('upgrade')).stdout) as {plan: {operation: string}}).plan.operation, 'upgrade');
  assert.equal((JSON.parse((await inspect('locked')).stdout) as {counters: {lock: number}}).counters.lock, 2);
  for (const scenario of ['unknown-field','execution-drift','late-execution-drift','owner-drift','listener-drift','source-drift','admission-drift','baseline-drift','paths-drift','hook-drift','state-drift','receipt-drift','request-drift',
    'late-source-drift','late-admission-drift','late-baseline-drift','late-paths-drift','late-hook-drift','late-state-drift','late-receipt-drift','token-drift','credentials-drift','config-drift','configured-refusal','unknown-module','configured-wispr','configured-bb8','bb8-running','bb8-healthy','bb8-wrong-reason','bb8-wrong-status','configured-roborock','roborock-running','roborock-healthy','roborock-wrong-reason','roborock-wrong-status','stopped-watchdog','health-drift','wrong-plan','missing-lock']) {
    await t.test(scenario + ' refuses', async () => {
      await assert.rejects(inspect(scenario), (error: unknown) => {
        const result = JSON.parse((error as {stdout: string}).stdout) as {code: string; counters: {owner: number; http: number; lock: number}};
        assert.equal(result.code, 'runtime-upgrade-preflight-refused');
        if (scenario === 'unknown-field') assert.equal(result.counters.owner, 0);
        if (scenario === 'missing-lock') {assert.equal(result.counters.http, 2);assert.equal(result.counters.lock, 1);}
        return true;
      });
    });
  }
});

void test('production preflight CLI rejects unknown request fields before installed observation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'bunny-upgrade-preflight-cli-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const {writeFile} = await import('node:fs/promises'); const input = join(root, 'request.json');
  await writeFile(input, JSON.stringify({observations: {passed: true}}), {mode: 0o600});
  await assert.rejects(run(process.execPath, ['apps/runtime/bin/runtime-upgrade-check.mjs', 'plan', input], {cwd: process.cwd(), timeout: 10000}), (error: unknown) => {
    const value = error as {stdout: string; stderr: string};
    assert.equal(value.stdout, '');
    assert.deepEqual(JSON.parse(value.stderr), {code: 'runtime-upgrade-preflight-refused', verified: false});
    assert.ok(!value.stderr.includes(input)); return true;
  });
});

void test('post-start observation binds the selected release and refuses drift without service effects', async t => {
  const root = await mkdtemp(join(tmpdir(), 'bunny-running-check-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const script = `import {createRuntimeUpgradeRunningCheck} from './apps/runtime/bin/runtime-upgrade-preflight.mjs';
import {canonical,sha256} from './apps/hub/dist/install/files.js';
import {writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {MODULE_API_VERSION} from '@jimmie-potts/sdk';
const [root,scenario]=process.argv.slice(1), requestFile=join(root,'request'),planFile=join(root,'plan');
const request={operation:'upgrade',installationId:'synthetic',installationRoot:root,tokenFile:join(root,'token'),admissionFile:join(root,'admission'),installedBaselineClosureFile:join(root,'closure'),execution:{operationId:'one',postStart:{attempts:2,timeoutMs:10000,intervalMs:100},adoption:null}};
const options={environment:'production',simulate:false,edge:true,config:join(root,'config'),stateDir:join(root,'state'),port:8788,lagLimitMs:10000};
const original={service:'bunny-runtime.service',pid:100,startTicks:'10',startMonotonic:'20',controlGroup:'/user/runtime',executable:'/node',entry:join(root,'current/apps/runtime/dist/src/main.js'),cwd:join(root,'previous'),argv:['/node',join(root,'current/apps/runtime/dist/src/main.js'),'--edge'],units:['/service'],options};
const owner={...original,pid:101,startTicks:'11',startMonotonic:'21',cwd:join(root,scenario==='recovery'?'previous':'target')};
const identity=revision=>({sourceRevision:revision,version:'0.1.0'}),stamp=revision=>({schema:'runtime-build/2.0',revision,version:'0.1.0',dirty:false,builtAt:'2026-10-09T00:00:00.000Z'});
const revisions={previous:'a'.repeat(40),target:'b'.repeat(40),recovery:'a'.repeat(40)};
const expected={releases:Object.fromEntries(Object.entries(revisions).map(([role,r])=>[role,identity(r)]))};
const stamps=Object.fromEntries(Object.entries(revisions).map(([role,r])=>[role,stamp(r)]));
const source={expected,stamps,inputs:[],artifacts:{previous:{root:join(root,'previous'),identity:expected.releases.previous},target:{root:join(root,'target')},recovery:{root:join(root,'previous')}}};
const state={configured:[],durableOwners:['core'],configSha256:sha256('config')};
const admission={installedBaselineClosure:{path:request.installedBaselineClosureFile,sha256:'d'.repeat(64)}};
const baseline={baselineRoot:join(root,'previous')},hooks={hooks:[]},paths={protectedPaths:[]};
await writeFile(requestFile,JSON.stringify(request),{mode:0o600}); await writeFile(request.tokenFile,'synthetic private token',{mode:0o600});await writeFile(options.config,'config',{mode:0o600});await writeFile(join(root,'credentials'),'credentials',{mode:0o600});
const body={schema:'runtime-upgrade-plan/1.0',eligibility:'eligible-under-coordinator-admission',requestSha256:sha256(await readFile(requestFile)),operation:request.operation,installationId:request.installationId,execution:request.execution,owner,paths,baseline,hooks,state,source:{expected,stamps},admission,privateInputs:{configSha256:sha256('config'),credentialsSha256:sha256('credentials'),readTokenSha256:sha256('synthetic private token')}};
body.owner=original; const plan={...body,planSha256:sha256(canonical(body))}; if(scenario==='wrong-plan-hash')plan.planSha256='0'.repeat(64);
await writeFile(planFile,JSON.stringify(plan),{mode:0o600});
const counts={owner:0,http:0,selection:0,lock:0}; const observations=[];
const health={status:'ok',moduleApiVersion:MODULE_API_VERSION,lagCheck:{status:'active',limitMs:10000},modules:[{name:'core',state:'running',healthy:true,reasonCode:null}]};
const io={privateFile:path=>readFile(path),parseRequest:value=>value,canonical,sha256,lock:async()=>{counts.lock++;if(scenario==='missing-lock')throw Error('no');},execution:async()=>request.execution,
 source:async()=>scenario==='source-drift'&&counts.http>1?{...source,inputs:[{changed:true}]}:source,admission:async()=>admission,baseline:async()=>baseline,hooks:async()=>scenario==='hook-drift'&&counts.http>1?{hooks:[{changed:true}]}:hooks,state:async()=>state,
 config:async()=>({edge:{credentials:join(root,'credentials')}}),owner:async()=>{counts.owner++;if(scenario==='same-process')return original;if(scenario==='wrong-arguments')return {...owner,argv:[...owner.argv,'--simulate']};if(scenario==='owner-drift'&&counts.http>0)return {...owner,pid:102};return owner;},
 listener:async pid=>({pid,inode:'one'}),runningPaths:async(request,observed,approved,selected)=>{counts.selection++;if(scenario==='wrong-selection'||scenario==='late-selection-drift'&&counts.http>1)throw Error('wrong selection');return {target:selected};},
 http:async(observed,token,expectedBuild,recheck,context)=>{observations.push(context);counts.http++;await recheck();if(scenario==='token-drift')await writeFile(request.tokenFile,'changed');return {build:scenario==='wrong-build'?stamps.previous:scenario==='recovery'?stamps.recovery:stamps.target,health:scenario==='bad-health'?{...health,lagCheck:{status:'stopped'}}:health,configSha256:state.configSha256,credentialsSha256:sha256('credentials')};}};
try {const result=await createRuntimeUpgradeRunningCheck(io)(requestFile,planFile,['recovery','reupgrade'].includes(scenario)?scenario:'candidate');process.stdout.write(JSON.stringify({result,counts,observations}));}catch(error){process.stdout.write(JSON.stringify({code:error.message,counts}));process.exitCode=2;}`;
  const inspect = (scenario: string) => run(process.execPath, ['--input-type=module', '-e', script, root, scenario], {cwd: process.cwd(), timeout: 10000});
  const passed = JSON.parse((await inspect('good')).stdout) as {result: {phase: string; verified: boolean}; counts: {http: number}; observations: {operationId: string; trace: {traceparent: string}}[]};
  assert.equal(passed.result.phase, 'candidate'); assert.equal(passed.result.verified, true); assert.equal(passed.counts.http, 2);
  assert.equal(passed.observations.length, 2);
  assert.deepEqual(passed.observations[0], passed.observations[1]);
  assert.equal(passed.observations[0]?.operationId, 'one');
  assert.match(passed.observations[0]?.trace.traceparent ?? '', /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  assert.ok(!JSON.stringify(passed.result).includes('traceparent'));
  for (const phase of ['recovery', 'reupgrade']) {
    const observed = JSON.parse((await inspect(phase)).stdout) as {result: {phase: string; selection: {target: string}}};
    assert.equal(observed.result.phase, phase);
    assert.equal(observed.result.selection.target, join(root, phase === 'recovery' ? 'previous' : 'target'));
  }
  for (const scenario of ['wrong-plan-hash','missing-lock','same-process','wrong-arguments','owner-drift','wrong-selection','late-selection-drift','wrong-build','bad-health','token-drift','source-drift','hook-drift']) {
    await t.test(scenario + ' refuses', async () => {
      await assert.rejects(inspect(scenario), (error: unknown) => {
        const value = JSON.parse((error as {stdout: string}).stdout) as {code: string};
        assert.equal(value.code, 'runtime-upgrade-running-refused'); return true;
      });
    });
  }
});

void test('running-check CLI refuses an unknown phase before reading installed state', async () => {
  await assert.rejects(run(process.execPath, ['apps/runtime/bin/runtime-upgrade-check.mjs', 'verify-running',
    '/synthetic/not-read-request', '/synthetic/not-read-plan', 'unknown'], {cwd: process.cwd(), timeout: 10000}), (error: unknown) => {
    const value = error as {stdout: string; stderr: string};
    assert.equal(value.stdout, '');
    assert.deepEqual(JSON.parse(value.stderr), {code: 'runtime-upgrade-running-refused', verified: false});
    return true;
  });
});
