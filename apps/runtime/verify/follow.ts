// Following one request through a disposable run's diagnostics (ADR 0012, "Observability", "Following one request"; Hub
// #950). The query reads what the run kept, the journal's log records and the recorded spans, and answers for one
// request ID or one trace: its records, its spans and what the run could not keep. It never reads a payload, a message
// or an error: every record and span must pass the diagnostic contract's validator, and the answer is built from the
// validated, registered values alone. What the contract refuses is counted and never shown. An absent record is reported
// as absent: the answer names each way the evidence can be incomplete, and no answer says that nothing happened.
import {catalog, createRecord, validateRecord, type DiagnosticRecord, type Primitive} from '@jimmie-potts/bunny-observability';

export const FOLLOW_SCHEMA = 'runtime-follow/1.0';
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;
/** How many trace IDs an answer names; a request that went out twice names two, and no run needs many more. */
const MAX_TRACES = 16;

export type Selector = {request: string} | {trace: string};
export type Limits = {records: number; spans: number};

/** One record of the run's journal, with the runtime that wrote it, as the supervisor kept it and not yet checked. */
export type JournalEntry = {generation: number; record: unknown};
/**
 * The run's spans: the lines of its span file, how many spans the file let go, and what the reader could not read.
 * `recorded: false` is a run with no span file, or one that could not be read.
 */
export type SpanEvidence =
  | {recorded: false; reason: 'not-recorded' | 'unreadable'}
  | {recorded: true; lines: readonly string[]; evicted: number | undefined; unreadable: number; truncated: boolean};
export type Evidence = {
  /** How many runtimes the run has started: the current one is live, and the ones before it have ended. */
  generation: number;
  /** The lowest level the runtime writes, so a reader knows what a lower one's absence means. */
  minimumLevel: string;
  journal: readonly JournalEntry[];
  spans: SpanEvidence;
};

/** A query that cannot be answered: its selector or its limits are not what the contract allows. Never echoes them. */
export class FollowRefusal extends Error {
  override readonly name = 'FollowRefusal';
  readonly code: 'invalid-selector' | 'invalid-limit';

  constructor(code: 'invalid-selector' | 'invalid-limit', message: string) {
    super(message);
    this.code = code;
  }
}

const REQUEST_ID = new RegExp(catalog.attributes['bunny.request.id'].pattern, 'u');
const TRACE_ID = /^(?!0{32}$)[0-9a-f]{32}$/;
const SPAN_ID = /^(?!0{16}$)[0-9a-f]{16}$/;
const COUNT = /^[1-9][0-9]{0,2}$/;

/** The one request ID or trace ID a query names, checked against the contract's patterns. */
export function selectorOf(input: {request?: string | null | undefined; trace?: string | null | undefined}): Selector {
  const {request, trace} = input;
  if ((request === undefined || request === null) === (trace === undefined || trace === null)) {
    throw new FollowRefusal('invalid-selector', 'name exactly one of a request ID or a trace ID');
  }
  if (typeof request === 'string') {
    if (!REQUEST_ID.test(request)) throw new FollowRefusal('invalid-selector', 'the request ID is not an identifier the contract allows');
    return {request};
  }
  if (typeof trace !== 'string' || !TRACE_ID.test(trace)) throw new FollowRefusal('invalid-selector', 'the trace ID is not 32 lowercase hexadecimal digits');
  return {trace};
}

function limit(value: string | null | undefined): number {
  if (value === undefined || value === null) return DEFAULT_LIMIT;
  if (!COUNT.test(value) || Number(value) > MAX_LIMIT) throw new FollowRefusal('invalid-limit', `a limit is a whole number from 1 to ${MAX_LIMIT}`);
  return Number(value);
}

/** The most records and spans an answer returns. */
export function limitsOf(input: {records?: string | null | undefined; spans?: string | null | undefined}): Limits {
  return {records: limit(input.records), spans: limit(input.spans)};
}

// Spans

type Parsed = {
  /** The neutral instance ID of the process that recorded the span: the key to the runtime that wrote it. */
  instance: string | undefined;
  name: string;
  kind: number;
  traceId: string;
  spanId: string;
  parentSpanId: string | undefined;
  links: {traceId: string; spanId: string}[];
  start: bigint;
  end: bigint;
  status: number;
  attributes: Record<string, Primitive>;
};

const KINDS = ['internal', 'server', 'client', 'producer', 'consumer'] as const;
const STATUSES = ['unset', 'ok', 'error'] as const;
const DIGITS = /^(0|[1-9][0-9]{0,19})$/;

const object = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const only = (value: unknown): unknown => Array.isArray(value) && value.length === 1 ? value[0] : undefined;
const string = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;

