import { startWorkloadProcess } from './workload-process.mjs';
import { createBrightnessOperation } from './workload-operation.mjs';
import { createDeliveryRecorder } from './delivery-records.mjs';
import { createWorkloadJournal, createTelemetryJournal, createQueryJournal } from './workload-journal.mjs';
import { reconcileWorkload } from './workload-oracle.mjs';
import { createBackendQueries } from './backend-queries.mjs';
import { verifyIngestion } from './ingestion-check.mjs';

/** Three sequential commands qualify prequeue evidence against the real backend.
 * Run only in a fresh continuously monitored backend session, with its released
 * contract installed. This is not the timed workload or paired pilot result. */
export async function performRecordedCommands({directory,plan,signal}) {
  const workload=createWorkloadJournal(directory);let telemetry,queries,application,closed;
  const events=[];let failure=null,accounting,oracle,ingestion;
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
    telemetry.sync();workload.sync();
    if(!accounting.complete || !oracle.complete)throw new Error('Command evidence incomplete');
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
        events:accounting.events,bytes:accounting.bytes}:null,oracle:oracle?{complete:oracle.complete,executed:oracle.executed}:null,ingestion:ingestion??null};
      workload.record({kind:'qualification-result',value:result});
      return result;
    } finally {
      let closeFailed=false;
      for(const journal of [workload,telemetry,queries])try{journal?.close();}catch{closeFailed=true;}
      if(closeFailed)throw new Error('Qualification journal close failed');
    }
  }
}
