"""Record the Python Nanoleaf bridge's outputs that the TypeScript port is compared with (Hub #26).

Run from the repository root with a read-only codex-nanoleaf checkout at the provenance commit in PORTING.md. The
released agent-state owner runs under Node 24:

    PYTHONDONTWRITEBYTECODE=1 fnm exec --using=.nvmrc -- python3 modules/nanoleaf/tests/fixtures/record.py <codex-nanoleaf>

It writes recorded/*.json beside this file. Every input is synthetic; nothing contacts a device or the Hub.
"""
import contextlib
import copy
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import random
import subprocess
import sys
import tarfile
import tempfile

SOURCE = Path(sys.argv[1]).resolve()
OUTPUT = Path(__file__).resolve().parent / 'recorded'
sys.dont_write_bytecode = True
sys.path.insert(0, str(SOURCE / 'bridge'))
spec = importlib.util.spec_from_file_location('bridge', SOURCE / 'bridge/bridge.py')
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)
import codex_hooks  # noqa: E402
import database  # noqa: E402
import devices  # noqa: E402
import jsonfile  # noqa: E402
import modes  # noqa: E402
import project_map as wall  # noqa: E402
import shared_input  # noqa: E402
import shared_source  # noqa: E402
import store  # noqa: E402

CORPUS = SOURCE / 'bridge/vendor/agent-state-3.3.0/package/fixtures/snapshots-v1.json'


def write(name, value):
    OUTPUT.mkdir(exist_ok=True)
    (OUTPUT / name).write_text(json.dumps(value, indent=1, sort_keys=True) + '\n')


def write_trace(traces):
    """trace.json with each trace field, session, starting table and step on its own line, so a re-recording diffs
    line by line without the size of fully indented JSON."""
    def line(value):
        return json.dumps(value, sort_keys=True, separators=(',', ':'))

    def members(pairs, close):
        return [text + (',' if index < len(pairs) - 1 else '') for index, text in enumerate(pairs)] + [close]

    out = ['[']
    for t_index, record in enumerate(traces):
        fields = []
        for key in sorted(record):
            value = record[key]
            if key in ('sessions', 'start'):
                fields.append([json.dumps(key) + ':{'] + members([json.dumps(k) + ':' + line(v) for k, v in sorted(value.items())], '}'))
            elif key == 'steps':
                fields.append([json.dumps(key) + ':['] + members([line(step) for step in value], ']'))
            else:
                fields.append([json.dumps(key) + ':' + line(value)])
        out.append('{')
        for f_index, lines in enumerate(fields):
            out.extend(lines[:-1] + [lines[-1] + (',' if f_index < len(fields) - 1 else '')])
        out.append('}' + (',' if t_index < len(traces) - 1 else ''))
    out.append(']')
    OUTPUT.mkdir(exist_ok=True)
    (OUTPUT / 'trace.json').write_text('\n'.join(out) + '\n')


