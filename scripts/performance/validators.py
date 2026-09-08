"""Measure released lifecycle validators in a disposable external consumer."""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib
import importlib.metadata
import json
import math
import os
from pathlib import Path, PurePosixPath
import platform
import queue
import subprocess
import sys
import threading
import time

ARCHIVE_HASH = '669c8e3d8b2bac5255ea613eae96134c324515b4e7a767887e86fa59b87fef85'
MANIFEST_HASH = 'ac8a72433adc8d516715476e842f2deccafeec748b2292c6df9d96b5afa93f96'
CORPUS_HASH = '872e5104bb9a109853948e61cee4d900b7c7acecde65de5313c3064194089fec'
MAX_LINE = 1_000_000
MAX_SAMPLES = 50_000
SCRIPT = Path(__file__).resolve()
NODE_WORKER = SCRIPT.with_name('validators-node.mjs')


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def natural(value):
    return type(value) is int and value >= 0


def summary(values):
    if not values or any(not natural(value) for value in values):
        raise ValueError('invalid-samples')
    ordered = sorted(values)
    return dict(n=len(ordered), p95Ns=ordered[math.ceil(len(ordered) * .95) - 1],
                p99Ns=ordered[math.ceil(len(ordered) * .99) - 1], maxNs=ordered[-1],
                tailSupport='provisional' if len(ordered) < 1000 else 'recorded')


def verify_files(root, files):
    root = Path(root).resolve(strict=True)
    if not isinstance(files, dict) or not files:
        raise ValueError('invalid-manifest')
    for name, expected in files.items():
        if not isinstance(name, str) or '\\' in name:
            raise ValueError('invalid-manifest-path')
        relative = PurePosixPath(name)
        if relative.is_absolute() or any(p in ('', '.', '..') for p in relative.parts) or str(relative) != name:
            raise ValueError('invalid-manifest-path')
        path = root.joinpath(*relative.parts)
        if any(root.joinpath(*relative.parts[:i]).is_symlink() for i in range(1, len(relative.parts) + 1)):
            raise ValueError('symlinked-package-entry')
        if not path.is_file() or digest(path) != expected:
            raise ValueError('package-file-mismatch')


def package_path(consumer):
    return Path(consumer).resolve(strict=True) / 'node_modules/@jimmie-potts/agent-lifecycle-contracts'


def read_cases(package):
    fixture = package / 'fixtures/lifecycle-v1.json'
    if digest(fixture) != CORPUS_HASH:
        raise ValueError('corpus-mismatch')
    corpus = json.loads(fixture.read_text(encoding='utf8'))
    cases = [case for case in corpus['cases'] if case['valid'] is True]
    if len(corpus['cases']) != 81 or len(cases) != 33:
        raise ValueError('unexpected-corpus-inventory')
    return cases


def verify_inputs(archive, consumer):
    if digest(archive) != ARCHIVE_HASH:
        raise ValueError('archive-mismatch')
    package = package_path(consumer)
    if package.is_symlink() or digest(package / 'manifest.json') != MANIFEST_HASH:
        raise ValueError('manifest-mismatch')
    manifest = json.loads((package / 'manifest.json').read_text(encoding='utf8'))
    if (manifest['artifact'], manifest['version'], manifest['apiVersion']) != (
            '@jimmie-potts/agent-lifecycle-contracts', '1.0.0', '1.0'):
        raise ValueError('artifact-identity-mismatch')
    verify_files(package, manifest['files'])
    cases = read_cases(package)
    return dict(archiveSha256=ARCHIVE_HASH, manifestSha256=MANIFEST_HASH, corpusSha256=CORPUS_HASH,
                consumerLockSha256=digest(Path(consumer) / 'package-lock.json'),
                caseIds=[case['id'] for case in cases], manifestFileCount=len(manifest['files']))


def detached_equal(actual, expected):
    if type(expected) is dict:
        return (type(actual) is dict and actual is not expected and actual.keys() == expected.keys()
                and all(detached_equal(actual[k], v) for k, v in expected.items()))
    if type(expected) is list:
        return (type(actual) is list and actual is not expected and len(actual) == len(expected)
                and all(detached_equal(a, b) for a, b in zip(actual, expected)))
    return type(actual) is type(expected) and actual == expected


def python_rss():
    if sys.platform not in ('linux', 'darwin'):
        return None
    import resource
    return int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * (1 if sys.platform == 'darwin' else 1024))


def ambient_load():
    try:
        return list(os.getloadavg())
    except (AttributeError, OSError):
        return None


