"""Build only inside the supervisor's private namespace and owned staging."""
import json
import os
import subprocess
import sys
from pathlib import Path

print('{"ready":true}', flush=True)
assert sys.stdin.read(1) == '1'
os.mkdir('/tmp/bin')
os.symlink('/node', '/tmp/bin/node')
os.symlink(sys.argv[1], '/tmp/bin/npm')
os.environ['PATH'] = '/tmp/bin:/usr/bin'
os.environ['npm_config_cache'] = '/work/cache'
version = subprocess.check_output(['/node', '--version'], text=True).strip()
if not version.startswith('v24.'):
    raise ValueError('node-24-required')
for command, directory in [
    (['npm', 'ci', '--offline', '--ignore-scripts'], '/work/pixoo'),
    (['npm', 'run', 'build:types'], '/work/pixoo'),
    (['npm', 'run', 'build'], '/work/hub-source'),
]:
    subprocess.run(command, cwd=directory, check=True, timeout=180)
print(json.dumps({'result': {'node': version, 'npm': subprocess.check_output(['npm', '--version'], text=True).strip()}}), flush=True)
