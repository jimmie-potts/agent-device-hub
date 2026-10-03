import {context, trace, ROOT_CONTEXT, SpanStatusCode} from '@opentelemetry/api';
import {createRecord, parseTraceparent, validateRecord} from '../dist/index.js';
import {createLogPipeline} from './log-pipeline.mjs';
import {createSpanPipeline} from './span-pipeline.mjs';
import {createOtlpTransport} from './otlp-http.mjs';
import {createOwnedOrigins} from './propagation.mjs';

const increment = value => Math.min(Number.MAX_SAFE_INTEGER, value + 1);
const noHost = Object.freeze({emit:()=>false,event:()=>false,counts:()=>({enabled:false}),
  tracerFor:()=>undefined,run:async(_options,action)=>action(),shutdown:async()=>{}});

/** One pending write at a time, bounded by the owning queue's abort deadline. */
export function streamSink(stream) {
  return (line, signal) => new Promise((resolve,reject) => {
    if(signal?.aborted){reject(new Error('diagnostic-write-aborted'));return;}
    let done=false;
    const finish=error=>{if(done)return;done=true;signal?.removeEventListener('abort',abort);error?reject(new Error('diagnostic-write-failed')):resolve();};
    const abort=()=>finish(true);
    signal?.addEventListener('abort',abort,{once:true});
    try {stream.write(line,error=>finish(error));} catch {finish(true);}
  });
}

