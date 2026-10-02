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

test('fresh baseline and instrumented application processes preserve command outcomes and expose independent CPU/RSS', async t => {
  const parent=await mkdtemp(join(tmpdir(),'wp-')), local=join(parent,'.local');await mkdir(local);
  t.after(()=>rm(parent,{recursive:true,force:true}));
  let requests=0;
  const collector=createServer(async(req,res)=>{for await(const chunk of req){} requests++;res.setHeader('content-type','application/json');res.end('{}');});
  await new Promise(resolve=>collector.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{collector.close(resolve);collector.closeAllConnections();}));
  const port=collector.address().port, others=[43000,43002,43003,43004,43005].filter(p=>p!==port);
  const outcomes=[];
  for(const enabled of [false,true]){
    const directory=join(local,enabled?'enabled':'baseline');
    await prepareBackendDirectory(directory,{runId:enabled?'enabled':'baseline',ports:{grafana:others[0],otlp:port,loki:others[1],tempo:others[2],health:others[3]}});
    const roots=await registerHostRoots(directory,tmpdir());t.after(()=>rm(roots.roots.state.path,{recursive:true,force:true}));
    await prepareReleasedContract(join(roots.roots.state.path,'contract'));
    let ownership;
    const processHandle=await startWorkloadProcess(directory,{enabled,onStart:identity=>{ownership=identity;}});t.after(()=>processHandle.stop());
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
    if(enabled){assert.equal(stopped.result.counts.logs.exported,21);assert.equal(stopped.result.counts.traces.output.exported,18);}
    else{assert.equal(stopped.result.counts,null);assert.equal(requests,0);}
    let refused;
    await assert.rejects(startWorkloadProcess(directory,{enabled,onStart:identity=>{
      refused=identity;throw new Error('SYNTHETIC_PRIVATE_CANARY');
    }}),/SYNTHETIC_PRIVATE_CANARY/);
    assert.throws(()=>process.kill(refused.pid,0),{code:'ESRCH'});
  }
  assert.deepEqual(outcomes,Array.from({length:6},()=>[202,'queued']));assert.equal(requests,39);
});
