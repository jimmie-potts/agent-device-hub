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


def seq(diagram_id, title, participants, steps, cards, views=None, width=None, first_y=196, step_height=STEP, segment_gap=14):
    messages, segments, y = [], [], first_y
    current = None
    extra = segment_gap - 14  # room between the previous arrow and the next segment label
    for step in steps:
        if step[0] == 'seg':
            if current:
                current['to'] = y - step_height // 2 + extra
                segments.append(current)
            current = {'from': y - 18 + extra, 'label': step[1]}
            y += segment_gap
            continue
        _, frm, to, label = step[:4]
        message = {'from': frm, 'to': to, 'y': y, 'label': label}
        if len(step) > 4 and step[4]:
            message['variant'] = step[4]
        if len(step) > 5 and step[5]:
            message['note'] = step[5]
        messages.append(message)
        y += step_height
    if current:
        current['to'] = y - step_height // 2
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
        c1('browser', 'frontend', 'Browser / native client', '/api · /controller/v1', 0, 2),
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
        {'dot': 'cyan', 'title': 'Pixoo path (implemented)', 'items': ['Strict application extensions carry the native string request_id', 'Native controller v1, browser and MCP share one request ledger', 'One serialized adapter queue; simulator unless device mode is selected']},
        {'dot': 'violet', 'title': 'Nanoleaf path (implemented)', 'items': ['Controller-v1 envelope: requestId, expectedConfigurationRevision, expectedGeneration', 'Windows uses direct loopback HTTP; WSL uses the configured Windows Python helper', 'Neither route opens the Windows SQLite database']},
        {'dot': 'slate', 'title': 'Shared library', 'items': ['device-mcp registers tools and validates transport', 'It opens no listener and starts no device writer', 'Host ownership stays with each application']},
    ],
    layout={'mode': 'grid', 'origin': [40, 40], 'cols': 4, 'cellW': 170, 'cellH': 62, 'gapX': 90, 'gapY': 58},
    views=[
        {'id': 'pixoo-route', 'label': 'Pixoo route', 'focus': ['codex', 'pixooMcp', 'pixooSvc', 'pixooQueue', 'pixooDev', 'browser'], 'note': 'Codex, browser and optional native clients share the same services and one queue.'},
        {'id': 'nanoleaf-route', 'label': 'Nanoleaf route', 'focus': ['codex', 'nanoHost', 'nanoRoute', 'nanoApi', 'nanoWorker', 'nanoState', 'lights'], 'note': 'The MCP host forwards controller-v1 requests; the Windows worker keeps the writes.'},
        {'id': 'shared-library', 'label': 'Shared library', 'focus': ['mcpPkg', 'pixooMcp', 'nanoRoute', 'nanoHost'], 'note': 'Reusable code, separately owned hosts.'},
    ],
)

# ---------------------------------------------------------------------------
# 2. System map: what runs where (shared with the BUNNY atlas)
# ---------------------------------------------------------------------------
SIZE2 = [150, 62]


def c2(id, type, label, sublabel, row, col, tag=None):
    component = {'id': id, 'type': type, 'label': label, 'sublabel': sublabel, 'row': row, 'col': col, 'size': SIZE2}
    if tag:
        component['tag'] = tag
    return component


