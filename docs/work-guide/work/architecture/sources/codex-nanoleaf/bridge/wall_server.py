"""Loopback-only wall map. The light controller is owned by the bridge worker."""
import contextlib
import errno
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import subprocess
import sys
import threading
import time
from urllib.parse import urlsplit
import urllib.request
import webbrowser
import project_map as wall


class App:
    def __init__(self,directory,b,config=None,launch=None):
        self.directory=directory; self.b=b; self.config=config or b.load_config(directory)
        self.metadata=wall.Metadata(directory,self.config)
        self.launch=launch or b.launch_worker; self.lock=threading.RLock()
        self.geometry_retry=time.monotonic()+10
        self.geometry_attempts=0
        self.layout_generation=self.config.get('_connector_source')
        with contextlib.closing(self.b.connect_state(directory)) as db:
            resume_shared = self.b.shared_input.selected(db)
        if resume_shared: self.launch(directory)

    def state(self):
        with self.lock:
            connectors=wall.connector_layout(self.config)
            current_generation=layout_generation(self.directory)
            stale=current_generation!=self.layout_generation
            if (connectors is None or stale) and self.geometry_attempts<3 and time.monotonic()>=self.geometry_retry:
                self.geometry_retry=time.monotonic()+10
                self.geometry_attempts+=1
                if ensure_geometry(self.directory,self.b,self.config,refresh=stale):
                    self.layout_generation=self.config.get('_connector_source')
                connectors=wall.connector_layout(self.config)
            with contextlib.closing(self.b.connect_state(self.directory)) as check:
                shared = self.b.shared_input.selected(check)
            if not shared: self.metadata.refresh()
            with contextlib.closing(self.b.connect_state(self.directory)) as db,db:
                changed=False if self.b.shared_input.selected(db) else self.metadata.sync(db)
                if changed: self.b.mark_dirty(db)
                prefs=wall.owners(db,self.config); projects=[]
                memberships=wall.task_projects(db); slots=dict(db.execute('SELECT session,slot FROM slots'))
                details={s:(title,cwd,manual,started) for s,title,cwd,manual,started in db.execute('SELECT session,title,cwd,manual_project,started FROM task_info')}
                tasks=[]; snap=[None]*len(prefs)
                epochs={s:epoch for s,epoch in db.execute('SELECT session,started FROM activity')}
                for sid,turn,status in db.execute("SELECT id,turn,status FROM sessions WHERE status IN ('working','question','blocked','unread')"):
                    title,cwd,manual,started=details.get(sid,('', '',None,None)); slot=slots.get(sid)
                    tasks.append({'id':sid,'title':title or 'Task '+sid[:8],'project':memberships.get(sid),'status':status,'started':started,
                                  'line':wall.line_id(self.config['line_groups'][slot]) if slot is not None and slot<len(prefs) else None,'manual':manual})
                    if slot is not None and slot<len(snap): snap[slot]=(status,epochs.get(sid,time.time()-10))
                for pid,name,color in db.execute('SELECT id,name,color FROM projects ORDER BY name COLLATE NOCASE'):
                    members=[t for t in tasks if t['project']==pid]
                    projects.append({'id':pid,'name':name,'color':color,'assigned':sum(p[0]==pid for p in prefs),
                                     'active':len(members),'waiting':sum(t['line'] is None for t in members)})
                lines=wall.geometry(self.config)
                for line,(project,signature) in zip(lines,prefs):
                    line.update(project=project,signature=signature,task=next((t['id'] for t in tasks if t['line']==line['id']),None))
                control=self.b.control_state(db)
                result={'settings':wall.settings(db),'mode':control['mode'],'pending':wall.pending(db),
                        'error':control['error'],'mode_pending':control['revision']!=control['applied'],
                        'projects':projects,'lines':lines,'tasks':tasks,'now':time.time(),
                        'connector_layout':connectors,
                        'connector_error':None if connectors else 'Connector layout unavailable. Showing standard Lines.',
                        'geometry_error':None if lines else 'Layout unavailable. Check the light connection; the map will retry.'}
            if changed: self.launch(self.directory)
            return result

    def update(self,route,payload):
        if not isinstance(payload,dict): raise ValueError('Expected an object.')
        with self.lock,contextlib.closing(self.b.connect_state(self.directory)) as db,db:
            db.execute('BEGIN IMMEDIATE')
            projects={row[0] for row in db.execute('SELECT id FROM projects')}
            ids={wall.line_id(pair) for pair in self.config['line_groups']}
            patch={}
            if route=='/api/settings':
                checks={'style':('classic','project'),'coverage':('whole','status'),'rotation':(0,90,180,270),'flip_x':(0,1),'flip_y':(0,1)}
                if not payload or any(k not in checks or v not in checks[k] for k,v in payload.items()): raise ValueError('Invalid setting.')
                patch={'settings':payload}
            elif route=='/api/assign':
                values=payload.get('lines')
                if not isinstance(values,dict) or not values: raise ValueError('Select at least one Line.')
                for key,value in values.items():
                    if key not in ids or not isinstance(value,dict) or not value or set(value)-{'project','signature'}: raise ValueError('Invalid Line assignment.')
                    if 'project' in value and value['project'] is not None and value['project'] not in projects: raise ValueError('Unknown project.')
                    if 'signature' in value and (type(value['signature']) is not int or value['signature'] not in (0,1)): raise ValueError('Invalid half.')
                patch={'lines':values}
            elif route=='/api/project':
                if payload.get('id') not in projects or not isinstance(payload.get('color'),str) or not re.fullmatch(r'#[0-9a-fA-F]{6}',payload['color']): raise ValueError('Invalid project color.')
                db.execute('UPDATE projects SET color=? WHERE id=?',(payload['color'].lower(),payload['id']))
            elif route=='/api/task':
                sid=payload.get('id'); project=payload.get('project')
                if not db.execute('SELECT 1 FROM task_info WHERE session=?',(sid,)).fetchone(): raise ValueError('Unknown task.')
                if project is not None and project not in projects: raise ValueError('Unknown project.')
                patch={'tasks':{sid:project}}
            elif route=='/api/locate':
                if payload.get('line') not in ids: raise ValueError('Unknown Line.')
                if self.b.control_state(db)['mode']=='free': raise ValueError('Choose Work or Quiet to locate a Line.')
                db.execute('INSERT OR REPLACE INTO locate VALUES (1,?,NULL)',(payload['line'],))
            else: raise ValueError('Unknown action.')
            if patch: wall.request_patch(db,patch,self.config)
            import controller_state
            controller_state.changed(db)
            self.b.mark_dirty(db)
        self.launch(self.directory)
        return {'ok':True}