def python_worker(consumer, cycles, warmups):
    if sys.version_info[:2] not in ((3, 12), (3, 14)):
        raise ValueError('unsupported-python')
    package = package_path(consumer)
    if digest(package / 'manifest.json') != MANIFEST_HASH:
        raise ValueError('manifest-mismatch')
    cases = read_cases(package)
    dependency = importlib.metadata.version('jsonschema')
    if dependency != '4.19.2':
        raise ValueError('unexpected-jsonschema-version')
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(package / 'python'))
    began = time.perf_counter_ns()
    module = importlib.import_module('agent_lifecycle_contracts')
    imported = time.perf_counter_ns() - began
    if (Path(module.__file__).resolve() != (package / 'python/agent_lifecycle_contracts/__init__.py').resolve()
            or module.ARTIFACT_VERSION != '1.0.0' or module.API_VERSION != '1.0'):
        raise ValueError('unexpected-validator-import')
    print(json.dumps(dict(type='ready', importNs=imported, runtime=dict(language='python',
          version=platform.python_version(), dependencyVersion=dependency,
          system=platform.system(), release=platform.release()))), flush=True)
    originals = [json.dumps(case['input'], sort_keys=True) for case in cases]
    def invoke(index):
        item = cases[index]['input']
        began = time.perf_counter_ns()
        result = module.validate_event(item)
        duration = time.perf_counter_ns() - began
        if (result.get('ok') is not True or not detached_equal(result.get('value'), item)
                or json.dumps(item, sort_keys=True) != originals[index]):
            raise RuntimeError('validator-result-mismatch')
        return duration
    first = invoke(0)
    rss = python_rss()
    cpu = time.process_time_ns()
    for _ in range(warmups):
        for i in range(len(cases)):
            invoke(i)
    durations = [invoke(i) for _ in range(cycles) for i in range(len(cases))]
    cpu = time.process_time_ns() - cpu
    print(json.dumps(dict(type='result', firstCallNs=first, durationNs=durations,
          cpuWarmupAndChecksNs=cpu, rssBeforeBytes=rss, rssAfterBytes=python_rss(),
          rssMethod='process-lifetime-peak' if rss is not None else 'unsupported',
          loadAverage=ambient_load())), flush=True)


def collect(command, timeout):
    if type(timeout) not in (int, float) or not math.isfinite(timeout) or not 0 < timeout <= 600:
        raise ValueError('invalid-timeout')
    environment = dict(os.environ)
    for key in ('NODE_OPTIONS', 'NODE_PATH', 'PYTHONPATH', 'PYTHONHOME'):
        environment.pop(key, None)
    environment['PYTHONDONTWRITEBYTECODE'] = '1'
    began = time.perf_counter_ns()
    deadline = time.monotonic() + timeout
    process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL, env=environment)
    messages = queue.SimpleQueue()
    def read():
        try:
            for _ in range(3):
                line = process.stdout.readline(MAX_LINE + 1)
                messages.put((time.perf_counter_ns(), line))
                if not line or len(line) > MAX_LINE:
                    return
        except OSError:
            messages.put((time.perf_counter_ns(), b''))
    reader = threading.Thread(target=read, daemon=True)
    reader.start()
    records, ready = [], None
    try:
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return {'status': 'timeout'}
            try:
                received, line = messages.get(timeout=remaining)
            except queue.Empty:
                return {'status': 'timeout'}
            if not line:
                break
            if len(line) > MAX_LINE or not line.endswith(b'\n') or len(records) == 2:
                return {'status': 'invalid-worker-output'}
            try:
                records.append(json.loads(line))
            except (ValueError, UnicodeError):
                return {'status': 'invalid-worker-output'}
            if len(records) == 1:
                ready = received - began
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return {'status': 'timeout'}
        try:
            code = process.wait(timeout=remaining)
        except subprocess.TimeoutExpired:
            return {'status': 'timeout'}
        if code:
            return dict(status='worker-failed', exitCode=code)
        return dict(status='complete', parentSpawnToReadyNs=ready,
                    parentRoundtripNs=time.perf_counter_ns() - began, records=records)
    finally:
        if process.poll() is None:
            process.kill()
        process.wait()
        reader.join(timeout=1)
        process.stdout.close()


def check_records(records, language, cycles):
    if not isinstance(records, list) or len(records) != 2:
        return False
    ready, result = records
    if (not isinstance(ready, dict) or set(ready) != {'type', 'importNs', 'runtime'}
            or ready['type'] != 'ready' or not natural(ready['importNs'])
            or not isinstance(result, dict) or set(result) != {'type', 'firstCallNs', 'durationNs',
                'cpuWarmupAndChecksNs', 'rssBeforeBytes', 'rssAfterBytes', 'rssMethod', 'loadAverage'}
            or result['type'] != 'result'):
        return False
    runtime = ready['runtime']
    if (not isinstance(runtime, dict) or set(runtime) != {'language', 'version', 'dependencyVersion', 'system', 'release'}
            or runtime['language'] != language or any(not isinstance(v, str) or len(v) > 160
            or any(ord(c) < 32 for c in v) for v in runtime.values())):
        return False
    if runtime['dependencyVersion'] != ('4.19.2' if language == 'python' else '8.20.0'):
        return False
    if not natural(result['firstCallNs']) or not natural(result['cpuWarmupAndChecksNs']):
        return False
    values = result['durationNs']
    if not isinstance(values, list) or len(values) != cycles * 33 or any(not natural(v) for v in values):
        return False
    if any(result[k] is not None and not natural(result[k]) for k in ('rssBeforeBytes', 'rssAfterBytes')):
        return False
    if result['rssMethod'] not in ('process-lifetime-peak', 'instantaneous-process-rss', 'unsupported'):
        return False
    if result['rssMethod'] == 'unsupported' and any(result[k] is not None for k in ('rssBeforeBytes', 'rssAfterBytes')):
        return False
    load = result['loadAverage']
    return load is None or (isinstance(load, list) and len(load) == 3 and all(
        type(v) in (int, float) and math.isfinite(v) and v >= 0 for v in load))


