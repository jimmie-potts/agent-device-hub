"""Local Codex lifecycle indicator. Python standard library only."""
import argparse
import base64
import contextlib
import getpass
import ipaddress
import json
import math
import os
from pathlib import Path
import shlex
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parent))
import project_map as wall

EVENTS = ('UserPromptSubmit', 'PreToolUse', 'PermissionRequest',
          'PostToolUse', 'Stop', 'Interrupt', 'SessionEnd')
BASELINE = (25, 60, 255)
COLORS = {'working': (0, 255, 0), 'question': (255, 255, 0),
          'blocked': (255, 0, 0), 'unread': BASELINE}
PRIORITY = {'working': 1, 'question': 2, 'blocked': 3, 'unread': 0}
# The controller uses decisecond frames, so 20 ticks gives a two-second cycle.
PULSE_TICKS = 20
PULSE_SECONDS = PULSE_TICKS / 10
TRAVEL_SECONDS = PULSE_SECONDS * 0.4
MIN_BRIGHTNESS = 0.2
RADIATING_PULSES = 1
COMET_SECONDS = 2.0
COMET_TRAVEL = 1.4
COMET_TAIL = 0.6
READ_SETTLE_SECONDS = 5.0
MARKER = 'nanoleaf-codex-status-v1'
INPUT_TOOLS = {'request_user_input', 'request_user_input_async', 'request_permissions'}


def windows_path(value):
    if value.startswith('/mnt/') and len(value) > 7 and value[6] == '/':
        return value[5].upper() + ':\\' + value[7:].replace('/', '\\')
    return value


def data_dir():
    adjacent = Path(__file__).resolve().parent
    if (adjacent / 'config.json').exists():
        return adjacent
    if os.name == 'nt':
        return Path(os.environ['LOCALAPPDATA']) / 'CodexNanoleaf'
    return Path.home() / '.local' / 'share' / 'codex-nanoleaf'


def light_request(config, method, endpoint='', payload=None):
    ip = ipaddress.ip_address(config['ip'])
    if ip.version != 4 or not ip.is_private:
        raise ValueError('Use a private IPv4 address for the lights.')
    token = config['token']
    if not token or not token.isalnum():
        raise ValueError('The token must contain only letters and numbers.')
    url = f'http://{ip}:16021/api/v1/{token}{endpoint}'
    body = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request(url, data=body, method=method,
                                     headers={'Content-Type': 'application/json'})
    # Keep local-device traffic off configured HTTP proxies.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(request, timeout=1.2) as response:
        data = response.read()
        return json.loads(data) if data else None


def pair_lines(panel_layout):
    """Pair the two collinear light zones of each NL59 Line, excluding connectors."""
    zones = [p for p in panel_layout['layout']['positionData'] if p['shapeType'] == 18]
    if not zones or len(zones) % 2:
        raise ValueError('Expected two light zones per Line.')
    nearest = {}
    by_id = {p['panelId']: p for p in zones}
    for a in zones:
        candidates = []
        angle = math.radians(a['o'])
        for other in zones:
            if a == other or (a['o'] - other['o']) % 180:
                continue
            dx, dy = other['x'] - a['x'], other['y'] - a['y']
            # Orientation zero follows the y axis in the controller's layout.
            if abs(dx * math.cos(angle) + dy * math.sin(angle)) < 3:
                candidates.append((math.hypot(dx, dy), other['panelId']))
        if not candidates:
            raise ValueError('Could not pair a Line zone.')
        nearest[a['panelId']] = min(candidates)[1]
    pairs = set()
    for first, second in nearest.items():
        if nearest.get(second) != first:
            raise ValueError('Line zone pairing is ambiguous.')
        pairs.add(tuple(sorted((first, second))))
    # Follow the installed orientation for a spatially ordered notification sweep.
    orientation = math.radians(panel_layout['globalOrientation']['value'])
    def location(pair):
        x = sum(by_id[p]['x'] for p in pair) / 2
        y = sum(by_id[p]['y'] for p in pair) / 2
        return (round(x * math.cos(orientation) - y * math.sin(orientation)),
                round(x * math.sin(orientation) + y * math.cos(orientation)))
    return [list(pair) for pair in sorted(pairs, key=location)]


def load_config(directory):
    config = json.loads((directory / 'config.json').read_text())
    layout_file = directory / 'layout.json'
    saved = json.loads(layout_file.read_text()) if layout_file.exists() else {}
    if not saved.get('line_positions'):
        layout = light_request(config, 'GET')['panelLayout']
        groups = saved.get('line_groups') or pair_lines(layout)
        zones = {p['panelId']: p for p in layout['layout']['positionData']}
        positions = [[sum(zones[p]['x'] for p in pair) / 2,
                      sum(zones[p]['y'] for p in pair) / 2] for pair in groups]
        saved = {'line_groups': groups, 'line_positions': positions}
        write_json(layout_file, saved)
    config.update(saved)
    groups = config['line_groups']
    ids = [p for pair in groups for p in pair]
    if (not groups or any(len(pair) != 2 for pair in groups) or
            len(ids) != len(set(ids)) or any(not isinstance(p, int) for p in ids)):
        raise ValueError('Invalid physical Line mapping.')
    if len(config['line_positions']) != len(groups):
        raise ValueError('Each Line needs a position for outward pulses.')
    return config


def pulse_amplitude(age):
    if age < 0:
        return 0.0
    phase = (age % PULSE_SECONDS) / PULSE_SECONDS
    if phase < 0.2:
        return phase / 0.2
    if phase < 0.3:
        return 1.0
    if phase < 0.5:
        return (0.5 - phase) / 0.2
    return 0.0


def travel_delays(config, source):
    positions = config['line_positions']
    distances = [math.dist(positions[source], target) for target in positions]
    maximum = max(distances) or 1.0
    return [distance / maximum * TRAVEL_SECONDS for distance in distances]


