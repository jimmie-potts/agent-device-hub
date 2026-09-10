"""Architecture and sequence diagram definitions for the work guide.

Running this module renders every diagram through the locally installed
Archify skill (no download, no CDN), extracts the self-contained SVG plus the
CSS rules it needs, and records a receipt per diagram. build_guide.py reads
the rendered files; it never calls Archify itself.

    python3 work/architecture_diagrams.py            # render + extract
    ARCHIFY_DIR=/path/to/archify python3 work/architecture_diagrams.py
"""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
ARCH = ROOT / 'work' / 'architecture'
SPECS = ARCH / 'specs'
RENDERED = ARCH / 'rendered'
RECEIPTS = ARCH / 'source-receipts.json'
ARCHIFY = Path(os.environ.get('ARCHIFY_DIR', Path.home() / '.agents' / 'skills' / 'archify'))

SOURCES = json.loads(RECEIPTS.read_text())
SOURCE_URL = {(f['repo'], f['path']): f['url'] for f in SOURCES['files']}


def src(repo, path):
    return SOURCE_URL[(repo, path)]


# ---------------------------------------------------------------------------
# Sequence helper: messages are listed in reading order; y positions, phase
# segments and the viewBox are derived so the specification stays readable.
# ---------------------------------------------------------------------------
STEP = 44


def seq(diagram_id, title, participants, steps, cards, views=None, width=None, first_y=196):
    messages, segments, y = [], [], first_y
    current = None
    for step in steps:
        if step[0] == 'seg':
            if current:
                current['to'] = y - STEP // 2
                segments.append(current)
            current = {'from': y - 18, 'label': step[1]}
            y += 14
            continue
        _, frm, to, label = step[:4]
        message = {'from': frm, 'to': to, 'y': y, 'label': label}
        if len(step) > 4 and step[4]:
            message['variant'] = step[4]
        if len(step) > 5 and step[5]:
            message['note'] = step[5]
        messages.append(message)
        y += STEP
    if current:
        current['to'] = y - STEP // 2
        segments.append(current)
    count = len(participants)
    width = min(width or max(900, 86 * count + 108 * (count - 1) + 160), 1070)
    spec = {
        'schema_version': 1, 'diagram_type': 'sequence',
        'meta': {'title': title, 'quality_profile': 'showcase', 'column_fit': 'spread', 'viewBox': [width, y + 60]},
        'participants': participants, 'segments': segments, 'messages': messages, 'cards': cards,
    }
    if views:
        spec['meta']['views'] = views
    return spec


def arch(title, components, connections, boundaries, cards, layout, views=None, view_box=None):
    spec = {
        'schema_version': 1, 'diagram_type': 'architecture',
        'meta': {'title': title, 'quality_profile': 'showcase'},
        'layout': layout, 'components': components, 'boundaries': boundaries, 'connections': connections, 'cards': cards,
    }
    if views:
        spec['meta']['views'] = views
    if view_box:
        spec['meta']['viewBox'] = view_box
    return spec


H = 'agent-device-hub'
N = 'codex-nanoleaf'
P = 'divoom-app-upgrade'

# ---------------------------------------------------------------------------
# 1. Implemented local command paths
# ---------------------------------------------------------------------------
SIZE1 = [170, 62]


def c1(id, type, label, sublabel, row, col, tag=None):
    component = {'id': id, 'type': type, 'label': label, 'sublabel': sublabel, 'row': row, 'col': col, 'size': SIZE1}
    if tag:
        component['tag'] = tag
    return component


D1 = arch(
    'Implemented local command paths',
    components=[
        c1('browser', 'frontend', 'Pixoo browser UI', 'same HTTP API and services', 0, 2),
        c1('codex', 'external', 'Local Codex', 'MCP client · Windows or WSL', 1, 0),
        c1('pixooMcp', 'security', 'Pixoo /mcp route', 'bearer · Host/Origin checks', 1, 1, 'optional'),
        c1('pixooSvc', 'backend', 'ControlService', 'catalog · player · request ledger', 1, 2),
        c1('pixooQueue', 'messagebus', 'Adapter queue', 'serialized · one writer', 1, 3),
        c1('mcpPkg', 'backend', 'device-mcp 1.0.0', 'library: tools + transport', 2, 1, 'no listener · no writer'),
        c1('pixooDev', 'external', 'Pixoo 64×64', 'simulator default · explicit device', 2, 3),
        c1('nanoHost', 'security', 'Nanoleaf MCP host', 'Node · loopback /mcp', 3, 0, 'optional'),
        c1('nanoRoute', 'backend', 'Route', 'windows-http or wsl-helper', 3, 1),
        c1('nanoApi', 'security', 'Windows controller API', '/controller/v1 · bearer', 3, 2),
        c1('nanoWorker', 'backend', 'Windows light worker', 'existing owner of writes', 3, 3),
        c1('nanoState', 'database', 'Private SQLite', 'Windows only · never mounted', 4, 2),
        c1('lights', 'external', 'Nanoleaf Lines', 'configured LAN device', 5, 3),
    ],
    connections=[
        {'id': 'codex-pixoo', 'from': 'codex', 'to': 'pixooMcp', 'label': 'app tools', 'variant': 'emphasis', 'fromSide': 'right', 'toSide': 'left', 'labelDy': 26},
        {'id': 'pixoo-mcp-svc', 'from': 'pixooMcp', 'to': 'pixooSvc', 'label': 'request_id', 'variant': 'emphasis', 'fromSide': 'right', 'toSide': 'left', 'labelDy': 26},
        {'id': 'browser-svc', 'from': 'browser', 'to': 'pixooSvc', 'label': 'HTTP · SSE', 'fromSide': 'bottom', 'toSide': 'top', 'labelDx': 44, 'labelDy': 24},
        {'id': 'svc-queue', 'from': 'pixooSvc', 'to': 'pixooQueue', 'label': 'player · display', 'variant': 'emphasis', 'fromSide': 'right', 'toSide': 'left', 'labelDy': 26},
        {'id': 'queue-dev', 'from': 'pixooQueue', 'to': 'pixooDev', 'label': 'upload · control', 'variant': 'emphasis', 'fromSide': 'bottom', 'toSide': 'top', 'labelDx': 56, 'labelDy': 24},
        {'id': 'pkg-pixoo', 'from': 'mcpPkg', 'to': 'pixooMcp', 'label': 'imports', 'variant': 'dashed', 'fromSide': 'top', 'toSide': 'bottom', 'labelDx': 34},
        {'id': 'pkg-nano', 'from': 'mcpPkg', 'to': 'nanoRoute', 'label': 'imports', 'variant': 'dashed', 'fromSide': 'bottom', 'toSide': 'top', 'labelDx': 34, 'labelDy': 24},
        {'id': 'codex-nano', 'from': 'codex', 'to': 'nanoHost', 'label': 'status · mode_set', 'variant': 'emphasis', 'fromSide': 'bottom', 'toSide': 'top', 'labelDx': 60, 'labelDy': 24},
        {'id': 'nano-route', 'from': 'nanoHost', 'to': 'nanoRoute', 'label': 'controller v1', 'variant': 'emphasis', 'fromSide': 'right', 'toSide': 'left', 'labelDy': -18},
        {'id': 'route-api', 'from': 'nanoRoute', 'to': 'nanoApi', 'label': 'loopback HTTP', 'variant': 'security', 'fromSide': 'right', 'toSide': 'left', 'labelDy': 26},
        {'id': 'api-worker', 'from': 'nanoApi', 'to': 'nanoWorker', 'label': 'queued work', 'variant': 'emphasis', 'fromSide': 'right', 'toSide': 'left', 'labelDy': 26},
        {'id': 'api-state', 'from': 'nanoApi', 'to': 'nanoState', 'label': 'receipts', 'fromSide': 'bottom', 'toSide': 'top', 'labelDx': 36, 'labelDy': 24},
        {'id': 'worker-lights', 'from': 'nanoWorker', 'to': 'lights', 'label': 'transmit', 'variant': 'emphasis', 'fromSide': 'bottom', 'toSide': 'top', 'labelDx': 36, 'labelDy': 24},
    ],
    boundaries=[
        {'kind': 'region', 'label': 'Pixoo backend process (divoom-app-upgrade)', 'wraps': ['pixooMcp', 'pixooSvc', 'pixooQueue']},
        {'kind': 'security-group', 'label': 'Windows host (codex-nanoleaf) keeps writes and private state', 'wraps': ['nanoApi', 'nanoWorker', 'nanoState']},
    ],
    cards=[
        {'dot': 'cyan', 'title': 'Pixoo path (implemented)', 'items': ['Strict application extensions carry the native string request_id', 'ControlService, catalog, player and the shared HTTP/MCP ledger', 'One serialized adapter queue; simulator unless device mode is selected']},
        {'dot': 'violet', 'title': 'Nanoleaf path (implemented)', 'items': ['Controller-v1 envelope: requestId, expectedConfigurationRevision, expectedGeneration', 'Windows uses direct loopback HTTP; WSL uses the configured Windows Python helper', 'Neither route opens the Windows SQLite database']},
        {'dot': 'slate', 'title': 'Shared library', 'items': ['device-mcp registers tools and validates transport', 'It opens no listener and starts no device writer', 'Host ownership stays with each application']},
    ],
    layout={'mode': 'grid', 'origin': [40, 40], 'cols': 4, 'cellW': 170, 'cellH': 62, 'gapX': 90, 'gapY': 58},
    views=[
        {'id': 'pixoo-route', 'label': 'Pixoo route', 'focus': ['codex', 'pixooMcp', 'pixooSvc', 'pixooQueue', 'pixooDev', 'browser'], 'note': 'Codex and the browser reach the same owning services and one queue.'},
        {'id': 'nanoleaf-route', 'label': 'Nanoleaf route', 'focus': ['codex', 'nanoHost', 'nanoRoute', 'nanoApi', 'nanoWorker', 'nanoState', 'lights'], 'note': 'The MCP host forwards controller-v1 requests; the Windows worker keeps the writes.'},
        {'id': 'shared-library', 'label': 'Shared library', 'focus': ['mcpPkg', 'pixooMcp', 'nanoRoute', 'nanoHost'], 'note': 'Reusable code, separately owned hosts.'},
    ],
)

