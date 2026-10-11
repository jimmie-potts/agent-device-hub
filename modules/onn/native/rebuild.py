#!/usr/bin/env python3
"""Explicit offline D8 reproduction; verify release pins without replacing artifacts."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

NATIVE = Path(__file__).resolve().parent


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    if len(sys.argv) != 1:
        print('ONN native rebuild: unsupported arguments', file=sys.stderr)
        return 2
    os.umask(0o077)
    repo = next(parent for parent in NATIVE.parents if (parent / '.git').exists())
    if subprocess.run(['git', '-C', str(repo), 'check-ignore', '-q', '.local/probe']).returncode != 0:
        raise RuntimeError('scratch must be ignored')
    release = json.loads((NATIVE / 'release.json').read_text())
    source = NATIVE / 'src/OnnMetadataReader.java'
    artifact = NATIVE / 'artifact/reader.dex'
    r8 = Path(os.environ['ONN_R8_JAR']).resolve(strict=True)
    if digest(source) != release['sourceSha256'] or digest(artifact) != release['dexSha256'] or digest(r8) != release['r8Sha256']:
        raise RuntimeError('pin mismatch')
    version = subprocess.run(['javac', '-version'], text=True, capture_output=True, check=True)
    if not re.match(r'^javac 21(?:\.|\s)', version.stdout + version.stderr):
        raise RuntimeError('JDK 21 required')
    scratch = Path(os.environ.get('ONN_NATIVE_CHECK_SCRATCH', str(repo / '.local/scratch/onn-native-rebuild'))).resolve()
    if not scratch.is_relative_to((repo / '.local/scratch').resolve()):
        raise RuntimeError('scratch outside boundary')
    scratch.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.TemporaryDirectory(prefix='run-', dir=scratch) as temporary:
        output = Path(temporary)
        classes, dex = output / 'classes', output / 'dex'
        classes.mkdir()
        dex.mkdir()
        subprocess.run(['javac', '--release', str(release['javaRelease']), '-Xlint:-options', '-g:none', '-d', str(classes), str(source)], check=True, timeout=60)
        command = ['java', '-cp', str(r8), 'com.android.tools.r8.D8', '--release', '--min-api', str(release['minApi']), '--output', str(dex)]
        command.extend(str(path) for path in sorted(classes.rglob('*.class')))
        subprocess.run(command, check=True, timeout=60)
        actual = digest(dex / 'classes.dex')
        if actual != release['dexSha256']:
            raise RuntimeError('reproduction mismatch')
    print(json.dumps({'check':'onn-native-offline-rebuild','sourceSha256':release['sourceSha256'],
                      'dexSha256':actual,'r8Sha256':release['r8Sha256'],'d8Reproduced':True,
                      'deviceQualified':False},sort_keys=True))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, RuntimeError, StopIteration, subprocess.SubprocessError):
        print('ONN native rebuild failed', file=sys.stderr)
        sys.exit(2)
