import json
import sys
import unittest
from pathlib import Path
from threading import Thread
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'python'))
from bunny_observability.host import HostDiagnostics
RESOURCE = {'service.namespace':'bunny','service.name':'nanoleaf-worker','service.version':'unknown',
 'service.instance.id':'00000000-0000-4000-8000-000000000001','deployment.environment.name':'test'}

class HostTests(unittest.TestCase):
    def test_disabled_and_local_operation(self):
        disabled = HostDiagnostics()
        with disabled.operation('bunny.host', 'startup'):
            pass
        disabled.close()
        lines=[]
        host=HostDiagnostics(enabled=True, resource=RESOURCE, local_sink=lines.append)
        with host.operation('bunny.queue', 'brightness'):
            pass
        host.close()
        self.assertEqual(len(lines), 1)
        record=json.loads(lines[0])
        self.assertEqual(record['event_name'], 'operation.completed')
        self.assertEqual(record['attributes']['bunny.outcome'], 'succeeded')
        self.assertNotIn('trace_id', record)

    def test_wall_clock_adjustments_do_not_change_elapsed_duration(self):
        from unittest.mock import patch
        from types import SimpleNamespace
        for adjustment in [-10_000_000_000, 10_000_000_000]:
            with self.subTest(adjustment=adjustment):
                lines=[]
                host=HostDiagnostics(enabled=True,resource=RESOURCE,local_sink=lines.append)
                wall=iter([1_800_000_000_000_000_000, 1_800_000_000_000_000_000+adjustment])
                elapsed=iter([100_000_000, 125_000_000])
                clock=SimpleNamespace(time_ns=lambda:next(wall),monotonic_ns=lambda:next(elapsed))
                with patch('bunny_observability.host.time',clock):
                    with host.operation('bunny.queue','brightness'): pass
                host.close()
                self.assertEqual(json.loads(lines[0])['attributes']['bunny.duration_ms'],25)

    def test_domain_exception_survives_sink_failure(self):
        def broken(_line): raise RuntimeError('sink-private')
        host=HostDiagnostics(enabled=True, resource=RESOURCE, local_sink=broken)
        failure=ValueError('domain-private')
        with self.assertRaises(ValueError) as caught:
            with host.operation('bunny.queue', 'brightness'): raise failure
        self.assertIs(caught.exception, failure)
        host.close()
        self.assertEqual(host.counts()['logs']['failed'], 1)

    def test_exported_trace_and_explicit_thread_handoff(self):
        from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
        received=[]
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args): pass
            def do_POST(self):
                received.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(b'{"partialSuccess":{"rejectedLogRecords":"0","rejectedSpans":"0"}}')
        server=ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        serving=Thread(target=server.serve_forever, daemon=True)
        serving.start()
        lines=[]
        host=HostDiagnostics(enabled=True, resource=RESOURCE, local_sink=lines.append, tracing=True,
                             sampling_ratio=1, collector_origin=f'http://127.0.0.1:{server.server_port}')
        try:
            with host.operation('bunny.controller', 'brightness', root=True):
                captured=host.capture_context()
                def work():
                    with host.run_context(captured):
                        with host.operation('bunny.queue','brightness',span_name='bunny.command.execute'):
                            pass
                child=Thread(target=work)
                child.start()
                child.join()
            host.close()
            spans=[span for value in received for resource in value.get('resourceSpans',[]) for scope in resource['scopeSpans'] for span in scope['spans']]
            logs=[json.loads(line) for line in lines]
            self.assertEqual(len(spans),2)
            self.assertEqual(len(logs),2)
            self.assertEqual(len(set(x['trace_id'] for x in logs)),1)
            parent=next(x for x in spans if 'parentSpanId' not in x)
            child=next(x for x in spans if 'parentSpanId' in x)
            self.assertEqual(child['parentSpanId'],parent['spanId'])
            for log in logs:
                self.assertTrue(any(span['traceId']==log['trace_id'] and span['spanId']==log['span_id'] for span in spans))
        finally:
            host.close()
            server.shutdown()
            server.server_close()
            serving.join()

    def test_spans_take_only_the_host_profile_names(self):
        # The host's records are profile 1.1, so a span name that profile 1.3 adds is no span of it; the operation's
        # record is still written, without a trace.
        from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
        received=[]
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args): pass
            def do_POST(self):
                received.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(b'{"partialSuccess":{"rejectedLogRecords":"0","rejectedSpans":"0"}}')
        server=ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        serving=Thread(target=server.serve_forever, daemon=True)
        serving.start()
        lines=[]
        host=HostDiagnostics(enabled=True, resource=RESOURCE, local_sink=lines.append, tracing=True,
                             sampling_ratio=1, collector_origin=f'http://127.0.0.1:{server.server_port}')
        try:
            for name in ('bunny.helper.run', 'bunny.device.call', 'bunny.outcome.publish'):
                with host.operation('bunny.controller', 'brightness', span_name=name, root=True):
                    pass
            host.close()
            spans=[span for value in received for resource in value.get('resourceSpans',[]) for scope in resource['scopeSpans'] for span in scope['spans']]
            logs=[json.loads(line) for line in lines]
            self.assertEqual([span['name'] for span in spans], ['bunny.helper.run'])
            self.assertEqual(len(logs), 3)
            self.assertEqual(['trace_id' in log for log in logs], [True, False, False])
        finally:
            host.close()
            server.shutdown()
            server.server_close()
            serving.join()

    def test_stalled_sink_queue_and_close_are_bounded(self):
        from threading import Event
        import time
        release=Event()
        host=HostDiagnostics(enabled=True,resource=RESOURCE,local_sink=lambda _line:release.wait())
        try:
            for _ in range(1030): host.event('process.started',attributes={'bunny.operation':'startup'})
            self.assertEqual(host.counts()['logs']['queued'],1024)
            self.assertEqual(host.counts()['logs']['dropped'],6)
            start=time.monotonic()
            host.close()
            self.assertLess(time.monotonic()-start,1.5)
            self.assertEqual(host.counts()['logs']['queued'],0)
        finally:
            release.set()
            host.close()

    def test_absent_collector_does_not_change_domain_outcome(self):
        import socket
        with socket.socket() as selected:
            selected.bind(('127.0.0.1',0))
            port=selected.getsockname()[1]
        host=HostDiagnostics(enabled=True,resource=RESOURCE,collector_origin=f'http://127.0.0.1:{port}',local_sink=lambda _line:None)
        effects=[]
        with host.operation('bunny.queue','brightness'): effects.append(1)
        host.close()
        self.assertEqual(effects,[1])
        self.assertEqual(host.counts()['transports'][0]['failed'],1)
        self.assertEqual(host.counts()['logs']['queued'],0)

if __name__ == '__main__': unittest.main()
