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
    """SelectionTest.setUp in test_shared_input.py, before shared_source.configure, for shared input only: the local
    project. The port keeps no legacy input (owner decision, Hub #26, 2026-10-06), so the legacy task Python prompted
    and bound to the shared one is left out."""
    with contextlib.closing(database.connect_state(path)) as db, db:
        db.execute("INSERT INTO projects VALUES ('project','LOCAL TITLE','#112233','[]')")


def setups():
    recorded = {}
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        prompt = root / 'prompt'; prompt.mkdir()
        b.handle_event(prompt, {'session_id': 'a', 'turn_id': '1', 'hook_event_name': 'UserPromptSubmit'}, launch=lambda _: None,
                       now=lambda: 1000.0)
        recorded['taskRow'] = dump(prompt)
        b.handle_event(prompt, {'session_id': 'a', 'turn_id': '1', 'hook_event_name': 'Stop'}, launch=lambda _: None,
                       now=lambda: 1000.5)
        recorded['completion'] = dump(prompt)
        selection = root / 'selection'; selection.mkdir()
        selection_setup(selection)
        recorded['selection'] = dump(selection)
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
    # The legacy task backup (`backup`) is not ported, so it is not recorded.
    tables['shared_input'] = {key: current[key] for key in ('source', 'generation', 'received', 'connection', 'error')}
    tables['shared_input']['envelope'] = hashlib.sha256(shared_input.dumps(envelope).encode()).hexdigest() if envelope else None
    return tables


@contextlib.contextmanager
def traced_state():
    """The trace's starting state: SelectionTest's local project, two registered devices and a shared configuration."""
    with tempfile.TemporaryDirectory() as temporary:
        path = Path(temporary) / 'state'; path.mkdir()
        metadata_path = path / 'metadata.json'; index_path = path / 'session_index.jsonl'
        jsonfile.write_json(path / 'config.json', {'ip': '192.0.2.1', 'token': 'fake', 'panelsToken': 'other',
            'metadata_path': str(metadata_path), 'title_index_path': str(index_path),
            'devices': {'panels': {'kind': 'panels', 'ip': '192.0.2.2', 'token_ref': 'panelsToken'}}})
        selection_setup(path)
        config = {'version': 1, 'ownerId': 'owner', 'consumerId': 'nanoleaf', 'endpoint': 'http://127.0.0.1:12345/api/monitor/v1',
                  'tokenFile': '/synthetic/token', 'clearOnNewTurn': True,
                  'qualifiedSources': [{'provider': 'codex', 'client': 'desktop', 'hostId': 'host', 'sourceId': 'source'},
                                       {'provider': 'claude', 'client': 'code', 'hostId': 'host', 'sourceId': 'claude-source'}]}
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
            if current != 'shared' and choice < 0.6:
                operation = {'op': 'select', 'source': 'shared', 'instant': instant}
            elif choice < 0.55:
                world.mutate()
                operation = {'op': 'accept', 'instant': instant, 'resync': rng.random() < 0.1}
            elif choice < 0.66:
                operation = {'op': 'dashboard', 'device': rng.choice(['wall', 'panels']), 'instant': instant}
            elif choice < 0.72:
                operation = {'op': 'failed'}
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
            if operation['op'] in ('select', 'accept'):
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
    invalid element until the comet ends, a stale epoch phase renewed, and the display cache cleared when shared input is
    selected. Rows saved before the selection stand in for tasks a device already held."""
    with traced_state() as (path, config):
        recorder = Recorder('placement', path, config)

        def sql(statement, *params):
            recorder.run({'op': 'sql', 'sql': statement, 'params': list(params)})

        def dashboard(device, instant):
            recorder.run({'op': 'dashboard', 'device': device, 'instant': instant})

        # Before shared input is selected: two ended tasks hold two Lines. Python showed only its legacy rules here,
        # which hid idle tasks; the port applies shared input's rules, which show them, so no idle task is saved.
        sql("INSERT INTO sessions VALUES ('done','t','ended',990.0), ('closed','t','ended',991.0)")
        sql("INSERT INTO slots (session,slot,device) VALUES ('done',1,'wall'), ('closed',2,'wall')")
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
        dashboard('wall', 1007.0)
        # Project layout prefers a task's reserved element over the Shared ones before it.
        sql("INSERT OR IGNORE INTO map_settings (style,coverage,rotation,flip_x,flip_y,device) VALUES ('classic','whole',0,0,0,'panels')")
        sql("UPDATE map_settings SET style='project' WHERE device='panels'")
        sql("INSERT OR REPLACE INTO line_prefs (line_id,project,signature,device) VALUES ('4','proj',0,'panels')")
        sql("INSERT OR REPLACE INTO task_info VALUES ('new1','','','proj',NULL,'t',NULL)")
        sql("DELETE FROM slots WHERE device='panels'")
        dashboard('panels', 1008.0)
        # A running comet's source element stays free for it even when it is empty.
        sql("INSERT INTO comets (session,turn,queued,source,started,device) VALUES ('gone','t',1008.0,2,1008.0,'panels')")
        dashboard('panels', 1009.0)
        sql('DELETE FROM comets')
        dashboard('panels', 1010.0)
        return recorder.result


def apply(path, operation):
    op = operation['op']
    try:
        if op == 'select':
            shared_source.select_source(path, 'shared', fetch=lambda *_, **__: copy.deepcopy(operation['envelope']),
                                        now=lambda: operation['instant'])
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


# Slice 2: Line pairing, map geometry, animation effects and the renderer's frames on synthetic layouts.

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
    """The layouts the effect and frame recordings use, by name."""
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


def near_miss_layout(orientation, offset):
    """Two Line zones 60 apart along a Line at this orientation, the second moved `offset` across it."""
    turn = math.radians(orientation)
    x = -math.sin(turn) * 60 + math.cos(turn) * offset
    y = math.cos(turn) * 60 + math.sin(turn) * offset
    return {'globalOrientation': {'value': 0}, 'layout': {'positionData': [
        {'panelId': 1, 'x': 0, 'y': 0, 'o': orientation, 'shapeType': 18},
        {'panelId': 2, 'x': x, 'y': y, 'o': orientation, 'shapeType': 18}]}}


def near_misses():
    """pair_lines just inside, at and just beyond its 3-unit collinearity threshold."""
    import configuration
    cases = []
    for orientation in (0, 30, 60, 90, 120, 150, 180, 270):
        for offset in (2.9, 2.999, 3.0, 3.001, 3.1, -2.999, -3.001):
            layout = near_miss_layout(orientation, offset)
            try:
                outcome = configuration.pair_lines(copy.deepcopy(layout))
            except ValueError as error:
                outcome = 'error: ' + str(error)
            cases.append({'orientation': orientation, 'offset': offset, 'layout': layout, 'outcome': outcome})
    return cases


def outcome_of(call):
    """A call's result, or the exception it raised by class and message."""
    try:
        return {'result': call()}
    except Exception as error:  # noqa: BLE001 - every outcome is recorded, including Python's KeyError and TypeError
        return {'error': type(error).__name__, 'message': str(error)}


def parsing_values():
    """pair_lines and load_config on reported Lines layouts with duplicate, mixed and malformed entries."""
    import configuration
    zone1 = {'panelId': 1, 'x': 0, 'y': 0, 'o': 0, 'shapeType': 18}
    zone2 = {'panelId': 2, 'x': 0, 'y': 60, 'o': 0, 'shapeType': 18}
    connector1 = {'panelId': 1, 'x': 0, 'y': -30, 'o': 0, 'shapeType': 19}
    without_o = lambda point: {key: value for key, value in point.items() if key != 'o'}
    def reported(points):
        return {'globalOrientation': {'value': 0}, 'layout': {'positionData': points}}
    pairing = {
        'duplicate zone': [zone1, dict(zone1), zone2],
        'connector after a zone with its panel ID': [zone1, connector1, zone2],
        'connector before a zone with its panel ID': [connector1, zone1, zone2],
        'entry without shapeType': [zone1, zone2, {'panelId': 3, 'x': 0, 'y': 0, 'o': 0}],
        'non-object entry': [zone1, zone2, 'panel'],
        'zone without o': [without_o(zone1), zone2],
        'odd count, one zone without o': [zone1, zone2, without_o(dict(zone2, panelId=3, y=120))],
        'string panel IDs': [dict(zone1, panelId='a'), dict(zone2, panelId='b')],
    }
    loading = {
        'saved Lines, positions without o': ([[1, 2]], [without_o(zone1), without_o(zone2)]),
        'saved Lines, connector after a zone with its panel ID': ([[1, 2]], [zone1, connector1, zone2]),
        'discovered Lines, connector after a zone with its panel ID': (None, [zone1, connector1, zone2]),
        'saved Lines, non-object entry': ([[1, 2]], [zone1, zone2, 'panel']),
        'saved Lines, entry without panelId': ([[1, 2]], [zone1, zone2, {'x': 0, 'y': 0, 'shapeType': 19}]),
        'discovered Lines, string panel IDs': (None, [dict(zone1, panelId='a'), dict(zone2, panelId='b')]),
    }
    result = {'pairLines': [], 'loadConfig': []}
    for name, points in pairing.items():
        layout = reported(points)
        result['pairLines'].append({'name': name, 'layout': layout,
                                    'outcome': outcome_of(lambda: configuration.pair_lines(copy.deepcopy(layout)))})
    for name, (groups, points) in loading.items():
        layout = reported(points)
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            jsonfile.write_json(directory / 'config.json', {'ip': '192.0.2.1', 'token': 'fake'})
            if groups is not None:
                jsonfile.write_json(directory / 'layout.json', {'line_groups': groups})
            def load():
                config = configuration.load_config(directory, request=lambda *_: {'panelLayout': copy.deepcopy(layout)})
                return {'line_groups': config['line_groups'], 'line_positions': config['line_positions'],
                        'layout': json.loads((directory / 'layout.json').read_text())}
            result['loadConfig'].append({'name': name, 'savedGroups': groups, 'layout': layout, 'outcome': outcome_of(load)})
    return result


