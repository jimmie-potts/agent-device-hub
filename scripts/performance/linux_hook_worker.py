"""Namespace PID 1: real hook timing, isolated state, and descendant reaping."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import errno
import json
import math
import os
from pathlib import Path
import resource
import selectors
import socket
import sqlite3
import subprocess
import sys
import threading
import time

STATE = Path('/state')
SOURCE = Path('/source/bridge.py')

def summarize(values):
    values = sorted(values)
    return {'n': len(values), 'p95Ns': values[math.ceil(.95*len(values))-1],
            'p99Ns': values[math.ceil(.99*len(values))-1], 'maxNs': values[-1]}

def confinement():
    if os.getpid() != 1:
        raise RuntimeError('pid-namespace-required')
    private_absent = all(not Path(p).exists() for p in ('/home','/mnt','/run','/root'))
    with socket.socket() as probe:
        probe.settimeout(.1)
        denied = probe.connect_ex(('192.0.2.1', 9)) == errno.ENETUNREACH
    readonly = False
    try:
        with SOURCE.open('ab'):
            pass
    except OSError as error:
        readonly = error.errno == errno.EROFS
    if not (private_absent and denied and readonly):
        raise RuntimeError('confinement-failed')
    return {'privatePathsAbsent': private_absent, 'externalNetworkDenied': denied,
            'sourceReadOnly': readonly, 'pidNamespaceInit': True}

def invoke(event, state=STATE, barrier=None, timeout=10, env=None):
    if barrier:
        barrier.wait(timeout=10)
    started = time.perf_counter_ns()
    with subprocess.Popen([sys.executable, '-B', str(SOURCE), 'hook', '--state-dir', str(state)],
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env) as child:
        child.stdin.write(event)
        child.stdin.close()
        buffers = {'out': bytearray(), 'err': bytearray()}
        reason = None
        deadline = time.monotonic()+timeout
        with selectors.DefaultSelector() as selector:
            selector.register(child.stdout, selectors.EVENT_READ, 'out')
            selector.register(child.stderr, selectors.EVENT_READ, 'err')
            while selector.get_map():
                if time.monotonic() >= deadline:
                    reason = 'timeout'
                    child.kill()
                    break
                for key, _ in selector.select(min(.1, max(0, deadline-time.monotonic()))):
                    data = os.read(key.fd, 4096)
                    if not data:
                        selector.unregister(key.fileobj)
                    elif len(buffers[key.data])+len(data) > 8192:
                        reason = 'output-limit'
                        child.kill()
                        break
                    else:
                        buffers[key.data].extend(data)
                if reason:
                    break
            try:
                child.wait(timeout=max(.01, deadline-time.monotonic()))
            except subprocess.TimeoutExpired:
                reason = 'timeout'
                child.kill()
                child.wait()
        result = {'durationNs': time.perf_counter_ns()-started, 'exitCode': child.returncode,
                  'expectedOutput': buffers['out'] == b'{}\n', 'hadStderr': bool(buffers['err']),
                  'timedOut': reason == 'timeout', 'outputLimit': reason == 'output-limit'}
    return result

def reap(deadline=10):
    started = time.perf_counter_ns()
    ends = time.monotonic()+deadline
    exits=[]
    while True:
        try:
            pid,status,_ = os.wait4(-1,os.WNOHANG)
        except ChildProcessError:
            return exits,time.perf_counter_ns()-started
        if pid:
            exits.append(os.waitstatus_to_exitcode(status))
        elif time.monotonic()>ends:
            raise RuntimeError('descendant-cleanup-timeout')
        else:
            time.sleep(.001)

def event(session, turn):
    return json.dumps({'hook_event_name':'UserPromptSubmit','session_id':f'synthetic-{session}',
                       'turn_id':f'turn-{turn}'}).encode()


def handoff_preflight():
    """Untimed Python audit confirms the real child command and lock connection.

    The pin is unchanged. Only this probe loads sitecustomize; timed invocations
    have no PYTHONPATH or instrumentation. Export only allowlisted booleans.
    """
    audit = STATE/'audit'
    audit.mkdir()
    (audit/'sitecustomize.py').write_text("""import os, sys
