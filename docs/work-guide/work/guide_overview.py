"""Snapshot rendering for the opening lists; live reads use the same public fields.
`next_steps`, `decisions`, `later` and `workarounds` are the build's derived
per-story Guide-section highlights and workarounds (build_guide.py's
NEXT_STEPS, DECISIONS, OWNER_LATER and WORKAROUNDS)."""
import html
import json
import guide_status as GS


def render_overview(issues, dependencies, as_of, owners, titles, issue_link, gate_text, recommendation,
                    next_steps, decisions_data, owner_later, workarounds):
    selected = GS.overview_keys(issues, as_of)
    def card(key, description=None):
        issue = issues[key]
        labels = GS.labels(issue)
        qualifiers = []
        if 'deferred' in labels or key in owner_later:
            qualifiers.append('Later by owner choice' if key in owner_later else 'Deferred')
        priority = sorted(label for label in labels if label.lower().startswith('priority:') or label.lower() in ('p0', 'p1', 'p2', 'p3', 'p4'))
        qualifiers.extend(priority)
        guide = owners[key]
        return (f'<article class="work-card" data-key="{key}"><h3>{html.escape(issue["title"])}</h3>'
                + issue_link(key) + recommendation(key) + f'<p class="work-meta">Created <time datetime="{issue["createdAt"]}">{issue["createdAt"][:10]}</time> UTC'
                + (f' · {html.escape(" · ".join(qualifiers))}' if qualifiers else '') + '</p>'
                + (f'<p>{html.escape(description)}</p>' if description else '')
                + f'<p class="work-gate">{gate_text(key)}</p>'
                + (f'<p>Workaround: {html.escape(workarounds[key])}</p>' if key in workarounds else '')
                + f'<a href="#{guide}">{html.escape(titles[guide])} →</a></article>')
    def cards(keys, descriptions=None):
        return '<div class="work-grid">' + ''.join(card(key, (descriptions or {}).get(key)) for key in keys) + '</div>' if keys else '<p class="work-empty">None in this view.</p>'
    def section(id, title, note, body):
        return f'<section class="work-view" id="{id}" aria-labelledby="{id}-title"><h2 id="{id}-title">{title}</h2><p>{note}</p><div data-view-content>{body}</div></section>'
    opened = [key for key, issue in issues.items() if issue['state'] == 'OPEN']
    next_keys = [key for key in next_steps if key in opened and key not in owner_later and GS.scheduling_state(issues[key], dependencies.get(key, [])) == 'candidate']
    blockers = [key for key in opened if GS.is_blocked(issues[key], dependencies.get(key, [])) and 'deferred' not in GS.labels(issues[key]) and key not in owner_later]
    decisions = [key for key in decisions_data if key in opened and key not in blockers and 'deferred' not in GS.labels(issues[key])]
    later = [key for key in opened if 'deferred' in GS.labels(issues[key]) or key in owner_later]
    later.sort(key=lambda key: (key not in owner_later, key))
    new_body = cards(selected['new']) + '<details class="overview-more"><summary>Show all open issues created in the last seven days</summary>' + cards(selected['week']) + '</details>'
    later_body = cards([key for key in later if key in owner_later], owner_later) + '<details class="overview-more"><summary>Browse deferred work</summary>' + cards([key for key in later if key not in owner_later]) + '</details>'
    sections = [
        section('current-work', 'Current work', 'Issues marked in progress or in review. A blocked qualifier remains visible.', cards(selected['current'])),
        section('newly-added', 'Newly added', 'The latest eight open issues by creation date. Recent ideas may deserve attention; recency does not assign priority.', new_body),
        section('open-defects', 'Open defects', 'Every open bug across Hub, Nanoleaf and Pixoo, including blocked and deferred defects. Explicit P0–P4 priority comes first, then newest. Workarounds appear only when recorded here.', cards(selected['defects'])),
        section('next-steps', 'Useful next steps', 'Selected for their benefit, with recorded gates checked. Absence of a blocker alone does not make an issue a recommendation.', cards(next_keys, next_steps)),
        section('work-blockers', 'Blockers and decisions', 'Current blocked work and concrete choices needed before starting. Deferred tracks are grouped below.', cards(sorted(set(blockers + decisions)), decisions_data)),
        section('later-work', 'Later', 'Available to revisit without promoting these tracks as the next priority.', later_body),
    ]
    payload = dict(asOf=as_of, owners=owners, titles=titles, nextSteps=next_steps, decisions=decisions_data, later=owner_later, workarounds=workarounds,
                   issues={key: {name: issue[name] for name in ('number', 'title', 'url', 'state', 'createdAt', 'labels')} | {'blocked': GS.is_blocked(issue, dependencies.get(key, [])), 'gate': gate_text(key)} for key, issue in issues.items() if issue['state'] == 'OPEN'})
    encoded = json.dumps(payload, ensure_ascii=False).replace('<', r'\u003c')
    return '<div id="work-overview"><p id="overview-freshness" class="work-freshness" role="status">Opening lists from the ' + html.escape(as_of) + ' snapshot. Checking GitHub when online.</p><div id="parallel-work"></div>' + ''.join(sections) + '</div><script id="overview-data" type="application/json">' + encoded + '</script>'
