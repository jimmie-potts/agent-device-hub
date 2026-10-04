"""Read/render only through the owning canonical recommendation implementation."""
import importlib.util
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
source = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(source.parent))
spec = importlib.util.spec_from_file_location('maintenance_recommendations', source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
request = json.load(sys.stdin)
if request['operation'] == 'parse':
    print(json.dumps(module.read(request['body'])))
else:
    body, outcome = module.upsert(request['body'], request['entry'], request['today'])
    print(json.dumps({'body': body, 'outcome': outcome, 'parsed': module.read(body)}))
