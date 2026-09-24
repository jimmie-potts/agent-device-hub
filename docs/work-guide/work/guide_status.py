"""Issue-link status and conservative scheduling from the saved GitHub snapshot."""
import json

STATUS = {
    'open': ('○', 'Open'),
    'in-progress': ('◐', 'In progress'),
    'review': ('◐', 'In review'),
    'blocked': ('⊘', 'Blocked'),
    'completed': ('✓', 'Completed'),
    'closed': ('−', 'Closed'),
}


def labels(issue):
    return {label['name'] for label in issue['labels']}


def open_blockers(dependencies):
    return [dependency for dependency in dependencies if dependency['state'] != 'CLOSED']


def issue_status(issue, dependencies=()):
    if issue['state'] == 'CLOSED':
        return 'completed' if issue.get('stateReason') == 'completed' else 'closed'
    names = labels(issue)
    if 'status:review' in names:
        return 'review'
    if 'status:in-progress' in names:
        return 'in-progress'
    if 'blocked' in names or open_blockers(dependencies):
        return 'blocked'
    return 'open'


def is_blocked(issue, dependencies=()):
    return issue['state'] == 'OPEN' and bool('blocked' in labels(issue) or open_blockers(dependencies))


def scheduling_state(issue, dependencies):
    """No open native blockers is necessary, but never overrides a blocked/deferred label."""
    if issue['state'] == 'CLOSED':
        return 'closed'
    if is_blocked(issue, dependencies):
        return 'blocked'
    if 'deferred' in labels(issue):
        return 'deferred'
    if issue_status(issue, dependencies) in ('in-progress', 'review'):
        return 'active'
    return 'candidate'


def load_dependencies(backlogs, issues):
    hub = json.loads((backlogs / 'hub-native-deps.json').read_text())['data']['repository']
    devices = json.loads((backlogs / 'device-native-deps.json').read_text())['data']
    result = {}
    for prefix, repository in [('H', hub), ('N', devices['n']), ('P', devices['p'])]:
        inventory = repository['issues']
        assert not inventory['pageInfo']['hasNextPage'], 'Incomplete native issue inventory'
        assert inventory['totalCount'] == len(inventory['nodes'])
        for issue in inventory['nodes']:
            dependencies = issue['blockedBy']
            assert not dependencies['pageInfo']['hasNextPage'], 'Incomplete native dependencies'
            assert dependencies['totalCount'] == len(dependencies['nodes'])
            result[f'{prefix}{issue["number"]}'] = dependencies['nodes']
    assert set(result) == {key for key, issue in issues.items() if issue['state'] == 'OPEN'}
    return result


def overview_keys(issues, as_of):
    """Select snapshot views without turning recency or an absent blocker into priority."""
    from datetime import datetime, timedelta
    import re
    moment = datetime.fromisoformat(as_of.replace('Z', '+00:00'))
    def created(key):
        return datetime.fromisoformat(issues[key]['createdAt'].replace('Z', '+00:00'))
    opened = sorted((key for key, issue in issues.items() if issue['state'] == 'OPEN'),
                    key=lambda key: (-created(key).timestamp(), key))
    def priority(key):
        ranks = [int(match[1]) for label in labels(issues[key])
                 if (match := re.fullmatch(r'(?:priority:)?p([0-4])', label.lower()))]
        return min(ranks, default=5)
    return {
        'new': opened[:8],
        'week': [key for key in opened if moment - timedelta(days=7) <= created(key) <= moment],
        'defects': sorted((key for key in opened if 'bug' in labels(issues[key])),
                          key=lambda key: (priority(key), -created(key).timestamp(), key)),
        'current': [key for key in opened if labels(issues[key]) & {'status:in-progress', 'status:review'}],
    }
