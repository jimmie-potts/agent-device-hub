import assert from 'node:assert/strict';
import { register } from 'node:module';
register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);
const { NodeSDK } = await import('@opentelemetry/sdk-node');
const { resourceFromAttributes } = await import('@opentelemetry/resources');
const { AlwaysOnSampler, ParentBasedSampler } = await import('@opentelemetry/sdk-trace-base');
const { context, trace, ROOT_CONTEXT } = await import('@opentelemetry/api');
const { createOutgoingInstrumentation } = await import('../../instrumentation.mjs');
const { traceparentOnly } = await import('../../propagation.mjs');
const { createSpanPipeline } = await import('../../span-pipeline.mjs');
let origins = [];
const spans = [], streamed = [];
const resource = { 'service.namespace': 'bunny', 'service.name': 'bunny-tool', 'service.version': '1.0.0',
  'service.instance.id': '00000000-0000-4000-8000-000000000003', 'deployment.environment.name': 'test' };
const pipeline = createSpanPipeline({ sink: line => { streamed.push(JSON.parse(line)); } });
const sdk = new NodeSDK({ autoDetectResources: false,
  resource: resourceFromAttributes(resource),
  sampler: new ParentBasedSampler({ root: new AlwaysOnSampler() }),
  spanProcessors: [pipeline.processor, { onStart() {}, onEnd(span) { spans.push(span); }, async forceFlush() {}, async shutdown() {} }],
  logRecordProcessors: [], textMapPropagator: traceparentOnly,
  instrumentations: createOutgoingInstrumentation(() => origins),
});
sdk.start();
// Dynamic imports after hook registration and SDK startup are intentional.
const { createServer, get } = await import('node:http');
const observed = [];
async function server(label) {
  const value = createServer((req, res) => {
    observed.push({ label, headers: req.headers });
    res.end('synthetic');
  });
  await new Promise(resolve => value.listen(0, '127.0.0.1', resolve));
  return value;
}
const owned = await server('owned');
const excluded = await server('excluded');
origins = [`http://127.0.0.1:${owned.address().port}`];
const excludedOrigin = `http://127.0.0.1:${excluded.address().port}`;
const httpGet = url => new Promise((resolve, reject) => {
  get(url, res => { res.resume(); res.once('end', resolve); }).once('error', reject);
});
try {
  const tracer = pipeline.wrapTracer(trace.getTracer('bunny.http', '1.0.0'), { resource, scope: 'bunny.http' });
  const roots = [];
  await Promise.all([0, 1, 2].map(async index => {
    const span = tracer.startSpan('bunny.command.request', { attributes: { 'bunny.operation': 'verification', 'bunny.provenance': 'source' } }, ROOT_CONTEXT);
    roots.push(span.spanContext());
    try {
      await context.with(trace.setSpan(ROOT_CONTEXT, span), async () => {
        await httpGet(`${origins[0]}/SYNTHETIC_SECRET?index=${index}`);
        await (await fetch(`${origins[0]}/SYNTHETIC_SECRET?index=${index}`)).text();
        await httpGet(`${excludedOrigin}/SYNTHETIC_SECRET`);
        await (await fetch(`${excludedOrigin}/SYNTHETIC_SECRET`)).text();
      });
    } finally { span.end(); }
  }));
  assert.equal(new Set(roots.map(root => root.traceId)).size, 3);
  assert.equal(observed.length, 12);
  for (const request of observed) {
    assert.equal(request.headers.baggage, undefined);
    assert.equal(request.headers.tracestate, undefined);
    if (request.label === 'excluded') assert.equal(request.headers.traceparent, undefined);
    else assert.match(request.headers.traceparent, /^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);
  }
  for (const root of roots) {
    assert.equal(observed.filter(request => request.headers.traceparent?.includes(root.traceId)).length, 2);
    const children = spans.filter(span => span.parentSpanContext?.spanId === root.spanId);
    assert.equal(children.length, 2);
    assert.ok(children.every(span => span.spanContext().traceId === root.traceId));
  }
  assert.equal(spans.length, 9);
  assert.ok(spans.some(span => JSON.stringify(span.attributes).includes('SYNTHETIC_SECRET')),
    'privacy control must actually reach raw automatic instrumentation before projection');
  await pipeline.processor.forceFlush();
  assert.equal(streamed.length, 9);
  assert.equal(JSON.stringify(streamed).includes('SYNTHETIC_SECRET'), false);
  assert.equal(pipeline.counts().active, 0);
  assert.equal(pipeline.counts().invalid, 0);
  assert.equal(pipeline.counts().unassociated, 0);
  process.stdout.write('propagation verified\n');
} finally {
  await Promise.all([owned, excluded].map(value => new Promise(resolve => {
    value.close(resolve); value.closeAllConnections();
  })));
  await sdk.shutdown();
}
