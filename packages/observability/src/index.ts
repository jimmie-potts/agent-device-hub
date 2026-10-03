import check from './validator.js';
import catalogData from './catalog.json' with {type:'json'};
import schema from './record.schema.json' with {type:'json'};

export const ARTIFACT_VERSION = '1.1.0';
export const SCHEMA_VERSION = '1.1';
export const SEMANTIC_CONVENTIONS_VERSION = '1.44.0';
export const MAX_RECORD_BYTES = 8192;
export const MAX_QUEUE_RECORDS = 1024;
export const MAX_QUEUE_BYTES = 4 * 1024 * 1024;
export const MAX_FLUSH_MS = 1000;
export type Primitive = string | number | boolean;
export type TraceContext = Readonly<{trace_id:string; span_id:string; trace_flags:string}>;
export type DiagnosticRecord = {
  schema_version:'1.0'|'1.1'; timestamp?:string; observed_timestamp?:string;
  severity_number:number; severity_text:string; event_name:string; body:string;
  resource:Record<string,string>; scope:{name:string;version:string};
  attributes:Record<string,Primitive>; trace_id?:string; span_id?:string; trace_flags?:string;
};
export type Result<T> = {ok:true; value:T} | {ok:false; code:'invalid-record'};
const encoder = new TextEncoder();
const failure = ():Result<never> => ({ok:false,code:'invalid-record'});
const events:Record<string,string> = catalogData.events;
const severities:Record<string,number> = catalogData.severities;
export const catalog = Object.freeze(structuredClone(catalogData));

