import copy
import json
import pathlib
import unittest

from agent_lifecycle_contracts import validate_event, deduplication_key

CORPUS = json.loads((pathlib.Path(__file__).resolve().parents[1] / 'fixtures/lifecycle-v1.json').read_text(encoding='utf-8'))
CORPUS['cases'] += json.loads((pathlib.Path(__file__).resolve().parents[1] / 'fixtures/lifecycle-v1.1.json').read_text(encoding='utf-8'))['cases']


class ContractTests(unittest.TestCase):
    def test_shared_corpus(self):
        self.assertEqual(len({case['id'] for case in CORPUS['cases']}), len(CORPUS['cases']))
        for case in CORPUS['cases']:
            with self.subTest(case=case['id']):
                result = validate_event(case['input'])
                self.assertEqual(result['ok'], case['valid'])
                self.assertEqual(deduplication_key(case['input']), case.get('deduplication'))
                self.assertEqual(result, {'ok': True, 'value':case['input']} if case['valid'] else {'ok':False, 'code':'invalid-event'})

    def test_non_json(self):
        cyclic = {}; cyclic['parent'] = cyclic
        for value in [cyclic, [], None, float('nan'), float('inf'), object(), {'label':'\ud800'}]:
            self.assertEqual(validate_event(value), {'ok':False, 'code':'invalid-event'})

    def test_copy_and_numeric_parity(self):
        event = copy.deepcopy(CORPUS['cases'][0]['input'])
        result = validate_event(event)
        self.assertIsNot(result['value'], event)
        event['observedAtMs'] = 1000.0
        self.assertEqual(deduplication_key(event), CORPUS['cases'][0]['deduplication'])
