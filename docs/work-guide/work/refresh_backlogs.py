"""Read GitHub planning records; never mutate issues or pull requests."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
import json
import subprocess
import time

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / 'work' / 'backlogs'
REPOS = ['agent-device-hub', 'codex-nanoleaf', 'divoom-app-upgrade']


def api(endpoint):
    for attempt in range(3):
        result = subprocess.run(['gh', 'api', endpoint], capture_output=True, text=True)
        if result.returncode == 0:
            return json.loads(result.stdout)
        if attempt == 2 or not any(code in result.stderr for code in ('502', '503', '504', 'connection reset', 'timeout')):
            raise RuntimeError(f'GitHub read failed for {endpoint}: {result.stderr.strip()}')
        time.sleep(attempt + 1)


def pages(endpoint):
    values, sizes = [], []
    for page in range(1, 101):
        data = api(f'{endpoint}{"&" if "?" in endpoint else "?"}per_page=100&page={page}')
        assert isinstance(data, list)
        sizes.append(len(data))
        values.extend(data)
        if len(data) < 100:
            return values, sizes
    raise RuntimeError(f'Pagination did not terminate: {endpoint}')


def normalize(issue, comments=None):
    assert issue['state'] in ('open', 'closed'), issue
    return {
        'number': issue['number'], 'state': issue['state'].upper(),
        'stateReason': issue.get('state_reason'), 'title': issue['title'],
        'body': issue['body'], 'url': issue['html_url'],
        'updatedAt': issue['updated_at'], 'closedAt': issue.get('closed_at'),
        'labels': [{'name': label['name']} for label in issue['labels']],
        'milestone': issue['milestone'], 'comments': comments or [],
        'commentCount': issue['comments'],
        'commentsRefreshed': comments is not None,
    }


def refresh_repo(repo):
    base = f'repos/jimmie-potts/{repo}'
    rows, sizes = pages(f'{base}/issues?state=open&sort=created&direction=asc')
    issues = [normalize(row) for row in rows if 'pull_request' not in row]
    assert all(i['state'] == 'OPEN' for i in issues)
    assert len({i['number'] for i in issues}) == len(issues)
    # Comments are acceptance evidence for these direct status reads.
    targets = {'agent-device-hub': [2, 50, 83, 91], 'codex-nanoleaf': [26, 34, 37, 52, 53, 54, 55], 'divoom-app-upgrade': [12, 26, 29, 46]}[repo]
    direct = []
    for number in targets:
        raw = api(f'{base}/issues/{number}')
        comments, comment_sizes = pages(f'{base}/issues/{number}/comments')
        issue = normalize(raw, [{'body': c['body'], 'url': c['html_url'], 'createdAt': c['created_at'], 'updatedAt': c['updated_at']} for c in comments])
        assert (issue['state'] == 'OPEN') == any(i['number'] == number for i in issues)
        issues = [i for i in issues if i['number'] != number] + [issue]
        direct.append({'number': number, 'state': issue['state'], 'commentPages': comment_sizes})
    if repo == 'agent-device-hub':
        for number in (4, 7):
            baseline = normalize(api(f'{base}/issues/{number}'))
            assert baseline['state'] == 'CLOSED'
            issues.append(baseline)
            direct.append({'number': number, 'state': baseline['state'], 'purpose': 'Completed contract/MCP baseline'})
    prs, pr_sizes = pages(f'{base}/pulls?state=open')
    def write(name, value):
        (DEST / name).write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')
    write(f'{repo}-issues.json', sorted(issues, key=lambda i: i['number']))
    write(f'{repo}-prs.json', [{k:p.get(k) for k in ('number','title','body','state','html_url','updated_at','draft','head','base')} for p in prs])
    (DEST / f'{repo}-digest.txt').write_text('\n'.join(f"#{i['number']} [{i['state']}] {i['title']}" for i in sorted(issues, key=lambda i:i['number']))+'\n')
    return repo, {'openIssues': sum(i['state'] == 'OPEN' for i in issues), 'openIssueEndpoint': f'{base}/issues?state=open', 'issuePageSizesIncludingPRs': sizes, 'openPRs':len(prs), 'prPageSizes': pr_sizes, 'paginationComplete': True, 'directReads': direct}


if __name__ == '__main__':
    started = datetime.now(timezone.utc).isoformat()
    with ThreadPoolExecutor(max_workers=3) as pool:
        repos = dict(pool.map(refresh_repo, REPOS))
    # Read the documentation PR itself rather than inferring status from issue data.
    pr = api('repos/jimmie-potts/agent-device-hub/pulls/59')
    checks, check_pages = pages(f"repos/jimmie-potts/agent-device-hub/commits/{pr['head']['sha']}/statuses")
    evidence = {'pullRequest': {k: pr.get(k) for k in ('number','title','body','state','merged','merged_at','html_url','updated_at')}, 'head':pr['head']['sha'], 'commitStatuses':checks, 'statusPageSizes':check_pages}
    check_runs = api(f"repos/jimmie-potts/agent-device-hub/commits/{pr['head']['sha']}/check-runs?per_page=100")
    assert check_runs['total_count'] <= 100, 'Add pagination before interpreting checks'
    evidence['checkRuns'] = check_runs
    def annotations(run):
        values, sizes = pages(f"repos/jimmie-potts/agent-device-hub/check-runs/{run['id']}/annotations")
        return {'checkRunId':run['id'], 'name':run['name'], 'annotations':values, 'pageSizes':sizes}
    with ThreadPoolExecutor(max_workers=4) as pool:
        evidence['annotations'] = list(pool.map(annotations, check_runs['check_runs']))
    (DEST/'pc-lighting-pr-59.json').write_text(json.dumps(evidence,indent=2)+'\n')
    # GraphQL provides a second explicit open-issue enumeration plus native prerequisites.
    fields = 'issues(first:100, states:OPEN) { totalCount pageInfo { hasNextPage } nodes { number blockedBy(first:100) { totalCount pageInfo { hasNextPage } nodes { number state repository { nameWithOwner } } } } }'
    aliases = {'h':'agent-device-hub', 'n':'codex-nanoleaf', 'p':'divoom-app-upgrade'}
    query = '{' + ' '.join(f'{key}:repository(owner:"jimmie-potts",name:"{repo}"){{{fields}}}' for key,repo in aliases.items()) + '}'
    native = json.loads(subprocess.run(['gh','api','graphql','-f',f'query={query}'],check=True,capture_output=True,text=True).stdout)
    assert not native.get('errors'), native
    for key, repo in aliases.items():
        inventory = native['data'][key]['issues']
        assert not inventory['pageInfo']['hasNextPage'], 'Paginate before accepting a larger inventory'
        assert inventory['totalCount'] == len(inventory['nodes']) == repos[repo]['openIssues']
        cached = json.loads((DEST/f'{repo}-issues.json').read_text())
        assert {i['number'] for i in inventory['nodes']} == {i['number'] for i in cached if i['state']=='OPEN'}
        for issue in inventory['nodes']:
            prerequisites = issue['blockedBy']
            assert not prerequisites['pageInfo']['hasNextPage']
            assert prerequisites['totalCount'] == len(prerequisites['nodes'])
    (DEST/'hub-native-deps.json').write_text(json.dumps({'data':{'repository':native['data']['h']}},indent=2)+'\n')
    (DEST/'device-native-deps.json').write_text(json.dumps({'data':{key:native['data'][key] for key in ('n','p')}},indent=2)+'\n')
    snapshot = {'startedAt':started, 'refreshedAt':datetime.now(timezone.utc).isoformat(), 'staticSnapshot':True, 'repositories':repos, 'openIssues':sum(r['openIssues'] for r in repos.values()), 'statusSource':'Explicit state=open REST queries with terminal pagination, independently reconciled with GraphQL OPEN inventories and native prerequisite pageInfo; direct acceptance issue and PR reads.', 'commentsScope':'Only the listed acceptance and documentation reads include refreshed comments; other issue bodies, states and labels are current.'}
    (DEST/'snapshot.json').write_text(json.dumps(snapshot,indent=2)+'\n')
    print(json.dumps(snapshot,indent=2))
