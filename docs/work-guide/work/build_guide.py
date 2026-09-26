from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
import html
import json
import re
import shutil
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'skins'))
import skin as SKIN  # noqa: E402  shared token files and theme control
import architecture_diagrams as AD  # noqa: E402  diagram definitions and rendered-file layout
import guide_status as GS
import recommendations as REC
import guide_section as GD
import guide_direction as GDIR  # noqa: E402  dated direction narrative and computed leverage
import guide_ideas as GI  # noqa: E402  idea-marked stories, derived from their Guide sections
from guide_paths import PATHS, TOPICS, ALIASES, GUIDE_TRACKS
import timeline as TL  # noqa: E402  history chart and ordered roadmap map

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'outputs' / 'agent-device-work-guides.html'
VIEWERS = OUT.parent / 'architecture'
REPOS = {'H': ('agent-device-hub', 'Hub'), 'N': ('codex-nanoleaf', 'Nanoleaf'), 'P': ('divoom-app-upgrade', 'Pixoo')}
SNAPSHOT = json.loads((ROOT / 'work/backlogs/snapshot.json').read_text())
REFRESHED = datetime.fromisoformat(SNAPSHOT['refreshedAt']).astimezone(ZoneInfo('America/New_York'))
HISTORY = json.loads((ROOT / 'work/history/github-history.json').read_text())
DIAGRAM_RECEIPTS = json.loads((AD.ARCH / 'diagram-receipts.json').read_text())
ARCHIFY_CLASSES = json.loads((AD.RENDERED / 'archify-classes.json').read_text())
SOURCE_REVIEW = datetime.fromisoformat(AD.SOURCES['reviewedAt']).astimezone(ZoneInfo('America/New_York'))
ISSUES = {}
for key, (repo, _) in REPOS.items():
    for issue in json.loads((ROOT / 'work' / 'backlogs' / f'{repo}-issues.json').read_text()):
        ISSUES[f'{key}{issue["number"]}'] = issue

DEPENDENCIES = GS.load_dependencies(ROOT / 'work/backlogs', ISSUES)
LEVERAGE = GS.leverage(ISSUES, DEPENDENCIES)
# Saved Execution recommendation sections, read strictly from the snapshot bodies.
RECOMMENDATIONS = {key: REC.read(issue['body']) for key, issue in ISSUES.items() if issue['state'] == 'OPEN'}

# The catalog holds reading paths; each open story's own Guide section owns its topic.
# An Extends line may name only stories this snapshot holds.
GUIDE_STATE = {key: GD.read(issue['body'], keys=set(ISSUES)) for key, issue in ISSUES.items() if issue['state'] == 'OPEN'}
invalid = [(key, state) for key, state in GUIDE_STATE.items() if state['state'] != 'assigned']
assert not invalid, 'Stories without a valid Guide topic: ' + '; '.join(
    f"{key} ({state.get('reason', state['state'])})" for key, state in invalid)
IDEAS = GI.marked(GUIDE_STATE)
IDEA_KEYS = GI.ordered(IDEAS, list(PATHS))
# The direction narrative is checked against the snapshot before anything renders, so a stale
# citation, or a story both in the build-next sequence and marked as an idea, stops the build here.
GDIR.check(ISSUES, set(IDEAS))
coverage = {topic_id: [] for topic_id in PATHS}
for key in sorted(GUIDE_STATE, key=lambda k: (k[0], int(k[1:]))):
    coverage[GUIDE_STATE[key]['topic']].append(key)
NEXT_STEPS = {key: state['highlight']['reason'] for key, state in GUIDE_STATE.items()
             if state['highlight'] and state['highlight']['kind'] == 'next step'}
DECISIONS = {key: state['highlight']['reason'] for key, state in GUIDE_STATE.items()
            if state['highlight'] and state['highlight']['kind'] == 'decision'}
OWNER_LATER = {key: state['highlight']['reason'] for key, state in GUIDE_STATE.items()
              if state['highlight'] and state['highlight']['kind'] == 'later'}
WORKAROUNDS = {key: state['workaround'] for key, state in GUIDE_STATE.items() if state['workaround']}
GUIDES = [dict(id=key, short=title, title=title, phase='Topic guide', intro=outcome,
               headers=['Work', 'Issue', 'Next action or gate'],
               rows=[[html.escape(ISSUES[k]['title']), '[[' + k + ']]', ''] for k in coverage[key]], notes=[])
          for key, title, outcome, _, _ in TOPICS]
ARCHIVE = json.loads((ROOT / 'work/history/completed-guide-evidence.json').read_text())

# Stable guide IDs own coverage; guide order has no effect on issue assignments.
assert set(coverage) == {g['id'] for g in GUIDES}
assert all(issue['state'] in ('OPEN', 'CLOSED') for issue in ISSUES.values())
all_primary = [key for ids in coverage.values() for key in ids]
open_keys = {key for key, issue in ISSUES.items() if issue['state'] == 'OPEN'}
assert len(all_primary) == len(set(all_primary)), 'Duplicate primary coverage'
assert set(all_primary) == open_keys, f'Coverage mismatch: {set(all_primary) ^ open_keys}'
TOTAL = len(open_keys)
COUNTS = {key:sum(k.startswith(key) for k in open_keys) for key in REPOS}
assert TOTAL == SNAPSHOT['openIssues']
assert all(COUNTS[key] == SNAPSHOT['repositories'][repo]['openIssues'] for key,(repo,_) in REPOS.items())
assert ISSUES['P26']['state'] == 'CLOSED' and ISSUES['P26']['stateReason'] == 'completed', 'Review completed baseline prose'
TL.reconcile(ISSUES, coverage, ALIASES)
TIMELINE = TL.build(HISTORY, SNAPSHOT['refreshedAt'], ISSUES, {g['id']: g['short'] for g in GUIDES}, coverage)
# Architecture is a reference section: its issue links never add to counts, and its
# source review has its own timestamp separate from the backlog snapshot.
receipt_by_id = {r['id']: r for r in DIAGRAM_RECEIPTS['diagrams']}
assert [d['id'] for d in AD.DIAGRAMS] == [r['id'] for r in DIAGRAM_RECEIPTS['diagrams']], 'Rendered diagrams do not match definitions'
for diagram in AD.DIAGRAMS:
    # A definition edited without rerunning architecture_diagrams.py leaves every saved file stale.
    spec_path, receipt = AD.SPECS / f"{diagram['id']}.json", receipt_by_id[diagram['id']]
    assert spec_path.read_text(encoding='utf-8') == AD.spec_text(diagram), f"Stale specification for {diagram['id']}: rerun architecture_diagrams.py"
    assert AD.sha256(spec_path) == receipt['specification']['sha256'], f"Specification for {diagram['id']} differs from its render receipt"
for receipt in DIAGRAM_RECEIPTS['diagrams']:
    validation = receipt['validation']
    assert validation['checksPassed'] == validation['checkCount'] == 9 and validation['errors'] == 0 and validation['warnings'] == 0, receipt['id']
    assert AD.sha256(AD.RENDERED / f"{receipt['id']}.svg") == receipt['svgSha256'], f"Stale SVG for {receipt['id']}"
    assert AD.sha256(AD.RENDERED / receipt['viewer']) == receipt['artifact']['sha256'], f"Stale viewer for {receipt['id']}"
METADATA = dict(refreshedAt=SNAPSHOT['refreshedAt'], snapshotDate=REFRESHED.strftime('%-d %b'), staticSnapshot=True, openIssues=TOTAL,
                guideCount=len(GUIDES), projectCount=len(REPOS), repositoryCounts=COUNTS,
                primaryCoverage=coverage, completedBaselines=['H5', 'N29', 'P12', 'P26', 'P29', 'P37', 'H2', 'H4', 'H7'],
                history=TIMELINE['meta'],
                architecture=dict(reviewedAt=AD.SOURCES['reviewedAt'], renderedAt=DIAGRAM_RECEIPTS['renderedAt'], sourceRevisions=AD.SOURCES['sourceRevisions'], viewRevisions=AD.VIEW, viewsReviewedAt=AD.SOURCES['viewsReviewedAt'],
                                  diagramCount=len(AD.DIAGRAMS), diagrams=[dict(id=d['id'], kind=d['kind'], status=d['status'], viewer=f"architecture/{d['id']}.html",
                                                                                 viewerSha256=receipt_by_id[d['id']]['artifact']['sha256']) for d in AD.DIAGRAMS],
                                  countedInIssueTotals=False),
                direction=dict(asOf=GDIR.AS_OF, revision=GDIR.REVISION, countedInIssueTotals=False),
                ideas=dict(count=len(IDEA_KEYS), keys=IDEA_KEYS, countedInIssueTotals=False))

def issue_link(key):
    issue = ISSUES[key]
    dependencies = DEPENDENCIES.get(key, [])
    status = GS.issue_status(issue, dependencies)
    symbol, status_text = GS.STATUS[status]
    if status in ('in-progress', 'review') and GS.is_blocked(issue, dependencies):
        status_text += ' · blocked'
    label = f'{REPOS[key[0]][1]} #{issue["number"]}'
    title = html.escape(f'{label}: {issue["title"]} ({status_text}; opens a task brief)', quote=True)
    return f'<a class="issue repo-{key[0]}" data-issue="{key}" data-state="{issue["state"]}" data-status="{status}" href="{html.escape(issue["url"], quote=True)}" target="_blank" rel="noopener noreferrer" title="{title}" aria-label="{title}"><span class="status-symbol" aria-hidden="true">{symbol}</span><span class="issue-id">{label}</span><span class="issue-status">{status_text}</span></a>'


def render(text):
    return re.sub(r'\[\[([HNP]\d+)\]\]', lambda match: issue_link(match.group(1)), text)


def gate_text(key):
    issue = ISSUES[key]
    dependencies = DEPENDENCIES.get(key, [])
    blockers = GS.open_blockers(dependencies)
    if issue['state'] == 'CLOSED':
        return 'Closed in this snapshot. Read the owning receipt for its accepted scope.'
    if key in OWNER_LATER:
        return OWNER_LATER[key]
    if blockers:
        names = ', '.join(f'{d["repository"]["nameWithOwner"].split("/")[-1]} #{d["number"]}' for d in blockers)
        return f'Waiting for {html.escape(names)}.'
    if 'blocked' in GS.labels(issue):
        return 'Blocked label remains. Reconcile the issue body and evidence; no open GitHub prerequisite is recorded.'
    if 'deferred' in GS.labels(issue):
        return 'Deferred. Select and refine its scope before scheduling.'
    if GS.issue_status(issue, dependencies) in ('in-progress', 'review'):
        return 'Work is underway. Coordinate with the current owner.'
    return 'No recorded open prerequisite. Confirm the issue scope and owner before starting.'