# ---------------------------------------------------------------------------
# 2. Planned shared system and ownership boundaries
# ---------------------------------------------------------------------------
SIZE2 = [150, 62]


def c2(id, type, label, sublabel, row, col, tag=None):
    component = {'id': id, 'type': type, 'label': label, 'sublabel': sublabel, 'row': row, 'col': col, 'size': SIZE2}
    if tag:
        component['tag'] = tag
    return component


D2 = arch(
    'Planned shared system and ownership boundaries',
    components=[
        c2('providers', 'external', 'Agent providers', 'Codex · Claude Code', 0, 0),
        c2('emitters', 'security', 'Bounded emitters', 'allowlisted · fail-open', 0, 1, 'planned'),
        c2('core', 'backend', 'Agent-state core', 'one authoritative owner', 0, 2, 'planned · inside Pixoo first'),
        c2('feed', 'messagebus', 'Versioned feed', 'snapshots · resync', 0, 3, 'planned'),
        c2('pixoo', 'backend', 'Pixoo controller', 'media · 64×64 · Monitor/Media', 1, 0),
        c2('nanoleaf', 'backend', 'Nanoleaf controller', 'Windows worker · Work/Quiet/Free', 1, 1),
        c2('tidbyt', 'cloud', 'Tidbyt controller', 'cloud · 64×32 renderer', 1, 2, 'planned'),
        c2('lifx', 'backend', 'LIFX controller', 'direct LAN', 1, 3, 'planned'),
        c2('pclight', 'backend', 'PC lighting', 'Corsair first', 1, 4, 'planned · Strimer/Varmilo optional'),
        c2('clients', 'frontend', 'Clients', 'dashboard · MCP · desk presets', 2, 0, 'planned'),
        c2('routing', 'security', 'Registered routing', 'authenticated · per-device queues', 2, 1, 'planned host'),
        c2('contracts', 'database', 'Contracts + device-mcp', 'controller v1 · MCP 1.0.0', 2, 2, 'implemented'),
    ],
    connections=[
        {'id': 'obs', 'from': 'providers', 'to': 'emitters', 'label': 'observations', 'variant': 'emphasis', 'fromSide': 'right', 'toSide': 'left', 'labelDy': 60},
        {'id': 'submit', 'from': 'emitters', 'to': 'core', 'label': 'bounded submit', 'variant': 'emphasis', 'fromSide': 'right', 'toSide': 'left', 'labelDy': 60},
        {'id': 'publish', 'from': 'core', 'to': 'feed', 'label': 'revisions', 'variant': 'emphasis', 'fromSide': 'right', 'toSide': 'left', 'labelDy': 26},
        {'id': 'proj-pixoo', 'from': 'feed', 'to': 'pixoo', 'variant': 'dashed', 'fromSide': 'bottom', 'toSide': 'top'},
        {'id': 'proj-nano', 'from': 'feed', 'to': 'nanoleaf', 'variant': 'dashed', 'fromSide': 'bottom', 'toSide': 'top'},
        {'id': 'proj-tidbyt', 'from': 'feed', 'to': 'tidbyt', 'variant': 'dashed', 'fromSide': 'bottom', 'toSide': 'top'},
        {'id': 'proj-lifx', 'from': 'feed', 'to': 'lifx', 'label': 'projection to each controller', 'variant': 'dashed', 'fromSide': 'bottom', 'toSide': 'top', 'labelDy': 98},
        {'id': 'proj-pc', 'from': 'feed', 'to': 'pclight', 'variant': 'dashed', 'fromSide': 'bottom', 'toSide': 'top'},
        {'id': 'req', 'from': 'clients', 'to': 'routing', 'label': 'commands', 'variant': 'emphasis', 'fromSide': 'right', 'toSide': 'left', 'labelDy': 26},
        {'id': 'cmd-pixoo', 'from': 'routing', 'to': 'pixoo', 'label': 'native command', 'variant': 'security', 'fromSide': 'top', 'toSide': 'bottom', 'labelDy': -18},
        {'id': 'cmd-nano', 'from': 'routing', 'to': 'nanoleaf', 'label': 'native command', 'variant': 'security', 'fromSide': 'top', 'toSide': 'bottom', 'labelDx': 52, 'labelDy': -18},
        {'id': 'contract-routing', 'from': 'contracts', 'to': 'routing', 'label': 'validates', 'variant': 'dashed', 'fromSide': 'left', 'toSide': 'right', 'labelDy': 26},
    ],
    boundaries=[
        {'kind': 'region', 'label': 'Shared runtime in agent-device-hub (planned)', 'wraps': ['emitters', 'core', 'feed']},
        {'kind': 'security-group', 'label': 'Existing repositories: own writer, private state', 'wraps': ['pixoo', 'nanoleaf']},
        {'kind': 'region', 'label': 'New controllers in agent-device-hub (planned)', 'wraps': ['tidbyt', 'lifx', 'pclight']},
    ],
    cards=[
        {'dot': 'cyan', 'title': 'Observation path (planned)', 'items': ['Provider hooks report allowlisted lifecycle metadata and fail open', 'The core interprets observations once; controllers only project state', 'The core runs inside Pixoo first; the standalone hub composes the same core']},
        {'dot': 'rose', 'title': 'Command path', 'items': ['Dashboard, MCP and desk presets send explicit requests', 'Registered routing sends each command to its existing owner', 'Per-device queues: an offline device cannot stall another']},
        {'dot': 'emerald', 'title': 'Ownership', 'items': ['Each physical device has one designated writer and private state', 'Contracts and device-mcp are implemented; collectors, core, host and new controllers are backlog']},
    ],
    layout={'mode': 'grid', 'origin': [40, 40], 'cols': 5, 'cellW': 150, 'cellH': 62, 'gapX': 60, 'gapY': 112},
    views=[
        {'id': 'observe', 'label': 'Observation path', 'focus': ['providers', 'emitters', 'core', 'feed', 'pixoo', 'nanoleaf', 'tidbyt', 'lifx', 'pclight'], 'note': 'One shared interpretation, many device projections.'},
        {'id': 'command', 'label': 'Command path', 'focus': ['clients', 'routing', 'contracts', 'pixoo', 'nanoleaf'], 'note': 'Explicit requests are routed to existing command owners.'},
    ],
)

