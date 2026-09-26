"""Nightly validation must distinguish stale Direction from unrelated defects."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import unittest

import guide_direction

GUIDE = Path(__file__).resolve().parent.parent


def digest_outputs(guide):
    return {str(path.relative_to(guide)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in (guide / 'outputs').rglob('*') if path.is_file()}


def candidate(directory):
    root = Path(directory)
    guide = root / 'docs/work-guide'
    shutil.copytree(GUIDE, guide, ignore=shutil.ignore_patterns('__pycache__', '*.png', '*.pdf'))
    shutil.copytree(GUIDE.parent / 'skins', root / 'docs/skins',
                    ignore=shutil.ignore_patterns('__pycache__'))
    key = guide_direction.cited()['SEQUENCE'][0]
    repo = {'H': 'agent-device-hub', 'N': 'codex-nanoleaf', 'P': 'divoom-app-upgrade'}[key[0]]
    number = int(key[1:])
    backlogs = guide / 'work/backlogs'
    path = backlogs / f'{repo}-issues.json'
    issues = json.loads(path.read_text())
    issue = next(row for row in issues if row['number'] == number)
    if issue['state'] != 'OPEN':
        raise AssertionError(f'Test baseline must hold open Direction story {key}')
    issue.update(state='CLOSED', stateReason='completed')
    path.write_text(json.dumps(issues))
    path = backlogs / 'snapshot.json'
    snapshot = json.loads(path.read_text())
    snapshot['openIssues'] -= 1
    snapshot['repositories'][repo]['openIssues'] -= 1
    path.write_text(json.dumps(snapshot))
    path = backlogs / ('hub-native-deps.json' if key[0] == 'H' else 'device-native-deps.json')
    native = json.loads(path.read_text())
    inventory = (native['data']['repository'] if key[0] == 'H' else native['data'][key[0].lower()])['issues']
    inventory['nodes'] = [row for row in inventory['nodes'] if row['number'] != number]
    inventory['totalCount'] = len(inventory['nodes'])
    path.write_text(json.dumps(native))
    return guide, key


class NightlyValidation(unittest.TestCase):
    def run_build(self, guide, report=None):
        command = [sys.executable, str(guide / 'work/build_guide.py')]
        if report is not None:
            command += ['--validate-inputs', '--validation-result', str(report)]
        return subprocess.run(command, capture_output=True, text=True)

    def test_default_build_still_refuses_direction_before_output(self):
        with tempfile.TemporaryDirectory(prefix='nightly-validation-') as directory:
            guide, key = candidate(directory)
            before = digest_outputs(guide)
            result = self.run_build(guide)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(f'SEQUENCE cites {key}', result.stderr)
            self.assertEqual(digest_outputs(guide), before)

    def test_direction_only_has_explicit_machine_result_without_output(self):
        with tempfile.TemporaryDirectory(prefix='nightly-validation-') as directory:
            guide, key = candidate(directory)
            before = digest_outputs(guide)
            report = Path(directory) / 'result.json'
            result = self.run_build(guide, report)
            self.assertEqual(result.returncode, 3, result.stderr)
            evidence = json.loads(report.read_text())
            self.assertEqual(evidence['status'], 'direction-stale')
            self.assertIn(f'SEQUENCE cites {key}', evidence['directionError'])
            self.assertFalse(evidence['generatedOutputValidated'])
            self.assertFalse(evidence['browserValidated'])
            self.assertEqual(digest_outputs(guide), before)

    def test_direction_does_not_hide_architecture_receipt_failure(self):
        with tempfile.TemporaryDirectory(prefix='nightly-validation-') as directory:
            guide, _ = candidate(directory)
            before = digest_outputs(guide)
            path = guide / 'work/architecture/diagram-receipts.json'
            receipts = json.loads(path.read_text())
            receipts['diagrams'][0]['svgSha256'] = '0' * 64
            path.write_text(json.dumps(receipts))
            report = Path(directory) / 'result.json'
            result = self.run_build(guide, report)
            self.assertNotIn(result.returncode, (0, 3))
            self.assertIn('Stale SVG', result.stderr)
            self.assertFalse(report.exists(), 'No eligible machine result after unrelated failure')
            self.assertEqual(digest_outputs(guide), before)

    def test_direction_does_not_hide_late_stylesheet_failure(self):
        with tempfile.TemporaryDirectory(prefix='nightly-validation-') as directory:
            guide, _ = candidate(directory)
            before = digest_outputs(guide)
            path = guide / 'work/build_guide.py'
            source = path.read_text()
            needle = '.guide summary:hover{background'
            self.assertIn(needle, source)
            path.write_text(source.replace(needle, '.guide>summary:hover{background', 1))
            report = Path(directory) / 'result.json'
            result = self.run_build(guide, report)
            self.assertNotIn(result.returncode, (0, 3))
            self.assertIn('Stylesheet rewrite target missing', result.stderr)
            self.assertFalse(report.exists(), 'No eligible machine result after unrelated failure')
            self.assertEqual(digest_outputs(guide), before)


if __name__ == '__main__':
    unittest.main()
