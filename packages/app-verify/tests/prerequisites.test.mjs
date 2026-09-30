import test from 'node:test';
import assert from 'node:assert/strict';
import {access, mkdir, mkdtemp, readdir, rm, writeFile, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {inspectPrerequisites, prerequisitesSupport, runCli} from '@jimmie-potts/app-verify';
import {inspectPrerequisitesWith} from '../dist/prerequisites.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'prerequisites-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  let effects=0;
  const effect = () => { effects++; throw new Error('MUTATING_CALLBACK_CALLED'); };
  const plugin = {app:'fixture', repository:'fixture/app', command:'verify', root, defaultScenario:'basic',
    scenarios:{basic:{description:'fixture',seed:effect}}, captureSteps:{}, components:[],
    build:{version:'1',artifact:{route:'/bundle.js'},prepare:effect}, launch:effect,
    readiness:{line:effect,probe:effect}, checks:[{id:'boundary',run:effect}]};
  const env = {...process.env, APP_VERIFY_STATE_ROOT:join(root,'state'), APP_VERIFY_PROOF_ROOT:join(root,'proof')};
  return {root,plugin,env,effectCount:()=>effects};
}
async function cli(plugin,args,env) {
  const lines=[]; const code=await runCli(plugin,args,{env,stdout:l=>lines.push(l),stderr:()=>{}});
  assert.equal(lines.length,1); return {code,value:JSON.parse(lines[0])};
}
test('help advertises read-only prerequisites and the diagnostic never calls lifecycle hooks',async t=>{
  const {root,plugin,env,effectCount}=await fixture(t);
  const help=await cli(plugin,['help'],env);
  assert.ok(help.value.operations.includes('prerequisites'));
  const before=await readdir(root);
  const result=await cli(plugin,['prerequisites'],env);
  assert.ok([0,3].includes(result.code));
  assert.equal(result.value.scope,'local-read-only');
  assert.equal(result.value.phases.launch.operation,'unproven');
  assert.equal(result.value.phases.capture.operation,'unproven');
  assert.equal(result.value.phases.handoff.operation,'unproven');
  assert.equal(result.value.checks.find(check=>check.id==='app-build')?.status,'unsupported');
  assert.deepEqual(await readdir(root),before);
  assert.equal(effectCount(),0,'the inspector never invokes a lifecycle callback, even if it catches an error');
});

test('old and malformed help responses do not claim support',()=>{
  assert.equal(prerequisitesSupport({operations:['help','start [--scenario <name>]']}),'unsupported');
  assert.equal(prerequisitesSupport({operations:['help','prerequisites']}),'supported');
  assert.equal(prerequisitesSupport({operations:['help',{}]}),'unknown');
  assert.equal(prerequisitesSupport(null),'unknown');
});

test('missing checkout modules and a runtime root inside Git are reported without probing effects',async t=>{
  const {root,plugin,env}=await fixture(t);
  execFileSync('git',['-C',root,'init','-q'],{env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});
  plugin.browser={modules:['app-verify-definitely-absent-module']};
  const before=await readdir(root);
  const {code,value}=await cli(plugin,['prerequisites'],env);
  assert.equal(code,3);
  assert.equal(value.checks.find(check=>check.id==='runtime-root')?.status,'missing');
  assert.equal(value.checks.find(check=>check.id==='playwright-module')?.status,'missing');
  assert.equal(value.checks.find(check=>check.id==='host-launch')?.status,'unknown');
  assert.equal(value.phases.launch.operation,'unproven');
  assert.deepEqual(await readdir(root),before);
});

test('adapter failures and malformed output cannot leak private error text',async t=>{
  const {plugin,env}=await fixture(t);
  plugin.prerequisites={inspect:()=>{throw new Error('token=private-value /home/private/credential');}};
  let result=await inspectPrerequisites(plugin,env);
  assert.equal(result.checks.find(check=>check.id==='adapter-prerequisites')?.reason,'adapter-check-failed');
  assert.equal(result.checks.find(check=>check.id==='app-build')?.status,'unknown');
  assert.doesNotMatch(JSON.stringify(result),/private-value|credential/);
  plugin.prerequisites={inspect:async()=>[{id:'app-build',phase:'launch',status:'missing',reason:'private/path'}]};
  result=await inspectPrerequisites(plugin,env);
  assert.equal(result.checks.find(check=>check.id==='adapter-prerequisites')?.reason,'adapter-check-invalid');
  assert.equal(result.checks.find(check=>check.id==='app-build')?.status,'unknown');
  plugin.prerequisites={inspect:async()=>[{id:'app-build',phase:'launch',status:'present'}]};
  result=await inspectPrerequisites(plugin,env);
  assert.equal(result.checks.find(check=>check.id==='adapter-prerequisites')?.reason,'adapter-check-invalid');
});