nav = []
sections = []
for index, guide in enumerate(GUIDES, 1):
    guide_id = guide['id']
    count = len(coverage[guide_id])
    content = json.dumps(guide)
    assert set(coverage[guide_id]) <= set(re.findall(r'\[\[([HNP]\d+)\]\]', content)), f'Missing primary links in {guide_id}'
    nav.append(f'<a href="#{guide_id}" data-guide="{guide_id}"><span class="nav-number">{index:02}</span><span>{guide["short"]}</span><span class="nav-count" aria-label="{count} open issues">{count:02}</span></a>')
    headings = ''.join(f'<th scope="col">{heading}</th>' for heading in guide['headers'])
    remaining, closed = [], []
    for row in guide['rows']:
        owners = re.findall(r'\[\[([HNP]\d+)\]\]', row[1])
        destination = closed if owners and all(ISSUES[key]['state'] == 'CLOSED' for key in owners) else remaining
        # The issue chip owns status; avoid repeating "Completed" in row labels.
        note = GUIDE_STATE[owners[0]].get('note') or ''
        row = [row[0], row[1], html.escape(note) + '<p>' + gate_text(owners[0]) + '</p>']
        cells = [render(re.sub(r'^Completed(?: / | )', '', cell)) for cell in row]
        # The starting-session label is added after link rendering so its text stays literal.
        if owners[0] in RECOMMENDATIONS:
            cells[-1] += REC.label_html(owners[0], RECOMMENDATIONS[owners[0]])
        destination.append('<tr>' + ''.join(f'<td data-label="{guide["headers"][n]}">{cell}</td>' for n, cell in enumerate(cells)) + '</tr>')
    def table(rows, caption):
        return f'<table><caption class="sr-only">{guide["title"]}: {caption}</caption><thead><tr>{headings}</tr></thead><tbody>{"".join(rows)}</tbody></table>'
    work = '<h3 class="work-heading">Remaining work</h3>' + table(remaining, 'remaining work and dependencies') if remaining else '<p class="all-done">No open stories owned by this guide.</p>'
    if guide_id in GUIDE_TRACKS:
        tracks = GUIDE_TRACKS[guide_id]
        # A row outside every track would silently disappear from the guide.
        assert sorted(key for keys in tracks.values() for key in keys) == sorted(coverage[guide_id]), f'Tracks must cover {guide_id} exactly once'
        work = ''
        for track, keys in tracks.items():
            rows = [row for row, key in zip(remaining, coverage[guide_id]) if key in keys]
            if not rows:
                continue
            body = table(rows, track)
            work += ('<details class="guide-evidence"><summary>PC lighting · later</summary>' + body + '</details>' if track == 'PC lighting'
                     else '<h3 class="work-heading">' + track + '</h3>' + body)

    completed = f'<details class="delivery-evidence"><summary>Closed stories and delivery evidence <span>{len(closed)} rows</span></summary>{table(closed, "closed stories and accepted scope")}</details>' if closed else ''
    notes = ''.join(f'<p>{render(note)}</p>' for note in guide['notes'])
    outcome, next_action, next_keys = PATHS[guide_id]
    gates = ''.join(f'<li>{issue_link(key)}<span>{gate_text(key)}</span></li>' for key in next_keys)
    sections.append(f'''<details class="guide" id="{guide_id}" data-count="{count}" data-primary="{' '.join(coverage[guide_id])}" open>
      <summary><span class="guide-number">{index:02}</span><span class="guide-heading"><span class="eyebrow">{guide['phase']}</span><h2>{guide['title']}</h2></span><span class="guide-count">{count} open</span><span class="chevron" aria-hidden="true">−</span></summary>
      <div class="guide-body">{''.join(f'<span id="{alias}" class="legacy-anchor"></span>' for alias, target in ALIASES.items() if target == guide_id)}<p class="intro">{outcome}</p>
      <div class="next-action"><h3>Next step</h3><p>{next_action}</p><ul class="next-issues">{gates}</ul></div>
      {work}{completed}

      <a class="back-top" href="#top">Back to overview <span aria-hidden="true">↑</span></a></div></details>''')

# Overview sections reference the same primary issues without changing totals.
from guide_overview import render_overview
owners = {key: guide for guide, keys in coverage.items() for key in keys}
overview = render_overview(ISSUES, DEPENDENCIES, SNAPSHOT['refreshedAt'], owners,
                           {g['id']: g['short'] for g in GUIDES}, issue_link, gate_text,
                           lambda key: REC.label_html(key, RECOMMENDATIONS[key]),
                           NEXT_STEPS, DECISIONS, OWNER_LATER, WORKAROUNDS)
archive_groups = []
for group in ARCHIVE['groups']:
    rows = ''.join('<tr>' + ''.join('<td>' + render(cell) + '</td>' for cell in row) + '</tr>' for row in group['rows'])
    notes = ''.join('<p>' + render(note) + '</p>' for note in group['notes'])
    archive_groups.append('<details class="delivery-evidence"><summary>' + html.escape(group['title']) + '</summary><table><thead><tr>' + ''.join('<th>' + h + '</th>' for h in group['headers']) + '</tr></thead><tbody>' + rows + '</tbody></table><div class="guide-notes">' + notes + '</div></details>')
archive_section = '<details class="archive" id="local-acceptance"><summary><h2>Completed milestones and evidence</h2></summary><p>' + ARCHIVE['note'] + '</p>' + ''.join(archive_groups) + '</details>'

# --- Architecture reference section -----------------------------------------
STATUS_NAMES = {'implemented': 'Implemented source', 'planned': 'Planned composition', 'future': 'Future work'}
figures, future_figures, diagram_index = [], [], []
for number, diagram in enumerate(AD.DIAGRAMS, 1):
    svg = (AD.RENDERED / f"{diagram['id']}.svg").read_text(encoding='utf-8').replace('@@DESC@@', html.escape(diagram['summary']))
    code = f'{"A" if diagram["kind"] == "architecture" else "S"}{number}'
    reading = ''.join(f'<li>{render(item)}</li>' for item in diagram['reading'])
    boundaries = ''.join(f'<li>{render(item)}</li>' for item in diagram['boundaries'])
    sources = ''.join(f'<a href="{html.escape(AD.src(repo, path, AD.pins(diagram)), quote=True)}" target="_blank" rel="noopener noreferrer">{html.escape(REPOS[{"agent-device-hub": "H", "codex-nanoleaf": "N", "divoom-app-upgrade": "P"}[repo]][1])} {html.escape(path)}<span aria-hidden="true" class="external">↗</span></a>' for repo, path in diagram['sources'])
    issues = render(' '.join(f'[[{key}]]' for key in diagram['issues']))
    cited = {repo for repo, _ in diagram['sources']}
    pinned = ' · '.join(f'{REPOS[{"agent-device-hub": "H", "codex-nanoleaf": "N", "divoom-app-upgrade": "P"}[repo]][1]} {revision[:8]}' for repo, revision in AD.pins(diagram).items() if repo in cited)
    viewer = f"architecture/{diagram['id']}.html"
    future = diagram['status'] == 'future'
    marker = ' <span class="index-future">future</span>' if future else ''
    diagram_index.append(f'<a href="#{diagram["id"]}">{code} · {html.escape(diagram["short"])}{marker}</a>')
    # Sequence walkthroughs: one entry per diagram segment, in order, as in the B.U.N.N.Y. atlas.
    walk = ''
    if diagram['kind'] == 'sequence':
        segments = diagram['spec']['segments']
        assert len(diagram['phases']) == len(segments), f"Walkthrough phases must match the segments of {diagram['id']}"
        steps = []
        for segment, phase in zip(segments, diagram['phases']):
            alternative = not segment['label'][:1].isdigit()
            phase_sources = ' '.join(f'<a href="{html.escape(AD.src(repo, path, AD.pins(diagram)), quote=True)}" target="_blank" rel="noopener noreferrer">{html.escape(path)}<span aria-hidden="true" class="external">↗</span></a>' for repo, path in phase['sources'])
            steps.append(f'<li class="walk-step{" walk-alt" if alternative else ""}"><h5>{html.escape(segment["label"])}</h5><p>{render(phase["text"])}</p><p class="walk-sources"><span>Sources:</span> {phase_sources}</p></li>')
        walk = f'<div class="diagram-walk"><h4>Walk through it</h4><ol>{"".join(steps)}</ol></div>'
    (future_figures if future else figures).append(f'''<figure class="diagram" id="{diagram['id']}" data-kind="{diagram['kind']}" data-status="{diagram['status']}" data-code="{code}">
      <figcaption><div class="diagram-head"><span class="diagram-number" aria-hidden="true">{code}</span><div class="diagram-heading"><span class="status status-{diagram['status']}">{html.escape(diagram['status_label'])}</span><h3>{html.escape(diagram['spec']['meta']['title'])}</h3></div></div>
      <p class="diagram-summary">{html.escape(diagram['summary'])}</p></figcaption>
      <div class="diagram-tools" role="group" aria-label="Controls for diagram {code}"><button type="button" class="zoom-out" aria-label="Zoom out">−</button><button type="button" class="zoom-fit">Fit</button><button type="button" class="zoom-in" aria-label="Zoom in">+</button><span class="zoom-level" aria-live="polite">100%</span><button type="button" class="viewer-toggle" aria-expanded="false" data-src="{viewer}" data-title="Interactive Archify viewer for {html.escape(diagram['spec']['meta']['title'], quote=True)}">Explore inline</button><a class="viewer-link" href="{viewer}" target="_blank" rel="noopener noreferrer">Open interactive viewer <span aria-hidden="true" class="external">↗</span></a></div>
      <div class="diagram-stage" tabindex="0" aria-label="Scrollable diagram {code}: {html.escape(diagram['spec']['meta']['title'], quote=True)}"><div class="diagram-canvas">{svg}</div></div>
      <div class="viewer-frame" hidden></div>
      <div class="diagram-text"><div><h4>How to read it</h4><ul>{reading}</ul></div><div><h4>Boundaries and evidence</h4><ul>{boundaries}</ul></div>{walk}
      <p class="diagram-sources"><span>Pinned sources ({html.escape(pinned)}):</span> {sources}</p><p class="diagram-issues"><span>Related issues (reference only, not counted):</span> {issues}</p></div></figure>''')

assert [d['status'] == 'future' for d in AD.DIAGRAMS] == sorted(d['status'] == 'future' for d in AD.DIAGRAMS), 'List future diagrams last'
architecture_section = f'''<details class="reference" id="architecture" data-diagrams="{len(AD.DIAGRAMS)}" open>
      <summary><span class="guide-number">A</span><span class="guide-heading"><span class="eyebrow">Reference · not a work guide</span><h2>Architecture and sequence diagrams</h2></span><span class="guide-count">{len(AD.DIAGRAMS)} diagrams</span><span class="chevron" aria-hidden="true">−</span></summary>
      <div class="guide-body"><p class="intro">Three system diagrams and six sequence diagrams show what runs where, who owns state and who writes to each device. Start with the system map (A2) and the agent observation walkthrough (S4); the B.U.N.N.Y. design atlas embeds these same two definitions, which keep their hub main 5db67a09 pins. The other seven views were revised on 23 September 2026 under {render("[[H173]]")} against Hub d8527cd3, Nanoleaf cbb94851 and Pixoo c81bc31c, following the same pattern: dashed boxes are processes, devices sit outside them, and each sequence keeps a short numbered main path with alternatives in separate lanes and a walkthrough below. On 24 September 2026 the Nanoleaf runtime view (A3) was updated with installed evidence from {render("[[N46]]")} and {render("[[N89]]")} without moving its pins. The system map keeps its earlier pin: since then, Tidbyt agent status is installed ({render("[[H21]]")}), the Tidbyt and LIFX local controller host is installed ({render("[[H289]]")}), shared playback with the Sony source is installed ({render("[[H175]]")}) and now-playing is installed ({render("[[H37]]")}, {render("[[H38]]")}). The viewers\' text still names container hosting on the PC and retained Windows installations; ADR 0008 folded that hosting into the dedicated server ({render("[[H44]]")}) and the Windows runtime is decommissioned, so read those labels as history until the next re-render. A2 does not draw these yet, and its evidence notes, including “the hub itself is source only”, predate them; the standalone hub now runs as an installed service. Current, historical and planned behavior are labelled separately: the Nanoleaf views show the installed Linux runtime ({render("[[N55]]")}) and name the retired Windows route as historical, and the two future scenarios sit behind a marked, collapsed group. Each figure lists the revisions its sources are pinned to. The baseline review time is <time datetime="{html.escape(AD.SOURCES['reviewedAt'])}">@@REVIEW_TIMESTAMP@@</time>. Repository history was read separately at @@HISTORY_TIMESTAMP@@; its main revisions may be newer than the architecture review. Diagram links repeat issues that already belong to a work guide; they add nothing to the issue totals, and their status badges start from the dated backlog snapshot and update from public GitHub when the page opens. Each figure has zoom and fit controls, a scrollable stage, a text explanation and a link to the full interactive Archify viewer shipped beside this file in the architecture folder. Those viewers are Archify's own HTML: they reference one Google Fonts stylesheet and fall back to system fonts when offline.</p>
      <div class="status-legend" aria-label="Status key"><span class="status status-implemented">Implemented source</span><span class="status status-planned">Planned composition</span><span class="status status-future">Future work</span><span class="status-note">Implemented means reviewed source at the pinned revision. It is not installed-client, transport or physical evidence.</span></div>
      <nav class="diagram-index" aria-label="Diagrams">{''.join(diagram_index)}</nav>
      {''.join(figures)}
      <details class="future-scenarios" id="future-scenarios"><summary><span class="status status-future">Future work</span> Future scenarios, not implemented <span class="future-count">{len(future_figures)} diagrams</span></summary>
      <p class="future-note">These sequences describe planned behavior from the owning design documents. Nothing in them is implemented or installed; open them to review the intended ordering and boundaries.</p>
      {''.join(future_figures)}</details>
      <a class="back-top" href="#top">Back to overview <span aria-hidden="true">↑</span></a></div></details>'''

