import {createHash} from 'node:crypto';
import {evaluatePair} from './measurement.mjs';
const maximum=values=>values.length===2&&values.every(Number.isFinite)?Math.max(...values):undefined;

/** Summarize retained runs without relaxing missing evidence or rounding metrics.
 * Run summaries are produced by the bounded runner, never a user pass override. */
export function summarizeBenchmarkPair({condition,number,runs}) {
  if(!['healthy','unavailable'].includes(condition)||![1,2,3].includes(number)||!Array.isArray(runs)||runs.length>2 ||
    runs.some(run=>run.condition!==condition||typeof run.enabled!=='boolean')||new Set(runs.map(run=>run.enabled)).size!==runs.length)
    throw new Error('Benchmark pair invalid');
  const baseline=runs.find(run=>!run.enabled),enabled=runs.find(run=>run.enabled),both=!!baseline&&!!enabled;
  const every=predicate=>both?runs.every(predicate):undefined;
  const metrics=run=>run?{...run.window?.workload?.measurement,cpuCores:run.window?.metrics?.application?.meanCpuCores,
    peakRssBytes:run.window?.metrics?.application?.peakRssBytes}:undefined;
  const max=read=>maximum(runs.map(read));
  const ingestion=enabled?.ingestion;
  const pair={condition,baseline:metrics(baseline),enabled:metrics(enabled),
    stack:{peakRssBytes:max(run=>run.window?.metrics?.stack?.peakRssBytes),meanCpuCores:max(run=>run.window?.metrics?.stack?.meanCpuCores)},
    shutdown:{applicationSeconds:max(run=>run.window?.shutdown?.applicationMs/1000),flushSeconds:max(run=>run.window?.shutdown?.flushMs/1000),
      containerSeconds:max(run=>typeof run.teardownMs==='number'?run.teardownMs/1000:undefined)},
    evidence:{privacyFailures:max(run=>run.privacyFailures),contextIsolationFailures:enabled?.diagnostics?.correlationFailures,
      duplicateSideEffects:max(run=>run.window?.oracle?.duplicateExecutions),
      identicalCommandOutcomes:both&&baseline.outcomesDigest&&enabled.outcomesDigest?baseline.outcomesDigest===enabled.outcomesDigest:undefined,
      boundedQueues:every(run=>run.boundedQueues===true),accountedFaultLoss:enabled?.accounting?.complete,
      measurementCoverage:every(run=>run.window?.sampling?.coverageComplete===true),
      workloadEvidence:every(run=>run.window?.oracle?.complete===true),
      healthyRecordsLost:ingestion?.logs&&ingestion?.spans?[ingestion.logs,ingestion.spans].reduce((sum,rows)=>sum+(rows.missingRecords??rows.missing.reduce((n,item)=>n+item.count,0)),0):undefined}};
  const evaluation=evaluatePair(pair);
  for(const [name,complete] of [
    ['sourceRunCompleteness',every(run=>run.complete&&run.backendComplete&&run.cleanupComplete)],
    ['diagnosticStructure',enabled?.diagnostics?.complete],['deliveryAccounting',enabled?.accounting?.complete],
    ...(condition==='healthy'?[['healthyIngestion',ingestion?.disposition==='supported'&&ingestion.evidenceSaved===true]]:[]),
  ]) evaluation.checks[name]=complete===true?{status:'pass',value:true,expected:true}:{status:'missing',expected:true};
  const statuses=Object.values(evaluation.checks).map(check=>check.status);
  evaluation.disposition=statuses.includes('fail')?'refuted':statuses.includes('missing')?'inconclusive':'supported';
  return {number,condition,pair,evaluation};
}

/** Completion order may differ with valid concurrent requests. Compare by the
 * consumed command ordinal; the independent oracle verifies concrete tickets. */
export function commandOutcomesDigest(events) {
  if(!Array.isArray(events)||!events.length||events.length>1800||new Set(events.map(e=>e.ordinal)).size!==events.length)
    throw new Error('Command outcomes invalid');
  const rows=[...events].sort((a,b)=>a.ordinal-b.ordinal).map(event=>{
    const outcome=event.outcome,receipt=outcome?.receipt;
    return {ordinal:event.ordinal,slot:event.slot,failed:event.failed,status:outcome?.status,validReceipt:outcome?.validReceipt,
      receipt:receipt?Object.fromEntries(Object.entries(receipt).filter(([key])=>key!=='requestId')):null};
  });
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
