import { createRecord, validateRecord } from '@jimmie-potts/bunny-observability';
import { createLogPipeline } from './log-pipeline.mjs';
import { createSpanPipeline } from './span-pipeline.mjs';
import { createOutgoingInstrumentation } from './instrumentation.mjs';
import { traceparentOnly } from './propagation.mjs';
let initialized = false;

/** Start once in a fresh pilot process, after registering the ESM hook and before application imports. */
export async function startPilotTelemetry({ resource, readOrigins = () => [], logSink, traceSink, localSink,
  logOptions, traceOptions }) {
  // Environment exporters, diagnostic console logging and disabled SDK flags are not pilot inputs.
  // Refuse them instead of mutating personal configuration or silently changing measured behavior.
  if (Object.keys(process.env).some(name => name.startsWith('OTEL_'))) {
    throw new Error('Ambient OpenTelemetry settings are not permitted in the pilot process');
  }
  if (initialized) throw new Error('Pilot telemetry requires a fresh process');
  if (typeof logSink !== 'function' || typeof traceSink !== 'function' || typeof readOrigins !== 'function') {
    throw new TypeError('Pilot telemetry requires explicit sinks and owned origins');
  }
  const candidate = createRecord({ timestamp: new Date().toISOString(), event_name: 'process.started', severity_text: 'INFO',
    resource, scope: { name: 'bunny.host', version: '1.0.0' }, attributes: { 'bunny.operation': 'startup', 'bunny.provenance': 'source' } });
  const checked = candidate.ok ? validateRecord({ ...candidate.value, resource }) : candidate;
  if (!checked.ok) throw new TypeError('Invalid pilot resource identity');
  const { NodeSDK } = await import('@opentelemetry/sdk-node');
  const { resourceFromAttributes } = await import('@opentelemetry/resources');
  const { ParentBasedSampler, AlwaysOnSampler } = await import('@opentelemetry/sdk-trace-base');
  const { trace } = await import('@opentelemetry/api');
  const logs = createLogPipeline({ sink: logSink, localSink, options: logOptions });
  const traces = createSpanPipeline({ sink: traceSink, queueOptions: traceOptions });
  const sdk = new NodeSDK({
    autoDetectResources: false, resource: resourceFromAttributes(checked.value.resource),
    sampler: new ParentBasedSampler({ root: new AlwaysOnSampler() }),
    spanLimits: { attributeCountLimit: 40, attributeValueLengthLimit: 8192, eventCountLimit: 0,
      linkCountLimit: 8, attributePerEventCountLimit: 0, attributePerLinkCountLimit: 0 },
    spanProcessors: [traces.processor], logRecordProcessors: [], metricReaders: [],
    textMapPropagator: traceparentOnly,
    instrumentations: createOutgoingInstrumentation(readOrigins),
  });
  initialized = true;
  try { sdk.start(); }
  catch (error) { await Promise.allSettled([sdk.shutdown(), logs.close()]); throw error; }
  let closing;
  return {
    emit(record) {
      if (validateRecord(record).ok) traces.observe(record);
      return logs.emit(record);
    },
    tracerFor(binding) { return traces.wrapTracer(trace.getTracer('bunny.pilot.host', '1.0.0'), binding); },
    counts: () => ({ logs: logs.counts(), traces: traces.counts() }),
    shutdown() {
      // Both signals flush concurrently; their individual one-second bounds do not add together.
      if (!closing) closing = Promise.all([logs.close(), sdk.shutdown()]).then(() => undefined);
      return closing;
    },
  };
}
