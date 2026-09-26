"""Exercise orchestration gates without GitHub writes or browser execution."""
import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import nightly_run as runner


class RunnerFixture(unittest.TestCase):
    def setUp(self):
        scratch = Path(os.environ.get('TMPDIR', runner.ROOT / '.local/scratch/goal-guide-validation'))
        scratch.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='runner-test-', dir=scratch)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.guide = self.root / 'docs/work-guide'
        self.work = self.guide / 'work'
        for name in ('backlogs', 'history'):
            (self.work / name).mkdir(parents=True)
        (self.guide / 'outputs').mkdir()
        (self.guide / 'outputs/guide.html').write_text('accepted output')
        (self.work / 'backlogs/snapshot.json').write_text(json.dumps({'refreshedAt': '2026-09-26T12:00:00Z'}))
        self.evidence = self.root / 'evidence'
        self.addCleanup(patch.stopall)
        patch.object(runner, 'ROOT', self.root).start()
        patch.object(runner, 'GUIDE', self.guide).start()


class ValidationTests(RunnerFixture):
    def setUp(self):
        super().setUp()
        self.evidence.mkdir()

    def commands(self, status=0, result=None, failures=None, mutate=None, maintenance=None):
        failures = failures or {}
        result = result if result is not None else {'status': 'passed'}
        def execute(args, log):
            if log.name == 'fresh-input-validation.log':
                (self.evidence / 'fresh-input-validation.json').write_text(json.dumps(result))
                code = status
            else:
                code = failures.get(log.name, 0)
            if '--direction-result' in args and maintenance is not False:
                receipt = maintenance if maintenance is not None else dict(completed=True, eligible=True, testsRun=125,
                    failures=0, errors=0, unrelatedSkips=0, unexpectedSuccesses=0, expectedFailures=0, directionBlocked=[])
                Path(args[args.index('--direction-result') + 1]).write_text(json.dumps(receipt))
            if mutate:
                mutate(log.name)
            return code
        return patch.object(runner, 'command', side_effect=execute)

    def test_success_requires_build_rebuild_maintenance_and_browser(self):
        with self.commands() as calls:
            result = runner.validate(self.evidence)
        self.assertTrue(result['generatedOutputValidated'])
        self.assertTrue(result['browserValidated'])
        self.assertEqual([call.args[1].name for call in calls.call_args_list], [
            'fresh-input-validation.log', 'build.log', 'rebuild.log',
            'fresh-maintenance.log', 'browser.log'])

    def test_non_direction_failure_does_not_attempt_build(self):
        with self.commands(status=1, result={'status': 'failed'}) as calls:
            with self.assertRaisesRegex(RuntimeError, 'non-Direction'):
                runner.validate(self.evidence)
        self.assertEqual(calls.call_count, 1)

    def test_direction_status_requires_exact_exit_code(self):
        with self.commands(status=1, result={'status': 'direction-stale', 'directionError': 'H10 closed'}):
            with self.assertRaisesRegex(RuntimeError, 'non-Direction'):
                runner.validate(self.evidence)

    def test_direction_failure_preserves_output_and_reports_blocked_checks(self):
        with self.commands(status=3, result={'status': 'direction-stale', 'directionError': 'H10 closed'},
                           failures={'blocked-build.log': 1}) as calls:
            result = runner.validate(self.evidence)
        self.assertEqual(result['directionError'], 'H10 closed')
        self.assertEqual(result['maintenanceExit'], 0)
        self.assertNotIn('browserValidated', result)
        self.assertEqual([call.args[1].name for call in calls.call_args_list], [
            'fresh-input-validation.log', 'blocked-build.log', 'fresh-maintenance.log'])
        self.assertEqual((self.guide / 'outputs/guide.html').read_text(), 'accepted output')

    def test_direction_failure_rejects_non_direction_maintenance_failure_or_missing_receipt(self):
        for code, receipt in ((2, None), (0, False), (0, {'completed':False,'eligible':True}),
                              (0, {'completed':True,'eligible':True,'testsRun':125,'errors':1})):
            with self.subTest(code=code, receipt=receipt):
                (self.evidence / 'fresh-maintenance.json').unlink(missing_ok=True)
                with self.commands(status=3, result={'status':'direction-stale'},
                                   failures={'blocked-build.log':1,'fresh-maintenance.log':code}, maintenance=receipt):
                    with self.assertRaisesRegex(RuntimeError, 'Fresh maintenance'):
                        runner.validate(self.evidence)

    def test_direction_failure_refuses_unexpected_default_build_success(self):
        with self.commands(status=3, result={'status': 'direction-stale'}):
            with self.assertRaisesRegex(RuntimeError, 'default build failure/output'):
                runner.validate(self.evidence)

    def test_input_only_validation_must_not_change_output(self):
        def mutate(name):
            if name == 'fresh-input-validation.log':
                (self.guide / 'outputs/guide.html').write_text('unexpected write')
        with self.commands(mutate=mutate):
            with self.assertRaisesRegex(RuntimeError, 'Input-only validation changed'):
                runner.validate(self.evidence)

    def test_rebuild_drift_fails_before_browser(self):
        def mutate(name):
            if name == 'rebuild.log':
                (self.guide / 'outputs/guide.html').write_text('drift')
        with self.commands(mutate=mutate) as calls:
            with self.assertRaisesRegex(RuntimeError, 'not deterministic'):
                runner.validate(self.evidence)
        self.assertFalse(any(call.args[1].name == 'browser.log' for call in calls.call_args_list))

    def test_maintenance_failure_blocks_browser_success_claim(self):
        with self.commands(failures={'fresh-maintenance.log': 1}) as calls:
            with self.assertRaisesRegex(RuntimeError, 'fresh-maintenance.log'):
                runner.validate(self.evidence)
        self.assertFalse(any(call.args[1].name == 'browser.log' for call in calls.call_args_list))

    def test_browser_failure_does_not_return_validation_success(self):
        with self.commands(failures={'browser.log': 1}):
            with self.assertRaisesRegex(RuntimeError, 'browser.log'):
                runner.validate(self.evidence)


