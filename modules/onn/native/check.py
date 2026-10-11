#!/usr/bin/env python3
"""Offline CI: JDK synthetic execution and release pins; no D8 reproduction."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

NATIVE = Path(__file__).resolve().parent


def repository_root():
    for parent in NATIVE.parents:
        if (parent / '.git').exists():
            return parent
    raise RuntimeError('repository unavailable')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def pins():
    release = json.loads((NATIVE / 'release.json').read_text())
    source = digest(NATIVE / 'src/OnnMetadataReader.java')
    dex = digest(NATIVE / 'artifact/reader.dex')
    identity = (NATIVE.parent / 'src/reader-artifact.ts').read_text()
    if source != release['sourceSha256'] or dex != release['dexSha256']:
        raise RuntimeError('release pin mismatch')
    for name, value in [('READER_SOURCE_SHA256', source), ('READER_SHA256', dex),
                        ('READER_SCHEMA', release['readerSchema']),
                        ('READER_SOURCE_VERSION', release['sourceVersion'])]:
        if f"export const {name} = '{value}';" not in identity:
            raise RuntimeError('TypeScript pin mismatch')
    return source, dex


def main():
    if len(sys.argv) != 1:
        print('ONN native check: unsupported arguments', file=sys.stderr)
        return 2
    os.umask(0o077)
    repo = repository_root()
    if subprocess.run(['git', '-C', str(repo), 'check-ignore', '-q', '.local/probe']).returncode != 0:
        print('ONN native check: .local scratch must be ignored', file=sys.stderr)
        return 2
    source, dex = pins()
    version = subprocess.run(['javac', '-version'], text=True, capture_output=True, check=True)
    if not re.match(r'^javac 21(?:\.|\s)', version.stdout + version.stderr):
        print('ONN native check: JDK 21 required', file=sys.stderr)
        return 2
    scratch = Path(os.environ.get('ONN_NATIVE_CHECK_SCRATCH', str(repo / '.local/scratch/onn-native-check'))).resolve()
    boundary = (repo / '.local/scratch').resolve()
    if not scratch.is_relative_to(boundary):
        print('ONN native check: scratch must be under repository .local/scratch', file=sys.stderr)
        return 2
    scratch.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.TemporaryDirectory(prefix='run-', dir=scratch) as temporary:
        output = Path(temporary) / 'classes'
        output.mkdir()
        command = ['javac', '--release', '8', '-Xlint:-options', '-g:none', '-d', str(output),
                   str(NATIVE / 'src/OnnMetadataReader.java')]
        command.extend(str(path) for path in sorted((NATIVE / 'tests/stubs').rglob('*.java')))
        subprocess.run(command, check=True, timeout=60)
        environment = {**os.environ, 'ONN_NATIVE_TEST_CLASSES': str(output)}
        subprocess.run([sys.executable, str(NATIVE / 'tests/test_reader.py')],
                       env=environment, check=True, timeout=90)
    print(json.dumps({'check': 'onn-native-jdk-pins', 'syntheticJdk': 'passed',
                      'sourceSha256': source, 'dexSha256': dex,
                      'd8Reproduced': False, 'deviceQualified': False}, sort_keys=True))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError):
        print('ONN native check failed', file=sys.stderr)
        sys.exit(2)
