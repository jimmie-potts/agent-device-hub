import { setTimeout as delay } from 'node:timers/promises';
import { runScheduledWorkload } from './workload-driver.mjs';
import { runMeasurementSampling } from './measurement-sampling.mjs';
import { createBrightnessOperation } from './workload-operation.mjs';
import { applicationSnapshot, applicationSummary } from './application-measurement.mjs';
import { stackSummary } from './stack-measurement.mjs';
import { reconcileWorkload } from './workload-oracle.mjs';
import thresholds from './thresholds.json' with { type: 'json' };

/** Internal single-run collector. The caller owns the application, durable
 * journal, verified backend and frozen protocol/prerequisite gates. This result
 * does not establish ingestion, fault qualification or paired acceptance.
 * Injected clock/operation/sampler functions are source-test seams. */
export async function collectWorkloadWindow({ application, sampleStack, record, signal,
  clock = { now: () => performance.now(), wait: (ms, active) => delay(ms, undefined, { signal: active }) },
  operation, sampleApplication = options => applicationSnapshot(application.identity, options) }) {
  const control=new AbortController(), active=signal ? AbortSignal.any([signal,control.signal]) : control.signal;
  const events=[],applicationSamples=[],stackSamples=[];
  let stopping=false,earlyExit=false,workload,sampling,closed,failure=null;
  const save=event=>{
    const returned=record(event);
    if(returned && typeof returned.then==='function') {
      Promise.resolve(returned).catch(()=>{});throw new Error('Synchronous recorder required');
    }
  };
  application.closed.then(()=>{if(!stopping){earlyExit=true;control.abort();}},()=>{earlyExit=true;control.abort();});
  try {
    if(typeof sampleStack!=='function' || typeof record!=='function' || active.aborted)throw new Error('Workload window invalid');
    const execute=operation ?? createBrightnessOperation(application.ready);
    const startMs=clock.now()+100, measurementStartMs=startMs+thresholds.workload.warmup_seconds*1000;
    save({kind:'window-start',startMs,measurementStartMs,measurementEndMs:measurementStartMs+thresholds.workload.measurement_seconds*1000,
      identity:application.identity,resource:application.ready.resource});
    const run=runScheduledWorkload({startMs,clock,signal:active,operation:execute,record:event=>{
      save(event);events.push(event);
    }}).then(result=>{workload=result;if(!result.complete)control.abort();}).catch(error=>{control.abort();throw error;});
    const sample=runMeasurementSampling({startMs:measurementStartMs,clock,signal:active,
      sample:async options=>{
        const [app,stack]=await Promise.all([sampleApplication(options),sampleStack(options)]);
        return {application:app,stack};
      },record:event=>{
        save(event);
        if(event.kind==='sample'){applicationSamples.push(event.value.application);stackSamples.push(event.value.stack);}
      }}).then(result=>{sampling=result;if(!result.complete)control.abort();}).catch(error=>{control.abort();throw error;});
    const results=await Promise.allSettled([run,sample]);
    if(results.some(result=>result.status==='rejected'))failure='window-failed';
  } catch {failure='window-failed';control.abort();}
  finally {
    stopping=true;
    try {closed=await application.stop();}catch{failure='application-stop-failed';}
    control.abort();
  }
  if(earlyExit)failure='application-exited';
  let oracle=null,metrics=null;
  if(closed) {
    try {
      // Keep bounded individual rows, not one unbounded receipt array.
      for(const execution of closed.executions)save({kind:'execution',value:execution});
      const {executions,...terminal}=closed;save({kind:'application-closed',value:terminal});
      const {outcomes,...summary}=reconcileWorkload({events,closed});oracle=summary;
    } catch {failure??='oracle-evidence-failed';}
  }
  if(sampling?.coverageComplete) {
    try {metrics={application:applicationSummary(applicationSamples),stack:stackSummary(stackSamples)};}
    catch {failure??='measurement-invalid';}
  }
  const complete=!failure && workload?.complete===true && workload.operationFailures===0 && workload.omitted===0 &&
    sampling?.coverageComplete===true && oracle?.complete===true && metrics!==null;
  const result={scope:'single-workload-only',complete,failure,workload:workload??null,sampling:sampling??null,metrics,oracle,
    shutdown:closed?.result?.shutdown??null};
  save({kind:'window-result',value:result});
  return result;
}
