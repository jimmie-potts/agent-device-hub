import { startWorkloadProcess } from './workload-process.mjs';
import { createBrightnessOperation } from './workload-operation.mjs';
import { createDeliveryRecorder } from './delivery-records.mjs';
import { createWorkloadJournal, createTelemetryJournal, createQueryJournal } from './workload-journal.mjs';
import { reconcileWorkload } from './workload-oracle.mjs';
import { createBackendQueries } from './backend-queries.mjs';
import { verifyIngestion } from './ingestion-check.mjs';
import { assessCommandDiagnostics,assessFaultDiagnostics } from './command-evidence.mjs';
import { isDeepStrictEqual } from 'node:util';

/** Three sequential commands qualify prequeue evidence against the real backend.
 * Run only in a fresh continuously monitored backend session, with its released
 * contract installed. This is not the timed workload or paired pilot result. */
export async function performRecordedCommands({directory,plan,signal}) {
  const workload=createWorkloadJournal(directory);let telemetry,queries,application,closed;
  const events=[];let failure=null,accounting,oracle,ingestion,diagnostics;
  try {
    telemetry=createTelemetryJournal(directory);queries=createQueryJournal(directory);
    const recorder=createDeliveryRecorder({record:telemetry.record});
    application=await startWorkloadProcess(directory,{enabled:true,signal,onEvidence:recorder.accept,
      onStart:identity=>{workload.record({kind:'application-start',identity});workload.sync();}});
    const operation=createBrightnessOperation(application.ready),startNs=String(BigInt(Date.now())*1000000n);
    for(let ordinal=0;ordinal<3;ordinal++) {
      const dispatch={kind:'dispatch',ordinal,slot:ordinal};workload.record(dispatch);events.push(dispatch);
      const outcome=await operation({ordinal,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(2000)]):AbortSignal.timeout(2000)});
      const completion={kind:'completion',ordinal,slot:ordinal,failed:false,outcome};workload.record(completion);events.push(completion);
    }
    closed=await application.stop();
    const endNs=String(BigInt(Date.now()+1)*1000000n);
    for(const execution of closed.executions)workload.record({kind:'execution',value:execution});
    const {executions,...terminal}=closed;workload.record({kind:'application-closed',value:terminal});
    accounting=recorder.finish(closed.result?.counts??{});oracle=reconcileWorkload({events,closed});
    diagnostics=assessCommandDiagnostics({commands:events.filter(event=>event.kind==='completion').map(event=>event.outcome),
      logs:accounting.expectedLogs,spans:accounting.expectedSpans});
    telemetry.sync();workload.sync();
    if(!accounting.complete || !oracle.complete || !diagnostics.complete)throw new Error('Command evidence incomplete');
    ingestion=await verifyIngestion({expectedLogs:accounting.expectedLogs,expectedSpans:accounting.expectedSpans,startNs,endNs,signal,
      queries:createBackendQueries(plan,{forbidden:['SYNTHETIC_PRIVATE_CANARY']}),record:queries.record});
    queries.sync();
    if(ingestion.disposition!=='supported' || !ingestion.evidenceSaved)throw new Error('Ingestion incomplete');
  }catch{failure='recorded-command-qualification-failed';}
  finally {
    if(application && !closed) {
      try{closed=await application.stop();workload.record({kind:'interrupted-application',value:closed});}
      catch{failure='application-cleanup-unconfirmed';}
    }
    try {
      const result={scope:'delivery-ingestion-only',failure,accounting:accounting?{complete:accounting.complete,counts:accounting.counts,
        events:accounting.events,bytes:accounting.bytes}:null,oracle:oracle?{complete:oracle.complete,executed:oracle.executed}:null,
        diagnostics:diagnostics??null,ingestion:ingestion??null};
      workload.record({kind:'qualification-result',value:result});
      // eslint-disable-next-line no-unsafe-finally -- the result is returned after cleanup; the outer catch already recorded any failure
      return result;
    } finally {
      let closeFailed=false;
      for(const journal of [workload,telemetry,queries])try{journal?.close();}catch{closeFailed=true;}
      // eslint-disable-next-line no-unsafe-finally -- a journal close failure fails the qualification after cleanup
      if(closeFailed)throw new Error('Qualification journal close failed');
    }
  }
}

