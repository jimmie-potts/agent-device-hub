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

class Preparation(unittest.TestCase):
    def test_builds_are_confined_and_detached_build_children_are_reaped(self):
        import os
        import shutil
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory:
            private=Path(directory)/'private-canary';private.write_text('private')
            work=Path(directory)/'work';work.mkdir()
            script="""const fs=require('node:fs'),net=require('node:net'),assert=require('node:assert/strict');
assert.equal(process.env.QUALIFICATION_PRIVATE_CANARY,undefined);
assert.equal(fs.existsSync(PRIVATE_PATH),false);assert.equal(fs.existsSync('/mnt/c'),false);
const socket=net.connect({host:'192.0.2.1',port:80});socket.setTimeout(200,()=>socket.destroy(new Error('no-route')));
socket.on('connect',()=>{throw new Error('external-network');});
socket.on('error',()=>{require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'}).unref();});
""".replace('PRIVATE_PATH',repr(str(private)))
            for name,task in [('pixoo','build:types'),('hub-source','build')]:
                package=work/name;package.mkdir()
                import json
                (package/'package.json').write_text(json.dumps({'name':'confined-fixture','version':'1.0.0','scripts':{task:'node probe.cjs'}}))
                (package/'package-lock.json').write_text(json.dumps({'name':'confined-fixture','version':'1.0.0','lockfileVersion':3,'packages':{'':{'name':'confined-fixture','version':'1.0.0'}}}))
                (package/'probe.cjs').write_text(script)
            npm_root,npm_cli=m.npm_runtime()
            command=m.namespace_command([(Path(shutil.which('node')).resolve(),'/node'),(npm_root,str(npm_root)),(ROOT/'scripts/performance/standalone-prepare.py','/prepare.py')],['/usr/bin/python3','-I','-B','/prepare.py',str(npm_cli)],writable=[(work,'/work')])
            with patch.dict(os.environ,{'QUALIFICATION_PRIVATE_CANARY':'private'}):
                result=m.supervise(command,timeout=30)
            self.assertIsNone(result['error'],result)
            self.assertTrue(result['cleanup'])
            self.assertTrue(result['result']['node'].startswith('v24.'))

    def test_only_locked_cache_bytes_and_safe_metadata_are_staged(self):
        import base64,hashlib,json
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);cache=root/'cache';target=root/'staged'
            data=b'locked-tarball';digest=hashlib.sha512(data).digest();hexdigest=digest.hex()
            integrity='sha512-'+base64.b64encode(digest).decode()
            url='https://registry.npmjs.org/fixture/-/fixture-1.0.0.tgz';key='make-fetch-happen:request-cache:'+url
            hashed=hashlib.sha256(key.encode()).hexdigest();index=Path('index-v5')/hashed[:2]/hashed[2:4]/hashed[4:]
            content=Path('content-v2/sha512')/hexdigest[:2]/hexdigest[2:4]/hexdigest[4:]
            (cache/index).parent.mkdir(parents=True);(cache/content).parent.mkdir(parents=True)
            (cache/content).write_bytes(data)
            entry={'key':key,'integrity':integrity,'time':1,'size':len(data),'metadata':{'reqHeaders':{'authorization':'SECRET'},'resHeaders':{'set-cookie':'SECRET','content-type':'application/octet-stream'}}}
            (cache/index).write_text('ignored\t'+json.dumps(entry)+'\n');(cache/'unrelated-private').write_text('SECRET')
            lock=root/'lock.json';lock.write_text(json.dumps({'packages':{'node_modules/fixture':{'resolved':url,'integrity':integrity}}}))
            self.assertEqual(m.stage_cache(lock,cache,target),1)
            self.assertEqual((target/'_cacache'/content).read_bytes(),data)
            self.assertNotIn('SECRET',(target/'_cacache'/index).read_text())
            self.assertFalse((target/'_cacache/unrelated-private').exists())
            (cache/content).write_bytes(b'corrupted')
            with self.assertRaisesRegex(ValueError,'cache-integrity-mismatch'):m.stage_cache(lock,cache,target)

if __name__=='__main__':unittest.main()
