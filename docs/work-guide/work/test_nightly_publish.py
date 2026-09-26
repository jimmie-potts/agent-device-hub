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
            fixture = self.root / path
            if not fixture.suffix:
                fixture = fixture / 'fixture.json'
            fixture.parent.mkdir(parents=True, exist_ok=True)
            fixture.write_text('before\n')
        self.authored_history = self.root / 'docs/work-guide/work/history/completed-guide-evidence.json'
        self.authored_history.write_text('owner history before\n')
        (self.root / 'source.py').write_text('source before\n')
        self.git('add', '.')
        self.git('commit', '-m', 'base')
        self.base = self.git('rev-parse', 'HEAD')
        self.git('push', 'origin', 'main')
        self.report = Path(self.temp.name) / 'report.md'
        self.report.write_text('Verified refresh report\n')
        self.calls = []
        self.prs = []
        self.checks = []
        self.labels = {'existing-label'}
        self.fail_labels = False
        self.fail_edit = False
        self.fail_create = False
        self.fail_check = False
        def gh(root, args, payload=None):
            self.calls.append((args, payload))
            if args[:2] == ['pr', 'list']:
                return json.dumps(self.prs)
            if args[:2] == ['pr', 'edit']:
                raise RuntimeError('GraphQL deprecated projectCards')
            if args[:3] == ['api', '--method', 'PATCH']:
                if self.fail_edit:
                    raise RuntimeError('interrupted PR report update')
                self.assertTrue(args[-1].endswith('/pulls/900'))
            if args[:3] == ['api', '--method', 'POST'] and args[-1].endswith('/labels'):
                if self.fail_labels:
                    raise RuntimeError('interrupted label update')
                self.assertEqual(payload, {'labels': ['documentation']})
                self.labels.update(payload['labels'])
            if args[:2] == ['pr', 'create']:
                if self.fail_create:
                    raise RuntimeError('interrupted PR creation')
                self.prs = [{'number': 900, 'url': 'https://github.com/jimmie-potts/agent-device-hub/pull/900'}]
                return 'https://github.com/jimmie-potts/agent-device-hub/pull/900\n'
            if args[:3] == ['api', '--method', 'POST'] and args[-1].endswith('/check-runs'):
                if self.fail_check:
                    raise RuntimeError('interrupted check creation')
                self.checks.append(dict(payload, id=len(self.checks) + 1, app={'slug': 'github-actions'}))
            if args[:3] == ['api', '--method', 'GET']:
                if '--slurp' in args:
                    raise RuntimeError('gh: unknown flag --slurp')
                self.assertIn('--paginate', args)
                self.assertEqual(args[args.index('--jq') + 1], '.check_runs[] | @json')
                return '\n'.join(json.dumps(check) for check in self.checks)
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
        check = next(payload for args, payload in self.calls if payload is not None and 'head_sha' in payload)
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
        self.assertTrue(self.calls)
        self.assertTrue(all(args[:2] == ['pr', 'list'] or args[:3] == ['api', '--method', 'GET'] for args, _ in self.calls))

    def test_failure_updates_existing_pr_and_posts_red_exact_head(self):
        self.change()
        first = self.publish()
        self.prs = [{'number': 900, 'url': first['pr_url']}]
        self.calls.clear()
        (self.root / publisher.ALLOWLIST[1]).write_text('history after\n')
        result = self.publish(first['sha'], 'failure')
        check = next(payload for args, payload in self.calls if payload is not None and 'head_sha' in payload)
        self.assertEqual(check['head_sha'], result['sha'])
        self.assertEqual(check['conclusion'], 'failure')
        self.assertTrue(any(args[:3] == ['api', '--method', 'PATCH'] for args, _ in self.calls))
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

    def test_unchanged_failure_posts_red_and_updates_report_without_push(self):
        self.change()
        first = self.publish()
        self.calls.clear()
        result = self.publish(first['sha'], 'failure')
        self.assertFalse(result['changed'])
        writes = [(args, payload) for args, payload in self.calls if payload is not None and 'head_sha' in payload]
        self.assertEqual(len(writes), 1)
        args, check = writes[0]
        self.assertEqual(args[0], 'api')
        self.assertEqual(check['head_sha'], first['sha'])
        self.assertEqual(check['conclusion'], 'failure')
        edits = [payload for args, payload in self.calls if args[:3] == ['api', '--method', 'PATCH']]
        self.assertEqual(len(edits), 1)
        self.assertEqual(edits[0], {'title': 'Nightly guide refresh', 'body': self.report.read_text()})
        self.assertTrue(self.git('ls-remote', 'origin', 'refs/heads/' + publisher.BRANCH).startswith(first['sha']))

    def test_interrupted_publish_retries_missing_check_and_pr_without_push(self):
        self.change()
        self.fail_check = True
        with self.assertRaisesRegex(RuntimeError, 'interrupted check'):
            self.publish()
        sha = self.git('ls-remote', 'origin', 'refs/heads/' + publisher.BRANCH).split()[0]
        self.fail_check = False
        self.calls.clear()
        with patch.object(publisher, 'run', wraps=publisher.run) as commands:
            result = self.publish(sha)
        self.assertFalse(any(call.args[1][:2] == ['git', 'push'] for call in commands.call_args_list))
        self.assertFalse(result['changed'])
        self.assertTrue(result['repaired'])
        self.assertEqual(result['sha'], sha)
        self.assertEqual(self.checks[-1]['head_sha'], sha)
        self.assertEqual(len(self.prs), 1)
        self.assertEqual(self.git('ls-remote', 'origin', 'refs/heads/' + publisher.BRANCH).split()[0], sha)

    def test_interrupted_pr_creation_retries_missing_pr_and_check(self):
        self.change()
        self.fail_create = True
        with self.assertRaisesRegex(RuntimeError, 'interrupted PR'):
            self.publish()
        sha = self.git('ls-remote', 'origin', 'refs/heads/' + publisher.BRANCH).split()[0]
        self.fail_create = False
        self.calls.clear()
        result = self.publish(sha)
        self.assertTrue(result['repaired'])
        self.assertEqual(len(self.checks), 1)
        self.assertEqual(len(self.prs), 1)
        self.assertEqual(sum(payload is not None for _, payload in self.calls), 1)

    def test_unchanged_duplicate_prs_refused_without_writes(self):
        self.change()
        first = self.publish()
        self.prs.append({'number': 901, 'url': 'duplicate'})
        self.calls.clear()
        with self.assertRaisesRegex(RuntimeError, 'Multiple'):
            self.publish(first['sha'])
        self.assertTrue(all(args[:2] == ['pr', 'list'] for args, _ in self.calls))

    def test_unchanged_success_replaces_previous_failed_check_with_measured_success(self):
        self.change()
        first = self.publish(conclusion='failure')
        self.calls.clear()
        result = self.publish(first['sha'])
        self.assertTrue(result['repaired'])
        self.assertFalse(result['changed'])
        self.assertEqual(self.checks[-1]['conclusion'], 'success')
        self.assertFalse(any(args[:2] == ['pr', 'create'] for args, _ in self.calls))
        edits = [payload for args, payload in self.calls if args[:3] == ['api', '--method', 'PATCH']]
        self.assertEqual(len(edits), 1)
        self.assertEqual(edits[0], {'title': 'Nightly guide refresh', 'body': self.report.read_text()})

    def test_main_advance_blocks_unchanged_validation_repair(self):
        self.change()
        first = self.publish()
        (self.root / 'source.py').write_text('new main source\n')
        self.git('add', 'source.py')
        self.git('commit', '-m', 'concurrent main')
        self.git('push', 'origin', 'main')
        self.calls.clear()
        with self.assertRaisesRegex(RuntimeError, 'Main advanced'):
            self.publish(first['sha'], 'failure')
        self.assertTrue(all(args[:2] == ['pr', 'list'] or args[:3] == ['api', '--method', 'GET'] for args, _ in self.calls))

    def test_authored_history_is_excluded_from_snapshot_commit(self):
        self.change()
        self.authored_history.write_text('owner history after\n')
        result = self.publish()
        self.assertEqual(self.git('show', result['sha'] + ':docs/work-guide/work/history/completed-guide-evidence.json'), 'owner history before')
        self.assertEqual(self.authored_history.read_text(), 'owner history after\n')

    def test_main_authored_input_advance_rebases_identical_snapshots_before_check(self):
        self.change()
        first = self.publish()
        direction = self.root / 'docs/work-guide/work/guide_direction.py'
        direction.write_text('owner corrected Direction\n')
        self.git('add', str(direction.relative_to(self.root)))
        self.git('commit', '-m', 'Owner updates Direction')
        self.git('push', 'origin', 'main')
        self.base = self.git('rev-parse', 'HEAD')
        self.calls.clear()
        result = self.publish(first['sha'])
        self.assertTrue(result['changed'])
        self.assertNotEqual(result['sha'], first['sha'])
        self.assertEqual(self.git('rev-parse', result['sha'] + '^'), self.base)
        self.assertEqual(self.git('show', result['sha'] + ':docs/work-guide/work/guide_direction.py'), 'owner corrected Direction')
        self.assertEqual(self.git('diff', '--name-only', self.base, result['sha']), publisher.ALLOWLIST[0] + '/fixture.json')
        checks = [payload for _, payload in self.calls if payload is not None and 'head_sha' in payload]
        self.assertEqual(len(checks), 1)
        self.assertEqual(checks[0]['head_sha'], result['sha'])
        self.assertEqual(checks[0]['conclusion'], 'success')

    def test_paginated_check_rows_use_latest_matching_app_sha_and_name(self):
        self.change()
        first = self.publish()
        check = self.checks[0]
        self.checks = [dict(check, id=index, conclusion='failure') for index in range(1, 102)]
        self.checks.extend([
            dict(check, id=102, output={'summary': 'verified\nacross pages'}),
            dict(check, id=103, conclusion='failure', head_sha='e' * 40),
            dict(check, id=104, conclusion='failure', name='Unrelated validation'),
            dict(check, id=105, conclusion='failure', app={'slug': 'other-app'}),
        ])
        self.calls.clear()
        result = self.publish(first['sha'])
        self.assertFalse(result['changed'])
        self.assertFalse(result['repaired'])
        self.assertTrue(all(args[:2] == ['pr', 'list'] or args[:3] == ['api', '--method', 'GET'] for args, _ in self.calls))

    def test_empty_check_rows_repair_existing_pr_validation(self):
        self.change()
        first = self.publish()
        self.checks.clear()
        self.calls.clear()
        result = self.publish(first['sha'])
        self.assertFalse(result['changed'])
        self.assertTrue(result['repaired'])
        self.assertEqual(len(self.checks), 1)
        self.assertEqual(self.checks[0]['head_sha'], first['sha'])
        self.assertFalse(any(args[:2] == ['pr', 'create'] for args, _ in self.calls))

    def test_changed_existing_pr_report_failure_is_recoverable_without_second_push(self):
        self.change()
        first = self.publish()
        (self.root / publisher.ALLOWLIST[1]).write_text('new history\n')
        self.report.write_text('New validation report\n')
        self.fail_edit = True
        with self.assertRaisesRegex(RuntimeError, 'interrupted PR report update'):
            self.publish(first['sha'])
        pushed_sha = self.git('ls-remote', 'origin', 'refs/heads/' + publisher.BRANCH).split()[0]
        self.assertNotEqual(pushed_sha, first['sha'])
        self.fail_edit = False
        self.calls.clear()
        with patch.object(publisher, 'run', wraps=publisher.run) as commands:
            result = self.publish(pushed_sha)
        self.assertFalse(result['changed'])
        self.assertTrue(result['repaired'])
        self.assertFalse(any(call.args[1][:2] == ['git', 'push'] for call in commands.call_args_list))
        self.assertTrue(any(args[:3] == ['api', '--method', 'PATCH'] for args, _ in self.calls))
        self.assertEqual(self.checks[-1]['head_sha'], pushed_sha)
        self.assertEqual(self.checks[-1]['conclusion'], 'success')

    def test_rest_updates_report_and_adds_label_before_exact_sha_check(self):
        self.change()
        first = self.publish()
        (self.root / publisher.ALLOWLIST[1]).write_text('new history\n')
        self.report.write_text('Needs owner rewrite\n\nQuoted "Direction" and Unicode é\n')
        self.calls.clear()
        result = self.publish(first['sha'], 'failure')
        writes = [(args, payload) for args, payload in self.calls if payload is not None]
        self.assertEqual([args[2] for args, _ in writes], ['PATCH', 'POST', 'POST'])
        self.assertTrue(writes[0][0][-1].endswith('/pulls/900'))
        self.assertEqual(writes[0][1], {'title': 'Nightly guide refresh', 'body': self.report.read_text()})
        self.assertTrue(writes[1][0][-1].endswith('/issues/900/labels'))
        self.assertEqual(self.labels, {'existing-label', 'documentation'})
        self.assertEqual(writes[2][1]['head_sha'], result['sha'])
        self.assertEqual(writes[2][1]['conclusion'], 'failure')

    def test_label_failure_retries_without_pushing_or_losing_other_labels(self):
        self.change()
        first = self.publish()
        (self.root / publisher.ALLOWLIST[1]).write_text('new history\n')
        self.fail_labels = True
        with self.assertRaisesRegex(RuntimeError, 'interrupted label update'):
            self.publish(first['sha'])
        pushed_sha = self.git('ls-remote', 'origin', 'refs/heads/' + publisher.BRANCH).split()[0]
        self.assertFalse(any(check['head_sha'] == pushed_sha for check in self.checks))
        self.fail_labels = False
        self.calls.clear()
        with patch.object(publisher, 'run', wraps=publisher.run) as commands:
            result = self.publish(pushed_sha)
        self.assertFalse(result['changed'])
        self.assertTrue(result['repaired'])
        self.assertFalse(any(call.args[1][:2] == ['git', 'push'] for call in commands.call_args_list))
        self.assertEqual(self.labels, {'existing-label', 'documentation'})
        self.assertEqual(self.checks[-1]['head_sha'], pushed_sha)

    def test_invalid_conclusion_has_no_mutations(self):
        with self.assertRaises(ValueError):
            self.publish(conclusion='neutral')
        self.assertEqual(self.calls, [])


if __name__ == '__main__':
    unittest.main()
