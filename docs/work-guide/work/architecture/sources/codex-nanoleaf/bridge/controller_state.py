"""Standard-library controller ledger in the existing Windows-owned database."""
import contextlib
import hashlib
import json
import secrets
import sqlite3
import time

LIMITS = dict(maxPending=32,maxBodyBytes=65536,maxInFlight=32,maxReceipts=256,
              maxEvents=32,maxStreams=16,authenticationTimeoutMs=2000)
CAPABILITIES = {name:{'supported':False} for name in ('power','brightness','media','zones','scenes','preview')}
CAPABILITIES['modes'] = {'supported':True,'values':['Work','Quiet','Free']}
UNKNOWN = {'status':'unknown'}
PENDING_SECONDS = 30


def encoded(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False)


def present(db):
    return bool(db.execute("SELECT 1 FROM sqlite_master WHERE name='controller_meta'").fetchone())


def init(db, identity):
    db.execute('CREATE TABLE IF NOT EXISTS controller_meta (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)')
    db.execute('CREATE TABLE IF NOT EXISTS controller_credentials (principal TEXT PRIMARY KEY, digest TEXT NOT NULL, scopes TEXT NOT NULL, active INTEGER NOT NULL)')
    db.execute('CREATE TABLE IF NOT EXISTS controller_requests (sequence INTEGER PRIMARY KEY, request TEXT NOT NULL, receipt TEXT NOT NULL, principal TEXT NOT NULL, phase TEXT NOT NULL, created REAL NOT NULL, mode_revision INTEGER NOT NULL)')
    db.execute('CREATE TABLE IF NOT EXISTS controller_events (sequence INTEGER PRIMARY KEY, payload TEXT NOT NULL)')
    if not db.execute('SELECT 1 FROM controller_meta').fetchone():
        epoch=secrets.token_hex(16)
        data=dict(identity=dict(identity,controllerEpoch=epoch),epoch=epoch,nextSequence=0,
                  revision=0,generation=0,cursor=0,clockEpoch=secrets.token_hex(16),
                  lastSuccessfulSend=UNKNOWN,lastOutcome=UNKNOWN)
        save(db,data)


def read(db):
    return json.loads(db.execute('SELECT payload FROM controller_meta WHERE id=1').fetchone()[0])


def save(db,data):
    db.execute('INSERT OR REPLACE INTO controller_meta VALUES (1,?)',(encoded(data),))


def clock(data):
    return dict(domain='controller-monotonic',epoch=data['clockEpoch'],sampledAtMs=time.monotonic()*1000)


def ticket(data,sequence):
    return dict(epoch=data['epoch'],sequence=sequence)


def snapshot(db):
    data=read(db)
    mode=db.execute("SELECT value FROM meta WHERE key='mode'").fetchone()
    pending=[]
    for request,receipt in db.execute("SELECT request,receipt FROM controller_requests WHERE phase IN ('queued','attempting') ORDER BY sequence LIMIT 32"):
        request=json.loads(request);receipt=json.loads(receipt)
        pending.append(dict(requestId=request['requestId'],command=request['command'],generation=receipt['generation']))
    return dict(apiVersion='1.0',identity=data['identity'],configurationRevision=data['revision'],
                generation=ticket(data,data['generation']),nextRequestId=ticket(data,data['nextSequence']),
                cursor=ticket(data,data['cursor']),sampleClock=clock(data),serviceHealth='unknown',
                capabilities=CAPABILITIES,limits=LIMITS,
                state=dict(desired=dict(power=UNKNOWN,brightness=UNKNOWN,mode=dict(status='known',value=(mode[0] if mode else 'work').capitalize())),
                           pending=pending,lastSuccessfulSend=data['lastSuccessfulSend'],lastOutcome=data['lastOutcome'],
                           externalControl=UNKNOWN,observation=UNKNOWN))


def event(db):
    data=read(db)
    if data['cursor']>=9007199254740991:raise ValueError('Controller event capacity reached.')
    data['cursor']+=1;save(db,data)
    snap=snapshot(db)
    db.execute('INSERT INTO controller_events VALUES (?,?)',(data['cursor'],encoded(dict(apiVersion='1.0',kind='change',cursor=snap['cursor'],snapshot=snap))))
    db.execute('DELETE FROM controller_events WHERE sequence NOT IN (SELECT sequence FROM controller_events ORDER BY sequence DESC LIMIT 32)')


def finish(db,sequence,outcome,failure=None):
    row=db.execute('SELECT receipt FROM controller_requests WHERE sequence=?',(sequence,)).fetchone()
    if not row:return
    receipt=json.loads(row[0]);receipt['outcome']=outcome
    if failure:receipt['failure']={'code':failure}
    else:receipt.pop('failure',None)
    receipt['priorEffects']='confirmed-transmission' if receipt['completedOperations'] else ('possible' if receipt['uncertainOperations'] else 'none')
    db.execute("UPDATE controller_requests SET receipt=?,phase='done' WHERE sequence=?",(encoded(receipt),sequence))
    data=read(db);data['lastOutcome']={'status':'known','receipt':receipt};save(db,data)
    db.execute("DELETE FROM controller_requests WHERE phase='done' AND sequence NOT IN (SELECT sequence FROM controller_requests WHERE phase='done' ORDER BY sequence DESC LIMIT 256)")
    event(db)


