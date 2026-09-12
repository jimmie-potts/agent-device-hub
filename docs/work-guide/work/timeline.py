"""Where we've been / where we're going: one dated history chart and one
ordered (not dated) roadmap map, both rendered as inline SVG for the guide.

History comes from work/history/github-history.json (read-only gh api reads).
The roadmap is derived from the guides and the current issue snapshot. Future
stages are ordered by prerequisite, never assigned dates.
"""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import html
import json

TZ = ZoneInfo('America/New_York')
REPO_ORDER = ['H', 'N', 'P']
REPO_NAME = {'H': 'agent-device-hub', 'N': 'codex-nanoleaf', 'P': 'divoom-app-upgrade'}
REPO_LABEL = {'H': 'Hub', 'N': 'Nanoleaf', 'P': 'Pixoo'}
# Delivered baselines worth naming on the history chart (repo key, PR number, caption).
MILESTONES = {
    ('H', 74): 'Lifecycle contract v1', ('H', 12): 'Shared architecture', ('H', 28): 'Controller contract v1', ('H', 29): 'Device MCP module',
    ('N', 39): 'Protected controller API', ('N', 48): 'Nanoleaf MCP bindings', ('N', 56): 'Connector geometry',
    ('P', 54): 'Local reliability', ('P', 53): 'Monitoring contract', ('P', 28): 'Playlist playback', ('P', 45): 'Physical Pixoo adapter', ('P', 49): 'Pixoo MCP media tools', ('P', 50): 'Local Codex acceptance',
}

