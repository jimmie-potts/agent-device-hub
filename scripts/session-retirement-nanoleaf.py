"""Pass real Hub snapshots into the pinned Nanoleaf source with disposable state."""
import contextlib
import json
import os
from pathlib import Path
import sys
import tempfile

source=Path(sys.argv[1])
sys.path.insert(0,str(source/'bridge'))
import bridge as b
import shared_input as s

packet=json.load(sys.stdin)
for case in packet['corpus']['cases']:
    expected=case['valid']
    if isinstance(case['input'],dict) and case['input'].get('apiVersion')=='1.1':
        expected=expected and all('generation' in session for session in case['input']['sessions'])
    assert s.validate_snapshot(case['input'])['ok']==expected,case['id']
with tempfile.TemporaryDirectory(prefix='retirement-nano-') as temporary:
    root=Path(temporary)
    os.environ['CODEX_HOME']=str(root/'synthetic-codex-home')
    key=s.identity_key(packet['initial']['snapshot']['sessions'][0]['identity'])
    for missed in (False,True):
        directory=root/str(missed)
        directory.mkdir()
        config={'version':1,'ownerId':'owner','consumerId':'nanoleaf','endpoint':'http://127.0.0.1:1/api/monitor/v1',
                'tokenFile':str(root/'unused-token'),'clearOnNewTurn':True,
                'qualifiedSources':[{'provider':'codex','client':'desktop','hostId':'host','sourceId':'source'}],'bindings':[]}
        s.configure(directory,b,config)
        s.select_source(directory,b,'shared',fetch=lambda *args,**kwargs:packet['initial'],now=lambda:1000)
        with contextlib.closing(b.connect_state(directory)) as db,db:
            assert db.execute('SELECT COUNT(*) FROM sessions').fetchone()[0]==1,'child folds into parent'
            db.execute("INSERT INTO projects VALUES ('kept','Kept project','#112233','[]')")
            db.execute("UPDATE task_info SET manual_project='kept'")
            db.execute('INSERT INTO slots (session,slot) VALUES (?,0)',(key,))
            generation=s.state(db)['generation']
        s.failed(directory,b,generation)
        with contextlib.closing(b.connect_state(directory)) as db:
            assert db.execute('SELECT COUNT(*) FROM sessions').fetchone()[0]==1
        if not missed:
            s.accept(directory,b,packet['removed'],now=lambda:1010)
            with contextlib.closing(b.connect_state(directory)) as db:
                for table in ('sessions','slots','activity','task_info','comets'):
                    assert db.execute('SELECT COUNT(*) FROM '+table).fetchone()[0]==0,table
        # accept reopens the saved envelope; no in-memory task-generation cache.
        s.accept(directory,b,packet['fresh'],now=lambda:1020)
        with contextlib.closing(b.connect_state(directory)) as db:
            assert db.execute('SELECT manual_project FROM task_info').fetchall()==[(None,)]
            assert db.execute('SELECT COUNT(*) FROM slots').fetchone()[0]==0
            assert db.execute('SELECT COUNT(*) FROM comets').fetchone()[0]==0
            assert db.execute("SELECT color FROM projects WHERE id='kept'").fetchone()[0]=='#112233'
            assert s.state(db)['envelope']['snapshot']['sessions'][0]['generation']==packet['fresh']['snapshot']['sessions'][0]['generation']
print(json.dumps({'sharedFixtureCases':len(packet['corpus']['cases']),'retirement':True,'missedRetirement':True,
                  'restart':True,'emptyReconnect':True,'unavailableRetained':True,'projectPreserved':True,'physical':False}))
