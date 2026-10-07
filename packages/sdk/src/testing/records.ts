// The kit's check of a module's log records (Hub #903). The runtime writes each record a module logs as a
// diagnostic-contract record, profile 1.3, under the one `bunny.module` scope with the module's name in the
// `bunny.module` attribute. It drops a record whose event the catalog does not register for modules and leaves out
// attributes the catalog does not register, so the kit fails a module that relies on either. A request ID that the
// attribute's 1.x pattern refuses is left out too, and the record is kept (Hub #949). A new event or attribute goes
// through a catalog change in `@jimmie-potts/bunny-observability`.
import {catalog, validateRecord} from '@jimmie-potts/bunny-observability';
import {traceFields} from '../trace.js';
import type {HarnessRecord} from './harness.js';

const SEVERITY = {debug: 'DEBUG', info: 'INFO', warn: 'WARN', error: 'ERROR'} as const satisfies Record<HarnessRecord['level'], string>;
const severities: Readonly<Record<string, number>> = catalog.severities;
const events: Readonly<Record<string, string>> = catalog.events;
const attributes: Readonly<Record<string, unknown>> = catalog.attributes;
const REQUEST_ID = new RegExp(catalog.attributes['bunny.request.id'].pattern, 'u');
/** A neutral stand-in for the runtime's resource; the check is about the module's part of the record. */
const RESOURCE = {
  'service.namespace': 'bunny', 'service.name': 'runtime', 'service.version': 'unknown',
  'service.instance.id': '00000000-0000-4000-8000-000000000000', 'deployment.environment.name': 'test',
};

/**
 * Why the runtime would not write this record of the named module whole, or undefined when it would. The answer names
 * the event and attribute keys, never a value, since a value may be what should not be logged.
 */
export function checkModuleRecord(module: string, entry: HarnessRecord): string | undefined {
  const allowed: readonly string[] = catalog.scope_rules['bunny.module'].events;
  if (!allowed.includes(entry.event)) return `${entry.event} is not a registered module event`;
  const unregistered = Object.keys(entry.fields).filter(key => !Object.hasOwn(attributes, key));
  if (unregistered.length > 0) return `${entry.event} has an unregistered attribute: ${unregistered.join(', ')}`;
  const ids = entry.trace === undefined ? undefined : traceFields(entry.trace);
  const text = SEVERITY[entry.level];
  const {['bunny.request.id']: requestId, ...rest} = entry.fields;
  // As the runtime does, a request ID that the pattern refuses is left out; a value of another type is no ID and fails.
  const fields = typeof requestId === 'string' && !REQUEST_ID.test(requestId) ? rest : entry.fields;
  const checked = validateRecord({
    schema_version: '1.3', timestamp: new Date().toISOString(), severity_number: severities[text], severity_text: text,
    event_name: entry.event, body: events[entry.event], resource: RESOURCE, scope: {name: 'bunny.module', version: '1.0.0'},
    attributes: {...fields, 'bunny.module': module, 'bunny.provenance': 'source'},
    ...(ids === undefined ? {} : {trace_id: ids.traceId, span_id: ids.spanId, trace_flags: ids.flags}),
  });
  return checked.ok ? undefined : `${entry.event} has a value outside its registered type, or is over the size limit`;
}