# ---------------------------------------------------------------------------
# 3. Lifecycle observation to device presentation (planned conceptual flow)
# ---------------------------------------------------------------------------
D3 = seq(
    'lifecycle-observation', 'Lifecycle observation to device presentation',
    participants=[
        {'id': 'provider', 'type': 'external', 'label': 'Agent provider', 'sublabel': 'hook in Codex/Claude'},
        {'id': 'emitter', 'type': 'security', 'label': 'Bounded emitter', 'sublabel': 'privacy filter'},
        {'id': 'core', 'type': 'backend', 'label': 'Agent-state core', 'sublabel': 'one owner · versioned feed'},
        {'id': 'user', 'type': 'external', 'label': 'User', 'sublabel': 'dashboard / device UI'},
        {'id': 'controller', 'type': 'backend', 'label': 'Device controller', 'sublabel': 'projection · policy · queue'},
        {'id': 'device', 'type': 'external', 'label': 'Device', 'sublabel': 'Pixoo / Nanoleaf / …'},
    ],
    steps=[
        ('seg', 'Qualified signal, bounded hook'),
        ('msg', 'provider', 'emitter', 'lifecycle event (turn end, attention, notice)', 'emphasis'),
        ('msg', 'emitter', 'core', 'submit allowlisted metadata + neutral IDs', 'emphasis', 'prompts, transcripts, tool content and titles are excluded'),
        ('msg', 'emitter', 'provider', 'return within bound (even if core is down)', 'return'),
        ('seg', 'Shared interpretation and delivery'),
        ('msg', 'core', 'controller', 'change event, revision N (activity · attention · notice · freshness)', 'emphasis'),
        ('msg', 'controller', 'device', 'render for native mode; queue writes only if generation g is still current', 'emphasis', 'skipped while Media/Free or an external owner holds the device'),
        ('msg', 'device', 'controller', 'sent (transport only, not optical proof)', 'return'),
        ('seg', 'Stale cursor or reconnect'),
        ('msg', 'controller', 'core', 'read with expired cursor', 'dashed'),
        ('msg', 'core', 'controller', 'resync: authoritative snapshot, no replayed effects', 'return'),
        ('seg', 'Acknowledgment'),
        ('msg', 'user', 'core', 'acknowledge notice', 'security'),
        ('msg', 'core', 'controller', 'revision N+1: notice cleared (owner state, not a read receipt)', 'emphasis'),
    ],
    cards=[
        {'dot': 'cyan', 'title': 'Bounded and fail-open', 'items': ['The hook returns inside its budget whether or not the collector or device answers', 'Collector or device failure never changes agent permissions or holds work']},
        {'dot': 'violet', 'title': 'Distinct facts', 'items': ['Activity, attention, notices, acknowledgment, optional read evidence and freshness stay separate', 'Turn end proves neither success nor readership', 'Five minutes without evidence marks a session uncertain, not failed']},
        {'dot': 'amber', 'title': 'Planned, not final', 'items': ['Schemas and endpoints belong to Hub #2/#3 and Pixoo #31', 'Controller-v1 cursors are not silently reused for the agent-state feed']},
    ],
    views=[
        {'id': 'ingest', 'label': 'Ingest', 'focus': ['provider', 'emitter', 'core'], 'note': 'Small, filtered, bounded.'},
        {'id': 'present', 'label': 'Present', 'focus': ['core', 'controller', 'device'], 'note': 'Projection, policy, generation check, write.'},
    ],
)

# ---------------------------------------------------------------------------
# 4. Nanoleaf command admission, replay and cancellation (implemented)
# ---------------------------------------------------------------------------
D4 = seq(
    'nanoleaf-command', 'Nanoleaf command admission, replay and cancellation',
    participants=[
        {'id': 'codex', 'type': 'external', 'label': 'Local Codex', 'sublabel': 'MCP client'},
        {'id': 'host', 'type': 'security', 'label': 'Nanoleaf MCP host', 'sublabel': 'Node · no second ledger'},
        {'id': 'api', 'type': 'security', 'label': 'Windows controller API', 'sublabel': '/controller/v1'},
        {'id': 'worker', 'type': 'backend', 'label': 'Windows worker', 'sublabel': 'owns light writes'},
        {'id': 'device', 'type': 'external', 'label': 'Nanoleaf Lines', 'sublabel': 'LAN device'},
    ],
    steps=[
        ('seg', 'Read first'),
        ('msg', 'codex', 'host', 'nanoleaf_status', 'emphasis'),
        ('msg', 'host', 'api', 'GET snapshot (bearer, exact Host)', 'security'),
        ('msg', 'api', 'host', 'snapshot: nextRequestId · configurationRevision · generation', 'return'),
        ('msg', 'host', 'codex', 'status (desired · pending · unknown observation)', 'return'),
        ('seg', 'Admit one command'),
        ('msg', 'codex', 'host', 'nanoleaf_mode_set {requestId, expectedConfigurationRevision, expectedGeneration, mode}', 'emphasis'),
        ('msg', 'host', 'api', 'POST /controller/v1/commands', 'security', 'authentication and scope are checked before replay lookup'),
        ('msg', 'api', 'worker', 'queue mode work (identity reserved atomically; revision and generation validated)', 'emphasis'),
        ('msg', 'api', 'host', '202 receipt: queued', 'return'),
        ('msg', 'host', 'codex', 'receipt (queued is not visible light)', 'return'),
        ('msg', 'worker', 'device', 'transmit after a second generation check', 'emphasis'),
        ('msg', 'device', 'worker', 'transport acknowledgment', 'return'),
        ('msg', 'worker', 'api', 'sent (transport evidence only)', 'dashed'),
        ('seg', 'Alternatives at admission'),
        ('msg', 'api', 'host', 'exact duplicate → original receipt, no new write', 'return'),
        ('msg', 'api', 'host', 'changed payload → 409 request-conflict', 'return'),
        ('msg', 'api', 'host', 'expired identity → 410 request-expired', 'return'),
        ('msg', 'api', 'host', 'stale revision/generation → 409 before any effect', 'return'),
        ('seg', 'Alternatives after admission'),
        ('msg', 'worker', 'api', 'superseded generation → cancelled, prior effects retained', 'dashed'),
        ('msg', 'worker', 'api', 'partial or uncertain → priorEffects possible; request held', 'dashed'),
        ('msg', 'host', 'codex', 'delivery timeout after dispatch → original requestId + possible effects', 'return', 'no replacement identity and no automatic retry'),
    ],
    cards=[
        {'dot': 'cyan', 'title': 'Two tools only', 'items': ['nanoleaf_status and nanoleaf_mode_set; modes Work, Quiet, Free', 'No power, arbitrary brightness, scenes or zones in this binding']},
        {'dot': 'violet', 'title': 'Identity discipline', 'items': ['Status issues nextRequestId; clients never mint identities', 'Duplicates join, conflicts reject, expired identities reject', 'Superseded work cancels; a second generation check runs right before side effects']},
        {'dot': 'amber', 'title': 'Evidence limits', 'items': ['sent is transport evidence, not optical proof', 'MCP disconnection alone does not stop admitted controller work', 'Failed or uncertain machine modes are held until a fresh explicit request']},
    ],
    views=[
        {'id': 'happy', 'label': 'Admit and send', 'focus': ['codex', 'host', 'api', 'worker', 'device'], 'note': 'One identity, one queued write.'},
        {'id': 'alt', 'label': 'Rejections', 'focus': ['host', 'api', 'worker'], 'note': 'Replay, conflict, expiry and cancellation.'},
    ],
    width=1180,
)

