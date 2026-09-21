"""Disposable owning-service fixture, never an installed worker or device."""
import sys
import json
import threading
from pathlib import Path
source = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(source / 'tests'))
from test_integration_api import IntegrationTest
case = IntegrationTest('test_snapshot_is_private_and_byte_pure')
case.setUp()
server = case.service.make_server(case.app)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
try:
    print(json.dumps({'endpoint': f'http://127.0.0.1:{server.server_port}/controller/v1', 'token': case.token}), flush=True)
    for line in sys.stdin:
        if line.strip() != 'process':
            break
        case.process()
        print('processed', flush=True)
finally:
    server.shutdown()
    server.server_close()
    thread.join()
    case.doCleanups()