def handler(app,token,instance=None):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args): pass
        def respond(self,code,data,kind='application/json'):
            content=json.dumps(data).encode() if kind=='application/json' else data
            self.send_response(code); self.send_header('Content-Type',kind+'; charset=utf-8')
            self.send_header('Cache-Control','no-store'); self.send_header('X-Content-Type-Options','nosniff')
            self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'")
            self.send_header('Content-Length',str(len(content))); self.end_headers(); self.wfile.write(content)
        def valid_host(self):
            return self.headers.get('Host')==f'127.0.0.1:{self.server.server_port}'
        def do_GET(self):
            if not self.valid_host(): return self.respond(403,{'error':'Invalid host.'})
            path=urlsplit(self.path).path
            try:
                if path=='/':
                    page=Path(__file__).with_name('wall.html').read_text(encoding='utf-8').replace('__CSRF__',token)
                    return self.respond(200,page.encode(),'text/html')
                assets={'/assets/prism.js':'prism.js','/assets/prism-adapters.js':'prism-adapters.js','/assets/prism-labels.js':'prism-labels.js'}
                if path in assets:
                    return self.respond(200,Path(__file__).with_name(assets[path]).read_bytes(),'text/javascript')
                if path=='/api/state': return self.respond(200,app.state())
                if path=='/health': return self.respond(200,{'service':'codex-nanoleaf-map', 'instance':instance})
                self.respond(404,{'error':'Not found.'})
            except Exception: self.respond(503,{'error':'Local map status unavailable. Retrying shortly.'})
        def do_POST(self):
            origin=f'http://127.0.0.1:{self.server.server_port}'
            if not self.valid_host() or self.headers.get('Origin')!=origin or not secrets.compare_digest(self.headers.get('X-Wall-Token',''),token):
                return self.respond(403,{'error':'Open the wall map from the tray.'})
            try:
                length=int(self.headers.get('Content-Length','0'))
                if not 0<length<=65536 or self.headers.get('Content-Type')!='application/json': raise ValueError('Invalid request.')
                payload=json.loads(self.rfile.read(length))
                if self.path=='/api/mode':
                    if not isinstance(payload,dict) or payload.get('mode') not in self.server.app.b.MODES: raise ValueError('Invalid mode.')
                    app.b.set_mode(app.directory,payload['mode']); result={'ok':True}
                else: result=app.update(self.path,payload)
                self.respond(200,result)
            except (ValueError,TypeError,KeyError): self.respond(400,{'error':'Invalid request. Check the selection and try again.'})
            except Exception: self.respond(503,{'error':'Could not save the change. Try again.'})
    return Handler


def layout_generation(directory):
    try:
        source=(directory/'layout.json').stat()
        return [source.st_mtime_ns,source.st_size,source.st_ino]
    except OSError:
        return None