# --- Timeline: where we've been, where we're going --------------------------
totals = TIMELINE['totals']
timeline_section = f'''<details class="reference timeline" id="timeline">
      <summary><span class="guide-number">T</span><span class="guide-heading"><span class="eyebrow">Map · where we've been and where we're going</span><h2>Delivery history and ordered roadmap</h2></span><span class="guide-count">{totals['merged']} merged</span><span class="chevron" aria-hidden="true">−</span></summary>
      <div class="guide-body">
      <div class="chips" role="group" aria-label="Highlight a repository"><button type="button" class="repo-chip" data-repo="all" aria-pressed="true">All</button><button type="button" class="repo-chip repo-H" data-repo="H" aria-pressed="false">Hub</button><button type="button" class="repo-chip repo-N" data-repo="N" aria-pressed="false">Nanoleaf</button><button type="button" class="repo-chip repo-P" data-repo="P" aria-pressed="false">Pixoo</button></div>
      <div class="timeline-grid">
      <section class="timeline-panel" aria-labelledby="history-heading"><div class="panel-head"><h3 id="history-heading">Where we've been</h3><span class="eyebrow">Dated · merged pull requests on main</span></div>
      <div class="stats-row" aria-label="History totals"><div class="stat"><strong>{totals['merged']}</strong><span>MERGED PRS</span></div><div class="stat"><strong>{totals['closed']}</strong><span>CLOSED ISSUES</span></div><div class="stat"><strong>{totals['commits']}</strong><span>MAIN COMMITS</span></div></div>
      <div class="chart-wrap">{TIMELINE['history']}</div>
      <div class="chart-legend"><span class="legend-pr">● merged PR (hover or focus for the title; click opens GitHub)</span><span class="legend-milestone">◎ named delivery baseline</span><span class="legend-snapshot">┆ backlog snapshot</span></div>
      <p class="timeline-note">History read from GitHub at <time datetime="{html.escape(HISTORY['fetchedAt'])}">@@HISTORY_TIMESTAMP@@</time>: pull requests merged to main and issues closed since each repository was created. Local time is America/New_York. Merged means reviewed source on main; installed-client, transport and physical evidence are recorded separately in the guides. Ringed marks are named delivery baselines; where captions would overlap, the name is in the mark’s tooltip.</p></section>
      <section class="timeline-panel" aria-labelledby="roadmap-heading"><div class="panel-head"><h3 id="roadmap-heading">Where we're going</h3><span class="eyebrow">Ordered · not dated</span></div>
      <div class="chart-wrap roadmap-wrap">{TIMELINE['roadmap']}</div>
      <div class="chart-legend"><span class="legend-same">── order within a track</span><span class="legend-cross">┄┄ cross-track prerequisite (hover a node to highlight)</span><span class="legend-ready">▣ stages link to their guides</span></div>
      <p class="timeline-note">Every one of the {TOTAL} open issues appears exactly once on this map, in its primary guide's track. Columns show relative order within each track. Arrows identify sequence and cross-track prerequisites; sharing a column does not make an independent track wait for the Codex milestone. Columns are not dates and imply no schedule or readiness. Connections retain delivered inputs for context; completed inputs add no wait. Use issue-link status and next-step gates to select work. Click a node to open its work guide.</p></section>
      </div><div id="timeline-tip" class="timeline-tip" role="status" hidden></div>
      <a class="back-top" href="#top">Back to overview <span aria-hidden="true">↑</span></a></div></details>'''

direction_section = GDIR.render(ISSUES, LEVERAGE, issue_link, lambda key: GS.scheduling_state(ISSUES[key], DEPENDENCIES.get(key, [])),
                                DECISIONS, OWNER_LATER, REFRESHED.strftime('%-d %B %Y'), IDEA_KEYS)
ideas_section = GI.render(IDEAS, ISSUES, [(topic, title) for topic, title, *_ in TOPICS], issue_link,
                          lambda key: GS.scheduling_state(ISSUES[key], DEPENDENCIES.get(key, [])), REFRESHED.strftime('%-d %B %Y'))