def pixel_color(snapshot, target, instant, delays, wave_cutoff=float('-inf')):
    candidates = []
    for source, activity in enumerate(snapshot):
        if activity is None:
            continue
        status, epoch = activity
        age = instant - epoch
        if source != target:
            if status == 'unread' or epoch <= wave_cutoff:
                continue
            age -= delays[source][target]
            if not 0 <= age < RADIATING_PULSES * PULSE_SECONDS:
                continue
        amplitude = pulse_amplitude(age)
        # An assigned Line keeps its status hue even between flashes. Other
        # Lines receive that hue only while the initial wave passes them.
        if source == target or amplitude > 0.001:
            candidates.append((PRIORITY[status], amplitude, status))
    if not candidates:
        return BASELINE
    _, amount, status = max(candidates)
    brightness = MIN_BRIGHTNESS + (1 - MIN_BRIGHTNESS) * amount
    return tuple(round(color * brightness) for color in COLORS[status])


def comet_color(config, snapshot, target, instant, delays, base):
    comet = config.get('_comet')
    if not comet or config.get('_mode', 'work') != 'work':
        return base
    cutoff = config.get('_wave_cutoff', float('-inf'))
    for source, activity in enumerate(snapshot):
        if not activity or activity[0] not in ('blocked', 'question'):
            continue
        if source == target:
            return base
        age = instant - activity[1] - delays[source][target]
        if activity[1] > cutoff and 0 <= age < PULSE_SECONDS and pulse_amplitude(age) > 0.001:
            return base
    positions = config['line_positions']
    distances = [math.dist(positions[comet['source']], point) for point in positions]
    arrival = COMET_TRAVEL * distances[target] / (max(distances) or 1.0)
    age = instant - comet['started'] - arrival
    if not 0 <= age < COMET_TAIL:
        return base
    blue = min(1.0, max(0.0, (age - 0.1) / 0.1))
    color = [255 + (channel - 255) * blue for channel in BASELINE]
    alpha = min(1.0, (COMET_TAIL - age) / 0.4)
    return tuple(round(background * (1 - alpha) + foreground * alpha)
                 for background, foreground in zip(base, color))


def introduction_ends(snapshot):
    return max((epoch + (RADIATING_PULSES - 0.5) * PULSE_SECONDS + TRAVEL_SECONDS
                for activity in snapshot if activity and activity[0] != 'unread' for _, epoch in [activity]), default=0)


def unread_reader(config):
    """Read the desktop's unread indicator, never write to its saved state."""
    if config.get('desktop_state_path'):
        path = Path(config['desktop_state_path'])
    elif os.name == 'nt':
        path = Path(os.environ.get('USERPROFILE', str(Path.home()))) / '.codex' / '.codex-global-state.json'
    else:
        path = Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex'))) / '.codex-global-state.json'
    stamp, cached = None, None
    def read():
        nonlocal stamp, cached
        try:
            stat = path.stat()
            current = (stat.st_mtime_ns, stat.st_size)
            if current != stamp:
                state = json.loads(path.read_text(encoding='utf-8-sig'))
                ids = state['electron-persisted-atom-state']['unread-thread-ids-by-host-v1']['local']
                if not isinstance(ids, list) or any(not isinstance(i, str) for i in ids):
                    return None
                cached, stamp = set(ids), current
            return cached
        except (OSError, ValueError, KeyError, TypeError):
            return None  # Missing or partial state is not evidence that a task was read.
    return read


def reconcile_read_state(db, unread, instant):
    if unread is None:
        return
    # Include completed tasks already known to the integration when it upgrades.
    for session, turn, completed in db.execute("SELECT id,turn,updated FROM sessions WHERE status='ended'").fetchall():
        if session in unread:
            db.execute("UPDATE sessions SET status='unread' WHERE id=?", (session,))
            db.execute('INSERT OR REPLACE INTO receipts VALUES (?, ?, ?, 1)', (session, turn, completed))
            db.execute("INSERT OR REPLACE INTO activity VALUES (?, ?, 'unread', ?)", (session, turn, instant))
            mark_dirty(db)
    for session, turn, completed, observed in db.execute('SELECT * FROM receipts').fetchall():
        if session in unread:
            if not observed:
                db.execute('UPDATE receipts SET observed=1 WHERE session=?', (session,))
        elif observed or instant >= completed + READ_SETTLE_SECONDS:
            # The app can publish its unread flag after Stop. Allow that write
            # to settle before interpreting an absent flag as an already-viewed task.
            db.execute("UPDATE sessions SET status='ended' WHERE id=? AND turn=? AND status='unread'", (session, turn))
            db.execute('DELETE FROM receipts WHERE session=?', (session,))
            db.execute("DELETE FROM activity WHERE session=? AND turn=? AND status='unread'", (session, turn))
            mark_dirty(db)


def zone_color(config, snapshot, index, half, instant, delays):
    quiet = config.get('_mode') == 'quiet'
    activity = snapshot[index]
    base = (COLORS[activity[0]] if activity else BASELINE) if quiet else pixel_color(
        snapshot, index, instant, delays, config.get('_wave_cutoff', float('-inf')))
    signature = None
    if config.get('_style') == 'project':
        signatures = config.get('_signatures', [])
        if index < len(signatures):
            color, side = signatures[index]
            if half == side: signature = tuple(color) if color is not None else BASELINE
    if signature is not None:
        base = signature
        if not quiet and config.get('_coverage') == 'whole':
            candidates = []
            for source, item in enumerate(snapshot):
                if not item or item[0] == 'unread' or item[1] <= config.get('_wave_cutoff', float('-inf')): continue
                age = instant - item[1] - (delays[source][index] if source != index else 0)
                if not 0 <= age < PULSE_SECONDS: continue
                amount = pulse_amplitude(age)
                if amount <= .001: continue
                if activity and PRIORITY[activity[0]] > PRIORITY[item[0]]: continue
                candidates.append((PRIORITY[item[0]], amount, item[0]))
            if candidates:
                _, amount, status = max(candidates)
                base = tuple(round(a*(1-amount)+b*amount) for a,b in zip(signature,COLORS[status]))
    if not quiet and (signature is None or config.get('_coverage') == 'whole'):
        base = comet_color(config, snapshot, index, instant, delays, base)
    locate = config.get('_locate')
    if locate and locate['source'] == index and 0 <= instant - locate['started'] < 1:
        return (255,255,255)
    return base


