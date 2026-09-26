"""The common Places contract shared by document generators."""
from html.parser import HTMLParser
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import skin  # noqa: E402


class Anchors(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            self.links.append(dict(attrs))


class PlacesTests(unittest.TestCase):
    def test_six_places_keep_order_and_safe_destinations(self):
        places = skin.places()
        self.assertEqual([p['label'] for p in places],
                         ['Guide', 'Architecture', 'Atlas', 'Reference', 'B.U.N.N.Y.', 'Wall'])
        self.assertEqual([p['group'] for p in places], ['Public'] * 4 + ['Local'] * 2)
        for place in places[:4]:
            self.assertTrue(place['publicUrl'].startswith('https://jimmie-potts.github.io/agent-device-guide/'))
        for place in places[4:]:
            self.assertIn(place['localUrl'], ('http://127.0.0.1:8788/', 'http://127.0.0.1:8765/'))

    def test_local_and_public_strips_have_one_click_per_other_place(self):
        output = Path(__file__).resolve().parents[1] / 'system-design/components/OPS-runbook.html'
        for public in (False, True):
            block = skin.places_strip('atlas', output, public=public)
            anchors = Anchors()
            anchors.feed(block)
            self.assertEqual(len(anchors.links), 5)
            self.assertIn('data-current="atlas"', block)
            self.assertIn('>Local</span>', block)
            self.assertNotIn('token=', block)
            self.assertNotIn('localhost', block)
            self.assertIn('href="http://127.0.0.1:8788/"', block)
            if public:
                self.assertIn('href="https://jimmie-potts.github.io/agent-device-guide/"', block)
            else:
                self.assertIn('href="../../work-guide/outputs/agent-device-work-guides.html"', block)


if __name__ == '__main__':
    unittest.main()