def color_values():
    """palette_rgb on well-formed and malformed color text."""
    colors = ['#aabbcc', '#AABBCC', '#0a1866', '#1g2233', '#abc', '#12345', 'xaabbcc', '#aabbccdd', '#+1aabb', '# 1aabb', '']
    return [{'color': color, 'outcome': outcome_of(lambda: list(wall.palette_rgb({'base': color})['base']))} for color in colors]


def geometry_values():
    import configuration
    import panels
    lines = fixture_json('lines-layout.json')
    nl22 = fixture_json('nl22-panels-fixture.json')['panelLayout']
    groups = configuration.pair_lines(lines)
    result = {'pairLines': [], 'nearMiss': near_misses(), 'lines': [], 'triangles': [], 'connectors': []}
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


def effect_values():
    """A digest of every pattern, color set, speed, direction and loop choice on each layout."""
    import effects
    rng = random.Random(2603)
    palettes = [['#336699'], ['#ffffff'] * effects.MAX_COLORS,
                ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff', '#808080', '#ffffff'],
                ['#%06x' % rng.randrange(1 << 24) for _ in range(3)]]
    result = {'palettes': palettes, 'layouts': {}}
    for name, layout in render_layouts().items():
        digest, outcomes = hashlib.sha256(), []
        for pattern in effects.PATTERNS:
            for colors in palettes:
                for speed in effects.SPEEDS:
                    for direction in (effects.DIRECTIONS if effects.PATTERNS[pattern] else (None,)):
                        for loop in (True, False):
                            fields = {'kind': 'animation.play', 'pattern': pattern, 'colors': colors, 'speed': speed, 'loop': loop}
                            if direction is not None:
                                fields['direction'] = direction
                            try:
                                text = json.dumps(effects.render(fields, layout['line_groups'], layout['line_positions']))
                            except effects.Rejected as error:
                                text = 'rejected:' + error.code
                            digest.update(text.encode())
                            outcomes.append(hashlib.sha256(text.encode()).hexdigest()[:12])
        result['layouts'][name] = {'sha256': digest.hexdigest(), 'outcomes': outcomes}
    return result


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
    write_nested('rendering.json', {'geometry': geometry_values(), 'discovery': discovery_values(), 'parsing': parsing_values(),
                                    'colors': color_values(), 'effects': effect_values(), 'frames': frame_values()}, 4)


# Slice 3b: map edits, the pending wall edit, Locate, comets, mode commands and the rendering receipt.

EDIT_LAYOUTS = {}


def edit_layouts():
    """The configurations the edit cases run on: the 15 straight Lines of SceneTest and the NL22 triangles."""
    import panels
    if not EDIT_LAYOUTS:
        EDIT_LAYOUTS['lines'] = {'line_groups': [[100 + i * 2, 101 + i * 2] for i in range(15)],
                                 'line_positions': [[i * 10, 0] for i in range(15)]}
        EDIT_LAYOUTS['triangles'] = dict(devices.projection(panels.read_layout(fixture_json('nl22-panels-fixture.json')['panelLayout'])),
                                         device='panels')
    return EDIT_LAYOUTS


EDIT_ROWS = {
    'map_settings': 'style,coverage,rotation,flip_x,flip_y,device', 'line_prefs': 'line_id,project,signature,device',
    'palette': 'role,color', 'projects': 'id,color', 'task_info': 'session,manual_project', 'map_pending': 'payload,device',
    'locate': 'line_id,started,device', 'comets': 'session,turn,queued,source,started,device', 'slots': 'session,slot,device',
    'meta': 'key,value'}


def edit_rows(path):
    """The rows an edit can change, in rowid order; the pending payload is compared parsed."""
    with contextlib.closing(database.connect_state(path)) as db:
        result = {table: [list(row) for row in db.execute(f'SELECT {columns} FROM {table} ORDER BY rowid')]
                  for table, columns in EDIT_ROWS.items()}
    result['map_pending'] = [[json.loads(payload), device] for payload, device in result['map_pending']]
    return result


class Feed:
    """The owner's shared sessions for scripted cases, all from the qualified Codex source. Each change publishes the next
    revision. A completion adds a fresh notice and marks the session unread; read evidence then stays until the next
    completion. `end` removes the session, as the owner does when it retires one."""
    def __init__(self):
        self.sessions = {}
        self.revision = 1

    def envelope(self):
        return {'apiVersion': '1.0', 'ownerId': 'owner', 'connection': 'current', 'admissionRejected': 0,
                'nextRequestId': 'request-%d' % self.revision,
                'snapshot': {'apiVersion': '1.2', 'revision': self.revision, 'asOfMs': 1000, 'collector': 'running', 'lossCount': 0,
                             'sessions': [copy.deepcopy(session) for session in self.sessions.values()]}}

    def change(self, op, name=None):
        session = self.sessions.get(name)
        if op == 'prompt':
            if session is None:
                session = self.sessions[name] = {
                    'identity': {'provider': 'codex', 'client': 'desktop', 'hostId': 'host', 'sourceId': 'source', 'sessionId': name},
                    'turn': {'status': 'known', 'id': 't1'}, 'parent': {'status': 'unknown'}, 'activity': 'idle', 'attention': [],
                    'notices': [], 'read': 'unknown', 'unavailable': [], 'ordering': {'status': 'unknown'}, 'lastEvidenceAtMs': 1000,
                    'observedAtMs': 1000, 'observationAgeMs': 0, 'freshness': 'current', 'restartUncertain': False,
                    'children': {'active': 0, 'uncertain': 0}, 'generation': 0}
            else:
                session['turn'] = {'status': 'known', 'id': 't%d' % (int(session['turn']['id'][1:]) + 1)}
            # Read evidence stays as it was until the next completion.
            session.update(activity='active', attention=[])
        elif op == 'stop':
            notice = {'id': hashlib.sha256((name + ':' + session['turn']['id']).encode()).hexdigest(), 'kind': 'turn-ended',
                      'turn': copy.deepcopy(session['turn']), 'acknowledgedBy': []}
            session.update(activity='idle', attention=[], notices=(session['notices'] + [notice])[-3:], read='unread')
        elif op == 'read':
            session['read'] = 'read'
        elif op in ('question', 'permission'):
            session['attention'] = [{'id': {'status': 'known', 'id': 'ask'}, 'kind': 'question' if op == 'question' else 'approval',
                                     'turn': copy.deepcopy(session['turn'])}]
        elif op == 'resolve':
            session['attention'] = []
        elif op == 'interrupt':
            session.update(activity='interrupted', attention=[])
        elif op == 'end':
            del self.sessions[name]
        elif op != 'touch':
            raise AssertionError(op)
        self.revision += 1


SELECTION_CONFIG = {'version': 1, 'ownerId': 'owner', 'consumerId': 'nanoleaf', 'endpoint': 'http://127.0.0.1:12345/api/monitor/v1',
                    'tokenFile': '/synthetic/token', 'clearOnNewTurn': True,
                    'qualifiedSources': [{'provider': 'codex', 'client': 'desktop', 'hostId': 'host', 'sourceId': 'source'}]}


def select_feed(path, feed, instant):
    """Configure shared input and select it with the feed's current envelope."""
    shared_source.configure(path, SELECTION_CONFIG)
    shared_source.select_source(path, 'shared', fetch=lambda *_, **__: feed.envelope(), now=lambda: instant)


def edit_setup(path, setup, feed):
    """With `shared`, shared input selected at 1000 with no session. Otherwise projects a and b and task a prompted at 1000
    in project a; with `comet`, the task completed and its comet started on the Lines; with `mode`, that mode commanded
    on the Lines."""
    if setup.get('shared'):
        select_feed(path, feed, 1000.0)
        return
    with contextlib.closing(database.connect_state(path)) as db, db:
        db.execute("INSERT INTO projects VALUES ('a','Project A','#aa55ff','[]'),('b','Project B','#33ccee','[]')")
    b.handle_event(path, {'session_id': 'a', 'turn_id': '1', 'hook_event_name': 'UserPromptSubmit'}, launch=lambda _: None,
                   now=lambda: 1000.0)
    with contextlib.closing(database.connect_state(path)) as db, db:
        db.execute("UPDATE task_info SET project='a' WHERE session='a'")
    if setup.get('comet'):
        b.handle_event(path, {'session_id': 'a', 'turn_id': '1', 'hook_event_name': 'Stop'}, launch=lambda _: None,
                       now=lambda: 1000.0)
        with contextlib.closing(database.connect_state(path)) as db, db:
            b.prune_comets(db, 1000.0, 'work')
            b.dashboard(db, edit_layouts()['lines'], 1000.0)
            b.current_comet(db, 1000.0)
    if setup.get('mode'):
        modes.set_mode(path, setup['mode'], launch=lambda _: None, now=lambda: 1000.0)


def edit_step(path, config, step, feed):
    import edits
    op, args = step['op'], step.get('args', [])
    if op == 'feed':
        feed.change(args[0], args[1])
        return shared_source.accept(path, feed.envelope(), now=lambda: args[2])
    with contextlib.closing(database.connect_state(path)) as db, db:
        db.execute('BEGIN IMMEDIATE')
        if op == 'settings': return edits.settings(db, config, *args)
        if op == 'assign': return edits.assign(db, config, *args)
        if op == 'projectColor': return edits.project_color(db, *args)
        if op == 'taskProject': return edits.task_project(db, config, *args)
        if op == 'locate': return edits.locate(db, config, *args)
        if op == 'requestPatch': return wall.request_patch(db, args[0], config)
        if op == 'applyPending': return wall.apply_pending(db, devices.device_of(config))
        if op == 'pending': return wall.pending(db, devices.device_of(config))
        if op == 'locateState':
            return wall.locate_state(db, config, *args)
        if op == 'pruneComets': return b.prune_comets(db, args[0], args[1], devices.device_of(config))
        if op == 'currentComet': return b.current_comet(db, args[0], devices.device_of(config))
        if op == 'dashboard': return [list(item) if item else None for item in b.dashboard(db, config, args[0])]
        if op == 'query': return [list(row) for row in db.execute(args[0])]
        if op == 'changeMode': return modes.change_mode(db, args[0], args[1], device=devices.device_of(config))
        if op == 'rendering':
            control = store.control_state(db, devices.device_of(config))
            return wall.rendering_snapshot(db, config, control['mode'], control['revision'] != control['applied'],
                                           control['error'], args[0])
        if op == 'sql':
            db.execute(args[0], args[1])
            return None
    raise AssertionError(op)


