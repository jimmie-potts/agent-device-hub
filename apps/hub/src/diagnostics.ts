import {validate,type Request} from '@jimmie-potts/device-contracts';
import { context, trace, ROOT_CONTEXT, SpanKind, SpanStatusCode, type Span, type Tracer } from '@opentelemetry/api';
import { createRecord, parseTraceparent, traceHeaders, type DiagnosticRecord, type Primitive } from '@jimmie-potts/bunny-observability';
import { HttpError } from './common.js';

type Attributes = Record<string, Primitive>;
type CommandResponse = {status:number;body:{outcome:string}};
type Options = {
  resource:Record<string,string>;
  /** Host-owned bounded sink; no exporter is created by this adapter. */
  emit(record:DiagnosticRecord):unknown;
  tracer?:Pick<Tracer,'startSpan'>;
  /** Enable only when this host has no automatic HTTP propagation owner. */
  propagate?:boolean;
};
export type CommandDiagnostics = ReturnType<typeof createCommandDiagnostics>;
const outcome:Record<string,string> = {queued:'queued',sent:'transport-acknowledged',failed:'rejected',
  'partially-applied':'partial',uncertain:'uncertain',cancelled:'cancelled'};
export const diagnosticFailure = (error:unknown):Attributes => {
  const code = error instanceof HttpError ? error.code : undefined;
  if (code === 'uncertain-result') return {'bunny.outcome':'uncertain','bunny.reason':'transport-error','bunny.write.possible':true};
  if (code === 'unauthenticated' || code === 'forbidden') return {'bunny.outcome':'rejected','bunny.reason':'unauthorized','bunny.write.possible':false};
  if (code === 'capacity') return {'bunny.outcome':'rejected','bunny.reason':'busy','bunny.write.possible':false};
  if (['invalid-request','invalid-input','unknown-device','revision-conflict','stale-generation','request-conflict','request-expired','request-order','unsupported-capability'].includes(code ?? '')) {
    return {'bunny.outcome':'rejected','bunny.reason':'invalid-input','bunny.write.possible':false};
  }
  return {'bunny.outcome':'unavailable','bunny.reason':'unavailable','bunny.write.possible':code !== 'controller-unavailable'};
};

/** Explicitly enabled host adapter. It never records request bodies, headers or exceptions. */
export function createCommandDiagnostics(options:Options) {
  let failures = 0, invalidRecords = 0;
  const failed = () => { failures = Math.min(Number.MAX_SAFE_INTEGER, failures + 1); };
  return {
    counts:() => ({failures,invalidRecords}),
    /** Only ControllerClient's validated, authenticated owned endpoint calls this. */
    headers():Record<string,string> {
      if(options.propagate!==true)return {};
      try {
        const current=trace.getSpanContext(context.active());
        return current&&trace.isSpanContextValid(current)?traceHeaders({trace_id:current.traceId,span_id:current.spanId,
          trace_flags:(current.traceFlags&1).toString(16).padStart(2,'0')},{authenticated:true,owned:true}):{};
      } catch {failed();return {};}
    },
    /** Call only after HTTP authentication. A controller child inherits the active owned context. */
    async run<T extends CommandResponse>(scope:'bunny.http'|'bunny.controller', attributes:Attributes,
      action:()=>Promise<T>, inboundTraceparent?:unknown):Promise<T> {
      const started = performance.now();
      const base = createRecord({timestamp:new Date().toISOString(),event_name:'operation.completed',severity_text:'INFO',
        resource:options.resource,scope:{name:scope,version:'1.0.0'},
        attributes:{...attributes,'bunny.provenance':scope === 'bunny.controller' ? 'observation' : 'source'}});
      let span:Span|undefined;
      let active = ROOT_CONTEXT;
      try {
        if (scope === 'bunny.controller') active = context.active();
        if (scope === 'bunny.http') {
          const incoming = parseTraceparent(inboundTraceparent,{authenticated:true,owned:true});
          if (incoming) active = trace.setSpanContext(active,{traceId:incoming.trace_id,spanId:incoming.span_id,
            traceFlags:parseInt(incoming.trace_flags,16),isRemote:true});
        }
        if (base.ok) {
          span = (options.tracer ?? trace.getTracer(scope,'1.0.0')).startSpan('bunny.command.request',{
            kind:scope === 'bunny.http' ? SpanKind.SERVER : SpanKind.CLIENT,
            attributes:{...base.value.attributes,'bunny.schema.version':base.value.schema_version},
          },active);
          active = trace.setSpan(active,span);
        }
      } catch { failed(); }
      const finish = (fields:Attributes, error:boolean) => {
        try {
          const spanContext = span?.spanContext();
          const correlation = spanContext && trace.isSpanContextValid(spanContext) ? {
            trace_id:spanContext.traceId,span_id:spanContext.spanId,trace_flags:spanContext.traceFlags.toString(16).padStart(2,'0'),
          } : {};
          const record = base.ok ? createRecord({...base.value,...correlation,timestamp:new Date().toISOString(),
            event_name:error ? 'operation.failed' : 'operation.completed',severity_text:error ? 'WARN' : 'INFO',
            attributes:{...base.value.attributes,...fields,'bunny.duration_ms':Math.min(86400000,Math.max(0,performance.now()-started))}}) : base;
          if (record.ok) {
            try { span?.setAttributes(record.value.attributes);span?.setStatus({code:error?SpanStatusCode.ERROR:SpanStatusCode.UNSET}); } catch { failed(); }
            try { void Promise.resolve(options.emit(record.value)).catch(failed); } catch { failed(); }
          } else invalidRecords = Math.min(Number.MAX_SAFE_INTEGER,invalidRecords + 1);
        } catch { failed(); }
        finally { try { span?.end(); } catch { failed(); } }
      };
      // Cache the domain promise, ignoring a context manager's return value. Even
      // a manager that throws after invoking the callback cannot invoke it twice.
      let result:Promise<T>|undefined;
      const once = () => {
        if (!result) {
          // Invoke synchronously: deferring this call would change who acquires
          // the controller slot first when another operation starts this turn.
          try { result = Promise.resolve(action()); } catch (error) { result = Promise.reject(error); }
        }
        return result;
      };
      try { context.with(active,once); } catch { failed(); }
      try {
        const response = await once();
        finish({'bunny.outcome':outcome[response.body.outcome] ?? 'unavailable'},false);
        return response;
      } catch (error) {
        try { finish(diagnosticFailure(error),true); } catch { failed(); }
        throw error;
      }
    },
  };
}

/** Only schema-validated machine ticket fields enter diagnostics; payloads never do. */
export function commandDiagnosticAttributes(config:{controllerId:string;deviceId:string}, value:unknown):Attributes {
  const attributes:Attributes = {'bunny.controller.id':config.controllerId,'bunny.device.id':config.deviceId,'bunny.operation':'verification'};
  if (validate('request',value)) {
    const request = value as Request;
    if (request.command.kind === 'brightness.set') attributes['bunny.operation'] = 'brightness';
    attributes['bunny.ticket.epoch'] = request.requestId.epoch;
    attributes['bunny.ticket.sequence'] = request.requestId.sequence;
  }
  return attributes;
}
