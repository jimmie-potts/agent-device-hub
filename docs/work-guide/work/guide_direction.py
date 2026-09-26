"""The dated Direction section: the owner's narrative plus a computed leverage table.

`AS_OF` and `REVISION` date the narrative and pin it to the hub commit it was
written against. The text renders literally; issue keys render through the
guide's `issue_link`, so they carry the same status icon and live GitHub
relabel as every other link. `check()` runs against the saved snapshot before
the section is rendered: an unknown key, a `SEQUENCE` key that has closed
without a `DELIVERED_SINCE` entry, a `DELIVERED_SINCE` key that is still open,
or a `SEQUENCE` key whose story carries an idea highlight fails the build
naming the key, so the direction text is rewritten with the refresh instead of
going stale. The leverage table is recomputed from the saved native
prerequisite records at every build and is never typed by hand. "Later ideas"
is derived from the stories' own idea marks (see `guide_ideas.py`); there is no
hand-written list beside it.
"""
import html

AS_OF = '2026-09-26'
REVISION = '490ad5a'

# Where B.U.N.N.Y. stands on each surface: (surface, one or two sentences, evidence keys).
STANDING = [
    ('Nanoleaf Lines and Panels',
     'Installed on the Linux runtime and following shared monitoring, with the Lines and the NL22 Panels as independent devices. '
     'Codex titles, the compact inspector, configurable Work-mode colors, saved-scene playback, the Lines/Panels map selector, Panels control through the controller and MCP, and read-only element geometry for the hub are delivered. The Panels are installed in the controller, MCP host and hub; dashboard controls for their read-only integration snapshot are delivered in source.',
     ['N46', 'N139', 'N91', 'N44', 'N113', 'N169', 'N167']),
    ('Pixoo',
     'Installed as a user service with hub settings; Monitor and Media controls are verified on the display, and now-playing cards are installed and checked. '
     'Two media defects remain visible on the device: extra GIF flashes and cloud content after screen-on or a reboot.',
     ['P77', 'P34', 'P89', 'P52', 'P76']),
    ('Tidbyt',
     'Agent status and the now-playing card are installed and verified on the cloud-connected device, and the installed local controller host gives it a B.U.N.N.Y. page. The Tronbyt move waits on the dedicated server and is one of its triggers (ADR 0008).',
     ['H21', 'H38', 'H289', 'H23', 'H44']),
    ('LIFX',
     'The LAN controller runs in the installed local controller host, and B.U.N.N.Y. shows real bulb power. Automatic status for the qualified A19 is delivered in source; the #22 trial found an uncertain-session painting issue. Its #439 fix has merged; #22 retains installation and physical acceptance. The Beam is its own story.',
     ['H18', 'H289', 'H330', 'H20', 'H22', 'H439', 'H319']),
    ('PC lighting',
     'Later by the owner\'s choice. Every story waits on hardware qualification, so nothing here is scheduled.',
     ['H51', 'H53']),
    ('Playback',
     'Shared playback with both the Sony HT-A9 and Sonos Move sources is installed, with the #233 playback check recorded on hub 0.3.11, alongside now-playing in B.U.N.N.Y., Codex tools, Pixoo and Tidbyt. The Move supplies play and resume. Sources rank by session presence, freshness class, then configured order, under one stable playback ID. The Windows connector stays deferred and PC-local, with a relay after the server move.',
     ['H175', 'H37', 'H38', 'H242', 'H233']),
    ('Hub and dashboard',
     'B.U.N.N.Y. carries the Neon skin, one-step device settings and one command lifecycle for forms and actions. The dense widget home, gesture-driven controls, shared Prism art and hash routes are delivered in source. '
     'Shared monitoring runs as an installed service with Codex Desktop read state, 24-hour session expiry and consistent retirement across Codex and Claude. '
     'The six services still start only with a WSL login; ADR 0008 chose linger, an idle timeout and one scheduled task on the PC, with a dedicated server behind a trigger.',
     ['H182', 'H231', 'H245', 'H277', 'H191', 'H195', 'H241', 'H356', 'H44']),
    ('Steam Deck',
     'Planned only: seven stories filed on 2026-09-25 make the Deck a couch control for agents and B.U.N.N.Y. and a Steam event source for the room. '
     'The route to the loopback hub is the owner\'s first decision; the story launcher on WSL is ready now.',
     ['H378', 'H384', 'H379', 'H382']),
    ('Guide and atlas',
     'Published in the Neon skin with task briefs, live GitHub status, a starting-session recommendation per story, story-owned topic placement and an Ideas section. The atlas playback prose now matches the installed speaker sources. Reconciling story text made stale today and recording recommendations for the new stories come next, then the nightly rolling refresh.',
     ['H197', 'H252', 'H259', 'H308', 'H401', 'H315']),
]