/** Fixed command-path faults with a healthy real Collector; distinct from
 * Collector-failure qualification and paired performance measurements. */
export async function performCommandFaults({directory,plan,signal}) {
  const workload=createWorkloadJournal(directory);let telemetry,queries,application;
  let failure=null,accounting,diagnostics,ingestion,startNs,endNs;const outcomes=[];
  try {
    telemetry=createTelemetryJournal(directory);queries=createQueryJournal(directory);
    const recorder=createDeliveryRecorder({record:event=>{
      if(JSON.stringify(event).includes('SYNTHETIC_PRIVATE_CANARY'))throw new Error('Private fixture reached diagnostics');
      telemetry.record(event);
    }});
    for(const enabled of [false,true]) {
      application=await startWorkloadProcess(directory,{enabled,purpose:'command-faults',signal,onEvidence:recorder.accept,
        onStart:identity=>{workload.record({kind:'application-start',enabled,identity});workload.sync();}});
      if(enabled)startNs=String(BigInt(Date.now())*1000000n);
      const qualification=await application.qualifyCommands(),closed=await application.stop();application=null;
      if(JSON.stringify(qualification).includes('SYNTHETIC_PRIVATE_CANARY'))throw new Error('Private fixture reached results');
      workload.record({kind:'command-qualification',enabled,value:qualification});
      for(const execution of closed.executions)workload.record({kind:'execution',enabled,value:execution});
      const {executions,...terminal}=closed;workload.record({kind:'application-closed',enabled,value:terminal});
      if(!qualification.complete || closed.code!==0 || closed.reason || !closed.result?.complete || closed.stderrBytes!==0 ||
        closed.result.oracle.effects!==6 || closed.result.oracle.historyDropped!==0 || executions.length!==6 ||
        new Set(executions.map(execution=>JSON.stringify(execution.requestId))).size!==6 ||
        executions.some((execution,index)=>execution.effects!==index+1) || closed.result.shutdown.applicationMs>2000 ||
        closed.result.shutdown.flushMs>1000)throw new Error('Fault command result incomplete');
      outcomes.push(qualification.cases);
      if(enabled) {
        endNs=String(BigInt(Date.now()+1)*1000000n);accounting=recorder.finish(closed.result.counts);
        diagnostics=assessFaultDiagnostics({qualification,logs:accounting.expectedLogs,spans:accounting.expectedSpans});
      }
    }
    telemetry.sync();workload.sync();
    if(!isDeepStrictEqual(outcomes[0],outcomes[1]) || !accounting.complete || !diagnostics.complete)throw new Error('Fault evidence mismatch');
    ingestion=await verifyIngestion({expectedLogs:accounting.expectedLogs,expectedSpans:accounting.expectedSpans,startNs,endNs,signal,
      queries:createBackendQueries(plan,{forbidden:['SYNTHETIC_PRIVATE_CANARY']}),record:queries.record});
    queries.sync();
    if(ingestion.disposition!=='supported' || !ingestion.evidenceSaved)throw new Error('Fault ingestion incomplete');
  }catch{failure='command-fault-qualification-failed';}
  finally {
    if(application)try{const closed=await application.stop();workload.record({kind:'interrupted-application',value:closed});}
      catch{failure='application-cleanup-unconfirmed';}
  }
  const result={scope:'command-faults-healthy-collection-only',failure,identicalOutcomes:outcomes.length===2&&isDeepStrictEqual(outcomes[0],outcomes[1]),
    cases:outcomes[1]??null,accounting:accounting?{complete:accounting.complete,counts:accounting.counts}:null,
    diagnostics:diagnostics??null,ingestion:ingestion??null};
  try {workload.record({kind:'qualification-result',value:result});return result;}
  finally {
    let closeFailed=false;
    for(const journal of [workload,telemetry,queries])try{journal?.close();}catch{closeFailed=true;}
    // eslint-disable-next-line no-unsafe-finally -- a journal close failure fails the qualification after cleanup
    if(closeFailed)throw new Error('Qualification journal close failed');
  }
}
