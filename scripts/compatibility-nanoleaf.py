"""Real owning code with a disposable store and no physical worker."""
import contextlib
import json
from pathlib import Path
import sys
import threading
import time

source = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(source / 'tests'))
from test_integration_api import IntegrationTest
from test_bridge import b

case = IntegrationTest('test_snapshot_is_private_and_byte_pure')
case.setUp()
b.launch_worker = lambda _: None
shared = b.shared_input
poller = shared.Poller(case.directory, b)
server = case.service.make_server(case.app)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
try:
    print(json.dumps({'endpoint': f'http://127.0.0.1:{server.server_port}/controller/v1',
                      'token': case.token, 'python': sys.version.split()[0]}), flush=True)
    for line in sys.stdin:
        request = json.loads(line)
        operation = request['operation']
        if operation == 'stop':
            break
        if operation == 'configure':
            token = case.directory / 'read-token'
            token.write_text(request['token'])
            token.chmod(0o600)
            shared.configure(case.directory, b, {
                'version': 1, 'ownerId': 'compatibility', 'consumerId': 'nanoleaf',
                'endpoint': request['endpoint'], 'tokenFile': str(token),
                'clearOnNewTurn': True, 'bindings': [],
                'qualifiedSources': [
                    {'provider': 'codex', 'client': 'cli', 'hostId': 'fixture', 'sourceId': 'fixture'},
                    {'provider': 'claude', 'client': 'code', 'hostId': 'fixture', 'sourceId': 'fixture'},
                ],
            })
            shared.select_source(case.directory, b, 'shared')
        elif operation == 'poll':
            poller.tick(time.time())
        elif operation == 'process':
            case.process()
        elif operation != 'status':
            raise ValueError('unknown fixture operation')
        view = shared.inspect(case.directory)
        with contextlib.closing(b.connect_state(case.directory)) as db:
            view['fixtureEffects'] = db.execute('SELECT COUNT(*) FROM comets').fetchone()[0]
            view['fixtureActivity'] = db.execute('SELECT session,turn,status,started FROM activity ORDER BY session').fetchall()
            view['fixtureSuppressed'] = db.execute('SELECT session FROM shared_suppressed_waves ORDER BY session').fetchall()
        print(json.dumps(view), flush=True)
finally:
    server.shutdown()
    server.server_close()
    thread.join()
    case.doCleanups()