# What it is becoming: (paragraph, direction keys).
BECOMING = [
    ('One interface. B.U.N.N.Y., the dashboard, is the shell (ADR 0007, 2026-09-25): a page per device and a group page drawn with shared device art ported from the wall map\'s Prism renderer. The wall map stays Nanoleaf\'s advanced editor until every operation has a shell home, then retires.',
     ['H271', 'H355', 'N169', 'N170', 'N171']),
    ('One system of colors and looks. The same status and project colors on every device, and coordinated Free and Quiet looks started from the hub, building on the fixed desk-preset mappings.',
     ['H267', 'H67']),
    ('One task pool. In Work, devices join or leave a shared pool while each keeps its own writer and identity.',
     ['H272', 'N47']),
    ('Moments. Events such as a merged pull request or a meeting soon play a short interlude on each device, arbitrated by the hub (ADR 0006).',
     ['H358', 'H335', 'H297']),
    ('Always on. The runtime starts at boot in WSL and moves to a dedicated Linux server when a trigger fires (ADR 0008).',
     ['H356', 'H44']),
    ('The owner\'s test for new work: something visible on a device or in B.U.N.N.Y. that they can interact with, chosen as the least work that unblocks the most.',
     []),
]

# What to build next, in order: (keys, why).
SEQUENCE = [
    (['H67'], 'Desk presets with fixed Work, Free and Quiet mappings across Nanoleaf and Pixoo: the smallest visible cross-device win and the base for coordinated modes. The tracker still marks it deferred until the owner selects it.'),
    (['H356'], 'Start the WSL runtime at boot: linger, an idle timeout and one scheduled task, so the lights, map, Pixoo and hub are back after a restart without opening a terminal (ADR 0008).'),
    (['N112', 'N81', 'N115'], 'Wall presentation the owner sees directly: show the Lines hold and how to resume it, queue the delayed completion comet, and keep comets and waves when the worker skips revisions.'),
]

# Changes to what already exists: (text, keys).
IMPROVEMENTS = [
    ('Pixoo MCP status after dashboard uploads is fixed in source. Preventing cloud content after screen-on and reboots remains separate work.', ['P79', 'P76']),
    ('Tidbyt: check stale-status readability with night mode enabled.', ['H227']),
    ('Dashboard: stop component aliases colliding with built-in pages.', ['H247']),
    ('Guide: mission-map navigation and signal playback build on the delivered Neon restyle, once their stale blocked labels are cleared.', ['H201', 'H202']),
]

# Keys moved out of SEQUENCE at a refresh: (date, keys, note).
DELIVERED_SINCE = [
    ('2026-09-26', ['H277'], 'The dense dashboard home, gesture-driven controls and hash routes are delivered in source; #444 owns installation and the installed dashboard check.'),
    ('2026-09-26', ['H20'], 'LIFX automatic status is delivered in source; #22 retains installation and physical acceptance.'),
    ('2026-09-26', ['H355'], 'Shared Prism device art is delivered in the dashboard source.'),
    ('2026-09-26', ['H233'], 'The Sonos Move source is installed and checked on hub 0.3.11, including paused track changes and Sony-only presentation.'),
    ('2026-09-25', ['H241'], 'Consistent retirement across Codex and Claude merged; cross-device eviction and the Nanoleaf Work/Free switch no longer wait on it.'),
    ('2026-09-25', ['N44', 'N113'], 'The Lines/Panels map selector and Panels control through the controller and MCP are delivered in source.'),
    ('2026-09-25', ['H37'], 'Now-playing with Sony-qualified controls is installed and its installed acceptance passed; the Sonos Move follows as the second source.'),
    ('2026-09-25', ['N169'], 'Read-only element geometry for the Lines and Panels is delivered in source, with the hub\'s sibling route, and installed on the Nanoleaf runtime; the installed hub serves it after its next upgrade.'),
]

