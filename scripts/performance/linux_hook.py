"""Pinned Linux hook measurements in an isolated PID/network/mount namespace."""
from pathlib import Path
import hashlib

REVISION = '2558df5a2fc543247b0c75898ef0260ba3ea264b'
VENDOR = Path(__file__).resolve().parent / 'vendor/nanoleaf-linux'
SOURCE_HASHES = {'bridge.py': 'e056d0a43d75fb41dbe0e4780c904aea5d3d05b61ee64ec220313564f13981f3', 'project_map.py': 'df925871dffc55e727bfbbc211354ea84589a48f56552af820691913565e7d76'}

def verify_source(directory=VENDOR):
    directory = Path(directory)
    if directory.is_symlink() or {p.name for p in directory.iterdir()} != set(SOURCE_HASHES):
        raise ValueError('unexpected-source-entry')
    for name, expected in SOURCE_HASHES.items():
        path = directory / name
        if path.is_symlink() or not path.is_file():
            raise ValueError('invalid-source-entry')
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError('source-hash-mismatch')
    return directory.resolve()

import argparse
from datetime import datetime, timezone
import json
import os
import platform
import resource
import selectors
import shutil
import subprocess
import sys
import tempfile
import time

WORKER = Path(__file__).with_name('linux_hook_worker.py')
MAX_OUTPUT = 8_000_000

def command(source, tasks, bursts, failures=False, probe=None):
    python = Path(sys.executable).resolve()
    if sys.platform != 'linux' or not str(python).startswith('/usr/'):
        raise ValueError('requires-linux-python-under-usr')
    bubblewrap=shutil.which('bwrap')
    if not bubblewrap:
        raise ValueError('bubblewrap-unavailable')
    args=[bubblewrap,'--unshare-all','--as-pid-1','--die-with-parent','--new-session',
          '--ro-bind','/usr','/usr','--symlink','usr/bin','/bin','--symlink','usr/lib','/lib',
          '--symlink','usr/lib64','/lib64','--proc','/proc','--dev','/dev','--tmpfs','/tmp',
          '--size','67108864','--tmpfs','/state','--ro-bind',str(source),'/source','--ro-bind',str(WORKER),'/measure.py',
          '--clearenv','--setenv','PATH','/usr/bin','--chdir','/state',str(python),'-I','-B','/measure.py',
          '--tasks',str(tasks),'--bursts',str(bursts)]
    if failures:args.append('--failures')
    if probe:args.extend(['--probe',probe])
    return args

def run_profile(tasks=1,bursts=1,timeout=120,failures=False,probe=None):
    if type(tasks) is not int or tasks not in (1,10,50) or type(bursts) is not int or not 1<=bursts<=1000 or tasks*bursts>5000:
        raise ValueError('invalid-profile')
    if not isinstance(timeout,(int,float)) or not 0<timeout<=600:
        raise ValueError('invalid-timeout')
    source=verify_source()
    # Copy verified bytes to a fresh owned directory to avoid mutable source
    # changing between validation and namespace launch.
    with tempfile.TemporaryDirectory(prefix='linux-hook-source-') as temp:
        pinned=Path(temp)
        for name in SOURCE_HASHES:shutil.copyfile(source/name,pinned/name)
        verify_source(pinned)
        args=command(pinned,tasks,bursts,failures,probe)
        started=time.perf_counter_ns()
        # Pipes are drained with fixed caps while the namespace is running.
        # Only the namespace init PID supplied by our own bwrap is inspected.
        read_info, write_info = os.pipe()
        args[1:1] = ['--info-fd', str(write_info)]
        streams = {}
        reason = None
        def limits():
            resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT, MAX_OUTPUT))
            resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        with subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              pass_fds=(write_info,), preexec_fn=limits) as child:
            os.close(write_info)
            with os.fdopen(read_info, 'rb', buffering=0) as info, selectors.DefaultSelector() as selector:
                for name, pipe, cap in [('out', child.stdout, MAX_OUTPUT), ('err', child.stderr, 65536), ('info', info, 4096)]:
                    streams[name] = bytearray()
                    selector.register(pipe, selectors.EVENT_READ, (name, cap))
                deadline = time.monotonic() + timeout
                while selector.get_map():
                    if time.monotonic() >= deadline:
                        reason = 'namespace-timeout'
                        child.kill()
                        break
                    for key, _ in selector.select(min(.1, max(0, deadline-time.monotonic()))):
                        name, cap = key.data
                        data = os.read(key.fd, min(4096, cap-len(streams[name])+1))
                        if not data:
                            selector.unregister(key.fileobj)
                        elif len(streams[name])+len(data) > cap:
                            reason = 'output-limit'
                            child.kill()
                            break
                        else:
                            streams[name].extend(data)
                    if reason:
                        break
                try:
                    child.wait(timeout=max(.01, deadline-time.monotonic()))
                except subprocess.TimeoutExpired:
                    reason = 'namespace-timeout'
                    child.kill()
                    child.wait()
        code = child.returncode
        try:
            namespace_info = json.loads(streams['info'])
            init_pid = namespace_info['child-pid']
            if type(init_pid) is not int or init_pid <= 0:
                raise ValueError('invalid-pid')
            # bwrap waited for namespace PID 1. The kernel terminates every
            # namespace member when PID 1 exits, including detached sessions.
            # Check only that exact owned PID; never enumerate host processes.
            gone = owned_init_exited(init_pid)
        except (ValueError, KeyError):
            gone = False
        records = []
        for line in streams['out'].splitlines():
            try:
                record = json.loads(line)
                if isinstance(record, dict):
                    records.append(record)
            except ValueError:
                pass  # A truncated last record remains a failed repetition.
        result = records[-1].get('result') if records and 'result' in records[-1] else None
        if not isinstance(result, dict):
            result = {'status': 'failed', 'error': 'namespace-failed', 'partialRecords': records}
        if reason or code != 0 or not gone:
            result['status'] = 'failed'
            result['error'] = reason or ('namespace-unverified' if not gone else 'namespace-failed')
        result.update(namespaceRoundtripNs=time.perf_counter_ns()-started,
                      namespaceExitCode=code, namespaceGone=gone, tasks=tasks,
                      outputBounded=True, cleanupEvidence='bwrap waited for namespace PID 1; owned init exited')
        return result