/** The nanoseconds of an OTLP time, or undefined for anything but a decimal string within an unsigned 64-bit integer. */
function nanos(value: unknown): bigint | undefined {
  if (typeof value !== 'string' || !DIGITS.test(value)) return undefined;
  const parsed = BigInt(value);
  return parsed <= 18446744073709551615n ? parsed : undefined;
}

/** An OTLP attribute list as a map of scalars. Anything else, a repeated key included, is not a span of the contract. */
function attributesOf(value: unknown): Record<string, Primitive> | undefined {
  if (!Array.isArray(value) || value.length > 64) return undefined;
  const map: Record<string, Primitive> = {};
  for (const item of value) {
    const entry = object(item);
    const key = string(entry?.key);
    const wrapped = object(entry?.value);
    if (key === undefined || wrapped === undefined || Object.hasOwn(map, key) || Object.keys(wrapped).length !== 1) return undefined;
    const [[type, scalar] = []] = Object.entries(wrapped);
    if (type === 'stringValue' && typeof scalar === 'string') map[key] = scalar;
    else if (type === 'boolValue' && typeof scalar === 'boolean') map[key] = scalar;
    else if (type === 'doubleValue' && typeof scalar === 'number' && Number.isFinite(scalar)) map[key] = scalar;
    else if (type === 'intValue' && typeof scalar === 'string' && /^-?[0-9]{1,16}$/.test(scalar) && Number.isSafeInteger(Number(scalar))) map[key] = Number(scalar);
    else return undefined;
  }
  return map;
}

/**
 * One projected OTLP span document as a span, only if it is shaped as the host adapter projects it and its resource,
 * scope and attributes pass the contract as the adapter checked them when the span started. Anything else is undefined.
 */
function parseSpan(line: string): Parsed | undefined {
  let document: unknown;
  try {
    document = JSON.parse(line);
  } catch {
    return undefined;
  }
  const group = object(only(object(document)?.resourceSpans));
  const scoped = object(only(group?.scopeSpans));
  const span = object(only(scoped?.spans));
  const resource = attributesOf(object(group?.resource)?.attributes);
  const scope = object(scoped?.scope);
  const attributes = attributesOf(span?.attributes);
  if (span === undefined || resource === undefined || scope === undefined || attributes === undefined) return undefined;
  const [traceId, spanId, parentSpanId, name] = [span.traceId, span.spanId, span.parentSpanId, span.name];
  const [start, end] = [nanos(span.startTimeUnixNano), nanos(span.endTimeUnixNano)];
  const kind = span.kind;
  const status = object(span.status)?.code;
  if (typeof traceId !== 'string' || !TRACE_ID.test(traceId) || typeof spanId !== 'string' || !SPAN_ID.test(spanId)) return undefined;
  if (parentSpanId !== undefined && (typeof parentSpanId !== 'string' || !SPAN_ID.test(parentSpanId))) return undefined;
  if (typeof name !== 'string' || !catalog.span_names.includes(name) || start === undefined || end === undefined || end < start) return undefined;
  if (typeof kind !== 'number' || !Number.isInteger(kind) || kind < 1 || kind > 5 || typeof status !== 'number' || !Number.isInteger(status) || status < 0 || status > 2) return undefined;
  const links: Parsed['links'] = [];
  if (span.links !== undefined) {
    if (!Array.isArray(span.links) || span.links.length > 8) return undefined;
    for (const item of span.links) {
      const link = object(item);
      if (typeof link?.traceId !== 'string' || !TRACE_ID.test(link.traceId) || typeof link.spanId !== 'string' || !SPAN_ID.test(link.spanId)) return undefined;
      links.push({traceId: link.traceId, spanId: link.spanId});
    }
  }
  // The checks the adapter made when the span started, as a record of an event its scope allows.
  const {['bunny.schema.version']: schemaVersion, ...registered} = attributes;
  const rules: Readonly<Record<string, {events: readonly string[]} | undefined>> = catalog.scope_rules;
  const rule = rules[String(scope.name)];
  const event = rule === undefined ? undefined : rule.events.includes('operation.completed') ? 'operation.completed' : rule.events[0];
  if (typeof schemaVersion !== 'string' || event === undefined || Object.keys(registered).length > 40) return undefined;
  const candidate = createRecord({
    schema_version: schemaVersion, timestamp: new Date(Number(start / 1_000_000n)).toISOString(), event_name: event, severity_text: 'INFO', resource,
    scope: {name: scope.name, version: scope.version}, attributes: registered,
  });
  const checked = candidate.ok ? validateRecord({...candidate.value, attributes: registered}) : candidate;
  if (!checked.ok) return undefined;
  const {['bunny.provenance']: _provenance, ...shown} = checked.value.attributes;
  return {
    instance: checked.value.resource['service.instance.id'], name, kind, traceId, spanId, parentSpanId, links, start, end, status, attributes: shown,
  };
}

