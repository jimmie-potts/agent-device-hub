"""Diagnostic maintenance runs distinguish typed blockers from regressions."""
import contextlib
import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import maintenance_diagnostics as diagnostics


class DiagnosticTests(unittest.TestCase):
    def setUp(self):
        scratch = Path(__file__).resolve().parents[3] / '.local/scratch/goal-guide-validation'
        scratch.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='diagnostic-tests-', dir=scratch)
        self.addCleanup(self.temp.cleanup)
        self.result_path = Path(self.temp.name) / 'result.json'
        self.calls = []

    def fake_builder(self, command, **kwargs):
        self.calls.append(command)
        if '--validate-inputs' in command:
            Path(command[command.index('--validation-result') + 1]).write_text(json.dumps({
                'status': 'direction-stale', 'directionError': 'H10 closed'}))
            return subprocess.CompletedProcess(command, 3)
        return subprocess.CompletedProcess(command, 1)

    def build(self):
        result = subprocess.run([sys.executable, '/fixture/work/build_guide.py'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0)

    def execute(self, functions, side_effect=None):
        suite = unittest.TestSuite(unittest.FunctionTestCase(fn) for fn in functions)
        with patch.object(subprocess, 'run', side_effect=side_effect or self.fake_builder), contextlib.redirect_stderr(io.StringIO()):
            code = diagnostics.run_suite(suite, self.result_path)
        return code, json.loads(self.result_path.read_text())

    def test_typed_direction_block_is_explicit_not_passed(self):
        code, result = self.execute([self.build])
        self.assertEqual(code, 0)
        self.assertTrue(result['completed'])
        self.assertTrue(result['eligible'])
        self.assertEqual(result['testsRun'], 1)
        self.assertEqual(len(result['directionBlocked']), 1)
        self.assertEqual(result['directionBlocked'][0]['diagnostic']['directionError'], 'H10 closed')
        self.assertEqual(result['failures'], 0)
        self.assertEqual(result['errors'], 0)
        self.assertEqual(result['unrelatedSkips'], 0)

    def test_unrelated_assertion_is_retained_alongside_direction_block(self):
        def regression():
            self.assertEqual(1, 2, 'independent regression')
        code, result = self.execute([self.build, regression])
        self.assertEqual(code, 1)
        self.assertEqual(len(result['directionBlocked']), 1)
        self.assertEqual(result['failures'], 1)
        self.assertIn('independent regression', result['failureDetails'][0]['traceback'])
        self.assertFalse(result['eligible'])

    def test_non_direction_diagnostic_preserves_original_build_failure(self):
        def non_direction(command, **kwargs):
            if '--validation-result' in command:
                Path(command[-1]).write_text('{"status": "failed"}')
            return subprocess.CompletedProcess(command, 1)
        code, result = self.execute([self.build], non_direction)
        self.assertEqual(code, 1)
        self.assertEqual(result['failures'], 1)
        self.assertEqual(result['directionBlocked'], [])

    def test_matching_stderr_without_typed_result_never_blocks(self):
        code, result = self.execute([self.build], lambda command, **kwargs:
            subprocess.CompletedProcess(command, 3, stderr='direction-stale: H10 closed'))
        self.assertEqual(code, 1)
        self.assertFalse(result['eligible'])
        self.assertEqual(result['directionBlocked'], [])

    def test_diagnostic_wrong_exit_does_not_hide_failure(self):
        def wrong_exit(command, **kwargs):
            result = self.fake_builder(command, **kwargs)
            return subprocess.CompletedProcess(command, 1) if '--validate-inputs' in command else result
        code, result = self.execute([self.build], wrong_exit)
        self.assertEqual(code, 1)
        self.assertEqual(result['failures'], 1)

    def test_subprocess_interrupt_and_errors_are_test_errors(self):
        for error in (KeyboardInterrupt(), OSError('unavailable builder')):
            with self.subTest(error=type(error).__name__):
                code, result = self.execute([self.build], lambda *args, **kwargs: (_ for _ in ()).throw(error))
                self.assertEqual(code, 1)
                self.assertEqual(result['errors'], 1)
                self.assertEqual(result['directionBlocked'], [])

    def test_ordinary_skip_is_ineligible(self):
        def skipped():
            raise unittest.SkipTest('unrelated unavailable fixture')
        code, result = self.execute([skipped])
        self.assertEqual(code, 1)
        self.assertEqual(result['unrelatedSkips'], 1)
        self.assertEqual(result['directionBlocked'], [])

    def test_nondefault_builder_call_is_not_intercepted(self):
        def explicit_validation():
            result = subprocess.run([sys.executable, '/fixture/work/build_guide.py', '--other-mode'])
            self.assertEqual(result.returncode, 0)
        code, result = self.execute([explicit_validation])
        self.assertEqual(code, 1)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(result['failures'], 1)

    def test_interrupted_suite_removes_stale_receipt_and_writes_no_completion(self):
        self.result_path.write_text('{"completed": true, "eligible": true}')
        def interrupted():
            raise KeyboardInterrupt()
        suite = unittest.TestSuite([unittest.FunctionTestCase(interrupted)])
        with self.assertRaises(KeyboardInterrupt), contextlib.redirect_stderr(io.StringIO()):
            diagnostics.run_suite(suite, self.result_path)
        self.assertFalse(self.result_path.exists())

    def test_diagnostic_subprocess_interruption_is_an_error(self):
        def interrupted_probe(command, **kwargs):
            if '--validate-inputs' in command:
                raise KeyboardInterrupt()
            return subprocess.CompletedProcess(command, 1)
        code, result = self.execute([self.build], interrupted_probe)
        self.assertEqual(code, 1)
        self.assertEqual(result['errors'], 1)
        self.assertEqual(result['directionBlocked'], [])

    def test_empty_suite_cannot_authorize_publication(self):
        code, result = self.execute([])
        self.assertEqual(code, 1)
        self.assertFalse(result['eligible'])
        self.assertEqual(result['testsRun'], 0)

    def test_expected_failure_is_not_eligible(self):
        class ExpectedFailureCase(unittest.TestCase):
            @unittest.expectedFailure
            def test_known_failure(self):
                self.fail('known but unverified behavior')
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(ExpectedFailureCase)
        with contextlib.redirect_stderr(io.StringIO()):
            code = diagnostics.run_suite(suite, self.result_path)
        result = json.loads(self.result_path.read_text())
        self.assertEqual(code, 1)
        self.assertFalse(result['eligible'])
        self.assertEqual(result['expectedFailures'], 1)

    def test_successful_build_is_not_probed(self):
        def succeeded(command, **kwargs):
            self.calls.append(command)
            return subprocess.CompletedProcess(command, 0)
        code, result = self.execute([self.build], succeeded)
        self.assertEqual(code, 0)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(result['directionBlocked'], [])


if __name__ == '__main__':
    unittest.main()
