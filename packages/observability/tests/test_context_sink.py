import asyncio
import json
from pathlib import Path
import sys
import threading
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'python'))
from bunny_observability import DiagnosticContext, BoundedEmitter, parse_traceparent, trace_headers

SAMPLE = json.loads((ROOT / 'fixtures/records.json').read_text())['cases'][2]['record']


class ContextAndSink(unittest.TestCase):
    def test_isolation_and_restore(self):
        context = DiagnosticContext()
        async def task(digit):
            value = parse_traceparent(f"00-{digit * 32}-{digit * 16}-01", authenticated=True, owned=True)
            with context.run(value):
                await asyncio.sleep(0)
                self.assertEqual(context.current(), value)
                captured = context.capture()
                captured['trace_id'] = '0' * 32
                self.assertEqual(context.current(), value)
            self.assertIsNone(context.current())
        async def run():
            await asyncio.gather(task('a'), task('b'))
        asyncio.run(run())
        self.assertIsNone(parse_traceparent('00-' + 'a' * 32 + '-' + 'b' * 16 + '-01'))
        self.assertEqual(trace_headers({'trace_id': 'a' * 32, 'span_id': 'b' * 16, 'trace_flags': '01'}), {})

    def test_bounded_stalled_sink(self):
        release = threading.Event()
        emitter = BoundedEmitter(lambda line: release.wait(1), max_records=2, flush_ms=20)
        try:
            self.assertTrue(emitter.emit(SAMPLE))
            self.assertTrue(emitter.emit(SAMPLE))
            self.assertFalse(emitter.emit(SAMPLE))
            self.assertEqual(emitter.counts()['queued'], 2)
            start = time.monotonic()
            emitter.close()
            self.assertLess(time.monotonic() - start, .2)
            self.assertEqual(emitter.counts()['dropped'], 3)
            self.assertEqual(emitter.counts()['queued'], 0)
        finally:
            release.set()

    def test_private_input_and_failure(self):
        output = []
        emitter = BoundedEmitter(output.append)
        self.assertTrue(emitter.emit({**SAMPLE, 'payload': 'SECRET'}))
        emitter.close()
        self.assertEqual(json.loads(output[0]), SAMPLE)
        def broken(line):
            raise ValueError('SECRET')
        emitter = BoundedEmitter(broken)
        emitter.emit(SAMPLE)
        emitter.close()
        self.assertEqual(emitter.counts()['failed'], 1)
        self.assertNotIn('SECRET', json.dumps(emitter.counts()))
