import json
from pathlib import Path
import unittest

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

ROOT = Path(__file__).resolve().parents[1]
BASE = "https://bunny.invalid/events/"


class ExtendedStageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.documents = {}
        for path in (ROOT / "schemas/v2").rglob("*.schema.json"):
            schema = json.loads(path.read_text())
            cls.documents[schema["$id"]] = schema
        cls.registry = Registry().with_resources(
            (uri, Resource.from_contents(schema)) for uri, schema in cls.documents.items()
        )

    def valid(self, version, data):
        return Draft202012Validator(self.documents[BASE + version], registry=self.registry).is_valid(data)

    def test_stage_and_dispatch_minors(self):
        content = json.loads((ROOT / "fixtures/v2/art-extended-stage.json").read_text())
        for frames, ordinary, extended in [(256, True, False), (257, False, True),
                                           (1001, False, True), (2**53, False, False)]:
            body = dict(content, frames=frames)
            for family, legacy, newer in [("art-stage", "2.0", "2.1"), ("art-dispatch", "2.0", "2.2")]:
                data = (dict(requestId="stage", **body) if family == "art-stage" else
                        dict(requestId="stage", family="art-stage", target="panel", data=body))
                for minor, valid in [(legacy, ordinary), (newer, extended or (family == "art-stage" and ordinary))]:
                    with self.subTest(frames=frames, family=family, minor=minor):
                        self.assertEqual(self.valid(f"{family}/{minor}", data), valid)

    def test_device_stage_declaration(self):
        fixtures = json.loads((ROOT / "fixtures/v2/devices.json").read_text())["valid"]
        data = next(value["data"] for value in fixtures.values() if value["dataschema"] == BASE + "device/2.2")
        art = data["capabilities"]["moments"]["art"]
        self.assertTrue(self.valid("device/2.4", data))
        art["stageVersion"] = "2.1"
        self.assertTrue(self.valid("device/2.4", data))
        self.assertFalse(self.valid("device/2.2", data))
        art["stageVersion"] = "2.2"
        self.assertFalse(self.valid("device/2.4", data))
