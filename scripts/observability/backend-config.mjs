import { stringify } from 'yaml';

/** Fixed synthetic-backend profile; mounted files contain no host environment expansion. */
export function backendConfigs() {
  const collector = {
    receivers: { otlp: { protocols: { http: { endpoint: '0.0.0.0:4318' } } } },
    extensions: { health_check: { endpoint: '0.0.0.0:13133', path: '/ready' } },
    processors: {
      memory_limiter: { check_interval: '1s', limit_mib: 512, spike_limit_mib: 128 },
      batch: { timeout: '1s', send_batch_size: 128, send_batch_max_size: 256 },
    },
    exporters: Object.fromEntries([['logs', 'http://127.0.0.1:3100/otlp'], ['traces', 'http://127.0.0.1:4418']]
      .map(([signal, endpoint]) => [`otlp_http/${signal}`, { endpoint, timeout: '1s',
        retry_on_failure: { enabled: false }, sending_queue: { enabled: false } }])),
    service: { extensions: ['health_check'], pipelines: Object.fromEntries(['logs', 'traces'].map(signal =>
      [signal, { receivers: ['otlp'], processors: ['memory_limiter', 'batch'], exporters: [`otlp_http/${signal}`] }])) },
  };
  const loki = {
    auth_enabled: false,
    analytics: { reporting_enabled: false },
    server: { http_listen_port: 3100 },
    common: { instance_addr: '127.0.0.1', path_prefix: '/data/loki',
      storage: { filesystem: { chunks_directory: '/data/loki/chunks', rules_directory: '/data/loki/rules' } },
      replication_factor: 1, ring: { kvstore: { store: 'inmemory' } } },
    schema_config: { configs: [{ from: '2020-10-24', store: 'tsdb', object_store: 'filesystem', schema: 'v13',
      index: { prefix: 'index_', period: '24h' } }] },
    pattern_ingester: { lifecycler: { min_ready_duration: '1s' } },
    ingester: { lifecycler: { min_ready_duration: '1s' } },
    frontend: { scheduler_dns_lookup_period: '1s', address: '127.0.0.1' },
    query_scheduler: { use_scheduler_ring: false },
    limits_config: { allow_structured_metadata: true, otlp_config: { resource_attributes: {
      ignore_defaults: true, attributes_config: [{ action: 'index_label',
        attributes: ['service.namespace', 'service.name', 'deployment.environment.name'] }],
    } } },
  };
  return { 'otelcol-config.yaml': stringify(collector), 'loki-config.yaml': stringify(loki) };
}