# Roadmap columns order each track. Cross-track prerequisites come from arrows,
# not from the shared Codex milestone's position in a different row.
SLOTS = ['Now · ready or independent', 'Next in this track', 'Following stage', 'Later', 'Deferred · conditional']
TRACKS = [
    ('Main product path', [
        dict(id='n-local', x=0, label='Local acceptance done', issues=[], guide='local-acceptance', ready=True),
        dict(id='n-codex', x=1, label='Shared Codex integration', issues=['H32', 'H3', 'P31', 'P37', 'P32', 'P33', 'N29', 'N49', 'P30', 'H5', 'H8', 'H6', 'H13', 'H30', 'H9', 'P34', 'N30'], guide='shared-codex', main=True),
        dict(id='n-controls', x=2, label='General controls', issues=['H31', 'H35'], guide='controls-music', main=True),
        dict(id='n-music', x=3, label='Apple Music', issues=['H36', 'H40', 'H37', 'H38', 'H39', 'H41'], guide='controls-music', main=True),
        dict(id='n-assistant', x=4, label='Assistant + access', issues=['H45', 'H46', 'H47', 'H48', 'H49'], guide='assistant-access', main=True),
    ]),
    ('Desktop controls (shortcut path)', [
        dict(id='n-desk-doc', x=0, label='Docs + qualification', issues=['H63', 'H64'], guide='desktop-controls', ready=True),
        dict(id='n-desk-local', x=1, label='Wispr + mouse controls', issues=['H65', 'H66'], guide='desktop-controls'),
        dict(id='n-desk-presets', x=2, label='Work / Free / Quiet presets', issues=['H67', 'H68'], guide='desktop-controls'),
        dict(id='n-desk-verify', x=3, label='Preset verification', issues=['H69'], guide='desktop-controls'),
        dict(id='n-desk-later', x=4, label='Profiles · Music preset', issues=['H70', 'H71'], guide='desktop-controls'),
    ]),
    ('Nanoleaf Lines + Light Panels', [
        dict(id='n-nl-state', x=0, label='State + geometry', issues=['N41'], guide='nanoleaf-devices'),
        dict(id='n-nl-worker', x=1, label='Worker + panel effects', issues=['N42', 'N43'], guide='nanoleaf-devices'),
        dict(id='n-nl-map', x=2, label='Map, tray, upgrades', issues=['N44', 'N45'], guide='nanoleaf-devices'),
        dict(id='n-nl-accept', x=3, label='Installed acceptance', issues=['N46'], guide='nanoleaf-devices'),
        dict(id='n-nl-pool', x=4, label='Combined pool', issues=['N47'], guide='nanoleaf-devices'),
    ]),
    ('Nanoleaf rendering + displays', [
        dict(id='n-np-fix', x=0, label='External scenes', issues=['N21'], guide='nanoleaf-presentation'),
        dict(id='n-np-render', x=1, label='Rendering + live renderer', issues=['N15', 'N17'], guide='nanoleaf-presentation'),
        dict(id='n-np-custom', x=2, label='Palettes + effects', issues=['N18', 'N19', 'N20'], guide='nanoleaf-presentation'),
        dict(id='n-np-lively', x=3, label='Lively prototype', issues=['N10', 'N11', 'N12', 'N13', 'N14'], guide='nanoleaf-presentation'),
        dict(id='n-np-ambient', x=4, label='Ambient view', issues=['N16'], guide='nanoleaf-presentation'),
    ]),
    ('Prism wall artwork', [
        dict(id='n-prism-geometry', x=0, label='Geometry delivered', issues=[], guide='nanoleaf-presentation'),
        dict(id='n-prism-renderer', x=1, label='Crystal + flow delivered', issues=[], guide='nanoleaf-presentation'),
        dict(id='n-prism-numbers', x=2, label='Luminous numbers delivered', issues=[], guide='nanoleaf-presentation'),
    ]),
    ('Tidbyt + LIFX', [
        dict(id='n-tl-qual', x=0, label='Connection qualification', issues=['H15', 'H17'], guide='tidbyt-lifx'),
        dict(id='n-tl-ctrl', x=1, label='Controllers', issues=['H16', 'H18'], guide='tidbyt-lifx'),
        dict(id='n-tl-status', x=2, label='Automatic status', issues=['H19', 'H20'], guide='tidbyt-lifx'),
        dict(id='n-tl-accept', x=3, label='Installed acceptance', issues=['H21', 'H22'], guide='tidbyt-lifx'),
        dict(id='n-tl-later', x=4, label='Tronbyt · other options', issues=['H23', 'H24', 'H11'], guide='tidbyt-lifx'),
    ]),
    ('PC + desk lighting', [
        dict(id='n-pc-doc', x=0, label='Documentation (PR #59)', issues=['H50'], guide='pc-lighting'),
        dict(id='n-pc-qual', x=1, label='Qualification', issues=['H51', 'H52', 'H60'], guide='pc-lighting'),
        dict(id='n-pc-ctrl', x=2, label='Corsair controller · status', issues=['H53', 'H55'], guide='pc-lighting'),
        dict(id='n-pc-accept', x=3, label='Acceptance · shared UI', issues=['H57', 'H56'], guide='pc-lighting'),
        dict(id='n-pc-opt', x=4, label='Strimer · Varmilo', issues=['H58', 'H61', 'H62'], guide='pc-lighting'),
    ]),
    ('Pixoo media + access', [
        dict(id='n-px-media', x=2, label='Media features', issues=['P13', 'P15', 'P16', 'P18', 'P52', 'P55'], guide='pixoo-media'),
        dict(id='n-px-access', x=3, label='Remote browser · ChatGPT', issues=['P11', 'P43', 'P17', 'P44'], guide='assistant-access'),
    ]),
    ('Nanoleaf Linux runtime', [
        dict(id='n-linux-source', x=0, label='Linux source delivered', issues=[], guide='hosting-migrations', ready=True),
        dict(id='n-linux-acceptance', x=1, label='Linux installed acceptance', issues=['N55'], guide='hosting-migrations'),
        dict(id='n-linux-portability', x=2, label='Architecture documentation', issues=['H43'], guide='hosting-migrations'),
    ]),
    ('Hosting + migrations', [
        dict(id='n-host', x=2, label='PC / container hosting', issues=['H42', 'P14'], guide='hosting-migrations'),
        dict(id='n-host-port', x=3, label='Dedicated server', issues=['H44'], guide='hosting-migrations'),
        dict(id='n-host-src', x=4, label='Source consolidation', issues=['H25', 'H26'], guide='hosting-migrations'),
    ]),
    ('Development workflow', [
        dict(id='n-dev-ci', x=0, label='CI + guide maintenance', issues=['H73', 'H80'], guide='development-workflow'),
        dict(id='n-dev-jobs', x=1, label='Job consolidation', issues=['P47'], guide='development-workflow'),
        dict(id='n-dev-spec', x=2, label='Shared OpenSpec tooling', issues=['H10', 'N31', 'P38'], guide='development-workflow'),
    ]),
    ('Guide workflow checkpoints', [
        dict(id='n-guide-workflow', x=0, label='Checkpoints delivered', issues=[], guide='development-workflow'),
    ]),
    ('Guide Prism design + rollout', [
        dict(id='n-guide-design', x=0, label='Approve guide design', issues=['H85'], guide='development-workflow'),
        dict(id='n-guide-artwork', x=1, label='Guide artwork + motion', issues=['H86'], guide='development-workflow'),
        dict(id='n-guide-publish', x=2, label='Local + public verification', issues=['H87'], guide='development-workflow'),
    ]),
]
# Cross-track prerequisites (from → to). Same-track order is drawn automatically.
CROSS = [
    ('n-codex', 'n-desk-presets', 'H32 · H31 · H5'), ('n-codex', 'n-tl-status', 'H3 · P31'), ('n-codex', 'n-pc-ctrl', 'H3 · P31'),
    ('n-codex', 'n-tl-accept', 'H8'), ('n-codex', 'n-pc-accept', 'H8'), ('n-codex', 'n-desk-verify', 'H8'),
    ('n-local', 'n-px-media', 'P12'), ('n-local', 'n-px-access', 'P12 · P26'), ('n-codex', 'n-host', 'H5'),
    ('n-controls', 'n-desk-presets', 'H31'), ('n-music', 'n-desk-later', 'H36 · H40'), ('n-desk-local', 'n-desk-presets', 'H65'),
]