def edit_cases():
    layouts = edit_layouts()
    first = layouts['triangles']['elements'][0]['id']
    def case(name, steps, layout='lines', **setup):
        # Arguments run as they are recorded, with sorted keys, so the port replays them in the same order.
        return {'name': name, 'layout': layout, 'setup': setup,
                'steps': [{'op': op, 'args': json.loads(json.dumps(args, sort_keys=True))} for op, *args in steps]}
    settings = [{'style': 'project'}, {'style': 'bad'}, {'style': True}, {'style': None}, {'coverage': 'status'}, {'rotation': 90},
                {'rotation': 90.0}, {'rotation': 45}, {'rotation': False}, {'flip_x': True}, {'flip_x': 2},
                {'flip_y': 1, 'rotation': 270, 'style': 'project', 'coverage': 'whole'}, {}, {'unknown': 1},
                {'palette': {'unread': '#FF00C0', 'base': '#000000'}}, {'palette': 'default'}, {'palette': {}}, {'palette': 'reset'},
                {'palette': ['#ff00c0']}, {'palette': {'unread': None}}, {'palette': {'comet': '#ffffff'}}, {'palette': {'unread': '#12345'}},
                {'palette': {'unread': '#ff00c0'}, 'style': 'bad'}, {'rotation': 90, 'palette': {'unread': '#12345'}},
                {'rotation': 180, 'palette': {'working': '#00E5FF'}}]
    cases = [case('settings ' + json.dumps(value, sort_keys=True), [('settings', value)]) for value in settings]
    cases += [case('panels settings ' + json.dumps(value, sort_keys=True), [('settings', value)], 'triangles')
              for value in ({'coverage': 'status'}, {'style': 'project'}, {'rotation': 90, 'flip_x': 1}, {'coverage': 'whole'})]
    cases.append(case('palette reset keeps project colors', [('settings', {'palette': {'unread': '#ff00c0'}}),
                                                             ('projectColor', 'a', '#113355'), ('settings', {'palette': 'default'})]))
    assignments = [{'100:101': {'project': 'a'}}, {'100:101': {'project': None}}, {'100:101': {'project': 'zzz'}},
                   {'100:101': {'signature': 1}}, {'100:101': {'signature': 2}}, {'100:101': {'signature': True}},
                   {'100:101': {'signature': '1'}}, {'100:101': {}}, {'100:101': {'project': 'a', 'extra': 1}}, {'100:101': 'a'},
                   {'999:1000': {'project': 'a'}}, {}, None, [], {'100:101': {'project': 'a', 'signature': 1}, '102:103': {'project': 'b'}},
                   {'100:101': {'project': 5}}]
    cases += [case('assign ' + json.dumps(value, sort_keys=True), [('assign', value)]) for value in assignments]
    cases.append(case('assign keeps the field it leaves out', [('assign', {'100:101': {'project': 'a', 'signature': 1}}),
                                                               ('assign', {'100:101': {'project': 'b'}}), ('assign', {'100:101': {'signature': 0}})]))
    cases += [case('panels assign ' + json.dumps(value, sort_keys=True), [('assign', value)], 'triangles')
              for value in ({first: {'project': 'a'}}, {first: {'signature': 1}}, {first: {'project': 'a', 'signature': 0}},
                            {'100:101': {'project': 'a'}})]
    colors = [('a', '#AABBCC'), ('a', '#abc'), ('a', 'red; script'), ('zzz', '#112233'), ('a', None), (None, '#112233'), ('a', '#1122334')]
    cases += [case('project color ' + json.dumps(value), [('projectColor', *value)]) for value in colors]
    tasks = [('a', 'b'), ('a', None), ('zzz', 'a'), ('a', 'zzz')]
    cases += [case('task project ' + json.dumps(value), [('taskProject', *value)]) for value in tasks]
    cases.append(case('task project override and clear', [('taskProject', 'a', 'b'), ('taskProject', 'a', None)]))
    cases += [case('locate ' + json.dumps(line), [('locate', line), ('locateState', 1000.5, 'work'), ('locateState', 1001.0, 'work'),
                                                  ('locateState', 1001.5, 'work')]) for line in ('104:105', '999')]
    cases.append(case('locate in free', [('locate', '104:105')], mode='free'))
    cases.append(case('locate in quiet', [('locate', '104:105'), ('locateState', 1000.0, 'quiet'), ('locateState', 1000.2, 'free'),
                                          ('locateState', 1000.4, 'quiet')], mode='quiet'))
    cases.append(case('panels locate', [('locate', first), ('locateState', 1000.0, 'work'), ('locate', '100:101')], 'triangles'))
    cases.append(case('locate of a removed element', [('sql', "INSERT INTO locate (line_id,started,device) VALUES ('7:8',NULL,'wall')", []),
                                                      ('locateState', 1000.0, 'work')]))
    # A started comet on the task's Line defers an edit that would move it, and the deferred edits merge.
    cases.append(case('comet defers style', [('settings', {'style': 'project'}), ('pending',), ('settings', {'rotation': 90}),
                                             ('pending',), ('applyPending',), ('pruneComets', 1002.0, 'work'), ('applyPending',),
                                             ('pending',)], comet=True))
    cases.append(case('comet leaves other settings', [('settings', {'rotation': 90, 'coverage': 'status'}), ('pending',)], comet=True))
    cases.append(case('comet defers its source Line', [('assign', {'100:101': {'project': 'b'}}), ('assign', {'102:103': {'project': 'b'}}),
                                                       ('assign', {'100:101': {'signature': 1}}), ('pending',), ('locate', '106:107'),
                                                       ('locateState', 1001.0, 'work'), ('pruneComets', 1002.0, 'work'),
                                                       ('locateState', 1002.0, 'work'), ('applyPending',)], comet=True))
    cases.append(case('comet defers its task', [('taskProject', 'a', 'b'), ('pending',), ('projectColor', 'b', '#010203'),
                                                ('sql', "DELETE FROM comets", []), ('applyPending',)], comet=True))
    cases.append(case('comet on another device', [('requestPatch', {'settings': {'style': 'project'}}),
                                                  ('sql', "INSERT INTO comets (session,turn,queued,source,started,device) VALUES ('a','1',1,0,2,'panels')", []),
                                                  ('requestPatch', {'settings': {'style': 'classic'}})]))
    cases.append(case('panels comet defers its source', [('sql', "INSERT INTO comets (session,turn,queued,source,started,device) VALUES ('t','1',1,0,1,'panels')", []),
                                                         ('requestPatch', {'lines': {first: {'project': 'b'}}}),
                                                         ('requestPatch', {'settings': {'rotation': 90}}), ('pending',)], 'triangles'))
    # Comets: queued, started, ended and pruned by mode.
    cases.append(case('comet lifecycle', [('currentComet', 1000.5), ('pruneComets', 1001.9, 'work'), ('currentComet', 1001.9),
                                          ('pruneComets', 1002.0, 'work'), ('currentComet', 1002.0)], comet=True))
    cases.append(case('queued comets start in order', [
        ('sql', "INSERT INTO sessions VALUES ('b','1','unread',1000)", []),
        ('sql', "INSERT INTO slots (session,slot,device) VALUES ('b',3,'wall')", []),
        ('sql', "INSERT INTO comets (session,turn,queued,source,started,device) VALUES ('b','1',999,NULL,NULL,'wall')", []),
        ('sql', "INSERT INTO sessions VALUES ('c','2','working',1000)", []),
        ('sql', "INSERT INTO comets (session,turn,queued,source,started,device) VALUES ('c','1',998,NULL,NULL,'wall')", []),
        ('sql', "INSERT INTO sessions VALUES ('d','1','unread',1000)", []),
        ('sql', "INSERT INTO slots (session,slot,device) VALUES ('d',5,'wall')", []),
        ('sql', "INSERT INTO comets (session,turn,queued,source,started,device) VALUES ('d','1',999.5,NULL,NULL,'wall')", []),
        ('sql', "INSERT INTO sessions VALUES ('e','1','unread',1000)", []),
        ('sql', "INSERT INTO comets (session,turn,queued,source,started,device) VALUES ('e','1',990,NULL,NULL,'wall')", []),
        ('currentComet', 1000.0), ('pruneComets', 1000.0, 'work'), ('currentComet', 1000.0), ('pruneComets', 1003.0, 'work'),
        ('currentComet', 1003.0), ('pruneComets', 1005.0, 'work'), ('currentComet', 1005.0)]))
    cases.append(case('comets end outside work', [('pruneComets', 1000.5, 'quiet'), ('currentComet', 1000.5)], comet=True))
    # Mode commands on a device without a controller ledger.
    cases.append(case('mode commands', [('changeMode', 'quiet', 1000.0), ('changeMode', 'quiet', 1001.0),
                                        ('sql', "INSERT OR REPLACE INTO meta VALUES ('mode_applied','1')", []), ('changeMode', 'quiet', 1002.0),
                                        ('changeMode', 'work', 1003.5), ('sql', "INSERT INTO meta VALUES ('control_error','Light update failed; retrying.')", []),
                                        ('changeMode', 'work', 1004.0)]))
    cases.append(case('mode command clears comets, Locate and preview', [
        ('locate', '104:105'), ('sql', "INSERT INTO meta VALUES ('preview','comet')", []), ('changeMode', 'free', 1001.0)], comet=True))
    cases.append(case('panels mode commands', [('changeMode', 'quiet', 1000.0), ('changeMode', 'work', 1001.25)], 'triangles'))
    # The rendering receipt: last sent, pending, failed, externally controlled and unknown.
    receipt = json.dumps({'apiVersion': '1.0', 'deviceId': 'wall', 'effect': {'write': {'animData': 'frames'}}})
    cases.append(case('rendering receipt', [
        ('sql', "DELETE FROM meta WHERE key='dirty'", []), ('rendering', 1000.0004), ('sql', "INSERT OR REPLACE INTO meta VALUES ('rendering_receipt',?)", [receipt]), ('rendering', 1000.0006),
        ('sql', "INSERT OR REPLACE INTO meta VALUES ('dirty','1')", []), ('rendering', 1000.5),
        ('sql', "DELETE FROM meta WHERE key='dirty'", []),
        ('sql', "INSERT OR REPLACE INTO meta VALUES ('control_error','Light update failed; retrying.')", []), ('rendering', 1001.0),
        ('sql', "DELETE FROM meta WHERE key='control_error'", []), ('sql', "INSERT OR REPLACE INTO meta VALUES ('mode','free')", []),
        ('rendering', 1001.0), ('sql', "DELETE FROM meta WHERE key='mode'", []),
        ('sql', "INSERT OR REPLACE INTO meta VALUES ('rendering_receipt',?)", ['{"outcome":"unknown"}']), ('rendering', 1002.0),
        ('sql', "INSERT OR REPLACE INTO meta VALUES ('rendering_receipt',?)", ['[1,2]']), ('rendering', 1002.0),
        ('sql', "INSERT OR REPLACE INTO meta VALUES ('rendering_receipt',?)", ['{}']), ('rendering', 1002.0),
        ('sql', "INSERT OR REPLACE INTO meta VALUES ('rendering_receipt',?)", ['{broken']), ('rendering', 1002.0),
        ('sql', "INSERT OR REPLACE INTO meta VALUES ('mode_revision','3')", []), ('rendering', 1002.0)]))
    cases.append(case('panels rendering receipt', [
        ('sql', "DELETE FROM meta WHERE key='dirty'", []), ('rendering', 1000.0005),
        ('sql', "INSERT OR REPLACE INTO meta VALUES ('rendering_receipt@panels',?)", [receipt]), ('rendering', 1000.0015),
        ('sql', "INSERT OR REPLACE INTO meta VALUES ('mode@panels','free')", []), ('rendering', 1000.0025)], 'triangles'))
    # CometTest cases that need only placement, comets and mode commands, with tasks from the shared feed.
    prepare = lambda instant: [('pruneComets', instant, 'work'), ('dashboard', instant), ('currentComet', instant)]
    complete = lambda name, instant: [('feed', 'prompt', name, instant), ('feed', 'stop', name, instant)]
    lines = [('feed', 'prompt', str(i), 1000.0) for i in range(15)] + [('dashboard', 1000.0)]
    cases.append(case('comet waits for its task to have a Line', lines + complete('extra', 1000.0) + prepare(1000.0)
                      + [('feed', 'end', '0', 1000.0)] + prepare(1000.0), shared=True))
    steps = []
    for mode in ('free', 'quiet'):
        steps += [('changeMode', 'work', 1000.0)] + complete('a', 1000.0) + complete('b', 1000.0) + prepare(1000.0)
        steps += [('changeMode', mode, 1000.0), ('query', 'SELECT * FROM comets')] + complete('c', 1000.0)
        steps += [('query', 'SELECT * FROM comets'), ('changeMode', 'work', 1000.0)] + prepare(1000.0)
    cases.append(case('Free and Quiet clear comets and queue none', steps, shared=True))
    cases.append(case('an expired comet is not replayed', complete('a', 1000.0) + prepare(1000.0) + prepare(1003.0)
                      + [('feed', 'touch', None, 1003.0), ('query', 'SELECT * FROM comets')], shared=True))
    return cases