def dump(directory):
    """Every row of every table, in rowid order, with its column names."""
    with contextlib.closing(database.connect_state(directory)) as db:
        names = [n for (n,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
        return {name: {'columns': [row[1] for row in db.execute(f'PRAGMA table_info("{name}")')],
                       'rows': [list(row) for row in db.execute(f'SELECT * FROM "{name}" ORDER BY rowid')]} for name in names}


def fixture():
    corpus = json.loads(CORPUS.read_text())
    snapshot = copy.deepcopy(corpus['cases'][0]['input'])
    snapshot['apiVersion'] = '1.1'
    for session in snapshot['sessions']:
        session['generation'] = 0
    return snapshot


def values():
    identities = [fixture()['sessions'][0]['identity'],
                  {'provider': 'claude', 'client': 'code', 'hostId': 'host', 'sourceId': 'claude-source', 'sessionId': 'claude-1'},
                  {'provider': 'codex', 'client': 'cli', 'hostId': 'h.1', 'sourceId': 's_2', 'sessionId': '019a1234-0000-7000-8000-00005b1e07c2'}]
    projects = ['a', 'b', 'local', 'nested', 'project', 'chosen', 'shared-project-hub', 'shared-project-chosen',
                'shared-project-name:' + hashlib.sha256('Shared workspace'.encode()).hexdigest(), 'p', 'q', 'Ünïcode', '😀x', '']
    titles = [('codex', '019a1234-0000-7000-8000-00005b1e07c2'), ('codex', '019a1234-0000-7000-8000-00004227761b'),
              ('claude', 'claude-1'), ('claude', 'zzzz'), ('codex', 'legacy'), ('other', 'xyz'), ('multi word', 'ABCDEF0123'), ('codex', '')]
    paths = ['/repo/nested/src', '/mnt/c/repo/b/subdir', 'C:\\Repo\\B', '\\\\wsl.localhost\\Ubuntu\\home\\tester\\projects\\a',
             '\\\\wsl$\\Ubuntu\\mnt\\c\\REPO\\b\\..\\b', '//wsl$/x', '/a/./b/../c/', '//two/slashes', '///three', 'relative/../..', '',
             'a/b/', '/mnt/c', '/mnt/C/Users/X', 'D:/x/y/', '..', '.', None, 5]
    current = {'config': {'ownerId': 'owner'}, 'generation': 3}
    session = fixture()['sessions'][0]
    floats = [1000.0, 1000.5, 990.0, 0.1, 1e-05, 0.0001, 1e16, 123456789.125, 1759700000.123456, -2.5, 1e22]
    rounding = [0.5, 1.5, 2.5, 3.5, 241.5, 242.5, 2.4999999999999996, 7.5000000000000001]
    roots = [[], ['/repo'], ['/repo', '/other'], ['Ünïcode/😀', 'tab\tquote"']]
    write('values.json', {
        'identityKeys': [[identity, shared_input.identity_key(identity)] for identity in identities],
        'evictionToken': {'current': current, 'session': session, 'token': shared_input.eviction_token(current, session)},
        'defaultColors': [[project, wall.default_color(project)] for project in projects],
        'fallbackTitles': [[provider, sid, wall.fallback_title(provider, sid)] for provider, sid in titles],
        'normalized': [[path, wall.normalize(path)] for path in paths],
        'floatText': [[value, str(value)] for value in floats],
        'rounded': [[value, round(value)] for value in rounding],
        'pyMod': [[a, m, a % m] for a, m in ((-0.25, 1.0), (-1e-20, 1.0), (5.5, -2.0), (-0.0, 1.0), (3.0, 1.0), (-3.0, 1.0),
                                             (725.5, 360.0), (-90.0, 360.0), (-179.99999999999997, 360.0), (0.0, -1.0), (7, 3), (-7, 3))],
        'pyJson': [[value, json.dumps(value)] for value in roots],
        'dumps': [[value, shared_input.dumps(value)] for value in roots + [{'b': 1, 'a': [True, None, 'é']}]],
        'privateAddress': [[ip, ok] for ip, ok in ((ip, private(ip)) for ip in
            ('192.0.2.1', '10.1.2.3', '172.31.255.255', '172.32.0.1', '192.168.1.207', '8.8.8.8', '127.0.0.1', '169.254.1.1',
             '100.64.0.1', '192.0.0.9', '192.0.0.8', '198.18.0.1', '203.0.113.9', '240.0.0.1', '255.255.255.255', '0.0.0.0',
             '01.2.3.4', '1.2.3', '256.1.1.1', 'fd00::1', '::1', 'not-an-ip', ' 10.0.0.1'))],
    })


def private(ip):
    import enrollment
    try:
        return enrollment.private_address(ip)
    except ValueError as error:
        return 'error: ' + str(error)


def selection_setup(path):
    """SelectionTest.setUp in test_shared_input.py, before shared_source.configure."""
    b.handle_event(path, {'session_id': 'legacy', 'turn_id': 'turn', 'hook_event_name': 'UserPromptSubmit'}, launch=lambda _: None,
                   now=lambda: 1000.0)
    with contextlib.closing(database.connect_state(path)) as db, db:
        db.execute("INSERT INTO slots (session, slot) VALUES ('legacy',0)")
        db.execute("INSERT INTO projects VALUES ('project','LOCAL TITLE','#112233','[]')")
        db.execute("UPDATE task_info SET project='project',manual_project='project' WHERE session='legacy'")


def setups():
    recorded = {}
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        prompt = root / 'prompt'; prompt.mkdir()
        b.handle_event(prompt, {'session_id': 'a', 'turn_id': '1', 'hook_event_name': 'UserPromptSubmit'}, launch=lambda _: None,
                       now=lambda: 1000.0)
        recorded['legacyPrompt'] = dump(prompt)
        selection = root / 'selection'; selection.mkdir()
        selection_setup(selection)
        recorded['selection'] = dump(selection)
        backup = root / 'backup'; backup.mkdir()
        selection_setup(backup)
        # TaskBackupTest.setUp additions.
        jsonfile.write_json(backup / 'config.json', {'ip': '192.0.2.1', 'token': 'fake', 'panelsToken': 'other', 'devices': {
            'panels': {'kind': 'panels', 'ip': '192.0.2.2', 'token_ref': 'panelsToken'}}})
        def event(session, name, **extra):
            b.handle_event(backup, {'session_id': session, 'turn_id': 't1', 'hook_event_name': name, **extra},
                           launch=lambda _: None, now=lambda: 1000.0 + len(session))
        event('other', 'UserPromptSubmit'); event('other', 'PermissionRequest', tool_name='shell')
        event('done', 'UserPromptSubmit'); event('done', 'Stop')
        modes.set_mode(backup, 'quiet', launch=lambda _: None, device='panels', now=lambda: 1000.0)
        with contextlib.closing(database.connect_state(backup)) as db, db:
            db.executemany('INSERT INTO slots (session,slot,device) VALUES (?,?,?)',
                           [('legacy', 4, 'panels'), ('other', 1, 'wall'), ('other', 0, 'panels'), ('done', 2, 'wall')])
            db.execute("INSERT INTO projects VALUES ('chosen','Chosen','#445566','[]')")
            db.execute("INSERT INTO line_prefs (line_id,project,signature,device) VALUES ('100:101','project',1,'wall')")
            db.execute("INSERT INTO comets (session,turn,queued,source,started,device) VALUES ('done','t1',1010,NULL,NULL,'panels')")
        recorded['taskBackup'] = dump(backup)
        enrolled = root / 'enrollment'; enrolled.mkdir()
        # EnrollmentTest.setUp without the controller ledger, which is not ported.
        for session in ('a', 'b'):
            b.handle_event(enrolled, {'hook_event_name': 'UserPromptSubmit', 'session_id': session, 'turn_id': '1'},
                           launch=lambda _: None, now=lambda: 1000.0)
        with contextlib.closing(database.connect_state(enrolled)) as db, db:
            db.execute("INSERT INTO line_prefs (line_id, project, signature, device) VALUES ('100:101', 'alpha', 1, 'wall')")
        modes.set_mode(enrolled, 'quiet', launch=lambda _: None, now=lambda: 1000.0)
        recorded['enrollment'] = dump(enrolled)
        modes.set_mode(enrolled, 'quiet', launch=lambda _: None, now=lambda: 1000.0, device='panels')
        modes.set_mode(enrolled, 'work', launch=lambda _: None, now=lambda: 1001.0, device='panels')
        modes.set_mode(enrolled, 'free', launch=lambda _: None, now=lambda: 1002.0, device='panels')
        recorded['enrollmentModes'] = {'meta': dump(enrolled)['meta']}
    write('setups.json', recorded)


def owner_snapshot():
    """ReleaseTest.test_released_owner_clears_only_nanoleaf_on_evidenced_new_turn: the released owner's snapshot."""
    with tempfile.TemporaryDirectory() as temporary:
        archive = SOURCE / 'bridge/vendor/agent-state-3.3.0/jimmie-potts-agent-state-3.3.0.tgz'
        with tarfile.open(archive) as tar:
            tar.extractall(temporary, filter='data')
        module = (Path(temporary) / 'package/dist/index.js').as_uri()
        program = '''
import {createAgentState,MemoryStorage} from MODULE;
const owner=await createAgentState({storage:new MemoryStorage(),ownerId:'owner',consumers:[{id:'nanoleaf',clearOnNewTurn:true},{id:'pixoo',clearOnNewTurn:false}],clock:()=>1000});
const identity={provider:'codex',client:'desktop',hostId:'host',sourceId:'source',sessionId:'session'};
let sequence=0;
for(const [kind,turn] of [['turn.started','one'],['turn.ended','one'],['turn.started','two']]) {
 const result=await owner.ingest({apiVersion:'1.0',identity,turn:{status:'known',id:turn},parent:{status:'unknown'},event:{kind},observedAtMs:1000,ordering:{status:'known',epoch:'epoch',sequence:++sequence}});
 if(!result.ok)throw Error('ingestion failed');
}
console.log(JSON.stringify(owner.snapshot()));await owner.shutdown();
'''.replace('MODULE', json.dumps(module))
        result = subprocess.run(['node', '--input-type=module', '-e', program], cwd=temporary, capture_output=True, text=True,
                                timeout=15, check=True)
        snapshot = json.loads(result.stdout)
        assert shared_input.validate_snapshot(snapshot)['ok']
        session = snapshot['sessions'][0]
        write('owner-snapshot.json', {'snapshot': snapshot, 'status': shared_input.semantic_status(session, 'nanoleaf')})


# The differential trace: random snapshot sequences through the Python projection, with every saved row after each step.

ROOTS = [('codex', 'desktop', 'source', 'r1'), ('codex', 'desktop', 'source', 'r2'), ('codex', 'desktop', 'source', 'r3'),
         ('claude', 'code', 'claude-source', 'c1'), ('codex', 'cli', 'cli-source', 'u1')]
CHILDREN = [('k1', 'r1'), ('k2', 'k1'), ('k3', 'r2'), ('o1', 'gone'), ('m1', 'c1')]
LAYOUTS = {
    'wall': {'device': 'wall', 'line_groups': [[100, 101], [102, 103], [104, 105]], 'line_positions': [[0, 0], [10, 0], [20, 0]]},
    'panels': {'device': 'panels', 'kind': 'panels', 'line_groups': [[1], [2], [3], [4]],
               'elements': [{'id': str(i), 'number': i, 'zones': [i], 'position': [i * 10, 0]} for i in range(1, 5)]},
}
TRACE_TABLES = ('sessions', 'activity', 'task_info', 'slots', 'comets', 'waits', 'receipts', 'shared_stale', 'shared_suppressed_waves',
                'shared_evictions', 'projects', 'line_prefs', 'map_settings', 'meta', 'display_v3')


def identity_of(name):
    for provider, client, source, session in ROOTS:
        if session == name:
            return {'provider': provider, 'client': client, 'hostId': 'host', 'sourceId': source, 'sessionId': session}
    parent = dict(CHILDREN).get(name)
    base = identity_of(parent) if parent in dict(CHILDREN) or parent in [r[3] for r in ROOTS] else identity_of('r1')
    return dict(base, sessionId=name)


class World:
    def __init__(self, rng):
        self.rng = rng
        self.revision = 1
        self.loss = 0
        self.rejected = 0
        self.notice = 0
        self.sessions = {}
        for name in [r[3] for r in ROOTS] + [c[0] for c in CHILDREN]:
            self.sessions[name] = self.fresh(name)

    def fresh(self, name):
        rng = self.rng
        child = name in dict(CHILDREN)
        session = {'identity': identity_of(name), 'turn': {'status': 'unknown'} if child else {'status': 'known', 'id': 't0'},
                   'parent': {'status': 'unknown'}, 'activity': 'idle', 'attention': [], 'notices': [], 'read': 'unknown',
                   'unavailable': [], 'ordering': {'status': 'unknown'}, 'lastEvidenceAtMs': 1000, 'observedAtMs': 1000,
                   'observationAgeMs': 0, 'freshness': 'current', 'restartUncertain': False, 'children': {'active': 0, 'uncertain': 0},
                   'generation': 0, 'present': rng.random() < 0.7}
        if child:
            parent = dict(CHILDREN)[name]
            session['parent'] = {'status': 'known', 'identity': identity_of(parent) if parent != 'gone' else dict(identity_of('r1'), sessionId='gone')}
        return session

    def mutate(self):
        """Change one to three sessions, as an owner's next revision usually does."""
        rng = self.rng
        roots = [r[3] for r in ROOTS]
        # Sorted, so the run does not depend on Python's string hash seed.
        for name in sorted({rng.choice(roots) if rng.random() < 0.7 else rng.choice(sorted(self.sessions)) for _ in range(rng.randint(1, 3))}):
            session = self.sessions[name]
            if rng.random() < 0.06:
                session['present'] = not session['present']
            if rng.random() < 0.05:
                kept = session['present']
                self.sessions[name] = session = self.fresh(name)
                session['present'] = kept
                session['generation'] = self.revision + 1
            if session['turn']['status'] == 'known' and rng.random() < 0.35:
                # A turn starts, or the running one completes with a fresh notice, as most owner revisions do.
                if session['activity'] == 'active':
                    self.notice += 1
                    session['activity'] = 'idle'
                    session['attention'] = []
                    session['notices'] = (session['notices'] + [{'id': hashlib.sha256(str(self.notice).encode()).hexdigest(),
                                           'kind': 'turn-ended', 'turn': session['turn'], 'acknowledgedBy': ['pixoo']}])[-3:]
                else:
                    session['activity'] = 'active'
                    session['turn'] = {'status': 'known', 'id': 't%d' % rng.randint(0, 9)}
                continue
            if rng.random() < 0.3:
                session['activity'] = rng.choice(['active', 'idle', 'idle', 'interrupted', 'unknown'])
            if rng.random() < 0.12:
                kinds = rng.sample(['approval', 'input', 'question'], rng.randint(0, 2))
                session['attention'] = [{'id': rng.choice([{'status': 'unknown'}, {'status': 'known', 'id': 'ask'}]), 'kind': kind,
                                         'turn': session['turn']} for kind in kinds]
            if rng.random() < 0.15 and session['turn']['status'] == 'known':
                session['turn'] = {'status': 'known', 'id': 't%d' % rng.randint(0, 5)}
            if rng.random() < 0.2:
                self.notice += 1
                session['notices'].append({'id': hashlib.sha256(str(self.notice).encode()).hexdigest(), 'kind': 'turn-ended',
                                           'turn': session['turn'], 'acknowledgedBy': rng.choice([[], ['pixoo'], ['nanoleaf']])})
                session['notices'] = session['notices'][-3:]
            if rng.random() < 0.15 and session['notices']:
                notice = rng.choice(session['notices'])
                if 'nanoleaf' not in notice['acknowledgedBy']:
                    notice['acknowledgedBy'] = notice['acknowledgedBy'] + ['nanoleaf']
            if rng.random() < 0.15:
                session['read'] = rng.choice(['unknown', 'read', 'unread'])
            if rng.random() < 0.15:
                stale = rng.random() < 0.5
                session['freshness'] = 'uncertain' if stale else 'current'
                session['restartUncertain'] = stale
            if rng.random() < 0.1:
                session['unavailable'] = rng.choice([[], [{'kind': 'evidence.unavailable', 'dimension': 'parent', 'reason': 'ambiguous'}],
                                                     [{'kind': 'evidence.unavailable', 'dimension': 'turn', 'reason': 'missing'}]])
            if rng.random() < 0.1:
                for key in ('label', 'title', 'project', 'projectId'):
                    session.pop(key, None)
                choice = rng.randint(0, 4)
                if choice == 1: session['label'] = 'Label ' + name
                if choice == 2: session['title'] = {'value': 'Title ' + name, 'source': 'provider'}
                if choice == 3: session['project'] = rng.choice(['Shared workspace', 'Other'])
                if choice == 4: session['projectId'] = rng.choice(['hub', 'local'])
        step = 2 if rng.random() < 0.1 else 1
        self.revision += step
        if rng.random() < 0.05: self.loss += 1
        if rng.random() < 0.05: self.rejected += 1

    def envelope(self, collector=None):
        sessions = [{k: copy.deepcopy(v) for k, v in s.items() if k != 'present'} for s in self.sessions.values() if s['present']]
        for session in sessions:
            counts = {'active': 0, 'uncertain': 0}
            for child in sessions:
                if child['parent']['status'] != 'known' or child['parent']['identity'] != session['identity']:
                    continue
                if child['activity'] == 'active':
                    counts['active' if child['freshness'] == 'current' else 'uncertain'] += 1
            session['children'] = counts
        collector = collector or ('running' if self.rng.random() < 0.9 else 'quiesced')
        return {'apiVersion': '1.0', 'ownerId': 'owner', 'connection': 'current', 'admissionRejected': self.rejected,
                'nextRequestId': 'request-%d' % self.revision,
                'snapshot': {'apiVersion': '1.2', 'revision': self.revision, 'asOfMs': 1000, 'collector': collector,
                             'lossCount': self.loss, 'sessions': sessions}}


# Session fields every generated session shares; the replay restores them before projecting.
CONSTANT = {'ordering': {'status': 'unknown'}, 'lastEvidenceAtMs': 1000, 'observedAtMs': 1000, 'observationAgeMs': 0}


def compact(envelope, library):
    """The envelope with each session replaced by a key into `library`, which holds each distinct session once."""
    envelope = copy.deepcopy(envelope)
    keys = []
    for session in envelope['snapshot']['sessions']:
        for key, value in CONSTANT.items():
            assert session.pop(key) == value
        text = json.dumps(session, sort_keys=True)
        key = hashlib.sha256(text.encode()).hexdigest()[:12]
        library[key] = session
        keys.append(key)
    envelope['snapshot']['sessions'] = keys
    return envelope


def trace_state(path):
    with contextlib.closing(database.connect_state(path)) as db:
        tables = {table: [list(row) for row in db.execute(f'SELECT * FROM {table} ORDER BY rowid')] for table in TRACE_TABLES}
        current = shared_input.state(db)
    envelope = current['envelope']
    tables['shared_input'] = {key: current[key] for key in ('source', 'generation', 'received', 'connection', 'error', 'backup')}
    tables['shared_input']['envelope'] = hashlib.sha256(shared_input.dumps(envelope).encode()).hexdigest() if envelope else None
    return tables


@contextlib.contextmanager
def traced_state():
    """The trace's starting state: SelectionTest's bound legacy task, two registered devices and a shared configuration."""
    with tempfile.TemporaryDirectory() as temporary:
        path = Path(temporary) / 'state'; path.mkdir()
        home = Path(temporary) / 'codex-home'
        os.environ['CODEX_HOME'] = str(home)
        codex_hooks.manage_hooks(home, 'register', script=Path(b.__file__))
        metadata_path = path / 'metadata.json'; index_path = path / 'session_index.jsonl'
        jsonfile.write_json(path / 'config.json', {'ip': '192.0.2.1', 'token': 'fake', 'panelsToken': 'other',
            'metadata_path': str(metadata_path), 'title_index_path': str(index_path),
            'devices': {'panels': {'kind': 'panels', 'ip': '192.0.2.2', 'token_ref': 'panelsToken'}}})
        selection_setup(path)
        config = {'version': 1, 'ownerId': 'owner', 'consumerId': 'nanoleaf', 'endpoint': 'http://127.0.0.1:12345/api/monitor/v1',
                  'tokenFile': '/synthetic/token', 'clearOnNewTurn': True,
                  'qualifiedSources': [{'provider': 'codex', 'client': 'desktop', 'hostId': 'host', 'sourceId': 'source'},
                                       {'provider': 'claude', 'client': 'code', 'hostId': 'host', 'sourceId': 'claude-source'}],
                  'bindings': [{'identity': identity_of('r1'), 'legacySessionId': 'legacy'}]}
        shared_source.configure(path, config)
        original = shared_input.check_envelope
        # The port receives validated snapshots; the schema check stays with the feed.
        shared_input.check_envelope = lambda value, config, minimum_revision=0: dict(value)
        try:
            yield path, config
        finally:
            shared_input.check_envelope = original


class Recorder:
    def __init__(self, seed, path, config):
        self.path = path
        self.records = []
        self.previous = trace_state(path)
        self.library = {}
        self.result = {'seed': seed, 'config': config, 'constant': CONSTANT, 'sessions': self.library, 'start': dump(path),
                       'layouts': LAYOUTS, 'steps': self.records}

    def run(self, operation):
        result = apply(self.path, operation)
        state = trace_state(self.path)
        # Only the tables that changed in this step; the replay checks the rest stayed the same.
        changed = {key: value for key, value in state.items() if self.previous.get(key) != value}
        self.previous = state
        if 'envelope' in operation:
            operation = dict(operation, envelope=compact(operation['envelope'], self.library))
        self.records.append({'operation': operation, 'result': result, 'changed': changed})
        return result


def trace(seed, steps):
    rng = random.Random(seed)
    with traced_state() as (path, config):
        recorder = Recorder(seed, path, config)
        world = World(rng)
        instant = 1000.0
        for _ in range(steps):
            instant += rng.choice([0.25, 0.5, 1.0, 2.0])
            choice = rng.random()
            current = shared_input.inspect(path)['source']
            if current == 'legacy' and choice < 0.6:
                operation = {'op': 'select', 'source': 'shared', 'instant': instant}
            elif choice < 0.55:
                world.mutate()
                operation = {'op': 'accept', 'instant': instant, 'resync': rng.random() < 0.1}
            elif choice < 0.66:
                operation = {'op': 'dashboard', 'device': rng.choice(['wall', 'panels']), 'instant': instant}
            elif choice < 0.69:
                operation = {'op': 'failed'}
            elif choice < 0.72:
                operation = {'op': 'select', 'source': 'legacy'}
            elif choice < 0.77:
                operation = {'op': 'evict', 'device': rng.choice(['wall', 'panels']), 'pick': rng.random()}
            elif choice < 0.80:
                operation = {'op': 'sql', 'sql': START_COMET, 'params': [instant, rng.choice(['wall', 'panels'])]}
            elif choice < 0.83:
                # A completion queued earlier, so later changes exercise comet cancellation.
                operation = {'op': 'sql', 'sql': QUEUE_COMET, 'params': [instant, rng.choice(['wall', 'panels']), rng.randint(0, 4)]}
            elif choice < 0.86:
                operation = {'op': 'sql', 'sql': 'DELETE FROM comets WHERE started IS NOT NULL', 'params': []}
            elif choice < 0.9:
                device = rng.choice(['wall', 'panels'])
                operation = {'op': 'sql', 'sql': 'INSERT OR REPLACE INTO meta VALUES (?, ?)',
                             'params': [devices.meta_key('mode', device), rng.choice(['work', 'work', 'quiet', 'free'])]}
            elif choice < 0.94:
                device = rng.choice(['wall', 'panels'])
                element = rng.choice([e['id'] for e in devices.elements(LAYOUTS[device])])
                operation = {'op': 'sql', 'sql': 'INSERT OR REPLACE INTO line_prefs (line_id,project,signature,device) VALUES (?,?,?,?)',
                             'params': [element, rng.choice([None, 'project', 'local', 'shared-project-hub']), rng.randint(0, 1), device]}
            elif choice < 0.97:
                device = rng.choice(['wall', 'panels'])
                operation = {'op': 'sql', 'sql': 'INSERT OR REPLACE INTO map_settings (id,style,coverage,rotation,flip_x,flip_y,device) VALUES ((SELECT id FROM map_settings WHERE device=?),?,?,0,0,0,?)',
                             'params': [device, rng.choice(['classic', 'project']), 'whole', device]}
            else:
                count = rng.randint(1, 30)
                operation = {'op': 'metadata', 'files': {'metadata.json': json.dumps({
                    'local-projects': {'local': {'name': 'Local project', 'rootPaths': ['/repo']},
                                       'nested': {'name': 'Nested', 'rootPaths': ['/repo/nested']}},
                    'thread-project-assignments': {'r2': {'projectId': rng.choice(['local', 'nested', 'missing'])}},
                    'thread-workspace-root-hints': {'r1': '/repo/nested/src', 'r3': '/repo/x'}, 'pad': 'x' * count}),
                    'session_index.jsonl': json.dumps({'id': 'r1', 'thread_name': 'Indexed ' + 'y' * count}) + '\n'}}
            if operation['op'] in ('select', 'accept') and operation.get('source') != 'legacy':
                operation['envelope'] = world.envelope()
            recorder.run(operation)
        return recorder.result


START_COMET = 'UPDATE comets SET source=0,started=? WHERE rowid=(SELECT rowid FROM comets WHERE device=? AND started IS NULL ORDER BY queued,rowid LIMIT 1)'
QUEUE_COMET = 'INSERT OR IGNORE INTO comets (session,turn,queued,source,started,device) SELECT id,turn,?,NULL,NULL,? FROM sessions ORDER BY rowid LIMIT 1 OFFSET ?'


def scripted():
    """Comet queueing and cancellation, which random sequences rarely reach: each status change with queued and
    started comets in place, and completions with only old or with new notices."""
    with traced_state() as (path, config):
        recorder = Recorder('comets', path, config)
        world = World(random.Random(0))
        for name, session in world.sessions.items():
            session['present'] = name == 'r1'
        root = world.sessions['r1']
        root.update(activity='active', attention=[], read='unknown', notices=[], freshness='current', restartUncertain=False)
        instant = [1000.0]

        def accept(**changes):
            root.update(changes)
            world.revision += 1
            instant[0] += 1
            recorder.run({'op': 'accept', 'instant': instant[0], 'resync': False, 'envelope': world.envelope('running')})

        def notice(acknowledged=()):
            world.notice += 1
            return {'id': hashlib.sha256(('scripted-%d' % world.notice).encode()).hexdigest(), 'kind': 'turn-ended',
                    'turn': root['turn'], 'acknowledgedBy': list(acknowledged)}

        def comets(started):
            for device in ('wall', 'panels'):
                recorder.run({'op': 'sql', 'sql': QUEUE_COMET, 'params': [instant[0], device, 0]})
            if started:
                recorder.run({'op': 'sql', 'sql': START_COMET, 'params': [instant[0], 'panels']})

        recorder.run({'op': 'select', 'source': 'shared', 'instant': instant[0], 'envelope': world.envelope('running')})
        recorder.run({'op': 'dashboard', 'device': 'wall', 'instant': instant[0]})
        accept()
        # A completion with a new notice queues a comet on each Work device; Quiet devices get none.
        recorder.run({'op': 'sql', 'sql': 'INSERT OR REPLACE INTO meta VALUES (?, ?)', 'params': ['mode@panels', 'quiet']})
        accept(activity='idle', notices=[notice()])
        recorder.run({'op': 'sql', 'sql': 'INSERT OR REPLACE INTO meta VALUES (?, ?)', 'params': ['mode@panels', 'work']})
        # A same-turn status change drops only unstarted comets.
        comets(started=True)
        accept(attention=[{'id': {'status': 'unknown'}, 'kind': 'question', 'turn': root['turn']}])
        # Returning to unread with only old notices queues nothing.
        accept(attention=[])
        # Interrupted activity drops every comet of the task.
        comets(started=True)
        accept(activity='interrupted', attention=[{'id': {'status': 'known', 'id': 'ask'}, 'kind': 'approval', 'turn': root['turn']}])
        accept(activity='idle', attention=[])
        # A new turn drops every comet, started or not.
        comets(started=True)
        accept(turn={'status': 'known', 'id': 'next'}, activity='idle', attention=[])
        # A notice this consumer already acknowledged queues nothing; a fresh one does, unless the device evicted the task.
        accept(activity='active')
        accept(activity='idle', notices=root['notices'] + [notice(['nanoleaf'])])
        accept(activity='active')
        recorder.run({'op': 'evict', 'device': 'panels', 'pick': 0})
        accept(activity='idle', notices=root['notices'] + [notice()])
        # Read evidence while a comet runs keeps the started comet.
        comets(started=True)
        accept(read='read')
        return recorder.result


def scripted_placement():
    """Line placement the translated tests leave open: inactive occupants replaced, a reserved comet source kept on an
    invalid element until the comet ends, a stale epoch phase renewed, and the display cache cleared by source switches."""
    with traced_state() as (path, config):
        recorder = Recorder('placement', path, config)

        def sql(statement, *params):
            recorder.run({'op': 'sql', 'sql': statement, 'params': list(params)})

        def dashboard(device, instant):
            recorder.run({'op': 'dashboard', 'device': device, 'instant': instant})

        # Legacy input: the bound task holds the first Line; an ended and an idle task hold the others.
        sql("INSERT INTO sessions VALUES ('done','t','ended',990.0), ('idle','t','idle',991.0)")
        sql("INSERT INTO slots (session,slot,device) VALUES ('done',1,'wall'), ('idle',2,'wall')")
        sql("INSERT INTO sessions VALUES ('new1','t','working',992.0), ('new2','t','question',993.0), ('new3','t','blocked',994.0)")
        dashboard('wall', 1000.0)
        sql("UPDATE activity SET turn='old' WHERE session='new3'")
        dashboard('wall', 1001.0)
        sql("INSERT INTO comets (session,turn,queued,source,started,device) SELECT 'new2','t',1001.0,slot,1001.0,'wall' FROM slots WHERE session='new2' AND device='wall'")
        sql("UPDATE map_settings SET style='project' WHERE device='wall'")
        sql("INSERT OR REPLACE INTO line_prefs (line_id,project,signature,device) SELECT ?,'zzz',0,'wall'", devices.element_id([104, 105]))
        dashboard('wall', 1002.0)
        sql('DELETE FROM comets')
        dashboard('wall', 1003.0)
        dashboard('panels', 1004.0)
        sql("UPDATE map_settings SET style='classic' WHERE device='wall'")
        dashboard('wall', 1005.0)
        sql("INSERT INTO display_v3 (snapshot,looping,rendered,device) VALUES ('[]',1,1005.0,'wall')")
        world = World(random.Random(0))
        for name, session in world.sessions.items():
            session['present'] = name == 'r1'
        world.sessions['r1'].update(activity='active', attention=[], read='unknown', freshness='current', restartUncertain=False)
        recorder.run({'op': 'select', 'source': 'shared', 'instant': 1006.0, 'envelope': world.envelope('running')})
        dashboard('wall', 1006.0)
        sql("INSERT INTO display_v3 (snapshot,looping,rendered,device) VALUES ('[]',1,1006.0,'panels')")
        recorder.run({'op': 'select', 'source': 'legacy'})
        dashboard('wall', 1007.0)
        # Project layout prefers a task's reserved element over the Shared ones before it.
        sql("INSERT OR IGNORE INTO map_settings (style,coverage,rotation,flip_x,flip_y,device) VALUES ('classic','whole',0,0,0,'panels')")
        sql("UPDATE map_settings SET style='project' WHERE device='panels'")
        sql("INSERT OR REPLACE INTO line_prefs (line_id,project,signature,device) VALUES ('4','proj',0,'panels')")
        sql("INSERT OR REPLACE INTO task_info VALUES ('new1','','','proj',NULL,'t',NULL)")
        sql("DELETE FROM slots WHERE device='panels'")
        dashboard('panels', 1008.0)
        # A running comet's source element stays free for it even when it is empty.
        sql("DELETE FROM slots WHERE device='panels' AND session='legacy'")
        sql("INSERT INTO comets (session,turn,queued,source,started,device) VALUES ('gone','t',1008.0,2,1008.0,'panels')")
        dashboard('panels', 1009.0)
        sql('DELETE FROM comets')
        dashboard('panels', 1010.0)
        return recorder.result


def apply(path, operation):
    op = operation['op']
    try:
        if op == 'select':
            if operation['source'] == 'shared':
                shared_source.select_source(path, 'shared', fetch=lambda *_, **__: copy.deepcopy(operation['envelope']),
                                            now=lambda: operation['instant'])
            else:
                shared_source.select_source(path, 'legacy')
            return None
        if op == 'accept':
            return shared_source.accept(path, copy.deepcopy(operation['envelope']), now=lambda: operation['instant'],
                                        resync=operation['resync'])
        if op == 'failed':
            shared_source.failed(path, shared_source.source_config(path)['generation'])
            return None
        if op == 'dashboard':
            with contextlib.closing(database.connect_state(path)) as db, db:
                return [list(item) if item else None for item in b.dashboard(db, LAYOUTS[operation['device']], operation['instant'])]
        if op == 'evict':
            with contextlib.closing(database.connect_state(path)) as db, db:
                db.execute('BEGIN IMMEDIATE')
                current = shared_input.state(db)
                visible = [row[0] for row in shared_input.visible_tasks(db, operation['device'])]
                tasks = shared_input.presented(current['envelope']['snapshot']) if current['envelope'] else {}
                candidates = [key for key in visible if key in tasks]
                if not candidates:
                    return 'none'
                key = candidates[int(operation['pick'] * len(candidates))]
                payload = {'id': key, 'evictionToken': shared_input.eviction_token(current, tasks[key][0])}
                shared_input.evict(db, operation['device'], payload)
                store.mark_dirty(db)
                return key
        if op == 'sql':
            with contextlib.closing(database.connect_state(path)) as db, db:
                db.execute(operation['sql'], operation['params'])
            return None
        if op == 'metadata':
            for name, text in operation['files'].items():
                (path / name).write_text(text)
            return None
    except (shared_input.FeedError, ValueError) as error:
        return {'error': type(error).__name__, 'message': str(error)}
    raise AssertionError(op)


# Slice 2: Line pairing, map geometry and the renderer's frames on synthetic layouts.

def fixture_json(name):
    return json.loads((SOURCE / 'tests/fixtures' / name).read_text())


def oriented(layout, orientation):
    value = copy.deepcopy(layout)
    value['globalOrientation']['value'] = orientation
    return value


def midpoints(layout, groups):
    zones = {p['panelId']: p for p in layout['layout']['positionData']}
    return [[sum(zones[p]['x'] for p in pair) / 2, sum(zones[p]['y'] for p in pair) / 2] for pair in groups]


def render_layouts():
    """The layouts the frame recordings use, by name."""
    import configuration
    import panels
    lines = fixture_json('lines-layout.json')
    groups = configuration.pair_lines(lines)
    triangles = devices.projection(panels.read_layout(fixture_json('nl22-panels-fixture.json')['panelLayout']))
    rng = random.Random(2602)
    return {
        'straight': {'line_groups': [[100 + i * 2, 101 + i * 2] for i in range(15)], 'line_positions': [[i * 10, 0] for i in range(15)]},
        'real': {'line_groups': groups, 'line_positions': midpoints(lines, groups)},
        'small': {'line_groups': [[100, 101], [102, 103], [104, 105]], 'line_positions': [[0, 0], [1, 0], [2, 0]]},
        'irregular': {'line_groups': [[200 + i * 2, 201 + i * 2] for i in range(7)],
                      'line_positions': [[round(rng.uniform(-300, 300), 3), round(rng.uniform(-300, 300), 3)] for _ in range(7)]},
        'triangles': {'kind': 'panels', 'line_groups': triangles['line_groups'], 'line_positions': triangles['line_positions']},
    }


def geometry_values():
    import configuration
    import panels
    lines = fixture_json('lines-layout.json')
    nl22 = fixture_json('nl22-panels-fixture.json')['panelLayout']
    groups = configuration.pair_lines(lines)
    result = {'pairLines': [], 'lines': [], 'triangles': [], 'connectors': []}
    for orientation in (0, 45, 90, 180, 270, 333):
        value = oriented(lines, orientation)
        pairs = configuration.pair_lines(value)
        result['pairLines'].append({'orientation': orientation, 'groups': pairs, 'positions': midpoints(value, pairs)})
        zone_geometry = {'positionData': value['layout']['positionData'], 'orientation': orientation}
        config = {'line_groups': groups, 'zone_geometry': zone_geometry}
        result['lines'].append({'orientation': orientation, 'segments': wall.geometry(config)})
        cache, graph = wall.validated_connector_geometry(zone_geometry, groups)
        result['connectors'].append({'orientation': orientation, 'cache': cache, 'graph': graph,
                                     'layout': wall.connector_layout(config)})
    for orientation in (0, 30, 90, 240):
        config = devices.projection(panels.read_layout(oriented(nl22, orientation)))
        result['triangles'].append({'orientation': orientation, 'polygons': wall.triangle_geometry(config)})
    return result


def discovery_values():
    """load_config's discovery of the real Lines layout, with no saved layout."""
    import configuration
    lines = fixture_json('lines-layout.json')
    with tempfile.TemporaryDirectory() as temporary:
        directory = Path(temporary)
        jsonfile.write_json(directory / 'config.json', {'ip': '192.0.2.1', 'token': 'fake'})
        config = configuration.load_config(directory, request=lambda address, method, *_: {'panelLayout': copy.deepcopy(lines)})
        return {'config': {key: config[key] for key in ('device', 'kind', 'elements', 'line_groups', 'line_positions')},
                'layout': json.loads((directory / 'layout.json').read_text())}


def frame_values():
    """Zone colors sampled from random renderer states, and the effect payload of each state."""
    rng = random.Random(2604)
    layouts = render_layouts()
    statuses = ('working', 'question', 'blocked', 'unread', 'idle')
    scenarios = []
    for index in range(90):
        name = ('straight', 'real', 'small', 'irregular', 'triangles')[index % 5]
        layout = layouts[name]
        count = len(layout['line_groups'])
        instant = round(1000 + rng.uniform(0, 20), 3)
        config = copy.deepcopy(layout)
        mode = rng.choice((None, 'work', 'work', 'quiet'))
        if mode is not None:
            config['_mode'] = mode
        if rng.random() < 0.35:
            config['_comet'] = {'source': rng.randrange(count), 'started': round(instant + rng.uniform(-1.5, 1.5), 3)}
        if rng.random() < 0.15:
            config['_locate'] = {'source': rng.randrange(count), 'started': round(instant + rng.uniform(-1, 1), 3)}
        if rng.random() < 0.3:
            config['_wave_cutoff'] = round(instant + rng.uniform(-6, 1), 3)
        if rng.random() < 0.2:
            config['_steady_slots'] = sorted(rng.sample(range(count), rng.randint(1, min(3, count))))
        if rng.random() < 0.2:
            config['_wave_suppressed_slots'] = sorted(rng.sample(range(count), rng.randint(1, min(3, count))))
        if rng.random() < 0.45:
            config['_style'] = 'project'
            config['_coverage'] = rng.choice(('whole', 'status'))
            config['_signatures'] = [[None if rng.random() < 0.3 else [rng.randrange(256) for _ in range(3)], rng.randrange(2)]
                                     for _ in range(count)]
        if rng.random() < 0.3:
            config['_palette'] = {role: [rng.randrange(256) for _ in range(3)] for role in wall.DEFAULT_PALETTE}
        snapshot = [None if rng.random() < 0.55 else [rng.choice(statuses), round(instant + rng.uniform(-6, 2), 3)]
                    for _ in range(count)]
        loop = rng.random() < 0.5
        python = copy.deepcopy(config)
        if '_palette' in python:
            python['_palette'] = {role: tuple(color) for role, color in python['_palette'].items()}
        python_snapshot = [tuple(item) if item else None for item in snapshot]
        delays = [b.travel_delays(python, source) for source in range(count)]
        samples = []
        for _ in range(30):
            target = rng.randrange(count)
            half = rng.randrange(len(layout['line_groups'][target]))
            at = round(instant + rng.uniform(-0.2, 2.4), 3)
            samples.append([target, half, at, list(b.zone_color(python, python_snapshot, target, half, at, delays))])
        payload = b.effect_payload(python, python_snapshot, instant, loop)
        scenarios.append({'layout': name, 'config': {k: v for k, v in config.items() if k.startswith('_')}, 'snapshot': snapshot,
                          'instant': instant, 'loop': loop, 'samples': samples,
                          'payload': hashlib.sha256(json.dumps(payload).encode()).hexdigest()})
    return {'layouts': layouts, 'scenarios': scenarios}


def write_nested(name, value, depth):
    """JSON with one line per member down to `depth`, so a re-recording diffs line by line at a modest size."""
    def text(item, level):
        if level >= depth or not isinstance(item, (dict, list)) or not item:
            return json.dumps(item, sort_keys=True, separators=(',', ':'))
        pad = ' ' * (level + 1)
        if isinstance(item, dict):
            members = [pad + json.dumps(key) + ':' + text(item[key], level + 1) for key in sorted(item)]
            return '{\n' + ',\n'.join(members) + '\n' + ' ' * level + '}'
        return '[\n' + ',\n'.join(pad + text(member, level + 1) for member in item) + '\n' + ' ' * level + ']'
    OUTPUT.mkdir(exist_ok=True)
    (OUTPUT / name).write_text(text(value, 0) + '\n')


def numbers():
    """math.hypot and sum() on random floats, one case per line (compat.test.ts)."""
    spread = random.Random(2605)
    write_nested('numbers.json', {
        'hypot': [[a, b, math.hypot(a, b)] for a, b in [(3, 4), (0, 0), (-0.0, 5e-324), (1e308, 1e308)]
                  + [(round(spread.uniform(-900, 900), digits), round(spread.uniform(-900, 900), digits))
                     for digits in (0, 1, 3, 17) for _ in range(60)]],
        'sums': [[values, sum(values)] for values in [[1, 2, 3], [0.1] * 10, [1e16, 1.0, -1e16], []]
                 + [[round(spread.uniform(-1000, 1000), 3) for _ in range(spread.randint(2, 15))] for _ in range(80)]],
    }, 2)


def rendering():
    write_nested('rendering.json', {'geometry': geometry_values(), 'discovery': discovery_values(), 'frames': frame_values()}, 4)


if __name__ == '__main__':
    values()
    setups()
    owner_snapshot()
    write_trace([trace(seed, 110) for seed in (1, 2, 3)] + [scripted(), scripted_placement()])
    numbers()
    rendering()
