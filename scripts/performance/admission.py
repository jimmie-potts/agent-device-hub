"""Pinned legacy admission measurements, without hooks or device workers."""
import math
import statistics


def summary_ns(values):
    if not values or any(type(value) is not int or value < 0 for value in values):
        raise ValueError('invalid-samples')
    ordered = sorted(values)
    return {
        'n': len(ordered), 'minNs': ordered[0], 'medianNs': statistics.median(ordered),
        'p95Ns': ordered[math.ceil(.95 * len(ordered)) - 1],
        'p99Ns': ordered[math.ceil(.99 * len(ordered)) - 1], 'maxNs': ordered[-1],
        'p99SampleSupport': 'provisional' if len(ordered) < 1000 else 'recorded',
    }

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time

TASKS = (1, 10, 50)
MAX_SAMPLES = 50_000
MAX_OUTPUT_BYTES = 2_000_000
BOUNDARY = 'nanoleaf-admission-worker-launch-excluded'
REVISION = 'ea3b95661352f927aceaf92b62d74660978c201f'
SOURCE_HASHES = {
    'bridge.py': 'f12a484aeac930791790c7d625058c66e299d334bf064751ec39bfcea1fcef8a',
    'project_map.py': 'f1e88f423eaf9662612165375d14f9fa95b17b75e7c42db1222183733a9da6bc',
}
VENDOR = Path(__file__).resolve().parent / 'vendor/nanoleaf'
EXCLUDED = ['installed-client', 'hook-return', 'worker-launch', 'windows-wsl-helper',
            'lifecycle-validator', 'shared-feed', 'consumer-delivery', 'device-transport', 'optical']


def integer(value, low=0, high=None):
    return type(value) is int and value >= low and (high is None or value <= high)


def verify_source(directory):
    directory = Path(directory).resolve(strict=True)
    if {entry.name for entry in directory.iterdir()} != set(SOURCE_HASHES):
        raise ValueError('unexpected-source-entry')
    for name, expected in SOURCE_HASHES.items():
        path = directory / name
        if path.is_symlink() or not path.is_file():
            raise ValueError('invalid-source-entry')
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError('source-hash-mismatch')
    return directory


def install_guard(state):
    """Restrict this verified call graph; not a general OS sandbox."""
    state = state.resolve()
    forbidden = {'socket.__new__', 'socket.connect', 'socket.bind', 'socket.sendto',
                 'socket.getaddrinfo', 'subprocess.Popen', 'os.system', 'os.posix_spawn',
                 'os.fork', 'os.forkpty', 'os.exec', 'os.spawn'}
    def audit(event, arguments):
        if event in forbidden:
            raise RuntimeError('forbidden-measurement-operation')
        if event == 'sqlite3.connect':
            database = arguments[0]
            if not isinstance(database, (str, bytes, os.PathLike)):
                raise RuntimeError('invalid-measurement-database')
            if Path(os.fsdecode(database)).resolve().parent != state:
                raise RuntimeError('database-outside-measurement-state')
    sys.addaudithook(audit)


def runtime():
    return dict(implementation=platform.python_implementation(), python=platform.python_version(),
                sqlite=sqlite3.sqlite_version, system=platform.system(), release=platform.release(),
                machine=platform.machine(), logicalCpuCount=os.cpu_count())


def load_snapshot():
    try:
        return {'status': 'available', 'oneFiveFifteenMinutes': list(os.getloadavg())}
    except (AttributeError, OSError):
        return {'status': 'unsupported', 'oneFiveFifteenMinutes': None}


def peak_rss():
    # Lifetime process peak, including tooling, not host or device-worker memory.
    try:
        if sys.platform in ('linux', 'darwin'):
            import resource
            value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
            return {'status': 'available', 'bytes': int(value * (1 if sys.platform == 'darwin' else 1024)),
                    'method': 'getrusage-process-lifetime-peak'}
        if os.name == 'nt':
            import ctypes
            from ctypes import wintypes
            class Counters(ctypes.Structure):
                _fields_ = [('cb', wintypes.DWORD), ('PageFaultCount', wintypes.DWORD)] + [
                    (name, ctypes.c_size_t) for name in ('PeakWorkingSetSize', 'WorkingSetSize',
                    'QuotaPeakPagedPoolUsage', 'QuotaPagedPoolUsage', 'QuotaPeakNonPagedPoolUsage',
                    'QuotaNonPagedPoolUsage', 'PagefileUsage', 'PeakPagefileUsage')]
            process = ctypes.windll.kernel32.GetCurrentProcess
            process.argtypes, process.restype = [], wintypes.HANDLE
            read = ctypes.windll.psapi.GetProcessMemoryInfo
            read.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
            read.restype = wintypes.BOOL
            value = Counters()
            value.cb = ctypes.sizeof(value)
            if read(process(), ctypes.byref(value), value.cb):
                return {'status': 'available', 'bytes': int(value.PeakWorkingSetSize),
                        'method': 'windows-process-lifetime-peak-working-set'}
    except (ImportError, AttributeError, OSError, ValueError):
        pass
    return {'status': 'unsupported', 'bytes': None, 'method': None}