fd = os.open('/state/audit/events', os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
def note(value):
    os.write(fd, value.encode()+b'\\n')
role = 'worker' if sys.argv[1:] == ['worker', '--state-dir', '/state'] else 'hook'
note(role+'-started')
def observe(name, args):
    if name == 'sqlite3.connect':
        path = str(args[0])
        note(role+'-lock' if path == '/state/notification-lock.sqlite' else role+'-state' if path == '/state/status.sqlite' else 'unexpected-database')
    elif name == 'subprocess.Popen':
        note('real-worker-command' if args[1] == [sys.executable, '/source/bridge.py', 'worker', '--state-dir', '/state'] else 'unexpected-command')
    elif name == 'import' and args[0] == 'controller_state':
        note('unexpected-controller')
sys.addaudithook(observe)
""")
    measured = invoke(event(0,'preflight'), env={'PATH':'/usr/bin','PYTHONPATH':str(audit)})
    exits, _ = reap()
    events = (audit/'events').read_text().splitlines()
    expected = ['hook-started','hook-state','real-worker-command','worker-started','worker-lock']
    passed = (events == expected and exits == [0] and measured['exitCode'] == 0
              and measured['expectedOutput'] and not measured['hadStderr']
              and not measured['timedOut'] and not measured['outputLimit'])
    # All descendants have exited. Remove the probe database so firstCall still
    # starts from new state; the held owner lock remains intentionally present.
    for name in ('status.sqlite','status.sqlite-wal','status.sqlite-shm'):
        (STATE/name).unlink(missing_ok=True)
    return {'passed':passed, 'realWorkerCommand':events.count('real-worker-command') == 1,
            'workerConnectedOwnerLock':events.count('worker-lock') == 1,
            'controllerNotImported':'unexpected-controller' not in events,
            'untimed':True, 'workerExits':exits}

def profile(tasks,bursts,failures=False):
    guard=sqlite3.connect(STATE/'notification-lock.sqlite',timeout=0)
    guard.execute('BEGIN EXCLUSIVE')
    # Actual spawned upstream workers contend on the existing owner lock and exit
    # before configuration/transport. No launch callback or executable is replaced.
    proof=handoff_preflight()
    checkpoint({'handoffPreflight':proof})
    if not proof['passed']:
        raise RuntimeError('handoff-preflight-failed')
    window_start=time.perf_counter_ns()
    before=resource.getrusage(resource.RUSAGE_CHILDREN)
    cold=invoke(event(0,'first'))
    checkpoint({'firstCall':cold})
    cold_workers,cold_cleanup=reap()
    durations=[]; makespans=[]; cleanups=[]; raw=[]; exits=list(cold_workers)
    started=time.perf_counter_ns()
    with ThreadPoolExecutor(max_workers=tasks) as pool:
        for burst in range(bursts):
            barrier=threading.Barrier(tasks)
            start=time.perf_counter_ns()
            futures=[pool.submit(invoke,event(n,burst),barrier=barrier) for n in range(tasks)]
            results=[f.result() for f in futures]
            makespans.append(time.perf_counter_ns()-start)
            raw.extend(results);durations.extend(r['durationNs'] for r in results)
            checkpoint({'burst':burst,'raw':results,'makespanNs':makespans[-1]})
            children,cleanup=reap();exits.extend(children);cleanups.append(cleanup)
    with sqlite3.connect(STATE/'status.sqlite') as db:
        rows=db.execute('SELECT id,turn,status FROM sessions ORDER BY id').fetchall()
    expected=sorted((f'synthetic-{n}',f'turn-{bursts-1}','working') for n in range(tasks))
    valid=lambda r:r['exitCode']==0 and r['expectedOutput'] and not r['hadStderr'] and not r['timedOut'] and not r['outputLimit']
    after=resource.getrusage(resource.RUSAGE_CHILDREN)
    good=valid(cold) and all(map(valid,raw)) and rows==expected and len(exits)==tasks*bursts+1 and all(x==0 for x in exits)
    result={'status':'passed' if good else 'failed','tasks':tasks,'bursts':bursts,'samples':len(raw),
            'handoffPreflight':proof,'firstCall':cold,'firstCleanupNs':cold_cleanup,'raw':raw,'summary':summarize(durations),
            'burstMakespanNs':makespans,'cleanupNs':cleanups,'workerExitCount':len(exits),
            'workerNonzeroExits':sum(x!=0 for x in exits),'remainingChildren':0,
            'stateVerified':rows==expected,'profileWallNs':time.perf_counter_ns()-started,
            'resourceWindowWallNs':time.perf_counter_ns()-window_start,
            'childrenCpuSeconds':(after.ru_utime+after.ru_stime)-(before.ru_utime+before.ru_stime),
            'childrenMaxRssBytes':after.ru_maxrss*1024,
            'resourceBoundary':'reaped hook and worker processes; peak RSS is largest child, not combined memory'}
    if failures:
        bad=invoke(b'not-json')
        missing=invoke(event(0,'missing'),Path('/unavailable'))
        with sqlite3.connect(STATE/'status.sqlite') as db:
            db.execute('BEGIN EXCLUSIVE')
            contention=invoke(event(0,'locked'))
        failure_children,_=reap()
        result['failureCases']={'malformedInput':bad,'unavailableState':missing,'databaseContention':contention,
                                'unexpectedWorkers':len(failure_children)}
        if failure_children or any(r['exitCode']!=0 or not r['expectedOutput'] or not r['hadStderr'] or r['timedOut'] for r in (bad,missing,contention)):
            result['status']='failed'
    guard.rollback();guard.close()
    return result

def cleanup_probe(crash=False):
    # A detached subprocess with no upstream code proves namespace lifetime and
    # PID-1 reaping even when process groups differ. Its only side effect is sleep.
    child=subprocess.Popen([sys.executable,'-I','-c','import time; time.sleep(60)'],start_new_session=True)
    if crash:
        os._exit(23)
    os.kill(child.pid,9)
    exits,_=reap()
    return {'detachedReaped':len(exits)==1 and exits[0]==-9,'remainingChildren':0}

def checkpoint(record):
    print(json.dumps(record,separators=(',',':')),flush=True)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--tasks',type=int,default=1);parser.add_argument('--bursts',type=int,default=1)
    parser.add_argument('--failures',action='store_true');parser.add_argument('--probe',choices=['cleanup','crash','timeout','output','partial-crash'])
    args=parser.parse_args(); checks=confinement()
    if args.probe=='output':
        while True:
            os.write(1,b'x'*4096)
    if args.probe=='partial-crash':
        checkpoint({'firstCall':invoke(event(0,'partial'))})
        os._exit(23)
    if args.probe=='timeout':
        subprocess.Popen([sys.executable,'-I','-c','import time; time.sleep(60)'],start_new_session=True)
        time.sleep(60)
    result=cleanup_probe(args.probe=='crash') if args.probe else profile(args.tasks,args.bursts,args.failures)
    result['confinement']=checks
    checkpoint({'result':result})
    return 0 if result.get('status','passed')=='passed' else 1

if __name__=='__main__':
    try:
        raise SystemExit(main())
    except Exception:
        checkpoint({'failure':'isolated-profile-failed'})
        raise SystemExit(1)
