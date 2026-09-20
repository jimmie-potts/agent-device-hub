"""Opt-in native machine API. No device transport and no browser page tokens."""
import contextlib
import errno
import hashlib
import json
import re
import secrets
import sqlite3
import time
import controller_state as state

ID=re.compile(r'[A-Za-z0-9_.-]{1,128}\Z')
HTTP={'invalid-request':400,'unauthenticated':401,'forbidden':403,'unknown-device':404,
      'revision-conflict':409,'stale-generation':409,'request-conflict':409,'request-order':409,
      'request-expired':410,'unsupported-capability':422,'capacity':429,'transport-failure':503}


class ListenerUnavailable(Exception):
    pass


def check_deadline(deadline):
    if deadline is not None and time.monotonic()>=deadline:
        raise TimeoutError('Admission deadline expired.')


@contextlib.contextmanager
def admission_transaction(directory,deadline):
    check_deadline(deadline)
    remaining=2.5 if deadline is None else max(0,deadline-time.monotonic())
    # The configured database already exists. Admission must not run migrations.
    with contextlib.closing(sqlite3.connect((directory/'status.sqlite').resolve().as_uri()+'?mode=rw',uri=True,timeout=remaining)) as db,db:
        db.execute('BEGIN IMMEDIATE')
        check_deadline(deadline)
        yield db
        check_deadline(deadline)
        if deadline is not None:
            db.execute('PRAGMA busy_timeout='+str(max(0,int((deadline-time.monotonic())*1000))))
        # Commit may wait for readers; its busy timeout is the remaining budget.
        db.commit()


def configure(directory,b,controller_id,device_id,source_id):
    if not all(isinstance(v,str) and ID.fullmatch(v) for v in (controller_id,device_id,source_id)):
        raise ValueError('Use neutral controller, device and source IDs.')
    with contextlib.closing(b.connect_state(directory)) as db,db:
        db.execute('BEGIN IMMEDIATE')
        identity=dict(controllerId=controller_id,deviceId=device_id,sourceId=source_id)
        if state.present(db) and any(state.read(db)['identity'][k]!=v for k,v in identity.items()):
            raise ValueError('Existing controller identity cannot be redirected.')
        state.init(db,identity)


def issue(directory,b,principal,scopes):
    if not isinstance(principal,str) or not ID.fullmatch(principal) or not scopes or set(scopes)-{'read','control'}:raise ValueError('Invalid principal or scopes.')
    token=secrets.token_urlsafe(32)
    with contextlib.closing(b.connect_state(directory)) as db,db:
        db.execute('BEGIN IMMEDIATE')
        if not state.present(db):raise ValueError('Configure the controller first.')
        if db.execute('SELECT COUNT(*) FROM controller_credentials').fetchone()[0]>=32 and not db.execute('SELECT 1 FROM controller_credentials WHERE principal=?',(principal,)).fetchone():
            raise ValueError('Credential capacity reached.')
        for sequence,revision in list(db.execute("SELECT sequence,mode_revision FROM controller_requests WHERE principal=? AND phase IN ('queued','attempting')",(principal,))):
            state.finish(db,sequence,'cancelled','forbidden')
            db.execute("INSERT OR REPLACE INTO meta VALUES ('controller_hold_revision',?)",(str(revision),))
        db.execute('INSERT OR REPLACE INTO controller_credentials VALUES (?,?,?,1)',(principal,hashlib.sha256(token.encode()).hexdigest(),state.encoded(scopes)))
    return token


def revoke(directory,b,principal):
    with contextlib.closing(b.connect_state(directory)) as db,db:
        db.execute('BEGIN IMMEDIATE')
        db.execute('UPDATE controller_credentials SET active=0 WHERE principal=?',(principal,))
        for sequence,revision in list(db.execute("SELECT sequence,mode_revision FROM controller_requests WHERE principal=? AND phase IN ('queued','attempting')",(principal,))):
            state.finish(db,sequence,'cancelled','forbidden')
            db.execute("INSERT OR REPLACE INTO meta VALUES ('controller_hold_revision',?)",(str(revision),))