def profile(tasks, bursts, warmups):
    if tasks not in TASKS or not integer(bursts, 1, 1000) or not integer(warmups, 0, 100):
        raise ValueError('invalid-profile-size')
    if (tasks + 1) * bursts + 1 > MAX_SAMPLES:
        raise ValueError('sample-limit-exceeded')
    source = verify_source(VENDOR)
    with tempfile.TemporaryDirectory(prefix='hub-admission-') as temporary:
        state = Path(temporary).resolve()
        install_guard(state)
        sys.dont_write_bytecode = True
        sys.path.insert(0, str(source))
        spec = importlib.util.spec_from_file_location('measured_bridge', source / 'bridge.py')
        bridge = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(bridge)
        if Path(bridge.wall.__file__).resolve() != source / 'project_map.py':
            raise RuntimeError('unexpected-project-map')

        def operation(task, turn, barrier=None):
            event = {'hook_event_name': 'UserPromptSubmit', 'session_id': f'synthetic-session-{task}',
                     'turn_id': f'synthetic-turn-{turn}'}
            callback = []
            if barrier is not None:
                barrier.wait(timeout=30)
            started = time.perf_counter_ns()
            bridge.handle_event(state, event, launch=lambda directory: callback.append(directory.resolve() == state))
            duration = time.perf_counter_ns() - started
            if callback != [True]:
                raise RuntimeError('unexpected-launch-boundary')
            return duration

        before_load, before_rss = load_snapshot(), peak_rss()
        cold = operation(0, 'cold')
        operations, makespans = [], []
        cpu_start, wall_start = time.process_time_ns(), time.perf_counter_ns()
        with ThreadPoolExecutor(max_workers=tasks) as executor:
            for burst in range(warmups + bursts):
                barrier = threading.Barrier(tasks)
                started = time.perf_counter_ns()
                futures = [executor.submit(operation, task, burst, barrier) for task in range(tasks)]
                durations = [future.result() for future in futures]
                elapsed = time.perf_counter_ns() - started
                if burst >= warmups:
                    operations.extend(durations)
                    makespans.append(elapsed)
        wall, cpu = time.perf_counter_ns() - wall_start, time.process_time_ns() - cpu_start
        with sqlite3.connect(state / 'status.sqlite') as database:
            rows = database.execute('SELECT id, turn, status FROM sessions ORDER BY id').fetchall()
        expected = sorted((f'synthetic-session-{task}', f'synthetic-turn-{warmups + bursts - 1}', 'working') for task in range(tasks))
        if rows != expected:
            raise RuntimeError('admission-result-mismatch')
        return dict(format=1, status='complete', boundary=BOUNDARY, tasks=tasks, bursts=bursts,
                    warmupBurstsExcluded=warmups, sourceRevision=REVISION, sourceHashes=SOURCE_HASHES,
                    runtime=runtime(), clock='python-perf-counter-ns-one-process',
                    coldDatabaseFirstOperationNs=cold, operationNs=operations, burstMakespanNs=makespans,
                    cpuIncludingWarmupNs=cpu, wallIncludingWarmupNs=wall,
                    loadBefore=before_load, loadAfter=load_snapshot(), peakRssBefore=before_rss,
                    peakRssAfter=peak_rss(), excluded=EXCLUDED)