CSS = '''
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:90px}body{margin:0;background:var(--bg);color:var(--text);font:var(--type-body)/1.65 var(--font);background-image:var(--grid-image);background-size:var(--grid-size)}a{color:var(--link);text-underline-offset:4px}button,input{font:inherit}button{cursor:pointer}::selection{background:var(--accent);color:var(--accent-ink)}:focus-visible{outline:2px solid var(--focus);outline-offset:5px}button,a,summary{touch-action:manipulation}button{color:var(--text);border:1px solid var(--edge);background:color-mix(in srgb,var(--accent) 4%,transparent);border-radius:var(--radius);padding:9px 14px;font:var(--type-small) var(--mono);min-height:40px}button:hover{background:var(--raised);border-color:var(--accent)}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.skip{position:fixed;left:12px;top:-100px;z-index:100;padding:12px;background:var(--accent);color:var(--accent-ink)}.skip:focus{top:12px}[hidden]{display:none!important}
.shell{max-width:1660px;margin:auto;display:grid;grid-template-columns:258px minmax(0,1fr);min-height:100vh}.sidebar{height:100dvh;position:sticky;top:0;padding:35px 20px 22px 26px;border-right:1px solid var(--edge);background:var(--panel-translucent);display:flex;flex-direction:column;overflow:auto}.brand{display:flex;align-items:center;gap:12px;text-decoration:none;color:var(--text);font:600 13px/1.3 var(--mono);letter-spacing:.08em}.brand svg{width:35px;height:38px;color:var(--accent);flex-shrink:0}.brand small{display:block;color:var(--muted);font:10px var(--mono);letter-spacing:.13em;margin-top:5px}.sidebar-rule{height:1px;background:linear-gradient(90deg,var(--accent),transparent);margin:31px 0 28px}.eyebrow{font:11px/1.5 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}.nav-title{margin-bottom:16px;color:var(--accent)}nav{display:grid;gap:5px}nav a{display:grid;grid-template-columns:22px 1fr 20px;gap:8px;align-items:center;padding:11px 8px;border:1px solid transparent;text-decoration:none;color:var(--muted);font-size:12px;line-height:1.45;min-height:46px}nav a:hover,nav a[aria-current="location"]{color:var(--text);background:var(--raised);border-color:var(--edge)}nav a[aria-current="location"]{box-shadow:inset 2px 0 var(--accent)}.nav-number{font:11px var(--mono);color:var(--accent)}.nav-count{font:10px var(--mono);color:var(--muted);opacity:.85;text-align:right}.sidebar-foot{margin-top:auto;padding-top:32px;color:var(--muted);font:10px/1.8 var(--mono)}.sidebar-foot span{display:block}.snapshot-dot{display:inline-block;width:5px;height:5px;background:var(--pending);margin-right:6px}
main{min-width:0;padding:0 52px 38px}.topbar{min-height:73px;border-bottom:1px solid var(--edge);display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px 20px}.topbar-tools{display:flex;align-items:center;flex-wrap:wrap;gap:8px 10px}.topbar button{min-height:32px;padding:5px 10px;font-size:11px}.topbar button[aria-pressed="true"]{border-color:var(--accent);background:var(--raised)}.breadcrumb{font:11px var(--mono);letter-spacing:.06em;color:var(--muted)}.breadcrumb span{color:var(--accent)}.topbar .date{font:10px var(--mono);letter-spacing:.08em;color:var(--muted)}.hero{position:relative;overflow:hidden;padding:53px 0 32px;isolation:isolate}.hero .eyebrow{color:var(--accent)}h1{font-size:clamp(38px,4.8vw,67px);font-weight:600;line-height:1.07;letter-spacing:-.04em;margin:16px 0 20px;max-width:720px}h1 span{color:var(--accent)}.hero-copy{color:var(--muted);max-width:600px;margin:0;font-size:16px;line-height:1.75}.hero-art{position:absolute;width:240px;height:210px;right:3px;top:49px;opacity:.8;z-index:-1}.stats{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid var(--edge);margin:29px 0 0;max-width:710px;background:var(--panel-translucent)}.stat{padding:18px 23px}.stat+.stat{border-left:1px solid var(--edge)}.stat strong{display:block;font:400 34px/1.15 var(--mono);color:var(--text);letter-spacing:-.07em}.stat span{display:block;margin-top:7px;color:var(--muted);font:10px var(--mono);letter-spacing:.1em}.repo-legend{display:flex;gap:20px;flex-wrap:wrap;margin:20px 0 0;font:11px var(--mono);color:var(--muted)}.repo-legend b{font-weight:500}.repo-H{--repo:var(--repo-hub)}.repo-N{--repo:var(--repo-nanoleaf)}.repo-P{--repo:var(--repo-pixoo)}.repo-legend a{color:var(--repo);text-decoration:none}.repo-legend a::before{content:"";display:inline-block;width:6px;height:6px;background:var(--repo);margin-right:7px}
.overview{margin:8px 0 27px;padding:23px 24px;border:1px solid var(--edge);border-left:2px solid var(--accent);background:linear-gradient(105deg,var(--raised),transparent 75%)}.overview p{font-size:13px;color:var(--muted);margin:12px 0 0;max-width:850px}.path{display:flex;align-items:center;gap:9px 13px;flex-wrap:wrap;margin-top:13px}.path a{text-decoration:none;font-size:13px;color:var(--text);border-bottom:1px solid var(--edge-strong)}.path a:hover{color:var(--accent)}.path .arrow{color:var(--accent);font:14px var(--mono)}.document-note{font:12px/1.8 var(--font);color:var(--muted);margin:0 0 28px;max-width:950px}.document-note strong{color:var(--text);font-weight:500}.toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:14px 0;border-top:1px solid var(--edge);border-bottom:1px solid var(--edge);margin-bottom:12px;background:var(--bg)}.search-wrap{flex:1;min-width:215px;position:relative}.search-wrap svg{position:absolute;left:13px;top:13px;width:15px;height:15px;color:var(--accent)}input[type=search]{appearance:none;width:100%;min-height:42px;border:1px solid var(--edge);border-radius:var(--radius);background:var(--panel);color:var(--text);padding:10px 12px 10px 38px;font:var(--type-small) var(--font)}input::placeholder{color:var(--muted)}.search-meta{display:flex;align-items:center;justify-content:space-between;gap:10px;font:11px var(--mono);color:var(--muted);padding:7px 0 17px}.search-meta a{font-size:11px}.empty-state{padding:50px 24px;border:1px dashed var(--edge);text-align:center}.empty-state h2{font-size:20px}.empty-state p{color:var(--muted)}
.guide{position:relative;border:1px solid var(--edge);background:var(--panel-translucent);margin:0 0 23px;scroll-margin-top:22px}.guide summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:18px;padding:24px 25px}.guide summary::-webkit-details-marker{display:none}.guide summary:hover{background:color-mix(in srgb,var(--raised) 40%,transparent)}.guide-number{color:var(--accent);font:400 25px/1 var(--mono);letter-spacing:-.09em;min-width:31px}.guide-heading{flex:1;min-width:0}.guide-heading .eyebrow{font-size:9px;letter-spacing:.12em;color:var(--pending)}h2{font-size:19px;line-height:1.4;font-weight:500;letter-spacing:-.01em;margin:4px 0 0}.guide-count{font:10px var(--mono);white-space:nowrap;color:var(--muted);padding:5px 7px;border:1px solid var(--edge-faint)}.chevron{font:20px var(--mono);color:var(--accent);min-width:12px}.guide:not([open]) .chevron{font-size:0}.guide:not([open]) .chevron::after{content:"+";font-size:20px}.guide-body{padding:0 25px 22px}.intro{margin:0 0 19px;color:var(--muted);font-size:14px;line-height:1.85}.issue{display:inline-flex;gap:6px;align-items:center;white-space:nowrap;border:1px solid color-mix(in srgb,var(--repo) 27%,transparent);background:color-mix(in srgb,var(--repo) 5%,transparent);color:var(--repo);padding:4px 7px;margin:3px 4px 3px 0;border-radius:var(--radius);text-decoration:none;font:11px/1.5 var(--mono);vertical-align:middle}.issue:hover{border-color:var(--repo);background:color-mix(in srgb,var(--repo) 12%,transparent);box-shadow:0 0 12px color-mix(in srgb,var(--repo) 9%,transparent)}.issue .sr-only{font-size:0}.intro .issue,.guide-notes .issue,.recommendation .issue{font-size:11px;padding:1px 6px;line-height:1.5}.guide table{width:100%;border-collapse:collapse;font-size:12px;line-height:1.75;table-layout:fixed}th{font:10px/1.5 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);text-align:left;padding:11px 12px;background:color-mix(in srgb,var(--raised) 50%,transparent);border-top:1px solid var(--edge);border-bottom:1px solid var(--edge)}th:nth-child(1){width:25%}th:nth-child(2){width:28%}th:nth-child(3){width:47%}td{padding:13px 12px;vertical-align:top;border-bottom:1px solid var(--edge-faint);color:var(--muted);overflow-wrap:anywhere}td:first-child{color:var(--text);font-weight:500}tbody tr:hover{background:color-mix(in srgb,var(--raised) 40%,transparent)}.guide-notes{margin-top:18px;padding-left:15px;border-left:1px solid color-mix(in srgb,var(--pending) 38%,transparent)}.guide-notes p{color:var(--muted);font-size:12px;line-height:1.9;margin:9px 0}.guide-notes strong{color:var(--text);font-weight:500}.back-top{display:inline-block;margin-top:15px;font:10px var(--mono);letter-spacing:.04em;color:var(--muted);text-decoration:none}.back-top:hover{color:var(--accent)}.back-top span{color:var(--accent);margin-left:5px}
.recommendation{position:relative;padding:27px;margin:38px 0 27px;border:1px solid color-mix(in srgb,var(--pending) 33%,transparent);background:linear-gradient(110deg,color-mix(in srgb,var(--pending) 4%,transparent),transparent 75%)}.recommendation .eyebrow{color:var(--pending)}.recommendation h2{font-size:24px;margin:7px 0 12px}.recommendation p{max-width:890px;font-size:14px;color:var(--muted);line-height:1.9;margin:10px 0}.recommendation strong{color:var(--text);font-weight:500}.footer{display:flex;align-items:flex-start;justify-content:space-between;gap:25px;border-top:1px solid var(--edge);padding-top:22px;font:10px/1.8 var(--mono);color:var(--muted)}.footer p{margin:0;max-width:720px}.footer a{white-space:nowrap;text-decoration:none}.print-only{display:none}
@media(min-width:1500px){main{padding-left:64px;padding-right:64px}.guide table{font-size:13px}.issue{font-size:12px}.hero-art{right:24px}}@media(max-width:1240px){.hero-art{opacity:.3;right:-70px}.shell{grid-template-columns:228px minmax(0,1fr)}.sidebar{padding-left:18px;padding-right:14px}main{padding:0 30px 30px}.guide summary{padding:20px;gap:13px}.guide-body{padding:0 20px 20px}.guide-count{display:none}.guide table{font-size:12px}th:nth-child(1){width:24%}th:nth-child(2){width:30%}th:nth-child(3){width:46%}}
@media(max-width:900px){.shell{display:block}.sidebar{height:auto;position:relative;padding:20px 24px;border-right:0;border-bottom:1px solid var(--edge);display:block;overflow:visible}.brand svg{width:26px;height:29px}.brand small{display:none}.sidebar-rule,.sidebar-foot,.nav-title{display:none}nav{display:flex;overflow-x:auto;gap:7px;padding:17px 1px 2px;margin-right:-5px;scrollbar-width:thin}nav a{display:flex;flex-shrink:0;border-color:var(--edge);min-height:38px;padding:8px 10px;font-size:11px}nav .nav-count{display:none}.topbar{min-height:62px}.hero{padding-top:33px}.hero-art{right:0;opacity:.35}.hero-copy{max-width:580px}.stats{max-width:none}main{padding:0 25px 30px}.guide{scroll-margin-top:15px}.guide summary{padding:22px}.guide-count{display:inline-block}.guide-heading h2{font-size:19px}}
@media(max-width:600px){body{font-size:14px}.sidebar{padding:18px 17px}main{padding:0 17px 28px}.topbar{min-height:57px;padding:10px 0}.breadcrumb{font-size:10px}.topbar .date{font-size:9px}.hero{padding:33px 0 27px}.hero .eyebrow{font-size:9px}.hero-art{width:200px;height:185px;right:-80px;top:40px;opacity:.21}h1{font-size:42px}.hero-copy{font-size:14px}.stats{margin-top:24px}.stat{padding:16px 12px}.stat strong{font-size:29px}.stat span{font-size:8px;letter-spacing:.06em}.repo-legend{gap:12px;font-size:10px}.overview{padding:19px 17px;margin-top:4px}.overview .eyebrow{font-size:10px}.path{gap:8px}.path a{font-size:12px}.overview p{font-size:12px}.document-note{font-size:11px;line-height:1.9}.toolbar{gap:8px}.search-wrap{flex-basis:100%}.toolbar button{flex:1;font-size:10px;padding:8px 7px}.search-meta{font-size:9px;align-items:flex-start}.guide summary{align-items:flex-start;padding:21px 16px;gap:12px}.guide-number{font-size:22px;padding-top:4px;min-width:25px}.guide-heading h2{font-size:17px}.guide-heading .eyebrow{font-size:8px}.guide-count{display:none}.guide-body{padding:0 16px 20px}.intro{font-size:13px}.guide table,.guide tbody,.guide tr,.guide td{display:block;width:100%}.guide thead{display:none}.guide tr{padding:13px 0 14px;border-top:1px solid var(--edge)}.guide td{border:0;padding:4px 0}.guide td:first-child{font-size:13px;font-weight:600}.guide td:nth-child(2){padding-bottom:5px}.guide td:last-child{font-size:12px}.guide-notes{margin-top:15px;padding-left:12px}.recommendation{padding:22px 18px;margin-top:30px}.recommendation h2{font-size:22px}.recommendation p{font-size:13px}.footer{display:block;font-size:9px}.footer a{display:inline-block;margin-top:14px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{animation:none!important;transition:none!important}}
/* Reference sections (timeline, architecture) share the guide frame but are not counted work guides. */
.nav-rule{height:1px;background:linear-gradient(90deg,var(--edge),transparent);margin:8px 0 4px}nav a[data-section] .nav-number{color:var(--pending)}
.reference .guide-heading .eyebrow{color:var(--accent)}.reference .guide-number{color:var(--pending)}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 16px}.repo-chip{padding:6px 12px;min-height:34px;font-size:11px}.repo-chip[aria-pressed="true"]{border-color:var(--repo,var(--accent));background:color-mix(in srgb,var(--repo,var(--accent)) 14%,transparent);color:var(--text)}
.timeline-grid{display:grid;gap:26px;min-width:0}.timeline-panel,.reference .guide-body,.diagram,.diagram-text>*{min-width:0}.panel-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin:0 0 10px}.panel-head h3{font-size:16px;font-weight:500;margin:0}.panel-head .eyebrow{font-size:9px}
.stats-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border:1px solid var(--edge);margin:0 0 12px;max-width:520px;background:var(--panel-translucent)}.stats-row .stat{padding:12px 16px;min-width:0}.stats-row .stat strong{font-size:24px}.stats-row .stat span{font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.history .leader{stroke:var(--muted);stroke-width:.8;opacity:.7}
.chart-wrap{overflow-x:auto;border:1px solid var(--edge);background:var(--inset);padding:10px;scrollbar-width:thin}.chart-wrap svg{display:block;width:100%;min-width:640px;height:auto;font-family:var(--mono)}.roadmap-wrap svg{min-width:960px}
.history .tick{stroke:var(--edge-faint)}.history .tick.major{stroke:var(--edge)}.history .tick-label{fill:var(--muted);font-size:10px}.history .row-line{stroke:var(--edge-faint)}.history .row-label{font-size:12px;fill:var(--repo);font-weight:600}.history .row-meta{font-size:9px;fill:var(--muted)}
.history .repo-start line{stroke:var(--muted);stroke-dasharray:2 3}.history .repo-start text{font-size:8px;fill:var(--muted)}.history .snapshot-line{stroke:var(--pending);stroke-dasharray:4 4}.history .snapshot-label{font-size:9px;fill:var(--pending)}
.history .pr circle{fill:var(--repo);fill-opacity:.9;stroke:var(--inset);stroke-width:2;transition:r .12s}.history .pr.milestone circle{fill:var(--inset);stroke:var(--repo);stroke-width:2.5}.history .pr:hover circle,.history .pr:focus circle{r:9}.history .pr:focus{outline:none}.history .milestone-label{font-size:8.5px;fill:var(--text)}
.roadmap .slot{fill:transparent}.roadmap .slot.even{fill:color-mix(in srgb,var(--raised) 40%,transparent)}.roadmap .slot-label{font-size:9.5px;fill:var(--muted);letter-spacing:.06em;text-transform:uppercase}.roadmap .track-label{font-size:11px;fill:var(--muted)}.roadmap .track-label.main{fill:var(--accent)}
.roadmap .edge{stroke:color-mix(in srgb,var(--muted) 40%,transparent);fill:none;stroke-width:1.4}.roadmap .edge.cross{stroke:color-mix(in srgb,var(--pending) 40%,transparent);stroke-dasharray:5 4}.roadmap .edge.lit{stroke:var(--accent);stroke-width:2.4;stroke-dasharray:none}.roadmap marker path{fill:color-mix(in srgb,var(--muted) 60%,transparent)}
.roadmap .node rect{fill:var(--inset);stroke:color-mix(in srgb,var(--muted) 33%,transparent);stroke-width:1}.roadmap .node.main rect{stroke:var(--accent);stroke-width:1.4}.roadmap .node.ready rect{fill:var(--raised);stroke:var(--accent);stroke-width:1.6}.roadmap .node:hover rect,.roadmap .node:focus rect{stroke:var(--text);filter:drop-shadow(var(--glow))}.roadmap .node:focus{outline:none}
.roadmap .node-label{font-size:11px;fill:var(--text);font-weight:500}.roadmap .node-meta{font-size:8.5px;fill:var(--muted)}.timeline .dim{opacity:.16}
.timeline-tip{position:absolute;z-index:5;transform:translate(-50%,-100%);max-width:340px;background:var(--panel);border:1px solid var(--accent);padding:8px 11px;font:11px/1.55 var(--font);color:var(--text);pointer-events:none;box-shadow:var(--glow)}.timeline-tip strong{display:block;color:var(--accent)}.timeline-tip span,.timeline-tip em{display:block;color:var(--muted);font-style:normal}
.chart-legend{display:flex;gap:18px;flex-wrap:wrap;font:10px var(--mono);color:var(--muted);margin:8px 0 0}.timeline-note{font-size:12px;color:var(--muted);margin:10px 0 0;line-height:1.85}.timeline .guide-body{position:relative}
.status-legend{display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin:0 0 16px;font:10px var(--mono);color:var(--muted)}.status-note{flex-basis:100%;font:11px var(--font);color:var(--muted)}.status{font:10px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}.status::before{content:"";display:inline-block;width:8px;height:8px;margin-right:7px;vertical-align:1px}.status-implemented::before{background:var(--status-delivered)}.status-planned::before{background:var(--status-planned)}.status-future::before{background:var(--pending)}
.diagram-index{display:flex;flex-wrap:wrap;gap:6px 16px;margin:0 0 22px;font-size:12px}.diagram-index a{text-decoration:none;border-bottom:1px solid var(--edge-strong)}.diagram-index a:hover{color:var(--text)}
.diagram{margin:0 0 34px;padding:20px 0 0;border-top:1px solid var(--edge)}.diagram-head{display:flex;gap:14px;align-items:flex-start}.diagram-number{font:400 20px/1 var(--mono);color:var(--pending);min-width:36px;padding-top:5px}.diagram h3{font-size:17px;font-weight:500;margin:3px 0 0;line-height:1.4}.diagram-summary{color:var(--muted);font-size:13px;line-height:1.8;margin:10px 0 12px;max-width:900px}
.diagram-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 8px}.diagram-tools button{min-height:34px;padding:6px 12px}.zoom-level{font:11px var(--mono);color:var(--muted);min-width:44px}.viewer-link{font:11px var(--mono);margin-left:auto;text-decoration:none;border-bottom:1px solid var(--edge-strong)}
.diagram-stage{overflow:auto;max-height:700px;border:1px solid var(--edge);background:var(--inset);cursor:grab;scrollbar-width:thin}.diagram-stage.dragging{cursor:grabbing;user-select:none}.diagram-stage:focus-visible{outline-offset:-2px}.diagram-canvas{min-width:100%}.diagram-canvas>svg{display:block;width:100%;height:auto;font-family:var(--font)}
.viewer-frame iframe{width:100%;height:640px;border:1px solid var(--edge);background:var(--inset);margin-top:8px}
.diagram-text{margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:16px 24px}.diagram-text h4{font:10px var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--accent);margin:0 0 7px}.diagram-text ul{margin:0;padding-left:18px;font-size:12px;line-height:1.75;color:var(--muted)}.diagram-text li{margin:0 0 6px}
.diagram-walk{grid-column:1/-1}.diagram-walk ol{list-style:none;margin:0;padding:0;display:grid;gap:8px;counter-reset:walk}.walk-step{border:1px solid var(--edge);border-left:3px solid var(--accent);padding:9px 12px;background:var(--inset)}.walk-step.walk-alt{border-left-style:dashed;border-left-color:var(--walk-alt)}.walk-step h5{margin:0 0 3px;font:600 12px/1.4 var(--font);color:var(--text)}.walk-step p{margin:0;font-size:12px;line-height:1.7;color:var(--muted)}.walk-step .walk-sources{font:10px/1.9 var(--mono);color:var(--muted)}.walk-sources a{margin-right:10px;text-decoration:none;border-bottom:1px solid var(--edge-strong)}
.future-scenarios{margin:8px 0 26px;border:1px dashed var(--edge);padding:0 16px}.future-scenarios>summary{cursor:pointer;padding:14px 0;font:600 14px/1.4 var(--font);color:var(--text);display:flex;gap:10px;align-items:center;flex-wrap:wrap}.future-count{font:10px var(--mono);color:var(--muted)}.future-note{font-size:12px;color:var(--muted);margin:0 0 14px}.index-future{font:9px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);border:1px solid var(--edge);padding:0 4px;margin-left:4px}
.diagram-sources,.diagram-issues{grid-column:1/-1;font:11px/2.1 var(--mono);color:var(--muted);margin:0}.diagram-sources a{margin-right:12px;text-decoration:none;border-bottom:1px solid var(--edge-strong)}.diagram-sources span,.diagram-issues span{color:var(--text);margin-right:8px}
@media(max-width:900px){.diagram-canvas>svg{min-width:760px}.diagram-text{grid-template-columns:1fr}.diagram-stage{max-height:480px}.stats-row{max-width:none}.viewer-frame iframe{height:480px}.repo-chip{flex:1}}
@media(max-width:600px){.stats-row .stat span{white-space:normal;font-size:8px}.diagram-head{gap:10px}.diagram-number{font-size:16px;min-width:28px}.diagram h3{font-size:15px}.diagram-tools button{padding:6px 9px}.viewer-link{margin-left:0;flex-basis:100%}.timeline-tip{max-width:240px}.chart-wrap{padding:6px}}
@media print{.reference,.reference[hidden]{display:block!important;background:var(--panel);border:1px solid var(--edge);margin:0 0 19px;overflow:visible}.reference summary{display:flex;padding:15px 16px;break-after:avoid;cursor:default}.reference .guide-number{color:var(--pending)}.chips,.timeline-tip,.diagram-tools,.viewer-frame,.chart-legend .legend-pr{display:none!important}
.diagram{break-inside:avoid;border-color:var(--edge)}.diagram-stage{max-height:none;overflow:visible;border:1px solid var(--edge);background:var(--inset);cursor:default}.diagram-canvas>svg{width:100%!important;min-width:0!important;max-height:165mm}.diagram h3,.diagram-text ul,.diagram-sources span,.diagram-issues span{color:var(--text)}.diagram-number{color:var(--pending)}.diagram-summary,.diagram-text ul,.diagram-sources,.diagram-issues,.timeline-note,.chart-legend,.status,.status-legend{color:var(--muted)}.diagram-text h4{color:var(--accent)}.diagram-sources a,.walk-sources a{color:var(--link);border:0}.walk-step{background:var(--panel);border-color:var(--edge);break-inside:avoid}.walk-step h5{color:var(--text)}.walk-step p{color:var(--muted)}.future-scenarios{border-color:var(--edge)}.future-scenarios>summary{color:var(--text)}
.chart-wrap{overflow:visible;border-color:var(--edge);background:var(--inset);break-inside:avoid}.chart-wrap svg{min-width:0}.stats-row{background:transparent;border-color:var(--edge)}.stats-row .stat strong{color:var(--text)}.stats-row .stat span{color:var(--muted)}
.history .tick{stroke:var(--edge-faint)}.history .tick.major{stroke:var(--edge-strong)}.history .tick-label,.history .row-meta,.history .repo-start text{fill:var(--muted)}.history .row-line{stroke:var(--edge)}.history .pr circle{stroke:var(--inset)}.history .pr.milestone circle{fill:var(--inset)}.history .milestone-label{fill:var(--text)}.history .snapshot-line{stroke:var(--pending)}.history .snapshot-label{fill:var(--pending)}.history .row-label{fill:var(--text)}
.roadmap .slot.even{fill:var(--raised)}.roadmap .slot-label,.roadmap .track-label,.roadmap .node-meta{fill:var(--muted)}.roadmap .track-label.main{fill:var(--accent)}.roadmap .edge{stroke:var(--edge-strong)}.roadmap .edge.cross{stroke:var(--pending)}.roadmap marker path{fill:var(--edge-strong)}.roadmap .node rect{fill:var(--panel);stroke:var(--edge-strong)}.roadmap .node.main rect,.roadmap .node.ready rect{stroke:var(--accent)}.roadmap .node.ready rect{fill:var(--raised)}.roadmap .node-label{fill:var(--text)}.timeline .dim{opacity:1}}
'''
# Archify's SVG classes, scoped to the embedded canvases. The skin maps their text, grid
# and mask to page tokens; Archify's category palette follows the page theme.
def scope(selector):
    return ', '.join(f'.diagram-canvas {part.strip()}' for part in selector.split(','))