D2 = arch(
    'BUNNY system map: what runs where',
    components=[
        c2('providers', 'external', 'Agent providers', 'Codex CLI · Desktop · Claude Code', 0, 0),
        c2('hooks', 'security', 'Provider hooks', 'allowlisted metadata · fail-open', 0, 1, 'source · setup SDK'),
        c2('dashboard', 'frontend', 'BUNNY dashboard', 'React · served by the hub at /', 0, 2, 'source delivered'),
        c2('mcpClients', 'external', 'MCP clients', 'Codex · Claude Code', 0, 3),
        c2('future', 'external', 'Music + automation', 'Windows connector · rules', 0, 4, 'future · own owner'),
        c2('mcpModule', 'backend', 'device-mcp module', 'library · no listener', 1, 1, 'source 1.0.0'),
        c2('hubRoutes', 'security', 'Hub HTTP routes', 'monitor · controllers · mcp', 1, 2, 'loopback · bearer'),
        c2('core', 'backend', 'Agent-state core', 'reducer · one active owner', 1, 3, 'source delivered'),
        c2('hubStore', 'database', 'Hub private SQLite', 'owner + state files · 0700', 1, 4, 'never a controller store'),
        c2('nanoWorker', 'backend', 'Nanoleaf light worker', 'sole light writer', 2, 0, 'designated writer'),
        c2('nanoCtl', 'security', 'Nanoleaf controller', '/controller/v1 · shared input', 2, 1, 'Linux · installed'),
        c2('pixooSvc', 'backend', 'Pixoo backend', 'ControlService · one queue', 2, 3, 'designated writer'),
        c2('pixooStore', 'database', 'Pixoo private SQLite', 'library · owner lock', 2, 4),
        c2('lights', 'external', 'Nanoleaf Lines', 'configured LAN device', 3, 0),
        c2('nanoStore', 'database', 'Nanoleaf SQLite', 'Linux-owned · private', 3, 1),
        c2('newCtl', 'cloud', 'New controllers', 'Tidbyt · LIFX · PC lighting', 3, 2, 'Tidbyt source · rest planned'),
        c2('pixooDev', 'external', 'Pixoo 64×64', 'simulator unless selected', 3, 3),
    ],
    connections=[
        {'id': 'observe', 'from': 'providers', 'to': 'hooks', 'label': 'lifecycle events', 'variant': 'emphasis', 'fromSide': 'right', 'toSide': 'left', 'labelDy': 55},
        {'id': 'ingest', 'from': 'hooks', 'to': 'hubRoutes', 'label': 'POST events', 'variant': 'emphasis', 'fromSide': 'bottom', 'toSide': 'top', 'labelDx': -40, 'labelDy': 24},
        {'id': 'ui', 'from': 'dashboard', 'to': 'hubRoutes', 'label': 'read · control', 'variant': 'security', 'fromSide': 'bottom', 'toSide': 'top', 'labelDx': 44, 'labelDy': 24},
        {'id': 'mcp', 'from': 'mcpClients', 'to': 'hubRoutes', 'label': 'MCP tools', 'variant': 'security', 'fromSide': 'bottom', 'toSide': 'top', 'labelDx': 40, 'labelDy': 24},
        {'id': 'reduce', 'from': 'hubRoutes', 'to': 'core', 'label': 'ingest · snapshot', 'variant': 'emphasis', 'fromSide': 'right', 'toSide': 'left', 'labelDy': 55},
        {'id': 'commit', 'from': 'core', 'to': 'hubStore', 'label': 'commit revision', 'fromSide': 'right', 'toSide': 'left', 'labelDy': 55},
        {'id': 'imports', 'from': 'mcpModule', 'to': 'hubRoutes', 'label': 'imports', 'fromSide': 'right', 'toSide': 'left', 'labelDy': 55},
                {'id': 'feed-nano', 'from': 'hubRoutes', 'to': 'nanoCtl', 'label': 'state feed', 'variant': 'dashed', 'fromSide': 'bottom', 'toSide': 'top', 'labelSegment': 1, 'labelDx': -60, 'labelDy': 12},
                {'id': 'cmd-nano', 'from': 'hubRoutes', 'to': 'nanoCtl', 'label': 'controller v1 command', 'variant': 'security', 'fromSide': 'bottom', 'toSide': 'right', 'labelSegment': 1, 'labelDx': -30, 'labelDy': 0},
                {'id': 'feed-pixoo', 'from': 'hubRoutes', 'to': 'pixooSvc', 'label': 'state feed', 'variant': 'dashed', 'fromSide': 'bottom', 'toSide': 'top', 'labelSegment': 1, 'labelDx': 60, 'labelDy': 12},
                {'id': 'cmd-pixoo', 'from': 'hubRoutes', 'to': 'pixooSvc', 'label': 'controller v1 command', 'variant': 'security', 'fromSide': 'bottom', 'toSide': 'left', 'labelSegment': 1, 'labelDx': 40, 'labelDy': 0},
        {'id': 'nano-queue', 'from': 'nanoCtl', 'to': 'nanoWorker', 'label': 'queued work', 'variant': 'emphasis', 'fromSide': 'left', 'toSide': 'right', 'labelDy': 29},
        {'id': 'nano-state', 'from': 'nanoCtl', 'to': 'nanoStore', 'label': 'state · lock', 'fromSide': 'bottom', 'toSide': 'top', 'labelDx': 40, 'labelDy': 24},
        {'id': 'nano-lights', 'from': 'nanoWorker', 'to': 'lights', 'label': 'transmit', 'variant': 'emphasis', 'fromSide': 'bottom', 'toSide': 'top', 'labelDx': 34, 'labelDy': 24},
        {'id': 'pixoo-state', 'from': 'pixooSvc', 'to': 'pixooStore', 'label': 'private', 'fromSide': 'right', 'toSide': 'left', 'labelDy': 29},
        {'id': 'pixoo-dev', 'from': 'pixooSvc', 'to': 'pixooDev', 'label': 'serialized upload', 'variant': 'emphasis', 'fromSide': 'bottom', 'toSide': 'top', 'labelDx': 56, 'labelDy': 24},
    ],
    boundaries=[
        {'kind': 'region', 'label': 'Linux hub process (apps/hub) · source; installation separate', 'wraps': ['mcpModule', 'hubRoutes', 'core', 'hubStore']},
        {'kind': 'security-group', 'label': 'Nanoleaf Linux runtime (codex-nanoleaf, WSL)', 'wraps': ['nanoWorker', 'nanoCtl', 'nanoStore']},
        {'kind': 'security-group', 'label': 'Pixoo backend process (divoom-app-upgrade)', 'wraps': ['pixooSvc', 'pixooStore']},
    ],
    cards=[
        {'dot': 'cyan', 'title': 'Observation path', 'items': ['Provider hooks send allowlisted lifecycle metadata and return within their bound', 'The core interprets observations once and commits each revision to its private store', 'Consumers receive revision notifications and read the current snapshot']},
        {'dot': 'rose', 'title': 'Command path', 'items': ['Dashboard and MCP clients authenticate at the hub routes', 'The hub sends controller v1 commands to each existing owner', 'Per-device queues: an offline device cannot stall another']},
        {'dot': 'emerald', 'title': 'Ownership', 'items': ['One active agent-state owner; Pixoo can embed the same core', 'Each physical device keeps one designated writer and private state', 'Music, rules and new controllers are labelled separately']},
    ],
    layout={'mode': 'grid', 'origin': [40, 40], 'cols': 5, 'cellW': 150, 'cellH': 62, 'gapX': 60, 'gapY': 80},
    views=[
        {'id': 'observe', 'label': 'Observation path', 'focus': ['providers', 'hooks', 'hubRoutes', 'core', 'hubStore', 'nanoCtl', 'pixooSvc'], 'note': 'One shared interpretation; controllers project state.'},
        {'id': 'command', 'label': 'Command path', 'focus': ['dashboard', 'mcpClients', 'mcpModule', 'hubRoutes', 'nanoCtl', 'pixooSvc'], 'note': 'Explicit requests reach the existing command owners.'},
        {'id': 'writers', 'label': 'Writers and stores', 'focus': ['nanoWorker', 'nanoStore', 'lights', 'pixooSvc', 'pixooStore', 'pixooDev', 'hubStore'], 'note': 'One writer and one private store per owner.'},
    ],
)