def effect_payload(config, snapshot, instant, loop):
    groups = config['line_groups']
    if len(snapshot) != len(groups):
        raise ValueError('Task display does not match the physical Lines.')
    quiet = config.get('_mode') == 'quiet'
    comet = config.get('_comet') if config.get('_mode', 'work') == 'work' else None
    locate = config.get('_locate')
    animated = bool(any(snapshot) or comet or locate) and not quiet
    delays = [travel_delays(config, source) for source in range(len(groups))]
    data = [len(groups) * 2]
    for index, pair in enumerate(groups):
        ticks = [1] + list(range(2, PULSE_TICKS, 2)) + [PULSE_TICKS] if animated else [1]
        if comet: ticks = list(range(1, PULSE_TICKS + 1))
        for half, panel in enumerate(pair):
            frames, previous = [], 0
            for tick in ticks:
                instant_at = instant + tick / 10
                color = zone_color(config, snapshot, index, half, instant_at, delays)
                frames.append((*color, 0, tick - previous))
                previous = tick
            data.extend([panel, len(frames)])
            for step in frames: data.extend(step)
    return {'write': {'command': 'display', 'version': '2.0',
                      'animType': 'custom' if animated else 'static',
                      'animData': ' '.join(map(str, data)), 'loop': bool(loop and animated and not comet and not locate),
                      'colorType': 'HSB', 'logicalPanelsEnabled': True,
                      'palette': [{'hue': 0, 'saturation': 0, 'brightness': 100}]}}


def render(config, snapshot, instant, loop):
    request = config.get('_controller_request', light_request)
    request(config, 'PUT', '/effects', effect_payload(config, snapshot, instant, loop))
    request(config, 'PUT', '/state', {'on': {'value': True},
                                           'brightness': {'value': 10 if config.get('_mode') == 'quiet' else 30, 'duration': 0}})


class SceneRestorer:
    """Remember named scenes before takeover, and restore after the last indicator."""
    def __init__(self, directory, config, request=None, draw=None):
        self.path = directory / 'scene-state.json'
        self.config = config
        self.request = request or light_request
        self.draw = draw or render
        self.state = {'version': 1, 'scene': None, 'owned': False, 'quiet_scene': None}
        if self.path.exists():
            saved = json.loads(self.path.read_text(encoding='utf-8-sig'))
            scene = saved.get('scene')
            if (saved.get('version') != 1 or type(saved.get('owned')) is not bool or
                    (scene is not None and not self.valid_scene(scene))):
                raise ValueError('Invalid saved scene state.')
            self.state.update({key: saved[key] for key in self.state if key in saved})
        self.selected = None
        self.available = set()

    @staticmethod
    def valid_scene(scene):
        return (isinstance(scene, dict) and isinstance(scene.get('name'), str) and
                bool(scene['name']) and type(scene.get('brightness')) is int and
                0 <= scene['brightness'] <= 100)

    def save(self, **changes):
        updated = {**self.state, **changes}
        if updated != self.state:
            write_json(self.path, updated)
            self.state = updated

    def observe(self):
        effects = self.request(self.config, 'GET', '/effects')
        names = effects.get('effectsList')
        selected = effects.get('select')
        if (not isinstance(names, list) or any(not isinstance(name, str) for name in names)
                or not isinstance(selected, str)):
            raise ValueError('Invalid scene list from controller.')
        self.available = set(names)
        self.selected = selected
        if selected in self.available:
            state = self.request(self.config, 'GET', '/state')
            scene = {'name': selected, 'brightness': state['brightness']['value']}
            if not self.valid_scene(scene):
                raise ValueError('Invalid scene brightness from controller.')
            # Save before taking over. Temporary *Dynamic* task effects are
            # absent from the saved scene list and can never replace this target.
            if not (selected == self.state['quiet_scene'] and scene['brightness'] == 10):
                self.save(scene=scene, quiet_scene=None)
            return True
        return False

    def send(self, config, snapshot, instant, loop):
        if any(snapshot) or config.get('_comet') or config.get('_locate'):
            self.save(owned=True)
            self.draw(config, snapshot, instant, loop)
            self.save(quiet_scene=None)
            self.selected = '*Dynamic*'
            return
        quiet = config.get('_mode') == 'quiet'
        if self.selected == '*ExtControl*' and config.get('_mode') == 'free':
            self.save(owned=False, quiet_scene=None)
            return
        if self.selected in self.available:
            # A manually chosen scene is already playing. Leave its animation
            # running instead of restarting it on every idle hook event.
            if quiet:
                if self.state['quiet_scene'] != self.selected:
                    self.save(quiet_scene=self.selected, owned=True)
                    self.request(config, 'PUT', '/state', {'brightness': {'value': 10, 'duration': 0}})
            elif self.state['quiet_scene'] == self.selected:
                self.request(config, 'PUT', '/state', {'brightness': {
                    'value': self.state['scene']['brightness'], 'duration': 0}})
                self.save(quiet_scene=None)
            self.save(owned=quiet)
            return
        if not self.state['owned'] and not quiet:
            return
        scene = self.state['scene']
        if scene and scene['name'] in self.available:
            # Restore brightness first. If selection succeeds but its response
            # is lost, the next observation still sees the correct saved values.
            self.save(quiet_scene=scene['name'] if quiet else None)
            self.request(config, 'PUT', '/state', {'on': {'value': True},
                         'brightness': {'value': 10 if quiet else scene['brightness'], 'duration': 0}})
            self.request(config, 'PUT', '/effects', {'select': scene['name']})
            self.selected = scene['name']
        else:
            # The first scene has not been chosen yet, or it was deleted.
            self.draw(config, snapshot, instant, loop)
            self.selected = '*Static*'
        self.save(owned=quiet)


