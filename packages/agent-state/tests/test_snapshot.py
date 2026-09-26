import json
from pathlib import Path
import unittest
from agent_state import validate_snapshot


class SnapshotContract(unittest.TestCase):
    def test_shared_fixtures(self):
        corpus = json.loads((Path(__file__).resolve().parents[1] / 'fixtures/snapshots-v1.json').read_text())
        corpus['cases'] += json.loads((Path(__file__).resolve().parents[1] / 'fixtures/snapshots-v1.2.json').read_text())['cases']
        for case in corpus['cases']:
            with self.subTest(case=case['id']):
                before = json.dumps(case['input'], sort_keys=True)
                result = validate_snapshot(case['input'])
                self.assertEqual(result['ok'], case['valid'])
                self.assertEqual(json.dumps(case['input'], sort_keys=True), before)
                if result['ok']:
                    self.assertEqual(result['value'], case['input'])
                    self.assertIsNot(result['value'], case['input'])
                else:
                    self.assertEqual(result, {'ok': False, 'code': 'invalid-state'})

    def test_non_json_inputs(self):
        for value in (float('nan'), float('inf'), object(), {1: 'private'}, {'private': '\ud800'}):
            self.assertEqual(validate_snapshot(value), {'ok': False, 'code': 'invalid-state'})


if __name__ == '__main__':
    unittest.main()
