import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parse } from 'yaml';
import { backendConfigs } from '../backend-config.mjs';

test('Collector accepts only the pilot signals and has one bounded nonretrying exporter per signal', () => {
  const config = parse(backendConfigs()['otelcol-config.yaml']);
  assert.deepEqual(Object.keys(config.receivers), ['otlp']);
  assert.deepEqual(Object.keys(config.receivers.otlp.protocols), ['http']);
  assert.equal(config.receivers.otlp.protocols.http.endpoint, '0.0.0.0:4318');
  assert.deepEqual(Object.keys(config.service.pipelines).sort(), ['logs', 'traces']);
  for (const signal of ['logs', 'traces']) {
    assert.deepEqual(config.service.pipelines[signal].exporters, ['otlp_http/' + signal]);
    const exporter = config.exporters['otlp_http/' + signal];
    assert.match(exporter.endpoint, /^http:\/\/127\.0\.0\.1:/);
    assert.equal(exporter.retry_on_failure.enabled, false);
    assert.equal(exporter.sending_queue.enabled, false);
  }
  assert.equal(config.processors.batch.send_batch_max_size, 256);
  assert.equal(config.processors.batch.timeout, '1s');
  assert.ok(config.processors.memory_limiter.limit_mib <= 512);
  assert.equal(JSON.stringify(config).includes('debug/'), false);
});

test('Loki indexes only stable service fields and preserves identities as structured metadata', () => {
  const config = parse(backendConfigs()['loki-config.yaml']);
  assert.equal(config.limits_config.allow_structured_metadata, true);
  const resource = config.limits_config.otlp_config.resource_attributes;
  assert.equal(resource.ignore_defaults, true);
  assert.deepEqual(resource.attributes_config, [{ action: 'index_label',
    attributes: ['service.namespace', 'service.name', 'deployment.environment.name'] }]);
  assert.equal(config.schema_config.configs[0].schema, 'v13');
  assert.equal(config.common.storage.filesystem.chunks_directory, '/data/loki/chunks');
  assert.equal(config.analytics.reporting_enabled, false);
});

test('configuration generation is deterministic and exposes no environment interpolation or override path', () => {
  const first = backendConfigs(); assert.deepEqual(backendConfigs(), first);
  assert.deepEqual(Object.keys(first).sort(), ['loki-config.yaml', 'otelcol-config.yaml']);
  for (const value of Object.values(first)) {
    assert.equal(value.includes('${'), false);
    assert.ok(Buffer.byteLength(value) < 8192);
  }
});