class OrchestrationTests(RunnerFixture):
    def setUp(self):
        super().setUp()
        self.source = 'a' * 40
        self.base = 'b' * 40
        self.rolling = 'c' * 40
        self.drift = ''
        self.summary = self.root / 'summary.md'
        patch.dict(os.environ, {'GITHUB_EVENT_NAME': 'workflow_dispatch', 'GITHUB_RUN_ID': '123',
                                'GITHUB_STEP_SUMMARY': str(self.summary)}).start()
        def git(*args):
            if args[:1] == ('diff',):
                return self.drift
            if args[:1] == ('ls-remote',):
                return self.rolling + '\trefs/heads/' + runner.BRANCH if self.rolling else ''
            if args == ('rev-parse', 'HEAD'):
                return self.source
            if args == ('rev-parse', 'origin/main'):
                return self.base
            return ''
        self.git = patch.object(runner, 'git', side_effect=git).start()
        self.require = patch.object(runner, 'require').start()
        self.validation = patch.object(runner, 'validate', return_value={'status': 'passed'}).start()
        patch.object(runner.guide_retired, 'saved_issues', return_value={}).start()
        self.scan = patch.object(runner.guide_retired, 'scan', return_value=([], [])).start()
        patch.object(runner, 'load_snapshots', return_value={}).start()
        patch.object(runner, 'render_report', return_value='Refresh report\n').start()
        self.publish = patch.object(runner, 'publish', return_value={'changed': True, 'sha': 'd' * 40, 'pr_url': 'https://example.invalid/pr/1'}).start()
        self.refresh = patch.object(runner.subprocess, 'run').start()
        self.refresh.return_value.returncode = 0
        self.fixture = patch.object(runner, 'close_direction_fixture', return_value='H10').start()

    def run_main(self, mode='live'):
        with contextlib.redirect_stdout(io.StringIO()):
            return runner.main(['--mode', mode, '--evidence', str(self.evidence)])

    def test_live_success_passes_verified_result_and_exact_revisions(self):
        self.assertEqual(self.run_main(), 0)
        args = self.publish.call_args.args
        self.assertEqual(args[0], self.root)
        self.assertEqual(args[2], 'success')
        self.assertIn(self.source, args[3])
        self.assertEqual(args[4:], (self.base, self.rolling))
        self.assertIn('Fresh generation', args[1].read_text())
        restores = [call.args for call in self.git.call_args_list if call.args[0] == 'restore']
        self.assertEqual(len(restores), 1)
        self.assertEqual(restores[0][-len(runner.ALLOWLIST):], runner.ALLOWLIST)

    def test_refresh_failure_never_validates_or_publishes_partial_inputs(self):
        self.refresh.return_value.returncode = 1
        with self.assertRaisesRegex(RuntimeError, 'Input refresh failed'):
            self.run_main()
        self.validation.assert_not_called()
        self.publish.assert_not_called()

    def test_non_direction_validation_failure_never_publishes(self):
        self.validation.side_effect = RuntimeError('non-Direction failure')
        with self.assertRaisesRegex(RuntimeError, 'non-Direction'):
            self.run_main()
        self.publish.assert_not_called()

    def test_retired_scan_errors_block_publication(self):
        self.scan.return_value = ([], ['malformed retired-term configuration'])
        with self.assertRaisesRegex(RuntimeError, 'malformed'):
            self.run_main()
        self.publish.assert_not_called()

    def test_fixture_dispatch_publishes_red_and_exits_failure(self):
        self.validation.return_value = {'status': 'direction-stale', 'directionError': 'H10 closed', 'maintenanceExit': 1}
        self.assertEqual(self.run_main('direction-failure'), 1)
        args = self.publish.call_args.args
        self.assertEqual(args[2], 'failure')
        self.assertIn('needs owner rewrite of guide_direction.py', args[3])
        self.assertIn('H10 closed', args[3])
        report = args[1].read_text()
        self.assertIn('not live tracker state', report)
        self.assertIn('Do not merge this fixture PR', report)
        self.assertIn('generated output is retained', report)
        self.assertNotIn('Fresh generation, deterministic rebuild, maintenance and browser checks passed.', report)
        self.refresh.assert_not_called()

    def test_fixture_modes_require_manual_dispatch(self):
        with patch.dict(os.environ, {'GITHUB_EVENT_NAME': 'schedule'}), contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                self.run_main('replay')
        self.require.assert_not_called()
        self.publish.assert_not_called()

    def test_replay_requires_existing_rolling_snapshot(self):
        self.rolling = ''
        with self.assertRaisesRegex(RuntimeError, 'Replay requires'):
            self.run_main('replay')
        self.validation.assert_not_called()
        self.publish.assert_not_called()

    def test_replay_does_not_refresh_live_or_inject_fixture(self):
        self.publish.return_value = {'changed': False, 'sha': self.rolling, 'pr_url': 'https://example.invalid/pr/1'}
        self.assertEqual(self.run_main('replay'), 0)
        self.refresh.assert_not_called()
        self.fixture.assert_not_called()
        self.assertTrue(self.summary.read_text().startswith('no change\n'))

    def test_main_tooling_difference_blocks_all_refresh_and_publication(self):
        self.drift = 'docs/work-guide/work/build_guide.py'
        with self.assertRaisesRegex(RuntimeError, 'Main tooling or authored inputs changed'):
            self.run_main()
        self.refresh.assert_not_called()
        self.validation.assert_not_called()
        self.publish.assert_not_called()

    def test_baseline_failure_blocks_git_and_publication(self):
        self.require.side_effect = RuntimeError('baseline failed')
        with self.assertRaisesRegex(RuntimeError, 'baseline failed'):
            self.run_main()
        self.git.assert_not_called()
        self.publish.assert_not_called()


if __name__ == '__main__':
    unittest.main()
