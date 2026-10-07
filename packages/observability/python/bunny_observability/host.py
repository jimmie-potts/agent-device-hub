"""Explicit host runtime. Importing this module starts no thread or exporter."""
from contextlib import contextmanager, nullcontext
from datetime import datetime, timezone
import json
import threading
import time
from . import (BoundedEmitter, create_record, validate_record, encode_record, to_otlp,
               parse_traceparent, MAX_RECORD_BYTES, MAX_QUEUE_BYTES, MAX_QUEUE_RECORDS,
               MAX_SAFE_INTEGER, SCHEMA_VERSION, _definitions, _profile_span_names)


class _Lines(BoundedEmitter):
    """Reuse the contract's serial drain with already-projected bounded payloads."""
    def emit_line(self, line):
        size = len(line.encode('utf-8'))
        with self._condition:
            if self._closing or size > MAX_RECORD_BYTES or len(self._queue) >= self._max_records or self._bytes + size > self._max_bytes:
                self._increment('_dropped')
                return False
            self._queue.append((line, size))
            self._bytes += size
            self._increment('_accepted')
            self._condition.notify_all()
            return True

    def close_until(self, deadline):
        with self._condition:
            self._closing = True
            self._condition.notify_all()
            while self._queue and not self._closed and time.monotonic() < deadline:
                self._condition.wait(max(0, deadline - time.monotonic()))
            if not self._closed:
                self._closed = True
                self._increment('_dropped', len(self._queue))
                self._queue.clear()
                self._bytes = 0
                self._condition.notify_all()


class _Transport:
    def __init__(self, origin, signal):
        from urllib.parse import urlsplit
        u = urlsplit(origin)
        if (u.scheme != 'http' or u.hostname not in ('127.0.0.1', '::1') or u.username or u.password
                or u.path or u.query or u.fragment or origin != f'http://{u.netloc}'):
            raise ValueError('invalid-collector-origin')
        self._signal = signal
        self._host, self._port, self._path = u.hostname, u.port or 80, '/v1/' + signal
        self._lock = threading.Lock()
        self._connection = None
        self._socket = None
        self._closed = False
        self.accepted = self.failed = 0

    def _cancel(self, expected=None):
        import socket
        with self._lock:
            connection = self._connection
            sock = self._socket
            if expected is not None and connection is not expected:
                return
        if connection:
            if sock:
                try: sock.shutdown(socket.SHUT_RDWR)
                except OSError: pass
            connection.close()

    def send(self, payload):
        from http.client import HTTPConnection
        body = json.dumps(payload, separators=(',', ':')).encode('utf-8')
        if len(body) > 65536:
            raise ValueError('oversize-otlp')
        with self._lock:
            if self._closed:
                raise ValueError('closed-transport')
            connection = HTTPConnection(self._host, self._port, timeout=0.5)
            self._connection = connection
        timer = threading.Timer(0.9, lambda: self._cancel(connection))
        timer.daemon = True
        timer.start()
        try:
            connection.request('POST', self._path, body, {'Content-Type':'application/json','Accept-Encoding':'identity'})
            with self._lock:
                self._socket = connection.sock
                cancelled = self._closed
            if cancelled:
                self._cancel(connection)
                raise ValueError('closed-transport')
            response = connection.getresponse()
            if response.status != 200 or response.getheader('Content-Type','').split(';')[0].strip() != 'application/json':
                raise ValueError('rejected-otlp')
            data = response.read(8193)
            if len(data) > 8192 or response.getheader('Content-Encoding','identity') != 'identity':
                raise ValueError('invalid-otlp-response')
            value = json.loads(data)
            if type(value) is not dict:
                raise ValueError('invalid-otlp-response')
            partial = value.get('partialSuccess')
            if partial is not None:
                if type(partial) is not dict:
                    raise ValueError('invalid-otlp-response')
                rejected = partial.get('rejectedLogRecords' if self._signal == 'logs' else 'rejectedSpans', 0)
                if type(rejected) not in (int, str) or rejected not in (0, 1, '0', '1') or ('errorMessage' in partial and type(partial['errorMessage']) is not str):
                    raise ValueError('invalid-otlp-response')
                if int(rejected):
                    raise ValueError('partial-otlp-rejection')
            self.accepted = min(MAX_SAFE_INTEGER, self.accepted + 1)
        except Exception:
            self.failed = min(MAX_SAFE_INTEGER, self.failed + 1)
            raise
        finally:
            timer.cancel()
            connection.close()
            with self._lock:
                if self._connection is connection:
                    self._connection = None
                    self._socket = None

    def close(self):
        with self._lock:
            self._closed = True
        self._cancel()


