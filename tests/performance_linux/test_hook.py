"""Linux hook qualification must reject unpinned input before executing it."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]

class HookQualification(unittest.TestCase):
    def test_modified_source_rejected_before_execution(self):
        path = ROOT / 'scripts/performance/linux_hook.py'
        spec = importlib.util.spec_from_file_location('linux_hook', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp)
            for name in module.SOURCE_HASHES:
                (source / name).write_bytes((module.VENDOR / name).read_bytes())
            (source / 'bridge.py').write_text('raise RuntimeError("must never execute")')
            with self.assertRaisesRegex(ValueError, 'source-hash-mismatch'):
                module.verify_source(source)

if __name__ == '__main__':
    unittest.main()

class LinuxIsolation(unittest.TestCase):
    def test_real_hook_and_namespace_confinement(self):
        path = ROOT / 'scripts/performance/linux_hook.py'
        spec = importlib.util.spec_from_file_location('linux_hook', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        result = module.run_profile(tasks=1, bursts=2, timeout=30)
        self.assertEqual(result['status'], 'passed')
        self.assertEqual(result['samples'], 2)
        self.assertTrue(result['handoffPreflight']['passed'])
        self.assertTrue(result['handoffPreflight']['realWorkerCommand'])
        self.assertTrue(result['handoffPreflight']['workerConnectedOwnerLock'])
        self.assertEqual(result['workerExitCount'], 3)  # first call plus warm samples
        self.assertEqual(result['remainingChildren'], 0)
        self.assertTrue(result['confinement']['privatePathsAbsent'])
        self.assertTrue(result['confinement']['externalNetworkDenied'])
        self.assertTrue(result['confinement']['sourceReadOnly'])

class CleanupFailures(unittest.TestCase):
    def setUp(self):
        spec=importlib.util.spec_from_file_location('linux_hook',ROOT/'scripts/performance/linux_hook.py')
        self.module=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.module)
    def test_detached_child_reaped(self):
        result=self.module.run_profile(probe='cleanup')
        self.assertTrue(result['detachedReaped'])
        self.assertEqual(result['remainingChildren'],0)
    def test_namespace_timeout_kills_detached_child(self):
        result=self.module.run_profile(probe='timeout',timeout=.5)
        self.assertEqual(result['error'],'namespace-timeout')
        self.assertTrue(result['namespaceGone'])
    def test_namespace_parent_failure_kills_detached_child(self):
        result=self.module.run_profile(probe='crash')
        self.assertEqual(result['error'],'namespace-failed')
        self.assertTrue(result['namespaceGone'])
    def test_failure_cases_keep_results_and_no_workers(self):
        result=self.module.run_profile(failures=True)
        self.assertEqual(result['status'],'passed')
        self.assertEqual(result['failureCases']['unexpectedWorkers'],0)
        for name in ('malformedInput','unavailableState','databaseContention'):
            self.assertTrue(result['failureCases'][name]['hadStderr'])
            self.assertFalse(result['failureCases'][name]['timedOut'])

    def test_output_flood_is_bounded(self):
        result=self.module.run_profile(probe='output',timeout=10)
        self.assertEqual(result['error'],'output-limit')
        self.assertTrue(result['outputBounded'])
        self.assertTrue(result['namespaceGone'])
    def test_partial_samples_survive_namespace_failure(self):
        result=self.module.run_profile(probe='partial-crash')
        self.assertEqual(result['status'],'failed')
        self.assertIn('firstCall',result['partialRecords'][0])
        self.assertTrue(result['namespaceGone'])
    def test_incomplete_pooled_samples_are_provisional(self):
        result=self.module.pooled([{'tasks':1,'status':'failed','raw':[{'durationNs':100}]}])
        self.assertEqual(result['1']['support'],'provisional')
        self.assertEqual(result['1']['summary']['n'],1)
        self.assertIsNone(result['10']['summary'])

    def test_cli_errors_do_not_export_exception_content(self):
        import contextlib
        import io
        from unittest.mock import patch
        output=io.StringIO()
        with patch.object(self.module,'main',side_effect=ValueError('private-content')), contextlib.redirect_stdout(output):
            code=self.module.cli()
        self.assertEqual(code,1)
        self.assertEqual(output.getvalue().strip(),'{"status": "failed", "error": "linux-qualification-failed"}')
