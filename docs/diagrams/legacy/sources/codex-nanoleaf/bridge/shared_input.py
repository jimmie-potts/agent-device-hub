"""Nanoleaf presentation of validated shared state; no provider interpretation."""
from pathlib import Path
import sys

PACKAGE = Path(__file__).resolve().parent / 'vendor/agent-state-1.0.0/package'


def validate_snapshot(value):
    # Legacy startup does not need the optional schema dependency.
    location = str(PACKAGE / 'python')
    if location not in sys.path:
        sys.path.insert(0, location)
    from agent_state import validate_snapshot as validate
    return validate(value)

import contextlib
import hashlib
import http.client
import json
import os
import re
import socket
import sqlite3
import stat
import threading
import time
from urllib.parse import urlsplit

MAX_RESPONSE = 16 * 1024 * 1024
TIMEOUT = 2.5
IDENTITY = ('provider', 'client', 'hostId', 'sourceId', 'sessionId')
SOURCE = IDENTITY[:-1]
ID = re.compile(r'[A-Za-z0-9_.-]{1,128}\Z')


class FeedError(ValueError):
    """Fixed codes only, never host error text or response content."""


def dumps(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def decode(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise FeedError('invalid-json')
            result[key] = value
        return result
    try:
        return json.loads(raw, object_pairs_hook=pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(FeedError('invalid-json')))
    except (ValueError, UnicodeError, RecursionError):
        raise FeedError('invalid-json') from None


def identity_key(identity):
    return 'shared-' + hashlib.sha256(dumps([identity[k] for k in IDENTITY]).encode()).hexdigest()


def valid_identity(value, fields=IDENTITY):
    return (type(value) is dict and set(value) == set(fields)
            and all(type(value[k]) is str and ID.fullmatch(value[k]) for k in fields)
            and ((value['provider'] == 'codex' and value['client'] in ('cli', 'desktop'))
                 or (value['provider'] == 'claude' and value['client'] == 'code')))


def validate_config(value):
    try:
        if (type(value) is not dict or set(value) - {'version','ownerId','consumerId','endpoint','tokenFile',
                'controlTokenFile','clearOnNewTurn','qualifiedSources','bindings'}
                or type(value['version']) is not int or value['version'] != 1
                or value['clearOnNewTurn'] is not True
                or any(type(value[k]) is not str or not ID.fullmatch(value[k]) for k in ('ownerId','consumerId'))):
            raise FeedError('invalid-config')
        endpoint = value['endpoint']
        url = urlsplit(endpoint)
        if (type(endpoint) is not str or len(endpoint) > 256 or url.scheme != 'http'
                or url.hostname != '127.0.0.1' or not url.port or url.username or url.password
                or url.query or url.fragment or url.path != '/api/monitor/v1'
                or endpoint != f'http://127.0.0.1:{url.port}/api/monitor/v1'):
            raise FeedError('invalid-config')
        for key in ('tokenFile','controlTokenFile'):
            if key in value and (type(value[key]) is not str or not Path(value[key]).is_absolute()):
                raise FeedError('invalid-config')
        if 'tokenFile' not in value:
            raise FeedError('invalid-config')
        sources = value['qualifiedSources']
        bindings = value.get('bindings', [])
        if (type(sources) is not list or not 1 <= len(sources) <= 128
                or any(not valid_identity(source, SOURCE) for source in sources)
                or len({dumps(source) for source in sources}) != len(sources)
                or type(bindings) is not list or len(bindings) > 128):
            raise FeedError('invalid-config')
        keys, locals_ = set(), set()
        for binding in bindings:
            if (type(binding) is not dict or set(binding) != {'identity','legacySessionId'}
                    or not valid_identity(binding['identity']) or type(binding['legacySessionId']) is not str
                    or not ID.fullmatch(binding['legacySessionId']) or binding['legacySessionId'].startswith('shared-')):
                raise FeedError('invalid-config')
            key = identity_key(binding['identity'])
            if key in keys or binding['legacySessionId'] in locals_:
                raise FeedError('invalid-config')
            keys.add(key); locals_.add(binding['legacySessionId'])
        return decode(dumps(dict(value, bindings=bindings)))
    except (KeyError, TypeError, ValueError, AttributeError):
        raise FeedError('invalid-config') from None


def private_read(path, maximum):
    """Bound regular-file reads; reject symlinks, FIFOs and exposed POSIX secrets."""
    try:
        flags = os.O_RDONLY | getattr(os, 'O_NONBLOCK', 0) | getattr(os, 'O_NOFOLLOW', 0)
        fd = os.open(path, flags)
        with os.fdopen(fd, 'rb') as file:
            info = os.fstat(file.fileno())
            if (not stat.S_ISREG(info.st_mode) or info.st_size > maximum
                    or (os.name != 'nt' and (info.st_mode & 0o077 or info.st_uid != os.getuid()))):
                raise FeedError('private-file-unavailable')
            raw = file.read(maximum + 1)
            if len(raw) > maximum:
                raise FeedError('private-file-unavailable')
            return raw
    except OSError:
        raise FeedError('private-file-unavailable') from None


def request(config, suffix, body=None, control=False):
    config = validate_config(config)
    try:
        token = private_read(config.get('controlTokenFile') if control else config['tokenFile'], 128).decode('ascii').strip() if not control or config.get('controlTokenFile') else None
    except UnicodeError:
        raise FeedError('credential-unavailable') from None
    if not token or not re.fullmatch(r'[A-Za-z0-9_-]{43}', token):
        raise FeedError('credential-unavailable')
    url = urlsplit(config['endpoint'])
    connection = http.client.HTTPConnection('127.0.0.1', url.port, timeout=TIMEOUT)
    expired = threading.Event()
    sockets = []
    def abort():
        expired.set()
        sock = sockets[0] if sockets else connection.sock
        if sock:
            try: sock.shutdown(socket.SHUT_RDWR)
            except OSError: pass
            sock.close()
    timer = threading.Timer(TIMEOUT, abort); timer.daemon = True
    try:
        timer.start()
        connection.connect()
        sockets.append(connection.sock)
        if expired.is_set():
            raise FeedError('feed-unavailable')
        headers = {'Authorization': 'Bearer ' + token, 'X-Pixoo-Request': '1', 'Content-Type':'application/json'}
        connection.request('GET' if body is None else 'POST', url.path + suffix,
                           body=None if body is None else dumps(body).encode(), headers=headers)
        response = connection.getresponse()
        if response.status != 200:
            raise FeedError('feed-rejected')
        if response.getheader('Content-Encoding') not in (None, 'identity'):
            raise FeedError('invalid-feed')
        length = response.getheader('Content-Length')
        if length is not None and (not length.isdecimal() or int(length) > MAX_RESPONSE):
            raise FeedError('feed-limit')
        raw = response.read(MAX_RESPONSE + 1)
        if expired.is_set() or len(raw) > MAX_RESPONSE:
            raise FeedError('feed-limit')
        return decode(raw)
    except FeedError:
        raise
    except (OSError, ValueError, http.client.HTTPException, UnicodeError):
        raise FeedError('feed-unavailable') from None
    finally:
        timer.cancel(); connection.close()


def check_envelope(value, config, minimum_revision=0):
    fields = {'apiVersion','ownerId','connection','snapshot','admissionRejected','nextRequestId'}
    if (type(value) is not dict or set(value) != fields or value['apiVersion'] != '1.0'
            or value['ownerId'] != config['ownerId'] or value['connection'] != 'current'
            or type(value['admissionRejected']) is not int or not 0 <= value['admissionRejected'] <= 9007199254740991
            or type(value['nextRequestId']) is not str or not 1 <= len(value['nextRequestId']) <= 100):
        raise FeedError('invalid-feed')
    checked = validate_snapshot(value['snapshot'])
    if not checked['ok'] or checked['value']['revision'] < minimum_revision:
        raise FeedError('invalid-feed')
    sources = {dumps(source) for source in config['qualifiedSources']}
    if any(dumps({k: session['identity'][k] for k in SOURCE}) not in sources for session in checked['value']['sessions']):
        raise FeedError('unqualified-source')
    return dict(value, snapshot=checked['value'])


def fetch_snapshot(config, minimum_revision=0):
    config = validate_config(config)
    return check_envelope(request(config, '/sessions'), config, minimum_revision)

# All tables are local presentation/configuration, never another agent reducer.
TABLES = ('sessions','slots','waits','activity','receipts','comets','task_info')


def init(db):
    db.execute('CREATE TABLE IF NOT EXISTS shared_input (id INTEGER PRIMARY KEY, source TEXT, generation INTEGER, config TEXT, envelope TEXT, received REAL, connection TEXT, error TEXT, backup TEXT)')
    db.execute("INSERT OR IGNORE INTO shared_input VALUES (1,'legacy',0,NULL,NULL,NULL,'unavailable',NULL,NULL)")
    db.execute('CREATE TABLE IF NOT EXISTS shared_stale (session TEXT PRIMARY KEY)')
    db.execute('CREATE TABLE IF NOT EXISTS shared_suppressed_waves (session TEXT PRIMARY KEY, epoch REAL)')
    db.execute('CREATE TABLE IF NOT EXISTS shared_ack (id INTEGER PRIMARY KEY, payload TEXT, result TEXT)')


def state(db):
    row = db.execute('SELECT source,generation,config,envelope,received,connection,error,backup FROM shared_input WHERE id=1').fetchone()
    value = dict(zip(('source','generation','config','envelope','received','connection','error','backup'), row))
    for key in ('config','envelope','backup'):
        if value[key] is not None: value[key] = decode(value[key])
    return value


def selected(db):
    row = db.execute('SELECT source FROM shared_input WHERE id=1').fetchone()
    return bool(row and row[0] == 'shared')


def configure(directory, bridge, config):
    config = validate_config(config)
    with contextlib.closing(bridge.connect_state(directory)) as db, db:
        db.execute('BEGIN IMMEDIATE')
        if selected(db): raise FeedError('select-legacy-before-configure')
        if db.execute('SELECT 1 FROM shared_ack WHERE result IS NULL').fetchone():
            raise FeedError('acknowledgment-pending-use-explicit-retry')
        db.execute('UPDATE shared_input SET config=?,generation=generation+1,envelope=NULL,received=NULL,connection=\'unavailable\',error=NULL WHERE id=1', (dumps(config),))
        db.execute('DELETE FROM shared_ack')


def source_config(directory, bridge):
    with contextlib.closing(bridge.connect_state(directory)) as db:
        value = state(db)
    if not value['config']: raise FeedError('not-configured')
    return value


def preflight(directory, bridge, fetch=fetch_snapshot):
    value = source_config(directory, bridge)
    minimum = value['envelope']['snapshot']['revision'] if value['envelope'] else 0
    result = check_envelope(fetch(value['config'], minimum_revision=minimum), value['config'], minimum)
    if result['snapshot']['collector'] != 'running': raise FeedError('collector-unavailable')
    return value, result


def _dump_tables(db):
    return {table: [list(row) for row in db.execute('SELECT * FROM ' + table)] for table in TABLES}


def _restore_tables(db, saved):
    for table in TABLES:
        db.execute('DELETE FROM ' + table)
        for row in saved[table]:
            db.execute('INSERT INTO ' + table + ' VALUES (' + ','.join('?' for _ in row) + ')', row)


def _bound_preferences(db, config):
    result = {}
    for binding in config['bindings']:
        key = identity_key(binding['identity'])
        info = db.execute('SELECT project,manual_project FROM task_info WHERE session=?', (key,)).fetchone()
        slot = db.execute('SELECT slot FROM slots WHERE session=?', (key,)).fetchone()
        result[binding['legacySessionId']] = (info, slot)
    return result


def select_source(directory, bridge, source, fetch=fetch_snapshot, now=time.time):
    if source not in ('legacy','shared'): raise FeedError('invalid-source')
    before = source_config(directory, bridge)
    if before['source'] == source: return
    envelope = preflight(directory, bridge, fetch)[1] if source == 'shared' else None
    instant = now()
    with contextlib.closing(bridge.connect_state(directory)) as db, db:
        db.execute('BEGIN IMMEDIATE')
        current = state(db)
        if current['generation'] != before['generation']: raise FeedError('selection-changed')
        if db.execute('SELECT 1 FROM comets WHERE started IS NOT NULL LIMIT 1').fetchone():
            raise FeedError('active-comet')
        config = current['config']
        if source == 'shared':
            saved = _dump_tables(db)
            # Copy only explicitly bound local presentation continuity.
            bindings = {item['legacySessionId']: identity_key(item['identity']) for item in config['bindings']}
            transferred = {table: [] for table in TABLES}
            for table in ('slots','activity','task_info'):
                for row in saved[table]:
                    if row[0] in bindings:
                        transferred[table].append([bindings[row[0]], *row[1:]])
            _restore_tables(db, transferred)
            db.execute('UPDATE shared_input SET backup=?,source=\'shared\',generation=generation+1,envelope=NULL,connection=\'unavailable\' WHERE id=1', (dumps(saved),))
            db.execute('DELETE FROM shared_stale')
            _project(db, bridge, envelope, config, instant, resync=True)
        else:
            prefs = _bound_preferences(db, config)
            _restore_tables(db, current['backup'])
            # Release old slots before applying the complete remap to avoid swaps colliding.
            for session in prefs: db.execute('DELETE FROM slots WHERE session=?', (session,))
            for session, (info, slot) in prefs.items():
                if info: db.execute('UPDATE task_info SET project=?,manual_project=? WHERE session=?', (*info, session))
                if slot:
                    db.execute('DELETE FROM slots WHERE slot=?', slot)
                    db.execute('INSERT INTO slots VALUES (?,?)', (session, slot[0]))
            db.execute('DELETE FROM comets')
            db.execute('DELETE FROM receipts')
            db.execute('DELETE FROM shared_stale')
            db.execute('INSERT INTO shared_stale SELECT id FROM sessions')
            db.execute("UPDATE shared_input SET source='legacy',generation=generation+1,connection='unavailable',error=NULL WHERE id=1")
        db.execute('DELETE FROM shared_suppressed_waves')
        db.execute('DELETE FROM display_v3')
        bridge.mark_dirty(db)


def semantic_status(session, consumer):
    kinds = {attention['kind'] for attention in session['attention']}
    if kinds & {'approval','input'}: return 'blocked'
    if 'question' in kinds: return 'question'
    if session['activity'] == 'active': return 'working'
    if session['read'] != 'read' and any(consumer not in notice['acknowledgedBy'] for notice in session['notices']):
        return 'unread'
    return 'idle'


def _project(db, bridge, envelope, config, instant, resync=False):
    current = state(db)
    previous = current['envelope']
    snapshot = envelope['snapshot']
    prior = {identity_key(s['identity']):s for s in previous['snapshot']['sessions']} if previous else {}
    resync = (resync or not previous or current['connection'] != 'current'
              or snapshot['revision'] > previous['snapshot']['revision'] + 1
              or snapshot['lossCount'] != previous['snapshot']['lossCount']
              or envelope['admissionRejected'] != previous['admissionRejected'])
    if resync:
        db.execute("INSERT OR REPLACE INTO meta VALUES ('shared_wave_cutoff',?)", (str(instant),))
    live = set()
    for session in snapshot['sessions']:
        key = identity_key(session['identity']); live.add(key)
        old = db.execute('SELECT turn,status FROM sessions WHERE id=?', (key,)).fetchone()
        old_activity = db.execute('SELECT turn,status,started FROM activity WHERE session=?', (key,)).fetchone()
        turn = session['turn'].get('id', '')
        status = semantic_status(session, config['consumerId'])
        stale = session['freshness'] != 'current' or snapshot['collector'] != 'running'
        if stale and old:
            turn, status = old
        was_stale = bool(db.execute('SELECT 1 FROM shared_stale WHERE session=?', (key,)).fetchone())
        if stale: db.execute('INSERT OR IGNORE INTO shared_stale VALUES (?)', (key,))
        else: db.execute('DELETE FROM shared_stale WHERE session=?', (key,))
        changed = old != (turn,status)
        if changed:
            db.execute('INSERT OR REPLACE INTO sessions VALUES (?,?,?,?)', (key,turn,status,instant))
            if status in bridge.COLORS:
                # A retained matching phase survives cutover and resync. New resync states
                # use an expired wave epoch; ordinary current transitions get one wave.
                epoch = (old_activity[2] if old_activity and old_activity[:2] == (turn,status)
                         else instant - 10 if resync or stale or was_stale else instant)
                db.execute('INSERT OR REPLACE INTO activity VALUES (?,?,?,?)', (key,turn,status,epoch))
            else: db.execute('DELETE FROM activity WHERE session=?', (key,))
            if (old and old[0] != turn) or session['activity'] in ('active','interrupted'):
                db.execute('DELETE FROM comets WHERE session=?', (key,))
            else:
                db.execute('DELETE FROM comets WHERE session=? AND started IS NULL', (key,))
        if stale or was_stale:
            db.execute('INSERT OR REPLACE INTO shared_suppressed_waves SELECT session,started FROM activity WHERE session=?', (key,))
        if stale or resync or was_stale:
            db.execute('DELETE FROM comets WHERE session=?', (key,))
        elif changed and status == 'unread' and bridge.control_state(db)['mode'] == 'work' and key in prior:
            old_notices = {n['id'] for n in prior[key]['notices']}
            if any(n['id'] not in old_notices and config['consumerId'] not in n['acknowledgedBy'] for n in session['notices']):
                db.execute('INSERT OR IGNORE INTO comets VALUES (?,?,?,NULL,NULL)', (key,turn,instant))
        project = 'shared-project-' + session['projectId'] if session.get('projectId') else None
        if project:
            db.execute('INSERT OR IGNORE INTO projects VALUES (?,?,?,?)', (project,session['projectId'],bridge.wall.default_color(project),'[]'))
        existing = db.execute('SELECT project,manual_project,turn,started FROM task_info WHERE session=?', (key,)).fetchone()
        # Chosen shared project wins over an inherited association; manual preference survives.
        inherited = existing[0] if existing and not project else project
        manual = existing[1] if existing else None
        started = existing[3] if existing and existing[2] == turn else (instant if not resync and turn else None)
        db.execute('INSERT OR REPLACE INTO task_info VALUES (?,?,?,?,?,?,?)',
                   (key,session.get('label',''),'',inherited,manual,turn,started))
    for (key,) in db.execute('SELECT id FROM sessions').fetchall():
        if key not in live:
            for table, column in (('sessions','id'),('activity','session'),('task_info','session'),('comets','session'),('slots','session'),('shared_stale','session'),('shared_suppressed_waves','session')):
                db.execute('DELETE FROM ' + table + ' WHERE ' + column + '=?', (key,))
    db.execute("UPDATE shared_input SET envelope=?,received=?,connection='current',error=NULL WHERE id=1", (dumps(envelope),instant))
    if previous != envelope: bridge.mark_dirty(db)


def accept(directory, bridge, envelope, now=time.time, generation=None, resync=False):
    with contextlib.closing(bridge.connect_state(directory)) as db, db:
        db.execute('BEGIN IMMEDIATE'); current = state(db)
        if current['source'] != 'shared' or generation is not None and current['generation'] != generation:
            return False
        minimum = current['envelope']['snapshot']['revision'] if current['envelope'] else 0
        envelope = check_envelope(envelope, current['config'], minimum)
        _project(db,bridge,envelope,current['config'],now(),resync)
        return True


def failed(directory, bridge, generation, code='feed-unavailable'):
    with contextlib.closing(bridge.connect_state(directory)) as db, db:
        db.execute('BEGIN IMMEDIATE'); current=state(db)
        if current['source'] != 'shared' or current['generation'] != generation: return
        db.execute("UPDATE shared_input SET connection=?,error=? WHERE id=1", ('stale' if current['envelope'] else 'unavailable', code))
        db.execute('INSERT OR IGNORE INTO shared_stale SELECT id FROM sessions')
        db.execute('DELETE FROM comets')
        bridge.mark_dirty(db)


def inspect(directory, now=time.time):
    path = Path(directory) / 'status.sqlite'
    default = {'source':'legacy','configured':False,'connection':'unavailable','ownerId':None,
               'consumerId':None,'revision':None,'receivedAt':None,'error':None,'sessions':[]}
    if not path.exists(): return default
    try:
        with contextlib.closing(sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)) as db:
            db.execute('PRAGMA query_only=ON'); db.execute('BEGIN')
            if not db.execute("SELECT 1 FROM sqlite_master WHERE name='shared_input'").fetchone(): return default
            current=state(db)
            config=current['config']; envelope=current['envelope']; instant=now()
            view=dict(default,source=current['source'],configured=config is not None,connection=current['connection'],error=current['error'])
            if config: view.update(ownerId=config['ownerId'],consumerId=config['consumerId'],clearOnNewTurn=True,readiness='operator-declared')
            if envelope:
                elapsed = instant-current['received']
                disconnected=elapsed < 0 or elapsed > 4 or current['connection'] != 'current'
                if disconnected and current['source']=='shared': view['connection']='stale'
                snap=envelope['snapshot']; view.update(revision=snap['revision'],receivedAt=current['received'],collector=snap['collector'],lossCount=snap['lossCount'])
                for session in snap['sessions']:
                    age=session['observationAgeMs']+max(0,elapsed)*1000
                    view['sessions'].append({'id':identity_key(session['identity']),'identity':session['identity'],
                        'projectId':session.get('projectId'),'read':session['read'],'activity':session['activity'],
                        'attention':session['attention'],'notices':session['notices'],'unavailable':session['unavailable'],
                        'observationAgeMs':age,
                        'freshness':'uncertain' if disconnected or snap['collector'] != 'running' or session['freshness']=='uncertain' or age>=300000 else 'current'})
            return view
    except (sqlite3.Error, ValueError, KeyError, TypeError):
        return dict(default,error='local-state-unavailable')


def render_config(db, config):
    config['_steady_slots'] = [slot for (slot,) in db.execute('SELECT slot FROM slots JOIN shared_stale ON slots.session=shared_stale.session')]
    config['_wave_suppressed_slots'] = [slot for (slot,) in db.execute('SELECT slot FROM slots JOIN shared_suppressed_waves USING (session) JOIN activity USING (session) WHERE epoch=started')]
    row = db.execute("SELECT value FROM meta WHERE key='shared_wave_cutoff'").fetchone()
    if row: config['_wave_cutoff'] = max(config.get('_wave_cutoff',float('-inf')),float(row[0]))


class Poller:
    """One bounded request at a time, owned by the existing worker lock."""
    def __init__(self, directory, bridge):
        self.directory=directory; self.bridge=bridge; self.next_at=0; self.first=True; self.generation=None

    def tick(self, instant):
        with contextlib.closing(self.bridge.connect_state(self.directory)) as db:
            current=state(db)
        if current['source'] != 'shared':
            self.first=True; self.generation=None
            return False
        if self.generation != current['generation']:
            self.first=True;self.next_at=0;self.generation=current['generation']
        if instant < self.next_at: return True
        self.next_at=instant+1
        try:
            minimum=current['envelope']['snapshot']['revision'] if current['envelope'] else 0
            envelope=fetch_snapshot(current['config'],minimum_revision=minimum)
            accept(self.directory,self.bridge,envelope,now=lambda:instant,generation=self.generation,resync=self.first)
            self.first=False
        except FeedError as error:
            failed(self.directory,self.bridge,self.generation,str(error))
            self.first=True
        return True


def acknowledge(directory, bridge, session_key, notice_id, retry=False):
    before=source_config(directory,bridge)
    if before['source'] != 'shared' or not before['config'].get('controlTokenFile'):
        raise FeedError('acknowledgment-unavailable')
    with contextlib.closing(bridge.connect_state(directory)) as db:
        pending=db.execute('SELECT payload,result FROM shared_ack WHERE id=1').fetchone()
    if pending and pending[1] is None:
        body=decode(pending[0])
        if not retry or identity_key(body['identity']) != session_key or body['noticeId'] != notice_id:
            raise FeedError('acknowledgment-pending-use-explicit-retry')
    else:
        if retry: raise FeedError('no-pending-acknowledgment')
        envelope=fetch_snapshot(before['config'],minimum_revision=before['envelope']['snapshot']['revision'])
        session=next((s for s in envelope['snapshot']['sessions'] if identity_key(s['identity'])==session_key),None)
        if not session or not any(n['id']==notice_id for n in session['notices']): raise FeedError('notice-unavailable')
        body={'operation':'acknowledge','requestId':envelope['nextRequestId'],'identity':session['identity'],
              'noticeId':notice_id,'consumerId':before['config']['consumerId']}
        with contextlib.closing(bridge.connect_state(directory)) as db,db:
            db.execute('BEGIN IMMEDIATE')
            if state(db)['generation']!=before['generation']:raise FeedError('selection-changed')
            if db.execute('SELECT 1 FROM shared_ack WHERE result IS NULL').fetchone():raise FeedError('acknowledgment-pending-use-explicit-retry')
            db.execute('INSERT OR REPLACE INTO shared_ack VALUES (1,?,NULL)',(dumps(body),))
    result=request(before['config'],'/commands',body,control=True)
    if not (type(result) is dict and type(result.get('ok')) is bool):raise FeedError('invalid-acknowledgment')
    if result['ok']:
        if (set(result)!={'ok','revision','outcome'} or type(result['revision']) is not int
                or not 0<=result['revision']<=9007199254740991 or result['outcome'] not in ('applied','duplicate','stale','ambiguous')):
            raise FeedError('invalid-acknowledgment')
    elif set(result)!={'ok','code'} or result['code'] not in ('invalid-event','invalid-operation','capacity','unavailable','storage-failed'):
        raise FeedError('invalid-acknowledgment')
    with contextlib.closing(bridge.connect_state(directory)) as db,db:
        db.execute('UPDATE shared_ack SET result=? WHERE payload=?',(dumps(result),dumps(body)))
    return result


def command(argv, bridge):
    import argparse
    parser=argparse.ArgumentParser(description='Select and inspect shared Nanoleaf task input.')
    parser.add_argument('command',choices=('shared-configure','shared-preflight','shared-select','shared-status','shared-acknowledge'))
    parser.add_argument('source',nargs='?',choices=('legacy','shared'))
    parser.add_argument('--state-dir',type=Path)
    parser.add_argument('--config',type=Path)
    parser.add_argument('--session');parser.add_argument('--notice');parser.add_argument('--retry',action='store_true')
    args=parser.parse_args(argv); directory=args.state_dir or bridge.data_dir()
    try:
        if args.command=='shared-status':
            result=inspect(directory)
        elif args.command=='shared-configure':
            if not args.config:raise FeedError('configuration-file-required')
            config=decode(private_read(args.config,65536));configure(directory,bridge,config)
            result=inspect(directory)
        elif args.command=='shared-preflight':
            _,envelope=preflight(directory,bridge)
            result={'feed':'verified','ownerId':envelope['ownerId'],'revision':envelope['snapshot']['revision'],
                    'producerReadiness':'operator-declared','clearOnNewTurn':'operator-declared-true'}
        elif args.command=='shared-select':
            if args.source is None:raise FeedError('source-required')
            select_source(directory,bridge,args.source)
            bridge.launch_worker(directory)
            result=inspect(directory)
        else:
            if not args.session or not args.notice:raise FeedError('notice-required')
            result=acknowledge(directory,bridge,args.session,args.notice,retry=args.retry)
        print(dumps(result))
    except (FeedError,ImportError,OSError,sqlite3.Error,UnicodeError):
        # Fixed output, including configuration paths and dependency failures.
        print(dumps({'error':'shared-input-operation-failed'}))
        raise SystemExit(1)