ARCHIFY_CSS = ''.join(f'{scope(selector)}{{{body}}}' for selector, body in ARCHIFY_CLASSES['rules'].items())
CSS += ARCHIFY_CSS + SKIN.archify_variables(ARCHIFY_CLASSES, '.diagram-canvas') + '\n'


def rewrite(css, *pairs):
    """Apply selector rewrites; each target must still exist, so a CSS edit cannot silently skip one."""
    for old, new in pairs:
        assert old in css, f'Stylesheet rewrite target missing: {old}'
        css = css.replace(old, new)
    return css


# Reference sections share the work-guide frame.
CSS = rewrite(CSS, ('.guide{position:relative;', '.guide,.reference{position:relative;'), ('.guide summary{list-style', '.guide summary,.reference summary{list-style'),
              ('.guide summary::-webkit-details-marker{', '.guide summary::-webkit-details-marker,.reference summary::-webkit-details-marker{'), ('.guide summary:hover{', '.guide summary:hover,.reference summary:hover{'),
              ('.guide:not([open]) .chevron{', '.guide:not([open]) .chevron,.reference:not([open]) .chevron{'), ('.guide:not([open]) .chevron::after{', '.guide:not([open]) .chevron::after,.reference:not([open]) .chevron::after{'))
CSS = rewrite(CSS, ('@media(max-width:1240px){.hero-art{opacity:.3;right:-70px}.shell{grid-template-columns:228px minmax(0,1fr)}.sidebar{padding-left:18px;padding-right:14px}main{padding:0 30px 30px}.guide summary{', '@media(max-width:1240px){.hero-art{opacity:.3;right:-70px}.shell{grid-template-columns:228px minmax(0,1fr)}.sidebar{padding-left:18px;padding-right:14px}main{padding:0 30px 30px}.guide summary,.reference summary{'),
              ('.guide{scroll-margin-top:15px}.guide summary{padding:22px}', '.guide,.reference{scroll-margin-top:15px}.guide summary,.reference summary{padding:22px}'),
              ('.guide summary{align-items:flex-start;padding:21px 16px;gap:12px}', '.guide summary,.reference summary{align-items:flex-start;padding:21px 16px;gap:12px}'))
assert CSS.count('.reference summary') >= 5, 'Reference selectors missing'
CSS += '''
@media print{@page{size:A4;margin:16mm}html{scroll-behavior:auto}body{background:var(--bg)!important;color:var(--text)!important;font:10pt/1.5 Arial,sans-serif}.sidebar,.topbar,.hero-art,.toolbar,.search-meta,.overview,.back-top,.chevron,.empty-state,.skip,.footer>a{display:none!important}.shell{display:block}main{padding:0}.hero{padding:0 0 18px;overflow:visible}h1{font-size:31pt;margin:10px 0}h1 span{color:var(--accent)!important}.hero-copy,.document-note,.guide-notes p,.intro,.recommendation p,.footer{color:var(--muted)!important}.eyebrow,.guide-heading .eyebrow{color:var(--muted)!important}.stats{max-width:100%;background:transparent;border-color:var(--edge);margin:18px 0 0}.stat{padding:12px 15px}.stat+.stat{border-color:var(--edge)}.stat strong{font-size:23pt;color:var(--text)}.stat span{color:var(--muted)}.repo-legend{margin:12px 0}.repo-legend a{color:var(--text)}.repo-legend a::before{background:var(--muted)}.guide,.guide[hidden]{display:block!important;background:var(--panel);border:1px solid var(--edge);margin:0 0 19px;overflow:visible}.guide summary{display:flex;padding:15px 16px;break-after:avoid;cursor:default}.guide-heading h2{font:600 15pt/1.3 Arial,sans-serif;color:var(--text)}.guide-number{color:var(--accent);font-size:18pt}.guide-count{color:var(--muted);border-color:var(--edge)}.guide-body{padding:0 16px 15px}.guide table{display:table;table-layout:fixed;font-size:9pt}.guide thead{display:table-header-group}.guide tbody{display:table-row-group}.guide tr{display:table-row;break-inside:avoid}.guide th,.guide td{display:table-cell;width:auto;padding:8px;line-height:1.55;color:var(--text);border-color:var(--edge)}.guide th{background:var(--raised);color:var(--muted)}.guide th:nth-child(1){width:25%}.guide th:nth-child(2){width:28%}.guide th:nth-child(3){width:47%}.guide td:first-child{color:var(--text)}.issue{color:var(--link)!important;background:transparent;border:1px solid var(--edge);font:8pt/1.4 Consolas,monospace;padding:2px 4px;box-shadow:none!important}.intro .issue,.guide-notes .issue,.recommendation .issue{font-size:8pt}.guide-notes{border-color:var(--edge-strong)}.guide-notes p{font-size:9pt}.guide-notes strong,.recommendation strong{color:var(--text)}.recommendation{background:var(--panel);border-color:var(--edge-strong);break-inside:avoid;margin:20px 0}.recommendation h2{color:var(--text)}.footer{font-size:8pt;border-color:var(--edge-strong)}.print-only{display:block;font:9pt/1.5 Arial,sans-serif;color:var(--muted)}.document-note{font-size:9pt}}
'''

CSS = rewrite(CSS, ('.guide summary', '.guide > summary'), ('.reference summary', '.reference > summary'))
CSS += (ROOT / 'work/guide_reading.css').read_text()
CSS += (ROOT / 'work/guide_overview.css').read_text()
CSS += (ROOT / 'work/guide_brief.css').read_text()
CSS += (ROOT / 'work/guide_direction.css').read_text()
CSS += (ROOT / 'work/guide_ideas.css').read_text()

