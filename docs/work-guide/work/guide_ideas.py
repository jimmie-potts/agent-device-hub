"""The Ideas reference section: open stories whose Guide section carries an idea highlight.

The mark lives in the story (`**Highlight:** idea, <reason>` with an optional
`**Extends:** <keys>`), not in a curated file. Entries group by topic in
`guide_paths.TOPICS` order and, within a topic, by story key. The section is a
reference: ideas are counted in their topics, never here, and the mark is a
placement, not a priority or a status. `guide_overview.js` patches the same
markup from live GitHub reads.
"""
import html

from guide_status import sort_key

SCHEDULING = {'candidate': 'Candidate', 'active': 'Active', 'blocked': 'Blocked', 'deferred': 'Deferred'}


def marked(guide_state):
    """Open stories whose Guide section carries an idea highlight: {key: guide state}."""
    return {key: state for key, state in guide_state.items()
            if state['state'] == 'assigned' and state['highlight'] and state['highlight']['kind'] == 'idea'}


def ordered(ideas, topic_ids):
    """Idea keys in topic order, then key order within a topic."""
    rank = {topic: index for index, topic in enumerate(topic_ids)}
    return sorted(ideas, key=lambda key: (rank[ideas[key]['topic']], sort_key(key)))


def entry(key, state, issue, issue_link, scheduling_state):
    """One idea row; `guide_overview.js` builds the same shape for live rows."""
    status = scheduling_state(key)
    extends = ''.join(issue_link(other) for other in state['extends'])
    return (f'<li class="idea" data-key="{key}" data-topic="{html.escape(state["topic"], quote=True)}">'
            f'<p class="idea-head">{issue_link(key)}<span class="idea-title">{html.escape(issue["title"])}</span></p>'
            f'<p class="idea-reason">{html.escape(state["highlight"]["reason"])}</p>'
            f'<p class="idea-meta"><span class="idea-state" data-state="{status}">{SCHEDULING[status]}</span>'
            f'<span class="idea-extends"{"" if extends else " hidden"}><span class="idea-label">Extends</span>{extends}</span></p></li>')


def render(ideas, issues, topics, issue_link, scheduling_state, snapshot_label):
    """The `#ideas` reference section. `topics` is `[(id, title), ...]` in guide order."""
    keys = ordered(ideas, [topic for topic, _ in topics])
    groups = []
    for topic, title in topics:
        members = [key for key in keys if ideas[key]['topic'] == topic]
        if not members:
            continue
        rows = ''.join(entry(key, ideas[key], issues[key], issue_link, scheduling_state) for key in members)
        groups.append(f'<section class="ideas-topic" data-topic="{html.escape(topic, quote=True)}" aria-labelledby="ideas-{html.escape(topic, quote=True)}">'
                      f'<h3 id="ideas-{html.escape(topic, quote=True)}"><a href="#{html.escape(topic, quote=True)}">{html.escape(title)}</a></h3>'
                      f'<ul class="ideas-list">{rows}</ul></section>')
    count = len(keys)
    return f'''<details class="reference ideas" id="ideas">
      <summary><span class="guide-number">I</span><span class="guide-heading"><span class="eyebrow">Ideas · placement, not priority</span><h2>Creative and expansion ideas</h2></span><span class="guide-count" data-ideas-count>{count} marked</span><span class="chevron" aria-hidden="true">−</span></summary>
      <div class="guide-body">
      <p class="ideas-note">Open stories whose own Guide section marks them as an idea: a new capability, a generalization across devices or repositories, or a user-visible win that recent work made cheap. Each shows the observation that prompted it, the stories it would build on and its scheduling state. Ideas are counted in their topics, not here, and the mark is a placement, not a priority: it never promotes a blocked, deferred or owner-later story. Marks start from the {html.escape(snapshot_label)} snapshot and update from public GitHub when the page opens.</p>
      <div class="ideas-groups">{"".join(groups)}</div>
      <p class="ideas-empty"{" hidden" if count else ""}>No open story carries an idea mark.</p>
      <a class="back-top" href="#top">Back to overview <span aria-hidden="true">↑</span></a></div></details>'''


def nav_entry(count):
    return (f'<a href="#ideas" data-section="ideas"><span class="nav-number">I</span><span>Ideas</span>'
            f'<span class="nav-count" data-ideas-count aria-label="{count} marked ideas">{count:02}</span></a>')
