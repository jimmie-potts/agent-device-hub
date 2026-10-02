import json
from pathlib import Path
import unittest
from copy import deepcopy
import agent_device_hub_contracts as contracts

CORPUS = json.loads((Path(__file__).resolve().parents[1] / 'fixtures/install-receipt-v1.json').read_text())


class InstallReceipt(unittest.TestCase):
    def test_shared_receipt_corpus(self):
        self.assertEqual(CORPUS['format'], 1)
        self.assertTrue(CORPUS['cases'])
        self.assertEqual(len(CORPUS['cases']), len({item['id'] for item in CORPUS['cases']}))
        for item in CORPUS['cases']:
            with self.subTest(id=item['id']):
                original = deepcopy(item['value'])
                self.assertEqual(contracts.validate_install_receipt(item['value']), item['valid'])
                self.assertEqual(item['value'], original)
