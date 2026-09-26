"""Publish verified guide artifacts to one leased branch and one rolling PR.

Validation belongs to the caller. This module reports its actual result against
exactly the commit it pushes; it never validates, merges, or publishes a site.
"""
import argparse
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

REPOSITORY = 'jimmie-potts/agent-device-hub'
BRANCH = 'guide/nightly-refresh'
ALLOWLIST = (
    'docs/work-guide/work/backlogs',
    'docs/work-guide/work/history/github-history.json',
    'docs/work-guide/outputs',
)


def run(root, args, *, env=None, stdin=None):
    return subprocess.run(args, cwd=root, env=env, input=stdin, text=True,
                          capture_output=True, check=True).stdout.strip()


def gh(root, args, payload=None):
    command = ['gh', *args]
    if payload is not None:
        command.extend(['--input', '-'])
    return run(root, command, stdin=json.dumps(payload) if payload is not None else None)


def post_check(root, sha, conclusion, check_summary):
    gh(root, ['api', '--method', 'POST', 'repos/' + REPOSITORY + '/check-runs'], {
        'name': 'Nightly guide validation', 'head_sha': sha, 'status': 'completed',
        'conclusion': conclusion, 'output': {
            'title': 'Guide validation passed' if conclusion == 'success' else 'Guide validation failed',
            'summary': check_summary,
        },
    })



def open_prs(root):
    prs = json.loads(gh(root, ['pr', 'list', '--repo', REPOSITORY,
                              '--head', BRANCH, '--base', 'main', '--state', 'open',
                              '--json', 'number,url', '--limit', '100']))
    if len(prs) > 1:
        raise RuntimeError('Multiple open rolling PRs; owner must reconcile them')
    return prs


def update_pr(root, prs, report_path):
    common = ['--repo', REPOSITORY, '--title', 'Nightly guide refresh',
              '--body-file', str(report_path)]
    if prs:
        number = str(prs[0]['number'])
        gh(root, ['api', '--method', 'PATCH', 'repos/' + REPOSITORY + '/pulls/' + number], {
            'title': 'Nightly guide refresh', 'body': report_path.read_text(encoding='utf-8'),
        })
        # POST adds labels while preserving labels applied by the PR owner.
        gh(root, ['api', '--method', 'POST', 'repos/' + REPOSITORY + '/issues/' + number + '/labels'],
           {'labels': ['documentation']})
        return prs[0]['url']
    return gh(root, ['pr', 'create', *common, '--head', BRANCH,
                    '--base', 'main', '--label', 'documentation']).strip()


def reconcile_unchanged(root, sha, report_path, conclusion, check_summary, base_sha):
    prs = open_prs(root)
    rows = gh(root, ['api', '--method', 'GET',
        'repos/' + REPOSITORY + '/commits/' + sha +
        '/check-runs?check_name=Nightly%20guide%20validation&per_page=100',
        '--paginate', '--jq', '.check_runs[] | @json'])
    checks = [check for check in (json.loads(line) for line in rows.splitlines() if line.strip())
              if check['name'] == 'Nightly guide validation'
              and check['head_sha'] == sha
              and check.get('app', {}).get('slug') == 'github-actions']
    latest = max(checks, key=lambda check: check['id']) if checks else None
    repaired = not latest or latest['status'] != 'completed' or latest['conclusion'] != conclusion
    if repaired or not prs:
        remote_main = run(root, ['git', 'ls-remote', 'origin', 'refs/heads/main']).split()
        if not remote_main or remote_main[0] != base_sha:
            raise RuntimeError('Main advanced during validation; rerun the refresh')
        # Update the report before the check. If either call is interrupted, the
        # old/missing check makes the next retry reconcile both again.
        url = update_pr(root, prs, report_path)
        if repaired:
            post_check(root, sha, conclusion, check_summary)
        repaired = True
    else:
        url = prs[0]['url']
    return {'changed': False, 'repaired': repaired, 'sha': sha, 'pr_url': url}


