"""Profiles 1.2 (Hub #903), 1.3 (Hub #949) and 1.4 (Hub #835): Python construction keeps only the attributes the record's own profile registers."""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'python'))
from bunny_observability import ARTIFACT_VERSION, _definitions, _profile_span_names, create_record, validate_record


def hub_record():
    return json.loads((ROOT / 'fixtures/records.json').read_text())['cases'][2]['record']


class Profiles(unittest.TestCase):
    def test_each_profile_registers_only_its_own_span_names(self):
        catalog = _definitions()[0]
        later = catalog['additions']['1.3']['span_names']
        self.assertEqual(later, ['bunny.outcome.publish', 'bunny.device.call'])
        for version in ('1.0', '1.1', '1.2'):
            self.assertEqual([name for name in _profile_span_names(catalog, version) if name in later], [], version)
        self.assertEqual(_profile_span_names(catalog, '1.3'), catalog['span_names'])
        self.assertEqual(_profile_span_names(catalog, '1.4'), catalog['span_names'], 'profile 1.4 adds no span name')
        self.assertEqual(_profile_span_names(catalog, '1.5'), [])

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

    def test_profile_1_4_attributes_stay_in_profile_1_4(self):
        self.assertEqual(ARTIFACT_VERSION, '1.4.0')
        record = hub_record()
        record['attributes'].update({'http.route': '/api/v2/families/{family}', 'http.request.method': 'GET', 'error.type': 'TypeError'})
        earlier = create_record({**record, 'schema_version': '1.3'})
        self.assertEqual(earlier['value']['attributes'], {'bunny.provenance': 'source', 'error.type': 'TypeError'})
        latest = create_record({**record, 'schema_version': '1.4'})
        self.assertEqual(latest['value']['attributes'], record['attributes'])

    def test_profile_1_3_attributes_stay_in_profile_1_3(self):
        record = hub_record()
        record['attributes'].update({'bunny.attempt_count': 3, 'error.type': 'TypeError'})
        earlier = create_record({**record, 'schema_version': '1.2'})
        self.assertEqual(earlier['value']['attributes'], {'bunny.provenance': 'source', 'error.type': 'TypeError'})
        latest = create_record({**record, 'schema_version': '1.3'})
        self.assertEqual(latest['value']['attributes'], record['attributes'])

    def test_profile_1_3_records_validate(self):
        cases = json.loads((ROOT / 'fixtures/records.json').read_text())['cases']
        runtime = [case for case in cases if case['record'].get('schema_version') == '1.3' and case['valid']]
        self.assertGreater(len(runtime), 8)
        for case in runtime:
            with self.subTest(case=case['name']):
                self.assertTrue(validate_record(case['record'])['ok'])

    def test_profile_1_2_records_validate(self):
        cases = json.loads((ROOT / 'fixtures/records.json').read_text())['cases']
        runtime = [case for case in cases if case['record'].get('schema_version') == '1.2' and case['valid']]
        self.assertGreater(len(runtime), 10)
        for case in runtime:
            with self.subTest(case=case['name']):
                self.assertTrue(validate_record(case['record'])['ok'])


if __name__ == '__main__':
    unittest.main()
