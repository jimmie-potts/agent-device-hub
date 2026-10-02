import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'python'))
from bunny_observability import validate_record, to_otlp, create_record, project_record


class Conformance(unittest.TestCase):
    def test_shared_corpus(self):
        for case in json.loads((ROOT / 'fixtures/records.json').read_text())['cases']:
            with self.subTest(case=case['name']):
                self.assertEqual(validate_record(case['record'])['ok'], case['valid'])

    def test_unknown_input_does_not_make_normalization_unbounded(self):
        record = json.loads((ROOT / 'fixtures/records.json').read_text())['cases'][2]['record']
        def visits(size):
            value = {**record, **{f'unknown-{i}': 'SECRET' for i in range(size)}}
            count = 0
            def trace(frame, event, arg):
                nonlocal count
                if frame.f_code is create_record.__code__ and event == 'line':
                    count += 1
                return trace
            prior = sys.gettrace()
            try:
                sys.settrace(trace)
                result = create_record(value)
            finally:
                sys.settrace(prior)
            self.assertTrue(result['ok'])
            self.assertNotIn('SECRET', json.dumps(result))
            return count
        self.assertLessEqual(visits(10000), visits(10) + 20)

    def test_queue_delay_mapping(self):
        cases = json.loads((ROOT / 'fixtures/records.json').read_text())['cases']
        record = next(c['record'] for c in cases if c['name'] == 'queue-delay-local-monotonic')
        self.assertEqual(validate_record(record)['value']['attributes']['bunny.queue.wait_ms'], 12.5)
        attributes = to_otlp(record)['resourceLogs'][0]['scopeLogs'][0]['logRecords'][0]['attributes']
        self.assertEqual(next(a['value'] for a in attributes if a['key'] == 'bunny.queue.wait_ms'), {'doubleValue': 12.5})

    def test_exact_time_and_safe_projection(self):
        record = json.loads((ROOT / 'fixtures/records.json').read_text())['cases'][2]['record']
        self.assertEqual(to_otlp(record)['resourceLogs'][0]['scopeLogs'][0]['logRecords'][0]['timeUnixNano'], '1790856000123000000')
        record.update(payload='SECRET', error=ValueError('SECRET'))
        safe = create_record(record)
        self.assertTrue(safe['ok'])
        self.assertNotIn('SECRET', json.dumps(safe))
        safe['value']['attributes']['bunny.queue.depth'] = 2
        self.assertNotIn('bunny.queue.depth', project_record(safe['value'], '1.0')['value']['attributes'])


if __name__ == '__main__':
    unittest.main()
