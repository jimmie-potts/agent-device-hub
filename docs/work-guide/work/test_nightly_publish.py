"""Local Git integration coverage; GitHub calls are replaced with a recorder."""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import nightly_publish as publisher


class PublishTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'repo'
        self.root.mkdir()
        self.remote = Path(self.temp.name) / 'remote.git'
        self.git('init', '-b', 'main')
        self.git('config', 'user.name', 'Test')
        self.git('config', 'user.email', 'test@example.invalid')
        subprocess.run(['git', 'init', '--bare', str(self.remote)], check=True, capture_output=True)
        self.git('remote', 'add', 'origin', str(self.remote))
        for path in publisher.ALLOWLIST:
            directory = self.root / path
            directory.mkdir(parents=True)
            (directory / 'fixture.json').write_text('before\n')
        (self.root / 'source.py').write_text('source before\n')
        self.git('add', '.')
        self.git('commit', '-m', 'base')
        self.base = self.git('rev-parse', 'HEAD')
        self.git('push', 'origin', 'main')
        self.report = Path(self.temp.name) / 'report.md'
        self.report.write_text('Verified refresh report\n')
        self.calls = []
        self.prs = []
        def gh(root, args, payload=None):
            self.calls.append((args, payload))
            if args[:2] == ['pr', 'list']:
                return json.dumps(self.prs)
            if args[:2] == ['pr', 'create']:
                return 'https://github.com/jimmie-potts/agent-device-hub/pull/900\n'
            return '{}'
        self.mock = patch.object(publisher, 'gh', side_effect=gh)
        self.mock.start()
        self.addCleanup(self.mock.stop)

    def git(self, *args):
        return subprocess.run(['git', *args], cwd=self.root, check=True, capture_output=True, text=True).stdout.strip()

    def change(self):
        (self.root / publisher.ALLOWLIST[0] / 'fixture.json').write_text('after\n')

    def publish(self, expected='', conclusion='success'):
        return publisher.publish(self.root, self.report, conclusion, 'Direction verified', self.base, expected)

    def test_changed_commit_excludes_tooling_and_preserves_index(self):
        self.change()
        (self.root / 'source.py').write_text('source after\n')
        self.git('add', 'source.py')
        before = self.git('diff', '--cached')
        result = self.publish()
        self.assertTrue(result['changed'])
        self.assertEqual(self.git('diff', '--cached'), before)
        self.assertEqual(self.git('show', result['sha'] + ':source.py'), 'source before')
        self.assertEqual(self.git('rev-parse', result['sha'] + '^'), self.base)
        check = next(payload for args, payload in self.calls if args[0] == 'api')
        self.assertEqual(check['head_sha'], result['sha'])
        self.assertEqual(check['conclusion'], 'success')
        self.assertEqual(sum(args[:2] == ['pr', 'create'] for args, _ in self.calls), 1)

    def test_unchanged_base_has_no_github_writes(self):
        self.assertFalse(self.publish()['changed'])
        self.assertEqual(self.calls, [])

    def test_repeat_unchanged_rolling_has_no_github_writes(self):
        self.change()
        result = self.publish()
        self.calls.clear()
        self.assertFalse(self.publish(result['sha'])['changed'])
        self.assertEqual(self.calls, [])

    def test_failure_updates_existing_pr_and_posts_red_exact_head(self):
        self.change()
        first = self.publish()
        self.prs = [{'number': 900, 'url': first['pr_url']}]
        self.calls.clear()
        (self.root / publisher.ALLOWLIST[1] / 'fixture.json').write_text('history after\n')
        result = self.publish(first['sha'], 'failure')
        check = next(payload for args, payload in self.calls if args[0] == 'api')
        self.assertEqual(check['head_sha'], result['sha'])
        self.assertEqual(check['conclusion'], 'failure')
        self.assertTrue(any(args[:2] == ['pr', 'edit'] for args, _ in self.calls))
        self.assertFalse(any(args[:2] == ['pr', 'create'] for args, _ in self.calls))

    def test_duplicate_prs_refused_before_push(self):
        self.change()
        self.prs = [{'number': 1}, {'number': 2}]
        with self.assertRaisesRegex(RuntimeError, 'Multiple'):
            self.publish()
        self.assertEqual(self.git('ls-remote', 'origin', 'refs/heads/' + publisher.BRANCH), '')

    def test_branch_race_refuses_push_and_all_github_writes(self):
        self.change()
        self.git('push', 'origin', 'HEAD:refs/heads/' + publisher.BRANCH)
        with self.assertRaises(subprocess.CalledProcessError):
            self.publish('')
        self.assertTrue(all(args[:2] == ['pr', 'list'] for args, _ in self.calls))

    def test_main_advance_refused_before_push(self):
        self.change()
        (self.root / 'source.py').write_text('new main source\n')
        self.git('add', 'source.py')
        self.git('commit', '-m', 'concurrent main')
        self.git('push', 'origin', 'main')
        with self.assertRaisesRegex(RuntimeError, 'Main advanced'):
            self.publish()
        self.assertEqual(self.git('ls-remote', 'origin', 'refs/heads/' + publisher.BRANCH), '')

    def test_snapshot_deletion_is_included_but_delivery_commit_is_excluded(self):
        (self.root / 'source.py').write_text('delivery tooling\n')
        self.git('add', 'source.py')
        self.git('commit', '-m', 'delivery tooling')
        (self.root / publisher.ALLOWLIST[0] / 'fixture.json').unlink()
        result = self.publish()
        self.assertEqual(self.git('show', result['sha'] + ':source.py'), 'source before')
        self.assertEqual(self.git('ls-tree', '-r', '--name-only', result['sha'], publisher.ALLOWLIST[0]), '')

    def test_unrelated_changes_alone_do_not_open_pr(self):
        (self.root / 'source.py').write_text('unrelated\n')
        self.assertFalse(self.publish()['changed'])
        self.assertEqual(self.calls, [])

    def test_unchanged_failure_posts_red_without_branch_or_pr_updates(self):
        self.change()
        first = self.publish()
        self.calls.clear()
        result = self.publish(first['sha'], 'failure')
        self.assertFalse(result['changed'])
        self.assertEqual(len(self.calls), 1)
        args, check = self.calls[0]
        self.assertEqual(args[0], 'api')
        self.assertEqual(check['head_sha'], first['sha'])
        self.assertEqual(check['conclusion'], 'failure')
        self.assertTrue(self.git('ls-remote', 'origin', 'refs/heads/' + publisher.BRANCH).startswith(first['sha']))

    def test_invalid_conclusion_has_no_mutations(self):
        with self.assertRaises(ValueError):
            self.publish(conclusion='neutral')
        self.assertEqual(self.calls, [])


if __name__ == '__main__':
    unittest.main()
