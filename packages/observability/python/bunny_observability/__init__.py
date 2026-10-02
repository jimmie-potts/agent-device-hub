"""B.U.N.N.Y. diagnostic contract. Importing this module starts no I/O or workers."""
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone
from functools import lru_cache
import json
from pathlib import Path
import re
from typing import Literal, NotRequired, TypedDict


class TraceContext(TypedDict):
    trace_id: str
    span_id: str
    trace_flags: str


class DiagnosticRecord(TypedDict):
    schema_version: Literal['1.0', '1.1']
    timestamp: NotRequired[str]
    observed_timestamp: NotRequired[str]
    severity_number: int
    severity_text: str
    event_name: str
    body: str
    resource: dict[str, str]
    scope: dict[str, str]
    attributes: dict[str, str | int | float | bool]
    trace_id: NotRequired[str]
    span_id: NotRequired[str]
    trace_flags: NotRequired[str]

ARTIFACT_VERSION = '1.0.0'
SCHEMA_VERSION = '1.1'
SEMANTIC_CONVENTIONS_VERSION = '1.44.0'
MAX_RECORD_BYTES = 8192
MAX_QUEUE_RECORDS = 1024
MAX_QUEUE_BYTES = 4 * 1024 * 1024
MAX_FLUSH_MS = 1000
MAX_SAFE_INTEGER = 9007199254740991


@lru_cache(maxsize=1)
def _definitions():
    from jsonschema import Draft202012Validator
    root = Path(__file__).resolve().parents[2] / 'src'
    catalog = json.loads((root / 'catalog.json').read_text(encoding='utf-8'))
    schema = json.loads((root / 'record.schema.json').read_text(encoding='utf-8'))
    return catalog, schema, Draft202012Validator(schema)


def _failure():
    return {'ok': False, 'code': 'invalid-record'}


def _snapshot(value, depth=0, budget=None):
    import math
    budget = [0] if budget is None else budget
    budget[0] += 1
    if budget[0] > 160 or depth > 4:
        raise ValueError('invalid-record')
    if type(value) is str and len(value) <= MAX_RECORD_BYTES:
        return value
    if type(value) is bool or value is None:
        return value
    if type(value) in (int, float) and math.isfinite(value):
        return value
    if type(value) is not dict or len(value) > 40:
        raise ValueError('invalid-record')
    result = {}
    for key, item in value.items():
        if type(key) is not str or len(key) > 128 or key == '__proto__':
            raise ValueError('invalid-record')
        result[key] = _snapshot(item, depth + 1, budget)
    return result


def _time(value):
    parsed = datetime.strptime(value, '%Y-%m-%dT%H:%M:%S.%fZ').replace(tzinfo=timezone.utc)
    delta = parsed - datetime(1970, 1, 1, tzinfo=timezone.utc)
    milliseconds = delta.days * 86400000 + delta.seconds * 1000 + delta.microseconds // 1000
    if milliseconds < 0 or milliseconds > 18446744073709:
        raise ValueError('invalid-record')
    return milliseconds


def _encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n'


def validate_record(value):
    try:
        value = _snapshot(value)
        catalog, _, validator = _definitions()
        if not validator.is_valid(value) or len(_encode(value).encode('utf-8')) > MAX_RECORD_BYTES:
            return _failure()
        if catalog['events'].get(value['event_name']) != value['body']:
            return _failure()
        if catalog['severities'].get(value['severity_text']) != value['severity_number']:
            return _failure()
        for key in ('timestamp', 'observed_timestamp'):
            if key in value:
                _time(value[key])
        attrs = value['attributes']
        if attrs['bunny.provenance'] == 'observation' and 'bunny.observed.service' not in attrs:
            return _failure()
        if attrs['bunny.provenance'] == 'source' and 'bunny.observed.service' in attrs:
            return _failure()
        return {'ok': True, 'value': value}
    except Exception:
        return _failure()


def parse_record(line):
    try:
        if type(line) is not str or len(line.encode('utf-8')) > MAX_RECORD_BYTES:
            return _failure()
        return validate_record(json.loads(line))
    except Exception:
        return _failure()


def encode_record(value):
    result = validate_record(value)
    return _encode(result['value']) if result['ok'] else None


def create_record(value):
    try:
        if type(value) is not dict:
            return _failure()
        catalog, schema, _ = _definitions()
        selected = {k: value[k] for k in schema['properties'] if k in value and k not in (
            'attributes', 'resource', 'scope', 'body', 'severity_number')}
        selected.setdefault('schema_version', SCHEMA_VERSION)
        selected['body'] = catalog['events'].get(selected.get('event_name'))
        selected['severity_number'] = catalog['severities'].get(selected.get('severity_text'))
        for key, keys in (('attributes', catalog['attributes']),
                          ('resource', schema['properties']['resource']['properties']),
                          ('scope', ('name', 'version'))):
            source = value.get(key)
            selected[key] = {k: source[k] for k in keys if type(source) is dict and k in source}
        return validate_record(selected)
    except Exception:
        return _failure()


def project_record(value, version):
    result = validate_record(value)
    if not result['ok'] or version not in ('1.0', '1.1'):
        return _failure()
    result['value']['schema_version'] = version
    if version == '1.0':
        result['value']['attributes'].pop('bunny.queue.depth', None)
    return validate_record(result['value'])


def _attributes(value):
    def scalar(item):
        if type(item) is str:
            return {'stringValue': item}
        if type(item) is bool:
            return {'boolValue': item}
        if int(item) == item:
            return {'intValue': str(int(item))}
        return {'doubleValue': item}
    return [{'key': k, 'value': scalar(v)} for k, v in sorted(value.items())]