class App:
    def __init__(self,directory,b,launch=None):
        from controller_contract import load
        self.contract=load();self.directory=directory;self.b=b;self.launch=launch or b.launch_worker
        with contextlib.closing(state.readonly(directory)) as db:state.read(db)

    def facts(self,db,token,device=None,scope='read',host=True,origin=True,metadata=True):
        data=state.read(db);identity=data['identity'];found=None if data.get('stopped') else state.credential(db,token)
        return dict(credential=None if not found else dict(kind='machine',status='active',declared=True,devices=[identity['deviceId']],scopes=found[1]),
                    deviceId=device or identity['deviceId'],scope=scope,hostAllowed=host,originPresent=True,originAllowed=origin,fetchMetadataAllowed=metadata)

    def authorize(self,token,device=None,scope='read',**checks):
        with contextlib.closing(state.readonly(self.directory)) as db:
            return self.contract.authorize(self.facts(db,token,device,scope,**checks))['decision']

    def snapshot(self):
        with contextlib.closing(state.readonly(self.directory)) as db:
            snapshot=state.snapshot(db);snapshot['serviceHealth']='ready';return snapshot

    def feed(self,cursor):
        with contextlib.closing(state.readonly(self.directory)) as db:
            events=[json.loads(r[0]) for r in db.execute('SELECT payload FROM controller_events ORDER BY sequence')]
            snapshot=state.snapshot(db);snapshot['serviceHealth']='ready'
            return self.contract.evaluate(dict(operation='feed',cursor=cursor,snapshot=snapshot,events=events))['events']

    def admit(self,token,request,body_bytes=None,deadline=None,**checks):
        launch=False
        with admission_transaction(self.directory,deadline) as db:
            data=state.read(db)
            auth=self.facts(db,token,scope='control',**checks)
            rows=list(db.execute('SELECT request,receipt,phase FROM controller_requests ORDER BY sequence'))
            admission=dict(controllerId=data['identity']['controllerId'],deviceId=data['identity']['deviceId'],epoch=data['epoch'],nextSequence=data['nextSequence'],
                           configurationRevision=data['revision'],generation=state.ticket(data,data['generation']),capabilities=state.CAPABILITIES,
                           maxBodyBytes=65536,maxInFlight=32,maxQueue=32,maxReceipts=256,inFlight=sum(r[2]!='done' for r in rows),queueDepth=sum(r[2]!='done' for r in rows),
                           cache=[dict(request=json.loads(r),receipt=json.loads(v)) for r,v,p in rows if p=='done'],pending=[dict(request=json.loads(r)) for r,v,p in rows if p!='done'])
            result=self.contract.admit(dict(state=admission,auth=auth,request=request,bodyBytes=body_bytes if body_bytes is not None else len(state.encoded(request).encode())))
            decision=result['decision']
            if decision in ('join','replay'):
                receipt=json.loads(db.execute('SELECT receipt FROM controller_requests WHERE sequence=?',(request['requestId']['sequence'],)).fetchone()[0])
                return (202 if receipt['outcome']=='queued' else 200),receipt
            if not result['reserved']:return HTTP.get(decision,400),{'failure':{'code':decision}}
            check_deadline(deadline)
            receipt=result['receipt'];sequence=request['requestId']['sequence']
            data['nextSequence']=result['nextSequence'];data['revision']=receipt['configurationRevision'];state.save(db,data)
            control=self.b.control_state(db)
            if result['scheduled']:
                # A policy generation is distinct from the request's optimistic expectation.
                state.changed(db,mode=True,native=True)
                data=state.read(db);receipt['generation']=state.ticket(data,data['generation'])
                self.b.change_mode(db,request['command']['mode'].lower(),time.time(),notify=False)
                control=self.b.control_state(db)
                launch=True
            principal=state.credential(db,token)[0]
            db.execute('INSERT INTO controller_requests VALUES (?,?,?,?,?,?,?)',(sequence,state.encoded(request),state.encoded(receipt),principal,'queued' if launch else 'done',time.time(),control['revision']))
            if not launch:state.finish(db,sequence,'failed',decision)
            elif control['revision']==control['applied'] and not control['error']:
                state.finish(db,sequence,'cancelled');launch=False
                receipt=json.loads(db.execute('SELECT receipt FROM controller_requests WHERE sequence=?',(sequence,)).fetchone()[0])
            else:state.event(db)
        if launch:
            try:self.launch(self.directory)
            except Exception:
                with contextlib.closing(self.b.connect_state(self.directory)) as db,db:
                    db.execute('BEGIN IMMEDIATE');state.finish(db,sequence,'failed','transport-failure')
                    db.execute("INSERT OR REPLACE INTO meta VALUES ('controller_hold_revision',?)",(str(control['revision']),))
                    receipt=json.loads(db.execute('SELECT receipt FROM controller_requests WHERE sequence=?',(sequence,)).fetchone()[0])
                return 503,receipt
        return (202 if launch else HTTP.get(decision,200)),receipt