/** Import is inert. Only the executable host explicitly constructs this runtime. */
export async function createHostDiagnostics({enabled=false,resource,tracing=false,samplingRatio=0.1,
  collectorOrigin,localSink,queueOptions} = {}) {
  if(enabled===false)return noHost;
  if(enabled!==true || typeof tracing!=='boolean' || !Number.isFinite(samplingRatio) || samplingRatio<0 || samplingRatio>1)
    throw new TypeError('Invalid host diagnostics configuration');
  const base=createRecord({timestamp:new Date().toISOString(),event_name:'process.started',severity_text:'INFO',
    resource,scope:{name:'bunny.host',version:'1.0.0'},attributes:{'bunny.operation':'startup','bunny.provenance':'source'}});
  if(!base.ok || !validateRecord({...base.value,resource}).ok)throw new TypeError('Invalid host resource');
  if(collectorOrigin!==undefined)createOwnedOrigins([collectorOrigin]);
  if(tracing && collectorOrigin===undefined)throw new TypeError('Tracing requires an explicit Collector');
  const local=localSink??streamSink(process.stderr);
  if(typeof local!=='function')throw new TypeError('Invalid host local sink');
  const transports=[];
  const transport=signal=>{const value=createOtlpTransport({origin:collectorOrigin,signal});transports.push(value);return value;};
  const logTransport=collectorOrigin===undefined?undefined:transport('logs');
  const logs=createLogPipeline({sink:logTransport?(line,signal)=>logTransport.send(line,signal):async()=>{},localSink:local,options:queueOptions});
  let provider,manager,spans,closing,closed=false,failures=0;
  try {
    if(tracing){
      const [{BasicTracerProvider,ParentBasedSampler,TraceIdRatioBasedSampler},{resourceFromAttributes},{AsyncLocalStorageContextManager}]=await Promise.all([
        import('@opentelemetry/sdk-trace-base'),import('@opentelemetry/resources'),import('@opentelemetry/context-async-hooks')]);
      const sender=transport('traces');
      spans=createSpanPipeline({sink:(line,signal)=>sender.send(line,signal),queueOptions});
      provider=new BasicTracerProvider({resource:resourceFromAttributes(base.value.resource),
        sampler:new ParentBasedSampler({root:new TraceIdRatioBasedSampler(samplingRatio)}),
        spanLimits:{attributeCountLimit:40,attributeValueLengthLimit:8192,eventCountLimit:0,linkCountLimit:0},
        spanProcessors:[spans.processor]});
      const candidate=new AsyncLocalStorageContextManager();
      if(!context.setGlobalContextManager(candidate))throw new Error('A tracing context owner already exists');
      manager=candidate;manager.enable();
    }
  } catch(error){await Promise.allSettled([logs.close(),provider?.shutdown()]);for(const sender of transports)sender.close();if(manager){context.disable();manager.disable();}throw error;}
  const safe=action=>{try{return action();}catch{failures=increment(failures);return false;}};
  const host={
    emit(record){if(closed)return false;return safe(()=>{spans?.observe(record);return logs.emit(record);});},
    event(eventName,scope='bunny.host',attributes={},severity='INFO'){
      return safe(()=>{const item=createRecord({timestamp:new Date().toISOString(),event_name:eventName,severity_text:severity,
        resource:base.value.resource,scope:{name:scope,version:'1.0.0'},attributes:{'bunny.provenance':'source',...attributes}});
        return item.ok&&host.emit(item.value);});
    },
    tracerFor(binding){return provider?spans.wrapTracer(provider.getTracer('bunny.host','1.1.0'),binding):undefined;},
    async run({scope,operation,spanName='bunny.helper.run',attributes={},root=false,traceparent,authenticated=false,owned=false,outcome},action){
      if(closed)return action();
      const started=performance.now();let active=root?ROOT_CONTEXT:context.active(),span;
      const fields={...attributes,'bunny.operation':operation,'bunny.provenance':'source'};
      safe(()=>{
        const incoming=parseTraceparent(traceparent,{authenticated,owned});
        if(incoming)active=trace.setSpanContext(ROOT_CONTEXT,{traceId:incoming.trace_id,spanId:incoming.span_id,traceFlags:parseInt(incoming.trace_flags,16)&1,isRemote:true});
        span=host.tracerFor({resource:base.value.resource,scope})?.startSpan(spanName,{attributes:fields},active);
        if(span)active=trace.setSpan(active,span);
      });
      const finish=(error,result)=>safe(()=>{
        let selected=error?'failed':'succeeded';
        if(!error&&typeof outcome==='function'){try{selected=outcome(result);}catch{failures=increment(failures);}}
        const identity=span?.spanContext();
        const correlation=identity&&trace.isSpanContextValid(identity)?{trace_id:identity.traceId,span_id:identity.spanId,trace_flags:(identity.traceFlags&1).toString(16).padStart(2,'0')}:{};
        const item=createRecord({...base.value,...correlation,timestamp:new Date().toISOString(),scope:{name:scope,version:'1.0.0'},
          event_name:error||['failed','rejected','uncertain','unavailable'].includes(selected)?'operation.failed':'operation.completed',severity_text:error||['failed','rejected','uncertain','unavailable'].includes(selected)?'WARN':'INFO',
          attributes:{...fields,'bunny.outcome':selected,'bunny.duration_ms':Math.min(86400000,Math.max(0,performance.now()-started))}});
        try{if(item.ok){host.emit(item.value);span?.setStatus({code:error?SpanStatusCode.ERROR:SpanStatusCode.UNSET});}}finally{span?.end();}
      });
      let result;
      const once=()=>{if(!result){try{result=Promise.resolve(action());}catch(error){result=Promise.reject(error);}}return result;};
      safe(()=>context.with(active,once));
      try{const value=await once();finish(false,value);return value;}catch(error){finish(true);throw error;}
    },
    counts(){return {enabled:true,failures,logs:{...logs.counts(),exported:logTransport?logs.counts().exported:0},
      traces:spans?.counts(),transport:transports.map(sender=>sender.counts())};},
    shutdown(){
      if(!closing){closed=true;closing=Promise.allSettled([logs.close(),provider?.shutdown()]).then(()=>{
        for(const sender of transports)sender.close();if(manager){context.disable();manager.disable();}
      });}return closing;
    },
  };
  return host;
}