# Responsibility text and owning code for every map node. The atlas renders these
# behind selection; design.json adds the atlas-owned document and reference links.
MAP_DETAILS = {
    'providers': dict(role='Codex CLI, Codex Desktop and Claude Code execute agent work. Only their lifecycle hooks feed BUNNY, and each client remains a distinct qualification target. Prompts, transcripts and tool content stay with the provider.', sources=[(H, 'docs/provider-qualification.md'), (H, 'docs/agent-lifecycle-contract.md')]),
    'hooks': dict(role='The setup SDK installs one producer per qualified source. Each hook normalizes allowlisted metadata, sends one bounded request to the selected owner within a 2.9-second deadline, and returns silently on invalid input, saturation or an offline owner. It never changes agent permissions or waits for a device.', sources=[(H, 'apps/hub/SETUP.md'), (H, 'docs/agent-lifecycle-contract.md')]),
    'dashboard': dict(role='The React frontend is built into apps/hub/public and served by the hub at / with a same-origin content security policy. It reads the dashboard context route with a browser credential and submits explicit integration commands. It creates no collector and no device writer.', sources=[(H, 'apps/dashboard/README.md'), (H, 'apps/hub/README.md')]),
    'mcpClients': dict(role='Codex or Claude Code connect to the optional /mcp route on the same loopback listener with an independently provisioned machine credential. Tools cover hub sessions, labels, acknowledgment, device discovery and per-device status, power, brightness, mode and integration operations. Read scope never grants control.', sources=[(H, 'apps/hub/README.md'), (H, 'apps/hub/src/mcp.ts')]),
    'future': dict(role='The music connector, playback-state service and automation rules are design only; an iPhone Apple Music qualification record exists but no connector source. Music keeps its own state owner; rules may combine playback and task facts but never bypass a controller queue. Nothing in this box is implemented.', sources=[(H, 'docs/architecture.md'), (H, 'docs/iphone-apple-music-qualification.md')]),
    'mcpModule': dict(role='The device-mcp package is a library that validates MCP 2025-11-25 and 2025-06-18 requests, checks Host, Origin and scopes, and dispatches registered tools to owning services. It opens no listener, scans no network and writes to no device; the embedding host owns the route.', sources=[(H, 'packages/mcp/README.md')]),
    'hubRoutes': dict(role='One numeric-loopback listener authenticates every request before replay. Monitor routes: GET /api/monitor/v1/sessions, POST /api/monitor/v1/events, POST /api/monitor/v1/commands and the SSE feed GET /api/monitor/v1/changes. Host routes: GET /api/hub/v1/health and /api/hub/v1/authority. Dashboard context: GET /api/dashboard/v1/context. Controller routes: /api/controllers/v1/:id/snapshot, /commands and /integration/{snapshot,commands,receipt,cancel}. Optional /mcp. Limits: 32 concurrent requests, 16 streams, three seconds per request.', sources=[(H, 'apps/hub/README.md'), (H, 'apps/hub/src/server.ts')]),
    'core': dict(role='The agent-state package interprets each lifecycle envelope once: deduplication, turn, attention and notice reduction, freshness and consumer-scoped acknowledgment. Every commit increments a revision. Exactly one owner is active per installation; the Pixoo backend can embed this same package instead of the standalone hub.', sources=[(H, 'packages/agent-state/README.md'), (H, 'docs/architecture.md')]),
    'hubStore': dict(role='HubStorage keeps owner.sqlite (an exclusive lease) and state.sqlite (one revisioned state row plus a quiesce fence) in an owner-only 0700 directory outside every checkout and outside /mnt. It never opens a controller database, and no shared hub schema exists in the reference yet.', sources=[(H, 'apps/hub/src/storage.ts'), (H, 'packages/agent-state/README.md')]),
    'nanoWorker': dict(role='The existing Python worker is the sole writer to the Lines. The controller starts it on demand; it holds the state lock and applies Work, Quiet and Free, geometry and effects. Shared input only changes what it projects, never who writes.', sources=[(N, 'bridge/README.md'), (N, 'docs/decisions/0007-linux-runtime-ownership.md')]),
    'nanoCtl': dict(role='The Python controller listens on 127.0.0.1:41231 and exposes /controller/v1 behind a bearer credential. Its shared-input consumer polls the selected owner\'s /api/monitor/v1/sessions, validates owner, revision and declared sources, and maps sessions onto the Lines. Installed in WSL and verified on real tasks (Nanoleaf #30 and #55, closed 22 September 2026).', sources=[(N, 'docs/controller-api.md'), (N, 'docs/shared-input.md'), (N, 'bridge/shared_input.py')]),
    'nanoStore': dict(role='Linux-owned SQLite under the Nanoleaf data directory holds tasks, projects, wall preferences and controller state. It stays on Linux; retained Windows installations keep their own file, and no runtime database is shared through /mnt/c.', sources=[(N, 'docs/linux-install.md'), (N, 'docs/decisions/0007-linux-runtime-ownership.md')]),
    'lights': dict(role='The configured LAN device. A transport acknowledgment is not optical proof; physical checks need an explicit device address and authorization.', sources=[(N, 'docs/controller-api.md')]),
    'pixooSvc': dict(role='ControlService owns the catalog, player, 64×64 renderer, Monitor/Media policy and one serialized adapter queue. Browser, MCP and native controller v1 clients share one request ledger. Source #31 lets this process embed the agent-state core or act as a remote facade of the hub.', sources=[(P, 'docs/hub-integration.md'), (P, 'docs/hub-controller-api.md'), (P, 'apps/server/src/controller.ts')]),
    'pixooStore': dict(role='A private SQLite media library (assets, immutable renditions, playlists, retained sessions) plus a separate one-table owner lock that keeps one library writer. It is not a shared hub database.', sources=[(P, 'docs/playback.md')]),
    'newCtl': dict(role='The Tidbyt cloud controller (64×32) exists as a fake-tested, in-process TypeScript package under controllers/tidbyt: renderer, cloud connection and credential loader, with no listener, no installation and no agent-status hookup yet. LIFX (direct LAN) and PC lighting remain in the backlog. All inherit the one-writer rule.', sources=[(H, 'controllers/tidbyt/README.md'), (H, 'docs/architecture.md')]),
    'pixooDev': dict(role='Startup defaults to the simulator; an explicitly selected device uses the same queue. Uploads acknowledge transport only.', sources=[(P, 'docs/hub-controller-api.md')]),
}

# One entry per walkthrough segment, in order.
WALK_PHASES = [
    dict(label='Observe', text='A provider hook builds the allowlisted envelope and posts it once to /api/monitor/v1/events with its ingest credential. The hub answers applied, duplicate, stale or a fixed rejection code. If the hub is slow or down the hook still returns within 2.9 seconds; the observation is dropped, never queued for later delivery.', sources=[(H, 'apps/hub/SETUP.md'), (H, 'docs/agent-lifecycle-contract.md'), (H, 'apps/hub/src/server.ts')]),
    dict(label='Commit and publish state', text='The reducer interprets the event and commits revision N to state.sqlite with a compare-and-swap. Only then does the hub push a state event on the SSE feed; it carries the revision, not a replayable command log. Consumers read the current snapshot from /sessions. Nanoleaf\'s shared input polls that route instead of streaming.', sources=[(H, 'packages/agent-state/README.md'), (H, 'apps/hub/src/server.ts'), (N, 'bridge/shared_input.py')]),
    dict(label='Project and write', text='The controller maps the snapshot through its own policy (Pixoo Monitor/Media, Nanoleaf Work/Quiet/Free), selects a view and hands it to its sole device queue, which checks the generation again before writing. The hub never commands the device on this path; sent is transport evidence, not optical proof.', sources=[(P, 'apps/server/src/monitor-presentation.ts'), (P, 'docs/decisions/0018-monitor-display-ownership.md'), (N, 'docs/shared-input.md')]),
    dict(label='Interruption and reconnect', text='A consumer that reconnects with an expired or unknown Last-Event-ID receives a resync event and reads the current snapshot. Nothing is replayed, no device effect is repeated, and restored sessions stay uncertain until fresh evidence arrives. The hub README HTTP boundary and the agent-state README describe this behavior.', sources=[(H, 'apps/hub/README.md'), (H, 'packages/agent-state/README.md')]),
]