// The answer

export type FollowedRecord = {
  generation: number;
  time?: string;
  level: string;
  event: string;
  scope: string;
  traceId?: string;
  spanId?: string;
  attributes: Record<string, Primitive>;
};

/**
 * How a span's parent stands in the evidence: `span`, a span that is kept; `caller`, the context a remote part sent,
 * which the run does not record; `stored-message`, the context a stored message carried, which is not a span either;
 * and `missing`, a parent that should be a span and is not kept: it was evicted, lost or never ended.
 */
export type SpanParent = {spanId: string; state: 'span' | 'caller' | 'stored-message' | 'missing'};

export type FollowedSpan = {
  /** The runtime that recorded it; absent when no record names that runtime. */
  generation?: number;
  name: string;
  kind: (typeof KINDS)[number];
  traceId: string;
  spanId: string;
  /** Absent for a root. */
  parent?: SpanParent;
  /** The contexts it links to without continuing them, such as a replay's stored context. */
  links: {traceId: string; spanId: string}[];
  /** Present when the span is in another trace and links to the one queried. */
  via?: 'link';
  startedAt: string;
  durationMs: number;
  status: (typeof STATUSES)[number];
  attributes: Record<string, Primitive>;
};

export type Ending = {generation: number; event: 'refused' | 'cancelled' | 'replied' | 'uncertain'; level: string; code?: string};

export type Gap =
  | {kind: 'generation-ended-without-stop'; generation: number}
  | {kind: 'telemetry-lost'; generation: number; dropped: number; failed: number}
  | {kind: 'spans-evicted'; count: number}
  | {kind: 'spans-eviction-unknown'}
  | {kind: 'spans-truncated'}
  | {kind: 'spans-not-recorded'}
  | {kind: 'spans-unreadable'}
  | {kind: 'unreadable'; records: number; spans: number}
  | {kind: 'parent-missing'; spans: number}
  | {kind: 'capped'; records: number; spans: number};

const MEANINGS: Readonly<Record<Gap['kind'], string>> = {
  'generation-ended-without-stop': 'This runtime ended without writing runtime.stopped, as after a crash or a kill. Records and spans it had not yet written, and its counts of lost telemetry, are unknown.',
  'telemetry-lost': 'This runtime said at its stop that its queues or the contract refused this many records and spans. They are not in the evidence.',
  'spans-evicted': 'The span file keeps the latest spans and let this many older ones go, so spans of older requests may be absent.',
  'spans-eviction-unknown': 'The span file does not say how many older spans it let go, so an absent span may have been evicted.',
  'spans-truncated': 'A span file was longer than its bound, so the read stopped there and later spans were not read.',
  'spans-not-recorded': 'This run has no span file, so no span is evidence either way.',
  'spans-unreadable': 'The run\'s span file could not be read, so no span is evidence either way.',
  'unreadable': 'Some records or spans were not valid contract records. They are counted and not shown.',
  'parent-missing': 'These spans continue a parent that is not in the evidence: it was evicted, lost or never ended.',
  'capped': 'The query left out matches beyond its limits. Raise a limit, or query by trace.',
};

export type FollowedGap = Gap & {meaning: string};

export type Followed = {
  schema: typeof FOLLOW_SCHEMA;
  query: Selector;
  limits: Limits;
  /** `none-found`: nothing in the evidence carries the ID, which says nothing of what happened; see the gaps. */
  result: 'found' | 'none-found';
  /** What was read: records and spans that passed the contract, those that did not, and the lowest level written. */
  searched: {records: number; spans: number; unreadableRecords: number; unreadableSpans: number; generations: number; minimumLevel: string};
  /** Matches before the limits. */
  matched: {records: number; spans: number};
  omitted: {records: number; spans: number};
  /** The traces of the matches, in the order they first appear. */
  traces: string[];
  /** Records and spans on those traces that the query did not match, such as another request's; query by trace to read them. */
  otherOnTrace: {records: number; spans: number};
  /** The bus's decisions among the matches. `ended`: every admitted command has an ending recorded. */
  decision: {admitted: number; ended: boolean; endings: Ending[]};
  /** How many matched spans have each name. A name no matched span has is not listed: it is absent, not zero evidence. */
  names: Record<string, number>;
  records: FollowedRecord[];
  spans: FollowedSpan[];
  gaps: FollowedGap[];
  note: string;
};

