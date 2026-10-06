import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { prepareBackendDirectory } from '../backend-files.mjs';
import { registerHostRoots } from '../host-roots.mjs';
import { prepareReleasedContract } from '../released-contract.mjs';
import { startWorkloadProcess } from '../workload-process.mjs';
import { applicationSnapshot } from '../application-measurement.mjs';
import { createBrightnessOperation } from '../workload-operation.mjs';
import { reconcileWorkload } from '../workload-oracle.mjs';
import { createDeliveryRecorder } from '../delivery-records.mjs';
import { assessCommandDiagnostics,assessFaultDiagnostics } from '../command-evidence.mjs';

test('fresh baseline and instrumented application processes preserve command outcomes and expose independent CPU/RSS', async t => {
  const parent=await mkdtemp(join(tmpdir(),'wp-')), local=join(parent,'.local');await mkdir(local);
  t.after(()=>rm(parent,{recursive:true,force:true}));
  let requests=0,rejectCollection=false;
  const collector=createServer(async(req,res)=>{for await(const _chunk of req){/* drain the body */} requests++;res.statusCode=rejectCollection?500:200;res.setHeader('content-type','application/json');res.end('{}');});
  await new Promise(resolve=>collector.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{collector.close(resolve);collector.closeAllConnections();}));
  const port=collector.address().port, others=[43000,43002,43003,43004,43005].filter(p=>p!==port);
  const outcomes=[];
  for(const mode of ['baseline','enabled','rejected']){
    const enabled=mode!=='baseline';rejectCollection=mode==='rejected';
    const directory=join(local,mode);
    await prepareBackendDirectory(directory,{runId:mode,ports:{grafana:others[0],otlp:port,loki:others[1],tempo:others[2],health:others[3]}});
    const roots=await registerHostRoots(directory,tmpdir().split('/').includes('.local')?tmpdir():local);t.after(()=>rm(roots.roots.state.path,{recursive:true,force:true}));
    await prepareReleasedContract(join(roots.roots.state.path,'contract'));
    let ownership;const evidence=createDeliveryRecorder({record:()=>{}});
    const processHandle=await startWorkloadProcess(directory,{enabled,purpose:'collection-faults',onStart:identity=>{ownership=identity;},onEvidence:evidence.accept});t.after(()=>processHandle.stop());
    assert.deepEqual(ownership,processHandle.identity);
    const sample=await applicationSnapshot(processHandle.identity);assert.ok(sample.rssBytes>0);
    const operation=createBrightnessOperation(processHandle.ready), receipts=[],events=[];
    for(let ordinal=0;ordinal<3;ordinal++) {
      events.push({kind:'dispatch',ordinal,slot:ordinal});
      const response=await operation({ordinal,signal:AbortSignal.timeout(2000)});
      assert.equal(response.validReceipt,true);receipts.push(response.receipt);
      events.push({kind:'completion',ordinal,slot:ordinal,failed:false,outcome:response});
      outcomes.push([response.status,response.receipt.outcome]);
    }
    const stopped=await processHandle.stop();
    assert.equal(stopped.result.oracle.effects,3);assert.equal(stopped.result.oracle.historyDropped,0);
    assert.deepEqual(stopped.executions.map(e=>e.requestId),receipts.map(r=>r.requestId));
    assert.deepEqual(stopped.executions.map(e=>e.effects),[1,2,3]);
    assert.equal(reconcileWorkload({events,closed:stopped}).complete,true);
    assert.equal(stopped.code,0);assert.equal(stopped.reason,null);
    assert.ok(stopped.result.shutdown.applicationMs>=stopped.result.shutdown.flushMs);
    assert.throws(()=>process.kill(processHandle.identity.pid,0),{code:'ESRCH'});
    if(enabled){
      const accounting=evidence.finish(stopped.result.counts);assert.equal(accounting.complete,true,JSON.stringify(accounting.counts));
      assert.equal(accounting.expectedLogs.length,21);assert.equal(accounting.expectedSpans.length,18);
      const diagnosticInput={commands:events.filter(e=>e.kind==='completion').map(e=>e.outcome),logs:accounting.expectedLogs,spans:accounting.expectedSpans};
      assert.equal(assessCommandDiagnostics(diagnosticInput).complete,true);
      for(const mutate of [
        value=>value.spans.pop(),value=>value.logs.pop(),value=>value.logs.push(value.logs[0]),
        value=>{value.spans[0].parentSpanId='f'.repeat(16);},
        value=>{value.logs[0].fields.bunny_ticket_sequence='999';},
        value=>{value.spans.find(s=>s.name==='bunny.command.execute').links=[];},
      ]) {const changed=structuredClone(diagnosticInput);mutate(changed);assert.equal(assessCommandDiagnostics(changed).complete,false);}
      const terminal=rejectCollection?'failed':'exported';
      assert.equal(stopped.result.counts.logs[terminal],21);assert.equal(stopped.result.counts.traces.output[terminal],18);
      assert.equal(accounting.counts.logs[terminal],21);assert.equal(accounting.counts.traces[terminal],18);
    }
    else{assert.equal(stopped.result.counts,null);assert.equal(requests,0);}
    let refused;
    await assert.rejects(startWorkloadProcess(directory,{enabled,onStart:identity=>{
      refused=identity;throw new Error('SYNTHETIC_PRIVATE_CANARY');
    }}),/SYNTHETIC_PRIVATE_CANARY/);
    assert.throws(()=>process.kill(refused.pid,0),{code:'ESRCH'});
  }
  assert.deepEqual(outcomes,Array.from({length:9},()=>[202,'queued']));assert.equal(requests,78);
});