def validate_worker(value, tasks, bursts, warmups):
    fixed = dict(format=1, status='complete', boundary=BOUNDARY, tasks=tasks, bursts=bursts,
                 warmupBurstsExcluded=warmups, sourceRevision=REVISION, sourceHashes=SOURCE_HASHES,
                 clock='python-perf-counter-ns-one-process', excluded=EXCLUDED)
    extra = {'runtime', 'coldDatabaseFirstOperationNs', 'operationNs', 'burstMakespanNs',
             'cpuIncludingWarmupNs', 'wallIncludingWarmupNs', 'loadBefore', 'loadAfter', 'peakRssBefore', 'peakRssAfter'}
    if not isinstance(value, dict) or set(value) != set(fixed) | extra:
        return False
    if any(value[key] != expected for key, expected in fixed.items()):
        return False
    for key in ('format', 'tasks', 'bursts', 'warmupBurstsExcluded', 'coldDatabaseFirstOperationNs',
                'cpuIncludingWarmupNs', 'wallIncludingWarmupNs'):
        if not integer(value[key]):
            return False
    for key, length in [('operationNs', tasks * bursts), ('burstMakespanNs', bursts)]:
        if not isinstance(value[key], list) or len(value[key]) != length or any(not integer(n) for n in value[key]):
            return False
    details = value['runtime']
    keys = {'implementation', 'python', 'sqlite', 'system', 'release', 'machine', 'logicalCpuCount'}
    if not isinstance(details, dict) or set(details) != keys:
        return False
    for key in keys - {'logicalCpuCount'}:
        if not isinstance(details[key], str) or len(details[key]) > 160 or any(ord(c) < 32 for c in details[key]):
            return False
    if details['logicalCpuCount'] is not None and not integer(details['logicalCpuCount'], 1):
        return False
    for key in ('loadBefore', 'loadAfter'):
        load = value[key]
        if not isinstance(load, dict) or set(load) != {'status', 'oneFiveFifteenMinutes'}:
            return False
        numbers = load['oneFiveFifteenMinutes']
        if load['status'] == 'unsupported':
            if numbers is not None:
                return False
        elif load['status'] != 'available' or not isinstance(numbers, list) or len(numbers) != 3 or any(
                type(n) not in (int, float) or not math.isfinite(n) or n < 0 for n in numbers):
            return False
    for key in ('peakRssBefore', 'peakRssAfter'):
        rss = value[key]
        if not isinstance(rss, dict) or set(rss) != {'status', 'bytes', 'method'}:
            return False
        if rss['status'] == 'unsupported':
            if rss['bytes'] is not None or rss['method'] is not None:
                return False
        elif rss['status'] != 'available' or not integer(rss['bytes']) or rss['method'] not in (
                'getrusage-process-lifetime-peak', 'windows-process-lifetime-peak-working-set'):
            return False
    return True


def run_worker(command, tasks, bursts, warmups, timeout_seconds):
    if type(timeout_seconds) not in (int, float) or not math.isfinite(timeout_seconds) or not 0 < timeout_seconds <= 600:
        raise ValueError('invalid-worker-timeout')
    started = time.perf_counter_ns()
    try:
        child = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except OSError:
        return dict(status='worker-start-failed', parentRoundtripNs=time.perf_counter_ns() - started)
    buffers = [bytearray(), bytearray()]
    lock, overflow = threading.Lock(), threading.Event()
    def collect(stream, target):
        with stream:
            while chunk := stream.read(4096):
                with lock:
                    if sum(map(len, buffers)) + len(chunk) > MAX_OUTPUT_BYTES:
                        overflow.set()
                        child.kill()
                        return
                    buffers[target].extend(chunk)
    readers = [threading.Thread(target=collect, args=(stream, index)) for index, stream in enumerate((child.stdout, child.stderr))]
    for reader in readers:
        reader.start()
    timed_out = False
    try:
        child.wait(timeout=timeout_seconds)
    except subprocess.TimeoutExpired:
        timed_out = True
        child.kill()
        child.wait()
    for reader in readers:
        reader.join()
    elapsed = time.perf_counter_ns() - started
    if timed_out:
        return dict(status='timeout', parentRoundtripNs=elapsed, harnessTimeoutSeconds=timeout_seconds)
    if overflow.is_set():
        return dict(status='invalid-worker-output', parentRoundtripNs=elapsed)
    if child.returncode or buffers[1]:
        return dict(status='worker-failed', parentRoundtripNs=elapsed, exitCode=child.returncode, stderrPresent=bool(buffers[1]))
    try:
        value = json.loads(buffers[0])
    except (ValueError, UnicodeError):
        return dict(status='invalid-worker-output', parentRoundtripNs=elapsed)
    if not validate_worker(value, tasks, bursts, warmups):
        return dict(status='invalid-worker-output', parentRoundtripNs=elapsed)
    return dict(status='complete', parentRoundtripNs=elapsed, worker=value,
                operationSummary=summary_ns(value['operationNs']), burstMakespanSummary=summary_ns(value['burstMakespanNs']))