def ensure_geometry(directory,b,config,refresh=False):
    try:
        # Only the map owns this drawing cache. Never replace shared layout.json.
        path=directory/'connector-geometry.json'
        generation=layout_generation(directory)
        if generation is None: return False
        saved=json.loads((directory/'layout.json').read_text())
        if not isinstance(saved,dict): return False
        try:
            record=json.loads(path.read_text())
            if not isinstance(record,dict) or record.get('layoutGeneration')!=generation:
                raise ValueError('Drawing cache belongs to an older layout.')
            cache,_=wall.validated_connector_geometry(record.get('geometry'),config['line_groups'])
            cached=True
        except (OSError,ValueError,TypeError,KeyError,OverflowError):
            cached=False
            try:
                cache,_=wall.validated_connector_geometry(saved.get('connector_geometry') or saved.get('zone_geometry'),config['line_groups'])
            except (ValueError,TypeError,KeyError,OverflowError):
                layout=b.light_request(config,'GET')['panelLayout']
                cache,_=wall.validated_connector_geometry({
                    'positionData':layout['layout']['positionData'],
                    'orientation':layout['globalOrientation']['value']},config['line_groups'])
        additions={'connector_geometry':cache,'_connector_source':generation}
        if refresh or not config.get('zone_geometry'):
            additions['zone_geometry']={'positionData':[p for p in cache['positionData'] if p['shapeType']==18],
                                        'orientation':cache['orientation']}
        if not cached: b.write_json(path,{'layoutGeneration':generation,'geometry':cache})
        config.update(additions)
        return True
    except (OSError,ValueError,TypeError,KeyError,OverflowError):
        return False


def map_port(directory, override=None):
    value = override
    if value is None:
        value = json.loads((directory / 'config.json').read_text()).get('wall_port', 0)
    if type(value) is not int or not (value == 0 or 1024 <= value <= 65535):
        raise RuntimeError('Choose a wall-map port from 1024 through 65535, or 0 for a temporary port.')
    return value


def serve(directory,b,port=None):
    port = map_port(directory, port)
    with contextlib.closing(sqlite3.connect(directory/'map-lock.sqlite',timeout=0)) as lock:
        try: lock.execute('BEGIN EXCLUSIVE')
        except sqlite3.OperationalError as error:
            if getattr(error, 'sqlite_errorcode', None) == sqlite3.SQLITE_BUSY:
                raise RuntimeError('A wall map is already running for this installation.') from None
            raise
        config=b.load_config(directory); ensure_geometry(directory,b,config)
        app=App(directory,b,config)
        app.geometry_attempts=1  # Startup acquisition used the first bounded attempt.
        instance = secrets.token_hex(16)
        try:
            server=ThreadingHTTPServer(('127.0.0.1',port),handler(app,secrets.token_hex(32),instance))
        except OSError as error:
            if error.errno == errno.EADDRINUSE:
                raise RuntimeError(f'Port {port} is already in use. Stop its owner or choose another wall-map port.') from None
            raise RuntimeError(f'Cannot bind the wall map to 127.0.0.1:{port}.') from None
        server.app=app
        b.write_json(directory/'map-server.json',{'port':server.server_port, 'instance':instance})
        try: server.serve_forever()
        finally: server.server_close()


def map_url(directory, expected_port=0):
    try:
        receipt=json.loads((directory/'map-server.json').read_text())
        port=receipt['port']
        if type(port) is not int or not 1024<=port<=65535: return None
        if expected_port and port != expected_port: return None
        base=f'http://127.0.0.1:{port}'
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(base+'/health',timeout=.5) as response:
            health=json.load(response)
            if health.get('service')=='codex-nanoleaf-map' and (
                    not receipt.get('instance') or receipt['instance']==health.get('instance')): return base
    except Exception: pass
    return None


def command(args,directory,b):
    if args.mode=='style':
        if args.selection not in ('classic','project'): raise ValueError('Choose classic or project.')
        config=b.load_config(directory)
        with contextlib.closing(b.connect_state(directory)) as db,db:
            db.execute('BEGIN IMMEDIATE'); wall.request_patch(db,{'settings':{'style':args.selection}},config); b.mark_dirty(db)
        b.launch_worker(directory); return
    port = map_port(directory, getattr(args, 'port', None))
    if args.mode=='serve': return serve(directory,b,port)
    url=map_url(directory,port)
    if not url:
        kwargs={'stdin':subprocess.DEVNULL,'stdout':subprocess.DEVNULL,'stderr':subprocess.DEVNULL,'close_fds':True}
        if os.name=='nt': kwargs['creationflags']=subprocess.DETACHED_PROCESS|subprocess.CREATE_NEW_PROCESS_GROUP
        else: kwargs['start_new_session']=True
        process=subprocess.Popen([sys.executable,str(Path(b.__file__).resolve()),'serve','--state-dir',str(directory),
                                  '--port',str(port)],**kwargs)
        deadline=time.time()+10
        while not url and time.time()<deadline:
            time.sleep(.2); url=map_url(directory,port)
            if not url and process.poll() is not None: break
    if not url: raise RuntimeError(f'Wall map did not start on port {port}. Check its configuration and whether the port is already in use.')
    if os.name == 'nt' and not getattr(args, 'no_open', False): webbrowser.open(url)
    print(url)