def connect_state(directory):
    db = sqlite3.connect(directory / 'status.sqlite', timeout=2.5)
    try:
        with db:
            db.execute('BEGIN IMMEDIATE')
            wall.init(db)
            db.execute('CREATE TABLE IF NOT EXISTS sessions '
                       '(id TEXT PRIMARY KEY, turn TEXT, status TEXT, updated REAL)')
            db.execute('CREATE TABLE IF NOT EXISTS slots (session TEXT PRIMARY KEY, slot INTEGER UNIQUE)')
            db.execute('CREATE TABLE IF NOT EXISTS waits '
                       '(session TEXT, turn TEXT, key TEXT, kind TEXT, tool TEXT, '
                       'PRIMARY KEY(session, turn, key))')
            db.execute('CREATE TABLE IF NOT EXISTS activity '
                       '(session TEXT PRIMARY KEY, turn TEXT, status TEXT, started REAL)')
            db.execute('CREATE TABLE IF NOT EXISTS receipts '
                       '(session TEXT PRIMARY KEY, turn TEXT, completed REAL, observed INTEGER)')
            db.execute('CREATE TABLE IF NOT EXISTS display_v3 '
                       '(id INTEGER PRIMARY KEY, snapshot TEXT, looping INTEGER, rendered REAL)')
            db.execute('CREATE TABLE IF NOT EXISTS comets '
                       '(session TEXT PRIMARY KEY, turn TEXT, queued REAL, source INTEGER, started REAL)')
            db.execute('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)')
            if db.execute("SELECT value FROM meta WHERE key='model_version'").fetchone() != ('4',):
                # This is only the integration's own database. Replace old lighting
                # notifications and initialize the outward pulse for current work.
                for table in ('signals', 'notifications'):
                    if db.execute('SELECT 1 FROM sqlite_master WHERE name=?', (table,)).fetchone():
                        db.execute('DELETE FROM ' + table)
                db.execute("UPDATE sessions SET status='blocked' WHERE status='approval'")
                db.execute('INSERT OR REPLACE INTO activity '
                           "SELECT id,turn,status,? FROM sessions WHERE status IN ('working','question','blocked','unread')",
                           (time.time(),))
                db.execute("INSERT OR REPLACE INTO meta VALUES ('model_version','4')")
    except BaseException:
        db.close()
        raise
    return db


MODES = ('work', 'free', 'quiet')


def control_state(db):
    meta = dict(db.execute('SELECT key,value FROM meta'))
    return {'mode': meta.get('mode', 'work'),
            'revision': int(meta.get('mode_revision', '0')),
            'applied': int(meta.get('mode_applied', '0')),
            'wave_cutoff': float(meta.get('wave_cutoff', '-inf')),
            'error': meta.get('control_error')}


def change_mode(db, mode, instant, notify=True):
    import controller_state
    state = control_state(db)
    if state['mode'] != mode:
        values = {'mode': mode, 'mode_revision': str(state['revision'] + 1)}
        if mode == 'work':
            values['wave_cutoff'] = str(instant)
        db.executemany('INSERT OR REPLACE INTO meta VALUES (?, ?)', values.items())
        db.execute("DELETE FROM meta WHERE key='preview'")
        db.execute('DELETE FROM comets')
        db.execute('DELETE FROM locate')
        mark_dirty(db)
        if notify:
            controller_state.changed(db, mode=True)
        return True
    if notify:
        controller_state.changed(db, mode=True)
    return state['revision'] != state['applied'] or bool(state['error'])


def set_mode(directory, mode, launch=None, now=time.time):
    if mode not in MODES:
        raise ValueError('Unknown lighting mode.')
    with contextlib.closing(connect_state(directory)) as db, db:
        db.execute('BEGIN IMMEDIATE')
        needed = change_mode(db, mode, now())
    if needed:
        (launch or launch_worker)(directory)


def get_status(directory):
    # Tray polling never initializes or migrates a database.
    with contextlib.closing(sqlite3.connect(
            (directory / 'status.sqlite').resolve().as_uri() + '?mode=ro', uri=True, timeout=0.2)) as db:
        state = control_state(db)
    return {'mode': state['mode'], 'pending': state['revision'] != state['applied'],
            'error': state['error']}


def mark_dirty(db):
    db.execute("INSERT INTO meta VALUES ('event_revision', '1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1")
    db.execute("INSERT OR REPLACE INTO meta VALUES ('dirty', '1')")


def transition(db, event, now):
    """Separate a question during work from a request that blocks progress."""
    name, session = event.get('hook_event_name'), event.get('session_id')
    if name not in EVENTS or not isinstance(session, str) or not session:
        return False
    old = db.execute('SELECT turn, status FROM sessions WHERE id=?', (session,)).fetchone()
    if name == 'SessionEnd':
        if old and old[1] == 'unread':
            return False  # Closing a runtime is not a read receipt.
        for table in ('waits', 'slots', 'activity', 'receipts'):
            db.execute('DELETE FROM ' + table + ' WHERE session=?', (session,))
        db.execute('DELETE FROM sessions WHERE id=?', (session,))
        return bool(old)
    turn = event.get('turn_id')
    if not isinstance(turn, str) or not turn:
        return False
    if old and old[0] != turn and name != 'UserPromptSubmit':
        return False
    if old and old[1] in ('ended', 'idle', 'unread') and name not in ('UserPromptSubmit', 'Interrupt'):
        return False
    tool = str(event.get('tool_name') or '')
    short_tool = tool.rsplit('.', 1)[-1]
    call_id = str(event.get('tool_use_id') or tool)
    if name in ('UserPromptSubmit', 'Interrupt'):
        db.execute('DELETE FROM comets WHERE session=?', (session,))
        db.execute('DELETE FROM receipts WHERE session=?', (session,))
    if name == 'UserPromptSubmit':
        db.execute('DELETE FROM waits WHERE session=?', (session,))
        db.execute('DELETE FROM receipts WHERE session=?', (session,))
        status = 'working'
    elif name == 'Interrupt':
        db.execute('DELETE FROM waits WHERE session=?', (session,))
        status = 'idle'
    else:
        if name == 'PermissionRequest':
            db.execute('INSERT OR REPLACE INTO waits VALUES (?, ?, ?, ?, ?)',
                       (session, turn, 'permission:' + tool, 'permission', tool))
        elif name == 'PreToolUse' and short_tool in INPUT_TOOLS:
            kind = 'async' if short_tool.endswith('_async') else 'input'
            db.execute('INSERT OR REPLACE INTO waits VALUES (?, ?, ?, ?, ?)',
                       (session, turn, 'input:' + call_id, kind, tool))
        elif name == 'PostToolUse':
            db.execute("DELETE FROM waits WHERE session=? AND turn=? AND "
                       "((kind='permission' AND tool=?) OR (kind='input' AND key=?))",
                       (session, turn, tool, 'input:' + call_id))
        elif name == 'Stop':
            db.execute("DELETE FROM waits WHERE session=? AND kind NOT IN ('async','async_stopped')", (session,))
            db.execute("UPDATE waits SET kind='async_stopped' WHERE session=? AND kind='async'", (session,))
        kinds = {row[0] for row in db.execute('SELECT kind FROM waits WHERE session=?', (session,))}
        if kinds - {'async'}:
            status = 'blocked'
        elif kinds:
            status = 'question'
        else:
            status = 'unread' if name == 'Stop' else 'working'
            if name == 'Stop':
                db.execute('INSERT OR REPLACE INTO receipts VALUES (?, ?, ?, 0)', (session, turn, now))
    db.execute('INSERT OR REPLACE INTO sessions VALUES (?, ?, ?, ?)',
               (session, turn, status, now))
    changed = old != (turn, status)
    if changed:
        if status == 'unread' and name == 'Stop' and control_state(db)['mode'] == 'work':
            db.execute('INSERT OR IGNORE INTO comets VALUES (?, ?, ?, NULL, NULL)', (session, turn, now))
        if status in COLORS:
            db.execute('INSERT OR REPLACE INTO activity VALUES (?, ?, ?, ?)',
                       (session, turn, status, now))
        else:
            db.execute('DELETE FROM activity WHERE session=?', (session,))
    return changed


