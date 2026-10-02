import { catalog, createRecord, validateRecord } from '@jimmie-potts/bunny-observability';
import { expectedLog, readTempoSpans } from './query-records.mjs';
const sorted=value=>JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))));
const fields=['expected','exported','failed','dropped','pending','inFlight','evidenceFailed'];
const empty=()=>Object.fromEntries(fields.map(key=>[key,0]));
const identity=value=>typeof value==='string' && /^[a-f0-9]{32}:[a-f0-9]{16}$/.test(value) &&
  !value.split(':').some(part=>/^0+$/.test(part));

/** Parent-side bounded canonical evidence. Invalid data is rejected before the
 * durable callback; summaries never infer missing identities from counters. */
export function createDeliveryRecorder({record}) {
  if(typeof record!=='function')throw new Error('Delivery recorder invalid');
  const entries={logs:new Map(),traces:new Map()},spanIds=new Set();
  let failed=false,events=0,bytes=0;
  const invalid=()=>{failed=true;throw new Error('Delivery evidence invalid');};
  function accept(event) {
    if(failed || !event || !['logs','traces'].includes(event.signal) || !Number.isInteger(event.id) || event.id<1 || event.id>25000 ||
      !['expected','projected','exported','failed','dropped','pending'].includes(event.phase))return invalid();
    const hasValue=['expected','projected'].includes(event.phase);
    if(Object.keys(event).sort().join(',')!==(hasValue?'id,phase,signal,value':'id,phase,signal'))return invalid();
    const size=Buffer.byteLength(JSON.stringify(event));
    if(size>16384 || ++events>75000 || (bytes+=size)>96*1024*1024)return invalid();
    const map=entries[event.signal];let entry=map.get(event.id),projection;
    if(event.phase==='expected') {
      if(entry || event.id!==map.size+1 || entries.logs.size+entries.traces.size>=25000)return invalid();
      if(event.signal==='logs') {
        if(!validateRecord(event.value).ok)return invalid();
      } else {
        const value=event.value;
        if(!value || Object.keys(value).sort().join(',')!=='name,resource,scope,spanId,traceId' ||
          !identity(value.traceId+':'+value.spanId) || !catalog.span_names.includes(value.name))return invalid();
        const candidate=createRecord({timestamp:'2026-10-02T00:00:00.000Z',event_name:'operation.completed',severity_text:'INFO',
          resource:value.resource,scope:value.scope,attributes:{'bunny.operation':'verification','bunny.provenance':'source'}});
        if(!candidate.ok || !validateRecord({...candidate.value,resource:value.resource,scope:value.scope}).ok ||
          spanIds.has(value.traceId+':'+value.spanId))return invalid();
      }
    } else {
      if(!entry || entry.phase!==null)return invalid();
      if(event.phase==='projected') {
        if(event.signal!=='traces' || entry.projection)return invalid();
        try {projection=readTempoSpans({trace:event.value},entry.value.traceId);}catch{return invalid();}
        const span=projection[0];
        if(projection.length!==1 || span.spanId!==entry.value.spanId || span.name!==entry.value.name ||
          sorted(span.scope)!==sorted(entry.value.scope) ||
          sorted(Object.fromEntries(Object.entries(span.resource).map(([key,value])=>[key,value.stringValue])))!==sorted(entry.value.resource))return invalid();
      } else if((event.phase==='pending' && (event.signal!=='traces' || entry.projection)) ||
        (event.phase==='exported' && event.signal==='traces' && !entry.projection))return invalid();
    }
    try {
      const result=record(structuredClone(event));
      if(result && typeof result.then==='function'){Promise.resolve(result).catch(()=>{});return invalid();}
    }catch{return invalid();}
    if(event.phase==='expected') {
      entry={value:structuredClone(event.value),phase:null,projection:null};map.set(event.id,entry);
      if(event.signal==='traces')spanIds.add(event.value.traceId+':'+event.value.spanId);
    } else if(event.phase==='projected')entry.projection=projection[0];
    else entry.phase=event.phase;
  }
  function finish(source={}) {
    const counts={logs:empty(),traces:empty()};let complete=!failed;
    for(const signal of ['logs','traces']) {
      const values=[...entries[signal].values()], actual=counts[signal], reported=source[signal];
      actual.expected=values.length;
      for(const entry of values)actual[entry.phase??'inFlight']++;
      if(actual.inFlight)complete=false;
      if(reported) {
        if(fields.some(key=>reported.evidence?.[key]!==actual[key]))complete=false;
        if(signal==='logs') {
          if(['exported','failed','dropped'].some(key=>reported[key]!==actual[key]) || reported.queued!==actual.inFlight ||
            reported.attempted-reported.invalid-reported.filtered!==actual.expected)complete=false;
        } else {
          const projected=values.filter(entry=>entry.projection), output=reported.output;
          if(!output || output.attempted!==projected.length || output.queued!==0 || output.observationFailed!==0 ||
            ['exported','failed','dropped'].some(key=>output[key]!==projected.filter(entry=>entry.phase===key).length))complete=false;
        }
      } else if(values.length)complete=false;
    }
    return {complete,failed,events,bytes,counts,
      expectedLogs:[...entries.logs.values()].map(entry=>expectedLog(entry.value)),
      expectedSpans:[...entries.traces.values()].filter(entry=>entry.projection).map(entry=>entry.projection),
      identities:Object.fromEntries(['logs','traces'].map(signal=>[signal,[...entries[signal]].map(([id,entry])=>({id,phase:entry.phase,
        ...(signal==='traces'?{traceId:entry.value.traceId,spanId:entry.value.spanId}:{}),projected:!!entry.projection}))]))};
  }
  return {accept,finish};
}
