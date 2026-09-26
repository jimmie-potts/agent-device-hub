"""New stories remain visible without inventing an ordered roadmap position."""
from pathlib import Path
import json
import subprocess
import sys
import tempfile
import unittest

from test_maintenance import copy_guide


class UnplacedStories(unittest.TestCase):
    def test_new_story_builds_with_explicit_pending_roadmap_and_track(self):
        with tempfile.TemporaryDirectory(prefix='guide-unplaced-') as directory:
            guide = copy_guide(directory)
            backlogs = guide / 'work/backlogs'
            path = backlogs / 'agent-device-hub-issues.json'
            rows = json.loads(path.read_text())
            sample = dict(next(row for row in rows if row['state'] == 'OPEN'))
            sample.update(number=99999, title='Unplaced <script>alert(1)</script>',
                          url='https://github.com/jimmie-potts/agent-device-hub/issues/99999',
                          labels=[], comments=[], body='## Guide\n\n**Topic:** development-workflow\n**Note:** New story awaiting placement.\n')
            rows.append(sample)
            path.write_text(json.dumps(rows))
            path = backlogs / 'snapshot.json'
            snapshot = json.loads(path.read_text())
            snapshot['openIssues'] += 1
            snapshot['repositories']['agent-device-hub']['openIssues'] += 1
            path.write_text(json.dumps(snapshot))
            path = backlogs / 'hub-native-deps.json'
            native = json.loads(path.read_text())
            inventory = native['data']['repository']['issues']
            inventory['nodes'].append({'number':99999,'blockedBy':{'totalCount':0,'pageInfo':{'hasNextPage':False},'nodes':[]}})
            inventory['totalCount'] += 1
            path.write_text(json.dumps(native))
            command = [sys.executable, str(guide / 'work/build_guide.py')]
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            output = guide / 'outputs/agent-device-work-guides.html'
            document = output.read_text()
            self.assertIn('Roadmap placement pending', document)
            self.assertIn('Track placement pending', document)
            self.assertIn('Unplaced &lt;script&gt;', document)
            self.assertNotIn('Unplaced <script>', document)
            self.assertIn('H99999', result.stderr)
            before = output.read_bytes()
            again = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(again.returncode, 0, again.stderr)
            self.assertEqual(output.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
