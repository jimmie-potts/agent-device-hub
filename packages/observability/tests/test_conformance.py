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