JS = '''
(() => {
 // .guide elements are the counted work guides; .reference sections (timeline,
 // architecture) share expand/collapse, navigation, search and print handling
 // without joining the issue accounting.
 const guides = [...document.querySelectorAll('.guide')];
 const refs = [...document.querySelectorAll('.reference:not(.direction):not(.ideas)')];
 const evidence = [...document.querySelectorAll('.delivery-evidence,.guide-evidence,.future-scenarios')];
 const future = document.querySelector('.future-scenarios');
 // Prose sections (the archive, the dated direction and the ideas) are searched by text and never counted.
 const prose = [...document.querySelectorAll('.archive,.direction,.ideas')];
 const sections = [...guides, ...refs, ...prose];
 const figures = [...document.querySelectorAll('.diagram')];
 const architecture = document.querySelector('#architecture');
 const timeline = document.querySelector('#timeline');
 const navLinks = [...document.querySelectorAll('nav a')];
 const navId = a => a.dataset.guide || a.dataset.section;
 const navById = new Map(navLinks.map(a => [navId(a), a]));
 const search = document.querySelector('#search');
 const result = document.querySelector('#result-count');
 const empty = document.querySelector('#empty-state');
 const clear = document.querySelector('#clear-search');
 const normal = value => value.toLocaleLowerCase().replace(/\\s+/g, ' ').trim();
 const haystacks = new Map([...guides, ...figures].map(g => [g, normal(g.textContent)]));
 const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
 const overviewDetails = () => [...document.querySelectorAll('.overview-more')];
 const snapshot = () => ({overview: overviewDetails().map(s => s.open), open: sections.map(s => s.open), evidence: evidence.map(s => s.open), hidden: sections.map(s => s.hidden), figures: figures.map(f => f.hidden), nav: navLinks.map(a => a.hidden)});
 const restore = state => { overviewDetails().forEach((s, i) => s.open = state.overview[i]); evidence.forEach((s, i) => s.open = state.evidence[i]); sections.forEach((s, i) => { s.open = state.open[i]; s.hidden = state.hidden[i]; }); figures.forEach((f, i) => f.hidden = state.figures[i]); navLinks.forEach((a, i) => a.hidden = state.nav[i]); };
 let saved = null;
 function filter() {
   const query = normal(search.value);
   if (query && !saved) saved = snapshot();
   let count = 0, issues = 0, diagrams = 0;
   if (query) {
     evidence.forEach(s => s.open = true);
     guides.forEach(g => { const show = haystacks.get(g).includes(query); g.hidden = !show; navById.get(g.id).hidden = !show; if (show) { count++; issues += Number(g.dataset.count); g.open = true; } });
     figures.forEach(f => { const show = haystacks.get(f).includes(query); f.hidden = !show; if (show) diagrams++; });
     future.hidden = !figures.some(f => !f.hidden && future.contains(f));
     architecture.hidden = diagrams === 0; navById.get('architecture').hidden = diagrams === 0; if (diagrams) architecture.open = true;
     // Prose is read at search time: the ideas section gains and loses live rows after load.
     prose.forEach(a => { a.hidden = !normal(a.textContent).includes(query); if (!a.hidden) a.open = true; });
     timeline.hidden = true; navById.get('timeline').hidden = true;
   } else {
     if (saved) { restore(saved); saved = null; }
     future.hidden = false;
     count = guides.length; issues = guides.reduce((n, g) => n + Number(g.dataset.count), 0); diagrams = figures.length;
   }
   result.textContent = `${plural(count, 'guide')} · ${plural(issues, 'issue')} in these guides · ${plural(diagrams, 'diagram')}`;
   clear.hidden = !query; empty.hidden = count > 0 || diagrams > 0 || (query && prose.some(a => !a.hidden));
 }
 search.addEventListener('input', filter);
 search.addEventListener('keydown', e => { if (e.key === 'Escape') { search.value = ''; filter(); } });
 clear.addEventListener('click', () => { search.value = ''; filter(); search.focus(); });
 document.querySelector('#expand-all').addEventListener('click', () => [...sections, ...evidence, ...overviewDetails()].filter(s => !s.closest('[hidden]')).forEach(s => s.open = true));
 document.querySelector('#collapse-all').addEventListener('click', () => [...sections, ...evidence, ...overviewDetails()].filter(s => !s.closest('[hidden]')).forEach(s => s.open = false));
 const setCurrent = id => navLinks.forEach(a => { if (navId(a) === id) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current'); });
 function reveal(id) {
   const figure = figures.find(f => f.id === id);
   const anchor = document.getElementById(id);
   const target = figure ? figure.closest('.reference') : sections.find(s => s.id === id) || anchor?.closest('.guide,.archive');
   if (!target) return;
   if (target.hidden || (figure && figure.hidden)) { search.value = ''; filter(); }
   const wasClosed = !target.open || (figure && future.contains(figure) && !future.open);
   target.open = true;
   if (figure && future.contains(figure)) future.open = true;
   setCurrent(target.id);
   if (figure || wasClosed) requestAnimationFrame(() => document.getElementById(id).scrollIntoView({block: 'start'}));
 }
 document.addEventListener('click', event => { const link = event.target.closest('a[href^="#"]'); if (link) reveal(link.getAttribute('href').slice(1)); });
 window.addEventListener('hashchange', () => reveal(location.hash.slice(1)));
 if (location.hash) reveal(location.hash.slice(1));
 if ('IntersectionObserver' in window) {
   const observer = new IntersectionObserver(entries => {
     const visible = entries.filter(e => e.isIntersecting && !e.target.hidden).sort((a,b) => a.boundingClientRect.top-b.boundingClientRect.top);
     if (visible.length) setCurrent(visible[0].target.id);
   }, {rootMargin:'0px 0px -70% 0px',threshold:0});
   sections.forEach(s => observer.observe(s));
 }
 let beforePrint = null;
 window.addEventListener('beforeprint', () => { if (!beforePrint) beforePrint = snapshot(); [...sections, ...evidence, ...overviewDetails()].forEach(s => {s.open = true; s.hidden = false;}); figures.forEach(f => f.hidden = false); future.hidden = false; });
 window.addEventListener('afterprint', () => { if (beforePrint) restore(beforePrint); beforePrint = null; });
 document.querySelector('#print').addEventListener('click', () => window.print());
 // Diagram zoom, fit, drag-to-pan and the optional inline Archify viewer.
 figures.forEach(figure => {
   const svg = figure.querySelector('.diagram-canvas > svg'), level = figure.querySelector('.zoom-level'), stage = figure.querySelector('.diagram-stage');
   // 100% fits the whole diagram inside the stage (width and height); zoom is relative to that fit.
   const ratio = svg.viewBox.baseVal.height / svg.viewBox.baseVal.width;
   // Wide system diagrams fit whole; tall sequence diagrams open at full width and scroll vertically inside the stage.
   const fit = () => { if (ratio > 0.9) return 1; const width = stage.clientWidth - 2, height = parseFloat(getComputedStyle(stage).maxHeight) || 700; return Math.min(1, height / (width * ratio)); };
   let scale = 1;
   const apply = () => { svg.style.width = `${Math.round(scale * fit() * 1000) / 10}%`; level.textContent = `${Math.round(scale * 100)}%`; figure.dataset.zoom = String(scale); };
   apply();
   window.addEventListener('resize', () => { if (scale === 1) apply(); });
   figure.querySelector('.zoom-in').addEventListener('click', () => { scale = Math.min(4, +(scale + 0.25).toFixed(2)); apply(); });
   figure.querySelector('.zoom-out').addEventListener('click', () => { scale = Math.max(0.5, +(scale - 0.25).toFixed(2)); apply(); });
   figure.querySelector('.zoom-fit').addEventListener('click', () => { scale = 1; apply(); stage.scrollTo(0, 0); });
   let drag = null;
   stage.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('a,button')) return; drag = {x: e.clientX, y: e.clientY, left: stage.scrollLeft, top: stage.scrollTop}; stage.setPointerCapture(e.pointerId); stage.classList.add('dragging'); });
   stage.addEventListener('pointermove', e => { if (!drag) return; stage.scrollLeft = drag.left - (e.clientX - drag.x); stage.scrollTop = drag.top - (e.clientY - drag.y); });
   const end = () => { drag = null; stage.classList.remove('dragging'); };
   stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
   const toggle = figure.querySelector('.viewer-toggle'), frame = figure.querySelector('.viewer-frame');
   toggle.addEventListener('click', () => {
     if (!frame.querySelector('iframe')) { const iframe = document.createElement('iframe'); iframe.src = toggle.dataset.src; iframe.title = toggle.dataset.title; iframe.loading = 'lazy'; frame.append(iframe); }
     frame.hidden = !frame.hidden; toggle.setAttribute('aria-expanded', String(!frame.hidden)); toggle.textContent = frame.hidden ? 'Explore inline' : 'Hide inline viewer';
   });
 });
 // Timeline: tooltips, prerequisite highlighting and repository filter.
 if (timeline) {
   const tip = document.querySelector('#timeline-tip');
   const show = el => {
     tip.replaceChildren();
     const strong = document.createElement('strong'); strong.textContent = el.dataset.tip; tip.append(strong);
     for (const text of [el.dataset.when, el.dataset.detail]) if (text) { const span = document.createElement('span'); span.textContent = text; tip.append(span); }
     if (el.dataset.guide) { const em = document.createElement('em'); em.textContent = `Guide: ${el.dataset.guide}`; tip.append(em); }
     tip.hidden = false;
     const r = el.getBoundingClientRect(), box = timeline.querySelector('.guide-body').getBoundingClientRect();
     tip.style.left = `${Math.min(Math.max(120, r.left - box.left + r.width / 2), box.width - 120)}px`;
     tip.style.top = `${Math.max(0, r.top - box.top - 8)}px`;
   };
   const hide = () => { tip.hidden = true; };
   timeline.querySelectorAll('[data-tip]').forEach(el => { el.addEventListener('mouseenter', () => show(el)); el.addEventListener('focus', () => show(el)); el.addEventListener('mouseleave', hide); el.addEventListener('blur', hide); });
   timeline.querySelectorAll('.node').forEach(node => {
     const lit = on => timeline.querySelectorAll(`.edge[data-from="${node.dataset.node}"], .edge[data-to="${node.dataset.node}"]`).forEach(e => e.classList.toggle('lit', on));
     node.addEventListener('mouseenter', () => lit(true)); node.addEventListener('mouseleave', () => lit(false)); node.addEventListener('focus', () => lit(true)); node.addEventListener('blur', () => lit(false));
   });
   const chips = [...timeline.querySelectorAll('.repo-chip')];
   chips.forEach(chip => chip.addEventListener('click', () => {
     const repo = chip.dataset.repo;
     chips.forEach(c => c.setAttribute('aria-pressed', String(c === chip)));
     timeline.dataset.repo = repo;
     timeline.querySelectorAll('svg [data-repo], svg [data-repos]').forEach(el => { const repos = (el.dataset.repos ?? el.dataset.repo ?? '').split(' ').filter(Boolean); el.classList.toggle('dim', repo !== 'all' && !repos.includes(repo)); });
   }));
 }
})();
// Task briefs: an issue link opens a dialog with copyable agent prompts built from
// the issue URL and title. Modified clicks and script-free readers still reach GitHub.
(() => {
 const dialog = document.querySelector('#brief');
 const prompt = dialog.querySelector('#brief-prompt'), hint = dialog.querySelector('.brief-hint'), status = dialog.querySelector('.brief-status');
 const buttons = [...dialog.querySelectorAll('[data-action]')];
 const ACTIONS = {
   explain: [(url, title) => `Explain ${url} ("${title}"). Read the issue and the repository's AGENTS.md first. Read-only: don't change files, branches or GitHub.`,
             'Read-only walkthrough of the issue and its repository.'],
   plan: [url => `Use the plan-work skill for ${url}. Planning only: return proposals and don't change the tracker until I approve. If plan-work isn't available here, say so and stop.`,
          'Planning proposals only. Tracker changes wait for your approval.'],
   implement: [url => `Use the deliver-work skill to deliver ${url}. If deliver-work isn't available here, say so and stop.`,
               'Runs to a merged PR and a closed issue. Edit the pasted prompt to stop earlier.'],
   review: [url => `Review the open pull request for ${url}. If there isn't exactly one, ask me which revision to review. Read-only: report findings without changing files or GitHub.`,
            'Read-only findings on the open pull request.'],
 };
 // Starting-session recommendations come from the snapshot. Live reads never add
 // or refresh one: a story absent from the snapshot is not yet assessed.
 const HOSTS = {claude:'Claude Code', codex:'Codex'};
 const ROWS = [['Model',h=>`${h.model} (${h.identifier})`],['Thinking level',h=>h.thinking],['Session type',h=>h.session],['Subagents',h=>h.subagents],['Reviewers',h=>h.reviewers],['Checkpoints',h=>h.checkpoints]];
 const NOTICES = {stale:'The story changed after this recommendation was saved, so Implement uses the generic prompt.',
   insufficient:'Implement uses the generic prompt until the missing input is recorded.',
   unassessed:'No starting session is recorded for this story. Implement uses the generic prompt.',
   unavailable:'The saved section could not be read, so Implement uses the generic prompt.'};
 const start = dialog.querySelector('.brief-start'), hostTable = start.querySelector('.brief-hosts'), why = start.querySelector('.brief-why');
 const hostButtons = [...dialog.querySelectorAll('button[data-host]')], startButtons = [...dialog.querySelectorAll('[data-start]')];
 const options = dialog.querySelector('.brief-options'), optionNote = dialog.querySelector('.brief-option-note');
 const readHost = () => { try { const saved = localStorage.getItem('guide-brief-host'); return saved in HOSTS ? saved : 'claude'; } catch { return 'claude'; } };
 const saveHost = value => { try { localStorage.setItem('guide-brief-host', value); } catch {} };
 const element = (tag, text, attributes = {}) => { const node = document.createElement(tag); node.textContent = text; Object.entries(attributes).forEach(([k, v]) => node.setAttribute(k, v)); return node; };
 const recommendationFor = key => JSON.parse(document.querySelector('#issue-recommendations').textContent)[key] || {state:'unassessed', label:'Not yet assessed', ratings:{}};
 function showRecommendation(rec) {
   const current = rec.state === 'recommended';
   start.dataset.rec = rec.state;
   const provenance = rec.date ? ` · assessed ${rec.date}${rec.policy ? ` · policy ${rec.policy}` : ''}` : '';
   start.querySelector('.brief-rec-state').textContent = current ? `Recommended${provenance}` : `${rec.label}${rec.state === 'stale' ? '' : provenance}. ${NOTICES[rec.state]}`;
   const ratings = Object.entries(rec.ratings || {});
   start.querySelector('.brief-ratings').textContent = ratings.length ? 'Assessment: ' + ratings.map(([name, level]) => `${name} ${level}`).join(' · ') : 'Assessment ratings are not recorded in the story.';
   start.querySelector('.brief-answer').textContent = current ? rec.answer : rec.state === 'insufficient' ? `Missing: ${rec.missing}` : rec.state === 'unavailable' ? `Reason: ${rec.reason}` : '';
   hostTable.hidden = !current; start.querySelector('.brief-choose').hidden = !current;
   const body = hostTable.querySelector('tbody'); body.replaceChildren();
   if (current) {
     for (const [name, value] of ROWS) {
       if (name === 'Checkpoints' && !Object.keys(HOSTS).some(key => rec.hosts[key].checkpoints)) continue;
       const row = document.createElement('tr'); row.append(element('th', name, {scope:'row'}));
       Object.entries(HOSTS).forEach(([host, label]) => { const cell = element('td', value(rec.hosts[host]) || 'None'); cell.prepend(element('span', `${label}: `, {class:'brief-cell-host'})); row.append(cell); });
       body.append(row);
     }
     Object.keys(HOSTS).forEach(host => { hostTable.querySelector(`.brief-avail[data-avail="${host}"]`).textContent = rec.hosts[host].verified ? 'verified' : 'provisional'; });
   }
   const details = why.querySelector('dl'); details.replaceChildren();
   const entries = [['Why', rec.why], ...(current ? Object.entries(HOSTS).map(([host, label]) => [`${label} availability`, rec.hosts[host].availability]) : []), ['Reassess when', rec.reassess], ['Evidence', rec.evidence], ...(rec.cheaper ? [['Cheaper start', rec.cheaper]] : [])].filter(([, value]) => value);
   entries.forEach(([term, value]) => details.append(element('dt', term), element('dd', value)));
   why.hidden = !entries.length; why.open = false;
 }
 let action = 'explain', issue = null, opener = null, rec = null, host = readHost(), begin = 'recommended';
 const show = () => {
   buttons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.action === action)));
   const current = rec.state === 'recommended', custom = action === 'implement' && current;
   const cheaper = current && rec.prompts.cheaper;
   if (!cheaper) begin = 'recommended';
   options.hidden = !custom;
   hostButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.host === host)));
   startButtons.forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.start === begin)); if (b.dataset.start === 'cheaper') b.disabled = !cheaper; });
   optionNote.textContent = cheaper ? (begin === 'cheaper' ? rec.cheaper : '') : rec.cheaper ? `Cheaper start: ${rec.cheaper}` : 'No cheaper start is recorded for this story.';
   const [build, text] = ACTIONS[action];
   if (custom) {
     const session = rec.hosts[host].session;
     prompt.value = rec.prompts[begin][host];
     hint.textContent = `Saved ${HOSTS[host]} prompt from the story's recommendation, ${rec.date}. ` + (session === 'Investigate first' && begin === 'recommended' ? 'It starts a read-only investigation; the story is reassessed before implementation.' : 'It runs to a merged PR and a closed issue unless it says otherwise.');
   } else {
     prompt.value = build(issue.url, issue.title);
     hint.textContent = action === 'implement' ? `${rec.label}: generic prompt. ${text}` : text;
   }
   status.textContent = '';
 };
 // Returns false for a key without brief data, so callers can fall back to the issue link.
 window.openBrief = (key, from = document.activeElement) => {
   const entry = JSON.parse(document.querySelector('#issue-briefs').textContent)[key];
   if (!entry) return false;
   const [url, title] = entry, [, owner, repo, , number] = new URL(url).pathname.split('/');
   issue = {url, title};
   dialog.querySelector('.brief-repo').textContent = `${owner}/${repo}`;
   dialog.querySelector('.brief-number').textContent = `#${number}`;
   dialog.querySelector('#brief-title').textContent = title;
   dialog.querySelector('.brief-link').href = url;
   rec = recommendationFor(key); begin = 'recommended';
   showRecommendation(rec);
   show();
   opener = from;
   if (!dialog.open) dialog.showModal();
   buttons.find(b => b.dataset.action === action).focus();
   return true;
 };
 buttons.forEach(b => b.addEventListener('click', () => { action = b.dataset.action; show(); }));
 hostButtons.forEach(b => b.addEventListener('click', () => { host = b.dataset.host; saveHost(host); show(); }));
 startButtons.forEach(b => b.addEventListener('click', () => { if (!b.disabled) { begin = b.dataset.start; show(); } }));
 // Printing an open brief prints it with its details expanded, then restores them.
 let whyWasOpen = null;
 window.addEventListener('beforeprint', () => { if (dialog.open && whyWasOpen === null) { whyWasOpen = why.open; why.open = true; } });
 window.addEventListener('afterprint', () => { if (whyWasOpen !== null) why.open = whyWasOpen; whyWasOpen = null; });
 dialog.querySelector('.brief-copy').addEventListener('click', async () => {
   const manual = () => { prompt.focus(); prompt.setSelectionRange(0, prompt.value.length); status.textContent = 'Copying is blocked here. The prompt is selected; copy it manually.'; };
   if (!navigator.clipboard?.writeText) return manual();
   try { await navigator.clipboard.writeText(prompt.value); status.textContent = 'Copied.'; } catch { manual(); }
 });
 dialog.querySelector('.brief-close').addEventListener('click', () => dialog.close());
 dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
 dialog.addEventListener('close', () => { if (opener?.isConnected) opener.focus(); opener = null; });
 document.addEventListener('click', e => {
   const link = e.target.closest?.('a.issue[data-issue]');
   if (!link || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
   if (window.openBrief(link.dataset.issue, link)) e.preventDefault();
 });
 const snapshotData = JSON.parse(document.querySelector('#snapshot-data').textContent);
 const statusLine = document.querySelector('#github-status');
 const repositories = {
   H: {name:'agent-device-hub', label:'Hub'},
   N: {name:'codex-nanoleaf', label:'Nanoleaf'},
   P: {name:'divoom-app-upgrade', label:'Pixoo'}
 };
 const statusValues = {
   open:['○','Open'], 'in-progress':['◐','In progress'], review:['◐','In review'],
   blocked:['⊘','Blocked'], completed:['✓','Completed'], closed:['−','Closed']
 };
 const snapshotDate = snapshotData.snapshotDate;
 const readTime = () => new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
 const joinNames = names => names.length < 2 ? names.join('') : `${names.slice(0,-1).join(', ')} and ${names.at(-1)}`;
 async function readPages(repo,state) {
   const query = new URLSearchParams({state,per_page:'100'});
   if (state === 'closed') query.set('since',snapshotData.refreshedAt);
   let next = `https://api.github.com/repos/jimmie-potts/${repo}/issues?${query}`;
   const rows = [], seen = new Set();
   while (next) {
     const url = new URL(next);
     if (url.origin !== 'https://api.github.com' || url.pathname !== `/repos/jimmie-potts/${repo}/issues` || seen.has(url.href)) throw new Error('Invalid GitHub pagination link');
     seen.add(url.href);
     const response = await fetch(url.href,{method:'GET',credentials:'omit',cache:'no-store',headers:{Accept:'application/vnd.github+json'},redirect:'error'});
     if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
     const page = await response.json();
     if (!Array.isArray(page)) throw new Error('GitHub returned an invalid issue page');
     rows.push(...page.filter(issue => !issue.pull_request));
     const link = response.headers.get('Link') || '';
     const match = link.split(/,\\s*(?=<)/).find(value => /;\\s*rel="next"/.test(value));
     next = match?.match(/<([^>]+)>/)?.[1] || null;
   }
   return rows;
 }
 function liveStatus(issue) {
   if (issue.state === 'closed') return issue.state_reason === 'completed' ? 'completed' : 'closed';
   const names = new Set((issue.labels || []).map(label => typeof label === 'string' ? label : label.name));
   let status = names.has('status:review') ? 'review' : names.has('status:in-progress') ? 'in-progress' : 'open';
   const blocked = names.has('blocked') || Number(issue.issue_dependencies_summary?.blocked_by || 0) > 0;
   if (blocked && status === 'open') status = 'blocked';
   return {status,blockedQualifier:blocked && (status === 'review' || status === 'in-progress')};
 }
 function updateBadges(prefix,issues) {
   const byNumber = new Map(issues.map(issue => [String(issue.number),issue]));
   for (const badge of document.querySelectorAll(`a.issue[data-issue^="${prefix}"]`)) {
     const number = badge.dataset.issue.slice(1), issue = byNumber.get(number);
     if (!issue) continue;
     const result = liveStatus(issue), status = typeof result === 'string' ? result : result.status;
     const blockedQualifier = typeof result === 'string' ? false : result.blockedQualifier;
     const [symbol,label] = statusValues[status];
     const statusText = `${label}${blockedQualifier ? ' · blocked' : ''}`;
     const repository = repositories[prefix].label, issueName = issue.title || badge.querySelector('.issue-id').textContent;
     const title = `${repository} #${number}: ${issueName} (${statusText}; opens a task brief)`;
     badge.dataset.state = issue.state.toUpperCase(); badge.dataset.status = status;
     badge.querySelector('.status-symbol').textContent = symbol;
     badge.querySelector('.issue-status').textContent = statusText;
     badge.setAttribute('title',title); badge.setAttribute('aria-label',title);
   }
 }
 async function refreshIssueStatus() {
   if (navigator.onLine === false) {
     window.finishWorkOverview();
     statusLine.textContent = `GitHub unavailable for Hub, Nanoleaf and Pixoo; showing snapshot status for all badges. Guide text from the ${snapshotDate} snapshot.`;
     return;
   }
   const outcomes = await Promise.all(Object.entries(repositories).map(async ([prefix,repo]) => {
     try {
       const [open,closed] = await Promise.all([readPages(repo.name,'open'),readPages(repo.name,'closed')]);
       window.updateWorkOverview(prefix, open);
       updateBadges(prefix,[...open,...closed]);
       return {label:repo.label,ok:true};
     } catch {
       return {label:repo.label,ok:false};
     }
   }));
   window.finishWorkOverview();
   const unavailable = outcomes.filter(outcome => !outcome.ok).map(outcome => outcome.label);
   const time = readTime();
   if (!unavailable.length) statusLine.textContent = `Status from GitHub at ${time}. Guide text from the ${snapshotDate} snapshot.`;
   else {
     const names = joinNames(unavailable), fallback = unavailable.length === Object.keys(repositories).length ? 'all badges' : `badges for ${names}`;
     const available = outcomes.filter(outcome => outcome.ok).map(outcome => outcome.label);
     statusLine.textContent = `GitHub unavailable for ${names}; showing snapshot status for ${fallback}.${available.length ? ` Other badges read from GitHub at ${time}.` : ''} Guide text from the ${snapshotDate} snapshot.`;
   }
 }
 refreshIssueStatus();
})();
'''