# ---------------------------------------------------------------------------
# 5. Pixoo media selection and playback ownership (implemented)
# ---------------------------------------------------------------------------
D5 = seq(
    'pixoo-playback', 'Pixoo media selection and playback ownership',
    participants=[
        {'id': 'client', 'type': 'external', 'label': 'Client', 'sublabel': 'Codex MCP or browser'},
        {'id': 'service', 'type': 'backend', 'label': 'ControlService', 'sublabel': 'HTTP/MCP ledger'},
        {'id': 'library', 'type': 'database', 'label': 'Library', 'sublabel': 'renditions · playlists'},
        {'id': 'player', 'type': 'backend', 'label': 'Player', 'sublabel': 'backend playback'},
        {'id': 'adapter', 'type': 'messagebus', 'label': 'Adapter queue', 'sublabel': 'serialized writer'},
        {'id': 'device', 'type': 'external', 'label': 'Pixoo', 'sublabel': 'simulator or device'},
    ],
    steps=[
        ('seg', 'Read catalog and status'),
        ('msg', 'client', 'service', 'get_status · list_media · list_playlists', 'emphasis'),
        ('msg', 'service', 'client', 'status {nextRequestId} · catalog page (names are untrusted data)', 'return', 'reads never probe the display or refresh evidence timestamps'),
        ('seg', 'Select media'),
        ('msg', 'client', 'service', 'show_media {rendition_id, request_id} or play_playlist {playlist_id, revision, request_id}', 'emphasis'),
        ('msg', 'service', 'library', 'resolve stored rendition · check playlist revision', 'default', 'matching identity joins; different payload conflicts'),
        ('msg', 'library', 'service', 'rendition + bounded policy (or revision-conflict)', 'return'),
        ('msg', 'service', 'player', 'showMedia / start(playlistId, revision)', 'emphasis'),
        ('msg', 'player', 'service', 'context admitted (session, rendition)', 'return'),
        ('msg', 'service', 'client', 'receipt: admitted; upload may still be loading', 'return'),
        ('seg', 'Backend playback continues'),
        ('msg', 'player', 'adapter', 'upload rendition frames (generation g)', 'emphasis'),
        ('msg', 'adapter', 'device', 'serialized upload · control', 'emphasis'),
        ('msg', 'device', 'adapter', 'transport ack (not visible proof)', 'return'),
        ('msg', 'player', 'adapter', 'dwell elapsed → next item (retire older work)', 'dashed', 'client disconnect does not cancel admitted playback'),
        ('seg', 'Recovery and screen rules'),
        ('msg', 'client', 'service', 'lost response → get_status, reconcile (no new identity)', 'dashed'),
        ('msg', 'client', 'service', 'set_screen off → playback pauses', 'security'),
        ('msg', 'client', 'service', 'set_screen on → nothing resumes', 'security'),
        ('msg', 'player', 'library', 'restart → restore paused context, no device write', 'dashed'),
    ],
    cards=[
        {'dot': 'cyan', 'title': 'One owner', 'items': ['Browser and MCP share the same services, ledger and adapter queue', 'Playback tools never import or edit media or pick raw device targets']},
        {'dot': 'violet', 'title': 'Receipts and evidence', 'items': ['A receipt acknowledges admission; upload can still be loading', 'Reconcile a lost response with status, not a new write identity', 'Last 256 results retained; restart changes the server epoch']},
        {'dot': 'amber', 'title': 'Preserved behavior', 'items': ['Screen off pauses; screen on does not resume', 'Paused context and referenced renditions survive restart', 'Original media and referenced renditions stay intact']},
    ],
    views=[
        {'id': 'select', 'label': 'Select', 'focus': ['client', 'service', 'library', 'player'], 'note': 'Identity, revision and rendition checks before admission.'},
        {'id': 'play', 'label': 'Play', 'focus': ['player', 'adapter', 'device'], 'note': 'Serialized writes owned by the backend.'},
    ],
    width=1240,
)

# ---------------------------------------------------------------------------
# 6. Independent Wispr and Codex input controls (future, H63–H66, H70)
# ---------------------------------------------------------------------------
D6 = seq(
    'desktop-input', 'Independent Wispr and Codex input controls',
    participants=[
        {'id': 'user', 'type': 'external', 'label': 'User', 'sublabel': 'Big A · mapped mouse'},
        {'id': 'dispatcher', 'type': 'backend', 'label': 'Windows dispatcher', 'sublabel': 'local, no hub'},
        {'id': 'profile', 'type': 'database', 'label': 'Control profile', 'sublabel': 'bindings + app scope'},
        {'id': 'wispr', 'type': 'external', 'label': 'Wispr Flow', 'sublabel': 'own requirements'},
        {'id': 'app', 'type': 'frontend', 'label': 'Focused app', 'sublabel': 'Codex or other'},
    ],
    steps=[
        ('seg', 'Profile selection'),
        ('msg', 'user', 'dispatcher', 'select control profile', 'emphasis'),
        ('msg', 'dispatcher', 'profile', 'load mappings', 'default'),
        ('msg', 'profile', 'dispatcher', 'bindings (zero device commands)', 'return'),
        ('seg', 'Big A: dictation'),
        ('msg', 'user', 'dispatcher', 'Big A press (hold)', 'emphasis'),
        ('msg', 'dispatcher', 'wispr', 'invoke qualified dictation binding', 'emphasis'),
        ('msg', 'user', 'dispatcher', 'Big A release', 'emphasis'),
        ('msg', 'dispatcher', 'wispr', 'release binding', 'emphasis'),
        ('msg', 'wispr', 'app', 'insert text — no added send action', 'return'),
        ('seg', 'Mouse: one Codex action'),
        ('msg', 'user', 'dispatcher', 'fresh mapped mouse press', 'emphasis'),
        ('msg', 'dispatcher', 'profile', 'resolve app scope + action', 'default'),
        ('msg', 'dispatcher', 'app', 'next attention task · command menu · previous task · next task', 'emphasis', 'exactly one action per deliberate press'),
        ('seg', 'Boundaries'),
        ('msg', 'dispatcher', 'app', 'outside Codex → ordinary mouse behavior passes through', 'dashed'),
        ('msg', 'dispatcher', 'profile', 'held / repeated / stale input → no duplicate, no replay', 'dashed'),
        ('msg', 'dispatcher', 'user', 'Big B unavailable until its preset service exists; presses are not buffered', 'return'),
    ],
    cards=[
        {'dot': 'cyan', 'title': 'Independent path', 'items': ['Ships without the hub, shared monitoring, general controls or Music', 'Wispr keeps its own service requirements']},
        {'dot': 'violet', 'title': 'Vocabulary', 'items': ['Control profile: controls, gestures and app scope mapped to actions', 'Button binding: one assignment', 'Desk preset: configured actions on participating devices (not used here)']},
        {'dot': 'amber', 'title': 'Unverified', 'items': ['Qualification (H64) and hardware support are not established; Retro R8 is only a candidate mouse', 'The first editor (H70) excludes scripts, shell execution, raw device commands and macros']},
    ],
    width=1100,
)

