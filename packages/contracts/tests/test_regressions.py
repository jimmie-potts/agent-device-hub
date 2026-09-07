import json
import pathlib
import unittest

from agent_device_hub_contracts import evaluate, validate

CORPUS = json.loads((pathlib.Path(__file__).resolve().parents[1] / "fixtures/controller-v1.json").read_text())
ADMISSION = next(case["input"] for case in CORPUS["semanticCases"] if case["id"] == "registered-light-power")
REJECTION = {"decision": "invalid-request", "reserved": False, "nextSequence": ADMISSION["state"]["nextSequence"], "scheduled": 0}


class MalformedRequests(unittest.TestCase):
    def test_deep_malformed_request(self):
        for depth in (600, 5000):
            with self.subTest(depth=depth):
                extra = None
                for _ in range(depth):
                    extra = [extra]
                request = {**ADMISSION["request"], "extra": extra}
                # Calculate wire size without recursively serializing the hostile value.
                body = json.dumps(ADMISSION["request"], separators=(",", ":"))[:-1]
                body += ',"extra":' + '[' * depth + 'null' + ']' * depth + '}'
                body_bytes = len(body.encode())
                self.assertLess(body_bytes, ADMISSION["state"]["maxBodyBytes"])
                self.assertFalse(validate("request", request))
                self.assertEqual(evaluate({**ADMISSION, "request": request, "bodyBytes": body_bytes}), REJECTION)

    def test_cyclic_and_nonfinite_malformed_request(self):
        cycle = []
        cycle.append(cycle)
        for label, extra in (("cycle", cycle), ("infinity", float("inf")), ("nan", float("nan"))):
            with self.subTest(value=label):
                request = {**ADMISSION["request"], "extra": extra}
                self.assertFalse(validate("request", request))
                self.assertEqual(evaluate({**ADMISSION, "request": request}), REJECTION)


if __name__ == "__main__":
    unittest.main()