def to_otlp(value):
    result = validate_record(value)
    if not result['ok']:
        return None
    record = result['value']
    log = dict(severityNumber=record['severity_number'], severityText=record['severity_text'],
               eventName=record['event_name'], body={'stringValue': record['body']},
               attributes=_attributes({**record['attributes'], 'bunny.schema.version': record['schema_version']}))
    for source, target in (('timestamp', 'timeUnixNano'), ('observed_timestamp', 'observedTimeUnixNano')):
        if source in record:
            log[target] = str(_time(record[source]) * 1000000)
    for source, target in (('trace_id', 'traceId'), ('span_id', 'spanId')):
        if source in record:
            log[target] = record[source]
    if 'trace_flags' in record:
        log['flags'] = int(record['trace_flags'], 16)
    return {'resourceLogs': [{'resource': {'attributes': _attributes(record['resource'])}, 'scopeLogs': [{
        'scope': record['scope'], 'schemaUrl': f'https://opentelemetry.io/schemas/{SEMANTIC_CONVENTIONS_VERSION}',
        'logRecords': [log]}]}]}


def severity_for(level):
    catalog, _, _ = _definitions()
    text = catalog['python_levels'].get(str(level))
    return {'severity_text': text, 'severity_number': catalog['severities'][text]} if text else None


def parse_traceparent(header, *, authenticated=False, owned=False):
    if authenticated is not True or owned is not True or type(header) is not str:
        return None
    match = re.fullmatch(r'00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})', header)
    if not match or not int(match[1], 16) or not int(match[2], 16):
        return None
    return dict(trace_id=match[1], span_id=match[2], trace_flags=match[3])


def trace_headers(context, *, authenticated=False, owned=False):
    if type(context) is not dict:
        return {}
    try:
        header = f"00-{context['trace_id']}-{context['span_id']}-{context['trace_flags']}"
        return {'traceparent': header} if parse_traceparent(header, authenticated=authenticated, owned=owned) else {}
    except Exception:
        return {}


class DiagnosticContext:
    def __init__(self):
        self._value = ContextVar('bunny_observability', default=None)

    def current(self):
        value = self._value.get()
        return dict(value) if value else None

    capture = current

    @contextmanager
    def run(self, value):
        headers = trace_headers(value, authenticated=True, owned=True)
        validated = parse_traceparent(headers.get('traceparent'), authenticated=True, owned=True)
        token = self._value.set(validated)
        try:
            yield
        finally:
            self._value.reset(token)


class NoopEmitter:
    def emit(self, value):
        return False

    def close(self):
        pass

    def counts(self):
        return dict(accepted=0, dropped=0, failed=0, queued=0, bytes=0)


noop = NoopEmitter()


class BoundedEmitter:
    """Explicit host-owned sink. One daemon thread; no retries or disk spool.

    The callback receives canonical NDJSON. A stalled callback may retain one
    bounded record until it returns; close never waits beyond flush_ms. Hosts
    must supply cancellable, bounded transports and dispose of them separately.
    """
    def __init__(self, sink, *, max_records=MAX_QUEUE_RECORDS,
                 max_bytes=MAX_QUEUE_BYTES, flush_ms=MAX_FLUSH_MS, minimum_severity=9):
        from collections import deque
        import threading
        def bounded(value, limit):
            return value if type(value) is int and 0 < value <= limit else limit
        self._max_records = bounded(max_records, MAX_QUEUE_RECORDS)
        self._max_bytes = bounded(max_bytes, MAX_QUEUE_BYTES)
        self._flush_seconds = bounded(flush_ms, MAX_FLUSH_MS) / 1000
        self._minimum = minimum_severity if minimum_severity in (1, 5, 9, 13, 17, 21) else 9
        self._sink = sink
        self._queue = deque()
        self._bytes = self._accepted = self._dropped = self._failed = 0
        self._closing = self._closed = False
        self._condition = threading.Condition()
        self._thread = threading.Thread(target=self._drain, name='bunny-diagnostics', daemon=True)
        self._thread.start()

    def _increment(self, field, count=1):
        setattr(self, field, min(MAX_SAFE_INTEGER, getattr(self, field) + count))

    def emit(self, value):
        result = create_record(value)
        line = encode_record(result['value']) if result['ok'] else None
        with self._condition:
            if self._closing or line is None:
                self._increment('_dropped')
                return False
            if result['value']['severity_number'] < self._minimum:
                return False
            size = len(line.encode('utf-8'))
            if len(self._queue) >= self._max_records or self._bytes + size > self._max_bytes:
                self._increment('_dropped')
                return False
            self._queue.append((line, size))
            self._bytes += size
            self._increment('_accepted')
            self._condition.notify_all()
            return True

    def _drain(self):
        while True:
            with self._condition:
                self._condition.wait_for(lambda: self._queue or self._closing)
                if self._closed or not self._queue:
                    return
                line, size = self._queue[0]
            error = False
            try:
                self._sink(line)
            except Exception:
                error = True
            with self._condition:
                if self._closed:
                    return
                if error:
                    self._increment('_failed')
                self._queue.popleft()
                self._bytes -= size
                self._condition.notify_all()

    def counts(self):
        with self._condition:
            return dict(accepted=self._accepted, dropped=self._dropped, failed=self._failed,
                        queued=len(self._queue), bytes=self._bytes)

    def close(self):
        import time
        deadline = time.monotonic() + self._flush_seconds
        with self._condition:
            if self._closed:
                return
            self._closing = True
            self._condition.notify_all()
            while self._queue and not self._closed:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                self._condition.wait(remaining)
            if not self._closed:
                self._closed = True
                self._increment('_dropped', len(self._queue))
                self._queue.clear()
                self._bytes = 0
                self._condition.notify_all()
