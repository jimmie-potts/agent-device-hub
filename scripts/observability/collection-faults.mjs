import {setTimeout as delay} from 'node:timers/promises';
import {isDeepStrictEqual} from 'node:util';
import {startWorkloadProcess} from './workload-process.mjs';
import {createBrightnessOperation} from './workload-operation.mjs';
import {createDeliveryRecorder} from './delivery-records.mjs';
import {createWorkloadJournal,createTelemetryJournal} from './workload-journal.mjs';
import {reconcileWorkload} from './workload-oracle.mjs';
import {assessCommandDiagnostics} from './command-evidence.mjs';
import {probeBackendHealth} from './backend-health.mjs';

// Fixed saturation workload, distinct from the 20/s overhead benchmark. Two
// fresh applications each execute 200 sequential commands without retries.
export async function performCollectionFaults({directory,plan,receipt,backend,condition,signal}) {
  if(!['paused','absent'].includes(condition))throw new Error('Collection condition invalid');
  const workload=createWorkloadJournal(directory);let telemetry,application,identity;
  let failure=null,restored=false,accounting,diagnostics;const outcomes=[];
  const record=event=>{workload.record(event);workload.sync();};
  async function inspect(){const value=await backend.collector(plan,receipt,'inspect',undefined,{signal});
    record({kind:'collector-state',value});return value;}
  async function effect(action,options={signal}) {
    record({kind:'collector-intent',action,identity});
    const result=await backend.collector(plan,receipt,action,identity,options);
    record({kind:'collector-returned',value:result});
  }
  async function observeState(predicate) {
    const deadline=performance.now()+5000;
    do {const state=await inspect();if(predicate(state))return state;
      await delay(50,undefined,{signal});}while(performance.now()<deadline);
    throw new Error('Collector state unconfirmed');
  }
  try {
    telemetry=createTelemetryJournal(directory);
    const recorder=createDeliveryRecorder({record:event=>{
      if(JSON.stringify(event).includes('SYNTHETIC_PRIVATE_CANARY'))throw new Error('Private fixture reached diagnostics');
      telemetry.record(event);
    }});
    const initial=await inspect();
    if(!initial.present || ['T','t'].includes(initial.state))throw new Error('Collector initial state invalid');
    identity={pid:initial.pid,startTicks:initial.startTicks};
    await effect(condition==='paused'?'pause':'terminate');
    await observeState(value=>condition==='absent'?!value.present:
      value.pid===identity.pid&&value.startTicks===identity.startTicks&&['T','t'].includes(value.state));
    for(const enabled of [false,true]) {
      const events=[];
      application=await startWorkloadProcess(directory,{enabled,purpose:'collection-faults',signal,onEvidence:recorder.accept,
        onStart:identity=>record({kind:'application-start',enabled,identity})});
      const operation=createBrightnessOperation(application.ready),started=performance.now();
      for(let ordinal=0;ordinal<200;ordinal++) {
        const dispatch={kind:'dispatch',ordinal,slot:ordinal};events.push(dispatch);workload.record({...dispatch,enabled});
        const outcome=await operation({ordinal,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(2000)]):AbortSignal.timeout(2000)});
        const completion={kind:'completion',ordinal,slot:ordinal,failed:false,outcome};events.push(completion);workload.record({...completion,enabled});
      }
      const commandMs=performance.now()-started,closed=await application.stop();application=null;
      for(const execution of closed.executions)workload.record({kind:'execution',enabled,value:execution});
      const {executions,...terminal}=closed;record({kind:'application-closed',enabled,commandMs,value:terminal});
      const oracle=reconcileWorkload({events,closed});
      if(!oracle.complete || closed.stderrBytes!==0 || closed.result.shutdown.applicationMs>2000 || closed.result.shutdown.flushMs>1000)
        throw new Error('Collection fault altered commands or shutdown');
      outcomes.push(oracle.outcomes.map(({ordinal,status,receipt})=>({ordinal,status,...Object.fromEntries(
        Object.entries(receipt).filter(([key])=>key!=='requestId'))})));
      if(enabled) {
        accounting=recorder.finish(closed.result.counts);
        diagnostics=assessCommandDiagnostics({commands:events.filter(event=>event.kind==='completion').map(event=>event.outcome),
          logs:accounting.expectedLogs,spans:accounting.expectedSpans});
        if(!accounting.complete || !diagnostics.complete || Object.values(accounting.counts).some(value=>value.exported!==0 || value.failed===0 || value.pending!==0 || value.inFlight!==0) ||
          (condition==='paused' && Object.values(accounting.counts).some(value=>value.dropped===0)))throw new Error('Collection fault evidence incomplete');
      }
    }
    if(!isDeepStrictEqual(outcomes[0],outcomes[1]))throw new Error('Collection fault outcomes differ');
    const final=await inspect();
    if(condition==='absent'?final.present:final.pid!==identity.pid || final.startTicks!==identity.startTicks || !['T','t'].includes(final.state))
      throw new Error('Collector fault state changed');
  }catch{failure='collection-fault-qualification-failed';}
  finally {
    if(application)try{const closed=await application.stop();record({kind:'interrupted-application',value:closed});}
      catch{failure='application-cleanup-unconfirmed';}
    if(condition==='paused' && identity) {
      // Fresh identity readback determines whether restoration is necessary.
      // A failed/ambiguous signal is never blindly repeated; whole-session
      // teardown remains the independent bounded cleanup path.
      try {
        const current=await backend.collector(plan,receipt,'inspect');record({kind:'collector-restoration-state',value:current});
        // eslint-disable-next-line no-unsafe-finally -- the enclosing catch handles this throw
        if(current.pid!==identity.pid || current.startTicks!==identity.startTicks)throw new Error('Collector identity changed');
        if(['T','t'].includes(current.state))await effect('resume',{});
        const deadline=performance.now()+5000;
        do {
          const health=await probeBackendHealth(plan,{timeoutMs:1000});
          if(health.ready){restored=true;break;}
          await delay(50);
        }while(performance.now()<deadline);
        record({kind:'collector-restored',restored});
        if(!restored)failure='collector-restoration-unconfirmed';
      }catch{failure='collector-restoration-unconfirmed';}
    }
  }
  const result={scope:'collection-faults-only',condition,failure,restored:condition==='paused'?restored:null,
    identicalOutcomes:outcomes.length===2&&isDeepStrictEqual(outcomes[0],outcomes[1]),commandsPerMode:200,
    accounting:accounting?{complete:accounting.complete,counts:accounting.counts}:null,diagnostics:diagnostics??null};
  try{record({kind:'qualification-result',value:result});return result;}
  finally {let closeFailed=false;for(const journal of [workload,telemetry])try{journal?.close();}catch{closeFailed=true;}
    // eslint-disable-next-line no-unsafe-finally -- a journal close failure fails the qualification after cleanup
    if(closeFailed)throw new Error('Collection journal close failed');}
}