def edit_values():
    """Each edit case's outcomes and the rows it leaves (edits.test.ts)."""
    layouts = edit_layouts()
    cases = edit_cases()
    # The port receives validated snapshots; the schema check stays with the feed.
    original = shared_input.check_envelope
    shared_input.check_envelope = lambda value, config, minimum_revision=0: dict(value)
    for record in cases:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)
            (path / 'config.json').write_text(json.dumps({'ip': '192.0.2.1', 'token': 'fake'}))
            feed = Feed()
            edit_setup(path, record['setup'], feed)
            config = copy.deepcopy(layouts[record['layout']])
            for step in record['steps']:
                step['outcome'] = outcome_of(lambda: edit_step(path, config, step, feed))
            record['rows'] = edit_rows(path)
    shared_input.check_envelope = original
    write_nested('edits.json', {'layouts': layouts, 'cases': cases}, 3)


# Slice 3c: the display worker with scene restore, on scripted cases.

SCENE = {'ip': '192.168.1.207', 'token': 'PRIVATE_TEST_TOKEN', 'line_groups': [[100 + i * 2, 101 + i * 2] for i in range(15)],
         'line_positions': [[i * 10, 0] for i in range(15)]}


class Stopped(Exception):
    """Ends a scripted worker run, as the module's stop signal ends the port's worker."""


class MsClock:
    """A test clock kept in milliseconds, as the runtime's clock is. now() is in seconds; a sleep of s seconds adds s * 1000
    milliseconds, the arithmetic the port's worker does through its scheduler, so both sides see the same instants."""
    def __init__(self):
        self.ms = 1000000.0

    def now(self):
        return self.ms / 1000

    def sleep(self, seconds):
        self.ms += seconds * 1000


class SceneDevice:
    """test_scene_restore.Device: saved scenes, the playing selection and brightness, and every request with its time.
    `fail` is a request to refuse once: {'method': ..., 'endpoint': ...}, either key optional."""
    def __init__(self, clock):
        self.clock = clock
        self.names = ['Beach Waves', 'Cotton Candy']
        self.selected = 'Beach Waves'
        self.brightness = 43
        self.on = True
        self.calls = []
        self.fail = None
        self.lose_selection_reply = False

    hooks = ()

    @staticmethod
    def matches(spec, method, endpoint, payload):
        """A request spec: {'method', 'endpoint', 'payload'}, each optional; 'payload' names a key the body must have."""
        return (spec.get('method', method) == method and spec.get('endpoint', endpoint) == endpoint
                and ('payload' not in spec or spec['payload'] in (payload or {})))

    def request(self, config, method, endpoint='', payload=None):
        # A hook runs a step once, as the request reaches the device; Python's tests patched the request to do this.
        for hook in list(self.hooks):
            if self.matches(hook, method, endpoint, payload):
                self.hooks = [item for item in self.hooks if item is not hook]
                hook['results'].append(outcome_of(lambda: hook['run'](hook['step'])))
        self.calls.append([self.clock.now(), method, endpoint, copy.deepcopy(payload)])
        if self.fail is not None and self.matches(self.fail, method, endpoint, payload):
            self.fail = None
            raise OSError('Device unavailable')
        if method == 'GET' and endpoint == '/effects':
            return {'select': self.selected, 'effectsList': list(self.names)}
        if method == 'GET' and endpoint == '/state':
            return {'brightness': {'value': self.brightness}, 'on': {'value': self.on}}
        if method == 'PUT' and endpoint == '/state':
            if 'brightness' in payload:
                self.brightness = payload['brightness']['value']
            if 'on' in payload:
                self.on = payload['on']['value']
        elif method == 'PUT' and endpoint == '/effects':
            if 'select' in payload:
                assert payload['select'] in self.names
                self.selected = payload['select']
                if self.lose_selection_reply:
                    self.lose_selection_reply = False
                    raise OSError('Response lost after selection succeeded')
            else:
                self.selected = '*Dynamic*' if payload['write']['animType'] == 'custom' else '*Static*'
        else:
            raise AssertionError((method, endpoint))


class IdleFeed:
    """The worker's poller with the feed's requests removed: the port takes envelopes from the runtime instead, so these
    cases accept them as scheduled steps."""
    def __init__(self, path):
        self.path = path

    def tick(self, instant):
        with contextlib.closing(database.connect_state(self.path)) as db:
            return shared_input.selected(db)


WORKER_ROWS = {'sessions': 'id,turn,status,updated', 'activity': 'session,turn,status,started', 'task_info': 'session,project,manual_project,turn,started',
               'slots': 'session,slot,device', 'comets': 'session,turn,queued,source,started,device', 'locate': 'line_id,started,device',
               'map_pending': 'payload,device', 'map_settings': 'style,coverage,rotation,flip_x,flip_y,device', 'palette': 'role,color',
               'meta': 'key,value', 'display_v3': 'snapshot,looping,rendered,device'}