# ---------------------------------------------------------------------------
# 7. Big B presets, partial results and manual handoff (future, H67–H69, H71)
# ---------------------------------------------------------------------------
D7 = seq(
    'big-b-presets', 'Big B presets, partial results and manual handoff',
    participants=[
        {'id': 'user', 'type': 'external', 'label': 'User', 'sublabel': 'Big B · vendor app'},
        {'id': 'dispatcher', 'type': 'backend', 'label': 'Windows dispatcher', 'sublabel': 'binding + feedback'},
        {'id': 'hub', 'type': 'security', 'label': 'Hub preset service', 'sublabel': 'authoritative selection'},
        {'id': 'nanoleaf', 'type': 'backend', 'label': 'Nanoleaf owner', 'sublabel': 'Work/Quiet/Free'},
        {'id': 'pixoo', 'type': 'backend', 'label': 'Pixoo owner', 'sublabel': 'Monitor/Media'},
    ],
    steps=[
        ('seg', 'Fresh press, one transition'),
        ('msg', 'user', 'dispatcher', 'fresh Big B press', 'emphasis'),
        ('msg', 'dispatcher', 'hub', 'request next preset (Work → Free → Quiet → Work) with known revision', 'emphasis'),
        ('msg', 'hub', 'nanoleaf', 'supported native command + requestId/revision/generation', 'security'),
        ('msg', 'hub', 'pixoo', 'supported native command + request_id', 'security'),
        ('msg', 'nanoleaf', 'hub', 'queued / sent', 'return'),
        ('msg', 'pixoo', 'hub', 'failed: offline (independent queue)', 'return'),
        ('msg', 'hub', 'dispatcher', 'selected preset + per-device results (partial)', 'return'),
        ('msg', 'dispatcher', 'user', 'visible feedback: requested, sent, failed, uncertain', 'return', 'transport outcomes are not optical proof'),
        ('seg', 'Manual change stays until the next explicit preset'),
        ('msg', 'user', 'nanoleaf', 'manual scene change in the vendor app', 'dashed'),
        ('msg', 'user', 'dispatcher', 'next fresh Big B press', 'emphasis'),
        ('msg', 'hub', 'nanoleaf', 'supported ownership handoff, then preset action', 'security'),
        ('seg', 'No replay'),
        ('msg', 'dispatcher', 'hub', 'startup · reconnect · profile selection → no presses replayed, no device commands', 'dashed'),
        ('msg', 'hub', 'dispatcher', 'hub unavailable → reported; Wispr and mouse keep working', 'return'),
    ],
    cards=[
        {'dot': 'cyan', 'title': 'Authoritative selection', 'items': ['The hub owns preset selection and revision; clients keep no diverging counter', 'Superseded requests retire through existing generation rules']},
        {'dot': 'violet', 'title': 'Independent results', 'items': ['One offline device cannot stall others', 'A partial operation is never shown as complete', 'Native modes and restoration limits are preserved']},
        {'dot': 'amber', 'title': 'Prerequisites', 'items': ['H67 needs H63, H32, H31, H5, Nanoleaf #49 and Pixoo #33', 'H68 needs H65 and H67; H69 also needs H8', 'Manual dispatch does not need automation engine H45; Music H71 follows H40, H68 and H36']},
    ],
    width=1180,
)

# ---------------------------------------------------------------------------
# 8. Embedded core to standalone owner (future, H5/H8, P31)
# ---------------------------------------------------------------------------
D8 = seq(
    'owner-migration', 'Embedded core to standalone owner',
    participants=[
        {'id': 'operator', 'type': 'external', 'label': 'Operator', 'sublabel': 'explicit authorization'},
        {'id': 'tooling', 'type': 'security', 'label': 'Migration tooling', 'sublabel': 'H8 runbook'},
        {'id': 'pixoo', 'type': 'backend', 'label': 'Pixoo embedded owner', 'sublabel': 'session-source facade'},
        {'id': 'hub', 'type': 'backend', 'label': 'Standalone hub owner', 'sublabel': 'same core, new host'},
        {'id': 'producers', 'type': 'external', 'label': 'Producers', 'sublabel': 'provider hooks'},
        {'id': 'consumers', 'type': 'frontend', 'label': 'Consumers', 'sublabel': 'renderer · Nanoleaf feed'},
    ],
    steps=[
        ('seg', 'Quiesce'),
        ('msg', 'operator', 'tooling', 'authorize migration (named owner)', 'emphasis'),
        ('msg', 'tooling', 'pixoo', 'quiesce selected route and old owner', 'security'),
        ('msg', 'tooling', 'producers', 'pause ingestion (hooks stay fail-open)', 'security'),
        ('seg', 'Export, import, validate'),
        ('msg', 'tooling', 'pixoo', 'versioned export: source/session/notice identity + revisions', 'emphasis'),
        ('msg', 'pixoo', 'tooling', 'export bundle', 'return'),
        ('msg', 'tooling', 'hub', 'import bundle', 'emphasis'),
        ('msg', 'hub', 'tooling', 'validated: identities, revisions, notices unchanged', 'return'),
        ('msg', 'tooling', 'pixoo', 'keep old reducer inactive; facade → remote owner', 'security', 'remote mode never starts a second local reducer'),
        ('seg', 'Switch and resync'),
        ('msg', 'tooling', 'producers', 'switch producer endpoint', 'emphasis'),
        ('msg', 'tooling', 'consumers', 'switch consumer endpoint', 'emphasis'),
        ('msg', 'consumers', 'hub', 'authoritative snapshot / resync', 'default'),
        ('msg', 'hub', 'consumers', 'snapshot (no replayed effects)', 'return'),
        ('msg', 'producers', 'hub', 'resume ingestion', 'default'),
        ('seg', 'Rollback (only after quiescing the new owner)'),
        ('msg', 'tooling', 'hub', 'quiesce new owner', 'dashed'),
        ('msg', 'tooling', 'pixoo', 'reactivate embedded owner; endpoints back', 'dashed'),
    ],
    cards=[
        {'dot': 'cyan', 'title': 'One owner at a time', 'items': ['Embedded and standalone owners never run against one state', 'A stale feed stays visibly stale until recovery or rollback']},
        {'dot': 'violet', 'title': 'What moves', 'items': ['Identities, session/notice state, revisions and producer configuration', 'Pixoo’s facade switches renderer, feed, label and acknowledgment operations to the selected owner']},
        {'dot': 'amber', 'title': 'Owned elsewhere', 'items': ['Exact design: Hub #5/#8 and Pixoo #31 — no transfer algorithm or command is invented here', 'Controller databases stay private; Windows/WSL never share a mounted SQLite file', 'Legacy Nanoleaf ingestion remains until a verified cutover; repository moves and hosting are separate']},
    ],
    width=1240,
)

# ---------------------------------------------------------------------------
# 9. Proposed fresh Nanoleaf Linux runtime
# ---------------------------------------------------------------------------
SIZE9 = [165, 64]


def c9(id, type, label, sublabel, row, col, tag=None):
    component = {'id': id, 'type': type, 'label': label, 'sublabel': sublabel, 'row': row, 'col': col, 'size': SIZE9}
    if tag:
        component['tag'] = tag
    return component