test('an unignored proof root and unreadable manager stay non-ready',async t=>{
  const {root,plugin,env}=await fixture(t);
  execFileSync('git',['-C',root,'init','-q'],{env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});
  const changed={...env,APP_VERIFY_STATE_ROOT:'/tmp/app-verify-uncreated-prerequisite-state',
    APP_VERIFY_PROOF_ROOT:join(root,'proof'),XDG_RUNTIME_DIR:'/app-verify-no-such-runtime',
    DBUS_SESSION_BUS_ADDRESS:'unix:path=/app-verify-no-such-session-bus'};
  const result=await inspectPrerequisites(plugin,changed);
  assert.equal(result.checks.find(check=>check.id==='proof-root')?.status,'missing');
  assert.notEqual(result.checks.find(check=>check.id==='user-manager')?.status,'present');
  assert.equal(result.phases.launch.operation,'unproven');
});

test('missing supervisor/tool and denied storage parents are deterministic negative controls',async t=>{
  const {root,plugin,env,effectCount}=await fixture(t);
  const proof=join(root,'proof'),runtime=join(root,'state');
  await mkdir(proof);
  await mkdir(runtime);
  const denied=Object.assign(new Error('private path and secret text'),{code:'EACCES'});
  const probe={
    which:name=>name==='systemctl'?'/usr/bin/systemctl':undefined,
    exec:async()=>({code:1,stdout:'offline',stderr:'private manager error'}),
    access:async path=>{if(path===proof||path===runtime)throw denied;},
    resolveRoots:async()=>({proof,runtime,labels:{proof:'test',runtime:'test'}}),
  };
  const result=await inspectPrerequisitesWith(plugin,env,probe);
  assert.equal(result.checks.find(check=>check.id==='user-manager')?.status,'missing');
  assert.equal(result.checks.find(check=>check.id==='systemd-run-tool')?.status,'missing');
  assert.equal(result.checks.find(check=>check.id==='proof-write')?.status,'missing');
  assert.equal(result.checks.find(check=>check.id==='runtime-write')?.status,'missing');
  assert.equal(result.phases.launch.operation,'unproven');
  assert.doesNotMatch(JSON.stringify(result),/private path|secret text|private manager error/);
  assert.equal(effectCount(),0);
});

test('browser executable location is unknown when inspected environment differs',async t=>{
  const {plugin,env}=await fixture(t);
  await mkdir(join(plugin.root,'node_modules'));
  await symlink(resolve('node_modules/playwright'),join(plugin.root,'node_modules/playwright'));
  plugin.browser={modules:['playwright']};
  const changed={...env,PLAYWRIGHT_BROWSERS_PATH:'/app-verify-different-browser-cache'};
  const result=await inspectPrerequisites(plugin,changed);
  assert.equal(result.checks.find(check=>check.id==='playwright-module')?.status,'present');
  assert.equal(result.checks.find(check=>check.id==='chromium-file')?.status,'unknown');
  assert.equal(result.checks.find(check=>check.id==='chromium-file')?.reason,'browser-environment-differs');
});

test('a read-only adapter check appears beside unproven runtime phases',async t=>{
  const {plugin,env}=await fixture(t);
  plugin.prerequisites={inspect:async()=>[{id:'app-build',phase:'launch',status:'present',reason:'build-current'}]};
  const result=await inspectPrerequisites(plugin,env);
  assert.equal(result.checks.find(check=>check.id==='app-build')?.status,'present');
  assert.equal(result.phases.launch.operation,'unproven');
  assert.equal(result.phases.capture.operation,'unproven');
  assert.equal(result.phases.handoff.operation,'unproven');
});