class WorkerCase:
    """One scripted case: SceneTest's Lines and fake device, shared input selected at 1000 with no session, and steps."""
    def __init__(self, path, record):
        self.path = path
        self.record = record
        self.clock = MsClock()
        self.device = SceneDevice(self.clock)
        self.feed = Feed()
        self.sends = []
        config = dict(SCENE, metadata_path=str(path / 'metadata.json'), title_index_path=str(path / 'session_index.jsonl'))
        (path / 'config.json').write_text(json.dumps(config))
        (path / 'layout.json').write_text(json.dumps({key: SCENE[key] for key in ('line_groups', 'line_positions')}))
        select_feed(path, self.feed, self.clock.now())

    def db(self):
        return contextlib.closing(database.connect_state(self.path))

    def apply(self, step):
        import edits
        op, args = step[0], step[1:]
        if op == 'feed':
            self.feed.change(args[0], args[1] if len(args) > 1 else None)
            return shared_source.accept(self.path, self.feed.envelope(), now=self.clock.now)
        if op == 'mode':
            modes.set_mode(self.path, args[0], launch=lambda _: None, now=self.clock.now, device=args[1] if len(args) > 1 else devices.DEFAULT)
            return None
        if op == 'status':
            return modes.get_status(self.path)
        if op == 'sleep':
            self.clock.sleep(args[0])
            return None
        if op in ('sql', 'query'):
            with self.db() as db, db:
                rows = db.execute(args[0], args[1] if len(args) > 1 else []).fetchall()
            return [list(row) for row in rows] if op == 'query' else None
        if op == 'device':
            if args[0] == 'clearCalls':
                self.device.calls.clear()
            elif args[0] == 'remove':
                self.device.names.remove(args[1])
            elif args[0] == 'scene':
                self.device.selected, self.device.brightness = args[1], args[2]
            else:
                setattr(self.device, args[0], copy.deepcopy(args[1]))
            return None
        if op == 'selected':
            return self.device.selected
        if op == 'countPuts':
            return len([call for call in self.device.calls if call[1] == 'PUT'])
        if op == 'scene':
            path = self.path / 'scene-state.json'
            return json.loads(path.read_text()) if path.exists() else None
        if op == 'takeover':
            manager = b.SceneRestorer(self.path, dict(SCENE), request=self.device.request)
            manager.observe()
            manager.send(dict(SCENE), [('working', 1000)] + [None] * 14, 1000, True)
            return None
        if op == 'cache':
            with self.db() as db, db:
                snapshot = b.dashboard(db, dict(SCENE), self.clock.now())
                db.execute('INSERT INTO display_v3 (snapshot, looping, rendered) VALUES (?, 1, ?)', (json.dumps(snapshot), self.clock.now()))
            return None
        if op == 'prepare':
            with self.db() as db, db:
                b.prune_comets(db, self.clock.now(), store.control_state(db)['mode'])
                b.dashboard(db, dict(SCENE), self.clock.now())
                return b.current_comet(db, self.clock.now())
        if op == 'edit':
            with self.db() as db, db:
                db.execute('BEGIN IMMEDIATE')
                kind = args[0]
                if kind == 'taskProject':
                    return edits.task_project(db, dict(SCENE), shared_input.identity_key(dict(FEED_IDENTITY, sessionId=args[1])), args[2])
                return {'settings': edits.settings, 'assign': edits.assign, 'locate': edits.locate}[kind](db, dict(SCENE), args[1]) \
                    if kind != 'projectColor' else edits.project_color(db, args[1], args[2])
        if op == 'second':
            return b.run_worker(self.path, sleep=lambda _: None, now=self.clock.now, request=self.device.request,
                                read_unread=lambda: None, feed={'poller': IdleFeed(self.path)})
        if op == 'run':
            return self.run(*args)
        raise AssertionError(op)

    def run(self, until, scheduled=(), options=None):
        options = options or {}
        pending = list(scheduled)
        results = []
        def advance(seconds):
            self.clock.sleep(seconds)
            while pending and self.clock.now() >= pending[0][0]:
                results.append(outcome_of(lambda: self.apply(pending.pop(0)[1])))
            if self.clock.now() >= until:
                raise Stopped()
        def capture(config, snapshot, instant, loop):
            if options.get('send') == 'fail' or (options.get('send') == 'failAfterFirst' and self.sends):
                raise RuntimeError('offline')
            self.sends.append([[list(item) if item else None for item in snapshot], instant, loop])
        arguments = dict(sleep=advance, now=self.clock.now, read_unread=lambda: None, request=self.device.request,
                         feed={'poller': IdleFeed(self.path)})
        if options.get('send'):
            arguments['send'] = capture
        if options.get('scenes') is False:
            arguments['scene_factory'] = None
        try:
            outcome = {'result': b.run_worker(self.path, **arguments)}
        except Stopped:
            outcome = {'stopped': self.clock.now()}
        except Exception as error:  # noqa: BLE001 - the worker's failure is the outcome
            outcome = {'error': type(error).__name__, 'message': str(error)}
        return {'outcome': outcome, 'scheduled': results}

    def rows(self):
        with self.db() as db:
            result = {table: [list(row) for row in db.execute(f'SELECT {columns} FROM {table} ORDER BY rowid')]
                      for table, columns in WORKER_ROWS.items()}
        result['map_pending'] = [[json.loads(payload), device] for payload, device in result['map_pending']]
        result['display_v3'] = [[finite(json.loads(text)), looping, rendered, device] for text, looping, rendered, device in result['display_v3']]
        return result


def finite(value):
    """JSON-safe: Python's json.dumps writes infinite floats, such as an unset wave cutoff, as -Infinity."""
    if isinstance(value, float) and not math.isfinite(value):
        return repr(value).replace('inf', 'Infinity').replace('nan', 'NaN')
    if isinstance(value, list):
        return [finite(item) for item in value]
    if isinstance(value, dict):
        return {key: finite(item) for key, item in value.items()}
    return value


FEED_IDENTITY = {'provider': 'codex', 'client': 'desktop', 'hostId': 'host', 'sourceId': 'source'}