D9 = arch(
    'Proposed fresh Nanoleaf Linux runtime',
    components=[
        c9('browser', 'frontend', 'Windows browser', 'wall map client', 0, 0),
        c9('desktop', 'external', 'Codex Desktop', 'Windows · tasks execute in WSL', 0, 2),
        c9('cliClient', 'external', 'Codex CLI', 'Ubuntu WSL', 0, 3),
        c9('wallMap', 'frontend', 'Python wall map', '127.0.0.1:8765', 1, 0, 'proposed'),
        c9('desktopJson', 'database', 'Mounted Desktop JSON', 'project · title · unread · read-only', 1, 1),
        c9('hooksCli', 'backend', 'Linux hooks and CLI', 'Python · fail-open hooks', 1, 2, 'proposed'),
        c9('mcpHost', 'security', 'Node MCP host', '127.0.0.1:41230', 1, 3, 'proposed'),
        c9('linuxState', 'database', 'Linux SQLite', '~/.local/share/codex-nanoleaf', 2, 2, 'fresh state'),
        c9('controller', 'security', 'Python controller', '127.0.0.1:41231 · bearer', 2, 3, 'proposed'),
        c9('worker', 'backend', 'On-demand worker', 'Python · sole light writer', 3, 2, 'existing behavior'),
        c9('lights', 'external', 'Nanoleaf Lines', 'configured LAN device', 3, 4),
    ],
    connections=[
        {'id': 'desktop-hooks', 'from': 'desktop', 'to': 'hooksCli', 'label': 'WSL task lifecycle', 'variant': 'emphasis', 'fromSide': 'bottom', 'toSide': 'top', 'labelDy': 24},
        {'id': 'desktop-json', 'from': 'desktop', 'to': 'desktopJson', 'label': 'configured files', 'fromSide': 'left', 'toSide': 'top'},
        {'id': 'json-map', 'from': 'desktopJson', 'to': 'wallMap', 'label': 'metadata read', 'variant': 'security', 'fromSide': 'left', 'toSide': 'right', 'labelAt': [223, 230]},
        {'id': 'browser-map', 'from': 'browser', 'to': 'wallMap', 'label': 'HTTP :8765', 'variant': 'emphasis', 'fromSide': 'bottom', 'toSide': 'top', 'labelDy': 24},
        {'id': 'cli-hooks', 'from': 'cliClient', 'to': 'hooksCli', 'label': 'lifecycle · commands', 'variant': 'emphasis', 'fromSide': 'left', 'toSide': 'top', 'labelDy': 28},
        {'id': 'cli-mcp', 'from': 'cliClient', 'to': 'mcpHost', 'label': 'MCP :41230', 'variant': 'emphasis', 'fromSide': 'bottom', 'toSide': 'top', 'labelDy': 24},
        {'id': 'hooks-state', 'from': 'hooksCli', 'to': 'linuxState', 'label': 'task state', 'fromSide': 'bottom', 'toSide': 'top', 'labelDy': 24},
        {'id': 'map-state', 'from': 'wallMap', 'to': 'linuxState', 'label': 'task preferences', 'fromSide': 'bottom', 'toSide': 'left', 'labelDy': 30},
        {'id': 'mcp-controller', 'from': 'mcpHost', 'to': 'controller', 'label': 'HTTP 127.0.0.1:41231', 'variant': 'security', 'fromSide': 'bottom', 'toSide': 'top', 'labelDy': 24},
        {'id': 'controller-state', 'from': 'controller', 'to': 'linuxState', 'label': 'command receipts', 'fromSide': 'left', 'toSide': 'right', 'labelAt': [623, 342]},
        {'id': 'controller-worker', 'from': 'controller', 'to': 'worker', 'label': 'start on demand', 'variant': 'emphasis', 'fromSide': 'bottom', 'toSide': 'right', 'labelDy': 24},
        {'id': 'state-worker', 'from': 'linuxState', 'to': 'worker', 'label': 'shared state · lock', 'fromSide': 'bottom', 'toSide': 'top', 'labelDy': 24},
        {'id': 'worker-lights', 'from': 'worker', 'to': 'lights', 'label': 'one writer', 'variant': 'emphasis', 'fromSide': 'right', 'toSide': 'left', 'labelAt': [722, 454]},
    ],
    boundaries=[
        {'kind': 'region', 'label': 'Ubuntu WSL · separate Linux processes and Linux-owned state', 'wraps': ['wallMap', 'hooksCli', 'mcpHost', 'linuxState', 'controller', 'worker']},
    ],
    cards=[
        {'dot': 'violet', 'title': 'Proposed process boundary', 'items': ['Hooks, CLI, wall map and controller coordinate through Linux SQLite', 'Node MCP calls the controller directly over numeric-loopback HTTP', 'The worker remains the sole light writer; setup and the map may read device geometry']},
        {'dot': 'cyan', 'title': 'Windows remains a client', 'items': ['Codex Desktop tasks execute in WSL', 'The Windows browser opens the wall map', 'Configured project, title and unread JSON is mounted read-only']},
        {'dot': 'amber', 'title': 'Evidence boundary', 'items': ['Fresh install; no data migration or rollback tooling', 'No combined daemon, new hook API, shared monitoring or source move', 'PR #57 is a source candidate; installed acceptance #55 remains open']},
    ],
    layout={'mode': 'grid', 'origin': [40, 40], 'cols': 5, 'cellW': 165, 'cellH': 64, 'gapX': 35, 'gapY': 48},
    views=[
        {'id': 'task-state', 'label': 'Task and state path', 'focus': ['desktop', 'cliClient', 'hooksCli', 'wallMap', 'desktopJson', 'linuxState'], 'note': 'Linux processes share Linux state while mounted Desktop metadata remains read-only.'},
        {'id': 'mcp-command', 'label': 'MCP command path', 'focus': ['cliClient', 'mcpHost', 'controller', 'linuxState', 'worker', 'lights'], 'note': 'MCP uses direct numeric-loopback HTTP; the on-demand worker keeps the device write.'},
    ],
)