def write_receipt(directory, receipt):
    temporary = directory / 'receipt.json.tmp'
    temporary.write_text(json.dumps(receipt, indent=2, allow_nan=False) + '\n', encoding='utf8')
    temporary.replace(directory / 'receipt.json')


def parent(args):
    if not args.output or not integer(args.repeats, 1, 5) or not integer(args.bursts, 1, 1000) or not integer(args.warmup_bursts, 0, 100):
        raise ValueError('invalid-run-configuration')
    if not math.isfinite(args.worker_timeout) or not 0 < args.worker_timeout <= 600:
        raise ValueError('invalid-worker-timeout')
    count = args.repeats * sum((tasks + 1) * args.bursts + 1 for tasks in TASKS)
    if count > MAX_SAMPLES:
        raise ValueError('sample-limit-exceeded')
    verify_source(VENDOR)
    output = Path(args.output)
    output.mkdir(parents=False, exist_ok=False)
    receipt = dict(format=1, status='running', createdAt=datetime.now(timezone.utc).isoformat(),
                   boundary=BOUNDARY, toolSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                   sourceRevision=REVISION, sourceHashes=SOURCE_HASHES, parentRuntime=runtime(),
                   configuration=dict(tasks=list(TASKS), repeats=args.repeats, bursts=args.bursts,
                                      warmupBursts=args.warmup_bursts, maximumRawTimingSamples=MAX_SAMPLES,
                                      plannedRawTimingSamples=count, harnessWorkerTimeoutSeconds=args.worker_timeout),
                   clockPolicy='One-process monotonic durations. Parent roundtrip includes spawn/import/all work/exit; never subtract clocks across processes.',
                   loadPolicy='Ambient load observed, not controlled. Fresh processes do not establish cold OS caches.',
                   budgetStatus='not-frozen', requiredPending=EXCLUDED, profiles=[])
    write_receipt(output, receipt)
    for repeat in range(1, args.repeats + 1):
        for tasks in TASKS:
            command = [sys.executable, '-B', str(Path(__file__).resolve()), '--worker', '--task', str(tasks),
                       '--bursts', str(args.bursts), '--warmup-bursts', str(args.warmup_bursts)]
            result = run_worker(command, tasks, args.bursts, args.warmup_bursts, args.worker_timeout)
            receipt['profiles'].append(dict(repeat=repeat, tasks=tasks, result=result))
            write_receipt(output, receipt)
    receipt['pooledProfiles'] = []
    for tasks in TASKS:
        results = [item['result'] for item in receipt['profiles'] if item['tasks'] == tasks]
        pooled = dict(tasks=tasks, status='incomplete', reason='one-or-more-repeats-failed')
        if all(result['status'] == 'complete' for result in results):
            pooled = dict(tasks=tasks, status='complete',
                          operationSummary=summary_ns([n for result in results for n in result['worker']['operationNs']]),
                          burstMakespanSummary=summary_ns([n for result in results for n in result['worker']['burstMakespanNs']]))
        receipt['pooledProfiles'].append(pooled)
    complete = all(item['result']['status'] == 'complete' for item in receipt['profiles'])
    receipt.update(status='complete' if complete else 'incomplete', finishedAt=datetime.now(timezone.utc).isoformat())
    write_receipt(output, receipt)
    print(json.dumps(dict(status=receipt['status'], profiles=len(receipt['profiles']), budgetStatus='not-frozen')))
    return 0 if complete else 1


def main():
    parser = argparse.ArgumentParser(description='Measure isolated source admission; no hooks, clients or device workers.')
    parser.add_argument('--output')
    parser.add_argument('--bursts', type=int, default=100)
    parser.add_argument('--warmup-bursts', type=int, default=3)
    parser.add_argument('--repeats', type=int, default=3)
    parser.add_argument('--worker-timeout', type=float, default=120)
    parser.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--task', type=int, default=1, help=argparse.SUPPRESS)
    args = parser.parse_args()
    try:
        if args.worker:
            print(json.dumps(profile(args.task, args.bursts, args.warmup_bursts), separators=(',', ':'), allow_nan=False))
            return 0
        return parent(args)
    except Exception:
        print(json.dumps(dict(status='failed', code='measurement-failed')))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