def worker_cases():
    """The 3c cases: each Python worker test's steps, with tasks from the shared feed."""
    def case(name, steps):
        return {'name': name, 'steps': [list(step) for step in steps]}
    feed = lambda op, name=None: ('feed', op, name) if name is not None else ('feed', op)
    complete = lambda name: [feed('prompt', name), feed('stop', name)]
    bridge = {'scenes': False, 'send': 'capture'}
    projects = ('sql', "INSERT INTO projects VALUES ('a','Project A','#aa55ff','[]'),('b','Project B','#33ccee','[]')")
    line = lambda i: '%d:%d' % (100 + i * 2, 101 + i * 2)
    cases = [
        # BridgeTest: the worker without scenes, its sends captured.
        case('first working pulse', [feed('prompt', 'a'), ('run', 1006.0, [], bridge)]),
        case('each color', [feed('prompt', 'a'), ('run', 1012.0, [(1004.0, feed('question', 'a')), (1008.0, feed('permission', 'a'))], bridge)]),
        case('finished and interrupted', [feed('prompt', 'a'), ('run', 1004.0, [], bridge), feed('stop', 'a'), feed('read', 'a'),
                                          ('run', 1008.0, [], bridge), feed('prompt', 'a'), ('run', 1012.0, [], bridge),
                                          feed('interrupt', 'a'), ('run', 1016.0, [], bridge)]),
        case('state change interrupts', [feed('prompt', 'a'), feed('prompt', 'b'),
                                         ('run', 1004.0, [(1000.25, feed('permission', 'b'))], bridge)]),
        case('other task start', [feed('prompt', 'a'), ('run', 1005.0, [], bridge), feed('prompt', 'b'), ('run', 1010.0, [], bridge)]),
        case('stable slots', [feed('prompt', str(i)) for i in range(15)] + [
            ('run', 1003.0, [], bridge), ('query', 'SELECT session,slot FROM slots ORDER BY slot'), feed('end', '3'), feed('prompt', 'new'),
            ('run', 1006.0, [], bridge)]),
        case('concurrent tasks', [feed('prompt', str(i)) for i in range(17)] + [('run', 1003.0, [], bridge)]),
        case('failed send', [feed('prompt', 'a'), ('run', 1003.0, [], {'scenes': False, 'send': 'fail'}),
                             ('query', 'SELECT status FROM sessions'), ('run', 1006.0, [], bridge)]),
        case('recovery after a failed send', [feed('prompt', 'a'), ('run', 1004.0, [], {'scenes': False, 'send': 'failAfterFirst'}),
                                              ('query', "SELECT value FROM meta WHERE key='rendering'"), ('run', 1008.0, [], bridge),
                                              ('query', "SELECT value FROM meta WHERE key='rendering'")]),
        case('one worker per device', [feed('prompt', 'a'), ('run', 1006.0, [(1000.25, ('second',)), (1001.0, feed('stop', 'a')),
                                                                             (1002.0, feed('read', 'a'))], bridge)]),
        case('Free sends nothing', [feed('prompt', 'a'), ('sql', "INSERT OR REPLACE INTO meta VALUES ('mode','free')"),
                                    ('run', 1003.0, [], {'scenes': False, 'send': 'fail'})]),
        # CometTest.
        case('completions queue in order', complete('a') + [('sleep', 0.1)] + complete('b') + [
            feed('touch'), ('query', 'SELECT session FROM comets ORDER BY rowid'), ('prepare',),
            ('query', 'SELECT session FROM comets WHERE started IS NOT NULL'), ('sleep', 2.0), ('prepare',),
            ('query', 'SELECT session FROM comets WHERE started IS NOT NULL')]),
        case('a read queued task is skipped', complete('a') + complete('b') + [('prepare',), feed('read', 'b'), ('sleep', 2.0), ('prepare',),
                                                                               ('query', 'SELECT * FROM comets')]),
        case('a new turn or an interrupt ends the comet', complete('a') + [('prepare',), feed('prompt', 'a'), ('query', 'SELECT * FROM comets'),
                                                                           feed('end', 'a')] + complete('a') + [
            ('prepare',), feed('interrupt', 'a'), ('query', 'SELECT * FROM comets')]),
        case('read during a comet', complete('a') + [('run', 1008.0, [(1000.5, feed('read', 'a')), (1005.0, feed('end', 'a'))])]),
        case('queued comets play in turn', complete('a') + complete('b') + [
            ('run', 1008.0, [(t, ('query', 'SELECT session,source,started FROM comets WHERE started IS NOT NULL')) for t in (1000.5, 1001.5, 1002.5, 1003.5)]
             + [(1005.0, feed('read', 'a')), (1005.0, feed('read', 'b'))])]),
        case('Free ends the comet and the queue', complete('a') + complete('b') + [
            ('run', 1006.0, [(1000.5, ('mode', 'free')), (1001.0, feed('read', 'a')), (1001.0, feed('read', 'b'))])]),
        case('comet start survives a failed send', complete('a') + [
            ('device', 'fail', {'method': 'PUT', 'endpoint': '/effects'}), ('run', 1003.0), ('query', 'SELECT started FROM comets'),
            ('sleep', 0.5), ('run', 1006.0, [(1001.0, ('query', 'SELECT started FROM comets')), (1003.0, feed('read', 'a'))])]),
        # ModeTest.
        case('mode commands persist', [feed('prompt', 'a'), ('status',), ('mode', 'free'), ('query', "SELECT value FROM meta WHERE key='mode_revision'"),
                                       ('mode', 'free'), ('query', "SELECT value FROM meta WHERE key='mode_revision'"), ('status',),
                                       ('run', 1004.0), ('status',)]),
        case('Free releases once', [('takeover',), feed('prompt', 'a'), ('mode', 'free'), ('run', 1003.0), ('device', 'clearCalls'),
                                    feed('permission', 'a'), ('run', 1006.0), feed('stop', 'a'), ('run', 1009.0)]),
        case('reads in Free make no requests', [feed('prompt', 'a'), ('mode', 'free'), ('run', 1003.0), ('device', 'clearCalls'),
                                                feed('stop', 'a'), ('run', 1006.0, [(1004.0, feed('read', 'a'))])]),
        case('return to Work skips old waves', [feed('prompt', 'a'), ('mode', 'free'), ('run', 1002.0), ('query', 'SELECT * FROM slots'),
                                                ('sleep', 0.2), ('mode', 'work'), ('run', 1008.0, [(1004.0, feed('interrupt', 'a'))]),
                                                ('query', 'SELECT * FROM slots')]),
        case('rapid mode changes', [feed('prompt', 'a'), ('mode', 'quiet'), ('mode', 'work'), ('mode', 'free'), ('run', 1004.0), ('status',)]),
        case('failed handoff', [('takeover',), feed('prompt', 'a'), ('mode', 'free'), ('device', 'fail', {'method': 'PUT'}),
                                ('run', 1004.0), ('status',), ('mode', 'quiet'), ('run', 1006.0, [(1002.0, ('mode', 'free'))]), ('status',)]),
        case('a mode command ends a preview', [feed('prompt', 'a'), ('sql', "INSERT OR REPLACE INTO meta VALUES ('preview','all')"),
                                               ('run', 1004.0, [(1000.5, ('mode', 'free'))])]),
        case('Free leaves an external stream', [('takeover',), ('device', 'selected', '*ExtControl*'), feed('prompt', 'a'),
                                                ('mode', 'free'), ('device', 'clearCalls'), ('run', 1003.0)]),
        case('Quiet idle writes once', [feed('prompt', 'a'), feed('interrupt', 'a'), ('mode', 'quiet'),
                                        ('run', 1008.0, [(1001.0, ('countPuts',)), (1004.0, ('countPuts',)), (1005.0, ('mode', 'free'))])]),
        # SceneTest.
        case('the scene returns after the last task', [feed('prompt', 'a'), feed('prompt', 'b'), ('run', 1014.0, [
            (1003.0, feed('stop', 'a')), (1005.0, feed('stop', 'b')), (1006.0, ('query', 'SELECT session,slot FROM slots')),
            (1007.0, feed('read', 'a')), (1009.0, feed('read', 'b')),
            (1011.0, feed('end', 'a')), (1011.0, feed('end', 'b'))])]),
        case('a scene chosen during Work becomes the target', [feed('prompt', 'a'), ('run', 1010.0, [
            (1003.0, ('device', 'scene', 'Cotton Candy', 66)), (1004.5, ('scene',)), (1004.5, ('selected',)),
            (1004.5, ('query', 'SELECT started FROM activity')),
            (1006.0, feed('interrupt', 'a')), (1007.0, feed('end', 'a'))])]),
        case('idle passes leave the scene running', [('run', 1002.0), ('device', 'scene', 'Cotton Candy', 57), ('device', 'clearCalls'),
                                                    ('run', 1004.0), ('scene',)]),
        case('a failed capture changes nothing', [feed('prompt', 'a'), ('device', 'fail', {'method': 'GET', 'endpoint': '/state'}),
                                                  ('run', 1003.0)]),
        case('cached indicators are adopted', [feed('prompt', 'a'), ('device', 'selected', '*Dynamic*'), ('sleep', 4.0), ('cache',),
                                               ('run', 1012.0, [(1007.0, feed('interrupt', 'a')), (1008.0, feed('end', 'a'))])]),
        # The port's own: the indicators' ownership invalidates an unchanged idle display.
        case('an owned scene returns after a restart', [('run', 1002.0), ('takeover',), ('scene',), ('run', 1004.0)]),
        case('a preview ends with the tasks shown again', [feed('prompt', 'a'), ('run', 1008.0, [
            (1003.0, ('sql', "INSERT OR REPLACE INTO meta VALUES ('preview','comet')"))])]),
        case('the worker applies a wall edit the comet deferred', complete('a') + [('run', 1006.0, [
            (1000.5, ('edit', 'settings', {'style': 'project'})), (1001.0, ('query', 'SELECT payload FROM map_pending')),
            (1001.0, ('query', 'SELECT style FROM map_settings')), (1004.0, ('query', 'SELECT payload FROM map_pending')),
            (1004.0, ('query', 'SELECT style FROM map_settings'))])]),
        # PaletteWorkerTest.
        case('palette change mid pulse and comet', [projects, feed('prompt', 'w'), feed('prompt', 'u'), ('run', 1012.0, [
            (1001.0, feed('stop', 'u')),
            (1002.0, ('query', 'SELECT * FROM activity ORDER BY session')), (1002.0, ('query', 'SELECT session,source,started FROM comets')),
            (1002.0, ('query', 'SELECT * FROM slots')),
            (1002.0, ('edit', 'settings', {'palette': {'unread': '#ff00c0', 'working': '#00e5ff'}})),
            (1002.6, ('query', 'SELECT * FROM activity ORDER BY session')), (1002.6, ('query', 'SELECT session,source,started FROM comets')),
            (1002.6, ('query', 'SELECT * FROM slots')),
            (1005.0, ('edit', 'settings', {'palette': 'default'})), (1007.0, feed('read', 'u')), (1007.0, feed('interrupt', 'w')),
            (1008.0, feed('end', 'u')), (1008.0, feed('end', 'w'))])]),
        case('an Off base keeps unused Lines dark', [projects, ('edit', 'settings', {'palette': {'base': '#000000'}}), feed('prompt', 'a'),
                                                     feed('permission', 'a'), ('run', 1008.0, [(1003.0, feed('interrupt', 'a')),
                                                                                                (1004.0, feed('end', 'a'))])]),
        case('Free after a palette change restores the scene once', [projects, ('edit', 'settings', {'palette': {'base': '#000000', 'working': '#00e5ff'}}),
                                                                     feed('prompt', 'a'), ('run', 1006.0, [(1003.0, ('mode', 'free'))])]),
        # ProjectTest.
        case('a color edit invalidates the display', [projects, feed('prompt', 'a'), ('edit', 'taskProject', 'a', 'a'),
                                                      ('edit', 'settings', {'style': 'project', 'coverage': 'status'}),
                                                      ('run', 1010.0, [(1003.0, ('edit', 'projectColor', 'a', '#113355')),
                                                                       (1006.0, feed('interrupt', 'a')), (1007.0, feed('end', 'a'))])]),
        case('an idle Locate returns the scene', [projects, ('edit', 'assign', {line(0): {'project': 'a'}}), ('edit', 'settings', {'style': 'project'}),
                                                  ('edit', 'locate', line(0)), ('run', 1004.0), ('query', 'SELECT * FROM locate')]),
        case('an early read keeps the comet to its end', [projects, feed('prompt', 'a'), ('edit', 'taskProject', 'a', 'a'),
                                                          ('edit', 'settings', {'style': 'project'}),
                                                          ('run', 1010.0, [(1003.0, feed('stop', 'a')), (1003.5, feed('read', 'a')),
                                                                           (1007.0, feed('end', 'a'))])]),
    ]
    return cases


def worker_values():
    """Each worker case's step outcomes, device requests, captured sends and the rows, scene file and device it leaves
    (worker.test.ts)."""
    cases = worker_cases()
    original = shared_input.check_envelope
    shared_input.check_envelope = lambda value, config, minimum_revision=0: dict(value)
    try:
        for record in cases:
            with tempfile.TemporaryDirectory() as temporary:
                path = Path(temporary)
                run = WorkerCase(path, record)
                record['outcomes'] = [outcome_of(lambda: run.apply(step)) for step in record['steps']]
                record['calls'] = run.device.calls
                record['sends'] = run.sends
                record['rows'] = run.rows()
                scene = path / 'scene-state.json'
                record['scene'] = json.loads(scene.read_text()) if scene.exists() else None
                record['device'] = {'selected': run.device.selected, 'brightness': run.device.brightness, 'on': run.device.on,
                                    'names': run.device.names}
                record['clock'] = run.clock.now()
    finally:
        shared_input.check_envelope = original
    write_nested('worker.json', {'scene': SCENE, 'cases': cases}, 3)


# Slice 3d: controls, holds, uncertain attempts and animation play, through Python's controller and integration ledgers.

WAVE = {'kind': 'animation.play', 'pattern': 'wave', 'colors': ['#0044aa', '#00aa66'], 'speed': 'slow'}
PANELS_REGISTRY = {'panels': {'kind': 'panels', 'ip': '192.168.1.208', 'token_ref': 'panels_token'}}
# A wall too wide for an animation's byte bound: Python's test patched effects.MAX_BYTES, which the port cannot.
WIDE = {'line_groups': [[1000 + i * 2, 1001 + i * 2] for i in range(300)], 'line_positions': [[i * 10, 0] for i in range(300)]}


def receipt_summary(code, receipt):
    """What the port compares of a ledger receipt: the admission's status and the outcome, failure and effects."""
    receipt = receipt or {}
    return {'code': code, 'outcome': receipt.get('outcome'), 'failure': (receipt.get('failure') or {}).get('code'),
            'priorEffects': receipt.get('priorEffects'), 'completed': receipt.get('completedOperations'),
            'uncertain': receipt.get('uncertainOperations')}