def strict_json(body):
    def pairs(items):
        result={}
        for key,value in items:
            if key in result:raise ValueError('Duplicate key.')
            result[key]=value
        return result
    def constant(_):raise ValueError('Non-finite number.')
    return json.loads(body,object_pairs_hook=pairs,parse_constant=constant)


def make_server(app,port=0):
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    import socket
    import threading
    from urllib.parse import parse_qs, urlsplit

    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass

        def setup(self):
            super().setup();self.connection.settimeout(2)
            self.admission_deadline=time.monotonic()+5
            self.deadline=threading.Timer(5,self.expire);self.deadline.daemon=True;self.deadline.start()

        def expire(self):
            try:self.connection.shutdown(socket.SHUT_RDWR)
            except OSError:pass

        def finish(self):
            self.deadline.cancel()
            try:super().finish()
            except OSError:pass

        def respond(self,code,value):
            if time.monotonic()>=self.admission_deadline:
                self.close_connection=True
                return
            raw=state.encoded(value).encode()
            self.send_response(code);self.send_header('Content-Type','application/json')
            self.send_header('Content-Length',str(len(raw)));self.send_header('Cache-Control','no-store')
            self.send_header('X-Content-Type-Options','nosniff');self.send_header('Connection','close');self.end_headers()
            self.wfile.write(raw);self.close_connection=True

        def failure(self,code):self.respond(HTTP.get(code,503),{'failure':{'code':code}})

        def checks(self):
            origin=f'http://127.0.0.1:{self.server.server_port}'
            return dict(host=self.headers.get_all('Host')==[f'127.0.0.1:{self.server.server_port}'],
                        origin=self.headers.get('Origin') in (None,origin) and len(self.headers.get_all('Origin',[]))<=1,
                        metadata=self.headers.get('Sec-Fetch-Site') in (None,'none','same-origin'))

        def dispatch(self,write=False):
            try:
                authorization=self.headers.get_all('Authorization',[])
                token=authorization[0][7:] if len(authorization)==1 and authorization[0].startswith('Bearer ') and len(authorization[0])<=256 else ''
                checks=self.checks()
                permitted=app.authorize(token,scope='control' if write else 'read',**checks)
                if permitted!='allowed':return self.failure(permitted)
                parts=urlsplit(self.path)
                if parts.scheme or parts.netloc or parts.fragment or len(self.path)>1024:raise ValueError('Invalid target.')
                query=parse_qs(parts.query,keep_blank_values=True,strict_parsing=True,max_num_fields=3)
                if any(len(v)!=1 for v in query.values()):raise ValueError('Repeated query.')
                query={k:v[0] for k,v in query.items()}
                if write:
                    if parts.path!='/controller/v1/commands' or query:return self.respond(404,{'failure':{'code':'invalid-request'}})
                    lengths=self.headers.get_all('Content-Length',[])
                    if len(lengths)!=1 or not re.fullmatch(r'[0-9]{1,8}',lengths[0]) or self.headers.get_all('Transfer-Encoding'):raise ValueError('Invalid framing.')
                    length=int(lengths[0])
                    if length>state.LIMITS['maxBodyBytes']:return self.failure('capacity')
                    if length==0 or self.headers.get_all('Content-Type')!=['application/json']:raise ValueError('Invalid content type.')
                    raw=self.rfile.read(length)
                    if len(raw)!=length:raise ValueError('Incomplete body.')
                    body=strict_json(raw)
                    code,result=app.admit(token,body,length,deadline=self.admission_deadline,**checks)
                    return self.respond(code,result)
                if parts.path=='/controller/v1/devices' and not query:
                    return self.respond(200,dict(apiVersion='1.0',devices=[app.snapshot()]))
                device=query.get('deviceId')
                if device is None:raise ValueError('Explicit target required.')
                permitted=app.authorize(token,device,**checks)
                if permitted!='allowed':return self.failure(permitted)
                if parts.path=='/controller/v1/snapshot' and set(query)=={'deviceId'}:
                    return self.respond(200,app.snapshot())
                if parts.path=='/controller/v1/feed' and set(query)<= {'deviceId','epoch','sequence'}:
                    if not self.server.feed_slots.acquire(False):return self.failure('capacity')
                    try:
                        cursor=None
                        if 'epoch' in query and 'sequence' in query:
                            try:cursor=dict(epoch=query['epoch'],sequence=int(query['sequence']))
                            except ValueError:pass
                        return self.respond(200,app.feed(cursor))
                    finally:self.server.feed_slots.release()
                return self.respond(404,{'failure':{'code':'invalid-request'}})
            except (ValueError,TypeError,KeyError,RecursionError,UnicodeError):self.failure('invalid-request')
            except (BrokenPipeError,ConnectionError,TimeoutError):pass
            except Exception:self.failure('transport-failure')

        def do_GET(self):self.dispatch()
        def do_POST(self):self.dispatch(True)

    class Server(ThreadingHTTPServer):
        daemon_threads=True
        def __init__(self):
            self.slots=threading.BoundedSemaphore(32);self.feed_slots=threading.BoundedSemaphore(16)
            super().__init__(('127.0.0.1',port),Handler)
        def process_request(self,request,address):
            if not self.slots.acquire(False):
                try:
                    request.settimeout(.1)
                    request.sendall(b'HTTP/1.0 429 Too Many Requests\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
                    request.shutdown(socket.SHUT_WR)
                    # Closing with unread bytes can discard the response on Windows.
                    deadline=time.monotonic()+.1;remaining=65536
                    while remaining and time.monotonic()<deadline:
                        request.settimeout(max(.001,deadline-time.monotonic()))
                        chunk=request.recv(min(4096,remaining))
                        if not chunk:break
                        remaining-=len(chunk)
                except OSError:pass
                finally:self.shutdown_request(request)
                return
            try:super().process_request(request,address)
            except BaseException:self.slots.release();raise
        def process_request_thread(self,request,address):
            try:super().process_request_thread(request,address)
            finally:self.slots.release()
    return Server()


def serve(directory,b,port=0):
    import sqlite3
    with contextlib.closing(sqlite3.connect(directory/'controller-lock.sqlite',timeout=0)) as guard:
        try:guard.execute('BEGIN EXCLUSIVE')
        except sqlite3.OperationalError as error:
            if getattr(error,'sqlite_errorcode',None)==sqlite3.SQLITE_BUSY:
                raise ListenerUnavailable('A controller is already running for this installation.') from None
            raise
        app=App(directory,b)
        with contextlib.closing(b.connect_state(directory)) as db,db:
            db.execute('BEGIN IMMEDIATE');data=state.read(db);data['clockEpoch']=secrets.token_hex(16);data['stopped']=False;state.save(db,data);state.event(db)
        try:server=make_server(app,port)
        except OSError as error:
            if error.errno==errno.EADDRINUSE:
                raise ListenerUnavailable(f'Port {port} is already in use. Stop its owner or choose another controller port.') from None
            raise ListenerUnavailable(f'Cannot bind the controller to 127.0.0.1:{port}.') from None
        b.write_json(directory/'controller-server.json',dict(apiVersion='1.0',port=server.server_port))
        import threading
        stopping=threading.Event()
        def maintain():
            # Deadline recovery is clock-driven, never a consequence of a read route.
            while not stopping.wait(.5):
                try:
                    with contextlib.closing(b.connect_state(directory)) as db,db:
                        db.execute('BEGIN IMMEDIATE');state.recover(db)
                        disabled=state.read(db).get('stopped')
                    if disabled:
                        server.shutdown();return
                except sqlite3.OperationalError as error:
                    code=getattr(error,'sqlite_errorcode',None)
                    if code is not None and code & 255 in (sqlite3.SQLITE_BUSY,sqlite3.SQLITE_LOCKED):
                        continue  # Retry after the regular bounded wait; a local writer may hold the database.
                    server.shutdown();return
                except Exception:
                    server.shutdown();return
        watchdog=threading.Thread(target=maintain,daemon=True);watchdog.start()
        try:server.serve_forever(poll_interval=.2)
        finally:
            stopping.set();watchdog.join(3);server.server_close()


def command(argv,b):
    import argparse
    from pathlib import Path
    parser=argparse.ArgumentParser(description='Opt-in local controller API; state stays private to its installation.')
    parser.add_argument('action',choices=('controller-configure','controller-token','controller-revoke','controller-serve','controller-status','controller-disable'))
    parser.add_argument('--state-dir',type=Path,default=b.data_dir(),help=argparse.SUPPRESS)
    parser.add_argument('--controller-id');parser.add_argument('--device-id');parser.add_argument('--source-id')
    parser.add_argument('--principal');parser.add_argument('--read-only',action='store_true');parser.add_argument('--port',type=int,default=0)
    args=parser.parse_args(argv);directory=args.state_dir
    try:
        if args.action=='controller-configure':
            directory.mkdir(parents=True,exist_ok=True)
            configure(directory,b,args.controller_id,args.device_id,args.source_id)
        elif args.action=='controller-token':print(issue(directory,b,args.principal,['read'] if args.read_only else ['read','control']))
        elif args.action=='controller-revoke':revoke(directory,b,args.principal)
        elif args.action=='controller-serve':
            if not 0<=args.port<=65535:raise ValueError('Invalid loopback port.')
            serve(directory,b,args.port)
        elif args.action=='controller-status':
            with contextlib.closing(state.readonly(directory)) as db:print(state.encoded(state.snapshot(db)))
        elif args.action=='controller-disable':
            with contextlib.closing(b.connect_state(directory)) as db,db:
                db.execute('BEGIN IMMEDIATE');data=state.read(db);data['stopped']=True;state.save(db,data)
                for sequence,revision in list(db.execute("SELECT sequence,mode_revision FROM controller_requests WHERE phase IN ('queued','attempting')")):
                    state.finish(db,sequence,'cancelled','forbidden')
                    db.execute("INSERT OR REPLACE INTO meta VALUES ('controller_hold_revision',?)",(str(revision),))
    except ListenerUnavailable as error:
        parser.exit(1,f'Controller: {error}\n')
    except Exception:
        parser.exit(1,'Controller command failed. Check local configuration and optional dependencies.\n')