def owned_init_exited(pid):
    deadline = time.monotonic()+5
    while time.monotonic() < deadline:
        try:
            stat = Path(f'/proc/{pid}/stat').read_text()
        except FileNotFoundError:
            return True
        # A dead namespace init can remain as a zombie until its outer reaper
        # runs. Kernel namespace teardown has already killed every member.
        if stat.rsplit(')', 1)[1].split()[0] in ('Z', 'X'):
            return True
        time.sleep(.01)
    return False

def pooled(profiles, expected_repeats=3, expected_samples=1000):
    import math
    def summarize(values):
        values = sorted(values)
        return {'n': len(values), 'p95Ns': values[math.ceil(.95*len(values))-1],
                'p99Ns': values[math.ceil(.99*len(values))-1], 'maxNs': values[-1]}
    summaries = {}
    for tasks in (1, 10, 50):
        repeats = [p for p in profiles if p.get('tasks') == tasks]
        values = [r['durationNs'] for p in repeats for r in p.get('raw', [])]
        complete = (len(repeats) == expected_repeats and expected_repeats >= 3 and expected_samples >= 1000
                    and all(p.get('status') == 'passed' and p.get('samples') == expected_samples for p in repeats))
        summaries[str(tasks)] = {'support': 'qualified' if complete else 'provisional',
                                 'repeats': len(repeats), 'summary': summarize(values) if values else None}
    return summaries

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--samples-per-repeat',type=int,default=1000);parser.add_argument('--repeats',type=int,default=3)
    args=parser.parse_args()
    if not 50<=args.samples_per_repeat<=1000 or args.samples_per_repeat%50 or not 1<=args.repeats<=3:
        parser.error('samples must be 50..1000 in multiples of 50; repeats 1..3')
    args.output.mkdir(parents=False,exist_ok=False)
    receipt={'schemaVersion':1,'createdAt':datetime.now(timezone.utc).isoformat(),'sourceRevision':REVISION,
             'sourceHashes':SOURCE_HASHES,'toolHashes':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (Path(__file__),WORKER)},
             'runtime':{'python':platform.python_version(),'kernel':platform.release(),'cpuCount':os.cpu_count(),
                        'pythonSha256':hashlib.sha256(Path(sys.executable).resolve().read_bytes()).hexdigest(),
                        'bubblewrapSha256':hashlib.sha256(Path(shutil.which('bwrap')).read_bytes()).hexdigest()},
             'mounts':{'readOnly':['/usr','/source','/measure.py'],'disposable':['/state','/tmp'],'isolated':['pid','net','mount','ipc','uts','user','cgroup']},
             'boundary':'Linux hook spawn-through-return; actual worker spawn, preheld owner lock; no rendering',
             'excluded':['installed-client','worker-rendering','private-metadata','shared-feed','device-transport','optical'],
             'definitions': {
                 'firstCall': 'fresh namespace and new database; OS caches are not controlled',
                 'warm': 'fresh hook process against existing synthetic state on each call',
                 'timing': 'parent monotonic launch through hook exit; worker completion excluded',
                 'cpuWindow': 'all reaped hooks and workers, first call plus warm samples; excludes failure probes',
                 'rss': 'largest child peak resident bytes in the same window, not combined memory',
                 'sampling': 'nearest rank; 1000 warm samples per repetition, three repetitions per profile; pooled 3000',
                 'readiness': 'worker observes a preheld owner lock and exits; no rendering readiness measured'},
             'profiles':[]}
    for tasks in (1,10,50):
        for repeat in range(args.repeats):
            load=os.getloadavg()
            result=run_profile(tasks,args.samples_per_repeat//tasks,timeout=600,failures=repeat==0)
            result.update({'repeat':repeat+1,'loadBefore':load,'loadAfter':os.getloadavg()})
            receipt['profiles'].append(result)
            receipt['pooled'] = pooled(receipt['profiles'], args.repeats, args.samples_per_repeat)
            pending=args.output/'receipt.json.tmp'
            pending.write_text(json.dumps(receipt,indent=2,allow_nan=False)+'\n')
            pending.replace(args.output/'receipt.json')
            print(json.dumps({'tasks':tasks,'repeat':repeat+1,'status':result['status'],'summary':result.get('summary')}),flush=True)
            if result['status']!='passed':return 1
    return 0

def cli():
    try:
        return main()
    except Exception:
        print(json.dumps({'status':'failed','error':'linux-qualification-failed'}),flush=True)
        return 1

if __name__=='__main__':
    raise SystemExit(cli())
