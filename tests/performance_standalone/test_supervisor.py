import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('standalone', ROOT / 'scripts/performance/standalone.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class Supervision(unittest.TestCase):
    def run_fixture(self, body, timeout=5):
        with tempfile.TemporaryDirectory() as directory:
            script=Path(directory)/'fixture.py'
            script.write_text("import json,sys,os,time,socket\nprint('{\"ready\":true}',flush=True)\nassert sys.stdin.read(1)=='1'\n"+body)
            return m.supervise(m.namespace_command([(script,'/fixture.py')], ['/usr/bin/python3','-I','-B','/fixture.py']), timeout)

    def test_success_cannot_access_private_state_or_external_network(self):
        result=self.run_fixture("assert not os.path.exists('/home/jimmie')\nassert not os.path.exists('/mnt/c')\ns=socket.socket();s.settimeout(.1)\ntry:\n s.connect(('192.0.2.1',80));raise AssertionError('external route')\nexcept OSError: pass\nprint(json.dumps({'result':{'confined':True}}),flush=True)\n")
        self.assertEqual(result['result'], {'confined':True})
        self.assertTrue(result['cleanup'])
        self.assertIsNone(result['error'])

    def test_timeout_kills_detached_descendant(self):
        result=self.run_fixture("pid=os.fork()\nif pid==0:\n os.setsid()\n time.sleep(60)\ntime.sleep(60)\n", .3)
        self.assertEqual(result['error'], 'namespace-timeout')
        self.assertTrue(result['cleanup'])

    def test_failure_retains_failure_and_cleans_namespace(self):
        result=self.run_fixture("print(json.dumps({'result':{'partial':True}}),flush=True)\nraise SystemExit(7)\n")
        self.assertEqual(result['result'], {'partial':True})
        self.assertEqual(result['exitCode'],7)
        self.assertTrue(result['cleanup'])
        self.assertIsNotNone(result['error'])

    def test_oversized_output_fails(self):
        result=self.run_fixture("print('x'*1100000,flush=True)\ntime.sleep(60)\n")
        self.assertEqual(result['error'],'output-limit')
        self.assertTrue(result['cleanup'])

class Staging(unittest.TestCase):
    def test_scoped_package_link_cannot_escape_source_root(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);source=root/'source';source.mkdir()
            scope=source/'@pixoo';scope.mkdir()
            (scope/'escape').symlink_to('/usr')
            with self.assertRaisesRegex(ValueError,'external-runtime-link'):
                m.copy_tree(source,root/'output')

    def test_invalid_supervisor_timeout_is_rejected_before_launch(self):
        for value in [0,-1,601]:
            with self.subTest(value=value), self.assertRaisesRegex(ValueError,'invalid-timeout'):
                m.supervise(['/does-not-exist'],value)

    def test_success_reaps_detached_descendant(self):
        result=Supervision().run_fixture("pid=os.fork()\nif pid==0:\n os.setsid()\n time.sleep(60)\n os._exit(0)\nprint(json.dumps({'result':{'done':True}}),flush=True)\n")
        self.assertIsNone(result['error']);self.assertTrue(result['cleanup'])

if __name__=='__main__':unittest.main()
