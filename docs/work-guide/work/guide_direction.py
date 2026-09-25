"""The dated Direction section: the owner's narrative plus a computed leverage table.

`AS_OF` and `REVISION` date the narrative and pin it to the hub commit it was
written against. The text renders literally; issue keys render through the
guide's `issue_link`, so they carry the same status icon and live GitHub
relabel as every other link. `check()` runs against the saved snapshot before
the section is rendered: an unknown key, a `SEQUENCE` key that has closed
without a `DELIVERED_SINCE` entry, or a `DELIVERED_SINCE` key that is still
open fails the build naming the key, so the direction text is rewritten with
the refresh instead of going stale. The leverage table is recomputed from the
saved native prerequisite records at every build and is never typed by hand.
"""
import html

AS_OF = '2026-09-25'
REVISION = '15c9c2a'

# Where B.U.N.N.Y. stands on each surface: (surface, one or two sentences, evidence keys).
STANDING = [
    ('Nanoleaf Lines and Panels',
     'Installed on the Linux runtime and following shared monitoring, with the Lines and the NL22 Panels as independent devices. '
     'Codex titles, the compact inspector, configurable Work-mode colors and saved-scene playback are delivered; the Lines/Panels map selector is in progress.',
     ['N46', 'N139', 'N91', 'N44']),
    ('Pixoo',
     'Installed as a user service with hub settings; Monitor and Media controls are verified on the display. '
     'Two media defects remain visible on the device: extra GIF flashes and cloud content after screen-on or a reboot.',
     ['P77', 'P34', 'P52', 'P76']),
    ('Tidbyt',
     'Agent status is installed and verified on the cloud-connected device. Now-playing cards and the Tronbyt connection stay later.',
     ['H21', 'H38', 'H23']),
    ('LIFX',
     'The LAN controller source is delivered. Automatic status waits on the owner\'s behavior decisions before anything is installed.',
     ['H18', 'H20', 'H22']),
    ('PC lighting',
     'Later by the owner\'s choice. Every story waits on hardware qualification, so nothing here is scheduled.',
     ['H51', 'H53']),
    ('Playback',
     'Shared Linux playback with the Sony HT-A9 source is installed. Now-playing UI with Sony-qualified controls is in progress; the Sonos Move is the next source.',
     ['H175', 'H37', 'H233']),
    ('Hub and dashboard',
     'B.U.N.N.Y. carries the Neon skin, one-step device settings and one command lifecycle for forms and actions. '
     'Shared monitoring runs as an installed service with Codex Desktop read state and 24-hour session expiry; consistent retirement across Codex and Claude is ready to start.',
     ['H182', 'H231', 'H245', 'H191', 'H195', 'H241']),
    ('Guide and atlas',
     'Published in the Neon skin with task briefs, live GitHub status and a starting-session recommendation per story. Story-owned topic placement is the next guide change.',
     ['H197', 'H252', 'H259']),
]

# What it is becoming: (paragraph, direction keys).
BECOMING = [
    ('One interface. The Nanoleaf wall map grows into the B.U.N.N.Y. shell: a page per device and a group page that shows every device with shared art.',
     ['H271']),
    ('One system of colors and looks. The same status and project colors on every device, and coordinated Free and Quiet looks started from the hub, building on the fixed desk-preset mappings.',
     ['H267', 'H67']),
    ('One task pool. In Work, devices join or leave a shared pool while each keeps its own writer and identity.',
     ['H272', 'N47']),
    ('The owner\'s test for new work: something visible on a device or in B.U.N.N.Y. that they can interact with, chosen as the least work that unblocks the most.',
     []),
]

# What to build next, in order: (keys, why).
SEQUENCE = [
    (['H241'], 'Retire ended monitoring sessions consistently across Codex and Claude. It is ready, and it releases cross-device eviction and the Nanoleaf Work/Free switch on session presence.'),
    (['H20'], 'Decide the LIFX status behavior: bulbs, colors, brightness cap, quiet behavior and the manual-change policy. No code, and it releases the LIFX installation and LIFX in every cross-device story.'),
    (['H67'], 'Desk presets with fixed Work, Free and Quiet mappings across Nanoleaf and Pixoo: the smallest visible cross-device win and the base for coordinated modes. The tracker still marks it deferred until the owner selects it.'),
    (['N44', 'N113'], 'Finish the Lines/Panels map selector and give the Panels their own controller and MCP access: the first device page.'),
    (['H37', 'H233'], 'Land now-playing with Sony-qualified controls, then add the Sonos Move as the second playback source.'),
    (['N112', 'N81', 'N115'], 'Wall presentation the owner sees directly: show the Lines hold and how to resume it, queue the delayed completion comet, and keep comets and waves when the worker skips revisions.'),
]

