"""Loopback-only wall map. The light controller is owned by the bridge worker."""
import contextlib
import errno
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import secrets
import sqlite3
import subprocess
import sys
import threading
import time
from urllib.parse import parse_qs, urlsplit
import urllib.request
import devices
import project_map as wall


class UnknownDevice(ValueError):
    """A device that is not registered. It is never mapped to the original Lines device."""


UNKNOWN_DEVICE='Unknown device. Choose a registered device.'
KIND_NAMES={'lines':'Lines','panels':'Light Panels'}
CONVENTIONAL_IDS={'lines':devices.DEFAULT,'panels':'panels'}


def device_name(device,kind):
    """A readable selector label; an unconventional id is shown beside its kind."""
    name=KIND_NAMES.get(kind,kind)
    return name if CONVENTIONAL_IDS.get(kind)==device else f'{name} ({device})'


def codex_thread_url(session):
    """Only a plain UUID can become a local Desktop navigation target."""
    if isinstance(session,str) and re.fullmatch(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}',session):
        return 'codex://threads/'+session
    return None


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

    def registry(self):
        """The registered devices, read on every request so enrollment needs no map restart."""
        try:
            return devices.registry(json.loads((self.directory/'config.json').read_text(encoding='utf-8-sig')))
        except (OSError,ValueError):
            return {devices.device_of(self.config):{'kind':self.config.get('kind','lines')}}

    def device_list(self,registry=None):
        registry=registry or self.registry(); default=devices.device_of(self.config)
        ordered=([default] if default in registry else [])+[d for d in registry if d!=default]
        return [{'id':d,'kind':registry[d]['kind'],'name':device_name(d,registry[d]['kind']),'default':d==default} for d in ordered]

    def device_config(self,device=None,registry=None):
        """The startup configuration for the default device; cached geometry only for any other registered device.

        The map never discovers or contacts a non-default device: its layout comes from the saved
        entry that enrollment wrote, and a registered device without one reports a geometry error.
        """
        default=devices.device_of(self.config)
        if device is None or device==default: return self.config
        registry=registry or self.registry()
        if not isinstance(device,str) or device not in registry: raise UnknownDevice(UNKNOWN_DEVICE)
        kind=registry[device]['kind']
        try: entry=devices.layout_devices(json.loads((self.directory/'layout.json').read_text())).get(device)
        except (OSError,ValueError,TypeError): entry=None
        config={'device':device,'kind':kind,'elements':[],'line_groups':[]}
        if entry and entry['kind']==kind: config.update(devices.projection(entry))
        return config

    def state(self,device=None):
        with self.lock:
            registry=self.registry()
            config=self.device_config(device,registry)
            kind=config.get('kind','lines')
            connectors=None
            if config is self.config:
                connectors=wall.connector_layout(self.config)
                current_generation=layout_generation(self.directory)
                stale=current_generation!=self.layout_generation
                if (connectors is None or stale) and self.geometry_attempts<3 and time.monotonic()>=self.geometry_retry:
                    self.geometry_retry=time.monotonic()+10
                    self.geometry_attempts+=1
                    if ensure_geometry(self.directory,self.b,self.config,refresh=stale):
                        self.layout_generation=self.config.get('_connector_source')
                    connectors=wall.connector_layout(self.config)
            elif kind=='lines':
                connectors=wall.connector_layout(config)
            with contextlib.closing(self.b.connect_state(self.directory)) as check:
                shared = self.b.shared_input.selected(check)
            if not shared: self.metadata.refresh()
            device=devices.device_of(config)
            with contextlib.closing(self.b.connect_state(self.directory)) as db,db:
                changed=False if self.b.shared_input.selected(db) else self.metadata.sync(db)
                if changed: self.b.mark_dirty(db)
                prefs=wall.owners(db,config); projects=[]; elements=devices.elements(config)
                memberships=wall.task_projects(db); slots=dict(db.execute('SELECT session,slot FROM slots WHERE device=?',(device,)))
                details={s:(title,cwd,manual,started) for s,title,cwd,manual,started in db.execute('SELECT session,title,cwd,manual_project,started FROM task_info')}
                tasks=[]; snap=[None]*len(prefs)
                epochs={s:epoch for s,epoch in db.execute('SELECT session,started FROM activity')}
                uncertain=set(); codex_urls={}; eviction_tokens={}
                if shared:
                    shared_state=self.b.shared_input.state(db)
                    envelope=shared_state['envelope']
                    if envelope:
                        for key,(root,_,_) in self.b.shared_input.presented(envelope['snapshot']).items():
                            eviction_tokens[key]=self.b.shared_input.eviction_token(shared_state,root)
                            identity=root['identity']
                            if identity['provider']=='codex' and identity['client']=='desktop':
                                codex_urls[key]=codex_thread_url(identity['sessionId'])
                    received,connection=db.execute('SELECT received,connection FROM shared_input WHERE id=1').fetchone()
                    if connection!='current' or received is None or time.time()-received>4:
                        uncertain={sid for (sid,) in db.execute('SELECT id FROM sessions')}
                    else:
                        uncertain={sid for (sid,) in db.execute('SELECT session FROM shared_stale')}
                for sid,turn,status in self.b.shared_input.visible_tasks(db, device):
                    title,cwd,manual,started=details.get(sid,('', '',None,None)); slot=slots.get(sid)
                    codex_url=codex_urls.get(sid) if shared else codex_thread_url(sid) if sid in self.metadata.index_ids else None
                    tasks.append({'id':sid,'title':title or wall.fallback_title('codex',sid),'project':memberships.get(sid),'status':status,'started':started,
                                  'line':elements[slot]['id'] if slot is not None and slot<len(prefs) else None,'manual':manual,
                                  **({'codexUrl':codex_url} if codex_url else {}),
                                  **({'evictionToken':eviction_tokens[sid]} if sid in eviction_tokens else {}),
                                  **({'statusEvidence':'uncertain' if sid in uncertain else 'current'} if shared else {})})
                    if slot is not None and slot<len(snap): snap[slot]=(status,epochs.get(sid,time.time()-10))
                for pid,name,color in db.execute('SELECT id,name,color FROM projects ORDER BY name COLLATE NOCASE'):
                    members=[t for t in tasks if t['project']==pid]
                    projects.append({'id':pid,'name':name,'color':color,'assigned':sum(p[0]==pid for p in prefs),
                                     'active':len(members),'waiting':sum(t['line'] is None for t in members)})
                lines=wall.geometry(config) if kind=='lines' else wall.triangle_geometry(config)
                for line,(project,signature) in zip(lines,prefs):
                    line.update(project=project,signature=signature,task=next((t['id'] for t in tasks if t['line']==line['id']),None))
                control=self.b.control_state(db,device)
                if lines: geometry_error=None
                elif config is self.config: geometry_error='Layout unavailable. Check the light connection; the map will retry.'
                else: geometry_error='Layout unavailable for this device. Enroll it again to save its geometry.'
                result={'settings':wall.settings(db,device),'palette':wall.palette(db),'mode':control['mode'],'pending':wall.pending(db,device),
                        'error':control['error'],'mode_pending':control['revision']!=control['applied'],
                        'device':device,'kind':kind,'devices':self.device_list(registry),
                        'projects':projects,'lines':lines,'tasks':tasks,'now':time.time(),
                        'connector_layout':connectors,
                        'connector_error':None if connectors or kind!='lines' else 'Connector layout unavailable. Showing standard Lines.',
                        'geometry_error':geometry_error}
            if changed: self.launch(self.directory)
            return result

    def rendering(self):
        """Read the output receipt without metadata refresh, device I/O, or migrations."""
        path=(self.directory/'status.sqlite').resolve().as_uri()+'?mode=ro'
        with contextlib.closing(sqlite3.connect(path,uri=True,timeout=.2)) as db:
            db.execute('BEGIN')
            device=devices.device_of(self.config)
            control=self.b.control_state(db,device)
            return wall.rendering_snapshot(db,self.config,control['mode'],
                                           control['revision']!=control['applied'],
                                           control['error'],time.time())

    def update(self,route,payload):
        if not isinstance(payload,dict): raise ValueError('Expected an object.')
        # An action names its device beside its payload; no device means the original Lines device.
        payload=dict(payload); target=payload.pop('device',None)
        with self.lock:
            config=self.device_config(target)
            with contextlib.closing(self.b.connect_state(self.directory)) as db,db:
                db.execute('BEGIN IMMEDIATE')
                apply_operation(db,self.b,config,route,payload)
                import controller_state
                # Shared project colours, task projects and the palette belong to the Lines ledger;
                # everything else advances the ledger of the device the edit names.
                shared=route in ('/api/project','/api/task') or (route=='/api/settings' and 'palette' in payload)
                scoped=route not in ('/api/project','/api/task') and not (route=='/api/settings' and set(payload)<={'palette'})
                for ledger in dict.fromkeys(([devices.DEFAULT] if shared else [])+([devices.device_of(config)] if scoped else [])):
                    controller_state.changed(db,device=ledger)
                self.b.mark_dirty(db)
        self.launch(self.directory)
        return {'ok':True}