def dashboard(db, config, instant):
    rows = db.execute("SELECT id,turn,status FROM sessions WHERE status IN ('working','question','blocked','unread') "
                      "ORDER BY CASE status WHEN 'blocked' THEN 0 WHEN 'question' THEN 1 ELSE 2 END, updated, id").fetchall()
    active = {row[0] for row in rows}
    db.execute('DELETE FROM slots WHERE session NOT IN (SELECT id FROM sessions)')
    count = len(config['line_groups'])
    reserved = {row[0] for row in db.execute('SELECT source FROM comets WHERE started IS NOT NULL')}
    assigned = wall.allocate(db, config, rows, reserved)
    epochs = {s: (turn, status, epoch) for s, turn, status, epoch in db.execute('SELECT * FROM activity')}
    snapshot = [None] * count
    for session, turn, status in rows:
        if session not in assigned or assigned[session] >= count:
            continue
        old = epochs.get(session)
        if not old or old[:2] != (turn, status):
            old = (turn, status, instant)
            db.execute('INSERT OR REPLACE INTO activity VALUES (?, ?, ?, ?)', (session, *old))
        snapshot[assigned[session]] = (status, old[2])
    return snapshot


def prune_comets(db, instant, mode):
    if mode != 'work':
        db.execute('DELETE FROM comets')
        return
    db.execute('DELETE FROM comets WHERE started IS NOT NULL AND started + ? <= ?',
               (COMET_SECONDS, instant))
    db.execute("DELETE FROM comets WHERE started IS NULL AND NOT EXISTS "
               "(SELECT 1 FROM sessions s WHERE s.id=comets.session AND s.turn=comets.turn AND s.status='unread')")


def current_comet(db, instant):
    row = db.execute('SELECT source,started FROM comets WHERE started IS NOT NULL').fetchone()
    if not row:
        candidate = db.execute('SELECT c.session,s.slot FROM comets c JOIN slots s ON s.session=c.session '
                               'WHERE c.started IS NULL ORDER BY c.queued,c.rowid LIMIT 1').fetchone()
        if candidate:
            session, source = candidate
            db.execute('UPDATE comets SET source=?,started=? WHERE session=?', (source, instant, session))
            row = (source, instant)
    return dict(zip(('source', 'started'), row)) if row else None


def update_display(db, config, snapshot, instant, loop, send=None):
    encoded = json.dumps([snapshot, config.get('_comet'), config.get('_locate'),
                          config.get('_style'), config.get('_coverage'), config.get('_signatures')])
    previous = db.execute('SELECT snapshot,looping FROM display_v3 WHERE id=1').fetchone()
    if not loop or previous != (encoded, 1):
        (send or render)(config, snapshot, instant, loop)
        db.execute('INSERT OR REPLACE INTO display_v3 VALUES (1, ?, ?, ?)', (encoded, int(loop), instant))


def launch_worker(directory):
    options = {'stdin': subprocess.DEVNULL, 'stdout': subprocess.DEVNULL,
               'stderr': subprocess.DEVNULL, 'close_fds': True}
    if os.name == 'nt':
        options['creationflags'] = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        options['start_new_session'] = True
    subprocess.Popen([sys.executable, str(Path(__file__).resolve()), 'worker',
                      '--state-dir', str(directory.resolve())], **options)


def handle_event(directory, event, launch=None, now=time.time):
    with contextlib.closing(connect_state(directory)) as db, db:
        db.execute('BEGIN IMMEDIATE')
        instant = now()
        changed = transition(db, event, instant)
        metadata_changed = wall.record_event(db, event, instant)
        if changed or metadata_changed:
            mark_dirty(db)
        needed = db.execute("SELECT 1 FROM meta WHERE key IN ('dirty','rendering','preview') LIMIT 1").fetchone()
    if needed:
        (launch or launch_worker)(directory)


