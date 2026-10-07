"""Profile 1.2 (Hub #903): Python construction keeps only the attributes the record's own profile registers."""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'python'))
from bunny_observability import create_record, validate_record


def hub_record():
    return json.loads((ROOT / 'fixtures/records.json').read_text())['cases'][2]['record']


class Profiles(unittest.TestCase):
    def test_default_profile_leaves_out_later_attributes(self):
        record = hub_record()
        del record['schema_version']
        record['attributes'].update({'error.type': 'TypeError', 'bunny.queue.depth': 2})
        built = create_record(record)
        self.assertTrue(built['ok'])
        self.assertEqual(built['value']['schema_version'], '1.1')
        self.assertEqual(built['value']['attributes'], {'bunny.provenance': 'source', 'bunny.queue.depth': 2})

    def test_each_profile_keeps_its_own_attributes(self):
        record = hub_record()
        record['attributes'].update({'error.type': 'TypeError', 'bunny.queue.depth': 2})
        oldest = create_record({**record, 'schema_version': '1.0'})
        self.assertEqual(oldest['value']['attributes'], {'bunny.provenance': 'source'})
        newest = create_record({**record, 'schema_version': '1.2'})
        self.assertEqual(newest['value']['attributes'], record['attributes'])

    def test_profile_1_2_records_validate(self):
        cases = json.loads((ROOT / 'fixtures/records.json').read_text())['cases']
        runtime = [case for case in cases if case['record'].get('schema_version') == '1.2' and case['valid']]
        self.assertGreater(len(runtime), 10)
        for case in runtime:
            with self.subTest(case=case['name']):
                self.assertTrue(validate_record(case['record'])['ok'])


if __name__ == '__main__':
    unittest.main()
