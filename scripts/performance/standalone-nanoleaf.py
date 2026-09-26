"""Real source poller and projection, synthetic private state, no physical writer."""
import contextlib
import json
from pathlib import Path
import sys
import time

source=Path('/runtime/nanoleaf/bridge')
sys.path.insert(0,str(source))
import database
import shared_input
import shared_source as shared
directory=Path('/state/nanoleaf');directory.mkdir(mode=0o700)
poller=None
print(json.dumps({'ready':True}),flush=True)
for line in sys.stdin:
    try:
        value=json.loads(line)
        if value['operation']=='configure':
            token=directory/'token';token.write_text(value['token']);token.chmod(0o600)
            config={'version':1,'ownerId':'qualification','consumerId':'nanoleaf',
                    'endpoint':value['endpoint'],'tokenFile':str(token),'clearOnNewTurn':True,
                    'qualifiedSources':[{'provider':'codex','client':'cli','hostId':'synthetic','sourceId':'qualification'}], 'bindings':[]}
            shared.configure(directory,config);shared.select_source(directory,'shared')
            poller=shared.Poller(directory)
        elif value['operation']!='poll':raise ValueError('unknown-operation')
        if poller:poller.tick(time.time())
        state=shared.source_config(directory)
        with contextlib.closing(database.connect_state(directory)) as db:
            rows=db.execute('SELECT session,turn,status,started FROM activity ORDER BY session').fetchall()
            comets=db.execute('SELECT COUNT(*) FROM comets').fetchone()[0]
        print(json.dumps({'view':shared_input.inspect(directory),'snapshot':state['envelope']['snapshot'] if state['envelope'] else None,
                          'activity':rows,'comets':comets}),flush=True)
    except Exception as error:
        print(json.dumps({'error':type(error).__name__,'code':str(error)}),flush=True)
        raise SystemExit(1)