def esc(value):
    return html.escape(str(value), quote=True)


def local(iso):
    return datetime.fromisoformat(iso.replace('Z', '+00:00')).astimezone(TZ)


def history_chart(history, snapshot_iso, issues):
    repos = history['repositories']
    start = min(local(v['createdAt']) for v in repos.values())
    end = local(snapshot_iso)
    start = start - timedelta(hours=2)
    span = (end + timedelta(hours=4) - start).total_seconds()
    left, right, top = 150, 24, 46
    row_h, width = 92, 1000
    plot_w = width - left - right
    height = top + row_h * 3 + 44

    def x(dt):
        return left + plot_w * (dt - start).total_seconds() / span

    parts = [f'<svg class="history" viewBox="0 0 {width} {height}" role="img" aria-labelledby="history-title history-desc" preserveAspectRatio="xMidYMid meet">',
             f'<title id="history-title">Merged pull requests per repository through {esc(end.strftime("%B %d, %Y"))}</title>',
             f'<desc id="history-desc">Three rows, one per repository, with a mark for every pull request merged to main between repository creation and the backlog snapshot. Milestone deliveries are labeled. A vertical line marks the backlog snapshot time.</desc>']
    # ticks every 12 hours, day labels at local midnight
    tick = start.replace(hour=0, minute=0, second=0, microsecond=0)
    while tick <= end + timedelta(hours=4):
        if tick >= start:
            tx = x(tick)
            major = tick.hour == 0
            parts.append(f'<line class="tick{" major" if major else ""}" x1="{tx:.1f}" y1="{top - 6}" x2="{tx:.1f}" y2="{height - 40}"/>')
            parts.append(f'<text class="tick-label" x="{tx:.1f}" y="{height - 22}" text-anchor="middle">{esc(tick.strftime("%a %b %d") if major else tick.strftime("%H:%M"))}</text>')
        tick += timedelta(hours=12)
    snapshot_x = x(end)
    parts.append(f'<line class="snapshot-line" x1="{snapshot_x:.1f}" y1="{top - 14}" x2="{snapshot_x:.1f}" y2="{height - 40}"/>')
    parts.append(f'<text class="snapshot-label" x="{snapshot_x - 6:.1f}" y="{top - 18}" text-anchor="end">backlog snapshot {esc(end.strftime("%b %d %H:%M %Z"))}</text>')
    totals = {'merged': 0, 'closed': 0, 'commits': 0}
    for index, key in enumerate(REPO_ORDER):
        repo = repos[REPO_NAME[key]]
        cy = top + row_h * index + row_h / 2
        parts.append(f'<line class="row-line" x1="{left}" y1="{cy:.1f}" x2="{width - right}" y2="{cy:.1f}"/>')
        parts.append(f'<text class="row-label repo-{key}" x="{left - 12}" y="{cy - 4:.1f}" text-anchor="end">{esc(REPO_LABEL[key])}</text>')
        parts.append(f'<text class="row-meta" x="{left - 12}" y="{cy + 12:.1f}" text-anchor="end">{len(repo["mergedPRs"])} merged · {len(repo["closedIssues"])} closed</text>')
        created = x(local(repo['createdAt']))
        parts.append(f'<g class="repo-start"><line x1="{created:.1f}" y1="{cy - 14:.1f}" x2="{created:.1f}" y2="{cy + 14:.1f}"/><text x="{created + 4:.1f}" y="{cy - 17:.1f}">repo created</text></g>')
        last_x, lane = -100, 0
        # Milestone captions take the first free level below the row, then above it.
        levels = [cy + 30, cy + 41, cy - 24, cy - 35]
        placed = {level: [(created - 6, created + 70)] if level < cy else [] for level in levels}
        for pr in repo['mergedPRs']:
            when = local(pr['mergedAt'])
            px = x(when)
            lane = (lane + 1) % 3 if px - last_x < 9 else 0
            last_x = px
            py = cy + (0, -9, 9)[lane]
            milestone = MILESTONES.get((key, pr['number']))
            label = f'{REPO_LABEL[key]} PR #{pr["number"]}: {pr["title"]}'
            classes = f'pr repo-{key}{" milestone" if milestone else ""}'
            caption = ''
            if milestone:
                half = len(milestone) * 2.7 + 4
                level = next((lv for lv in levels if all(px + half < a or px - half > b for a, b in placed[lv])), levels[-1])
                placed[level].append((px - half, px + half))
                leader = f'<line class="leader" x1="{px:.1f}" y1="{py + (7 if level > cy else -7):.1f}" x2="{px:.1f}" y2="{level - (8 if level > cy else -3):.1f}"/>' if abs(level - cy) > 30 else ''
                caption = leader + f'<text class="milestone-label" x="{px:.1f}" y="{level:.1f}" text-anchor="middle">{esc(milestone)}</text>'
            parts.append(f'<a class="{classes}" href="{esc(pr["url"])}" target="_blank" rel="noopener noreferrer" data-repo="{key}" data-tip="{esc(label)}" data-when="{esc(when.strftime("%a %b %d, %H:%M %Z"))}" aria-label="{esc(label)}, merged {esc(when.strftime("%b %d %H:%M %Z"))}">'
                         f'<circle cx="{px:.1f}" cy="{py:.1f}" r="{7 if milestone else 5}"/>' + caption + '</a>')
        totals['merged'] += len(repo['mergedPRs']); totals['closed'] += len(repo['closedIssues']); totals['commits'] += repo['mainCommitCount']
    parts.append('</svg>')
    return ''.join(parts), totals


