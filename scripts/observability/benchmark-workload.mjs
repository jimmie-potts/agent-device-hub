import {commandOutcomesDigest} from './benchmark-pair.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import {startWorkloadProcess} from './workload-process.mjs';
import {collectWorkloadWindow} from './workload-window.mjs';
import {createDeliveryRecorder} from './delivery-records.mjs';
import {createWorkloadJournal,createTelemetryJournal,createQueryJournal} from './workload-journal.mjs';
import {assessCommandDiagnostics} from './command-evidence.mjs';
import {createBackendQueries} from './backend-queries.mjs';
import {verifyIngestion} from './ingestion-check.mjs';

function compactIngestion(value) {
  const compact=rows=>rows?{equal:rows.equal,expected:rows.expected,actual:rows.actual,
    missingRecords:rows.missing.reduce((n,row)=>n+row.count,0),unexpectedRecords:rows.unexpected.reduce((n,row)=>n+row.count,0)}:null;
  return {...value,logs:compact(value.logs),spans:compact(value.spans)};
}

/** One preregistered 90-second run. The caller owns backend lifecycle and
 * serial pair order. The resource sampler uses a separate Engine connection. */
export async function performBenchmarkWorkload({directory,plan,receipt,backend,sampleBackend,enabled,condition,signal}) {
  if(typeof enabled!=='boolean'||!['healthy','unavailable'].includes(condition)||backend===sampleBackend)throw new Error('Benchmark workload invalid');
  const workload=createWorkloadJournal(directory);let telemetry,queries,application,closed,window,accounting,diagnostics,ingestion;
  const commands=[],outcomes=[];let failure=null,privacyFailures=0,startNs,endNs,boundedQueues=false;
  function safe(event) {
    if(JSON.stringify(event).includes('SYNTHETIC_PRIVATE_CANARY')){privacyFailures++;throw new Error('Private fixture reached evidence');}
  }
  const record=event=>{
    safe(event);workload.record(event);
    if(event.kind==='completion') {
      const outcome=event.outcome;commands.push(outcome);
      outcomes.push(event);
    }
    if(event.kind==='application-closed')closed=event.value;
  };
  try {
    telemetry=createTelemetryJournal(directory);queries=createQueryJournal(directory);
    const recorder=createDeliveryRecorder({record:event=>{safe(event);telemetry.record(event);}});
    if(condition==='unavailable') {
      const current=await backend.collector(plan,receipt,'inspect',undefined,{signal});
      record({kind:'collector-state',value:current});
      if(!current.present||['T','t'].includes(current.state))throw new Error('Collector initial state invalid');
      const identity={pid:current.pid,startTicks:current.startTicks};
      record({kind:'collector-intent',action:'terminate',identity});workload.sync();
      record({kind:'collector-returned',value:await backend.collector(plan,receipt,'terminate',identity,{signal})});workload.sync();
      const deadline=performance.now()+5000;let absent=false;
      do {
        const current=await backend.collector(plan,receipt,'inspect',undefined,{signal});record({kind:'collector-state',value:current});
        if(!current.present){absent=true;break;}
        await delay(50,undefined,{signal});
      }while(performance.now()<deadline);
      if(!absent)throw new Error('Collector absence unconfirmed');
    }
    application=await startWorkloadProcess(directory,{enabled,signal,onEvidence:recorder.accept,
      onStart:identity=>{record({kind:'application-start',identity});workload.sync();}});
    startNs=String(BigInt(Date.now())*1000000n);
    window=await collectWorkloadWindow({application,signal,record,sampleStack:options=>sampleBackend.sampleStack(plan,receipt,options)});
    const terminal=await application.closed;application=null;closed??=terminal;
    endNs=String(BigInt(Date.now()+1)*1000000n);
    accounting=recorder.finish(closed.result?.counts??{});
    if(enabled&&commands.length)diagnostics=assessCommandDiagnostics({commands,logs:accounting.expectedLogs,spans:accounting.expectedSpans});
    const counts=closed.result?.counts;
    boundedQueues=accounting.complete&&(!enabled||(counts?.logs.queued===0&&counts.logs.bytes===0&&counts.traces.active===0&&
      counts.traces.activeBytes===0&&counts.traces.output.queued===0&&counts.traces.output.bytes===0));
    telemetry.sync();workload.sync();
    if(enabled&&condition==='healthy'&&accounting.expectedLogs.length&&accounting.expectedSpans.length) {
      ingestion=compactIngestion(await verifyIngestion({expectedLogs:accounting.expectedLogs,expectedSpans:accounting.expectedSpans,startNs,endNs,signal,
        queries:createBackendQueries(plan,{forbidden:['SYNTHETIC_PRIVATE_CANARY']}),record:event=>{if(event.kind==='query-failure'&&event.code==='privacy')privacyFailures++;queries.record(event);}}));queries.sync();
    }
    if(condition==='unavailable') {
      const current=await backend.collector(plan,receipt,'inspect',undefined,{signal});record({kind:'collector-state',value:current});
      if(current.present)throw new Error('Collector absence changed');
    }
    if(!window.complete||!accounting.complete||closed.stderrBytes!==0||!boundedQueues||
      (!enabled&&(Object.values(accounting.counts).some(value=>value.expected!==0)||closed.result?.counts!==null))||
      (enabled&&condition==='unavailable'&&Object.values(accounting.counts).some(value=>value.exported!==0||value.failed===0))||
      (enabled&&!diagnostics?.complete)||(enabled&&condition==='healthy'&&ingestion?.disposition!=='supported'))failure='benchmark-evidence-incomplete';
  }catch{failure='benchmark-workload-failed';}
  finally {
    if(application)try{closed=await application.stop();record({kind:'interrupted-application',value:closed});}
      catch{failure='application-cleanup-unconfirmed';}
  }
  let outcomesDigest=null;try{if(commands.length)outcomesDigest=commandOutcomesDigest(outcomes);}catch{failure='command-outcomes-incomplete';}
  const result={enabled,condition,complete:!failure,failure,window:window??null,outcomesDigest,
    privacyFailures,diagnostics:diagnostics??null,accounting:accounting?{complete:accounting.complete,counts:accounting.counts}:null,
    ingestion:ingestion??null,boundedQueues,transport:closed?.result?.transport??null};
  try{record({kind:'benchmark-result',value:result});return result;}
  finally {let failed=false;for(const journal of [workload,telemetry,queries])try{journal?.close();}catch{failed=true;}
    if(failed)throw new Error('Benchmark journal close failed');}
}
