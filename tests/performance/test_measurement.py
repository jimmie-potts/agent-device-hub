import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/performance'))
from admission import summary_ns


class SampleSummaryTests(unittest.TestCase):
    def test_nearest_rank_does_not_interpolate(self):
        result = summary_ns(list(range(1, 101)))
        self.assertEqual(result['p95Ns'], 95)
        self.assertEqual(result['p99Ns'], 99)

    def test_sparse_tail_is_explicit(self):
        self.assertEqual(summary_ns([7])['p99SampleSupport'], 'provisional')

    def test_invalid_samples_are_rejected(self):
        for samples in ([], [-1], [float('nan')], [True]):
            with self.subTest(samples=samples), self.assertRaises(ValueError):
                summary_ns(samples)


class SourceGuardTests(unittest.TestCase):
    def test_source_tampering_is_rejected(self):
        import admission
        import tempfile
        import shutil
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary)
            for name in admission.SOURCE_HASHES:
                shutil.copyfile(admission.VENDOR / name, target / name)
            self.assertEqual(admission.verify_source(target), target.resolve())
            file = target / 'bridge.py'
            file.write_bytes(file.read_bytes() + b'\n')
            with self.assertRaisesRegex(ValueError, 'source-hash-mismatch'):
                admission.verify_source(target)


class WorkerTests(unittest.TestCase):
    def run_program(self, program, timeout=10):
        import admission
        return admission.run_worker([sys.executable, '-B', '-c', program], 1, 2, 0, timeout)

    def test_timeout_is_retained(self):
        result = self.run_program('import time; time.sleep(5)', .05)
        self.assertEqual(result['status'], 'timeout')
        self.assertGreater(result['parentRoundtripNs'], 0)

    def test_failure_does_not_export_content(self):
        import json
        result = self.run_program("import sys; sys.stderr.write('private-canary'); sys.exit(4)")
        self.assertEqual(result['status'], 'worker-failed')
        self.assertEqual(result['exitCode'], 4)
        self.assertNotIn('private-canary', json.dumps(result))

    def test_invalid_or_excess_output_is_rejected(self):
        for program in ["print('not-json')", "print('{}')", "print('x'*2100000)"]:
            with self.subTest(program=program):
                self.assertEqual(self.run_program(program)['status'], 'invalid-worker-output')

    def test_real_committed_admission_and_typed_samples(self):
        import admission
        script = Path(admission.__file__).resolve()
        result = admission.run_worker([sys.executable, '-B', str(script), '--worker', '--task', '1',
                                       '--bursts', '2', '--warmup-bursts', '0'], 1, 2, 0, 20)
        self.assertEqual(result['status'], 'complete')
        value = result['worker']
        self.assertEqual(len(value['operationNs']), 2)
        self.assertTrue(admission.validate_worker(value, 1, 2, 0))
        self.assertFalse(admission.validate_worker(value, 10, 2, 0))
        value['operationNs'][0] = True
        self.assertFalse(admission.validate_worker(value, 1, 2, 0))

    def test_guard_denies_operations_before_effect(self):
        import admission
        import subprocess
        import tempfile
        program = '''
import sys, socket, sqlite3, subprocess
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import admission
state=Path(sys.argv[2]); admission.install_guard(state)
try:
 if sys.argv[3]=='network': socket.socket()
 elif sys.argv[3]=='process': subprocess.run([sys.executable,'-c','pass'])
 else: sqlite3.connect(state.parent/'outside.sqlite')
except RuntimeError: print('denied')
else: raise SystemExit(3)
'''
        for action in ['network', 'process', 'database']:
            with self.subTest(action=action), tempfile.TemporaryDirectory() as temporary:
                state = Path(temporary) / 'state'
                state.mkdir()
                child = subprocess.run([sys.executable, '-B', '-c', program,
                                        str(Path(admission.__file__).parent), str(state), action],
                                       capture_output=True, timeout=10)
                self.assertEqual(child.returncode, 0)
                self.assertEqual(child.stdout.strip(), b'denied')
                self.assertEqual(child.stderr, b'')
                self.assertFalse((state.parent / 'outside.sqlite').exists())


if __name__ == '__main__':
    unittest.main()