def roadmap_map(issues, guides_by_id):
    slot_w, left, top, track_h, node_w, node_h = 206, 236, 74, 66, 188, 44
    width = left + slot_w * len(SLOTS) + 12
    height = top + track_h * len(TRACKS) + 20
    nodes = {}
    for track_index, (track, items) in enumerate(TRACKS):
        for item in items:
            cx = left + slot_w * item['x'] + slot_w / 2
            cy = top + track_h * track_index + track_h / 2
            nodes[item['id']] = dict(item, cx=cx, cy=cy, track=track)
    parts = [f'<svg class="roadmap" viewBox="0 0 {width} {height}" role="img" aria-labelledby="roadmap-title roadmap-desc" preserveAspectRatio="xMidYMid meet">',
             '<title id="roadmap-title">Ordered roadmap of the remaining work guides</title>',
             '<desc id="roadmap-desc">Rows are work tracks. Columns order stages from ready now to deferred; they are not dates. Solid connectors show order within a track; dashed connectors show cross-track prerequisites. Each node links to its work guide and lists its issues.</desc>',
             '<defs><marker id="road-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 8 4 0 8z"/></marker></defs>']
    for slot, name in enumerate(SLOTS):
        sx = left + slot_w * slot
        parts.append(f'<rect class="slot{" even" if slot % 2 else ""}" x="{sx}" y="{top - 30}" width="{slot_w}" height="{height - top + 10}"/>')
        parts.append(f'<text class="slot-label" x="{sx + slot_w / 2:.1f}" y="{top - 40}" text-anchor="middle">{esc(name)}</text>')
    for track_index, (track, items) in enumerate(TRACKS):
        cy = top + track_h * track_index + track_h / 2
        parts.append(f'<text class="track-label{" main" if track_index == 0 else ""}" x="{left - 14}" y="{cy + 4:.1f}" text-anchor="end">{esc(track)}</text>')
        for a, b in zip(items, items[1:]):
            na, nb = nodes[a['id']], nodes[b['id']]
            parts.append(f'<line class="edge same" data-from="{a["id"]}" data-to="{b["id"]}" x1="{na["cx"] + node_w / 2:.1f}" y1="{cy:.1f}" x2="{nb["cx"] - node_w / 2:.1f}" y2="{cy:.1f}" marker-end="url(#road-arrow)"/>')
    for frm, to, why in CROSS:
        a, b = nodes[frm], nodes[to]
        x1, y1 = a['cx'], a['cy'] + node_h / 2
        x2, y2 = b['cx'] - node_w / 2, b['cy']
        parts.append(f'<path class="edge cross" data-from="{frm}" data-to="{to}" d="M{x1:.1f} {y1:.1f} C {x1:.1f} {(y1 + y2) / 2:.1f}, {x2 - 40:.1f} {y2:.1f}, {x2:.1f} {y2:.1f}" marker-end="url(#road-arrow)"><title>{esc(a["label"])} → {esc(b["label"])}: needs {esc(why)}</title></path>')
    listed = []
    for node in nodes.values():
        keys = node['issues']
        repo_counts = {k: sum(i.startswith(k) for i in keys) for k in REPO_ORDER}
        chips = ' '.join(f'{REPO_LABEL[k]} {v}' for k, v in repo_counts.items() if v)
        open_keys = [k for k in keys if issues[k]['state'] == 'OPEN']
        summary = f'{chips} · {len(open_keys)} open' if chips else f'{len(open_keys)} open'
        tip = (' · '.join(f'{REPO_LABEL[k[0]]} #{issues[k]["number"]} {issues[k]["title"]}' for k in keys) if len(keys) <= 4
               else f'{len(keys)} issues: ' + ', '.join(f'{REPO_LABEL[k[0]]} #{issues[k]["number"]}' for k in keys))
        guide = guides_by_id[node['guide']]
        classes = 'node' + (' main' if node.get('main') else '') + (' ready' if node.get('ready') else '')
        repos = ' '.join(k for k, v in repo_counts.items() if v)
        parts.append(f'<a class="{classes}" href="#{node["guide"]}" data-node="{node["id"]}" data-repos="{repos}" data-tip="{esc(node["label"])}" data-detail="{esc(tip)}" data-guide="{esc(guide)}" aria-label="{esc(node["label"])}: {len(open_keys)} open issues in guide {esc(guide)}. {esc(tip)}">'
                     f'<rect x="{node["cx"] - node_w / 2:.1f}" y="{node["cy"] - node_h / 2:.1f}" width="{node_w}" height="{node_h}" rx="3"/>'
                     f'<text class="node-label" x="{node["cx"]:.1f}" y="{node["cy"] - 4:.1f}" text-anchor="middle">{esc(node["label"])}</text>'
                     f'<text class="node-meta" x="{node["cx"]:.1f}" y="{node["cy"] + 13:.1f}" text-anchor="middle">{esc(summary)}</text></a>')
        listed.append((node['track'], node['label'], guide, keys))
    parts.append('</svg>')
    return ''.join(parts), nodes, listed