const NOTE_FOUND = 'Records below the minimum level are not written, telemetry queues drop under pressure and a runtime that ends abruptly loses what it had not written. A record or span that is not here is not evidence that nothing happened.';
const NOTE_NONE = 'No record or span in the evidence carries this ID. That is not evidence that nothing happened: see the gaps for what the run could not keep.';

const ENDINGS: readonly Ending['event'][] = ['refused', 'cancelled', 'replied', 'uncertain'];
const counted = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;

type Entry = {generation: number; record: DiagnosticRecord};

/**
 * Answers for one request or trace from what the run kept. A request matches the records and spans that carry its ID, and
 * never another request's, though they share a trace; a trace matches everything on it, and the spans of other traces
 * that link to it, such as a replay of work it began. The first matches in order are returned, up to the limits.
 */
export function follow(evidence: Evidence, selector: Selector, limits: Limits = {records: DEFAULT_LIMIT, spans: DEFAULT_LIMIT}): Followed {
  const entries: Entry[] = [];
  let unreadableRecords = 0;
  for (const {generation, record} of evidence.journal) {
    const checked = validateRecord(record);
    if (checked.ok) entries.push({generation, record: checked.value});
    else unreadableRecords += 1;
  }

  // Which runtime recorded a span: its instance ID is on every record that runtime wrote.
  const generations = new Map<string, number>();
  for (const {generation, record} of entries) {
    const instance = record.resource['service.instance.id'];
    if (instance !== undefined && !generations.has(instance)) generations.set(instance, generation);
  }

  const spans: Parsed[] = [];
  let unreadableSpans = 0;
  if (evidence.spans.recorded) {
    unreadableSpans = evidence.spans.unreadable;
    const seen = new Set<string>();
    for (const line of evidence.spans.lines) {
      const parsed = parseSpan(line);
      if (parsed === undefined) unreadableSpans += 1;
      else if (!seen.has(`${parsed.traceId}:${parsed.spanId}`)) {
        seen.add(`${parsed.traceId}:${parsed.spanId}`);
        spans.push(parsed);
      }
    }
  }
  spans.sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : 0);

  const byRequest = 'request' in selector;
  const matchesRecord = (record: DiagnosticRecord): boolean =>
    byRequest ? record.attributes['bunny.request.id'] === selector.request : record.trace_id === selector.trace;
  const matchesSpan = (span: Parsed): 'trace' | 'link' | undefined => {
    if (byRequest) return span.attributes['bunny.request.id'] === selector.request ? 'trace' : undefined;
    if (span.traceId === selector.trace) return 'trace';
    return span.links.some(link => link.traceId === selector.trace) ? 'link' : undefined;
  };

  const records = entries.filter(({record}) => matchesRecord(record));
  const found = spans.flatMap(span => {
    const via = matchesSpan(span);
    return via === undefined ? [] : [{span, via}];
  });

  const traces = [...new Set([...records.flatMap(({record}) => record.trace_id ?? []), ...found.map(({span}) => span.traceId)])];
  const onTrace = new Set(traces);
  const otherOnTrace = byRequest
    ? {
      records: entries.filter(({record}) => record.trace_id !== undefined && onTrace.has(record.trace_id) && !matchesRecord(record)).length,
      spans: spans.filter(span => onTrace.has(span.traceId) && matchesSpan(span) === undefined).length,
    }
    : {records: 0, spans: 0};

  // Parents: a kept span, the remote caller's context that a kept server request span continues, or a stored message's.
  const kept = new Set(spans.map(span => `${span.traceId}:${span.spanId}`));
  const callers = new Set(spans.flatMap(span => span.name === 'bunny.command.request' && span.kind === 2 && span.parentSpanId !== undefined ? [`${span.traceId}:${span.parentSpanId}`] : []));
  const parentOf = (span: Parsed): SpanParent | undefined => {
    if (span.parentSpanId === undefined) return undefined;
    const key = `${span.traceId}:${span.parentSpanId}`;
    const state = kept.has(key) ? 'span' : callers.has(key) ? 'caller' : span.name === 'bunny.outcome.publish' ? 'stored-message' : 'missing';
    return {spanId: span.parentSpanId, state};
  };

  const placed = found.map(({span, via}) => ({span, via, parent: parentOf(span)}));
  const shownSpans = placed.slice(0, limits.spans).map(({span, via, parent}): FollowedSpan => {
    const generation = span.instance === undefined ? undefined : generations.get(span.instance);
    return {
      ...(generation === undefined ? {} : {generation}), name: span.name, kind: KINDS[span.kind - 1] ?? 'internal', traceId: span.traceId, spanId: span.spanId,
      ...(parent === undefined ? {} : {parent}), links: span.links, ...(via === 'link' ? {via} : {}),
      startedAt: new Date(Number(span.start / 1_000_000n)).toISOString(), durationMs: Number((span.end - span.start) / 1000n) / 1000,
      status: STATUSES[span.status] ?? 'unset', attributes: span.attributes,
    };
  });
  const shownRecords = records.slice(0, limits.records).map(({generation, record}): FollowedRecord => {
    const {['bunny.provenance']: _provenance, ...attributes} = record.attributes;
    return {
      generation, ...(record.timestamp === undefined ? {} : {time: record.timestamp}), level: record.severity_text, event: record.event_name,
      scope: record.scope.name, ...(record.trace_id === undefined ? {} : {traceId: record.trace_id}), ...(record.span_id === undefined ? {} : {spanId: record.span_id}),
      attributes,
    };
  });

  const names: Record<string, number> = {};
  for (const {span} of found) names[span.name] = (names[span.name] ?? 0) + 1;
  const endings = records.flatMap(({generation, record}): Ending[] => {
    const event = ENDINGS.find(ending => record.event_name === `runtime.command.${ending}`);
    const code = record.attributes['bunny.code'];
    return event === undefined ? [] : [{generation, event, level: record.severity_text, ...(typeof code === 'string' ? {code} : {})}];
  });
  const admitted = records.filter(({record}) => record.event_name === 'runtime.command.admitted').length;

  const omitted = {records: records.length - shownRecords.length, spans: found.length - shownSpans.length};
  const gaps = gapsOf(evidence, entries, {
    unreadable: {records: unreadableRecords, spans: unreadableSpans}, omitted, parentsMissing: placed.filter(({parent}) => parent?.state === 'missing').length,
  });
  const result = records.length + found.length === 0 ? 'none-found' : 'found';
  return {
    schema: FOLLOW_SCHEMA, query: selector, limits, result,
    searched: {
      records: entries.length, spans: spans.length, unreadableRecords, unreadableSpans, generations: evidence.generation, minimumLevel: evidence.minimumLevel,
    },
    matched: {records: records.length, spans: found.length}, omitted, traces: traces.slice(0, MAX_TRACES), otherOnTrace,
    decision: {admitted, ended: endings.length > 0 && endings.length >= admitted, endings},
    names, records: shownRecords, spans: shownSpans, gaps, note: result === 'found' ? NOTE_FOUND : NOTE_NONE,
  };
}