# ---------------------------------------------------------------------------
# 3. One agent observation, from hook to device (shared with the BUNNY atlas)
# ---------------------------------------------------------------------------
D3 = seq(
    'lifecycle-observation', 'One agent observation, from hook to device',
    participants=[
        {'id': 'hook', 'type': 'security', 'label': 'Provider hook', 'sublabel': 'Codex / Claude · fail-open'},
        {'id': 'hub', 'type': 'security', 'label': 'Hub HTTP routes', 'sublabel': '/api/monitor/v1'},
        {'id': 'core', 'type': 'backend', 'label': 'Agent-state core', 'sublabel': 'reducer · one owner'},
        {'id': 'store', 'type': 'database', 'label': 'Private SQLite', 'sublabel': 'state.sqlite'},
        {'id': 'controller', 'type': 'backend', 'label': 'Controller consumer', 'sublabel': 'Pixoo or Nanoleaf'},
        {'id': 'device', 'type': 'external', 'label': 'Device', 'sublabel': 'one designated writer'},
    ],
    steps=[
        ('seg', '1 · Observe'),
        ('msg', 'hook', 'hub', 'POST /events: allowlisted metadata, ingest bearer', 'emphasis', 'prompts, transcripts, tool content and titles never leave the host'),
        ('msg', 'hub', 'core', 'ingest(envelope)', 'emphasis'),
        ('msg', 'hub', 'hook', 'applied · duplicate · stale — within the hook bound', 'return', 'the hook also returns when the hub is down'),
        ('seg', '2 · Commit and publish state'),
        ('msg', 'core', 'store', 'commit revision N (compare-and-swap)', 'emphasis'),
        ('msg', 'store', 'core', 'durable', 'return'),
        ('msg', 'core', 'controller', 'publish revision N: SSE /changes (Nanoleaf polls /sessions)', 'dashed', 'a revision pointer, never a replayable command log'),
        ('msg', 'controller', 'hub', 'GET /sessions (read scope)', 'default'),
        ('msg', 'hub', 'controller', 'snapshot N: sessions, freshness, notices', 'return'),
        ('seg', '3 · Project and write'),
        ('msg', 'controller', 'device', 'native policy → view → sole queue (generation check)', 'emphasis', 'Monitor/Media or Work/Quiet/Free stays with the controller'),
        ('msg', 'device', 'controller', 'sent — transport evidence, not optical proof', 'return'),
        ('seg', 'Alternative · interruption and reconnect'),
        ('msg', 'controller', 'hub', 'reconnect /changes with Last-Event-ID', 'dashed'),
        ('msg', 'hub', 'controller', 'resync: cursor expired → read snapshot, no replayed effects', 'return'),
    ],
    cards=[
        {'dot': 'cyan', 'title': 'Two different arrows', 'items': ['Dashed: the core publishes state; consumers read snapshots.', 'Solid green at the end: the controller writes its device through its own queue.']},
        {'dot': 'amber', 'title': 'Evidence limits', 'items': ['Turn end proves neither success nor readership.', 'Five minutes without evidence means uncertain, not failed.']},
    ],
    views=[
        {'id': 'observe', 'label': 'Observe and commit', 'focus': ['hook', 'hub', 'core', 'store'], 'note': 'Small, filtered, bounded; committed once.'},
        {'id': 'present', 'label': 'Project and write', 'focus': ['core', 'hub', 'controller', 'device'], 'note': 'Publication, projection, generation check, write.'},
    ],
    first_y=172, step_height=36, segment_gap=30,
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
        {'dot': 'cyan', 'title': 'One owner', 'items': ['Browser, MCP and native controller v1 share one ledger and writer', 'Playback tools never import or edit media or pick raw device targets']},
        {'dot': 'violet', 'title': 'Receipts and evidence', 'items': ['A receipt acknowledges admission; upload can still be loading', 'Reconcile a lost response with status, not a new write identity', 'Native snapshots retain upload outcomes across cancellation']},
        {'dot': 'amber', 'title': 'Preserved behavior', 'items': ['Screen off pauses; screen on does not resume', 'Paused context and referenced renditions survive restart', 'Original media and referenced renditions stay intact']},
    ],
    views=[
        {'id': 'select', 'label': 'Select', 'focus': ['client', 'service', 'library', 'player'], 'note': 'Identity, revision and rendition checks before admission.'},
        {'id': 'play', 'label': 'Play', 'focus': ['player', 'adapter', 'device'], 'note': 'Serialized writes owned by the backend.'},
    ],
    width=1240,
)

