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
 qualificationRevision:release.sourceRevision,releases:{previous:artifact,target:artifact,recovery:artifact},formatInventoryFiles:{previous:join(root,'p'),target:join(root,'t'),recovery:join(root,'r'),qualification:join(root,'q')}};
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
const counters={owner:0,listener:0,source:0,admission:0,baseline:0,paths:0,hooks:0,state:0,receipts:0,http:0,lock:0}; let afterHttp=false;
const drift=(name,count)=>scenario===name+'-drift'&&count>1||scenario==='late-'+name+'-drift'&&counters.http>1;
const io={privateFile:readPrivateFile,parseRequest:parseUpgradeRequest,canonical,sha256,
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
 http:async(observed,token,expected,recheck)=>{counters.http++;if(token!==request.tokenFile) throw new Error('wrong token selection');await recheck();afterHttp=true;
 if(counters.http>1&&scenario==='token-drift') await writeFile(request.tokenFile,'changed synthetic secret');
 if(counters.http>1&&scenario==='credentials-drift') await writeFile(join(root,'credentials'),'changed synthetic inventory');
 if(counters.http>1&&scenario==='config-drift') await writeFile(owner.options.config,JSON.stringify({changed:true}));
 const result={build:stamp,health,configSha256:state.configSha256,credentialsSha256};
 if(scenario==='health-drift'&&counters.http>1) return {...result,health:{...health,lagCheck:{status:'stopped',limitMs:10000}}};return result;}};
const preflight=createRuntimeUpgradePreflight(io);
try {let plan;
 if(['locked','wrong-plan','missing-lock'].includes(scenario)) {plan=await preflight(requestFile);const approved=join(root,'approved-'+scenario+'.json');await writeFile(approved,JSON.stringify(scenario==='wrong-plan'?{...plan,planSha256:'0'.repeat(64)}:plan),{mode:0o600});plan=await preflight(requestFile,approved);}
 else plan=await preflight(requestFile);
 process.stdout.write(JSON.stringify({plan,counters}));}
catch(error){process.stdout.write(JSON.stringify({code:error.message,counters}));process.exitCode=2;}`;
  const inspect = (scenario: string) => run(process.execPath, ['--input-type=module', '-e', script, root, scenario], {cwd: process.cwd(), timeout: 10000});
  const first = JSON.parse((await inspect('adoption')).stdout) as {plan: {operation: string; planSha256: string}; counters: {http: number; lock: number}};
  assert.ok(!(await inspect('adoption')).stdout.includes('synthetic-secret-never-public'));
  assert.equal(first.plan.operation, 'adoption'); assert.match(first.plan.planSha256, /^[0-9a-f]{64}$/);
  assert.equal(first.counters.http, 2); assert.equal(first.counters.lock, 0);
  assert.equal((JSON.parse((await inspect('upgrade')).stdout) as {plan: {operation: string}}).plan.operation, 'upgrade');
  assert.equal((JSON.parse((await inspect('locked')).stdout) as {counters: {lock: number}}).counters.lock, 2);
  for (const scenario of ['unknown-field','owner-drift','listener-drift','source-drift','admission-drift','baseline-drift','paths-drift','hook-drift','state-drift','receipt-drift','request-drift',
    'late-source-drift','late-admission-drift','late-baseline-drift','late-paths-drift','late-hook-drift','late-state-drift','late-receipt-drift','token-drift','credentials-drift','config-drift','configured-refusal','unknown-module','configured-wispr','stopped-watchdog','health-drift','wrong-plan','missing-lock']) {
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