def publish(root, report_path, conclusion, check_summary, base_sha, expected_rolling_sha):
    """Return changed, sha and pr_url; errors propagate without claiming success.

    expected_rolling_sha is the fetched rolling head, or an empty string when
    the caller observed no branch. The push lease rejects concurrent writers.
    Identical complete trees never push. Missing PRs and missing or outdated checks
    are repaired after interrupted writes; a complete matching result is read-only.
    """
    root = Path(root).resolve()
    report_path = Path(report_path).resolve()
    if conclusion not in {'success', 'failure'}:
        raise ValueError('Validation conclusion must be success or failure')
    if not check_summary or len(check_summary) > 60000:
        raise ValueError('Check summary must contain 1 to 60000 characters')
    for sha in (base_sha, expected_rolling_sha):
        if sha and not re.fullmatch(r'[0-9a-f]{40}', sha):
            raise ValueError('Revisions must be full commit SHAs')
    if not base_sha:
        raise ValueError('A main base SHA is required')
    report_path.read_text(encoding='utf-8')  # Fail before writing a branch.
    git = lambda *args, **kwargs: run(root, ['git', *args], **kwargs)
    git('cat-file', '-e', base_sha + '^{commit}')
    if expected_rolling_sha:
        git('cat-file', '-e', expected_rolling_sha + '^{commit}')
    # This can contain a large Git index; use disk-backed repository scratch.
    try:
        git('check-ignore', '-q', '.local/probe')
    except subprocess.CalledProcessError as error:
        if error.returncode != 1:
            raise
        exclude = Path(git('rev-parse', '--git-path', 'info/exclude'))
        if not exclude.is_absolute():
            exclude = root / exclude
        with exclude.open('a', encoding='utf-8') as stream:
            stream.write('\n.local/\n')
    scratch = root / '.local/scratch/goal-guide-validation'
    scratch.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='publish-', dir=scratch) as directory:
        env = dict(os.environ, GIT_INDEX_FILE=str(Path(directory) / 'index'))
        git('read-tree', base_sha, env=env)
        git('add', '-A', '--', *ALLOWLIST, env=env)
        tree = git('write-tree', env=env)
        previous = expected_rolling_sha or base_sha
        # Validation used current main's authored inputs. The entire tree must
        # match before reusing a rolling SHA, or a new result could describe
        # newer Direction/source while being attached to an older commit.
        changed = git('diff', '--name-only', previous, tree)
        if not changed:
            if expected_rolling_sha:
                return reconcile_unchanged(root, previous, report_path, conclusion, check_summary, base_sha)
            return {'changed': False, 'sha': previous, 'pr_url': None}
        paths = git('diff', '--name-only', base_sha, tree).splitlines()
        if any(not (path == ALLOWLIST[1] or any(
                path.startswith(prefix + '/') for prefix in (ALLOWLIST[0], ALLOWLIST[2])
        )) for path in paths):
            raise RuntimeError('Snapshot commit includes a path outside the allowlist')
        prs = open_prs(root)
        remote_main = git('ls-remote', 'origin', 'refs/heads/main').split()
        if not remote_main or remote_main[0] != base_sha:
            raise RuntimeError('Main advanced during validation; rerun the refresh')
        commit_env = dict(env, GIT_AUTHOR_NAME='github-actions[bot]',
                          GIT_AUTHOR_EMAIL='41898282+github-actions[bot]@users.noreply.github.com',
                          GIT_COMMITTER_NAME='github-actions[bot]',
                          GIT_COMMITTER_EMAIL='41898282+github-actions[bot]@users.noreply.github.com')
        sha = git('commit-tree', tree, '-p', base_sha, '-m', 'Refresh saved work guide', env=commit_env)
        git('push', '--force-with-lease=refs/heads/' + BRANCH + ':' + expected_rolling_sha,
            'origin', sha + ':refs/heads/' + BRANCH)
        # Commit the report before its check so an interrupted PR update cannot
        # leave matching validation that would hide the stale body on retry.
        url = update_pr(root, prs, report_path)
        post_check(root, sha, conclusion, check_summary)
        return {'changed': True, 'sha': sha, 'pr_url': url.strip()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--report-path', type=Path, required=True)
    parser.add_argument('--conclusion', choices=('success', 'failure'), required=True)
    parser.add_argument('--check-summary', required=True)
    parser.add_argument('--base-sha', required=True)
    parser.add_argument('--expected-rolling-sha', required=True)
    args = parser.parse_args()
    print(json.dumps(publish(**vars(args))))


if __name__ == '__main__':
    main()
