"""Disposable owning-code fixture. No physical writer or installed state is available."""
import json
import os
from pathlib import Path
import sys

source, directory = Path(sys.argv[1]), Path(sys.argv[2])
assert directory.is_dir() and str(directory).startswith('/tmp/hub-shared-')
sys.path.insert(0, str(source / 'bridge'))
import database
import codex_hooks
import shared_input
import shared_source as shared
# Legacy rollback requires registered handlers. Keep that prerequisite synthetic;
# never inspect or modify the user's Codex home or launch a device worker.
home = directory / 'synthetic-codex-home'
home.mkdir(exist_ok=True)
(home / 'hooks.json').write_text(json.dumps(codex_hooks.merge_hooks({}, 'true')))
os.environ['CODEX_HOME'] = str(home)
command = sys.argv[3:]
if command == ['fixture-poll']:
    state = shared.source_config(directory)
    result = shared.accept(directory, shared_input.fetch_snapshot(state['config']), generation=state['generation'])
    print(json.dumps({'accepted': result}))
elif command == ['fixture-projection']:
    # Read the actual owning projection; the physical worker remains disabled.
    with database.connect_state(directory) as db:
        print(json.dumps([{'id': row[0], 'status': row[1]} for row in db.execute('SELECT id,status FROM sessions')]))
else:
    shared.command([*command, '--state-dir', str(directory)], launch=lambda _directory: None)
