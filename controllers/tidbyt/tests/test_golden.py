"""Decode the committed golden WebP fixtures with Pillow, independently of the TypeScript encoder."""
import base64
import io
import json
import unittest
from pathlib import Path

from PIL import Image, features

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"


class GoldenWebpTest(unittest.TestCase):
    def test_webp_support_is_available(self):
        self.assertTrue(features.check("webp"))

    def test_every_golden_image_decodes_to_its_frame(self):
        golden = json.loads((FIXTURES / "golden.json").read_text())
        self.assertEqual((golden["width"], golden["height"]), (64, 32))
        self.assertGreaterEqual(len(golden["cases"]), 5)
        for case in golden["cases"]:
            with self.subTest(case=case["id"]):
                data = (FIXTURES / "golden" / f"{case['id']}.webp").read_bytes()
                with Image.open(io.BytesIO(data)) as image:
                    image.load()
                    self.assertEqual(image.format, "WEBP")
                    self.assertEqual(image.size, (64, 32))
                    rgba = image.convert("RGBA")
                expected = base64.b64decode(case["rgb"], validate=True)
                self.assertEqual(len(expected), 64 * 32 * 3)
                actual = rgba.tobytes()
                self.assertTrue(all(actual[i] == 255 for i in range(3, len(actual), 4)), "every pixel is opaque")
                rgb = bytes(b for i, b in enumerate(actual) if i % 4 != 3)
                self.assertEqual(rgb, expected)


if __name__ == "__main__":
    unittest.main()
