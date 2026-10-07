// One log record as a diagnostic-contract record (docs/observability-contract.md, profile 1.4), as both threads build
// it: the watchdog's thread loads only this file and the contract's pure entry point, never the SDK.
import {catalog, createRecord, type DiagnosticRecord} from '@jimmie-potts/bunny-observability';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type LogRecord = DiagnosticRecord;
/** `deployment.environment.name`: the contract's three environments. */
export type Environment = 'development' | 'test' | 'production';
export const ENVIRONMENTS: readonly Environment[] = ['development', 'test', 'production'];

/** The runtime's version, its records' `service.version`. A test keeps it equal to the package's. */
export const RUNTIME_VERSION = '0.1.0';
/**
 * The contract profile of the runtime's records and spans: 1.2 registers its service, scopes, events and attributes
 * (Hub #903), 1.3 its decision records, outbox and device records and span names (Hub #949), and 1.4 the gateway's
 * route and method on the edge's refusals and the credentials reload (Hub #835).
 */
export const SCHEMA_VERSION = '1.4';
/** The scope of the runtime's own records. */
export const RUNTIME_SCOPE = 'bunny.runtime';
/** The one scope of every module's records; the `bunny.module` attribute names the module. */
export const MODULE_SCOPE = 'bunny.module';
/** The version of both scopes. */
export const SCOPE_VERSION = '1.0.0';

export type Resource = {
  'service.namespace': 'bunny';
  'service.name': 'runtime';
  'service.version': string;
  'service.instance.id': string;
  'deployment.environment.name': Environment;
};

/** The runtime's resource: its service and version, the process's neutral instance ID and the environment. */
export function runtimeResource(environment: Environment, instanceId: string): Resource {
  return {
    'service.namespace': 'bunny', 'service.name': 'runtime', 'service.version': RUNTIME_VERSION,
    'service.instance.id': instanceId, 'deployment.environment.name': environment,
  };
}

const SEVERITY = {debug: 'DEBUG', info: 'INFO', warn: 'WARN', error: 'ERROR', fatal: 'FATAL'} as const satisfies Record<LogLevel, string>;
export const LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error', 'fatal'];

export type TraceIds = {traceId: string; spanId: string; flags: string};
export type Attributes = Readonly<Record<string, string | number | boolean>>;

const REQUEST_ID = new RegExp(catalog.attributes['bunny.request.id'].pattern, 'u');

/**
 * The attributes without a request ID that `bunny.request.id`'s profile 1.0 pattern refuses, such as a 2.0 `requestId`
 * with a leading underscore. The record or span keeps everything else rather than be dropped whole; its trace and
 * message ID still name the request (Hub #949).
 */
export function withoutForeignIds(attributes: Attributes): Attributes {
  const {['bunny.request.id']: requestId, ...rest} = attributes;
  return typeof requestId === 'string' && !REQUEST_ID.test(requestId) ? rest : attributes;
}

/**
 * The contract record, built by the contract's own `createRecord`: the event's registered static body, the severity
 * pair, the resource, the scope and its version, and `bunny.provenance` `source`. Attributes the catalog does not
 * register are left out, so no other field reaches a record, and so is a request ID the attribute's pattern refuses.
 * Undefined when the contract refuses the record whole, as for an unregistered event, an event outside its scope, a
 * value outside its registered type or a missing resource field: an invalid record is dropped, never truncated.
 */
export function record(level: LogLevel, scope: string, event: string, attributes: Attributes, timeMs: number, resource: Resource, ids?: TraceIds): LogRecord | undefined {
  const built = createRecord({
    schema_version: SCHEMA_VERSION, timestamp: new Date(timeMs).toISOString(), severity_text: SEVERITY[level], event_name: event,
    resource, scope: {name: scope, version: SCOPE_VERSION}, attributes: {...withoutForeignIds(attributes), 'bunny.provenance': 'source'},
    ...(ids === undefined ? {} : {trace_id: ids.traceId, span_id: ids.spanId, trace_flags: ids.flags}),
  });
  return built.ok ? built.value : undefined;
}
