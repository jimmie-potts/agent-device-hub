from copy import deepcopy
import json
import pathlib
import unittest

from agent_device_hub_contracts import evaluate, validate

CORPUS = json.loads((pathlib.Path(__file__).resolve().parents[1] / "fixtures/controller-v1.json").read_text())


class Conformance(unittest.TestCase):
    def test_shared_corpus(self):
        self.assertEqual(CORPUS["format"], 1)
        cases = CORPUS["schemaCases"] + CORPUS["semanticCases"]
        self.assertEqual(len(cases), len({case["id"] for case in cases}))
        for case in CORPUS["schemaCases"]:
            with self.subTest(id=case["id"]):
                self.assertEqual(validate(case["definition"], case["value"]), case["valid"])
        for case in CORPUS["semanticCases"]:
            with self.subTest(id=case["id"]):
                original = deepcopy(case["input"])
                actual = evaluate(case["input"])
                self.assertEqual(actual, case["expected"])
                self.assertEqual(case["input"], original, "reference evaluation must not mutate owner state")
                for result in actual.get("results", [actual]):
                    if "receipt" in result:
                        definition = "receiptV1_1" if result["receipt"]["apiVersion"] == "1.1" else "receipt"
                        self.assertTrue(validate(definition, result["receipt"]))
                if case["input"]["operation"] == "moment":
                    device = actual["device"]
                    self.assertTrue(validate("momentState", {"current": device["current"], "last": device["last"]}))
                if case["input"]["operation"] == "downgrade":
                    self.assertTrue(validate("snapshot", actual["snapshot"]))


if __name__ == "__main__":
    unittest.main()
