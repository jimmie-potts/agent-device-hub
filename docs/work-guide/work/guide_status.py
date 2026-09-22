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