def play_preview(config, choice, send, sleep, now):
    config = dict(config, _comet=None, _locate=None)
    if choice == 'comet':
        cfg = dict(config, _comet={'source': len(config['line_groups']) // 2, 'started': now()})
        send(cfg, [None] * len(config['line_groups']), now(), False)
        sleep(COMET_SECONDS)
        return
    choices = tuple(COLORS) if choice == 'all' else (choice,)
    source = len(config['line_groups']) // 2
    for status in choices:
        epoch = now()
        snapshot = [None] * len(config['line_groups'])
        snapshot[source] = (status, epoch)
        for _ in range(RADIATING_PULSES):
            started = now()
            send(config, snapshot, started, False)
            sleep(max(0, started + PULSE_SECONDS - now()))
        send(config, snapshot, now(), True)
        sleep(PULSE_SECONDS)
    send(config, [None] * len(config['line_groups']), now(), True)
    sleep(2)


def run_worker(directory, send=None, sleep=time.sleep, now=time.time, read_unread=None,
               scene_factory=SceneRestorer):
    with contextlib.closing(sqlite3.connect(directory / 'notification-lock.sqlite', timeout=0)) as guard:
        try:
            guard.execute('BEGIN EXCLUSIVE')
        except sqlite3.OperationalError as error:
            if error.sqlite_errorcode == sqlite3.SQLITE_BUSY:
                return
            raise
        import controller_state
        with contextlib.closing(connect_state(directory)) as db, db:
            db.execute('BEGIN IMMEDIATE')
            controller_state.recover(db, attempts=True)
            if controller_state.held(db, control_state(db)['revision']):
                return
        config = load_config(directory)
        read_unread = read_unread or unread_reader(config)
        scenes = scene_factory(directory, config) if scene_factory else None
        metadata = wall.Metadata(directory, config)
        sender = send or (scenes.send if scenes else render)
        active_execution = [None]
        request = scenes.request if scenes else light_request
        def controller_request(*args, **kwargs):
            execution = active_execution[0]
            if execution is not None and args[1] != 'GET':
                return execution.call(request, *args, **kwargs)
            return request(*args, **kwargs)
        config['_controller_request'] = controller_request
        if scenes:
            scenes.request = controller_request
        while True:
            metadata.refresh()
            with contextlib.closing(connect_state(directory)) as db, db:
                if metadata.sync(db): mark_dirty(db)
                control = control_state(db)
                if controller_state.held(db, control['revision']):
                    return
            mode = control['mode']
            pending_mode = control['revision'] != control['applied']
            config.update(_mode=mode, _wave_cutoff=control['wave_cutoff'])
            # Free mode does not even poll the light controller after handoff.
            external_scene = scenes.observe() if scenes and (mode != 'free' or pending_mode) else False
            with contextlib.closing(connect_state(directory)) as db, db:
                db.execute('BEGIN IMMEDIATE')
                if controller_state.held(db, control['revision']):
                    return
                if control_state(db)['revision'] != control['revision']:
                    continue
                preview = db.execute("SELECT value FROM meta WHERE key='preview'").fetchone()
                if preview:
                    db.execute("DELETE FROM meta WHERE key='preview'")
            if preview and mode != 'free':
                def preview_send(cfg, snap, instant, loop):
                    with contextlib.closing(connect_state(directory)) as check, check:
                        check.execute('BEGIN IMMEDIATE')
                        if (controller_state.held(check, control['revision']) or
                                control_state(check)['revision'] != control['revision']):
                            raise PreviewCancelled()
                        sender(cfg, snap, instant, loop)
                def preview_sleep(seconds):
                    deadline = now() + seconds
                    while now() < deadline:
                        sleep(min(0.25, deadline - now()))
                        with contextlib.closing(connect_state(directory)) as check:
                            if control_state(check)['revision'] != control['revision']:
                                raise PreviewCancelled()
                try:
                    play_preview(config, preview[0], preview_send, preview_sleep, now)
                except PreviewCancelled:
                    pass
                with contextlib.closing(connect_state(directory)) as db, db:
                    db.execute('DELETE FROM display_v3')
                continue
            started = now()
            unread = read_unread()
            with contextlib.closing(connect_state(directory)) as db, db:
                db.execute('BEGIN IMMEDIATE')
                if controller_state.held(db, control['revision']):
                    return
                if control_state(db)['revision'] != control['revision']:
                    continue
                reconcile_read_state(db, unread, started)
                prune_comets(db, started, mode)
                if wall.apply_pending(db): mark_dirty(db)
                config['_locate'] = wall.locate_state(db, config, started, mode)
                snapshot = dashboard(db, config, started)
                config['_comet'] = current_comet(db, started) if mode == 'work' and not config['_locate'] else None
                wall.render_config(db, config, snapshot)
                generation = db.execute("SELECT value FROM meta WHERE key='event_revision'").fetchone()
                db.commit()
                db.execute('BEGIN IMMEDIATE')
                if controller_state.held(db, control['revision']):
                    return
                if (control_state(db)['revision'] != control['revision'] or
                        db.execute("SELECT value FROM meta WHERE key='event_revision'").fetchone() != generation):
                    continue
                waves = [item if item and item[1] > control['wave_cutoff'] else None for item in snapshot]
                loop = not config['_locate'] and (mode != 'work' or (not config['_comet'] and started >= introduction_ends(waves)))
                if pending_mode or (scenes and mode != 'free' and
                        (external_scene or (bool(any(snapshot) or config['_comet'] or config['_locate']) or mode == 'quiet') != scenes.state['owned'])):
                    db.execute('DELETE FROM display_v3')
                execution = controller_state.Execution(db, control['revision'])
                active_execution[0] = execution
                def guarded_sender(*args):
                    return execution.call(sender, *args) if send else sender(*args)
                try:
                    if mode == 'free':
                        if pending_mode:
                            guarded_sender(config, [None] * len(snapshot), started, True)
                        db.execute('DELETE FROM display_v3')
                    else:
                        update_display(db, config, snapshot, started, loop, guarded_sender)
                    execution.complete()
                except controller_state.Cancelled:
                    db.commit()
                    continue
                finally:
                    active_execution[0] = None
                # A concurrent decision can commit between journaled sends.
                if controller_state.held(db, control['revision']):
                    return
                if control_state(db)['revision'] != control['revision']:
                    continue
                db.execute("INSERT OR REPLACE INTO meta VALUES ('mode_applied', ?)", (str(control['revision']),))
                db.execute("DELETE FROM meta WHERE key IN ('dirty','control_error')")
                watching = (bool(db.execute('SELECT 1 FROM receipts LIMIT 1').fetchone()) or
                            bool(scenes and mode != 'free' and (any(snapshot) or config['_comet'] or config['_locate'] or mode == 'quiet')))
                settling = db.execute('SELECT MIN(completed + ?) FROM receipts WHERE observed=0',
                                      (READ_SETTLE_SECONDS,)).fetchone()[0]
                if loop and not watching:
                    db.execute("DELETE FROM meta WHERE key='rendering'")
                    guard.rollback()
                    return
                db.execute("INSERT OR REPLACE INTO meta VALUES ('rendering','1')")
            deadline = started + (1.0 if loop else PULSE_SECONDS)
            if config['_locate']:
                deadline = min(deadline, config['_locate']['started'] + 1)
            if config['_comet']:
                deadline = min(deadline, config['_comet']['started'] + COMET_SECONDS)
            if unread is not None and settling is not None and settling > started:
                deadline = min(deadline, settling)
            while now() < deadline:
                sleep(min(0.25, deadline - now()))
                with contextlib.closing(sqlite3.connect(directory / 'status.sqlite', timeout=2.5)) as db:
                    dirty = db.execute("SELECT 1 FROM meta WHERE key IN ('dirty','preview') LIMIT 1").fetchone()
                if dirty or (watching and read_unread() != unread):
                    break


class PreviewCancelled(Exception):
    pass


def hook_command(script):
    if os.name == 'nt':
        # Select PowerShell explicitly, regardless of Codex's command shell.
        quote = lambda text: "'" + str(text).replace("'", "''") + "'"
        source = '& ' + quote(sys.executable) + ' ' + quote(script) + ' hook'
        encoded = base64.b64encode(source.encode('utf-16le')).decode('ascii')
        windows = 'powershell.exe -NoProfile -NonInteractive -EncodedCommand ' + encoded
        drive, rest = str(script).split(':', 1)
        wsl_script = '/mnt/' + drive.lower() + rest.replace('\\', '/')
        return shlex.join(['python3', wsl_script, 'hook']), windows
    return shlex.join([sys.executable, str(script), 'hook']), None


def merge_hooks(original, command, remove=False, windows_command=None):
    result = json.loads(json.dumps(original))
    hooks = result.setdefault('hooks', {})
    for name in EVENTS:
        groups = hooks.get(name, [])
        # Remove only handlers belonging to this integration, keeping others intact.
        clean = []
        for group in groups:
            item = dict(group)
            item['hooks'] = [h for h in group.get('hooks', [])
                             if h.get('statusMessage') != MARKER]
            if item['hooks']:
                clean.append(item)
        if not remove:
            handler = {'type': 'command', 'command': command,
                       'timeout': 3 if name in ('SessionEnd', 'Interrupt') else 5,
                       'statusMessage': MARKER}
            if windows_command:
                handler['commandWindows'] = windows_command
            clean.append({'hooks': [handler]})
        if clean:
            hooks[name] = clean
        else:
            hooks.pop(name, None)
    return result


def write_json(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')
    if os.name != 'nt':
        temporary.chmod(0o600)
    temporary.replace(path)


def setup(args):
    directory = data_dir()
    directory.mkdir(parents=True, exist_ok=True)
    config_file = directory / 'config.json'
    if args.check or args.demo or args.reset or args.notify or args.refresh or args.comet:
        config = load_config(directory)
        if (args.demo or args.notify) and get_status(directory)['mode'] == 'free':
            print('Choose Work or Quiet before running a preview.')
            return
        if args.comet:
            if get_status(directory)['mode'] != 'work':
                print('Choose Work before previewing a completion comet.')
                return
            with contextlib.closing(connect_state(directory)) as db, db:
                db.execute("INSERT OR REPLACE INTO meta VALUES ('preview','comet')")
            launch_worker(directory)
            print('Previewing one completion comet; live status returns afterward.')
        if args.check:
            info = light_request(config, 'GET')
            print('Connected:', info.get('name', 'Nanoleaf'), 'at', config['ip'],
                  'with', len(config['line_groups']), 'physical Lines')
            saved = SceneRestorer(directory, config).state['scene']
            print('Restore scene:', saved['name'] if saved else 'Choose a scene in the Nanoleaf app.')
        if args.demo:
            with contextlib.closing(connect_state(directory)) as db, db:
                db.execute("INSERT OR REPLACE INTO meta VALUES ('preview','all')")
            launch_worker(directory)
            print('Previewing green, yellow, red, and unread blue pulses; live status returns afterward.')
        if args.reset:
            with contextlib.closing(connect_state(directory)) as db, db:
                db.execute('DELETE FROM comets')
                db.execute('DELETE FROM sessions')
                db.execute('DELETE FROM display_v3')
                db.execute('DELETE FROM activity')
                db.execute('DELETE FROM receipts')
                db.execute('DELETE FROM slots')
                db.execute('DELETE FROM waits')
                db.execute("DELETE FROM meta WHERE key='preview'")
                mark_dirty(db)
            launch_worker(directory)
            print('Status cleared. The saved scene returns, or blue if no scene has been remembered.')
        if args.notify:
            with contextlib.closing(connect_state(directory)) as db, db:
                db.execute("INSERT OR REPLACE INTO meta VALUES ('preview','working')")
            launch_worker(directory)
            print('Queued one outward green pulse, then a local pulse. Live status returns afterward.')
        if args.refresh:
            with contextlib.closing(connect_state(directory)) as db, db:
                db.execute('DELETE FROM display_v3')
                mark_dirty(db)
            launch_worker(directory)
        return
    codex_base = os.environ.get('CODEX_HOME', str(Path.home() / '.codex'))
    codex_dir = Path(windows_path(codex_base) if os.name == 'nt' else codex_base)
    hooks_file = codex_dir / 'hooks.json'
    original = json.loads(hooks_file.read_text(encoding='utf-8-sig')) if hooks_file.exists() else {}
    if args.uninstall:
        if (directory / 'status.sqlite').exists():
            set_mode(directory, 'free')
        remover = directory / 'remove-modes.ps1'
        if os.name == 'nt' and remover.exists():
            subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-File', str(remover)], check=True)
        write_json(hooks_file, merge_hooks(original, '', remove=True))
        print('Removed Nanoleaf hooks. Restart Codex. Saved light credentials remain in', directory)
        return
    print('Connect Codex status to Nanoleaf at 192.168.1.207.')
    print('This installs local hooks; it preserves existing hooks and notification settings.')
    token = getpass.getpass('Paste the working Nanoleaf auth_token (hidden): ').strip()
    config = {'ip': '192.168.1.207', 'token': token}
    info = light_request(config, 'GET')  # Validate before changing hook configuration.
    print('Connected:', info.get('name', 'Nanoleaf'))
    write_json(directory / 'layout.json', {'line_groups': pair_lines(info['panelLayout'])})
    write_json(config_file, config)
    installed_script = directory / 'bridge.py'
    if Path(__file__).resolve() != installed_script.resolve():
        shutil.copytree(Path(__file__).parent / 'vendor', directory / 'vendor', dirs_exist_ok=True)
        for name in ('project_map.py', 'wall_server.py', 'wall.html', 'tray.ps1', 'remove-modes.ps1', 'install-modes.ps1', 'backup_install.py', 'controller_state.py', 'controller_server.py', 'controller_contract.py', 'requirements-controller.txt', 'README.md'):
            shutil.copyfile(Path(__file__).with_name(name), directory / name)
        shutil.copyfile(__file__, installed_script)
    codex_dir.mkdir(parents=True, exist_ok=True)
    if hooks_file.exists():
        backup = hooks_file.with_name('hooks.nanoleaf-backup-' + str(time.time_ns()) + '.json')
        shutil.copyfile(hooks_file, backup)
    command, windows_command = hook_command(installed_script)
    write_json(hooks_file, merge_hooks(original, command, windows_command=windows_command))
    with contextlib.closing(connect_state(directory)) as db, db:
        db.execute('DELETE FROM comets')
        db.execute('DELETE FROM sessions')
        db.execute('DELETE FROM display_v3')
        db.execute('DELETE FROM activity')
        db.execute('DELETE FROM receipts')
        db.execute('DELETE FROM slots')
        db.execute('DELETE FROM waits')
        mark_dirty(db)
    print('Installed hooks in', hooks_file)
    print('Review and trust the Nanoleaf hooks in the hook section of Codex Desktop Settings.')
    print('Task Lines pulse green while working, yellow for a question during work, and red when blocked.')
    print('Unread completions pulse blue until viewed. The first pulse of each state spreads outward.')
    print('Choose scenes in the Nanoleaf app. The latest one returns after all indicators clear.')
    print('If desktop hooks do not fire, report that here; installation alone is not verification.')


def main():
    # Windows and WSL SQLite locks on the same mounted file do not exclude
    # each other. Installed WSL hooks delegate before opening any state files,
    # so all live state writes and workers use Windows Python and its locks.
    if os.name != 'nt' and sys.argv[1:2] and sys.argv[1] in ('hook', 'worker', 'setup', 'mode', 'status', 'tray', 'map', 'serve', 'style', 'map-status', 'controller-configure', 'controller-token', 'controller-revoke', 'controller-serve', 'controller-status', 'controller-disable'):
        installed = Path(__file__).resolve()
        if installed.parent.name == 'CodexNanoleaf' and installed.parent.parent.name == 'Local':
            account = installed.parent.parents[2]
            runtime = account / '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
            if not runtime.is_file():
                print('Nanoleaf Windows runtime is unavailable; no state was changed.', file=sys.stderr)
                if sys.argv[1] == 'hook':
                    print('{}')
                return
            command = [str(runtime), windows_path(str(installed)),
                       *(windows_path(arg) for arg in sys.argv[1:])]
            raise SystemExit(subprocess.call(command))
    if sys.argv[1:2] and sys.argv[1].startswith('controller-'):
        import controller_server
        return controller_server.command(sys.argv[1:], sys.modules[__name__])
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['setup', 'hook', 'worker', 'mode', 'status', 'tray', 'map', 'serve', 'style', 'map-status'])
    parser.add_argument('--state-dir', type=Path, help=argparse.SUPPRESS)
    parser.add_argument('selection', nargs='?', choices=MODES + ('classic', 'project'))
    parser.add_argument('--json', action='store_true')
    group = parser.add_mutually_exclusive_group()
    for flag in ('check', 'demo', 'reset', 'uninstall', 'notify', 'refresh', 'comet'):
        group.add_argument('--' + flag, action='store_true')
    args = parser.parse_args()
    directory = args.state_dir or data_dir()
    if args.mode == 'map-status':
        with contextlib.closing(connect_state(directory)) as db:
            print(json.dumps({**get_status(directory), **wall.settings(db), 'map_pending': wall.pending(db) is not None}))
        return
    if args.mode in ('map', 'serve', 'style'):
        import wall_server
        wall_server.command(args, directory, sys.modules[__name__])
        return
    if args.mode == 'mode':
        if args.selection not in MODES:
            parser.error('Choose work, free, or quiet.')
        set_mode(directory, args.selection)
        print(json.dumps(get_status(directory)))
        return
    if args.mode == 'status':
        try:
            print(json.dumps(get_status(directory)))
        except Exception:
            print(json.dumps({'mode': None, 'pending': True, 'error': 'Local status unavailable.'}))
            sys.exit(1)
        return
    if args.mode == 'tray':
        if os.name != 'nt':
            parser.error('The tray control runs on Windows.')
        subprocess.Popen(['powershell.exe', '-NoProfile', '-STA', '-WindowStyle', 'Hidden',
                          '-File', str(Path(__file__).with_name('tray.ps1'))],
                         creationflags=subprocess.CREATE_NO_WINDOW)
        return
    if args.mode == 'worker':
        while True:
            try:
                run_worker(directory)
                return
            except Exception:
                try:
                    with contextlib.closing(connect_state(directory)) as db, db:
                        db.execute("INSERT OR REPLACE INTO meta VALUES ('control_error', 'Light update failed; retrying.')")
                        mark_dirty(db)
                except Exception:
                    return
                # Release locks between attempts. All retries read the newest mode.
                time.sleep(2)
    if args.mode == 'hook':
        try:
            event = json.load(sys.stdin)
            handle_event(data_dir(), event)
        except Exception:
            # Never block an agent or put a credential-containing exception in its output.
            print('Nanoleaf status hook could not update. Run setup --check.', file=sys.stderr)
        print('{}')
        return
    try:
        setup(args)
    except urllib.error.HTTPError as error:
        print('Nanoleaf HTTP status:', error.code, file=sys.stderr)
        sys.exit(1)
    except Exception:
        print('Setup failed. Check the IP, token, local network, and writable configuration folder.',
              file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