def apply_operation(db,b,config,route,payload):
    """Shared wall/machine operation inside the caller's write transaction."""
    if not isinstance(payload,dict): raise ValueError('Expected an object.')
    projects={row[0] for row in db.execute('SELECT id FROM projects')}
    device=devices.device_of(config); kind=config.get('kind','lines')
    ids={element['id'] for element in devices.elements(config)}
    patch={}
    if route=='/api/evict':
        b.shared_input.evict(db,device,payload)
    elif route=='/api/settings':
        checks={'style':('classic','project'),'coverage':('whole','status'),'rotation':(0,90,180,270),'flip_x':(0,1),'flip_y':(0,1)}
        settings={k:v for k,v in payload.items() if k!='palette'}
        if not payload or any(k not in checks or v not in checks[k] for k,v in settings.items()): raise ValueError('Invalid setting.')
        # Animation coverage chooses between a Line's two halves; a one-zone triangle has none.
        if 'coverage' in settings and kind!='lines': raise ValueError('Animation coverage applies to Lines only.')
        # The palette covers every device and moves no comet source, so it applies at once.
        if 'palette' in payload: wall.save_palette(db,wall.validate_palette(payload['palette']))
        if settings: patch={'settings':settings}
    elif route=='/api/assign':
        values=payload.get('lines')
        if not isinstance(values,dict) or not values: raise ValueError('Select at least one Line.')
        for key,value in values.items():
            if key not in ids or not isinstance(value,dict) or not value or set(value)-{'project','signature'}: raise ValueError('Invalid Line assignment.')
            if 'project' in value and value['project'] is not None and value['project'] not in projects: raise ValueError('Unknown project.')
            if 'signature' in value and (type(value['signature']) is not int or value['signature'] not in (0,1)): raise ValueError('Invalid half.')
            if 'signature' in value and kind!='lines': raise ValueError('Half swaps apply to Lines only.')
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
        if b.control_state(db,device)['mode']=='free': raise ValueError('Choose Work or Quiet to locate a Line.')
        db.execute('INSERT OR REPLACE INTO locate (line_id,started,device) VALUES (?,NULL,?)',(payload['line'],device))
    else: raise ValueError('Unknown action.')
    if patch: wall.request_patch(db,patch,config)

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
            parts=urlsplit(self.path); path=parts.path
            try:
                if path=='/':
                    page=Path(__file__).with_name('wall.html').read_text(encoding='utf-8').replace('__CSRF__',token)
                    return self.respond(200,page.encode(),'text/html')
                assets={'/assets/prism.js':'prism.js','/assets/prism-adapters.js':'prism-adapters.js','/assets/prism-labels.js':'prism-labels.js'}
                if path in assets:
                    return self.respond(200,Path(__file__).with_name(assets[path]).read_bytes(),'text/javascript')
                if path=='/api/rendering': return self.respond(200,app.rendering())
                if path=='/api/state':
                    query=parse_qs(parts.query,keep_blank_values=True)
                    try: return self.respond(200,app.state(query['device'][0] if 'device' in query else None))
                    except UnknownDevice: return self.respond(400,{'error':UNKNOWN_DEVICE,'devices':app.device_list()})
                if path=='/health': return self.respond(200,{'service':'codex-nanoleaf-map', 'instance':instance})
                self.respond(404,{'error':'Not found.'})
            except Exception: self.respond(503,{'error':'Local map status unavailable. Retrying shortly.'})
        def do_POST(self):
            origin=f'http://127.0.0.1:{self.server.server_port}'
            if not self.valid_host() or self.headers.get('Origin')!=origin or not secrets.compare_digest(self.headers.get('X-Wall-Token',''),token):
                return self.respond(403,{'error':'Open the wall map through nanoleaf map or its user service.'})
            try:
                length=int(self.headers.get('Content-Length','0'))
                if not 0<length<=65536 or self.headers.get('Content-Type')!='application/json': raise ValueError('Invalid request.')
                payload=json.loads(self.rfile.read(length))
                if self.path=='/api/mode':
                    if not isinstance(payload,dict): raise ValueError('Invalid mode.')
                    payload=dict(payload); target=payload.pop('device',None)
                    if payload.get('mode') not in self.server.app.b.MODES: raise ValueError('Invalid mode.')
                    resolve=getattr(app,'device_config',None)
                    if resolve: device=devices.device_of(resolve(target))
                    elif target is None: device=devices.device_of(getattr(app,'config',None) or {})
                    else: raise UnknownDevice(UNKNOWN_DEVICE)
                    app.b.set_mode(app.directory,payload['mode'],device=device); result={'ok':True}
                else: result=app.update(self.path,payload)
                self.respond(200,result)
            except UnknownDevice:
                devices_list=getattr(app,'device_list',None)
                self.respond(400,{'error':UNKNOWN_DEVICE,**({'devices':devices_list()} if devices_list else {})})
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
        entry=devices.layout_devices(saved).get(devices.device_of(config),{})
        try:
            record=json.loads(path.read_text())
            if not isinstance(record,dict) or record.get('layoutGeneration')!=generation:
                raise ValueError('Drawing cache belongs to an older layout.')
            cache,_=wall.validated_connector_geometry(record.get('geometry'),config['line_groups'])
            cached=True
        except (OSError,ValueError,TypeError,KeyError,OverflowError):
            cached=False
            try:
                cache,_=wall.validated_connector_geometry(entry.get('connector_geometry') or entry.get('zone_geometry'),config['line_groups'])
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
        kwargs={'stdin':subprocess.DEVNULL,'stdout':subprocess.DEVNULL,'stderr':subprocess.DEVNULL,'close_fds':True,'start_new_session':True}
        process=subprocess.Popen([sys.executable,str(Path(b.__file__).resolve()),'serve','--state-dir',str(directory),
                                  '--port',str(port)],**kwargs)
        deadline=time.time()+10
        while not url and time.time()<deadline:
            time.sleep(.2); url=map_url(directory,port)
            if not url and process.poll() is not None: break
    if not url: raise RuntimeError(f'Wall map did not start on port {port}. Check its configuration and whether the port is already in use.')
    print(url)