function observedProbe(env) {
  return {currentEnv:()=>env, which:(name,path)=>path==='/usr/bin:/bin'?'/usr/bin/'+name:'/chosen/'+name,
    access:async()=>{},exec:async()=>({code:0,stdout:'running',stderr:''}),
    resolveRoots:async()=>({proof:'/unused-proof',runtime:'/unused-runtime',labels:{proof:'test',runtime:'test'}})};
}
test('adapter cannot replace core evidence, including conditional and late rows',async t=>{
  const {plugin,env}=await fixture(t);
  for(const id of ['host-launch','windows-browser','storage-roots','ffmpeg-file']) {
    plugin.prerequisites={inspect:async()=>[{id,phase:'launch',status:'present',reason:'claimed'}]};
    const result=await inspectPrerequisitesWith(plugin,env,observedProbe(env));
    assert.equal(result.checks.find(c=>c.id==='adapter-prerequisites')?.reason,'adapter-check-invalid');
    assert.equal(new Set(result.checks.map(c=>c.id)).size,result.checks.length);
    assert.notEqual(result.checks.find(c=>c.id===id)?.status,'present');
  }
});
test('tool inspection distinguishes lifecycle PATH from fixed lease tools',async t=>{
  const {plugin,env}=await fixture(t);env.PATH='/chosen';
  const paths=[],calls=[];const probe=observedProbe(env);
  probe.which=(name,path)=>{paths.push([name,path]);return path==='/usr/bin:/bin'?'/usr/bin/'+name:'/chosen/'+name;};
  probe.exec=async(...args)=>{calls.push(args);return {code:0,stdout:'running',stderr:''};};
  const result=await inspectPrerequisitesWith(plugin,env,probe);
  assert.ok(paths.some(([name,path])=>name==='systemd-run'&&path==='/chosen'));
  assert.ok(paths.some(([name,path])=>name==='systemctl'&&path==='/usr/bin:/bin'));
  assert.equal(calls[0][0],'systemctl');assert.equal(calls[0][2].env,undefined);
  assert.equal(result.checks.find(c=>c.id==='lease-systemctl-tool')?.status,'present');
  probe.which=(name,path)=>path==='/usr/bin:/bin'?'/usr/bin/'+name:undefined;
  const missing=await inspectPrerequisitesWith(plugin,env,probe);
  assert.equal(missing.checks.find(c=>c.id==='systemd-run-tool')?.status,'missing');
  assert.equal(missing.checks.find(c=>c.id==='lease-systemctl-tool')?.status,'present');
});
test('alternate host environment does not acquire actual manager evidence',async t=>{
  const {plugin,env}=await fixture(t);
  for(const key of ['PATH','XDG_RUNTIME_DIR','DBUS_SESSION_BUS_ADDRESS']) {
    const probe=observedProbe(env);probe.exec=()=>{throw new Error('unexpected manager execution');};
    const result=await inspectPrerequisitesWith(plugin,{...env,[key]:'/different'},probe);
    assert.equal(result.checks.find(c=>c.id==='user-manager')?.reason,'manager-environment-differs');
    if(key==='PATH')assert.equal(result.checks.find(c=>c.id==='systemd-run-tool')?.status,'unknown');
  }
});
test('missing adapter action produces a contract remedy, not a launch instruction',async t=>{
  const {plugin,env}=await fixture(t);
  plugin.browser={modules:[resolve('package.json')]};
  plugin.prerequisites={inspect:async()=>[{id:'app-build',phase:'launch',status:'missing',reason:'build-missing'}]};
  const result=await inspectPrerequisitesWith(plugin,env,observedProbe(env));
  assert.equal(result.checks.find(c=>c.id==='adapter-prerequisites')?.status,'missing');
  assert.match(result.next,/next action/);
  assert.equal((await cli(plugin,['prerequisites'],env)).code,3);
});
test('custom browser initialization is never executed and video tooling remains explicit',async t=>{
  const {root,plugin,env}=await fixture(t);const marker=join(root,'side-effect');const module=join(root,'custom.cjs');
  await writeFile(module,`require('node:fs').writeFileSync(${JSON.stringify(marker)},'effect');module.exports={chromium:{executablePath:()=>'/fake'}}`);
  plugin.browser={modules:[module]};
  const result=await inspectPrerequisitesWith(plugin,env,observedProbe(env));
  await assert.rejects(access(marker),{code:'ENOENT'});
  assert.equal(result.checks.find(c=>c.id==='playwright-module')?.status,'unknown');
  assert.equal(result.checks.find(c=>c.id==='chromium-file')?.status,'unknown');
  const video=result.checks.find(c=>c.id==='ffmpeg-file');assert.equal(video?.status,'unknown');assert.ok(video.next);
});