SCHEDULING = {'candidate': 'Candidate', 'active': 'Active', 'blocked': 'Blocked', 'deferred': 'Deferred', 'closed': 'Closed'}
TABLE_LIMIT = 10


def cited():
    """Every key the narrative cites, by list name, in order of appearance."""
    lists = {'STANDING': [key for _, _, keys in STANDING for key in keys],
             'BECOMING': [key for _, keys in BECOMING for key in keys],
             'SEQUENCE': [key for keys, _ in SEQUENCE for key in keys],
             'IMPROVEMENTS': [key for _, keys in IMPROVEMENTS for key in keys],
             'DELIVERED_SINCE': [key for _, keys, _ in DELIVERED_SINCE for key in keys]}
    return lists


def check(issues, ideas=()):
    """Fail, naming the key, when the narrative no longer fits the saved snapshot.
    `ideas` is the set of open stories whose Guide section carries an idea
    highlight: "build next" and "later idea" are exclusive."""
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
            if name == 'SEQUENCE' and key in ideas:
                problems.append(f'SEQUENCE cites {key}, whose story carries an idea highlight; build next and later idea are exclusive, so remove one')
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


def render(issues, leverage, issue_link, scheduling_state, decisions, owner_later, snapshot_label, ideas=()):
    """The `#direction` reference section; `snapshot_label` names the prerequisite snapshot.
    `ideas` lists the marked idea stories in Ideas-section order."""
    check(issues, set(ideas))
    standing = ''.join(f'<div class="direction-surface"><dt>{html.escape(surface)}</dt><dd><p>{html.escape(text)}</p><p class="direction-keys">{_keys(keys, issue_link)}</p></dd></div>'
                       for surface, text, keys in STANDING)
    becoming = ''.join(f'<p>{html.escape(text)}{" " if keys else ""}{_keys(keys, issue_link)}</p>' for text, keys in BECOMING)
    sequence = ''.join(f'<li><p class="direction-keys">{_keys(keys, issue_link)}</p><p>{html.escape(why)}</p></li>' for keys, why in SEQUENCE)
    delivered = ''.join(f'<li><span class="direction-date">{html.escape(date)}</span> {_keys(keys, issue_link)} <span>{html.escape(note)}</span></li>' for date, keys, note in DELIVERED_SINCE)
    delivered_block = (f'<h4>Delivered since this direction was written</h4><ul class="direction-delivered">{delivered}</ul>' if delivered
                       else f'<p class="direction-note">Nothing in this sequence has closed since {html.escape(AS_OF)}. A refresh that finds a closed story moves it here and rewrites the sequence.</p>')
    improvements = ''.join(f'<li>{html.escape(text)} {_keys(keys, issue_link)}</li>' for text, keys in IMPROVEMENTS)
    later = ''.join(f'<li data-key="{key}">{issue_link(key)}<span class="direction-idea-title">{html.escape(issues[key]["title"])}</span></li>' for key in ideas)
    rows = leverage_rows(leverage, issues, scheduling_state, decisions, owner_later)
    headers = ['Story', 'State', 'Direct', 'Total', 'Unblocks']
    body = ''.join('<tr>' + ''.join(f'<td data-label="{header}">{cell}</td>' for header, cell in zip(headers, [
        f'{issue_link(row["key"])}<span class="direction-title">{html.escape(row["title"])}</span>',
        html.escape(row['label']) + ''.join(f'<span class="direction-mark">{html.escape(mark)}</span>' for mark in row['marks']),
        str(row['direct']), str(row['total']), _keys(row['dependents'], issue_link)])) + '</tr>' for row in rows)
    table = (f'<table class="leverage"><caption class="sr-only">Open stories ranked by the open stories that record them as a prerequisite</caption><thead><tr>{"".join(f"<th scope=\"col\">{h}</th>" for h in headers)}</tr></thead><tbody>{body}</tbody></table>'
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
      <section class="direction-part" aria-labelledby="direction-ideas"><h3 id="direction-ideas">Later ideas</h3><ul class="direction-list direction-ideas">{later}</ul>
      <p class="direction-note direction-ideas-empty"{" hidden" if ideas else ""}>No open story carries an idea mark.</p>
      <p class="direction-note">Derived from each story's own idea mark, in topic order. <a href="#ideas">Read every idea with its reason and what it extends →</a></p></section>
      <a class="back-top" href="#top">Back to overview <span aria-hidden="true">↑</span></a></div></details>'''
