from copy import deepcopy
import json
from pathlib import Path
import unittest
from event_contracts import validate_event, reference_decision

CORPUS = json.loads((Path(__file__).resolve().parents[1] / 'fixtures/events-v1.json').read_text())

class EventTests(unittest.TestCase):
    def test_inventory(self):
        cases = CORPUS['validation'] + CORPUS['reference']
        self.assertTrue(CORPUS['reference'])
        self.assertTrue(cases)
        self.assertEqual(len(cases), len({case['id'] for case in cases}))

    def test_validation(self):
        for case in CORPUS['validation']:
            with self.subTest(case=case['id']):
                before = deepcopy(case['input'])
                result = validate_event(case['input'])
                self.assertEqual(result['ok'], case['valid'])
                self.assertEqual(case['input'], before)
                self.assertEqual(result, {'ok': True, 'value': case['input']} if case['valid'] else {'ok': False, 'code': 'invalid-event'})

    def test_non_json(self):
        for value in [float('nan'), float('inf'), 2**53, object(), {'a': lambda: None}]:
            self.assertEqual(validate_event(value), {'ok': False, 'code': 'invalid-event'})
        value = {}; value['cycle'] = value
        self.assertFalse(validate_event(value)['ok'])

    def test_reference(self):
        for case in CORPUS['reference']:
            with self.subTest(case=case['id']):
                before = deepcopy(case['input'])
                self.assertEqual(reference_decision(case['input']), case['expected'])
                self.assertEqual(case['input'], before)