# Changes to what already exists: (text, keys).
IMPROVEMENTS = [
    ('Pixoo media: keep MCP status valid after dashboard uploads, and keep Divoom cloud content off the display after screen-on and reboots.', ['P79', 'P76']),
    ('Tidbyt: check stale-status readability with night mode enabled.', ['H227']),
    ('Dashboard: document connecting device controllers, and stop component aliases colliding with built-in pages.', ['H232', 'H247']),
    ('Guide: mission-map navigation and signal playback build on the Neon restyle.', ['H201', 'H202']),
]

# Later creative bets worth keeping: (text, keys).
IDEAS = [
    ('A combined Lines-and-Panels layout as the first shared task pool.', ['N47']),
    ('Song-change lighting effects and music visualizers once playback participation is qualified.', ['H39', 'H41']),
    ('Home Assistant and MQTT for devices the hub does not speak to yet.', ['H11']),
    ('A conversational assistant and phone-to-app handoffs over the shared device tools.', ['H46', 'H199']),
    ('A trading-card skin for the guide and atlas, with art shared by issue label.', ['H254']),
]

# Keys moved out of SEQUENCE at a refresh: (date, keys, note).
DELIVERED_SINCE = []

SCHEDULING = {'candidate': 'Candidate', 'active': 'Active', 'blocked': 'Blocked', 'deferred': 'Deferred', 'closed': 'Closed'}
TABLE_LIMIT = 10


def cited():
    """Every key the narrative cites, by list name, in order of appearance."""
    lists = {'STANDING': [key for _, _, keys in STANDING for key in keys],
             'BECOMING': [key for _, keys in BECOMING for key in keys],
             'SEQUENCE': [key for keys, _ in SEQUENCE for key in keys],
             'IMPROVEMENTS': [key for _, keys in IMPROVEMENTS for key in keys],
             'IDEAS': [key for _, keys in IDEAS for key in keys],
             'DELIVERED_SINCE': [key for _, keys, _ in DELIVERED_SINCE for key in keys]}
    return lists


def check(issues):
    """Fail, naming the key, when the narrative no longer fits the saved snapshot."""
    problems = []
    delivered = set(cited()['DELIVERED_SINCE'])
    for name, keys in cited().items():
        for key in keys:
            if key not in issues:
                problems.append(f'{name} cites {key}, which is not in the snapshot')
            elif name == 'SEQUENCE' and issues[key]['state'] != 'OPEN' and key not in delivered:
                problems.append(f'SEQUENCE cites {key}, which is closed in the snapshot; move it to DELIVERED_SINCE and rewrite the sequence')
            elif name == 'DELIVERED_SINCE' and issues[key]['state'] == 'OPEN':
                problems.append(f'DELIVERED_SINCE lists {key}, which is still open in the snapshot')
    if problems:
        raise AssertionError('Direction text is stale: ' + '; '.join(problems))


def _keys(keys, issue_link):
    return ''.join(issue_link(key) for key in keys)


def leverage_rows(leverage, issues, scheduling_state, decisions, owner_later):
    """The top blockers with at least one open dependent, most total first."""
    rows = []
    for key, entry in leverage.items():
        if not entry['direct']:
            continue
        issue = issues[key]
        state = scheduling_state(key)
        label = 'Later by owner' if key in owner_later else SCHEDULING[state]
        marks = []
        if key in decisions:
            marks.append('decision, no code')
        if any(item['name'] == 'status:review' for item in issue['labels']):
            marks.append('in review')
        rows.append(dict(key=key, title=issue['title'], state=state, label=label, marks=marks,
                         direct=len(entry['direct']), total=len(entry['total']), dependents=entry['total']))
    rows.sort(key=lambda row: (-row['total'], -row['direct'], row['key'][0], int(row['key'][1:])))
    return rows[:TABLE_LIMIT]


