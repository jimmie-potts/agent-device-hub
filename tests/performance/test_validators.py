import hashlib
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/performance'))
import validators as tool


class ValidatorToolTests(unittest.TestCase):
    def test_manifest_tampering_and_escape(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = root / 'source.js'
            path.write_bytes(b'reviewed-source')
            files = {'source.js': hashlib.sha256(path.read_bytes()).hexdigest()}
            tool.verify_files(root, files)
            path.write_bytes(b'changed-source')
            with self.assertRaises(ValueError):
                tool.verify_files(root, files)
            with self.assertRaises(ValueError):
                tool.verify_files(root, {'../outside': '0' * 64})

    def test_nested_detachment(self):
        original = {'identity': {'sessionId': 'neutral'}}
        self.assertFalse(tool.detached_equal(original, original))
        self.assertFalse(tool.detached_equal({'identity': original['identity']}, original))
        self.assertTrue(tool.detached_equal({'identity': {'sessionId': 'neutral'}}, original))

    def test_protocol_and_private_failure(self):
        program = 'print(\'{"type":"ready"}\', flush=True); print(\'{"type":"result"}\', flush=True)'
        result = tool.collect([sys.executable, '-I', '-c', program], 10)
        self.assertEqual(result['status'], 'complete')
        self.assertGreaterEqual(result['parentRoundtripNs'], result['parentSpawnToReadyNs'])
        self.assertFalse(tool.check_records(result['records'], 'python', 1))
        failed = tool.collect([sys.executable, '-I', '-c', "raise RuntimeError('private-canary')"], 10)
        self.assertEqual(failed['status'], 'worker-failed')
        self.assertNotIn('private-canary', str(failed))

    def test_timeout_and_invalid_output(self):
        result = tool.collect([sys.executable, '-I', '-c', 'import time; time.sleep(5)'], .05)
        self.assertEqual(result['status'], 'timeout')
        for program in ("print('{}\\n{}\\n{}')", f"print('x' * {tool.MAX_LINE + 1})"):
            result = tool.collect([sys.executable, '-I', '-c', program], 10)
            self.assertEqual(result['status'], 'invalid-worker-output')


if __name__ == '__main__':
    unittest.main()