JS = SKIN.controls_script() + (ROOT / 'work/guide_overview.js').read_text() + JS

document = '''<!doctype html>
<html lang="en" ''' + SKIN.HTML_ATTRIBUTES + '''><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">''' + SKIN.head_script() + '''
<meta name="color-scheme" content="dark light"><meta name="description" content="@@GUIDE_COUNT@@ linked guides covering @@TOTAL@@ open issues across Agent Device Hub, Codex Nanoleaf, and Pixoo. Static snapshot refreshed @@TIMESTAMP@@.">
<title>Agent device work guides · @@MONTH_TITLE@@</title><style>''' + SKIN.stylesheet() + CSS + '''
.atlas-link{display:block;margin:14px 8px 6px;padding:11px 10px;border:1px solid var(--edge);color:var(--accent);font-size:12px;line-height:1.4;text-decoration:none}.atlas-link:hover,.atlas-link:focus-visible{color:var(--text);border-color:var(--accent);background:var(--raised)}</style></head>
<body id="top"><a class="skip" href="#main">Skip to the guides</a>
<div class="shell"><aside class="sidebar" aria-label="Guide navigation">
<a class="brand" href="#top" aria-label="Agent device work guides overview"><svg viewBox="0 0 40 44" fill="none" aria-hidden="true"><path d="M20 2 37 12v20L20 42 3 32V12Z" stroke="currentColor" stroke-width="1.5"/><path d="m3 12 17 10 17-10M20 22v20M20 2v12m-7 4 7-4 7 4" stroke="currentColor" stroke-width="1.5"/></svg><span>AGENT DEVICE<small>WORK GUIDES / @@MONTH_CODE@@</small></span></a>
<div class="sidebar-rule"></div><div class="nav-title eyebrow">Explore the work</div><nav aria-label="@@GUIDE_COUNT@@ work guides, timeline, direction, ideas and architecture">''' + ''.join(nav) + '''<div class="nav-rule" role="presentation"></div><a href="#timeline" data-section="timeline"><span class="nav-number">T</span><span>Timeline map</span><span class="nav-count" aria-hidden="true">map</span></a><a href="#direction" data-section="direction"><span class="nav-number">D</span><span>Direction</span><span class="nav-count" aria-hidden="true">dated</span></a>''' + GI.nav_entry(len(IDEA_KEYS)) + '''<a href="#architecture" data-section="architecture"><span class="nav-number">A</span><span>Architecture</span><span class="nav-count">''' + f'{len(AD.DIAGRAMS):02}' + '''</span></a><a href="#local-acceptance" data-section="local-acceptance"><span class="nav-number">✓</span><span>Completed milestones</span></a></nav>
<a class="atlas-link" href="../../system-design/index.html">Explore the B.U.N.N.Y. system design atlas ↗</a>
<div class="sidebar-foot"><span><i class="snapshot-dot" aria-hidden="true"></i>BACKLOG SNAPSHOT</span><span>@@DATE@@ / @@PROJECTS_PADDED@@ PROJECTS</span><span>Issue links open task briefs</span></div></aside>
<main id="main"><header class="topbar"><div class="breadcrumb"><span>PLANNING</span> / CROSS-PROJECT GUIDE</div><div class="topbar-tools"><time class="date" datetime="@@ISO@@">@@DATE@@</time><button id="theme-toggle" type="button" aria-pressed="false">Light mode</button></div></header>
<section class="hero" aria-labelledby="document-title"><div class="eyebrow">One shared system · @@GUIDE_COUNT@@ work guides</div><h1 id="document-title">Agent device<br><span>work guides.</span></h1>
<p class="hero-copy">See what is complete, what needs attention, and which useful next steps are available across the hub, Nanoleaf and Pixoo.</p>
<svg class="hero-art" viewBox="0 0 250 220" fill="none" aria-hidden="true" focusable="false"><g class="art-halo" stroke-width="10"><path d="m125 20 70 40v80l-70 40-70-40V60Z"/><path d="m55 60 70 40 70-40m-70 40v80"/></g><g class="art-line" stroke-width="1.4"><path pathLength="1" d="m125 20 70 40v80l-70 40-70-40V60Z"/><path pathLength="1" d="m55 60 70 40 70-40m-70 40v80"/><path pathLength="1" d="M125 20v-9M195 140l20 12M55 140l-20 12"/></g><path class="art-pending" d="m125 43 50 29v56l-50 29-50-29V72Z"/><g class="art-node"><circle cx="125" cy="20" r="3"/><circle cx="195" cy="140" r="3"/><circle cx="55" cy="140" r="3"/><circle cx="125" cy="100" r="4"/></g><path class="art-base" d="M23 191h60m23 0h73m10 0h33M23 198h25m8 0h111"/></svg>
<div class="stats" aria-label="Snapshot totals"><div class="stat"><strong>@@TOTAL@@</strong><span>OPEN ISSUES</span></div><div class="stat"><strong>@@GUIDE_COUNT@@</strong><span>WORK GUIDES</span></div><div class="stat"><strong>@@PROJECTS_PADDED@@</strong><span>PROJECTS</span></div></div>
<div class="repo-legend" aria-label="Repository key"><a class="repo-H" href="https://github.com/jimmie-potts/agent-device-hub/issues" target="_blank" rel="noopener noreferrer">Hub <b>@@H_COUNT@@</b></a><a class="repo-N" href="https://github.com/jimmie-potts/codex-nanoleaf/issues" target="_blank" rel="noopener noreferrer">Nanoleaf <b>@@N_COUNT@@</b></a><a class="repo-P" href="https://github.com/jimmie-potts/divoom-app-upgrade/issues" target="_blank" rel="noopener noreferrer">Pixoo <b>@@P_COUNT@@</b></a></div></section>
''' + overview + '''
<section class="issue-legend" aria-label="Issue status key"><h2>Read status on the issue link</h2><div><span class="status-key" data-status="open"><span aria-hidden="true">○</span> Open</span><span class="status-key" data-status="in-progress"><span aria-hidden="true">◐</span> In progress</span><span class="status-key" data-status="review"><span aria-hidden="true">◐</span> In review</span><span class="status-key" data-status="blocked"><span aria-hidden="true">⊘</span> Blocked</span><span class="status-key" data-status="completed"><span aria-hidden="true">✓</span> Completed</span><span class="status-key" data-status="closed"><span aria-hidden="true">−</span> Closed</span></div><p>Completed means the issue closed as completed within its own scope. Closed alone does not claim delivery. In-progress and review links retain a blocked qualifier when needed. Counts show open stories; closed evidence is expandable.</p></section>
<p class="document-note"><strong>Static snapshot refreshed <time datetime="@@ISO@@">@@TIMESTAMP@@</time>.</strong> Based on explicit open-issue queries, complete pagination, current issue bodies and native prerequisites, plus direct acceptance and PR reads. Every open issue has one primary guide; repeated dependency, completed-baseline, timeline and architecture links do not add to the counts. “Pixoo” means <strong>divoom-app-upgrade</strong>. Future investigations remain deferred. Issue badges refresh from public GitHub when this page loads; topic-guide text, counts and dependency explanations stay on this snapshot. Opening lists use the freshness shown above them.</p>
<p id="github-status" class="document-note" role="status" aria-live="polite">Loading GitHub issue status. Guide text from the @@SNAPSHOT_DATE@@ snapshot.</p>

<div class="guides references">''' + timeline_section + direction_section + ideas_section + '''</div>
<div class="toolbar" aria-label="Document controls"><div class="search-wrap"><label class="sr-only" for="search">Search guides by topic, device, or issue</label><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.5"/><path d="m12 12 5 5" stroke="currentColor" stroke-width="1.5"/></svg><input id="search" type="search" placeholder="Find a topic, device, or issue…" autocomplete="off"></div><button id="expand-all" type="button">Expand all</button><button id="collapse-all" type="button">Collapse all</button><button id="print" type="button">Print / PDF</button></div>
<div class="search-meta"><span id="result-count" role="status" aria-live="polite">@@GUIDE_COUNT@@ guides · @@TOTAL@@ issues in these guides · @@DIAGRAM_COUNT@@ diagrams</span><button id="clear-search" type="button" hidden>Clear search</button><span>Select an issue for its task brief and GitHub link</span></div>
<div id="empty-state" class="empty-state" hidden><h2>No matching guides or diagrams</h2><p>Try a device name, topic, or issue such as “Pixoo #37”.</p></div>
<div class="guides">''' + ''.join(sections) + archive_section + '''</div>
<div class="guides references">''' + architecture_section + '''</div>
<footer class="footer"><p>AGENT DEVICE WORK GUIDES / @@MONTH_UPPER@@<br>Source: existing GitHub planning records, refreshed @@TIMESTAMP@@.<br>Issue states and dependencies come from the dated GitHub snapshot. Source validation, installation, real-client, transport and physical evidence remain separate. One state owner and one designated writer per device.</p><a href="#top">RETURN TO TOP ↑</a></footer>
</main></div>
<dialog id="brief" class="brief" aria-labelledby="brief-title"><div class="brief-body">
<header class="brief-head"><p class="eyebrow"><span class="brief-repo"></span><span class="brief-number"></span></p><h2 id="brief-title"></h2><a class="brief-link" target="_blank" rel="noopener noreferrer">Open the issue in GitHub ↗</a></header>
<section class="brief-start" aria-labelledby="brief-start-title"><h3 id="brief-start-title">Start with</h3><p class="brief-rec-state"></p><p class="brief-ratings"></p><p class="brief-answer"></p>
<table class="brief-hosts"><caption class="sr-only">Starting session per host</caption><thead><tr><td></td><th scope="col">Claude Code<span class="brief-avail" data-avail="claude"></span></th><th scope="col">Codex<span class="brief-avail" data-avail="codex"></span></th></tr></thead><tbody></tbody></table>
<p class="brief-choose">Choose the model and effort in your host before pasting. The agent can confirm the model but not the thinking level.</p>
<details class="brief-why"><summary>Why, availability and when to reassess</summary><dl></dl></details></section>
<div class="brief-actions" role="group" aria-label="Agent action"><button type="button" data-action="explain" aria-pressed="true">Explain</button><button type="button" data-action="plan" aria-pressed="false">Plan</button><button type="button" data-action="implement" aria-pressed="false">Implement</button><button type="button" data-action="review" aria-pressed="false">Review</button></div>
<div class="brief-options"><div class="brief-toggle" role="group" aria-label="Host"><button type="button" data-host="claude" aria-pressed="true">Claude Code</button><button type="button" data-host="codex" aria-pressed="false">Codex</button></div><div class="brief-toggle" role="group" aria-label="Start"><button type="button" data-start="recommended" aria-pressed="true">Recommended</button><button type="button" data-start="cheaper" aria-pressed="false">Cheaper</button></div><p class="brief-option-note"></p></div>
<p class="brief-hint"></p><label class="brief-label" for="brief-prompt">Prompt for a Codex or Claude session</label><textarea id="brief-prompt" rows="5" readonly spellcheck="false"></textarea>
<div class="brief-foot"><button type="button" class="brief-copy">Copy prompt</button><button type="button" class="brief-close">Close</button></div><p class="brief-status" role="status" aria-live="polite"></p>
</div></dialog><script>''' + JS + '''</script></body></html>'''