class HostDiagnostics:
    def __init__(self, *, enabled=False, resource=None, collector_origin=None, tracing=False,
                 sampling_ratio=0.1, local_sink=None):
        self._enabled = enabled
        self._logs = self._traces = self._provider = None
        self._transports = []
        self._closed = False
        self._failures = 0
        if enabled is False:
            return
        if enabled is not True or type(tracing) is not bool or type(sampling_ratio) not in (int, float) or not 0 <= sampling_ratio <= 1:
            raise ValueError('invalid-host-diagnostics')
        base = create_record(dict(timestamp=self._now(), event_name='process.started', severity_text='INFO',
                                 resource=resource, scope=dict(name='bunny.host', version='1.0.0'), attributes={'bunny.provenance':'source'}))
        if not base['ok'] or not validate_record({**base['value'], 'resource':resource})['ok']:
            raise ValueError('invalid-host-resource')
        self._resource = base['value']['resource']
        if tracing and collector_origin is None:
            raise ValueError('tracing-requires-collector')
        if local_sink is None:
            import sys
            local_sink = sys.stderr.write
        if not callable(local_sink):
            raise ValueError('invalid-local-sink')
        log_transport = _Transport(collector_origin, 'logs') if collector_origin is not None else None
        if log_transport:
            self._transports.append(log_transport)
        if tracing:
            from opentelemetry.sdk.trace import TracerProvider, SpanLimits
            from opentelemetry.sdk.resources import Resource
            from opentelemetry.sdk.trace.sampling import ParentBased, TraceIdRatioBased
            self._provider = TracerProvider(sampler=ParentBased(TraceIdRatioBased(sampling_ratio)),
                resource=Resource(self._resource), shutdown_on_exit=False,
                span_limits=SpanLimits(max_attributes=0, max_events=0, max_links=0))
            self._tracer = self._provider.get_tracer('bunny.host', '1.1.0')
            sender = _Transport(collector_origin, 'traces')
            self._transports.append(sender)
            self._traces = _Lines(lambda line: sender.send(json.loads(line)))
        def log_send(line):
            failure = False
            try: local_sink(line)
            except Exception: failure = True
            if log_transport:
                log_transport.send(to_otlp(json.loads(line)))
            if failure:
                raise ValueError('local-sink-failed')
        self._logs = _Lines(log_send)

    @staticmethod
    def _now():
        return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')

    def emit(self, record):
        if not self._enabled or self._closed:
            return False
        try:
            checked = validate_record(record)
            line = encode_record(checked['value']) if checked['ok'] else None
            return bool(line and checked['value']['severity_number'] >= 9 and self._logs.emit_line(line))
        except Exception:
            self._failures = min(MAX_SAFE_INTEGER, self._failures + 1)
            return False

    def event(self, event_name, scope='bunny.host', attributes=None, severity='INFO'):
        if not self._enabled or self._closed:
            return False
        try:
            record = create_record(dict(timestamp=self._now(), event_name=event_name, severity_text=severity,
                resource=self._resource, scope=dict(name=scope, version='1.0.0'),
                attributes={'bunny.provenance':'source', **(attributes or {})}))
            return record['ok'] and self.emit(record['value'])
        except Exception:
            self._failures = min(MAX_SAFE_INTEGER, self._failures + 1)
            return False

    def capture_context(self):
        if not self._provider:
            return None
        from opentelemetry.context import get_current
        return get_current()

    @contextmanager
    def run_context(self, captured):
        if captured is None:
            yield
            return
        from opentelemetry.context import attach, detach
        token = attach(captured)
        try: yield
        finally: detach(token)

    @contextmanager
    def operation(self, scope, operation, *, span_name='bunny.helper.run', attributes=None,
                  root=False, traceparent=None, authenticated=False, owned=False):
        if not self._enabled or self._closed:
            yield
            return
        start = time.time_ns()
        monotonic_start = time.monotonic_ns()
        span = None
        active = nullcontext()
        fields = {'bunny.provenance':'source', **(attributes or {}), 'bunny.operation':operation}
        try:
            # The host's records are the default profile, so its spans take only that profile's names.
            if self._provider and span_name in _profile_span_names(_definitions()[0], SCHEMA_VERSION):
                from opentelemetry import trace
                from opentelemetry.context import Context
                parent = Context() if root else None
                incoming = parse_traceparent(traceparent, authenticated=authenticated, owned=owned)
                if incoming:
                    remote = trace.SpanContext(int(incoming['trace_id'],16), int(incoming['span_id'],16), True,
                                               trace.TraceFlags(int(incoming['trace_flags'],16) & 1))
                    parent = trace.set_span_in_context(trace.NonRecordingSpan(remote), Context())
                span = self._tracer.start_span(span_name, context=parent, start_time=start)
                active = trace.use_span(span, end_on_exit=False, record_exception=False, set_status_on_exception=False)
        except Exception:
            self._failures = min(MAX_SAFE_INTEGER, self._failures + 1)
        failed = False
        try:
            with active:
                try: yield
                except BaseException:
                    failed = True
                    raise
        finally:
            try:
                elapsed = max(0, time.monotonic_ns() - monotonic_start)
                end = start + elapsed
                identity = span.get_span_context() if span else None
                correlation = dict(trace_id=f'{identity.trace_id:032x}', span_id=f'{identity.span_id:016x}', trace_flags=f'{int(identity.trace_flags)&1:02x}') if identity and identity.is_valid else {}
                record = create_record(dict(timestamp=self._now(), event_name='operation.failed' if failed else 'operation.completed',
                    severity_text='WARN' if failed else 'INFO', resource=self._resource, scope=dict(name=scope,version='1.0.0'),
                    attributes={**fields, 'bunny.outcome':'failed' if failed else 'succeeded', 'bunny.duration_ms':min(86400000, elapsed/1e6)}, **correlation))
                if record['ok']:
                    self.emit(record['value'])
                    if span and span.is_recording():
                        mapped = to_otlp(record['value'])['resourceLogs'][0]
                        group = mapped['scopeLogs'][0]
                        value = dict(traceId=correlation['trace_id'],spanId=correlation['span_id'],flags=int(identity.trace_flags)&1,
                            name=span_name,kind=1,startTimeUnixNano=str(start),endTimeUnixNano=str(end),
                            attributes=group['logRecords'][0]['attributes'],status={'code':2 if failed else 0})
                        if span.parent and span.parent.is_valid:
                            value['parentSpanId'] = f'{span.parent.span_id:016x}'
                        payload = {'resourceSpans':[{'resource':mapped['resource'],'scopeSpans':[{
                            'scope':group['scope'],'schemaUrl':group['schemaUrl'],'spans':[value]}]}]}
                        self._traces.emit_line(json.dumps(payload,separators=(',',':')))
            except Exception:
                self._failures = min(MAX_SAFE_INTEGER, self._failures + 1)
            finally:
                if span:
                    try: span.end()
                    except Exception: self._failures = min(MAX_SAFE_INTEGER, self._failures + 1)

    def counts(self):
        return dict(enabled=self._enabled, failures=self._failures,
                    logs=self._logs.counts() if self._logs else None,
                    traces=self._traces.counts() if self._traces else None,
                    transports=[dict(accepted=t.accepted, failed=t.failed) for t in self._transports])

    def close(self):
        if self._closed:
            return
        self._closed = True
        deadline = time.monotonic() + 1
        for output in [self._logs, self._traces]:
            if output: output.close_until(deadline)
        for sender in self._transports: sender.close()
        if self._provider: self._provider.shutdown()
