"""Offline regression check for independent history and architecture updates."""
from pathlib import Path
import json
import shutil
import subprocess
import sys
import tempfile
import unittest


class GuideMaintenance(unittest.TestCase):
    def test_later_history_preserves_reviewed_architecture(self):
        source = Path(__file__).resolve().parent.parent
        with tempfile.TemporaryDirectory(prefix='guide-maintenance-') as directory:
            candidate = Path(directory) / 'guide'
            shutil.copytree(source, candidate, ignore=shutil.ignore_patterns(
                '*.png', '*.pdf', '__pycache__', 'guide-verification.json'))
            history_path = candidate / 'work/history/github-history.json'
            history = json.loads(history_path.read_text())
            # A later delivery can change all main heads without changing the
            # architecture files. This is synthetic history, never published.
            for repo in history['repositories'].values():
                repo['headSha'] = '0' * 40
            history_path.write_text(json.dumps(history))
            result = subprocess.run([sys.executable, str(candidate / 'work/build_guide.py')],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            html = (candidate / 'outputs/agent-device-work-guides.html').read_text()
            self.assertNotIn('still the current main heads', html)
            sources = json.loads((candidate / 'work/architecture/source-receipts.json').read_text())
            for revision in sources['sourceRevisions'].values():
                self.assertIn(revision, html)


if __name__ == '__main__':
    unittest.main()
