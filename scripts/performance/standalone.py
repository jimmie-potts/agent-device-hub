"""Confined standalone qualification. This command never uses installed state."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import selectors
import shutil
import signal
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
MAX_OUTPUT = 1_000_000


def namespace_command(readonly, entry):
    if sys.platform != 'linux' or not shutil.which('bwrap'):
        raise ValueError('linux-bubblewrap-required')
    args=[shutil.which('bwrap'),'--unshare-all','--as-pid-1','--die-with-parent','--new-session',
          '--ro-bind','/usr','/usr','--symlink','usr/bin','/bin','--symlink','usr/lib','/lib',
          '--symlink','usr/lib64','/lib64','--proc','/proc','--dev','/dev',
          '--tmpfs','/tmp','--size','536870912','--tmpfs','/state',
          '--clearenv','--setenv','PATH','/usr/bin','--setenv','HOME','/tmp',
          '--setenv','TMPDIR','/tmp','--setenv','NODE_NO_WARNINGS','1',
          '--chdir','/state']
    for source,destination in readonly:
        args += ['--ro-bind',str(Path(source).resolve()),destination]
    return args+entry


def supervise(args, timeout=120):
    """Acquire the owned init pidfd before releasing source execution.

    Uses the same handshake/cleanup boundary as linux_hook.py. PID namespace
    init death kills even detached descendants; process-group kill alone cannot.
    """
    if not 0 < timeout <= 600:
        raise ValueError('invalid-timeout')
    r,w=os.pipe(); args=[args[0],'--info-fd',str(w),*args[1:]]
    started=time.monotonic(); deadline=started+timeout
    streams={name:bytearray() for name in ('out','err','info')}
    init_fd=None; error=None; released=False; ready=False; child=None
    try:
        child=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,pass_fds=(w,))
    except OSError:
        os.close(r)
        return {'result':None,'cleanup':True,'error':'launch-failed','exitCode':None}
    finally:
        os.close(w)
    def abort():
        if not child.stdin.closed: child.stdin.close()
        if init_fd is not None:
            try: signal.pidfd_send_signal(init_fd,signal.SIGKILL)
            except ProcessLookupError: pass
    try:
        with os.fdopen(r,'rb',buffering=0) as info, selectors.DefaultSelector() as selector:
            for name,stream,cap in [('out',child.stdout,MAX_OUTPUT),('err',child.stderr,65536),('info',info,4096)]:
                selector.register(stream,selectors.EVENT_READ,(name,cap))
            while selector.get_map():
                if time.monotonic()>=deadline:
                    error='namespace-timeout';break
                for key,_ in selector.select(min(.05,max(0,deadline-time.monotonic()))):
                    name,cap=key.data
                    chunk=os.read(key.fd,min(4096,cap-len(streams[name])+1))
                    if not chunk:selector.unregister(key.fileobj);continue
                    if len(streams[name])+len(chunk)>cap:error='output-limit';break
                    streams[name].extend(chunk)
                if error:break
                ready=streams['out'].startswith(b'{"ready":true}\n')
                if ready and not released:
                    try: pid=json.loads(streams['info'])['child-pid']
                    except (ValueError,KeyError):continue
                    if type(pid) is not int or pid<=0: error='invalid-init-pid';break
                    try:init_fd=os.pidfd_open(pid)
                    except OSError:error='pidfd-unavailable';break
                    child.stdin.write(b'1');child.stdin.flush();child.stdin.close();released=True
            if error:abort()
            try:child.wait(timeout=max(.01,deadline-time.monotonic()) if not error else 5)
            except subprocess.TimeoutExpired:
                error=error or 'namespace-timeout';abort()
                try:child.wait(timeout=5)
                except subprocess.TimeoutExpired:child.kill();child.wait(timeout=5)
    except Exception:
        error=error or 'supervision-failed';abort()
        try:child.wait(timeout=5)
        except subprocess.TimeoutExpired:child.kill();child.wait(timeout=5)
    finally:
        if not child.stdin.closed:child.stdin.close()
        child.stdout.close();child.stderr.close()
    gone=False
    if init_fd is not None:
        try:
            with selectors.DefaultSelector() as sel:
                sel.register(init_fd,selectors.EVENT_READ);gone=bool(sel.select(5))
        finally:os.close(init_fd)
    elif not released:
        # No source ran without the handshake. bwrap exit releases its blocked init.
        gone=child.returncode is not None
    result=None
    for line in streams['out'].splitlines():
        try:
            value=json.loads(line)
            if isinstance(value,dict) and 'result' in value:result=value['result']
        except ValueError:pass
    if result is None:error=error or 'missing-result'
    if child.returncode!=0:error=error or 'child-failed'
    if not gone:error=error or 'cleanup-unverified'
    if not released:error=error or 'startup-handshake-failed'
    return {'result':result,'cleanup':gone,'error':error,'exitCode':child.returncode,
            'elapsedMs':round((time.monotonic()-started)*1000,3),
            'stderr':streams['err'].decode('utf8',errors='replace')[:2000]}



def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def archive(repo, revision, destination):
    import io
    import tarfile
    data=subprocess.check_output(['git','-C',str(repo),'archive','--format=tar',revision])
    with tarfile.open(fileobj=io.BytesIO(data)) as tar:
        members=tar.getmembers()
        if any('.env' in Path(m.name).name or m.issym() or m.islnk() for m in members):
            raise ValueError('unexpected-source-link-or-environment-file')
        tar.extractall(destination,filter='data')


def copy_tree(source, destination):
    source=Path(source)
    # Relative npm workspace links may reach sibling packages, never private paths.
    allowed = ROOT if source.resolve().is_relative_to(ROOT) else source.parent.resolve()
    for p in source.rglob('*'):
        if p.is_symlink() and (p.readlink().is_absolute() or not p.resolve().is_relative_to(allowed)):
            raise ValueError('external-runtime-link')
    shutil.copytree(source,destination,symlinks=True,ignore=shutil.ignore_patterns('.git','.env','*.env','__pycache__'))


def stage_hub(destination):
    destination.mkdir()
    shutil.copy2(ROOT/'package.json',destination/'package.json')
    copy_tree(ROOT/'node_modules',destination/'node_modules')
    for group in ['packages','apps/hub']:
        source=ROOT/group
        targets=list(source.iterdir()) if group=='packages' else [source]
        for package in targets:
            out=destination/package.relative_to(ROOT);out.mkdir(parents=True)
            for name in ['package.json','dist','schemas','bin','public','fixtures','node_modules']:
                item=package/name
                if item.is_dir():copy_tree(item,out/name)
                elif item.is_file():shutil.copy2(item,out/name)
    scripts=destination/'scripts/performance';scripts.mkdir(parents=True)
    for name in ['standalone-worker.mjs','standalone-report.mjs','standalone-nanoleaf.py','standalone-pixoo.mjs']:
        shutil.copy2(ROOT/'scripts/performance'/name,scripts/name)


def main():
    from datetime import datetime,timezone
    import platform
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pixoo-repo',type=Path,required=True)
    parser.add_argument('--nanoleaf-repo',type=Path,required=True)
    parser.add_argument('--node',type=Path,required=True)
    parser.add_argument('--browser',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--smoke',action='store_true',help='Development-only, incomplete sample count; never qualifies')
    args=parser.parse_args()
    if args.output.exists():raise ValueError('output-already-exists')
    args.output.mkdir(parents=False,mode=0o700)
    report={'formatVersion':1,'startedAt':datetime.now(timezone.utc).isoformat(),'qualified':False,
            'scope':'Standalone source qualification only; no installation, live client or physical evidence.',
            'host':{'kernel':platform.release(),'architecture':platform.machine(),'loadBefore':os.getloadavg()},
            'failures':[],'smoke':args.smoke}
    try:
        report['hubRevision']=subprocess.check_output(['git','-C',str(ROOT),'rev-parse','HEAD'],text=True).strip()
        dirty=subprocess.check_output(['git','-C',str(ROOT),'status','--porcelain'],text=True)
        if dirty and not args.smoke:raise ValueError('commit-candidate-before-qualification')
        report['sourceClean']=not bool(dirty)
        node=args.node.resolve();browser=args.browser.resolve()
        version=subprocess.check_output([str(node),'--version'],text=True).strip()
        if not version.startswith('v24.'):raise ValueError('node-24-required')
        report['runtimes']={'node':version,'nodeSha256':digest(node),'python':platform.python_version(),'browserSha256':digest(browser)}
        pin=json.loads((ROOT/'apps/hub/fixtures/pixoo-source.json').read_text())
        nano=json.loads((ROOT/'apps/hub/fixtures/nanoleaf-shared-source.json').read_text())
        report['consumerRevisions']={'pixoo':pin['revision'],'nanoleaf':nano['revision']}
        with tempfile.TemporaryDirectory(prefix='hub30-runtime-') as temp:
            root=Path(temp);runtime=root/'runtime';runtime.mkdir()
            px=runtime/'pixoo';px.mkdir();nl=runtime/'nanoleaf';nl.mkdir()
            archive(args.pixoo_repo,pin['revision'],px);archive(args.nanoleaf_repo,nano['revision'],nl)
            for directory,files in [(px,pin['sourceFiles']),(nl,nano['files'])]:
                for path,expected in files.items():
                    if digest(directory/path)!=expected:raise ValueError('source-pin-mismatch')
            build_env={**os.environ,'PATH':str(node.parent)+':'+os.environ.get('PATH','')}
            # Dependency setup and compilation precede isolation and all timing.
            with (args.output/'preparation.log').open('w') as log:
                for command,cwd in [(['npm','ci','--offline','--ignore-scripts'],px),(['npm','run','build:types'],px),(['npm','run','build'],ROOT)]:
                    subprocess.run(command,cwd=cwd,env=build_env,stdout=log,stderr=subprocess.STDOUT,check=True,timeout=180)
            stage_hub(runtime/'hub')
            # Do not mount the source repositories or any personal runtime tree.
            # Pin hashes describe source; runtime manifest also identifies the executed build.
            manifest={str(p.relative_to(runtime)):({'link':str(p.readlink())} if p.is_symlink() else {'sha256':digest(p)}) for p in runtime.rglob('*') if p.is_file() or p.is_symlink()}
            (args.output/'runtime-manifest.json').write_text(json.dumps(manifest,sort_keys=True)+'\n')
            report['runtimeManifestSha256']=digest(args.output/'runtime-manifest.json')
            command=namespace_command([(runtime,'/runtime'),(node,'/node'),(browser.parent,'/browser')],
                    ['/node','/runtime/hub/scripts/performance/standalone-worker.mjs',*(['--smoke'] if args.smoke else [])])
            report['execution']=supervise(command,timeout=540)
            report['qualified']=bool(not args.smoke and report['execution']['cleanup'] and not report['execution']['error'] and report['execution']['result'] and report['execution']['result'].get('evaluation',{}).get('qualified'))
    except Exception as error:
        report['failures'].append(type(error).__name__+':'+str(error)[:300])
    report['host']['loadAfter']=os.getloadavg()
    report['finishedAt']=datetime.now(timezone.utc).isoformat()
    (args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'report':str(args.output/'report.json'),'qualified':report['qualified'],'failures':report['failures'],
                    'executionError':report.get('execution',{}).get('error'),
                    'problems':(report.get('execution',{}).get('result') or {}).get('evaluation',{}).get('problems')}))
    return 0 if report['qualified'] else 1


if __name__=='__main__':
    raise SystemExit(main())