test('fixed command fault sequence preserves baseline outcomes, counts each side effect and excludes private fixtures',async t=>{
  const parent=await mkdtemp(join(tmpdir(),'wf-')),local=join(parent,'.local');await mkdir(local);
  t.after(()=>rm(parent,{recursive:true,force:true}));
  const collector=createServer(async(req,res)=>{for await(const _chunk of req){/* drain the body */}res.setHeader('content-type','application/json');res.end('{}');});
  await new Promise(resolve=>collector.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{collector.close(resolve);collector.closeAllConnections();}));
  const port=collector.address().port,other=[43000,43002,43003,43004,43005].filter(p=>p!==port),directory=join(local,'faults');
  await prepareBackendDirectory(directory,{runId:'faults',ports:{grafana:other[0],otlp:port,loki:other[1],tempo:other[2],health:other[3]}});
  const roots=await registerHostRoots(directory,tmpdir().split('/').includes('.local')?tmpdir():local);t.after(()=>rm(roots.roots.state.path,{recursive:true,force:true}));
  await prepareReleasedContract(join(roots.roots.state.path,'contract'));
  const outcomes=[];
  for(const enabled of [false,true]) {
    const events=[],recorder=createDeliveryRecorder({record:event=>events.push(event)});
    const child=await startWorkloadProcess(directory,{enabled,purpose:'command-faults',onEvidence:recorder.accept});t.after(()=>child.stop());
    const result=await child.qualifyCommands(),closed=await child.stop();
    assert.equal(result.complete,true,JSON.stringify(result));assert.equal(result.cases.length,10);
    assert.equal(closed.code,0);assert.equal(closed.reason,null);assert.equal(closed.result.complete,true);
    assert.equal(closed.result.oracle.effects,6);assert.equal(closed.executions.length,6);
    assert.equal(new Set(closed.executions.map(e=>JSON.stringify(e.requestId))).size,6);
    outcomes.push(result.cases);
    const accounting=recorder.finish(closed.result.counts??{});assert.equal(accounting.complete,true);
    if(enabled){
      assert.equal(accounting.expectedLogs.length,49);assert.equal(accounting.expectedSpans.length,48);
      const input={qualification:result,logs:accounting.expectedLogs,spans:accounting.expectedSpans};
      assert.equal(assessFaultDiagnostics(input).complete,true);
      for(const mutate of [value=>value.logs.pop(),value=>{value.spans[0].parentSpanId='f'.repeat(16);},
        value=>{value.logs[0].fields.bunny_ticket_sequence='999';}]) {
        const changed=structuredClone(input);mutate(changed);assert.equal(assessFaultDiagnostics(changed).complete,false);
      }
    }
    else assert.equal(events.length,0);
    assert.equal(JSON.stringify(events).includes('SYNTHETIC_PRIVATE_CANARY'),false);
  }
  assert.deepEqual(outcomes[1],outcomes[0]);
});

test('stalled collection saturates bounded queues without exceeding the full one-second shutdown flush budget',async t=>{
  const parent=await mkdtemp(join(tmpdir(),'ws-')),local=join(parent,'.local');await mkdir(local);
  t.after(()=>rm(parent,{recursive:true,force:true}));
  const collector=createServer(async req=>{for await(const _chunk of req){/* drain the body */}});
  await new Promise(resolve=>collector.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{collector.close(resolve);collector.closeAllConnections();}));
  const port=collector.address().port,other=[43000,43002,43003,43004,43005].filter(p=>p!==port),directory=join(local,'stalled');
  await prepareBackendDirectory(directory,{runId:'stalled',ports:{grafana:other[0],otlp:port,loki:other[1],tempo:other[2],health:other[3]}});
  const roots=await registerHostRoots(directory,tmpdir().split('/').includes('.local')?tmpdir():local);t.after(()=>rm(roots.roots.state.path,{recursive:true,force:true}));
  await prepareReleasedContract(join(roots.roots.state.path,'contract'));
  const recorder=createDeliveryRecorder({record:()=>{}});
  const child=await startWorkloadProcess(directory,{enabled:true,purpose:'collection-faults',onEvidence:recorder.accept});t.after(()=>child.stop());
  const operation=createBrightnessOperation(child.ready),commands=[];
  for(let ordinal=0;ordinal<200;ordinal++)commands.push(await operation({ordinal,signal:AbortSignal.timeout(2000)}));
  const closed=await child.stop(),accounting=recorder.finish(closed.result.counts);
  assert.equal(closed.code,0);assert.equal(closed.result.complete,true);assert.equal(closed.result.oracle.effects,200);
  assert.ok(commands.every(command=>command.status===202&&command.validReceipt));
  assert.equal(accounting.complete,true);
  assert.equal(assessCommandDiagnostics({commands,logs:accounting.expectedLogs,spans:accounting.expectedSpans}).complete,true);
  for(const counts of Object.values(accounting.counts)) {
    assert.equal(counts.exported,0);assert.ok(counts.failed>0);assert.ok(counts.dropped>0);assert.equal(counts.inFlight,0);
  }
  assert.ok(closed.result.shutdown.flushMs<=1000,JSON.stringify(closed.result.shutdown));
  assert.ok(closed.result.shutdown.applicationMs<=2000);
});
