"""Disposable owning-code fixture. No physical writer or installed state is available."""
import importlib.util
import json
from pathlib import Path
import sys

source, directory = Path(sys.argv[1]), Path(sys.argv[2])
assert directory.is_dir() and str(directory).startswith('/tmp/hub-shared-')
spec = importlib.util.spec_from_file_location('bridge', source / 'bridge/bridge.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)
shared = bridge.shared_input
bridge.launch_worker = lambda _directory: None
bridge.data_dir = lambda: directory
command = sys.argv[3:]
if command == ['fixture-poll']:
    state = shared.source_config(directory, bridge)
    result = shared.accept(directory, bridge, shared.fetch_snapshot(state['config']), generation=state['generation'])
    print(json.dumps({'accepted': result}))
else:
    shared.command(command, bridge)