def render(issues, leverage, issue_link, scheduling_state, decisions, owner_later, snapshot_label):
    """The `#direction` reference section; `snapshot_label` names the prerequisite snapshot."""
    check(issues)
    standing = ''.join(f'<div class="direction-surface"><dt>{html.escape(surface)}</dt><dd><p>{html.escape(text)}</p><p class="direction-keys">{_keys(keys, issue_link)}</p></dd></div>'
                       for surface, text, keys in STANDING)
    becoming = ''.join(f'<p>{html.escape(text)}{" " if keys else ""}{_keys(keys, issue_link)}</p>' for text, keys in BECOMING)
    sequence = ''.join(f'<li><p class="direction-keys">{_keys(keys, issue_link)}</p><p>{html.escape(why)}</p></li>' for keys, why in SEQUENCE)
    delivered = ''.join(f'<li><span class="direction-date">{html.escape(date)}</span> {_keys(keys, issue_link)} <span>{html.escape(note)}</span></li>' for date, keys, note in DELIVERED_SINCE)
    delivered_block = (f'<h4>Delivered since this direction was written</h4><ul class="direction-delivered">{delivered}</ul>' if delivered
                       else f'<p class="direction-note">Nothing in this sequence has closed since {html.escape(AS_OF)}. A refresh that finds a closed story moves it here and rewrites the sequence.</p>')
    improvements = ''.join(f'<li>{html.escape(text)} {_keys(keys, issue_link)}</li>' for text, keys in IMPROVEMENTS)
    ideas = ''.join(f'<li>{html.escape(text)} {_keys(keys, issue_link)}</li>' for text, keys in IDEAS)
    rows = leverage_rows(leverage, issues, scheduling_state, decisions, owner_later)
    headers = ['Story', 'State', 'Direct', 'Total', 'Unblocks']
    body = ''.join('<tr>' + ''.join(f'<td data-label="{header}">{cell}</td>' for header, cell in zip(headers, [
        f'{issue_link(row["key"])}<span class="direction-title">{html.escape(row["title"])}</span>',
        html.escape(row['label']) + ''.join(f'<span class="direction-mark">{html.escape(mark)}</span>' for mark in row['marks']),
        str(row['direct']), str(row['total']), _keys(row['dependents'], issue_link)])) + '</tr>' for row in rows)
    table = (f'<table class="leverage"><caption class="sr-only">Open stories ranked by the open stories that record them as a prerequisite</caption><thead><tr>{"".join(f"<th>{h}</th>" for h in headers)}</tr></thead><tbody>{body}</tbody></table>'
             if rows else '<p class="direction-note">No open story records another open story as a prerequisite in this snapshot.</p>')
    return f'''<details class="reference direction" id="direction">
      <summary><span class="guide-number">D</span><span class="guide-heading"><span class="eyebrow">Direction · dated · written by the owner</span><h2>Where B.U.N.N.Y. stands and what to build next</h2></span><span class="guide-count">as of {html.escape(AS_OF)}</span><span class="chevron" aria-hidden="true">−</span></summary>
      <div class="guide-body">
      <p class="direction-dated">Direction written {html.escape(AS_OF)} against hub <code>{html.escape(REVISION)}</code>; leverage computed from the {html.escape(snapshot_label)} prerequisite records. GitHub issues stay authoritative for scope and status; this text is dated editorial prose, and each issue link shows the story's own status.</p>
      <section class="direction-part" aria-labelledby="direction-standing"><h3 id="direction-standing">Where we stand</h3><dl class="direction-standing">{standing}</dl></section>
      <section class="direction-part" aria-labelledby="direction-becoming"><h3 id="direction-becoming">What it is becoming</h3>{becoming}</section>
      <section class="direction-part" aria-labelledby="direction-next"><h3 id="direction-next">Build next</h3><ol class="direction-sequence">{sequence}</ol>{delivered_block}</section>
      <section class="direction-part" aria-labelledby="direction-leverage"><h3 id="direction-leverage">Least work, most unblocked</h3>{table}
      <p class="direction-note">Direct counts the open stories whose recorded GitHub prerequisites name this story; Total follows those stories' own recorded prerequisites. Counts come from recorded GitHub prerequisites only: a dependency written only in prose is not counted, and a high count is not a priority. State is the story's own scheduling state; a blocked, deferred or owner-later story is listed as such and is not promoted by its count.</p></section>
      <section class="direction-part" aria-labelledby="direction-improve"><h3 id="direction-improve">Improve what exists</h3><ul class="direction-list">{improvements}</ul></section>
      <section class="direction-part" aria-labelledby="direction-ideas"><h3 id="direction-ideas">Later ideas</h3><ul class="direction-list">{ideas}</ul></section>
      <a class="back-top" href="#top">Back to overview <span aria-hidden="true">↑</span></a></div></details>'''