# ---------------------------------------------------------------------------
# 6. Independent Codex mouse controls (future, H63–H66, H70)
# ---------------------------------------------------------------------------
D6 = seq(
    'desktop-input', 'Independent Codex mouse controls',
    participants=[
        {'id': 'user', 'type': 'external', 'label': 'User', 'sublabel': 'shared navigation keys'},
        {'id': 'dispatcher', 'type': 'backend', 'label': 'Windows dispatcher', 'sublabel': 'local, no hub'},
        {'id': 'profile', 'type': 'database', 'label': 'Control profile', 'sublabel': 'bindings + app scope'},
        {'id': 'app', 'type': 'frontend', 'label': 'Focused app', 'sublabel': 'Codex or other'},
    ],
    steps=[
        ('seg', 'Profile selection'),
        ('msg', 'user', 'dispatcher', 'select control profile', 'emphasis'),
        ('msg', 'dispatcher', 'profile', 'load mappings; no input or device commands', 'default'),
        ('seg', 'One Codex action'),
        ('msg', 'user', 'dispatcher', 'fresh mapped navigation press', 'emphasis'),
        ('msg', 'dispatcher', 'profile', 'resolve control, app scope and action', 'default'),
        ('msg', 'dispatcher', 'app', 'next attention task · command menu · previous task · next task', 'emphasis', 'exactly one action per deliberate press'),
        ('seg', 'Boundaries'),
        ('msg', 'dispatcher', 'app', 'outside Codex → ordinary mouse behavior', 'dashed'),
        ('msg', 'dispatcher', 'profile', 'held / repeated / stale input → no duplicate or replay', 'dashed'),
        ('msg', 'dispatcher', 'user', 'report dispatch separately from app success', 'return'),
    ],
    cards=[
        {'dot': 'cyan', 'title': 'Independent path', 'items': ['Mouse dispatch needs no hub, shared monitoring, general controls or Music', 'Keyboard A/B and attached Super Buttons stay outside B.U.N.N.Y.']},
        {'dot': 'violet', 'title': 'Ownership', 'items': ['The keyboard owns its A/B assignments, including personal Wispr and Enter mappings', 'B.U.N.N.Y. does not edit, store, dispatch or use them for presets']},
        {'dot': 'amber', 'title': 'Brief trial passed', 'items': ['N30 actions, outside-app behavior and stopping passed (H64)', 'Other devices share these keys inside Codex; no per-device filtering', 'H65/H66 still own implementation and installation']},
    ],
    width=1100,
)

# ---------------------------------------------------------------------------
# 7. Configured presets, partial results and manual handoff (future, H67–H69, H71)
# ---------------------------------------------------------------------------
D7 = seq(
    'big-b-presets', 'Desk presets, partial results and manual handoff',
    participants=[
        {'id': 'user', 'type': 'external', 'label': 'User', 'sublabel': 'preset binding · vendor app'},
        {'id': 'dispatcher', 'type': 'backend', 'label': 'Windows dispatcher', 'sublabel': 'binding + feedback'},
        {'id': 'hub', 'type': 'security', 'label': 'Hub preset service', 'sublabel': 'authoritative selection'},
        {'id': 'nanoleaf', 'type': 'backend', 'label': 'Nanoleaf owner', 'sublabel': 'Work/Quiet/Free'},
        {'id': 'pixoo', 'type': 'backend', 'label': 'Pixoo owner', 'sublabel': 'Monitor/Media'},
    ],
    steps=[
        ('seg', 'Fresh press, one transition'),
        ('msg', 'user', 'dispatcher', 'fresh configured preset press', 'emphasis'),
        ('msg', 'dispatcher', 'hub', 'request next preset (Work → Free → Quiet → Work) with known revision', 'emphasis'),
        ('msg', 'hub', 'nanoleaf', 'supported native command + requestId/revision/generation', 'security'),
        ('msg', 'hub', 'pixoo', 'supported native command + request_id', 'security'),
        ('msg', 'nanoleaf', 'hub', 'queued / sent', 'return'),
        ('msg', 'pixoo', 'hub', 'failed: offline (independent queue)', 'return'),
        ('msg', 'hub', 'dispatcher', 'selected preset + per-device results (partial)', 'return'),
        ('msg', 'dispatcher', 'user', 'visible feedback: requested, sent, failed, uncertain', 'return', 'transport outcomes are not optical proof'),
        ('seg', 'Manual change stays until the next explicit preset'),
        ('msg', 'user', 'nanoleaf', 'manual scene change in the vendor app', 'dashed'),
        ('msg', 'user', 'dispatcher', 'next fresh configured preset press', 'emphasis'),
        ('msg', 'hub', 'nanoleaf', 'supported ownership handoff, then preset action', 'security'),
        ('seg', 'No replay'),
        ('msg', 'dispatcher', 'hub', 'startup · reconnect · profile selection → no presses replayed, no device commands', 'dashed'),
        ('msg', 'hub', 'dispatcher', 'hub unavailable → reported; local mouse controls keep working', 'return'),
    ],
    cards=[
        {'dot': 'cyan', 'title': 'Authoritative selection', 'items': ['The hub owns preset selection and revision; clients keep no diverging counter', 'Superseded requests retire through existing generation rules']},
        {'dot': 'violet', 'title': 'Independent results', 'items': ['One offline device cannot stall others', 'A partial operation is never shown as complete', 'Native modes and restoration limits are preserved']},
        {'dot': 'amber', 'title': 'Prerequisites', 'items': ['H67 needs H63, H32, H31, H5, Nanoleaf #49 and Pixoo #33', 'H68 needs H65 and H67; H69 also needs H8', 'Manual dispatch does not need automation engine H45; Music H71 follows H40, H68 and H36']},
    ],
    width=1180,
)