def save(output, receipt):
    temporary = output / 'validators.json.tmp'
    temporary.write_text(json.dumps(receipt, indent=2, allow_nan=False) + '\n', encoding='utf8')
    temporary.replace(output / 'validators.json')


def run(args):
    if (not 1 <= args.cycles <= 1000 or not 0 <= args.warmups <= 100 or not 1 <= args.repeats <= 5
            or args.cycles * 33 * args.repeats * 2 > MAX_SAMPLES
            or not math.isfinite(args.timeout) or not 0 < args.timeout <= 600):
        raise ValueError('invalid-sample-plan')
    if args.worker_python:
        python_worker(args.consumer, args.cycles, args.warmups)
        return 0
    if not args.archive or not args.output:
        raise ValueError('archive-and-output-required')
    inputs = verify_inputs(args.archive, args.consumer)
    output = Path(args.output)
    output.mkdir(exist_ok=False)
    hashes = {'validators.py': digest(SCRIPT), 'validators-node.mjs': digest(NODE_WORKER)}
    receipt = dict(format=1, status='running', createdAt=datetime.now(timezone.utc).isoformat(),
        inputs=inputs, toolHashes=hashes,
        configuration=dict(cycles=args.cycles, warmupCycles=args.warmups, repeats=args.repeats,
                           workerTimeoutSeconds=args.timeout, maximumWarmSamples=MAX_SAMPLES),
        intervals=dict(parentSpawnToReadyNs='Parent monotonic spawn through readiness receipt, including runtime startup, preparation, corpus reads and import.',
            importNs='Worker monotonic validator import.', firstCallNs='First validation after import, not cold OS caches.',
            durationNs='Warm calls in upstream valid-case order; assertions excluded.',
            cpuWarmupAndChecksNs='Process CPU including warmup, measurements and assertions.'),
        budgetStatus='not-frozen', excluded=['provider-hook-return', 'cross-boundary-forwarding',
            'shared-reducer', 'consumer-admission', 'device-transport', 'installed-client', 'optical-observation'], runs=[])
    save(output, receipt)
    for repeat in range(1, args.repeats + 1):
        for language in ('python', 'node'):
            try:
                if verify_inputs(args.archive, args.consumer) != inputs:
                    raise ValueError('changed-inputs')
                command = ([sys.executable, '-I', '-B', str(SCRIPT), '--worker-python', '--consumer', args.consumer,
                    '--cycles', str(args.cycles), '--warmups', str(args.warmups)] if language == 'python' else
                    [args.node, str(NODE_WORKER), str(package_path(args.consumer)), str(args.cycles), str(args.warmups)])
                result = collect(command, args.timeout)
                if verify_inputs(args.archive, args.consumer) != inputs:
                    result = {'status': 'input-changed'}
                elif result['status'] == 'complete':
                    if not check_records(result['records'], language, args.cycles):
                        result = {'status': 'invalid-worker-output'}
                    else:
                        result['summary'] = summary(result['records'][1]['durationNs'])
            except Exception:
                result = {'status': 'measurement-failed'}
            receipt['runs'].append(dict(repeat=repeat, language=language, result=result))
            save(output, receipt)
    complete = all(item['result']['status'] == 'complete' for item in receipt['runs'])
    receipt.update(status='complete' if complete else 'incomplete', finishedAt=datetime.now(timezone.utc).isoformat())
    save(output, receipt)
    print(json.dumps(dict(status=receipt['status'], budgetStatus='not-frozen')))
    return 0 if complete else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--consumer', required=True)
    parser.add_argument('--archive')
    parser.add_argument('--output')
    parser.add_argument('--node', default='node')
    parser.add_argument('--cycles', type=int, default=100)
    parser.add_argument('--warmups', type=int, default=3)
    parser.add_argument('--repeats', type=int, default=3)
    parser.add_argument('--timeout', type=float, default=120)
    parser.add_argument('--worker-python', action='store_true', help=argparse.SUPPRESS)
    try:
        return run(parser.parse_args())
    except Exception:
        print(json.dumps(dict(status='failed', code='measurement-failed')))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