class ControlCase(WorkerCase):
    """A worker case with Python's controller ledger configured: v1 commands through its admission, animations through
    the integration extension, both on the case's clock."""
    def __init__(self, path, record):
        super().__init__(path, record)
        self.app = None
        self.token = None
        self.requests = {}
        self.hooks = []
        self.patches = []

    def close(self):
        for patcher in self.patches:
            patcher.stop()

    def controller(self):
        import controller_server as server
        import integration_api
        from types import SimpleNamespace
        from unittest.mock import patch
        import time as clock_module
        for module in (integration_api, server, server.state):
            patcher = patch.object(module, 'time', SimpleNamespace(time=self.clock.now, monotonic=clock_module.monotonic))
            patcher.start()
            self.patches.append(patcher)
        server.configure(self.path, 'controller', 'device', 'source')
        self.token = server.issue(self.path, 'client', ['read', 'control'])
        self.app = server.App(self.path, launch=lambda _: None)

    def apply(self, step):
        import controller_state
        import integration_api
        op, args = step[0], step[1:]
        if op == 'controller':
            self.controller()
            return None
        if op == 'command':
            command = copy.deepcopy(args[1])
            if 'sceneIndex' in command:
                index = command.pop('sceneIndex')
                ids = self.app.snapshot()['capabilities']['scenes']['sceneIds']
                command['sceneId'] = ids[index] if isinstance(index, int) else index
            snap = self.app.snapshot()
            request = dict(apiVersion='1.0', controllerId='controller', deviceId='device', requestId=snap['nextRequestId'],
                           expectedConfigurationRevision=snap['configurationRevision'], expectedGeneration=snap['generation'], command=command)
            code, receipt = self.app.admit(self.token, request)
            self.requests[args[0]] = ('command', request)
            return receipt_summary(code, receipt)
        if op == 'play':
            view = self.app.integration_animations(self.token, 'device')
            request = dict(apiVersion=integration_api.VERSION, controllerId='controller', deviceId=args[2] if len(args) > 2 else 'device',
                           requestId=view['nextRequestId'], expectedRevision=view['revision'], command=copy.deepcopy(args[1]))
            code, receipt = self.app.integration_admit(self.token, request)
            self.requests[args[0]] = ('play', request)
            return receipt_summary(code, receipt)
        if op == 'attempting':
            kind, request = self.requests[args[0]]
            sequence = request['requestId']['sequence']
            with self.db() as db, db:
                if kind == 'command':
                    receipt = json.loads(db.execute('SELECT receipt FROM controller_requests WHERE sequence=?', (sequence,)).fetchone()[0])
                    receipt['uncertainOperations'] = ['transport-1']
                    db.execute("UPDATE controller_requests SET phase='attempting',receipt=? WHERE sequence=?", (json.dumps(receipt), sequence))
                else:
                    db.execute("UPDATE integration_requests SET phase='attempting' WHERE sequence=?", (sequence,))
            return None
        if op == 'discover':
            with self.db() as db, db:
                db.execute('BEGIN IMMEDIATE')
                return controller_state.discovered(db, args[0])
        if op == 'expire':
            with self.db() as db, db:
                db.execute('BEGIN IMMEDIATE')
                integration_api.recover(db)
            return None
        if op == 'deviceState':
            return {'brightness': self.device.brightness, 'on': self.device.on, 'selected': self.device.selected}
        if op == 'desired':
            desired = self.app.snapshot()['state']['desired']
            return {'power': desired['power'], 'brightness': desired['brightness']}
        if op == 'sceneIds':
            ids = self.app.snapshot()['capabilities']['scenes']['sceneIds']
            return [len(ids), all(len(item) <= 128 and item.startswith('scene-') for item in ids)]
        if op == 'layout':
            (self.path / 'layout.json').write_text(json.dumps(args[0]))
            return None
        if op == 'register':
            # A registered Panels device with its own ledger (test_panels_controller.PanelsControllerTest).
            import controller_server as server
            config = json.loads((self.path / 'config.json').read_text())
            config.update(devices=PANELS_REGISTRY, panels_token='PRIVATE_PANELS_TOKEN')
            (self.path / 'config.json').write_text(json.dumps(config))
            server.configure(self.path, 'controller', 'panels', 'source')
            return None
        if op == 'expireAll':
            # The listener's expiry with every queued command past its time (test_expiry_during_unread_*).
            with self.db() as db, db:
                db.execute('BEGIN IMMEDIATE')
                controller_state.recover(db, now=float('inf'))
            return None
        if op == 'calls':
            return copy.deepcopy(self.device.calls)
        if op == 'hook':
            results = []
            self.hooks.append(results)
            if args[0].get('complete'):
                self.complete_hook(args[0]['step'], results)
            else:
                self.device.hooks = list(self.device.hooks) + [dict(args[0], results=results, run=self.apply)]
            return None
        return super().apply(step)

    def complete_hook(self, step, results):
        """Run `step` once as a journaled execution completes, in the window its commit opens, as
        test_control_committed_between_journaled_sends_is_applied_before_idle_exit patched Execution.complete."""
        import controller_state
        from unittest.mock import patch
        original = controller_state.Execution.complete
        def complete(execution):
            if not results:
                execution.db.commit()
                results.append(outcome_of(lambda: self.apply(step)))
                execution.db.execute('BEGIN IMMEDIATE')
            return original(execution)
        patcher = patch.object(controller_state.Execution, 'complete', complete)
        patcher.start()
        self.patches.append(patcher)

    def receipts(self):
        result = {}
        with self.db() as db:
            for name, (kind, request) in self.requests.items():
                table = 'controller_requests' if kind == 'command' else 'integration_requests'
                row = db.execute(f'SELECT receipt FROM {table} WHERE sequence=?', (request['requestId']['sequence'],)).fetchone()
                result[name] = receipt_summary(None, json.loads(row[0]) if row else None)
        return result