# ---------------------------------------------------------------------------
# 8. Supervised source migration (H5); installed cutover remains H8
# ---------------------------------------------------------------------------
D8 = seq(
    'owner-migration', 'Embedded core to standalone owner',
    participants=[
        {'id': 'operator', 'type': 'external', 'label': 'Operator', 'sublabel': 'explicit authorization'},
        {'id': 'tooling', 'type': 'security', 'label': 'Migration tooling', 'sublabel': 'supervised Node children'},
        {'id': 'pixoo', 'type': 'backend', 'label': 'Pixoo embedded owner', 'sublabel': 'session-source facade'},
        {'id': 'hub', 'type': 'backend', 'label': 'Standalone hub owner', 'sublabel': 'same core, new host'},
        {'id': 'producers', 'type': 'external', 'label': 'Producers', 'sublabel': 'provider hooks'},
        {'id': 'consumers', 'type': 'frontend', 'label': 'Consumers', 'sublabel': 'Pixoo and Nanoleaf'},
    ],
    steps=[
        ('seg', 'Quiesce'),
        ('msg', 'operator', 'tooling', 'authorize migration (named owner)', 'emphasis'),
        ('msg', 'tooling', 'producers', 'remove old setup; verify access revoked', 'security'),
        ('msg', 'tooling', 'pixoo', 'quiesce old owner; preserve state', 'security'),
        ('seg', 'Export, import, validate'),
        ('msg', 'tooling', 'pixoo', 'versioned export: source/session/notice identity + revisions', 'emphasis'),
        ('msg', 'pixoo', 'tooling', 'private export; verified graceful exit', 'return'),
        ('msg', 'tooling', 'hub', 'single-use import into fenced empty store', 'emphasis'),
        ('msg', 'hub', 'tooling', 'validated: identities, revisions, notices unchanged', 'return'),
        ('msg', 'tooling', 'pixoo', 'keep old reducer inactive; facade → remote owner', 'security', 'remote mode never starts a second local reducer'),
        ('seg', 'Switch and resync'),
        ('msg', 'tooling', 'producers', 'fresh setup receipt; stage disabled route', 'emphasis'),
        ('msg', 'tooling', 'consumers', 'Pixoo route; Nanoleaf preflight / select', 'emphasis'),
        ('msg', 'consumers', 'hub', 'authoritative snapshot / resync', 'default'),
        ('msg', 'hub', 'consumers', 'snapshot (no replayed effects)', 'return'),
        ('msg', 'producers', 'hub', 'enable after readiness; open admission', 'default'),
        ('seg', 'Rollback (only after quiescing the new owner)'),
        ('msg', 'tooling', 'hub', 'revoke setup; quiesce new owner', 'dashed'),
        ('msg', 'tooling', 'hub', 'latest export → fresh store; recheck routes', 'dashed'),
    ],
    cards=[
        {'dot': 'cyan', 'title': 'One owner at a time', 'items': ['Embedded and standalone owners never run against one state', 'A stale feed stays visibly stale until recovery or rollback']},
        {'dot': 'violet', 'title': 'What moves', 'items': ['Identities, session/notice state, revisions and producer configuration', 'Pixoo’s facade switches renderer, feed, label and acknowledgment operations to the selected owner']},
        {'dot': 'amber', 'title': 'Owned elsewhere', 'items': ['Hub #8 source adds reversible setup and Nanoleaf cutover', 'Controller databases stay private; Windows/WSL never share a mounted SQLite file', 'Legacy Nanoleaf ingestion remains until a verified cutover; repository moves and hosting are separate']},
    ],
    width=1240,
)

# ---------------------------------------------------------------------------
# 9. Installed Nanoleaf Linux runtime
# ---------------------------------------------------------------------------
SIZE9 = [165, 64]


def c9(id, type, label, sublabel, row, col, tag=None):
    component = {'id': id, 'type': type, 'label': label, 'sublabel': sublabel, 'row': row, 'col': col, 'size': SIZE9}
    if tag:
        component['tag'] = tag
    return component


