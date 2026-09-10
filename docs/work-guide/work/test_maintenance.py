"""Offline regression check for independent history and architecture updates."""
from pathlib import Path
import json
import shutil
import subprocess
import sys
import tempfile
import unittest


class GuideMaintenance(unittest.TestCase):
    def test_checkpoint_dependency_is_external_to_primary_coverage(self):
        source = Path(__file__).resolve().parent.parent
        backlogs = source / 'work/backlogs'
        coverage = json.loads((backlogs / 'guide-coverage.json').read_text())
        primary = [key for keys in coverage.values() for key in keys]
        issue_rows = json.loads((backlogs / 'agent-device-hub-issues.json').read_text())
        is_open = any(i['number'] == 83 and i['state'] == 'OPEN' for i in issue_rows)
        self.assertEqual(primary.count('H83'), int(is_open))
        if is_open:
            self.assertIn('H83', coverage['development-workflow'])
        native = json.loads((backlogs / 'hub-native-deps.json').read_text())
        for issue in native['data']['repository']['issues']['nodes']:
            if issue['number'] == 83:
                endpoints = {(d['repository']['nameWithOwner'], d['number'])
                             for d in issue['blockedBy']['nodes']}
                self.assertIn(('jimmie-potts/agent-skills', 33), endpoints)
        html = (source / 'outputs/agent-device-work-guides.html').read_text()
        self.assertIn('https://github.com/jimmie-potts/agent-skills/issues/33', html)
        with tempfile.TemporaryDirectory(prefix='guide-external-') as directory:
            candidate = Path(directory) / 'guide'
            shutil.copytree(source, candidate, ignore=shutil.ignore_patterns(
                '*.png', '*.pdf', '__pycache__', 'guide-verification.json'))
            # An external reference must not inflate the three-repository totals.
            coverage['development-workflow'].append('X33')
            (candidate / 'work/backlogs/guide-coverage.json').write_text(json.dumps(coverage))
            result = subprocess.run([sys.executable, str(candidate / 'work/build_guide.py')],
                                    capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Coverage mismatch', result.stderr)

    def test_refreshed_sequences_follow_native_prerequisites(self):
        import importlib.util
        source = Path(__file__).resolve().parent
        spec = importlib.util.spec_from_file_location('guide_timeline', source / 'timeline.py')
        timeline = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(timeline)
        positions = {key: node['x'] for _, nodes in timeline.TRACKS
                     for node in nodes for key in node['issues']}
        native = json.loads((source / 'backlogs/device-native-deps.json').read_text())
        rows = native['data']['n']['issues']['nodes']
        for issue in (i for i in rows if i['number'] in (26, 53, 55)):
            target = issue['number']
            for dependency in issue['blockedBy']['nodes']:
                self.assertEqual(dependency['repository']['nameWithOwner'],
                                 'jimmie-potts/codex-nanoleaf')
                if dependency['state'] == 'OPEN':
                    self.assertLess(positions[f'N{dependency["number"]}'], positions[f'N{target}'])
        hub = json.loads((source / 'backlogs/hub-native-deps.json').read_text())
        for adoption in hub['data']['repository']['issues']['nodes']:
            if adoption['number'] == 43:
                for dependency in adoption['blockedBy']['nodes']:
                    if dependency['state'] == 'OPEN' and dependency['number'] == 55:
                        self.assertEqual(dependency['repository']['nameWithOwner'],
                                         'jimmie-potts/codex-nanoleaf')
                        self.assertLess(positions['N55'], positions['H43'])

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