def build(history, snapshot_iso, issues, guides_by_id, coverage):
    all_keys = [k for _, items in TRACKS for item in items for k in item['issues']]
    open_keys = {k for k, v in issues.items() if v['state'] == 'OPEN'}
    assert len(all_keys) == len(set(all_keys)), 'Roadmap lists an issue twice'
    assert set(all_keys) == open_keys, f'Roadmap coverage mismatch: {set(all_keys) ^ open_keys}'
    for _, items in TRACKS:
        for item in items:
            assert set(item['issues']) <= set(coverage[item['guide']]), f'{item["id"]} lists issues outside its guide'
    chart, totals = history_chart(history, snapshot_iso, issues)
    roadmap, nodes, listed = roadmap_map(issues, guides_by_id)
    fetched = local(history['fetchedAt'])
    meta = dict(historyFetchedAt=history['fetchedAt'], mergedPRs=totals['merged'], closedIssues=totals['closed'], mainCommits=totals['commits'],
                roadmapNodes=len(nodes), roadmapTracks=len(TRACKS), roadmapSlots=SLOTS,
                headRevisions={repo: value['headSha'] for repo, value in history['repositories'].items()})
    return dict(history=chart, roadmap=roadmap, totals=totals, fetched=fetched, meta=meta, nodes=nodes, listed=listed)
