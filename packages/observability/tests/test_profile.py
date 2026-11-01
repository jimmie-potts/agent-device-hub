"""Profiles 1.2 (Hub #903), 1.3 (Hub #949), 1.4 (Hub #835), 1.5 (Hub #976), 1.6 (Hub #499) and 1.7 (Hub #777): Python construction keeps only the attributes the record's own profile registers."""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'python'))
from bunny_observability import ARTIFACT_VERSION, _definitions, _profile_span_names, create_record, project_record, validate_record


def hub_record():
    return json.loads((ROOT / 'fixtures/records.json').read_text())['cases'][2]['record']


class Profiles(unittest.TestCase):
    def test_each_profile_registers_only_its_own_span_names(self):
        catalog = _definitions()[0]
        later = catalog['additions']['1.3']['span_names']
        self.assertEqual(later, ['bunny.outcome.publish', 'bunny.device.call'])
        for version in ('1.0', '1.1', '1.2'):
            self.assertEqual([name for name in _profile_span_names(catalog, version) if name in later], [], version)
        self.assertEqual(_profile_span_names(catalog, '1.3'), [n for n in catalog['span_names'] if n not in catalog['additions']['1.6']['span_names']])
        self.assertEqual(_profile_span_names(catalog, '1.4'), [n for n in catalog['span_names'] if n not in catalog['additions']['1.6']['span_names']], 'profile 1.4 adds no span name')
        self.assertEqual(_profile_span_names(catalog, '1.5'), [n for n in catalog['span_names'] if n not in catalog['additions']['1.6']['span_names']], 'profile 1.5 adds no span name')
        self.assertEqual(_profile_span_names(catalog, '1.6'), catalog['span_names'])
        self.assertEqual(_profile_span_names(catalog, '1.7'), catalog['span_names'], 'profile 1.7 adds no span name')

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

    def test_profile_1_5_attributes_stay_in_profile_1_5(self):
        self.assertEqual(ARTIFACT_VERSION, '1.7.0')
        record = hub_record()
        record['attributes'].update({'bunny.state.bytes': 8388609, 'bunny.save.duration_ms': 150, 'error.type': 'TypeError'})
        earlier = create_record({**record, 'schema_version': '1.4'})
        self.assertEqual(earlier['value']['attributes'], {'bunny.provenance': 'source', 'error.type': 'TypeError'})
        latest = create_record({**record, 'schema_version': '1.5'})
        self.assertEqual(latest['value']['attributes'], record['attributes'])

    def test_profile_1_5_records_validate(self):
        cases = json.loads((ROOT / 'fixtures/records.json').read_text())['cases']
        costs = [case for case in cases if case['record'].get('schema_version') == '1.5']
        self.assertEqual(sorted(case['name'] for case in costs if case['valid']), ['core-save-slow', 'core-state-large', 'core-state-normal'])
        for case in costs:
            with self.subTest(case=case['name']):
                self.assertEqual(validate_record(case['record'])['ok'], case['valid'])

    def test_profile_1_4_attributes_stay_in_profile_1_4(self):
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


    def test_profile_1_7_exception_fields_stay_in_profile_1_7(self):
        cases = json.loads((ROOT / 'fixtures/records.json').read_text())['cases']
        private = [case for case in cases if case['record'].get('schema_version') == '1.7']
        self.assertEqual(sorted(case['name'] for case in private if case['valid']),
                         ['exception-on-a-non-fault-event-is-schema-valid', 'module-operation-failed-exception', 'runtime-module-failed-exception', 'runtime-telemetry-dropped'])
        for case in private:
            with self.subTest(case=case['name']):
                self.assertEqual(validate_record(case['record'])['ok'], case['valid'])
        failed = next(case for case in cases if case['name'] == 'runtime-module-failed-exception')['record']
        earlier = create_record({**failed, 'schema_version': '1.6'})
        self.assertTrue(earlier['ok'])
        self.assertNotIn('exception.message', earlier['value']['attributes'])
        self.assertNotIn('exception.stacktrace', earlier['value']['attributes'])
        self.assertEqual(earlier['value']['attributes']['error.type'], 'TypeError')
        latest = create_record(failed)
        self.assertEqual(latest['value']['attributes'], failed['attributes'])
        hub = hub_record()
        hub['schema_version'] = '1.1'
        hub['attributes'].update({'exception.message': 'boom', 'bunny.exception.redacted_count': 0, 'bunny.exception.truncated': False})
        self.assertFalse(validate_record(hub)['ok'], 'exception text never joins a hub record')
        self.assertFalse(project_record(failed, '1.0')['ok'], 'a runtime record never projects to 1.0')
        for version in ('1.2', '1.3', '1.4', '1.5', '1.6'):
            projected = project_record(failed, version)
            self.assertTrue(projected['ok'], version)
            self.assertEqual(projected['value']['schema_version'], version)
            for name in ('exception.message', 'exception.stacktrace', 'bunny.exception.redacted_count', 'bunny.exception.truncated'):
                self.assertNotIn(name, projected['value']['attributes'], f'{name} removed at {version}')
            self.assertEqual(projected['value']['attributes']['error.type'], 'TypeError')
            self.assertEqual(projected['value']['trace_id'], failed['trace_id'])
        self.assertEqual(project_record(failed, '1.7')['value']['attributes'], failed['attributes'], 'the same profile keeps the text')
        queued = hub_record()
        queued['schema_version'] = '1.7'
        self.assertEqual(project_record(queued, '1.1')['value']['schema_version'], '1.1')


if __name__ == '__main__':
    unittest.main()
