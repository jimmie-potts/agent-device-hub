"""Describe a saved guide refresh without changing story or Direction text."""
import argparse
from collections import Counter
import json
from pathlib import Path
import re

import guide_section
import recommendations
from refresh_backlogs import PREFIXES, REPOS


def load_snapshots(path):
    """Read complete issue snapshots, retaining recorded closed history evidence."""
    path = Path(path)
    result = {repo: json.loads((path / f'{repo}-issues.json').read_text(encoding='utf-8')) for repo in REPOS}
    history_path = path.parent / 'history' / 'github-history.json'
    if history_path.exists():
        history = json.loads(history_path.read_text(encoding='utf-8'))
        for repo, rows in result.items():
            held = {row['number'] for row in rows}
            rows.extend(dict(row, state='CLOSED', body='') for row in history['repositories'][repo]['closedIssues'] if row['number'] not in held)
    return result


def _text(value):
    # Tracker prose must remain text in Markdown, including embedded HTML.
    value = re.sub(r'\s+', ' ', str(value)).strip()
    return re.sub(r'([\\`*_{}\[\]<>#|])', r'\\\1', value)


def _topic(row):
    parsed = guide_section.read(row.get('body') or '')
    return parsed.get('topic') if parsed['state'] == 'assigned' else f"({parsed['state']})"


def _recommendation(row):
    if row is None:
        return 'absent'
    state = recommendations.read(row.get('body') or '')['state']
    return 'not yet assessed' if state == 'unassessed' else state


def check_direction(snapshots):
    """Run the owner-written checker without rewriting its narrative or rules."""
    import guide_direction
    issues = {PREFIXES[repo] + str(row['number']): row
              for repo, rows in snapshots.items() for row in rows}
    ideas = []
    for key, row in issues.items():
        parsed = guide_section.read(row.get('body') or '')
        if row['state'] == 'OPEN' and (parsed.get('highlight') or {}).get('kind') == 'idea':
            ideas.append(key)
    try:
        guide_direction.check(issues, ideas)
    except AssertionError as error:
        return [str(error)]
    return []


def render_report(before, after, *, refreshed_at, direction_errors=(), retired_warnings=()):
    lines = ['# Nightly guide refresh', '', f'Refreshed: {_text(refreshed_at)}', '',
             'Saved GitHub data and generated guide only. This PR does not merge or publish the guide.', '']
    for repo in sorted(set(before) | set(after)):
        old = {row['number']:row for row in before.get(repo, [])}
        new = {row['number']:row for row in after.get(repo, [])}
        prefix = PREFIXES.get(repo, repo + '#')
        changes = []
        recommendation_changes = []
        for number in sorted(set(old) | set(new)):
            previous, current = old.get(number), new.get(number)
            key = f'{prefix}{number}'
            was_open = previous is not None and previous['state'] == 'OPEN'
            is_open = current is not None and current['state'] == 'OPEN'
            if is_open and not was_open:
                kind = 'Reopened' if previous else 'Opened'
                changes.append(f'- {kind}: {key} — {_text(current["title"])}')
            elif was_open and current is None:
                changes.append(f'- Missing from snapshot (closure unverified): {key} — {_text(previous["title"])}')
            elif was_open and not is_open:
                changes.append(f'- Closed: {key} — {_text(current["title"])}')
            if previous and current:
                if previous['title'] != current['title']:
                    changes.append(f'- Retitled: {key} — {_text(previous["title"])} → {_text(current["title"])}')
                labels = lambda row: sorted(label['name'] if isinstance(label, dict) else label for label in row.get('labels', []))
                if 'labels' in previous and 'labels' in current and labels(previous) != labels(current):
                    changes.append(f'- Relabelled: {key} — {_text(", ".join(labels(previous)) or "none")} → {_text(", ".join(labels(current)) or "none")}')
                if is_open and _topic(previous) != _topic(current):
                    changes.append(f'- Topic: {key} — {_text(_topic(previous))} → {_text(_topic(current))}')
            # Closed evidence has no execution recommendation to act on.
            if is_open and _recommendation(previous) != _recommendation(current):
                recommendation_changes.append(f'- {key} — {_recommendation(previous)} → {_recommendation(current)}')
        lines.extend([f'## {repo}', '', *(changes or ['No story state, title, label or topic changes.']), '', 'Topic counts (open stories):', ''])
        old_counts = Counter(_topic(row) for row in old.values() if row['state'] == 'OPEN')
        new_counts = Counter(_topic(row) for row in new.values() if row['state'] == 'OPEN')
        for topic in sorted(set(old_counts) | set(new_counts)):
            lines.append(f'- {_text(topic)}: {old_counts[topic]} → {new_counts[topic]}')
        if not old_counts and not new_counts:
            lines.append('- No open stories.')
        lines.extend(['', 'Recommendation state changes:', '', *(recommendation_changes or ['None.']), ''])
    if direction_errors:
        lines.extend(['## Direction check: failed', '', '**needs owner rewrite of guide_direction.py**', ''])
        lines.extend(f'- {_text(error)}' for error in direction_errors)
    else:
        lines.extend(['## Direction check: passed', '', 'The existing Direction checks passed; the narrative remains owner-written.'])
    lines.extend(['', '## Retired-term warnings', ''])
    lines.extend([f'- {_text(warning)}' for warning in retired_warnings] or ['None reported.'])
    return '\n'.join(lines) + '\n'


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--before', required=True, type=Path, help='Previous backlogs directory')
    parser.add_argument('--after', required=True, type=Path, help='Refreshed backlogs directory')
    parser.add_argument('--refreshed-at', help='Defaults to the refreshed snapshot timestamp')
    parser.add_argument('--direction-errors', type=Path, help='JSON list from the existing Direction check')
    parser.add_argument('--retired-warnings', type=Path, help='JSON list from the retired-term check')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args(argv)
    def messages(path):
        if path is None:
            return []
        value = json.loads(path.read_text(encoding='utf-8'))
        if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
            raise ValueError(f'{path}: expected a JSON list of messages')
        return value
    refreshed_at = args.refreshed_at or json.loads((args.after / 'snapshot.json').read_text(encoding='utf-8'))['refreshedAt']
    after = load_snapshots(args.after)
    direction_errors = messages(args.direction_errors) if args.direction_errors else check_direction(after)
    result = render_report(load_snapshots(args.before), after, refreshed_at=refreshed_at,
                           direction_errors=direction_errors, retired_warnings=messages(args.retired_warnings))
    if args.output:
        args.output.write_text(result, encoding='utf-8')
    else:
        print(result, end='')


if __name__ == '__main__':
    main()