D9 = arch(
    'Installed Nanoleaf Linux runtime',
    components=[
        c9('browser', 'frontend', 'Windows browser', 'wall map client', 0, 0),
        c9('desktop', 'external', 'Codex Desktop', 'Windows · tasks execute in WSL', 0, 2),
        c9('cliClient', 'external', 'Codex CLI', 'Ubuntu WSL', 0, 3),
        c9('wallMap', 'frontend', 'Python wall map', '127.0.0.1:8765', 1, 0, 'installed'),
        c9('desktopJson', 'database', 'Mounted Desktop JSON', 'project · title · unread · read-only', 1, 1),
        c9('hooksCli', 'backend', 'Linux hooks and CLI', 'Python · fail-open hooks', 1, 2, 'installed'),
        c9('mcpHost', 'security', 'Node MCP host', '127.0.0.1:41230', 1, 3, 'installed'),
        c9('linuxState', 'database', 'Linux SQLite', '~/.local/share/codex-nanoleaf', 2, 2, 'fresh state'),
        c9('controller', 'security', 'Python controller', '127.0.0.1:41231 · bearer', 2, 3, 'installed'),
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
        {'dot': 'violet', 'title': 'Linux process boundary', 'items': ['Hooks, CLI, wall map and controller coordinate through Linux SQLite', 'Node MCP calls the controller directly over numeric-loopback HTTP', 'The worker remains the sole light writer; setup and the map may read device geometry']},
        {'dot': 'cyan', 'title': 'Windows remains a client', 'items': ['Codex Desktop tasks execute in WSL', 'The Windows browser opens the wall map', 'Configured project, title and unread JSON is mounted read-only']},
        {'dot': 'amber', 'title': 'Evidence boundary', 'items': ['Fresh install; no data migration or rollback tooling', 'No combined daemon, new hook API, shared monitoring or source move', 'PR #57 delivered the source; installed acceptance #55 closed on September 22, 2026']},
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
         reading=['Follow the cyan emphasis arrows: Codex → Pixoo /mcp → ControlService → one serialized queue → simulator or explicitly selected device. Browser and optional native controller routes enter the same ControlService.',
                  'The lower route is Codex → Nanoleaf MCP host → route (direct loopback on Windows, the configured Windows Python helper on WSL) → Windows controller API → existing light worker → configured lights.',
                  'The dashed “imports” arrows show the shared device-mcp package as library code. It opens no listener and starts no device writer.'],
         boundaries=['Pixoo MCP tools retain their string request_id. The optional /controller/v1 boundary in [[P37]] shares that sequence, player and writer, with scoped bearer authentication and guarded native envelopes.',
                     'Nanoleaf uses the controller v1 envelope: requestId, expectedConfigurationRevision and expectedGeneration. The two routes are not wire-identical.',
                     'The WSL helper never opens the Windows SQLite database. Each device keeps one designated writer and private state.'],
         sources=[(H, 'packages/mcp/README.md'), (P, 'docs/local-mcp.md'), (P, 'apps/server/src/mcp.ts'), (P, 'apps/server/src/mcp-tools.ts'), (P, 'docs/hub-controller-api.md'), (P, 'apps/server/src/controller.ts'), (P, 'apps/server/src/controller-state.ts'), (N, 'docs/local-mcp.md'), (N, 'mcp/src/server.ts'), (N, 'mcp/src/transport.ts'), (N, 'docs/controller-api.md')],
         issues=['P37', 'N34', 'P12']),
    dict(id='arch-shared-system', spec=D2, kind='architecture', status='implemented',
         status_label='Source delivered at the pinned revisions; planned and future nodes are tagged', short='System map',
         summary='Where BUNNY runs at the pinned revisions. Provider hooks send lifecycle metadata to the Linux hub process, which composes the agent-state core, a private SQLite store, the authenticated HTTP routes and the embedded MCP module. Each controller keeps its own designated writer and private state. Music, rules and new controllers are labelled future or planned.',
         reading=['Green arrows are the observation path: providers → hooks → hub routes → core → private store. Dashed arrows are the state feed that consumers read; red arrows are explicit controller v1 commands from the dashboard or MCP clients; gray arrows are internal calls, commits and the library import. Publication and commands never share a path.',
                  'Each dashed box is one process or runtime: the Linux hub under apps/hub, the Nanoleaf Linux runtime in WSL and the Pixoo backend. Devices sit outside every box, and each device has exactly one designated writer.',
                  'Tags record source state at the pinned revision. Installed appears only where an owning issue recorded installed acceptance ([[N55]], [[N30]]); the hub itself is source only.'],
         boundaries=['Hub source is pinned at the revision listed below the map; Nanoleaf and Pixoo keep their earlier pins. Source delivery is not installation, transport or physical acceptance.',
                     'One active agent-state owner: the Linux hub ([[H5]]) or the Pixoo backend embedding the same package ([[P31]]), never both against one store. Controller databases stay private and are never shared across Windows and WSL.',
                     'Music ([[H36]]) and automation rules ([[H45]]) remain future work. Tidbyt ([[H16]]) has fake-tested source only; LIFX ([[H17]]) and PC lighting ([[H53]]) remain planned. The map labels them without implying installation.'],
         details=MAP_DETAILS,
         sources=[(H, 'apps/hub/README.md'), (H, 'apps/hub/src/server.ts'), (H, 'apps/hub/src/storage.ts'), (H, 'apps/hub/SETUP.md'), (H, 'packages/agent-state/README.md'), (H, 'packages/mcp/README.md'), (H, 'apps/dashboard/README.md'), (H, 'docs/architecture.md'), (N, 'docs/shared-input.md'), (N, 'bridge/shared_input.py'), (N, 'docs/controller-api.md'), (P, 'docs/hub-integration.md'), (P, 'docs/hub-controller-api.md')],
         issues=['H2', 'H3', 'H5', 'H6', 'H13', 'P31', 'N29', 'N55', 'H36', 'H45', 'H16', 'H17', 'H53']),
    dict(id='arch-nanoleaf-linux', spec=D9, kind='architecture', status='implemented',
         status_label='Delivered and installed on Linux/WSL', short='Nanoleaf Linux runtime',
         summary='The delivered fresh-install runtime moved the existing Nanoleaf processes and private SQLite state into Ubuntu WSL. It kept Windows Desktop and browser clients, direct numeric-loopback MCP transport and the existing on-demand worker as the sole light writer.',
         reading=['Windows clients stay outside the runtime boundary. Codex Desktop tasks execute in WSL, the browser opens the wall map on port 8765, and configured project, title and unread JSON is read through the mounted filesystem without write access.',
                  'Linux hooks, CLI, wall map and controller coordinate through Linux SQLite. The Node MCP host on port 41230 calls the Python controller directly at 127.0.0.1:41231.',
                  'The controller starts the existing worker on demand. That worker retains the state lock and remains the sole light writer. Setup and the wall map may make bounded device reads for connection checks or geometry.'],
        boundaries=['[[H43]] records this architecture. Nanoleaf [[N54]] delivered source and setup through PR #57; [[N55]] closed on September 22, 2026 with the installed Linux services, one light writer and the owner-observed light sequence.',
                     'The installation starts with fresh Linux state. Existing Nanoleaf state need not move, and no runtime SQLite database is shared through /mnt/c.',
                     'Data migration, rollback tooling, a combined daemon, a new hook API, shared monitoring and repository migration [[H26]] remain outside this transition.'],
        sources=[(H, 'docs/architecture.md'), (N, 'docs/decisions/0007-linux-runtime-ownership.md'), (N, 'docs/linux-install.md'), (N, 'bridge/install_linux.py'), (N, 'bridge/README.md'), (N, 'bridge/wall_server.py')],
         issues=['H43', 'N54', 'N55']),
    dict(id='seq-lifecycle-observation', spec=D3, kind='sequence', status='implemented',
         status_label='Delivered source path; installed and physical acceptance recorded by the owners', short='Agent observation walkthrough',
         summary='One provider observation travels from a fail-open hook to the hub, is committed once as a new revision, is published as a revision pointer, and is projected by the owning controller onto its device through that controller\'s own queue. The alternative shows reconnecting after an interruption without replay.',
         reading=['Phase 1 ends inside the hook bound whether or not the hub is reachable. Phase 2 is the only place state changes: one commit, one revision, one notification.',
                  'The dashed arrow out of the core is publication; the solid green arrow into the device is the controller\'s own write. The hub never issues that write on this path.',
                  'The alternative lane shows an expired cursor: the consumer gets a resync pointer and reads the current snapshot; nothing is replayed.'],
         boundaries=['Activity, attention, notices, acknowledgment, optional read evidence and freshness stay distinct. Turn end proves neither success nor readership; five minutes without evidence means uncertain.',
                     'Released [[H3]] supplies the reducer and versioned snapshots; [[H5]] hosts them on Linux behind the routes shown here; [[P31]] embeds the same core in Pixoo. [[N29]] consumes the feed through Nanoleaf\'s existing writer; [[P33]] owns Pixoo\'s Monitor/Media projection.',
                     'Installed hooks and owner cutover are [[H8]] source with separate installation authority; Nanoleaf installed acceptance is recorded in [[N30]] and [[N55]].'],
         phases=WALK_PHASES,
         sources=[(H, 'apps/hub/README.md'), (H, 'apps/hub/SETUP.md'), (H, 'apps/hub/src/server.ts'), (H, 'packages/agent-state/README.md'), (H, 'docs/agent-lifecycle-contract.md'), (H, 'docs/architecture.md'), (P, 'docs/hub-integration.md'), (P, 'docs/agent-monitoring.md'), (P, 'apps/server/src/monitor-presentation.ts'), (P, 'docs/decisions/0018-monitor-display-ownership.md'), (N, 'docs/hub-integration.md'), (N, 'docs/shared-input.md'), (N, 'bridge/shared_input.py')],
         issues=['H2', 'H3', 'H5', 'H8', 'P31', 'P33', 'N29', 'N30', 'N55']),
    dict(id='seq-nanoleaf-command', spec=D4, kind='sequence', status='implemented',
         status_label='Implemented source; installed and physical acceptance recorded', short='Nanoleaf command admission',
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
         status_label='Implemented source; reliability trial complete', short='Pixoo playback ownership',
         summary='A client reads status and catalog pages, then selects media or a playlist with the issued request identity. The owning service admits the request through the shared ledger, resolves the stored rendition, admits the playback context and hands serialized uploads to the backend player and adapter.',
         reading=['The receipt acknowledges context admission while the upload may still be loading. Backend playback continues after Codex disconnects. The optional native controller maps saved playlists into the same path; media-only tools remain local.',
                  'Reads never probe the display or refresh observation timestamps. A lost response is reconciled with current status, not a new write identity.',
                  'Screen off pauses playback; screen on does not resume it. Restart restores paused context without a device write.'],
         boundaries=['Catalog names are untrusted display data. Tools never import or edit media or select raw device targets.',
                     'Original media and referenced renditions are preserved; stale playlist revisions preserve current playback.',
                     'Physical playback, restart and soak evidence remain with [[P12]].'],
         sources=[(P, 'docs/local-mcp.md'), (P, 'docs/playback.md'), (P, 'apps/server/src/mcp-tools.ts'), (P, 'docs/hub-controller-api.md'), (P, 'packages/playback/src/player.ts'), (H, 'packages/mcp/README.md')],
         issues=['P12', 'P37']),
    dict(id='seq-desktop-input', spec=D6, kind='sequence', status='future',
         status_label='N30 qualification complete; reusable mapper planned', short='Codex mouse input',
         summary='Selecting a control profile loads mappings and sends no input or device commands. A fresh mapped navigation press resolves application scope and one of four Codex actions. Keyboard A/B and attached Super Buttons remain outside B.U.N.N.Y.',
         reading=['The owner passed a temporary AutoHotkey trial. The reusable mapper below remains planned: ordinary input passes through outside Codex; held, repeated or stale input must not dispatch twice or replay later.',
                  'Presets require a separately selected qualified binding and service. Keyboard A/B and attached Super Buttons are excluded.'],
         boundaries=['This path does not wait for the hub, shared monitoring, general controls or Music.',
                     'N30 85CA, receiver 062A:4101 and Codex 26.917.6896.0 passed the brief owner trial under completed [[H64]]. PageUp/PageDown and Back/Forward from other devices also map inside Codex. Receiver isolation and long-term recovery are unqualified.',
                     'The later editor ([[H70]]) excludes keyboard A/B, attached Super Buttons, arbitrary scripts, shell execution, raw device commands and multi-step macros.'],
         sources=[(H, 'docs/desktop-controls.md')],
         issues=['H63', 'H64', 'H65', 'H66', 'H70']),
    dict(id='seq-big-b-presets', spec=D7, kind='sequence', status='future',
         status_label='Deferred future work', short='Configured desk presets',
         summary='A fresh configured preset press asks the hub for the next preset. The hub owns selection and revision, sends supported native commands to each controller owner, collects independent per-device results and returns them for visible feedback. The initial cycle is Work → Free → Quiet → Work.',
         reading=['One device failing or offline is reported as a partial result; it never stalls the others or looks complete.',
                  'A manual change in a vendor app remains until the next explicit preset request, which then uses supported ownership handoff.',
                  'Startup, reconnect and profile selection replay no presses and issue no device commands. If the hub is unavailable, that is reported and local mouse controls keep working. Keyboard A/B and attached Super Buttons are excluded from preset bindings.'],
         boundaries=['[[H67]]’s inputs [[H63]], [[H32]], [[H31]], [[H5]], [[N49]] and [[P33]] are delivered. [[H68]] requires [[H65]] and [[H67]]; [[H69]] also requires [[H68]] and delivered [[H8]].',
                     'Manual preset dispatch does not require automation engine [[H45]]. Music [[H71]] consumes [[H40]] policy and requires [[H68]] and [[H36]]; [[H38]]/[[H39]] apply to selected branches and [[H41]] is conditional on measured audio.',
                     'Native Nanoleaf and Pixoo modes and their restoration limits are preserved; a preset is not a shared device-mode value.'],
         sources=[(H, 'docs/desktop-controls.md'), (H, 'apps/hub/README.md'), (H, 'packages/agent-state/README.md'), (H, 'docs/controller-contract.md')],
         issues=['H67', 'H68', 'H69', 'H71']),
    dict(id='seq-owner-migration', spec=D8, kind='sequence', status='implemented',
         status_label='Source setup and migration delivered; installed owner accepted', short='Owner migration',
         summary='An explicitly authorized migration quiesces the selected route and old owner, exports and imports versioned state with its identities and revisions, validates the import, keeps the old reducer inactive, switches producer and consumer endpoints and resyncs from authoritative snapshots.',
         reading=['Pixoo’s session-source facade switches renderer, feed, label and acknowledgment operations to the selected owner. Remote mode never starts a second local reducer.',
                  'Rollback requires quiescing and stopping the new owner, transferring its latest export if it accepted writes, then importing into a fresh host store and validating routes before activation. Pixoo remains a remote facade with its media and preferences. Consumers reload the authoritative snapshot.'],
         boundaries=['Released [[H3]] defines export/import format 1.0. [[P31]] implements durable embedded storage, quiesce/export/import and a remote facade tested against disposable hosts. Delivered [[H5]] source verifies supervised release, fenced import, durable route recovery and rollback after writes. [[H8]] source merged in PR #129 for Linux/WSL setup and Nanoleaf cutover. The installed standalone owner was accepted with Pixoo and Nanoleaf consumers under [[P34]] and [[N30]]; Windows-client and Claude qualification were deferred.',
                     'Controller databases stay private. Windows and WSL never coordinate through a mounted SQLite file.',
                     'Legacy Nanoleaf ingestion remains until an authorized verified cutover with one selected ingestion path per session. Repository moves ([[H25]], [[H26]]), container hosting ([[H42]]) and device-writer ownership are separate changes.'],
         sources=[(H, 'docs/architecture.md'), (H, 'apps/hub/README.md'), (H, 'apps/hub/SETUP.md'), (H, 'packages/agent-state/README.md'), (P, 'docs/hub-integration.md'), (P, 'docs/agent-monitoring.md'), (P, 'apps/server/src/monitor-presentation.ts'), (P, 'packages/core/src/integration.ts'), (P, 'docs/decisions/0018-monitor-display-ownership.md'), (N, 'docs/hub-integration.md'), (N, 'docs/shared-input.md'), (N, 'bridge/shared_input.py')],
         issues=['H5', 'H8', 'P31', 'N29', 'P34', 'N30']),
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