/** The ways the evidence is incomplete, each with its fixed meaning. */
function gapsOf(
  evidence: Evidence, entries: readonly Entry[],
  seen: {unreadable: {records: number; spans: number}; omitted: {records: number; spans: number}; parentsMissing: number},
): FollowedGap[] {
  const gaps: Gap[] = [];
  const stops = new Map<number, DiagnosticRecord>();
  for (const {generation, record} of entries) if (record.event_name === 'runtime.stopped') stops.set(generation, record);
  // The current runtime is live; every one before it has ended, and a clean end writes runtime.stopped.
  for (let generation = 1; generation < evidence.generation; generation += 1) {
    const stop = stops.get(generation);
    if (stop === undefined) gaps.push({kind: 'generation-ended-without-stop', generation});
    else {
      const [dropped, failed] = [counted(stop.attributes['bunny.telemetry.dropped_count']), counted(stop.attributes['bunny.telemetry.failure_count'])];
      if (dropped + failed > 0) gaps.push({kind: 'telemetry-lost', generation, dropped, failed});
    }
  }
  if (!evidence.spans.recorded) gaps.push({kind: evidence.spans.reason === 'unreadable' ? 'spans-unreadable' : 'spans-not-recorded'});
  else {
    if (evidence.spans.evicted === undefined) {
      if (evidence.spans.lines.length > 0) gaps.push({kind: 'spans-eviction-unknown'});
    } else if (evidence.spans.evicted > 0) gaps.push({kind: 'spans-evicted', count: evidence.spans.evicted});
    if (evidence.spans.truncated) gaps.push({kind: 'spans-truncated'});
  }
  if (seen.unreadable.records + seen.unreadable.spans > 0) gaps.push({kind: 'unreadable', ...seen.unreadable});
  if (seen.parentsMissing > 0) gaps.push({kind: 'parent-missing', spans: seen.parentsMissing});
  if (seen.omitted.records + seen.omitted.spans > 0) gaps.push({kind: 'capped', ...seen.omitted});
  return gaps.map(gap => ({...gap, meaning: MEANINGS[gap.kind]}));
}