# ---------------------------------------------------------------------------
# Guide metadata: status, explanation, boundaries, sources, related issues
# ---------------------------------------------------------------------------
DIAGRAMS = [
    dict(id='arch-local-paths', spec=D1, kind='architecture', status='implemented',
         status_label='Implemented source', short='Local command paths',
         summary='Two implemented local routes share the reusable MCP library but keep different owning services. Codex reaches Pixoo through its optional application endpoint and reaches Nanoleaf through an optional Node host that forwards to the Windows controller API.',
         reading=['Follow the cyan emphasis arrows: Codex → Pixoo /mcp → ControlService → one serialized queue → simulator or explicitly selected device. The browser enters the same ControlService.',
                  'The lower route is Codex → Nanoleaf MCP host → route (direct loopback on Windows, the configured Windows Python helper on WSL) → Windows controller API → existing light worker → configured lights.',
                  'The dashed “imports” arrows show the shared device-mcp package as library code. It opens no listener and starts no device writer.'],
         boundaries=['Pixoo tools are strict application extensions carrying the native string request_id. The shared controller v1 API for Pixoo remains [[P37]].',
                     'Nanoleaf uses the controller v1 envelope: requestId, expectedConfigurationRevision and expectedGeneration. The two routes are not wire-identical.',
                     'The WSL helper never opens the Windows SQLite database. Each device keeps one designated writer and private state.'],
         sources=[(H, 'packages/mcp/README.md'), (P, 'docs/local-mcp.md'), (P, 'apps/server/src/mcp.ts'), (P, 'apps/server/src/mcp-tools.ts'), (N, 'docs/local-mcp.md'), (N, 'mcp/src/server.ts'), (N, 'mcp/src/transport.ts'), (N, 'docs/controller-api.md')],
         issues=['P37', 'N34', 'P12']),
    dict(id='arch-shared-system', spec=D2, kind='architecture', status='planned',
         status_label='Planned composition; contracts and MCP implemented', short='Shared system and ownership',
         summary='The planned shared system interprets qualified provider observations once in one authoritative agent-state core and projects that state to each controller. Explicit dashboard, MCP and preset requests take a separate authenticated route to the existing command owners.',
         reading=['Top row: providers → bounded emitters → shared core → versioned feed. Dashed “projection” arrows deliver revisioned state to each controller, which renders it for its own device.',
                  'Second row: dashboard, MCP and desk-preset requests → registered routing → native commands to the existing owners. Contracts and device-mcp (implemented) validate that path.',
                  'Third row: each controller’s responsibility. Pixoo owns media, player, the 64×64 renderer and Monitor/Media. Nanoleaf owns its Windows worker, geometry, effects, restoration and Work/Quiet/Free. Tidbyt (cloud, 64×32), LIFX (direct LAN) and PC lighting (Corsair first; optional Strimer and Varmilo) are planned.'],
         boundaries=['The core runs inside Pixoo first ([[P31]]); the later standalone hub ([[H5]]) composes the same core. Collectors, state runtime, dashboard, standalone host and the new controllers are backlog work.',
                     'Only the shared contracts ([[H4]]) and reusable MCP ([[H7]]) are implemented source.',
                     'Each physical device has one designated writer and private state. No global mode replaces native Nanoleaf or Pixoo modes.'],
         sources=[(H, 'docs/architecture.md'), (H, 'docs/controller-contract.md'), (H, 'packages/mcp/README.md'), (N, 'docs/hub-integration.md'), (P, 'docs/hub-integration.md')],
         issues=['H2', 'H3', 'H5', 'P31', 'H15', 'H17', 'H53']),
    dict(id='arch-nanoleaf-linux', spec=D9, kind='architecture', status='planned',
         status_label='Proposed; source review and installed acceptance open', short='Nanoleaf Linux runtime',
         summary='The accepted fresh-install proposal moves the existing Nanoleaf processes and private SQLite state into Ubuntu WSL. It keeps Windows Desktop and browser clients, direct numeric-loopback MCP transport and the existing on-demand worker as the sole light writer.',
         reading=['Windows clients stay outside the runtime boundary. Codex Desktop tasks execute in WSL, the browser opens the wall map on port 8765, and configured project, title and unread JSON is read through the mounted filesystem without write access.',
                  'Linux hooks, CLI, wall map and controller coordinate through Linux SQLite. The Node MCP host on port 41230 calls the Python controller directly at 127.0.0.1:41231.',
                  'The controller starts the existing worker on demand. That worker retains the state lock and remains the sole light writer. Setup and the wall map may make bounded device reads for connection checks or geometry.'],
        boundaries=['This is proposed architecture under [[H43]]. Nanoleaf [[N54]] owns source and setup through review candidate PR #57; [[N55]] owns installed services, real-client and physical-light acceptance.',
                     'The installation starts with fresh Linux state. Existing Nanoleaf state need not move, and no runtime SQLite database is shared through /mnt/c.',
                     'Data migration, rollback tooling, a combined daemon, a new hook API, shared monitoring and repository migration [[H26]] remain outside this transition.'],
        sources=[(H, 'docs/architecture.md'), (N, 'docs/decisions/0007-linux-runtime-ownership.md'), (N, 'docs/linux-install.md'), (N, 'bridge/install_linux.py'), (N, 'bridge/README.md'), (N, 'bridge/wall_server.py')],
         issues=['H43', 'N54', 'N55']),
    dict(id='seq-lifecycle-observation', spec=D3, kind='sequence', status='planned',
         status_label='Planned conceptual flow', short='Lifecycle observation',
         summary='A qualified provider signal passes through privacy filtering and bounded submission, is interpreted once, and reaches the device through versioned delivery, native-mode and ownership checks, device-specific rendering and a generation-checked queue.',
         reading=['The hook returns inside its bound even when the core or device is unavailable (dashed return in the first phase).',
                  'The controller checks native mode and manual ownership before rendering; the queue checks the generation again right before writing. “Sent” is transport evidence only.',
                  'A stale cursor gets one authoritative resync without replayed effects. A user acknowledgment changes owner state; it does not invent a provider read receipt.'],
         boundaries=['Activity, attention, notices, acknowledgment, optional provider read evidence and freshness stay distinct. Turn end proves neither success nor readership.',
                     'No finalized agent-event schema or endpoint is shown; those belong to [[H2]], [[H3]] and [[P31]]. Controller v1 cursor fields are not silently applied to the agent-state contract.'],
         sources=[(H, 'docs/architecture.md'), (H, 'docs/controller-contract.md'), (P, 'docs/hub-integration.md'), (N, 'docs/hub-integration.md')],
         issues=['H2', 'H3', 'P29', 'P31', 'N29', 'P32', 'P33']),
    dict(id='seq-nanoleaf-command', spec=D4, kind='sequence', status='implemented',
         status_label='Implemented source; installed and physical acceptance open', short='Nanoleaf command admission',
         summary='Codex reads status, then submits one mode command with the issued request identity and expected revision and generation. The Windows API authenticates before replay lookup, admits the identity atomically, validates revisions, queues the work and rechecks the generation before any side effect.',
         reading=['Phase one returns nextRequestId, configurationRevision and generation. Phase two submits nanoleaf_mode_set with those values.',
                  'Admission alternatives: exact duplicates join or replay the original receipt without a second write; a changed payload conflicts; an expired identity rejects; a stale revision or generation rejects before any effect.',
                  'After admission: superseded work cancels and keeps prior-effect evidence; partial or uncertain results are held. A delivery timeout after dispatch keeps the original requestId and reports possible effects.'],
         boundaries=['Exposed tools are status and mode only. No power, arbitrary brightness, scenes or zones.',
                     'A “sent” receipt is transport evidence, not optical proof. Stopping the MCP host does not stop already admitted controller work.',
                     'The host holds no second ledger and never allocates replacement identities or retries automatically.'],
         sources=[(N, 'docs/local-mcp.md'), (N, 'docs/controller-api.md'), (N, 'mcp/src/transport.ts'), (N, 'bridge/controller_server.py'), (N, 'bridge/controller_state.py'), (H, 'docs/controller-contract.md')],
         issues=['N34', 'N30']),
    dict(id='seq-pixoo-playback', spec=D5, kind='sequence', status='implemented',
         status_label='Implemented source; reliability trial open', short='Pixoo playback ownership',
         summary='A client reads status and catalog pages, then selects media or a playlist with the issued request identity. The owning service admits the request through the shared ledger, resolves the stored rendition, admits the playback context and hands serialized uploads to the backend player and adapter.',
         reading=['The receipt acknowledges context admission while the upload may still be loading. Backend playback continues after Codex disconnects.',
                  'Reads never probe the display or refresh observation timestamps. A lost response is reconciled with current status, not a new write identity.',
                  'Screen off pauses playback; screen on does not resume it. Restart restores paused context without a device write.'],
         boundaries=['Catalog names are untrusted display data. Tools never import or edit media or select raw device targets.',
                     'Original media and referenced renditions are preserved; stale playlist revisions preserve current playback.',
                     'Physical playback, restart and soak evidence remain with [[P12]].'],
         sources=[(P, 'docs/local-mcp.md'), (P, 'docs/playback.md'), (P, 'apps/server/src/mcp-tools.ts'), (H, 'packages/mcp/README.md')],
         issues=['P12', 'P37']),
    dict(id='seq-desktop-input', spec=D6, kind='sequence', status='future',
         status_label='Future work; qualification unverified', short='Wispr and Codex input',
         summary='Selecting a control profile loads mappings and sends zero device commands. Big A press and release drive the qualified Wispr binding; release inserts text without an added send. A fresh mapped mouse press resolves app scope and exactly one of four Codex actions.',
         reading=['Ordinary mouse behavior passes through outside Codex. Held, repeated or stale input does not dispatch twice or replay later.',
                  'Big B stays unavailable until its preset service exists; presses are not buffered.'],
         boundaries=['This path does not wait for the hub, shared monitoring, general controls or Music. Wispr retains its own requirements.',
                     'Hardware support and qualification remain unverified; Retro R8 is only a candidate mouse.',
                     'The first profile editor ([[H70]]) excludes arbitrary scripts, shell execution, raw device commands and multi-step macros.'],
         sources=[(H, 'docs/architecture.md')],
         issues=['H63', 'H64', 'H65', 'H66', 'H70']),
    dict(id='seq-big-b-presets', spec=D7, kind='sequence', status='future',
         status_label='Future work behind the Codex-first milestone', short='Big B presets',
         summary='A fresh Big B press asks the hub for the next preset. The hub owns selection and revision, sends supported native commands to each controller owner, collects independent per-device results and returns them for visible feedback. The initial cycle is Work → Free → Quiet → Work.',
         reading=['One device failing or offline is reported as a partial result; it never stalls the others or looks complete.',
                  'A manual change in a vendor app remains until the next explicit preset request, which then uses supported ownership handoff.',
                  'Startup, reconnect and profile selection replay no presses and issue no device commands. If the hub is unavailable, that is reported and Wispr/mouse controls keep working.'],
         boundaries=['[[H67]] requires [[H63]], [[H32]], [[H31]], [[H5]], [[N49]] and [[P33]]. [[H68]] requires [[H65]] and [[H67]]; [[H69]] also requires [[H8]].',
                     'Manual Big B dispatch does not require automation engine [[H45]]. Music [[H71]] consumes [[H40]] policy and requires [[H68]] and [[H36]]; [[H38]]/[[H39]] apply to selected branches and [[H41]] is conditional on measured audio.',
                     'Native Nanoleaf and Pixoo modes and their restoration limits are preserved; a preset is not a shared device-mode value.'],
         sources=[(H, 'docs/architecture.md'), (H, 'docs/controller-contract.md')],
         issues=['H67', 'H68', 'H69', 'H71']),
    dict(id='seq-owner-migration', spec=D8, kind='sequence', status='future',
         status_label='Future work; design owned by Hub #5/#8 and Pixoo #31', short='Owner migration',
         summary='An explicitly authorized migration quiesces the selected route and old owner, exports and imports versioned state with its identities and revisions, validates the import, keeps the old reducer inactive, switches producer and consumer endpoints and resyncs from authoritative snapshots.',
         reading=['Pixoo’s session-source facade switches renderer, feed, label and acknowledgment operations to the selected owner. Remote mode never starts a second local reducer.',
                  'Rollback happens only after quiescing the new owner. Consumers reload from an authoritative snapshot; no expired effects are replayed.'],
         boundaries=['No transfer algorithm, schema or runnable migration command is defined here; [[H5]], [[H8]] and [[P31]] own that design.',
                     'Controller databases stay private. Windows and WSL never coordinate through a mounted SQLite file.',
                     'Legacy Nanoleaf ingestion remains until an authorized verified cutover with one selected ingestion path per session. Repository moves ([[H25]], [[H26]]), container hosting ([[H42]]) and device-writer ownership are separate changes.'],
         sources=[(H, 'docs/architecture.md'), (P, 'docs/hub-integration.md'), (N, 'docs/hub-integration.md')],
         issues=['H5', 'H8', 'P31', 'N29']),
]
assert len({d['id'] for d in DIAGRAMS}) == len(DIAGRAMS)


