import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFile} from 'node:child_process';
import {chmod,mkdir,mkdtemp,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {withOperation, reconcileOperation, readPending} from '../bunny-operations.mjs';
async function fixture(t) {
  const root=await mkdtemp(join(await realpath(tmpdir()),'bunny-operations-'));
  t.after(()=>rm(root,{recursive:true,force:true}));return {root,project:'synthetic'};
}
test('one operation excludes all other writers and records actual release',async t=>{
  const p=await fixture(t);let release;
  const entered=new Promise(resolve=>{release=resolve;});
  let done;const held=withOperation(p,async()=>{release();await new Promise(resolve=>{done=resolve;});return 'ok';});
  await entered;await assert.rejects(withOperation(p,()=>assert.fail('overlap')));
  done();assert.equal(await held,'ok');
  assert.equal(await withOperation(p,()=>42),42);
});
test('pending effects survive failure and manual maintenance refuses until explicit reconciliation',async t=>{
  const p=await fixture(t);
  await assert.rejects(withOperation(p,async lease=>{await lease.record({id:'batch-1',phase:'stopping',outcome:'uncertain'});throw Error('interrupted');}));
  assert.equal((await readPending(p)).phase,'stopping');
  await assert.rejects(withOperation(p,()=>assert.fail('pending bypass')));
  const result=await reconcileOperation(p,async()=>({id:'a'.repeat(64),status:'exited',pid:0}));
  assert.equal(result.outcome,'reconciled');assert.equal(result.reconciledFrom.phase,'stopping');
  assert.equal((await readPending(p)),undefined);
  assert.equal(await withOperation(p,()=>7),7);
});
test('reconciliation uses the same exclusion as a live normal operation',async t=>{
  const p=await fixture(t);
  await withOperation(p,async lease=>{
    await lease.record({id:'batch-live',phase:'starting',outcome:'uncertain'});
    await assert.rejects(reconcileOperation(p,()=>assert.fail('must not inspect a live operation')));
  });
});
test('a killed process leaves the last durable phase until explicit unfinished-operation reconciliation',async t=>{
  const p=await fixture(t);const {spawn}=await import('node:child_process');
  const moduleUrl=new URL('../bunny-operations.mjs',import.meta.url).href;
  const program=`import{withOperation}from ${JSON.stringify(moduleUrl)};await withOperation(${JSON.stringify(p)},async lease=>{await lease.record({id:'batch-killed',phase:'creating-replacement',outcome:'uncertain'});process.stdout.write('durable\\n');setInterval(()=>{},1000);await new Promise(()=>{});});`;
  const child=spawn(process.execPath,['--input-type=module','-e',program],{stdio:['ignore','pipe','pipe']});
  t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',code=>{if(code!==null)reject(Error('child exited before durable phase'));});});
  const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await exited;
  assert.equal((await readPending(p)).phase,'creating-replacement');
  await assert.rejects(withOperation(p,()=>assert.fail('dead owner was not reconciled')));
  const result=await reconcileOperation(p,async()=>({status:'created',pid:0}));
  assert.ok(result.writerReleasedAt);assert.equal(result.observation.status,'created');assert.equal(result.reconciledFrom.phase,'creating-replacement');
  assert.match(await readFile(join(p.root,'synthetic.records','batch-killed.json'),'utf8'),/creating-replacement/);
});
test('malformed persisted operation identity refuses reconciliation without an out-of-records write',async t=>{
  const p=await fixture(t);
  await writeFile(join(p.root,'synthetic.pending.json'),JSON.stringify({id:'../escaped',phase:'starting',outcome:'uncertain'}),{mode:0o600});
  await assert.rejects(reconcileOperation(p,async()=>({status:'exited',pid:0})));
  await assert.rejects(readFile(join(p.root,'escaped.json')),{code:'ENOENT'});
});
test('reconciliation still excludes a new writer if a pending path disappears during its inspection',async t=>{
  const p=await fixture(t);
  await assert.rejects(withOperation(p,async lease=>{await lease.record({id:'batch-old',phase:'starting',outcome:'uncertain'});throw Error('stopped');}));
  const original=await readPending(p);let entered,finish;
  const started=new Promise(resolve=>{entered=resolve;});
  const reconciling=reconcileOperation(p,async()=>{entered();await new Promise(resolve=>{finish=resolve;});return {status:'exited',pid:0};});
  await started;
  const {unlink}=await import('node:fs/promises');await unlink(join(p.root,'synthetic.pending.json'));
  await assert.rejects(withOperation(p,async lease=>{await lease.record({id:'batch-new',phase:'starting',outcome:'uncertain'});}));
  await writeFile(join(p.root,'synthetic.pending.json'),JSON.stringify(original),{mode:0o600});
  finish();await reconciling;
  await withOperation(p,async lease=>{await lease.record({id:'batch-new',phase:'starting',outcome:'uncertain'});});
  assert.equal((await readPending(p)).id,'batch-new');
});

// The operator's documented commands, run the way an operator runs them. maintain() called in-process
// cannot show a hang at the entry point, because importing bunny.mjs never reaches its command-line path.
const operator=fileURLToPath(new URL('../bunny.mjs',import.meta.url));
const project='synthetic',id='1'.repeat(64),image='sha256:'+'2'.repeat(64),revision='3'.repeat(40);
const LIMIT_MS=30_000;
const posix=process.platform==='win32'?'POSIX host required':false;

// The fake engine holds its container in a file, so each docker call in the child sees the last one's effect.
const fakeEngine=`import {appendFileSync,readFileSync,writeFileSync} from 'node:fs';
const [state,log]=[process.env.FAKE_DOCKER_STATE,process.env.FAKE_DOCKER_LOG];
const args=process.argv.slice(2);appendFileSync(log,JSON.stringify(args)+'\\n');
const info=JSON.parse(readFileSync(state,'utf8'));
const save=(Status,Running,Pid)=>{Object.assign(info.State,{Status,Running,Pid});writeFileSync(state,JSON.stringify(info));};
const out=value=>process.stdout.write(typeof value==='string'?value:JSON.stringify(value));
if(args[0]==='ps')out(info.Id);
else if(args[0]==='inspect')out([info]);
else if(args[0]==='volume')out([{Name:args[2],Driver:'local',Scope:'local',Options:null}]);
else if(args[0]==='image')out([{Config:{Labels:{'org.opencontainers.image.revision':process.env.FAKE_DOCKER_REVISION}}}]);
else if(args[0]==='run')out({operation:args.includes('worker-backup')?'backup':'restore',status:'complete',files:2});
else if(args[0]==='start'){save('running',true,101);out(info.Id);}
else if(args[0]==='stop'){save('exited',false,0);out(info.Id);}
else{process.stderr.write('unexpected engine call');process.exitCode=64;}
`;

async function host(t,status='exited') {
  const home=await mkdtemp(join(await realpath(tmpdir()),'bunny-cli-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const bin=join(home,'bin');await mkdir(bin);
  const engine=join(home,'engine.mjs'),state=join(home,'container.json'),log=join(home,'engine.log');
  await writeFile(engine,fakeEngine);await writeFile(log,'');
  const docker=join(bin,'docker');
  await writeFile(docker,`#!/bin/sh\nexec "${process.execPath}" "${engine}" "$@"\n`);await chmod(docker,0o755);
  const running=status==='running';
  await writeFile(state,JSON.stringify({Id:id,Image:image,State:{Status:status,Running:running,Restarting:false,Pid:running?101:0},
    Config:{User:'1000:1000',Labels:{'com.docker.compose.project':project,'com.docker.compose.service':'core'}},
    HostConfig:{RestartPolicy:{Name:'no'},PortBindings:{},NetworkMode:'none'},NetworkSettings:{Networks:{}},
    Mounts:[['state','/var/lib/bunny',true],['config','/etc/bunny',false],['secrets','/run/secrets/bunny',false]]
      .map(([Name,Destination,RW])=>({Type:'volume',Name,Destination,RW}))}));
  const root=join(home,'.local','state','bunny-operations');
  return {home,root,state,
    env:{HOME:home,PATH:bin,FAKE_DOCKER_STATE:state,FAKE_DOCKER_LOG:log,FAKE_DOCKER_REVISION:revision},
    calls:async()=>(await readFile(log,'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line)),
    status:async()=>JSON.parse(await readFile(state,'utf8')).State.Status};
}
function cli(machine,...args) {
  return new Promise((resolve,reject)=>{
    execFile(process.execPath,[operator,...args,'--project',project],{env:machine.env,encoding:'utf8',timeout:LIMIT_MS,killSignal:'SIGKILL'},
      (error,stdout,stderr)=>{
        if(error!==null&&typeof error.code!=='number'){reject(error);return;}
        resolve({code:error===null?0:error.code,stdout,stderr});
      });
  });
}
function settled(result) {
  // A top-level await that never settles exits 13 with Node's warning, or, once the entry path has
  // set its failing default, exit 1 with nothing printed. Every real outcome prints a result or a refusal.
  assert.notEqual(result.code,13,result.stderr);
  assert.doesNotMatch(result.stderr,/unsettled top-level await/i);
  assert.ok(result.stdout!==''||result.stderr!=='',`exit ${result.code} with no result or refusal`);
}
const engineCalls=async machine=>(await machine.calls()).map(args=>args[0]);

test('stop settles through the lease, stops the container and releases the writer',{skip:posix},async t=>{
  const machine=await host(t,'running');
  const result=await cli(machine,'stop');
  settled(result);assert.equal(result.code,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),{operation:'stop',status:'stopped'});
  assert.equal(await machine.status(),'exited');
  assert.ok((await engineCalls(machine)).includes('stop'));
  assert.equal(await withOperation({project,root:machine.root},()=>'released'),'released');
});
test('start settles through the lease and starts the stopped container',{skip:posix},async t=>{
  const machine=await host(t);
  const result=await cli(machine,'start');
  settled(result);assert.equal(result.code,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),{operation:'start',status:'running',health:'not-checked'});
  assert.equal(await machine.status(),'running');
});
for(const command of ['backup','restore']) {
  test(`${command} settles through the lease and hands the archive volume to its worker`,{skip:posix},async t=>{
    const machine=await host(t);
    const result=await cli(machine,command,'snapshot-1','--archive-volume','synthetic-archives');
    settled(result);assert.equal(result.code,0,result.stderr);
    assert.equal(JSON.parse(result.stdout).operation,command);
    const worker=(await machine.calls()).find(args=>args[0]==='run');
    assert.ok(worker.includes('worker-'+command));
    assert.ok(worker.includes('type=volume,source=synthetic-archives,target=/backup'+(command==='restore'?',readonly':'')));
    assert.equal(await machine.status(),'exited');
  });
}
test('status still answers without taking the lease',{skip:posix},async t=>{
  const machine=await host(t,'running');
  const result=await cli(machine,'status');
  settled(result);assert.equal(result.code,0,result.stderr);
  assert.equal(JSON.parse(result.stdout).status,'running');
});
test('a held operation lease refuses the command and leaves the container alone',{skip:posix},async t=>{
  const machine=await host(t,'running');
  await withOperation({project,root:machine.root},async()=>{
    const result=await cli(machine,'stop');
    settled(result);assert.equal(result.code,1);assert.equal(result.stdout,'');
    assert.notEqual(result.stderr,'');
  });
  assert.equal(await machine.status(),'running');
  assert.deepEqual(await machine.calls(),[]);
});
test('an unfinished operation refuses the command and stays pending',{skip:posix},async t=>{
  const machine=await host(t);
  await assert.rejects(withOperation({project,root:machine.root},async lease=>{
    await lease.record({id:'batch-unfinished',phase:'starting',outcome:'uncertain'});throw Error('interrupted');
  }));
  const result=await cli(machine,'start');
  settled(result);assert.equal(result.code,1);assert.equal(result.stdout,'');
  assert.equal(await machine.status(),'exited');
  assert.deepEqual(await machine.calls(),[]);
  const pending=JSON.parse(await readFile(join(machine.root,project+'.pending.json'),'utf8'));
  assert.equal(pending.id,'batch-unfinished');
});
test('the qualification route settles too, and refuses a request it cannot read',{skip:posix},async t=>{
  // That route's modules import bunny.mjs back as well, so it hung the same way.
  const machine=await host(t);
  const request=join(machine.home,'missing-request.json');
  const result=await cli(machine,'backup','snapshot-1','--archive-volume','synthetic-archives','--qualification-request',request);
  settled(result);assert.equal(result.code,1);assert.equal(result.stdout,'');
  assert.ok(!(await engineCalls(machine)).includes('run'));
});
test('an unknown command is refused at the command line',{skip:posix},async t=>{
  const machine=await host(t);
  const result=await cli(machine,'delete');
  settled(result);assert.equal(result.code,1);assert.equal(result.stdout,'');
  assert.deepEqual(await machine.calls(),[]);
});
