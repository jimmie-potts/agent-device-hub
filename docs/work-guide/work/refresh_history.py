"""Refresh saved history with complete, read-only GitHub REST queries."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import tempfile
from urllib.parse import quote

from refresh_backlogs import api

DEFAULT = Path(__file__).resolve().parent / 'history' / 'github-history.json'


def pages(endpoint, reader=api):
    """Collect every page, failing rather than accepting an incomplete result."""
    rows = []
    for page in range(1, 1001):
        result = reader(f'{endpoint}{"&" if "?" in endpoint else "?"}per_page=100&page={page}')
        if not isinstance(result, list):
            raise ValueError(f'Expected a list from {endpoint}')
        rows.extend(result)
        if len(result) < 100:
            return rows
    raise RuntimeError(f'Pagination did not terminate: {endpoint}')


def _unique(rows, field, description):
    if len({row[field] for row in rows}) != len(rows):
        raise ValueError(f'Duplicate {description} across pages; retry the refresh')


def repository(name, reader=api):
    base = f'repos/jimmie-potts/{name}'
    metadata = reader(base)
    branch = metadata['default_branch']
    head = reader(f'{base}/commits/{quote(branch, safe="")}')['sha']
    # Pin commit enumeration before reading any other mutable repository lists.
    commits = pages(f'{base}/commits?sha={quote(head, safe="")}', reader)
    # The rolling PR is output of this refresh, not a new history input.
    pulls = [row for row in pages(f'{base}/pulls?state=all&sort=created&direction=asc', reader)
             if row.get('head', {}).get('ref') != 'guide/nightly-refresh']
    issues = [row for row in pages(f'{base}/issues?state=all&sort=created&direction=asc', reader)
              if 'pull_request' not in row]
    _unique(commits, 'sha', 'commits')
    _unique(pulls, 'number', 'pull requests')
    _unique(issues, 'number', 'issues')
    if not commits or commits[0]['sha'] != head:
        raise ValueError(f'{name}: commit inventory does not start at the pinned head')
    if any(row['state'] not in ('open', 'closed') for row in issues):
        raise ValueError(f'{name}: unknown issue state')
    def pull(row):
        return {'number': row['number'], 'title': row['title'], 'createdAt': row['created_at'],
                'url': row['html_url'], 'base': row['base']['ref']}
    created = sorted(row['created_at'] for row in issues)
    return {
        'createdAt': metadata['created_at'], 'pushedAt': metadata['pushed_at'],
        'defaultBranch': branch, 'headSha': head, 'mainCommitCount': len(commits),
        'firstCommitAt': commits[-1]['commit']['committer']['date'],
        'mainCommits': [{'sha': row['sha'], 'date': row['commit']['committer']['date'],
                         'message': row['commit']['message'].split('\n')[0]} for row in commits],
        'mergedPRs': sorted((dict(pull(row), mergedAt=row['merged_at']) for row in pulls if row['merged_at']), key=lambda row: row['number']),
        'openPRs': sorted((pull(row) for row in pulls if row['state'] == 'open'), key=lambda row: row['number']),
        'closedIssues': sorted(({'number': row['number'], 'title': row['title'], 'closedAt': row['closed_at'],
                                 'createdAt': row['created_at'], 'stateReason': row.get('state_reason'),
                                 'url': row['html_url']} for row in issues if row['state'] == 'closed'), key=lambda row: row['number']),
        'openIssueCount': sum(row['state'] == 'open' for row in issues),
        'issueCreatedRange': [created[0], created[-1]] if created else [],
        'issuesCreatedByDay': dict(sorted(Counter(value[:10] for value in created).items())),
    }


def build_history(previous, reader=api, fetched_at=None):
    """Keep the saved schema and repository order; collect before writing."""
    return {'fetchedAt': fetched_at or datetime.now(timezone.utc).isoformat(),
            'source': previous['source'],
            'repositories': {name: repository(name, reader) for name in previous['repositories']}}


def history_differences(before, after):
    """Describe corrections or removals to retained entries, as well as additions."""
    changes = []
    for name, current in after['repositories'].items():
        previous = before.get('repositories', {}).get(name, {})
        for field, identity in (('mainCommits', 'sha'), ('mergedPRs', 'number'), ('openPRs', 'number'), ('closedIssues', 'number')):
            old = {row[identity]: row for row in previous.get(field, [])}
            new = {row[identity]: row for row in current[field]}
            added = [key for key in new if key not in old]
            changed = [key for key in old if key in new and old[key] != new[key]]
            removed = [key for key in old if key not in new]
            if list(old) != list(new) and old == new:
                changes.append(f'{name} {field}: order normalized')
            if added or changed or removed:
                changes.append(f'{name} {field}: added {added}; changed {changed}; removed {removed}')
    return changes


def refresh(path=DEFAULT, reader=api, fetched_at=None):
    path = Path(path)
    previous = json.loads(path.read_text(encoding='utf-8'))
    current = build_history(previous, reader, fetched_at)
    # A rolling branch push changes pushedAt without changing main history.
    # Retain the entire previous observation (including its honest fetchedAt)
    # when that and the read time are the only differences.
    substantive = lambda value: {name: {key: item for key, item in repo.items() if key != 'pushedAt'}
                                 for name, repo in value['repositories'].items()}
    if substantive(current) == substantive(previous):
        return previous
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent,
                                         prefix=f'.{path.name}.', delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(json.dumps(current, indent=2, ensure_ascii=False) + '\n')
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return current


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('path', nargs='?', type=Path, default=DEFAULT)
    args = parser.parse_args(argv)
    before = json.loads(args.path.read_text(encoding='utf-8'))
    after = refresh(args.path)
    print('\n'.join(history_differences(before, after)) or 'History entries unchanged.')


if __name__ == '__main__':
    main()
