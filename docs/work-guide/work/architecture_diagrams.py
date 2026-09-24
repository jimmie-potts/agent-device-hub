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
SOURCE_URL = {(f['repo'], f['path'], f['revision']): f['url'] for f in SOURCES['files']}
# The system map and observation walkthrough (shared with the BUNNY atlas) keep
# sourceRevisions; the other views were revised later against viewRevisions.
BASELINE, VIEW = SOURCES['sourceRevisions'], SOURCES['viewRevisions']


def src(repo, path, revisions=BASELINE):
    return SOURCE_URL[(repo, path, revisions[repo])]


def pins(diagram):
    return diagram.get('revisions', BASELINE)


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
# 1. Local MCP command paths (current source; Nanoleaf on its Linux runtime)
# ---------------------------------------------------------------------------
SIZE1 = [150, 62]


def c1(id, type, label, sublabel, row, col, tag=None):
    component = {'id': id, 'type': type, 'label': label, 'sublabel': sublabel, 'row': row, 'col': col, 'size': SIZE1}
    if tag:
        component['tag'] = tag
    return component


D1 = arch(
    'Local MCP command paths',
    components=[
        c1('browser', 'frontend', 'Browser / native client', '/api · /controller/v1', 0, 2),
        c1('codex', 'external', 'Local Codex', 'MCP client', 1, 0),
        c1('pixooMcp', 'security', 'Pixoo /mcp route', 'bearer · Host/Origin checks', 1, 1, 'optional'),
        c1('pixooSvc', 'backend', 'ControlService', 'ledger · catalog · Player', 1, 2),
        c1('pixooAdapter', 'messagebus', 'Device adapter', 'serialized queue', 1, 3, 'sole display writer'),
        c1('pixooDev', 'external', 'Pixoo 64×64', 'simulator unless selected', 1, 4),
        c1('mcpPkg', 'backend', 'device-mcp 1.0.0', 'library code in each host', 2, 1, 'no listener · no writer'),
        c1('nanoHost', 'security', 'Nanoleaf MCP host', 'Node · 127.0.0.1:41230', 3, 1, 'optional'),
        c1('nanoCtl', 'security', 'Nanoleaf controller', '/controller/v1 · :41231', 3, 2, 'bearer'),
        c1('nanoWorkers', 'backend', 'Device workers', 'one instance per device', 3, 3, 'one writer each'),
        c1('nanoDevs', 'external', 'Lines · NL22 panels', 'registered LAN devices', 3, 4),
        c1('nanoStore', 'database', 'Nanoleaf SQLite', 'Linux-owned · private', 4, 2),
    ],
    connections=[
        {'id': 'codex-pixoo', 'from': 'codex', 'to': 'pixooMcp', 'label': 'app tools', 'variant': 'emphasis', 'fromSide': 'right', 'toSide': 'left', 'labelDy': 26},
        {'id': 'pixoo-mcp-svc', 'from': 'pixooMcp', 'to': 'pixooSvc', 'label': 'request_id', 'variant': 'emphasis', 'fromSide': 'right', 'toSide': 'left', 'labelDy': 26},
        {'id': 'browser-svc', 'from': 'browser', 'to': 'pixooSvc', 'label': 'HTTP · SSE', 'fromSide': 'bottom', 'toSide': 'top', 'labelDx': 44, 'labelDy': 24},
        {'id': 'svc-adapter', 'from': 'pixooSvc', 'to': 'pixooAdapter', 'label': 'Player writes', 'variant': 'emphasis', 'fromSide': 'right', 'toSide': 'left', 'labelDy': 26},
        {'id': 'adapter-dev', 'from': 'pixooAdapter', 'to': 'pixooDev', 'label': 'upload', 'variant': 'emphasis', 'fromSide': 'right', 'toSide': 'left', 'labelDy': 26},
        {'id': 'pixoo-imports', 'from': 'pixooMcp', 'to': 'mcpPkg', 'label': 'imports', 'variant': 'dashed', 'fromSide': 'bottom', 'toSide': 'top', 'labelDx': 34, 'labelDy': 24},
        {'id': 'nano-imports', 'from': 'nanoHost', 'to': 'mcpPkg', 'label': 'imports', 'variant': 'dashed', 'fromSide': 'top', 'toSide': 'bottom', 'labelDx': 34, 'labelDy': -14},
        {'id': 'codex-nano', 'from': 'codex', 'to': 'nanoHost', 'label': 'status · mode_set', 'variant': 'emphasis', 'fromSide': 'bottom', 'toSide': 'left', 'labelDx': 60, 'labelDy': 24},
        {'id': 'host-ctl', 'from': 'nanoHost', 'to': 'nanoCtl', 'label': 'loopback HTTP', 'variant': 'security', 'fromSide': 'right', 'toSide': 'left', 'labelDy': 26},
        {'id': 'ctl-workers', 'from': 'nanoCtl', 'to': 'nanoWorkers', 'label': 'queued work', 'variant': 'emphasis', 'fromSide': 'right', 'toSide': 'left', 'labelDy': 26},
        {'id': 'ctl-store', 'from': 'nanoCtl', 'to': 'nanoStore', 'label': 'journal · receipts', 'fromSide': 'bottom', 'toSide': 'top', 'labelDx': 50, 'labelDy': 24},
        {'id': 'workers-devs', 'from': 'nanoWorkers', 'to': 'nanoDevs', 'label': 'transmit', 'variant': 'emphasis', 'fromSide': 'right', 'toSide': 'left', 'labelDy': 26},
    ],
    boundaries=[
        {'kind': 'region', 'label': 'Pixoo backend process (divoom-app-upgrade)', 'wraps': ['pixooMcp', 'pixooSvc', 'pixooAdapter']},
        {'kind': 'security-group', 'label': 'Nanoleaf Linux runtime (codex-nanoleaf, WSL)', 'wraps': ['nanoHost', 'nanoCtl', 'nanoWorkers', 'nanoStore']},
    ],
    cards=[
        {'dot': 'cyan', 'title': 'Pixoo route', 'items': ['MCP tools carry the issued string request_id', 'Browser, MCP and native controller v1 share one ledger', 'Only the device adapter writes; simulator unless a device is selected']},
        {'dot': 'violet', 'title': 'Nanoleaf route', 'items': ['MCP host calls the controller directly over numeric loopback', 'Envelope: requestId, expectedConfigurationRevision, expectedGeneration', 'Each registered device has its own worker and lock']},
        {'dot': 'slate', 'title': 'Shared library', 'items': ['Both hosts import device-mcp to register tools and check transport', 'It opens no listener and starts no device writer']},
    ],
    layout={'mode': 'grid', 'origin': [40, 40], 'cols': 5, 'cellW': 150, 'cellH': 62, 'gapX': 90, 'gapY': 72},
    views=[
        {'id': 'pixoo-route', 'label': 'Pixoo route', 'focus': ['codex', 'pixooMcp', 'pixooSvc', 'pixooAdapter', 'pixooDev', 'browser'], 'note': 'Codex, browser and native clients share one service and one writer.'},
        {'id': 'nanoleaf-route', 'label': 'Nanoleaf route', 'focus': ['codex', 'nanoHost', 'nanoCtl', 'nanoWorkers', 'nanoStore', 'nanoDevs'], 'note': 'The MCP host forwards controller v1 requests; each device worker keeps its own writes.'},
        {'id': 'shared-library', 'label': 'Shared library', 'focus': ['mcpPkg', 'pixooMcp', 'nanoHost'], 'note': 'Reusable code, separately owned hosts.'},
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
# 4. Nanoleaf command admission, replay and cancellation (current source)
# ---------------------------------------------------------------------------
D4 = seq(
    'nanoleaf-command', 'Nanoleaf command admission, replay and cancellation',
    participants=[
        {'id': 'codex', 'type': 'external', 'label': 'Local Codex', 'sublabel': 'MCP client'},
        {'id': 'host', 'type': 'security', 'label': 'MCP host', 'sublabel': 'Node · no second ledger'},
        {'id': 'api', 'type': 'security', 'label': 'Controller', 'sublabel': 'Linux · /controller/v1'},
        {'id': 'worker', 'type': 'backend', 'label': 'Lines worker', 'sublabel': 'sole Lines writer'},
        {'id': 'device', 'type': 'external', 'label': 'Nanoleaf Lines', 'sublabel': 'LAN device'},
    ],
    steps=[
        ('seg', '1 · Read status'),
        ('msg', 'codex', 'host', 'nanoleaf_status', 'emphasis'),
        ('msg', 'host', 'api', 'GET snapshot (bearer, exact Host)', 'security'),
        ('msg', 'api', 'host', 'snapshot: nextRequestId · configurationRevision · generation', 'return'),
        ('msg', 'host', 'codex', 'status (desired · pending · unknown observation)', 'return'),
        ('seg', '2 · Admit one command'),
        ('msg', 'codex', 'host', 'nanoleaf_mode_set {requestId, expectedConfigurationRevision, expectedGeneration, mode}', 'emphasis'),
        ('msg', 'host', 'api', 'POST /controller/v1/commands', 'security', 'authentication and scope are checked before replay lookup'),
        ('msg', 'api', 'host', '202 receipt: queued', 'return'),
        ('msg', 'host', 'codex', 'receipt (queued is not visible light)', 'return'),
        ('seg', '3 · Queue and transmit'),
        ('msg', 'api', 'worker', 'queued mode work (identity reserved; revision and generation validated)', 'emphasis'),
        ('msg', 'worker', 'device', 'transmit after a second generation check', 'emphasis'),
        ('msg', 'device', 'worker', 'transport acknowledgment', 'return'),
        ('msg', 'worker', 'api', 'sent (transport evidence only)', 'dashed'),
        ('seg', 'Alternative · rejected at admission, no effect'),
        ('msg', 'api', 'host', 'exact duplicate → original receipt, no new write', 'return'),
        ('msg', 'api', 'host', 'changed payload → 409 request-conflict', 'return'),
        ('msg', 'api', 'host', 'expired identity → 410 request-expired', 'return'),
        ('msg', 'api', 'host', 'stale revision or generation → 409 before any effect', 'return'),
        ('seg', 'Alternative · after admission'),
        ('msg', 'worker', 'api', 'superseded generation → cancelled, prior effects retained', 'dashed'),
        ('msg', 'worker', 'api', 'partial or uncertain → possible effects; mode held', 'dashed'),
        ('msg', 'host', 'codex', 'delivery timeout after dispatch → original requestId + possible effects', 'return', 'no replacement identity and no automatic retry'),
    ],
    cards=[
        {'dot': 'cyan', 'title': 'Two MCP tools', 'items': ['nanoleaf_status and nanoleaf_mode_set; modes Work, Quiet, Free', 'Native controller clients can also set power, brightness and saved scenes; MCP does not expose them']},
        {'dot': 'violet', 'title': 'Identity discipline', 'items': ['Status issues nextRequestId; clients never mint identities', 'Duplicates join, conflicts reject, expired identities reject', 'A second generation check runs right before the write']},
        {'dot': 'amber', 'title': 'Evidence limits', 'items': ['sent is transport evidence, not optical proof', 'Stopping the MCP host does not stop admitted work', 'Failed or uncertain modes are held until a fresh explicit request']},
    ],
    views=[
        {'id': 'happy', 'label': 'Admit and send', 'focus': ['codex', 'host', 'api', 'worker', 'device'], 'note': 'One identity, one queued write.'},
        {'id': 'alt', 'label': 'Alternatives', 'focus': ['host', 'api', 'worker'], 'note': 'Replay, conflict, expiry and cancellation.'},
    ],
    width=1180, segment_gap=30,
)

# ---------------------------------------------------------------------------
# 5. Pixoo media selection and playback ownership (current source)
# ---------------------------------------------------------------------------
D5 = seq(
    'pixoo-playback', 'Pixoo media selection and playback ownership',
    participants=[
        {'id': 'client', 'type': 'external', 'label': 'Client', 'sublabel': 'Codex MCP or browser'},
        {'id': 'service', 'type': 'backend', 'label': 'ControlService', 'sublabel': 'request ledger'},
        {'id': 'library', 'type': 'database', 'label': 'Library', 'sublabel': 'renditions · playlists'},
        {'id': 'player', 'type': 'backend', 'label': 'Player', 'sublabel': 'session queue'},
        {'id': 'adapter', 'type': 'messagebus', 'label': 'Device adapter', 'sublabel': 'sole display writer'},
        {'id': 'device', 'type': 'external', 'label': 'Pixoo', 'sublabel': 'simulator or device'},
    ],
    steps=[
        ('seg', '1 · Read catalog and status'),
        ('msg', 'client', 'service', 'get_status · list_media · list_playlists', 'emphasis'),
        ('msg', 'service', 'client', 'status {nextRequestId} · catalog page (names are untrusted data)', 'return', 'reads never probe the display or refresh evidence timestamps'),
        ('seg', '2 · Select and admit'),
        ('msg', 'client', 'service', 'show_media {rendition_id, request_id} or play_playlist {playlist_id, revision, request_id}', 'emphasis'),
        ('msg', 'service', 'library', 'resolve stored rendition · check playlist revision', 'default', 'matching identity joins; different payload conflicts'),
        ('msg', 'library', 'service', 'rendition + bounded policy', 'return'),
        ('msg', 'service', 'player', 'showMedia / start(playlistId, revision)', 'emphasis'),
        ('msg', 'service', 'client', 'receipt: admitted; upload may still be loading', 'return'),
        ('seg', '3 · Backend playback'),
        ('msg', 'player', 'adapter', 'upload rendition frames (generation g)', 'emphasis'),
        ('msg', 'adapter', 'device', 'serialized upload · control', 'emphasis'),
        ('msg', 'device', 'adapter', 'transport ack (not visible proof)', 'return'),
        ('msg', 'player', 'adapter', 'dwell elapsed → next item (retire older work)', 'dashed', 'client disconnect does not cancel admitted playback'),
        ('seg', 'Alternative · lost response or stale playlist'),
        ('msg', 'client', 'service', 'lost response → get_status and reconcile (same identity)', 'dashed'),
        ('msg', 'library', 'service', 'stale playlist revision → revision-conflict; current playback kept', 'return'),
        ('seg', 'Alternative · screen, Monitor and restart'),
        ('msg', 'client', 'service', 'set_screen off → pause; set_screen on → nothing resumes', 'security'),
        ('msg', 'service', 'player', 'Monitor selected → media pauses; the dashboard uses the same Player', 'security'),
        ('msg', 'player', 'library', 'restart → restore paused context, no device write', 'dashed'),
    ],
    cards=[
        {'dot': 'cyan', 'title': 'One writer', 'items': ['Browser, MCP and native controller v1 share one ledger', 'The Player orders sessions; only the device adapter writes', 'Monitor and Media share that Player, so there is never a second writer']},
        {'dot': 'violet', 'title': 'Receipts and evidence', 'items': ['A receipt acknowledges admission; upload can still be loading', 'Reconcile a lost response with status, not a new identity']},
        {'dot': 'amber', 'title': 'Preserved behavior', 'items': ['Screen off pauses; screen on does not resume', 'Paused context and referenced renditions survive restart', 'Leaving Monitor keeps media paused until Resume']},
    ],
    views=[
        {'id': 'select', 'label': 'Select', 'focus': ['client', 'service', 'library', 'player'], 'note': 'Identity, revision and rendition checks before admission.'},
        {'id': 'play', 'label': 'Play', 'focus': ['player', 'adapter', 'device'], 'note': 'The Player orders work; the adapter alone writes.'},
    ],
    width=1240, segment_gap=30,
)

# ---------------------------------------------------------------------------
# 6. Independent Codex mouse controls (future, H63–H66, H70)
# ---------------------------------------------------------------------------
D6 = seq(
    'desktop-input', 'Independent Codex mouse controls (planned mapper)',
    participants=[
        {'id': 'user', 'type': 'external', 'label': 'User', 'sublabel': 'shared navigation keys'},
        {'id': 'dispatcher', 'type': 'backend', 'label': 'Windows dispatcher', 'sublabel': 'planned · no hub'},
        {'id': 'profile', 'type': 'database', 'label': 'Control profile', 'sublabel': 'planned · bindings + scope'},
        {'id': 'app', 'type': 'frontend', 'label': 'Focused app', 'sublabel': 'Codex or other'},
    ],
    steps=[
        ('seg', '1 · Select a profile'),
        ('msg', 'user', 'dispatcher', 'select control profile', 'emphasis'),
        ('msg', 'dispatcher', 'profile', 'load mappings; no input or device commands', 'default'),
        ('seg', '2 · One Codex action'),
        ('msg', 'user', 'dispatcher', 'fresh mapped navigation press', 'emphasis'),
        ('msg', 'dispatcher', 'profile', 'resolve control, app scope and action', 'default'),
        ('msg', 'dispatcher', 'app', 'next attention task · command menu · previous task · next task', 'emphasis', 'exactly one action per deliberate press'),
        ('msg', 'dispatcher', 'user', 'report dispatch separately from app success', 'return'),
        ('seg', 'Alternative · outside Codex or not a fresh press'),
        ('msg', 'dispatcher', 'app', 'outside Codex → ordinary mouse behavior', 'dashed'),
        ('msg', 'dispatcher', 'profile', 'held / repeated / stale input → no duplicate or replay', 'dashed'),
    ],
    cards=[
        {'dot': 'cyan', 'title': 'Independent path', 'items': ['Mouse dispatch needs no hub, shared monitoring, general controls or Music', 'Keyboard A/B and attached Super Buttons stay outside B.U.N.N.Y.']},
        {'dot': 'violet', 'title': 'Ownership', 'items': ['The keyboard owns its A/B assignments, including personal Wispr and Enter mappings', 'B.U.N.N.Y. does not edit, store, dispatch or use them for presets']},
        {'dot': 'amber', 'title': 'What exists today', 'items': ['Only a brief AutoHotkey trial (H64); no profile store yet', 'Other devices share these keys inside Codex; no per-device filtering', 'H65/H66 own the mapper and its installation']},
    ],
    width=1100, segment_gap=30,
)

# ---------------------------------------------------------------------------
# 7. Configured presets, partial results and manual handoff (future, H67–H69, H71)
# ---------------------------------------------------------------------------
D7 = seq(
    'big-b-presets', 'Desk presets, partial results and manual handoff (planned)',
    participants=[
        {'id': 'user', 'type': 'external', 'label': 'User', 'sublabel': 'preset binding · vendor app'},
        {'id': 'dispatcher', 'type': 'backend', 'label': 'Windows dispatcher', 'sublabel': 'planned · feedback'},
        {'id': 'hub', 'type': 'security', 'label': 'Hub preset service', 'sublabel': 'planned · owns selection'},
        {'id': 'nanoleaf', 'type': 'backend', 'label': 'Nanoleaf owner', 'sublabel': 'Work/Quiet/Free'},
        {'id': 'pixoo', 'type': 'backend', 'label': 'Pixoo owner', 'sublabel': 'Monitor/Media'},
    ],
    steps=[
        ('seg', '1 · Fresh press, one transition'),
        ('msg', 'user', 'dispatcher', 'fresh configured preset press', 'emphasis'),
        ('msg', 'dispatcher', 'hub', 'request next preset (Work → Free → Quiet → Work) with known revision', 'emphasis'),
        ('msg', 'hub', 'nanoleaf', 'supported native command + requestId/revision/generation', 'security'),
        ('msg', 'hub', 'pixoo', 'supported native command + request_id', 'security'),
        ('msg', 'nanoleaf', 'hub', 'queued / sent', 'return'),
        ('msg', 'pixoo', 'hub', 'failed: offline (independent queue)', 'return'),
        ('msg', 'hub', 'dispatcher', 'selected preset + per-device results (partial)', 'return'),
        ('msg', 'dispatcher', 'user', 'visible feedback: requested, sent, failed, uncertain', 'return', 'transport outcomes are not optical proof'),
        ('seg', '2 · Manual change stays until the next explicit preset'),
        ('msg', 'user', 'nanoleaf', 'manual scene change in the vendor app', 'dashed'),
        ('msg', 'user', 'dispatcher', 'next fresh configured preset press', 'emphasis'),
        ('msg', 'hub', 'nanoleaf', 'supported ownership handoff, then preset action', 'security'),
        ('seg', 'Alternative · startup, reconnect or hub unavailable'),
        ('msg', 'dispatcher', 'hub', 'startup · reconnect · profile selection → no presses replayed, no device commands', 'dashed'),
        ('msg', 'hub', 'dispatcher', 'hub unavailable → reported; local mouse controls keep working', 'return'),
    ],
    cards=[
        {'dot': 'cyan', 'title': 'Authoritative selection', 'items': ['The hub owns preset selection and revision; clients keep no diverging counter', 'Superseded requests retire through existing generation rules']},
        {'dot': 'violet', 'title': 'Independent results', 'items': ['One offline device cannot stall others', 'A partial operation is never shown as complete', 'Native modes and restoration limits are preserved']},
        {'dot': 'amber', 'title': 'Prerequisites', 'items': ['H67 needs H63, H32, H31, H5, Nanoleaf #49 and Pixoo #33', 'H68 needs H65 and H67; H69 also needs H8', 'Manual dispatch does not need automation engine H45; Music H71 follows H40, H68 and H36']},
    ],
    width=1180, segment_gap=30,
)

# ---------------------------------------------------------------------------
# 8. Supervised owner migration (H5, H8 source); no installed run recorded
# ---------------------------------------------------------------------------
D8 = seq(
    'owner-migration', 'Embedded core to standalone owner',
    participants=[
        {'id': 'operator', 'type': 'external', 'label': 'Operator', 'sublabel': 'authorizes each run'},
        {'id': 'tooling', 'type': 'security', 'label': 'Migration tooling', 'sublabel': 'supervised calls'},
        {'id': 'pixoo', 'type': 'backend', 'label': 'Embedded owner', 'sublabel': 'Pixoo backend'},
        {'id': 'hub', 'type': 'backend', 'label': 'Standalone hub', 'sublabel': 'new owner · fenced'},
        {'id': 'producers', 'type': 'external', 'label': 'Producers', 'sublabel': 'provider hooks'},
        {'id': 'consumers', 'type': 'frontend', 'label': 'Consumers', 'sublabel': 'Pixoo · Nanoleaf'},
    ],
    steps=[
        ('seg', '1 · Revoke and quiesce'),
        ('msg', 'operator', 'tooling', 'authorize migration (named owner)', 'emphasis'),
        ('msg', 'tooling', 'producers', 'remove old setup; verify access revoked', 'security'),
        ('msg', 'tooling', 'pixoo', 'quiesce and stop: drain, export identities + revisions', 'security'),
        ('msg', 'pixoo', 'tooling', 'validated export; graceful exit verified', 'return'),
        ('seg', '2 · Import behind a fence'),
        ('msg', 'tooling', 'hub', 'start staged: single-use import into an empty store', 'emphasis', 'fence persisted first; reads allowed, ingestion and acknowledgment rejected'),
        ('msg', 'hub', 'tooling', 'imported: identities, revisions, notices unchanged', 'return'),
        ('seg', '3 · Stage routes'),
        ('msg', 'tooling', 'producers', 'point setup at the new owner; emission disabled', 'emphasis'),
        ('msg', 'tooling', 'consumers', 'Pixoo restarts as remote facade · Nanoleaf preflight and select', 'emphasis', 'remote mode never starts a second local reducer'),
        ('seg', '4 · Activate'),
        ('msg', 'tooling', 'hub', 'activate: recheck routes, credentials, consumer snapshots', 'emphasis'),
        ('msg', 'consumers', 'hub', 'read authoritative snapshot (no replayed effects)', 'default'),
        ('msg', 'hub', 'tooling', 'producers enabled; fence cleared; admission open', 'return'),
        ('seg', 'Alternative · a step fails: stop, nothing continues'),
        ('msg', 'hub', 'tooling', 'activation fails → attempt consumed; admission stays fenced', 'return'),
        ('msg', 'tooling', 'operator', 'report and stop; the old owner is not resumed automatically', 'return'),
        ('msg', 'operator', 'tooling', 'recover explicitly: export staged state → another empty store', 'dashed'),
        ('seg', 'Alternative · operator rollback after accepted writes'),
        ('msg', 'operator', 'tooling', 'request rollback (explicit, never automatic)', 'dashed'),
        ('msg', 'tooling', 'producers', 'revoke current setup while its owner can confirm', 'dashed'),
        ('msg', 'tooling', 'hub', 'stop new owner; export its latest state', 'dashed'),
        ('msg', 'tooling', 'hub', 'import into another fresh host store; recheck consumers before writes reopen', 'dashed'),
    ],
    cards=[
        {'dot': 'cyan', 'title': 'One owner at a time', 'items': ['Embedded and standalone owners never run against one state', 'A stale feed stays visibly stale until recovery or rollback']},
        {'dot': 'violet', 'title': 'What moves', 'items': ['Identities, session/notice state, revisions and producer configuration', 'Pixoo’s facade reads the feed and sends labels and acknowledgments to the selected owner']},
        {'dot': 'amber', 'title': 'Recovery is explicit', 'items': ['A failed step leaves admission fenced and waits for the operator', 'Rollback targets a fresh store; embedded ownership is never restored into Pixoo’s old store', 'Controller databases stay private throughout']},
    ],
    width=1240, segment_gap=30,
)

# ---------------------------------------------------------------------------
# 9. Installed Nanoleaf Linux runtime
# ---------------------------------------------------------------------------
SIZE9 = [150, 64]


def c9(id, type, label, sublabel, row, col, tag=None):
    component = {'id': id, 'type': type, 'label': label, 'sublabel': sublabel, 'row': row, 'col': col, 'size': SIZE9}
    if tag:
        component['tag'] = tag
    return component


D9 = arch(
    'Nanoleaf Linux runtime (installed)',
    components=[
        c9('browser', 'frontend', 'Windows browser', 'wall map client', 0, 0),
        c9('desktop', 'external', 'Codex Desktop', 'Windows app · tasks in WSL', 0, 2),
        c9('cliClient', 'external', 'Codex CLI', 'Ubuntu WSL', 0, 3),
        c9('wallMap', 'frontend', 'Wall map service', 'user service · :8765', 1, 1),
        c9('desktopJson', 'database', 'Desktop metadata', 'Windows JSON · mounted', 0, 1, 'read-only'),
        c9('hooksCli', 'backend', 'Hooks and CLI', 'short-lived · rollback input', 1, 2, 'legacy hooks removed'),
        c9('mcpHost', 'security', 'MCP host', 'user service · :41230', 1, 3),
        c9('linuxState', 'database', 'Nanoleaf SQLite', 'Linux data directory', 2, 2, 'private · ext4'),
        c9('controller', 'security', 'Controller', 'user service · :41231', 2, 3, 'bearer'),
        c9('panelsWorker', 'backend', 'NL22 worker', 'own lock · on demand', 3, 2, 'installed · verified'),
        c9('linesWorker', 'backend', 'Lines worker', 'instance wall · on demand', 3, 3, 'reads shared feed'),
        c9('hub', 'backend', 'Shared monitor (hub)', 'separate WSL service · A2', 3, 4, 'installed'),
        c9('panels', 'external', 'NL22 Light Panels', 'LAN device', 4, 2),
        c9('lines', 'external', 'Nanoleaf Lines', 'LAN device', 4, 3),
    ],
    connections=[
        {'id': 'browser-map', 'from': 'browser', 'to': 'wallMap', 'label': 'HTTP :8765', 'variant': 'emphasis', 'fromSide': 'bottom', 'toSide': 'left', 'labelDy': 24},
        {'id': 'desktop-json', 'from': 'desktop', 'to': 'desktopJson', 'label': 'own state files', 'fromSide': 'left', 'toSide': 'right', 'labelDy': 26},
        {'id': 'json-map', 'from': 'desktopJson', 'to': 'wallMap', 'label': 'metadata read', 'variant': 'dashed', 'fromSide': 'bottom', 'toSide': 'top', 'labelDx': 44, 'labelDy': 24},
        {'id': 'desktop-hooks', 'from': 'desktop', 'to': 'hooksCli', 'label': 'rollback only', 'variant': 'dashed', 'fromSide': 'bottom', 'toSide': 'top', 'labelDx': -30, 'labelDy': 24},
        {'id': 'cli-hooks', 'from': 'cliClient', 'to': 'hooksCli', 'label': 'rollback only', 'variant': 'dashed', 'fromSide': 'left', 'toSide': 'right', 'labelDy': -18},
        {'id': 'cli-mcp', 'from': 'cliClient', 'to': 'mcpHost', 'label': 'MCP', 'variant': 'emphasis', 'fromSide': 'bottom', 'toSide': 'top', 'labelDx': 24, 'labelDy': 24},
        {'id': 'hooks-state', 'from': 'hooksCli', 'to': 'linuxState', 'label': 'task events', 'fromSide': 'bottom', 'toSide': 'top', 'labelDx': 40, 'labelDy': 24},
        {'id': 'map-state', 'from': 'wallMap', 'to': 'linuxState', 'label': 'preferences', 'fromSide': 'bottom', 'toSide': 'left', 'labelDy': 24},
        {'id': 'mcp-controller', 'from': 'mcpHost', 'to': 'controller', 'label': 'loopback HTTP', 'variant': 'security', 'fromSide': 'bottom', 'toSide': 'top', 'labelDx': 40, 'labelDy': 24},
        {'id': 'controller-state', 'from': 'controller', 'to': 'linuxState', 'label': 'journal', 'fromSide': 'left', 'toSide': 'right', 'labelDy': -14},
        {'id': 'controller-worker', 'from': 'controller', 'to': 'linesWorker', 'label': 'start on demand', 'variant': 'emphasis', 'fromSide': 'bottom', 'toSide': 'top', 'labelDx': 50, 'labelDy': 24},
        {'id': 'state-panels', 'from': 'linuxState', 'to': 'panelsWorker', 'label': 'state · per-device lock', 'fromSide': 'bottom', 'toSide': 'top', 'labelDx': 60, 'labelDy': 24},
        {'id': 'hub-feed', 'from': 'hub', 'to': 'linesWorker', 'label': 'shared input', 'variant': 'dashed', 'fromSide': 'left', 'toSide': 'right', 'labelDy': 26},
        {'id': 'panels-write', 'from': 'panelsWorker', 'to': 'panels', 'label': 'sole writer', 'variant': 'emphasis', 'fromSide': 'bottom', 'toSide': 'top', 'labelDx': 40, 'labelDy': 24},
        {'id': 'lines-write', 'from': 'linesWorker', 'to': 'lines', 'label': 'sole writer', 'variant': 'emphasis', 'fromSide': 'bottom', 'toSide': 'top', 'labelDx': 40, 'labelDy': 24},
    ],
    boundaries=[
        {'kind': 'region', 'label': 'Nanoleaf runtime in Ubuntu WSL (codex-nanoleaf)', 'wraps': ['wallMap', 'hooksCli', 'mcpHost', 'linuxState', 'controller', 'panelsWorker', 'linesWorker']},
    ],
    cards=[
        {'dot': 'violet', 'title': 'Processes and state', 'items': ['Three user services: wall map, controller and MCP host', 'Workers start on demand, one instance and lock per device', 'Hooks, CLI, map and controller share the private Linux SQLite']},
        {'dot': 'cyan', 'title': 'Input and clients', 'items': ['One input source per installation: legacy hooks or shared input', 'Installed: shared input from the hub (Nanoleaf #30); legacy hooks removed (#89)', 'Windows Desktop and browser stay clients; mounted JSON is only read']},
        {'dot': 'amber', 'title': 'Evidence boundary', 'items': ['Fresh install, no data migration (Nanoleaf #55)', 'Lines and NL22 Panels verified together (Nanoleaf #46)', 'No runtime SQLite is shared through /mnt/c']},
    ],
    layout={'mode': 'grid', 'origin': [40, 40], 'cols': 5, 'cellW': 150, 'cellH': 64, 'gapX': 90, 'gapY': 70},
    views=[
        {'id': 'task-state', 'label': 'Task and state path', 'focus': ['desktop', 'cliClient', 'hooksCli', 'wallMap', 'desktopJson', 'linuxState', 'hub', 'linesWorker'], 'note': 'One selected input source feeds Linux state; mounted Desktop metadata is only read.'},
        {'id': 'mcp-command', 'label': 'MCP command path', 'focus': ['cliClient', 'mcpHost', 'controller', 'linuxState', 'linesWorker', 'lines'], 'note': 'MCP uses numeric-loopback HTTP; the device worker keeps the write.'},
        {'id': 'writers', 'label': 'Writers', 'focus': ['panelsWorker', 'linesWorker', 'panels', 'lines', 'linuxState'], 'note': 'One worker instance and lock per physical device.'},
    ],
)

# ---------------------------------------------------------------------------
# Guide metadata: status, explanation, boundaries, sources, related issues
# ---------------------------------------------------------------------------
DIAGRAMS = [
    dict(id='arch-local-paths', spec=D1, kind='architecture', status='implemented', revisions=VIEW,
         status_label='Current source; the Nanoleaf route is installed on Linux', short='Local MCP paths',
         summary='Two device-owned MCP routes share the reusable library but keep separate services and writers. Codex reaches Pixoo through its optional application endpoint, and reaches Nanoleaf through the optional Node host, which calls the Linux controller directly. The hub’s own MCP route is in the system map (A2).',
         reading=['Follow the green arrows. Pixoo: Codex → /mcp route → ControlService → device adapter → simulator or explicitly selected device. Browser and native controller clients enter the same ControlService.',
                  'Nanoleaf: Codex → MCP host (127.0.0.1:41230) → controller (127.0.0.1:41231) → the worker for each registered device → Lines or NL22 panels. The controller keeps its journal in the private Linux SQLite store.',
                  'Each dashed box is one process or runtime. The library sits outside them because each host imports it as code; the dashed “imports” arrows point from each host to the library. Devices sit outside every box.'],
         boundaries=['Pixoo MCP tools keep their string request_id. The optional /controller/v1 boundary in [[P37]] shares the same ledger, Player and writer, with scoped bearer authentication and guarded native envelopes.',
                     'Nanoleaf uses the controller v1 envelope: requestId, expectedConfigurationRevision and expectedGeneration. Native controller clients can also set power, brightness and saved scenes ([[N64]]); MCP exposes only status and mode. The two routes are not wire-identical.',
                     'Historical: before the Linux runtime ([[N54]], [[N55]]), this route forwarded to a Windows controller API, directly on Windows or through a WSL helper. That legacy route stays in source for retained Windows installations. No route opens SQLite.'],
         sources=[(H, 'packages/mcp/README.md'), (P, 'docs/local-mcp.md'), (P, 'apps/server/src/mcp.ts'), (P, 'apps/server/src/control-service.ts'), (P, 'packages/device/src/http-adapter.ts'), (P, 'docs/hub-controller-api.md'), (N, 'docs/local-mcp.md'), (N, 'mcp/src/server.ts'), (N, 'mcp/src/transport.ts'), (N, 'docs/controller-api.md'), (N, 'docs/decisions/0010-per-device-worker-and-nl22.md')],
         issues=['P37', 'N34', 'N55', 'N64']),
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
    dict(id='arch-nanoleaf-linux', spec=D9, kind='architecture', status='implemented', revisions=VIEW,
         status_label='Installed in WSL (Nanoleaf #55); Lines and NL22 verified together (Nanoleaf #46)', short='Nanoleaf Linux runtime',
         summary='The installed Nanoleaf runtime in Ubuntu WSL: three user services, workers started on demand with one instance and lock per device, and private Linux SQLite. Windows Desktop and the browser remain clients. Shared input from the separately installed hub feeds the Lines worker; the legacy Codex hooks are removed and kept only for rollback.',
         reading=['The dashed region is the Nanoleaf runtime inside WSL. Windows clients, the mounted Desktop metadata, the shared hub service and the devices sit outside it.',
                  'The three user services are codex-nanoleaf-wall (:8765), codex-nanoleaf-controller (:41231) and codex-nanoleaf-mcp (:41230), all on numeric loopback. CLI, wall map and controller coordinate through SQLite under ~/.local/share/codex-nanoleaf; the controller starts the workers on demand. The dashed hook arrows are the legacy input, which runs only after a rollback.',
                  'Each registered device has its own worker instance and exclusive lock, so each physical device keeps one writer. Only the Lines instance (“wall”) reads the shared feed and runs controller work.'],
         boundaries=['Installed acceptance of the Linux runtime is recorded in [[N55]], and of shared input in [[N30]]; [[H43]] adopted the runtime in hub architecture. The earlier Windows runtime is historical and keeps its own private state.',
                     'NL22 support was built on synthetic fixtures ([[N43]]); [[N46]] verified Lines and NL22 Panels together on the installed runtime. [[N89]] removed the legacy hooks from both Codex homes after the shared-input cutover. A transport acknowledgment is not optical proof.',
                     'The installation started with fresh Linux state, without data migration or rollback tooling. No runtime SQLite database is shared through /mnt/c.'],
         sources=[(H, 'docs/architecture.md'), (N, 'docs/decisions/0007-linux-runtime-ownership.md'), (N, 'docs/decisions/0010-per-device-worker-and-nl22.md'), (N, 'docs/linux-install.md'), (N, 'docs/shared-input.md'), (N, 'bridge/install_linux.py'), (N, 'bridge/devices.py'), (N, 'bridge/wall_server.py'), (N, 'bridge/controller_server.py')],
         issues=['H43', 'N54', 'N55', 'N30', 'N46', 'N89']),
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
    dict(id='seq-nanoleaf-command', spec=D4, kind='sequence', status='implemented', revisions=VIEW,
         status_label='Current source; installed and accepted on Linux (Nanoleaf #55)', short='Nanoleaf command admission',
         summary='Codex reads status, then submits one mode command with the issued request identity and expected revision and generation. The Linux controller authenticates before replay lookup, admits the identity, validates revisions and queues the work; the Lines worker rechecks the generation before any write.',
         reading=['The main path has three phases: read status, admit one command, then queue and transmit. The receipt returns before the light changes.',
                  'The first alternative lane rejects at admission with no effect. The second covers admitted work: cancellation, held uncertain results, and a delivery timeout that keeps the original requestId.',
                  'The Lines worker (“wall” instance) runs protected-controller work. Other registered devices have their own workers but never execute controller commands.'],
         boundaries=['MCP exposes status and mode only. Power, brightness and saved scenes are native controller commands ([[N64]]) with the same envelope and replay rules.',
                     'A “sent” receipt is transport evidence, not optical proof. Stopping the MCP host does not stop admitted controller work.',
                     'The host holds no second ledger and never allocates replacement identities or retries automatically.'],
         phases=[dict(text='The MCP host reads the controller snapshot with its bearer credential and an exact Host header. The snapshot issues the next request identity with the current configuration revision and generation; clients never mint identities.', sources=[(N, 'docs/local-mcp.md'), (N, 'docs/controller-api.md')]),
                 dict(text='nanoleaf_mode_set carries the issued requestId, expectedConfigurationRevision and expectedGeneration. Authentication and scope checks run before replay lookup. Admission reserves the identity and returns 202 queued, which is not visible light.', sources=[(N, 'docs/controller-api.md'), (N, 'mcp/src/tools.ts')]),
                 dict(text='The Lines worker takes the queued work and checks the generation again immediately before transmitting. It reports sent, which is transport evidence only.', sources=[(N, 'docs/controller-api.md'), (N, 'docs/decisions/0010-per-device-worker-and-nl22.md')]),
                 dict(text='Rejections happen before any effect: an exact duplicate returns its original receipt, a changed payload under the same identity is 409 request-conflict, an expired identity is 410 request-expired, and a stale revision or generation is 409 revision-conflict or stale-generation.', sources=[(N, 'docs/controller-api.md'), (N, 'mcp/src/tools.ts')]),
                 dict(text='After admission, a newer explicit mode cancels superseded work and keeps its prior-effect evidence. A failed or uncertain mode is held until a fresh request. If delivery fails after possible dispatch, the host reports the original requestId with possible effects and never retries.', sources=[(N, 'docs/controller-api.md'), (N, 'docs/local-mcp.md')])],
         sources=[(N, 'docs/local-mcp.md'), (N, 'docs/controller-api.md'), (N, 'mcp/src/transport.ts'), (N, 'mcp/src/tools.ts'), (N, 'bridge/controller_server.py'), (N, 'docs/decisions/0010-per-device-worker-and-nl22.md'), (H, 'docs/controller-contract.md')],
         issues=['N34', 'N55', 'N64']),
    dict(id='seq-pixoo-playback', spec=D5, kind='sequence', status='implemented', revisions=VIEW,
         status_label='Current source; physical playback accepted 8 September 2026 (Pixoo #12)', short='Pixoo playback ownership',
         summary='A client reads status and catalog pages, then selects media or a playlist with the issued request identity. ControlService admits the request through the shared ledger and resolves the stored rendition. The Player orders the session, and the device adapter alone writes to the display.',
         reading=['Main path: read, select and admit, then backend playback. The receipt acknowledges admission while the upload may still be loading, and playback continues after the client disconnects.',
                  'The alternative lanes are separate: a lost response is reconciled through status with the same identity, and a stale playlist revision is rejected while current playback continues.',
                  'Screen off pauses and screen on does not resume. Selecting Monitor pauses media on the same Player; returning to Media keeps it paused until Resume. Restart restores paused context without a device write.'],
         boundaries=['Catalog names are untrusted display data. Tools never import or edit media or select raw device targets.',
                     'Physical playback, recovery and soak were accepted with recorded limits under [[P12]], and installed Monitor/Media behavior under [[P34]]. Variable frame timing and other firmware versions are outside those receipts.',
                     'Original media and referenced renditions are preserved.'],
         phases=[dict(text='get_status returns the next request identity; catalog and playlist pages are untrusted names. Reads never probe the display or refresh observation timestamps.', sources=[(P, 'docs/local-mcp.md'), (P, 'apps/server/src/control-service.ts')]),
                 dict(text='show_media or play_playlist carries the issued request_id. The service resolves a stored rendition or checks the playlist revision; a matching identity joins, and a different payload conflicts. The receipt acknowledges admitted playback context while the upload may still be loading.', sources=[(P, 'docs/local-mcp.md'), (P, 'apps/server/src/mcp-tools.ts'), (P, 'docs/hub-controller-api.md')]),
                 dict(text='The Player orders session work and hands every upload to the device adapter, the only component that writes to the display. Dwell timers advance the playlist in the backend; a disconnecting client does not cancel it.', sources=[(P, 'packages/playback/src/player.ts'), (P, 'packages/device/src/http-adapter.ts')]),
                 dict(text='After a lost response, read status and reconcile with the same identity instead of issuing a new write. A stale playlist revision returns revision-conflict and keeps current playback.', sources=[(P, 'docs/local-mcp.md'), (P, 'docs/hub-controller-api.md')]),
                 dict(text='Screen off pauses playback and screen on resumes nothing. Monitor uses the same Player, so selecting it pauses media without a second writer. Restart restores paused context and writes nothing to the device.', sources=[(P, 'packages/playback/src/player.ts'), (P, 'apps/server/src/monitor-presentation.ts'), (P, 'docs/decisions/0018-monitor-display-ownership.md')])],
         sources=[(P, 'docs/local-mcp.md'), (P, 'docs/playback.md'), (P, 'apps/server/src/mcp-tools.ts'), (P, 'apps/server/src/control-service.ts'), (P, 'packages/playback/src/player.ts'), (P, 'packages/device/src/http-adapter.ts'), (P, 'apps/server/src/monitor-presentation.ts'), (P, 'docs/hardware-validation.md')],
         issues=['P12', 'P33', 'P34', 'P37']),
    dict(id='seq-owner-migration', spec=D8, kind='sequence', status='implemented', revisions=VIEW,
         status_label='Source delivered (Hub #5, #8); no installed migration run recorded', short='Owner migration',
         summary='An operator-authorized migration revokes the old setup, quiesces and exports the embedded owner, imports that state behind a fence into an empty standalone store, stages producer and consumer routes, and activates only after rechecks. A failure stops with admission fenced; rollback is a separate explicit operation.',
         reading=['Read the four numbered phases in order. Each is a supervised call that the operator authorized, and writes stay fenced until phase 4 rechecks routes, credentials and consumer snapshots.',
                  'The first alternative lane is a failure, not a continuation: the attempt is consumed, admission stays fenced and the old owner is not resumed. Recovery exports the staged state into another empty store.',
                  'Rollback is a second explicit operation after accepted writes: revoke setup, stop the new owner, export its latest state and import it into a fresh host store. Pixoo stays a remote facade; embedded ownership is never restored into its old store.'],
         boundaries=['Released [[H3]] defines export/import format 1.0. [[P31]] implements embedded storage, quiesce/export/import and the remote facade. [[H5]] delivered supervised release, fenced import and rollback after writes; [[H8]] added Linux/WSL setup and Nanoleaf cutover.',
                     'The installed shared monitor runs as a standalone hub service ([[N30]], 22 September 2026), and Pixoo is its remote facade ([[P34]]). This diagram describes the source procedure; no installed run of it is recorded.',
                     'Controller databases stay private; Windows and WSL never coordinate through a mounted SQLite file. Repository moves ([[H25]], [[H26]]) and container hosting ([[H42]]) are separate changes.'],
         phases=[dict(text='The operator authorizes one named migration. Tooling removes the old producer setup and verifies revocation while the embedded owner still runs, then quiesces it: admitted work drains, a versioned export is validated and written privately, and a graceful exit is verified.', sources=[(H, 'apps/hub/SETUP.md'), (H, 'apps/hub/src/migration.ts')]),
                 dict(text='The standalone hub starts staged against an empty store with a matching owner ID. The fence is persisted before the single-use import. Sessions stay readable; ingestion, labels and acknowledgments are rejected.', sources=[(H, 'apps/hub/README.md'), (H, 'apps/hub/src/migration.ts')]),
                 dict(text='Producer setup is pointed at the new owner with emission disabled. Pixoo restarts as a remote facade that starts no local reducer, and Nanoleaf runs its shared-input preflight and selection while writes stay fenced.', sources=[(H, 'apps/hub/SETUP.md'), (H, 'apps/hub/src/migration-routes.ts'), (P, 'apps/server/src/monitor-source.ts')]),
                 dict(text='Activation rechecks unchanged route files, credentials and each consumer’s live snapshot against the authoritative one. It re-enables producers, then clears the fence and opens admission. Consumers read snapshots; nothing is replayed.', sources=[(H, 'apps/hub/src/migration-routes.ts'), (H, 'apps/hub/SETUP.md')]),
                 dict(text='A failed activation consumes that attempt and leaves admission fenced. Nothing proceeds automatically and the old owner is not resumed. Recovery is explicit: restart the destination staged, export its state and migrate into another empty store.', sources=[(H, 'apps/hub/SETUP.md'), (H, 'docs/architecture.md')]),
                 dict(text='Rollback after accepted writes is a separate operator request: revoke the current setup while its owner can confirm, stop the new owner and export its latest state, import into a fresh host store, and repeat consumer checks before writes reopen.', sources=[(H, 'apps/hub/SETUP.md'), (H, 'docs/architecture.md')])],
         sources=[(H, 'apps/hub/SETUP.md'), (H, 'apps/hub/README.md'), (H, 'apps/hub/src/migration.ts'), (H, 'apps/hub/src/migration-routes.ts'), (H, 'docs/architecture.md'), (H, 'packages/agent-state/README.md'), (P, 'docs/agent-monitoring.md'), (P, 'apps/server/src/monitor-source.ts'), (N, 'docs/shared-input.md')],
         issues=['H5', 'H8', 'P31', 'P34', 'N29', 'N30']),
    dict(id='seq-desktop-input', spec=D6, kind='sequence', status='future', revisions=VIEW,
         status_label='N30 qualification complete (Hub #64); reusable mapper planned', short='Codex mouse input',
         summary='Planned reusable mapper. Selecting a control profile loads mappings and sends no input or device commands. A fresh mapped navigation press resolves application scope and one of four Codex actions. Keyboard A/B and attached Super Buttons remain outside B.U.N.N.Y.',
         reading=['Only a temporary AutoHotkey trial exists today. The profile store and dispatcher shown here are planned: ordinary input passes through outside Codex, and held, repeated or stale input must not dispatch twice or replay later.',
                  'Presets require a separately selected qualified binding and service. Keyboard A/B and attached Super Buttons are excluded.'],
         boundaries=['This path does not wait for the hub, shared monitoring, general controls or Music.',
                     'N30 85CA, receiver 062A:4101 and Codex 26.917.6896.0 passed the brief owner trial under completed [[H64]]. PageUp/PageDown and Back/Forward from other devices also map inside Codex. Receiver isolation and long-term recovery are unqualified.',
                     'The later editor ([[H70]]) excludes keyboard A/B, attached Super Buttons, arbitrary scripts, shell execution, raw device commands and multi-step macros.'],
         phases=[dict(text='A profile selection only loads bindings and application scope. It sends no input and no device command.', sources=[(H, 'docs/desktop-controls.md')]),
                 dict(text='Each fresh mapped press inside Codex resolves to exactly one of four actions: next task needing attention, command menu, previous task or next task. Dispatch is reported separately from whether the app acted.', sources=[(H, 'docs/desktop-controls.md')]),
                 dict(text='Outside Codex the keys keep their ordinary behavior. Held, repeated or stale input never produces a duplicate or a later replay.', sources=[(H, 'docs/desktop-controls.md')])],
         sources=[(H, 'docs/desktop-controls.md')],
         issues=['H63', 'H64', 'H65', 'H66', 'H70']),
    dict(id='seq-big-b-presets', spec=D7, kind='sequence', status='future', revisions=VIEW,
         status_label='Deferred future work', short='Configured desk presets',
         summary='Planned preset flow. A fresh configured preset press asks the hub for the next preset. The hub owns selection and revision, sends supported native commands to each controller owner, collects independent per-device results and returns them for visible feedback. The initial cycle is Work → Free → Quiet → Work.',
         reading=['One device failing or offline is reported as a partial result; it never stalls the others or looks complete.',
                  'A manual change in a vendor app remains until the next explicit preset request, which then uses supported ownership handoff.',
                  'Startup, reconnect and profile selection replay no presses and issue no device commands. If the hub is unavailable, that is reported and local mouse controls keep working. Keyboard A/B and attached Super Buttons are excluded from preset bindings.'],
         boundaries=['[[H67]]’s inputs [[H63]], [[H32]], [[H31]], [[H5]], [[N49]] and [[P33]] are delivered. [[H68]] requires [[H65]] and [[H67]]; [[H69]] also requires [[H68]] and delivered [[H8]].',
                     'Manual preset dispatch does not require automation engine [[H45]]. Music [[H71]] consumes [[H40]] policy and requires [[H68]] and delivered shared playback [[H175]]; [[H38]]/[[H39]] apply to selected branches and [[H41]] is conditional on measured audio.',
                     'Native Nanoleaf and Pixoo modes and their restoration limits are preserved; a preset is not a shared device-mode value.'],
         phases=[dict(text='A fresh configured press asks the hub-owned preset service for the next preset in the cycle. The hub sends supported native commands through each existing controller owner and returns per-device results; a partial result is never shown as complete.', sources=[(H, 'docs/desktop-controls.md'), (H, 'docs/controller-contract.md')]),
                 dict(text='A manual change in a vendor app stays in place until the next explicit preset request, which then uses a supported ownership handoff.', sources=[(H, 'docs/desktop-controls.md')]),
                 dict(text='Startup, reconnect and profile selection replay no presses and send no device commands. An unavailable hub is reported while local mouse controls keep working.', sources=[(H, 'docs/desktop-controls.md')])],
         sources=[(H, 'docs/desktop-controls.md'), (H, 'apps/hub/README.md'), (H, 'packages/agent-state/README.md'), (H, 'docs/controller-contract.md')],
         issues=['H67', 'H68', 'H69', 'H71']),
]
assert len({d['id'] for d in DIAGRAMS}) == len(DIAGRAMS)


# ---------------------------------------------------------------------------
# Rendering and extraction
# ---------------------------------------------------------------------------
def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def spec_text(diagram):
    """The saved specification for a definition; build_guide.py compares against it."""
    return json.dumps(diagram['spec'], indent=1, ensure_ascii=False) + '\n'


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
        spec_path.write_text(spec_text(diagram), encoding='utf-8')
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