def changed(db, mode=False, native=False):
    """Called inside the owning browser/tray/native desired-state transaction."""
    if not present(db):return
    data=read(db)
    if data['revision']>=9007199254740991 or data['generation']>=9007199254740991:
        raise ValueError('Controller revision capacity reached.')
    if not native:data['revision']+=1
    if mode:data['generation']+=1
    save(db,data)
    if mode:
        db.execute("DELETE FROM meta WHERE key='controller_hold_revision'")
        for sequence, in list(db.execute("SELECT sequence FROM controller_requests WHERE phase IN ('queued','attempting')")):
            finish(db,sequence,'cancelled','stale-generation')
    event(db)


def credential(db, token):
    digest=hashlib.sha256(token.encode()).hexdigest()
    for principal,known,scopes,active in db.execute('SELECT principal,digest,scopes,active FROM controller_credentials'):
        if secrets.compare_digest(digest,known) and active:
            return principal,json.loads(scopes)
    return None


def recover(db,now=None,attempts=False):
    """Only the locked worker may recover attempts; the listener expires unsent work."""
    if not present(db):return
    now=time.time() if now is None else now
    for sequence,phase,created,revision in list(db.execute("SELECT sequence,phase,created,mode_revision FROM controller_requests WHERE phase!='done'")):
        if phase=='attempting' and attempts:
            finish(db,sequence,'uncertain','uncertain-result')
            db.execute("INSERT OR REPLACE INTO meta VALUES ('controller_hold_revision',?)",(str(revision),))
        elif phase=='queued' and now-created>=PENDING_SECONDS:
            finish(db,sequence,'failed','transport-failure')
            db.execute("INSERT OR REPLACE INTO meta VALUES ('controller_hold_revision',?)",(str(revision),))


def held(db,revision):
    row=db.execute("SELECT value FROM meta WHERE key='controller_hold_revision'").fetchone()
    return row==(str(revision),)


class Cancelled(Exception):
    pass


class Execution:
    """Journal each transport operation using the worker's transaction and lock."""
    def __init__(self,db,revision):
        self.db=db;self.revision=revision;self.sequence=None;self.count=0
        if not present(db):return
        row=db.execute("SELECT sequence FROM controller_requests WHERE phase='queued' AND mode_revision=? ORDER BY sequence DESC LIMIT 1",(revision,)).fetchone()
        if row:self.sequence=row[0]

    def current(self):
        row=self.db.execute('SELECT receipt,principal,phase FROM controller_requests WHERE sequence=?',(self.sequence,)).fetchone()
        if not row:return False
        receipt=json.loads(row[0]);data=read(self.db)
        active=self.db.execute('SELECT active FROM controller_credentials WHERE principal=?',(row[1],)).fetchone()
        return row[2]!='done' and active==(1,) and not data.get('stopped') and receipt['generation']==ticket(data,data['generation'])

    def call(self,send,*args,**kwargs):
        db=self.db
        revision=db.execute("SELECT value FROM meta WHERE key='mode_revision'").fetchone()
        if held(db,self.revision) or int(revision[0] if revision else '0')!=self.revision:
            raise Cancelled()
        if self.sequence is None:return send(*args,**kwargs)
        if not self.current():raise Cancelled()
        self.count+=1;operation='transport-'+str(self.count)
        receipt=json.loads(db.execute('SELECT receipt FROM controller_requests WHERE sequence=?',(self.sequence,)).fetchone()[0])
        receipt['uncertainOperations'].append(operation)
        db.execute("UPDATE controller_requests SET phase='attempting',receipt=? WHERE sequence=?",(encoded(receipt),self.sequence))
        db.commit()  # A crash after this point cannot be classified as no effect.
        db.execute('BEGIN IMMEDIATE')
        if not self.current():raise Cancelled()
        try:
            result=send(*args,**kwargs)
        except Exception:
            finish(db,self.sequence,'partially-applied' if receipt['completedOperations'] else 'uncertain','uncertain-result')
            revision=db.execute('SELECT mode_revision FROM controller_requests WHERE sequence=?',(self.sequence,)).fetchone()[0]
            db.execute("INSERT OR REPLACE INTO meta VALUES ('controller_hold_revision',?)",(str(revision),))
            db.commit();db.execute('BEGIN IMMEDIATE')
            raise
        receipt['uncertainOperations'].remove(operation);receipt['completedOperations'].append(operation)
        receipt['priorEffects']='confirmed-transmission'
        db.execute('UPDATE controller_requests SET receipt=? WHERE sequence=?',(encoded(receipt),self.sequence))
        data=read(db);data['lastSuccessfulSend']=dict(status='known',requestId=receipt['requestId'],clock=clock(data),operationIds=receipt['completedOperations']);save(db,data)
        db.commit();db.execute('BEGIN IMMEDIATE')
        return result

    def complete(self):
        if self.sequence is not None and self.current():
            finish(self.db,self.sequence,'sent' if self.count else 'cancelled')


def readonly(directory):
    db=sqlite3.connect((directory/'status.sqlite').resolve().as_uri()+'?mode=ro',uri=True,timeout=.2)
    db.execute('BEGIN')
    return db