def control_cases():
    def case(name, steps):
        return {'name': name, 'steps': [list(step) for step in steps]}
    feed = lambda op, name: ('feed', op, name)
    ctrl = ('controller',)
    command = lambda name, value: ('command', name, value)
    play = lambda name, value=WAVE, *device: ('play', name, value, *device)
    preset = lambda name: {'kind': 'animation.play', 'preset': name}
    ROTATING = dict(WAVE, direction='clockwise', speed='faster')
    PULSE = {'kind': 'animation.play', 'pattern': 'pulse', 'colors': ['#ffffff']}
    import effects
    PRESETS = list(effects.PRESETS)
    brightness = lambda percent: {'kind': 'brightness.set', 'percent': percent}
    power_off = {'kind': 'power.set', 'on': False}
    scene = lambda index: {'kind': 'scene.activate', 'sceneIndex': index}
    machine = lambda mode: {'kind': 'mode.set', 'mode': mode}
    hold = ('query', "SELECT value FROM meta WHERE key='controller_hold_revision'")
    cases = [
        # ControlsTest.
        case('scenes are refused in Work and Quiet', [
            ctrl, ('run', 1002.0), ('sceneIds',), ('device', 'clearCalls'), ('mode', 'work'), command('w', scene(1)), ('mode', 'quiet'),
            command('q', scene(1)), ('mode', 'free'), ('run', 1004.0), ('device', 'clearCalls'), command('u', scene('scene-unknown')),
            ('countPuts',)]),
        case('power and brightness in Free are one write each', [
            ctrl, ('mode', 'free'), ('run', 1002.0), ('device', 'clearCalls'), command('b', brightness(42)), ('run', 1004.0), ('calls',),
            command('p', power_off), ('run', 1006.0), ('calls',), ('desired',), ('deviceState',), ('device', 'clearCalls'), ('run', 1008.0)]),
        case('a vanished scene fails without a write', [
            ctrl, ('run', 1002.0), ('mode', 'free'), ('run', 1004.0), command('s', scene(1)), ('discover', ['Beach Waves']),
            ('device', 'clearCalls'), ('run', 1006.0)]),
        case('brightness runs once and governs the indicators', [
            ctrl, feed('prompt', 'a'), ('run', 1005.0, [(1003.0, feed('end', 'a'))]), ('deviceState',), feed('prompt', 'b'),
            command('b', brightness(60)), ('device', 'clearCalls'), ('run', 1010.0, [(1007.0, feed('end', 'b'))]), ('scene',),
            ('deviceState',)]),
        case('an uncertain control holds the device', [
            ctrl, command('b', brightness(60)), ('device', 'fail', {'method': 'PUT'}), ('run', 1002.0), ('countPuts',),
            ('run', 1004.0), ('countPuts',), ('mode', 'quiet'), ('run', 1008.0, [(1006.0, ('mode', 'free'))]), ('countPuts',)]),
        case('a mode command cancels a queued control', [
            ctrl, command('b', brightness(60)), ('mode', 'quiet'), ('desired',),
            ('run', 1004.0, [(1001.0, ('deviceState',)), (1002.0, ('mode', 'free'))])]),
        case('a Quiet override lasts until Quiet again', [
            ctrl, ('mode', 'quiet'), ('run', 1012.0, [
                (1001.0, ('deviceState',)), (1001.0, ('scene',)), (1002.0, command('b', brightness(50))), (1005.0, ('deviceState',)),
                (1005.0, ('scene',)), (1006.0, ('mode', 'quiet')), (1009.0, ('deviceState',)), (1009.0, ('scene',)),
                (1010.0, ('mode', 'free'))]), ('desired',)]),
        case('Work restores the remembered brightness', [
            ctrl, ('run', 1002.0), command('b', brightness(70)), ('run', 1004.0), ('deviceState',), ('run', 1006.0), ('scene',),
            ('device', 'clearCalls'), ('mode', 'work'), ('run', 1008.0), ('deviceState',), ('desired',)]),
        case('power off keeps tracking', [
            ctrl, feed('prompt', 'a'), ('run', 1002.0, [(1001.0, feed('end', 'a'))]), feed('prompt', 'b'), command('p', power_off),
            ('device', 'clearCalls'), ('run', 1006.0, [(1003.0, feed('permission', 'b')), (1004.0, ('query', 'SELECT status FROM sessions')),
                                                       (1004.0, ('query', 'SELECT started FROM activity')), (1005.0, feed('interrupt', 'b'))]),
            ('calls',), ('query', 'SELECT status FROM sessions'), ('desired',), feed('prompt', 'c'), ('device', 'clearCalls'), ('mode', 'work'),
            ('desired',), ('run', 1010.0, [(1008.0, feed('interrupt', 'c'))])]),
        case('a scene plays in Free with one write', [
            ctrl, feed('prompt', 'a'), ('run', 1003.0, [(1001.0, feed('end', 'a'))]), ('mode', 'free'), ('run', 1005.0),
            ('query', 'SELECT session,started FROM activity'), ('device', 'clearCalls'), command('s', scene(1)), ('run', 1007.0), ('calls',),
            ('query', 'SELECT session,started FROM activity'), ('device', 'clearCalls'), ('run', 1009.0), ('calls',), ('mode', 'work'),
            ('run', 1011.0), ('scene',)]),
        case('Free ends the override', [
            ctrl, feed('prompt', 'a'), command('b', brightness(60)), ('run', 1004.0, [(1002.0, ('mode', 'free'))]), ('desired',),
            ('device', 'clearCalls'), ('run', 1006.0)]),
        case('brightness in Free becomes the preference', [
            ctrl, ('mode', 'free'), ('run', 1002.0), command('b', brightness(42)), ('run', 1004.0), ('scene',), ('mode', 'work'),
            ('run', 1006.0), ('scene',)]),
        case('discovery is bounded', [
            ctrl, ('device', 'names', ['Scene %d' % i for i in range(300)] + ['x' * 81]), ('device', 'selected', 'Scene 0'),
            ('run', 1002.0), ('sceneIds',), ('run', 1004.0), ('device', 'names', ['Beach Waves', 'x' * 81]),
            ('device', 'selected', 'Beach Waves'), ('run', 1006.0), ('sceneIds',)]),
        case('a power control admitted during observation', [
            ctrl, feed('prompt', 'race'), ('device', 'clearCalls'),
            ('hook', {'method': 'GET', 'endpoint': '/effects', 'step': command('p', power_off)}),
            ('run', 1004.0, [(1002.0, feed('interrupt', 'race'))]), ('deviceState',)]),
        case('a brightness control admitted during observation', [
            ctrl, feed('prompt', 'race'), ('device', 'clearCalls'),
            ('hook', {'method': 'GET', 'endpoint': '/effects', 'step': command('b', brightness(70))}),
            ('run', 1004.0, [(1002.0, feed('interrupt', 'race'))]), ('deviceState',)]),
        case('a control admitted during the last observation request', [
            ctrl, feed('prompt', 'late'), ('device', 'clearCalls'),
            ('hook', {'method': 'GET', 'endpoint': '/state', 'step': command('p', power_off)}),
            ('run', 1004.0, [(1002.0, feed('interrupt', 'late'))]), ('deviceState',)]),
        case('a control committed as an execution completes', [
            ctrl, ('mode', 'free'), ('run', 1002.0), ('device', 'clearCalls'),
            ('hook', {'complete': True, 'step': command('p', power_off)}), ('run', 1004.0)]),
        # ControllerWorkerTest.
        case('a Quiet command records its transmission', [ctrl, command('q', machine('Quiet')), ('run', 1004.0, [(1001.0, ('mode', 'free'))])]),
        case('the same Free is a no-op', [ctrl, ('mode', 'free'), ('run', 1002.0), ('device', 'clearCalls'), command('f', machine('Free')),
                                          ('run', 1004.0)]),
        case('an uncertain write is not retried', [ctrl, command('q', machine('Quiet')), ('device', 'fail', {'method': 'PUT'}),
                                                   ('run', 1002.0), ('countPuts',), ('run', 1004.0), ('countPuts',)]),
        case('a restart makes an attempt uncertain', [ctrl, command('q', machine('Quiet')), ('attempting', 'q'), ('run', 1002.0)]),
        case('a same-mode command retries after a hold', [
            ctrl, command('q', machine('Quiet')), ('device', 'fail', {'method': 'PUT'}), ('run', 1002.0), ('run', 1004.0), ('countPuts',),
            ('mode', 'quiet'), ('run', 1008.0, [(1006.0, ('mode', 'free'))]), ('countPuts',)]),
        case('a partial failure keeps its completed write', [
            ctrl, feed('prompt', 'a'), command('q', machine('Quiet')), ('device', 'fail', {'method': 'PUT', 'endpoint': '/state'}),
            ('run', 1002.0)]),
        case('an expired command never sends', [ctrl, command('q', machine('Quiet')), ('sleep', 31.0), ('run', 1033.0), hold]),
        case('a command that expires during observation never sends', [
            ctrl, command('q', machine('Quiet')), ('hook', {'method': 'GET', 'endpoint': '/effects', 'step': ('expireAll',)}),
            ('run', 1004.0), hold]),
        # AnimationTest.WorkerTest.
        case('an animation plays once after the Free handoff', [
            ctrl, feed('prompt', 'a'), ('run', 1006.0, [(1002.0, ('mode', 'free')), (1002.0, play('w'))]), ('calls',),
            ('device', 'clearCalls'), ('run', 1008.0)]),
        *[case('a mode command retires a queued animation (%s)' % label, [
            ctrl, ('mode', 'free'), ('run', 1002.0), ('device', 'clearCalls'), play('w'), retire, ('mode', 'free'), ('run', 1004.0)])
          for label, retire in (('Work', ('mode', 'work')), ('Quiet', ('mode', 'quiet')), ('Free', ('mode', 'free')),
                                ('a machine Free', command('f', machine('Free'))))],
        case('a failed animation ends uncertain', [
            ctrl, ('mode', 'free'), ('run', 1002.0), ('device', 'clearCalls'), play('w'),
            ('device', 'fail', {'endpoint': '/effects', 'payload': 'write'}), ('run', 1004.0), ('device', 'clearCalls'), ('run', 1006.0)]),
        case('an interrupted animation ends uncertain', [
            ctrl, ('mode', 'free'), ('run', 1002.0), ('device', 'clearCalls'), play('w'), ('attempting', 'w'), play('x'), ('run', 1004.0)]),
        case('scenes and animations play in admission order', [
            ctrl, ('run', 1002.0), ('mode', 'free'), ('run', 1004.0), ('device', 'clearCalls'), command('s1', scene(1)), ('sleep', 0.1),
            play('a1'), ('run', 1006.0), ('calls',), ('device', 'clearCalls'), play('a2'), ('sleep', 0.1), command('s2', scene(1)),
            ('run', 1008.0)]),
        case('an expired animation never plays', [
            ctrl, ('mode', 'free'), ('run', 1002.0), ('device', 'clearCalls'), play('w'), ('sleep', 31.0), ('run', 1035.0), hold]),
        case('an animation releases a transport hold', [
            ctrl, ('run', 1002.0), ('mode', 'free'), ('run', 1004.0), ('device', 'clearCalls'), ('device', 'fail', {'payload': 'select'}),
            command('s', scene(1)), ('run', 1006.0), hold, play('w'), hold, ('device', 'clearCalls'), ('run', 1008.0)]),
        case('an expired animation holds the device', [
            ctrl, ('mode', 'free'), ('run', 1002.0), ('device', 'clearCalls'), play('w'), ('sleep', 31.0), ('expire',), hold,
            ('query', "SELECT value FROM meta WHERE key='mode_revision'"), ('run', 1036.0)]),
        # AnimationTest.AdmissionTest.
        case('presets play in Free', [ctrl, ('mode', 'free'), ('run', 1002.0), ('device', 'clearCalls')] + [
            step for index, name in enumerate(PRESETS) for step in (play(name, preset(name)), ('run', 1004.0 + index * 2))]),
        case('animations are refused outside Free', [
            ctrl, ('mode', 'work'), play('p1', preset('ocean')), play('w1', ROTATING), ('mode', 'quiet'), play('p2', preset('ocean')),
            play('w2', ROTATING), ('status',), ('countPuts',)]),
        case('invalid animations are refused', [
            ctrl, ('mode', 'free'), play('i1', dict(preset('ocean'), preset='missing')), play('i2', dict(preset('ocean'), loop=False)),
            play('i3', dict(WAVE, pattern='pulse', direction='left')), play('i4', dict(WAVE, colors=['#12345'])), play('i5', dict(WAVE, extra=1))]),
        case('an animation too large to play is refused', [ctrl, ('mode', 'free'), ('layout', WIDE), play('w')]),
        case('only a spatial animation needs saved positions', [
            ctrl, ('mode', 'free'), ('layout', {'line_groups': SCENE['line_groups']}), play('w'), play('p', PULSE)]),
        case('an animation waits while the Free handoff is pending', [ctrl, ('mode', 'free'), play('w'), play('x')]),
        case('an animation in flight refuses another in any mode', [
            ctrl, ('mode', 'free'), ('run', 1002.0), play('w'), ('attempting', 'w'), ('mode', 'work'), play('x')]),
        case('rotating animations play', [ctrl, ('mode', 'free'), ('run', 1002.0), ('device', 'clearCalls')] + [
            step for index, (direction, pattern) in enumerate((d, p) for d in ('clockwise', 'counterclockwise') for p in ('wave', 'gradient'))
            for step in (play('r%d' % index, dict(WAVE, pattern=pattern, direction=direction, speed='faster')), ('run', 1004.0 + index * 2))]),
        # The Lines alone play requested animations (test_panels_controller.IntegrationTest).
        case('animations play only on the Lines', [
            ctrl, ('register',), ('mode', 'free'), ('mode', 'free', 'panels'), play('panels', PULSE, 'panels'), play('w', PULSE)]),
    ]
    return cases


def control_values():
    """Each control case's step outcomes, device requests, rows, scene file, device state and final receipts
    (controls.test.ts)."""
    cases = control_cases()
    original = shared_input.check_envelope
    shared_input.check_envelope = lambda value, config, minimum_revision=0: dict(value)
    try:
        for record in cases:
            with tempfile.TemporaryDirectory() as temporary:
                path = Path(temporary)
                run = ControlCase(path, record)
                try:
                    record['outcomes'] = [outcome_of(lambda: run.apply(step)) for step in record['steps']]
                    record['hooks'] = run.hooks
                    record['calls'] = run.device.calls
                    record['rows'] = run.rows()
                    scene = path / 'scene-state.json'
                    record['scene'] = json.loads(scene.read_text()) if scene.exists() else None
                    record['device'] = {'selected': run.device.selected, 'brightness': run.device.brightness, 'on': run.device.on}
                    record['receipts'] = run.receipts()
                    record['clock'] = run.clock.now()
                finally:
                    run.close()
    finally:
        shared_input.check_envelope = original
    write_nested('controls.json', {'cases': cases}, 3)


if __name__ == '__main__':
    values()
    setups()
    owner_snapshot()
    write_trace([trace(seed, 110) for seed in (1, 2, 3)] + [scripted(), scripted_placement()])
    numbers()
    rendering()
    edit_values()
    worker_values()
    control_values()