# ---------------------------------------------------------------------------
# Rendering and extraction
# ---------------------------------------------------------------------------
def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run(args):
    result = subprocess.run(args, capture_output=True, text=True)
    return result.returncode, result.stdout, result.stderr


def extract(html_path, diagram):
    """Pull the inline SVG and the CSS rules its classes rely on out of the viewer."""
    page = Path(html_path).read_text(encoding='utf-8')
    svg = re.search(r'<svg[^>]*aria-labelledby="archify-diagram-title[^>]*>.*?</svg>', page, re.S).group(0)
    style = ''.join(re.findall(r'<style[^>]*>(.*?)</style>', page, re.S))
    style = re.sub(r'/\*.*?\*/', '', style, flags=re.S)
    classes = set(re.findall(r'class="([^"]+)"', svg))
    classes = {c for group in classes for c in group.split()}
    rules = []
    for match in re.finditer(r'([^{}]+)\{([^{}]*)\}', style):
        selector, body = match.group(1).strip(), match.group(2).strip()
        if selector.startswith('@') or 'data-preset' in selector or 'data-theme' in selector:
            continue
        names = set(re.findall(r'\.([A-Za-z0-9_-]+)', selector))
        if names and names <= classes | {'semantic-sigil', 'sigil-fill'} and not any(x in selector for x in ['#', ':hover', 'data-', '.diagram-']):
            rules.append((selector, body))
    variables = {}
    for block in re.findall(r'\[data-theme\]\s*\{([^}]*)\}', style) + re.findall(r'\[data-theme="dark"\]\s*\{([^}]*)\}', style)[:1]:
        for name, value in re.findall(r'(--[A-Za-z0-9-]+)\s*:\s*([^;]+);', block):
            variables.setdefault(name, value.strip())
    light = {}
    for block in re.findall(r'\[data-theme="light"\]\s*\{([^}]*)\}', style)[:1]:
        for name, value in re.findall(r'(--[A-Za-z0-9-]+)\s*:\s*([^;]+);', block):
            light[name] = value.strip()
    # Make IDs unique per diagram so nine inline SVGs can share one document.
    prefix = diagram['id']
    svg = re.sub(r'id="([A-Za-z0-9_-]+)"', lambda m: f'id="{prefix}-{m.group(1)}"', svg)
    svg = re.sub(r'url\(#([A-Za-z0-9_-]+)\)', lambda m: f'url(#{prefix}-{m.group(1)})', svg)
    svg = re.sub(r'aria-labelledby="[^"]*"', f'aria-labelledby="{prefix}-archify-diagram-title {prefix}-archify-diagram-description"', svg)
    svg = re.sub(r'<desc id="([^"]+)">.*?</desc>', lambda m: f'<desc id="{m.group(1)}">@@DESC@@</desc>', svg, flags=re.S)
    svg = re.sub(r'\s(data-animation|data-preset|data-quality-profile)="[^"]*"', '', svg)
    svg = re.sub(r'<svg ', '<svg class="archify" preserveAspectRatio="xMidYMid meet" ', svg, count=1)
    return svg, rules, variables, light


def render():
    if not (ARCHIFY / 'bin' / 'archify.mjs').exists():
        sys.exit(f'Archify skill not found at {ARCHIFY}; set ARCHIFY_DIR (no download is attempted).')
    SPECS.mkdir(parents=True, exist_ok=True)
    RENDERED.mkdir(parents=True, exist_ok=True)
    receipts = {'renderedAt': datetime.now(timezone.utc).isoformat(), 'archify': str(ARCHIFY), 'diagrams': []}
    css_rules, dark_vars, light_vars = {}, {}, {}
    for diagram in DIAGRAMS:
        spec_path = SPECS / f"{diagram['id']}.json"
        spec_path.write_text(json.dumps(diagram['spec'], indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
        out = RENDERED / f"{diagram['id']}.html"
        code, stdout, stderr = run(['node', str(ARCHIFY / 'bin' / 'archify.mjs'), 'deliver', diagram['kind'], str(spec_path), str(out), '--quality', 'showcase', '--json'])
        if code != 0:
            print(stdout, stderr)
            sys.exit(f"Archify delivery failed for {diagram['id']}")
        receipt = json.loads(stdout)
        validation = receipt['validation']
        assert validation['checksPassed'] == validation['checkCount'] == 9 and validation['errors'] == 0 and validation['warnings'] == 0, validation
        svg, rules, variables, light = extract(out, diagram)
        (RENDERED / f"{diagram['id']}.svg").write_text(svg, encoding='utf-8')
        for selector, body in rules:
            css_rules.setdefault(selector, body)
        for k, v in variables.items():
            dark_vars.setdefault(k, v)
        for k, v in light.items():
            light_vars.setdefault(k, v)
        receipts['diagrams'].append({'id': diagram['id'], 'type': diagram['kind'], 'status': diagram['status'], 'specification': receipt['specification'], 'artifact': receipt['artifact'], 'validation': validation, 'viewer': out.name, 'svgSha256': sha256(RENDERED / f"{diagram['id']}.svg")})
        print(diagram['id'], 'ok', validation['checksPassed'], '/', validation['checkCount'], receipt['artifact']['bytes'], 'bytes')
    (RENDERED / 'archify-classes.json').write_text(json.dumps({'rules': css_rules, 'dark': dark_vars, 'light': light_vars}, indent=1) + '\n', encoding='utf-8')
    (ARCH / 'diagram-receipts.json').write_text(json.dumps(receipts, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'diagrams': len(receipts['diagrams']), 'receipts': str(ARCH / 'diagram-receipts.json')}))


if __name__ == '__main__':
    render()