document = document.replace('Hub #32 is closed', render('[[H32]] is closed'))


tokens = {
    'TOTAL': str(TOTAL), 'GUIDE_COUNT': str(len(GUIDES)), 'PROJECTS_PADDED': f'{len(REPOS):02}',
    'H_COUNT': str(COUNTS['H']), 'N_COUNT': str(COUNTS['N']), 'P_COUNT': str(COUNTS['P']),
    'TIMESTAMP': REFRESHED.strftime('%B %d, %Y at %H:%M:%S %Z'), 'ISO': SNAPSHOT['refreshedAt'], 'SNAPSHOT_DATE': REFRESHED.strftime('%-d %b'),
    'DATE': REFRESHED.strftime('%d %b %Y').upper(), 'MONTH_TITLE': REFRESHED.strftime('%B %Y'),
    'MONTH_CODE': REFRESHED.strftime('%Y.%m'), 'MONTH_UPPER': REFRESHED.strftime('%B %Y').upper(),
    'DIAGRAM_COUNT': str(len(AD.DIAGRAMS)), 'REVIEW_TIMESTAMP': SOURCE_REVIEW.strftime('%B %d, %Y at %H:%M:%S %Z'),
    'HISTORY_TIMESTAMP': TIMELINE['fetched'].strftime('%B %d, %Y at %H:%M:%S %Z'),
}
for token, value in tokens.items():
    document = document.replace(f'@@{token}@@', html.escape(value, quote=True))
assert not re.search(r'@@[A-Z_]+@@', document), 'Unresolved document metadata'
metadata_json = json.dumps(METADATA, ensure_ascii=False).replace('<', r'\u003c')
referenced = set(re.findall(r'data-issue="([HNP]\d+)"', document))
briefs_json = json.dumps({key: [ISSUES[key]['url'], ISSUES[key]['title']] for key in sorted(referenced)}, ensure_ascii=False).replace('<', r'\u003c')
recommendations_json = json.dumps({key: REC.brief(RECOMMENDATIONS[key]) for key in sorted(RECOMMENDATIONS)}, ensure_ascii=False).replace('<', r'\u003c')
assert document.count('</dialog><script>') == 1, 'Page script anchor missing'
document = document.replace('</dialog><script>', f'</dialog><script id="snapshot-data" type="application/json">{metadata_json}</script><script id="issue-briefs" type="application/json">{briefs_json}</script><script id="issue-recommendations" type="application/json">{recommendations_json}</script><script>')
assert set(all_primary) <= referenced
assert document.count('class="diagram"') == len(AD.DIAGRAMS) and document.count('<details class="guide"') == len(GUIDES)
assert 'src="http' not in document and 'href="http' not in re.sub(r'href="https://github\.com/[^"]*"', '', document), 'Only GitHub links may leave the document'
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(document, encoding='utf-8')
# Companion interactive viewers (full Archify HTML) sit beside the guide; the
# inline SVGs above keep the guide itself self-contained and printable.
VIEWERS.mkdir(parents=True, exist_ok=True)
for existing in VIEWERS.glob('*.html'):
    if existing.stem not in {d['id'] for d in AD.DIAGRAMS}:
        existing.unlink()
for diagram in AD.DIAGRAMS:
    shutil.copyfile(AD.RENDERED / f"{diagram['id']}.html", VIEWERS / f"{diagram['id']}.html")
print(json.dumps({'output': str(OUT), 'bytes': OUT.stat().st_size, 'guides': len(GUIDES), 'primary_open_issues': len(all_primary), 'linked_issues': len(referenced),
                  'diagrams': len(AD.DIAGRAMS), 'viewers': str(VIEWERS), 'roadmap_nodes': TIMELINE['meta']['roadmapNodes'], 'merged_prs': TIMELINE['totals']['merged']}))