// Only bounded JSON data is accepted. Do not call getters or toJSON methods.
function snapshot(input:unknown, depth=0, budget={nodes:0}):unknown {
  if (++budget.nodes>160 || depth>4) throw new Error('invalid-record');
  if (typeof input==='string') { if(input.length>MAX_RECORD_BYTES)throw new Error('invalid-record'); return input; }
  if (typeof input==='number') { if(!Number.isFinite(input))throw new Error('invalid-record'); return input; }
  if (typeof input==='boolean' || input===null) return input;
  if (typeof input!=='object' || Array.isArray(input) || Object.getPrototypeOf(input)!==Object.prototype) throw new Error('invalid-record');
  const out:Record<string,unknown>={}; let count=0;
  for(const key in input) {
    if(!Object.hasOwn(input,key))continue;
    if(++count>40 || key.length>128)throw new Error('invalid-record');
    const property=Object.getOwnPropertyDescriptor(input,key);
    if(!property || !('value' in property) || key==='__proto__')throw new Error('invalid-record');
    out[key]=snapshot(property.value,depth+1,budget);
  }
  return out;
}
function validTime(value:string):boolean {
  const time=Date.parse(value);
  return Number.isFinite(time) && time>=0 && time<=18446744073709 && new Date(time).toISOString()===value;
}
export function validateRecord(input:unknown):Result<DiagnosticRecord> {
  try {
    const value=snapshot(input) as DiagnosticRecord;
    if(!check(value) || encoder.encode(JSON.stringify(value)+'\n').length>MAX_RECORD_BYTES)return failure();
    if(events[value.event_name]!==value.body || severities[value.severity_text]!==value.severity_number)return failure();
    if(value.timestamp && !validTime(value.timestamp) || value.observed_timestamp && !validTime(value.observed_timestamp))return failure();
    if(value.attributes['bunny.provenance']==='observation' && !value.attributes['bunny.observed.service'])return failure();
    if(value.attributes['bunny.provenance']==='source' && value.attributes['bunny.observed.service']!==undefined)return failure();
    return {ok:true,value};
  } catch { return failure(); }
}
export function parseRecord(line:unknown):Result<DiagnosticRecord> {
  try {
    if(typeof line!=='string' || encoder.encode(line).length>MAX_RECORD_BYTES)return failure();
    return validateRecord(JSON.parse(line));
  } catch {return failure();}
}
export function encodeRecord(input:unknown):string|undefined {
  const result=validateRecord(input);
  return result.ok ? JSON.stringify(result.value)+'\n' : undefined;
}
function own(input:unknown,key:string):unknown {
  if(input===null || typeof input!=='object')return undefined;
  const descriptor=Object.getOwnPropertyDescriptor(input,key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}
// Projection precedes any serialization. Unknown keys and raw errors are never read.
export function createRecord(input:unknown):Result<DiagnosticRecord> {
  try {
    const value:Record<string,unknown>={};
    for(const key of Object.keys(schema.properties)) {
      if(['attributes','resource','scope','body','severity_number'].includes(key))continue;
      const raw=own(input,key); if(raw!==undefined)value[key]=raw;
    }
    if(value.schema_version===undefined)value.schema_version=SCHEMA_VERSION;
    if(typeof value.event_name!=='string' || typeof value.severity_text!=='string')return failure();
    value.body=events[value.event_name];
    value.severity_number=severities[value.severity_text];
    for(const [key,keys] of [
      ['attributes',Object.keys(catalogData.attributes)],
      ['resource',Object.keys(schema.properties.resource.properties)],
      ['scope',['name','version']],
    ] as const) {
      const selected:Record<string,unknown>={}; const source=own(input,key);
      for(const field of keys) {const raw=own(source,field);if(raw!==undefined)selected[field]=raw;}
      value[key]=selected;
    }
    return validateRecord(value);
  } catch {return failure();}
}
export function projectRecord(input:unknown,version:'1.0'|'1.1'):Result<DiagnosticRecord> {
  const result=validateRecord(input);
  if(!result.ok || !['1.0','1.1'].includes(version))return failure();
  result.value.schema_version=version;
  if(version==='1.0')delete result.value.attributes['bunny.queue.depth'];
  return validateRecord(result.value);
}
const anyValue=(value:Primitive):Record<string,unknown> => typeof value==='string'?{stringValue:value}:
  typeof value==='boolean'?{boolValue:value}:Number.isInteger(value)?{intValue:String(value)}:{doubleValue:value};
const otlpAttributes=(value:Record<string,Primitive>)=>Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>({key,value:anyValue(v)}));
const nanos=(value:string)=>String(BigInt(Date.parse(value))*1000000n);
export function toOtlp(input:unknown):{resourceLogs:Array<{resource:unknown;scopeLogs:Array<{scope:unknown;schemaUrl:string;logRecords:Array<Record<string,unknown>>}>}>}|undefined {
  const result=validateRecord(input);if(!result.ok)return undefined;
  const r=result.value;
  const log:Record<string,unknown>={severityNumber:r.severity_number,severityText:r.severity_text,eventName:r.event_name,
    body:{stringValue:r.body},attributes:otlpAttributes({...r.attributes,'bunny.schema.version':r.schema_version})};
  if(r.timestamp)log.timeUnixNano=nanos(r.timestamp);
  if(r.observed_timestamp)log.observedTimeUnixNano=nanos(r.observed_timestamp);
  if(r.trace_id)log.traceId=r.trace_id;
  if(r.span_id)log.spanId=r.span_id;
  if(r.trace_flags)log.flags=parseInt(r.trace_flags,16);
  return {resourceLogs:[{resource:{attributes:otlpAttributes(r.resource)},scopeLogs:[{scope:r.scope,
    schemaUrl:`https://opentelemetry.io/schemas/${SEMANTIC_CONVENTIONS_VERSION}`,logRecords:[log]}]}]};
}
export function queryRecords(records:unknown[],query:Record<string,Primitive>):DiagnosticRecord[] {
  if(records.length>10000)return [];
  const keys=new Set(['service.name','event_name','severity_number','trace_id',...Object.keys(catalogData.attributes)]);
  if(Object.keys(query).some(key=>!keys.has(key)))return [];
  return records.flatMap(raw=>{const r=validateRecord(raw);if(!r.ok)return [];
    return Object.entries(query).every(([key,value])=>
      (key==='service.name'?r.value.resource[key]:key in r.value?r.value[key as keyof DiagnosticRecord]:r.value.attributes[key])===value)?[r.value]:[];});
}
export function severityFor(language:'pino'|'python',level:number):{severity_text:string;severity_number:number}|undefined {
  const map:Record<string,string>=language==='pino'?catalogData.pino_levels:catalogData.python_levels;
  const text=map[String(level)];return text?{severity_text:text,severity_number:severities[text]}:undefined;
}
export function parseTraceparent(header:unknown, boundary:{authenticated:boolean;owned:boolean}):TraceContext|undefined {
  if(boundary.authenticated!==true || boundary.owned!==true || typeof header!=='string')return undefined;
  const match=/^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(header);
  if(!match || /^0+$/.test(match[1]) || /^0+$/.test(match[2]))return undefined;
  return Object.freeze({trace_id:match[1],span_id:match[2],trace_flags:match[3]});
}
export function traceHeaders(context:TraceContext|undefined,boundary:{authenticated:boolean;owned:boolean}):Record<string,string> {
  if(!context)return {};
  const header=`00-${context.trace_id}-${context.span_id}-${context.trace_flags}`;
  return parseTraceparent(header,boundary)?{traceparent:header}:{};
}
export const noop = Object.freeze({emit:(_record:unknown)=>false,close:async()=>undefined,
  counts:()=>({accepted:0,dropped:0,failed:0,queued:0,bytes:0})});
