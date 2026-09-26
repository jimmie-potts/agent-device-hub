"""Collect, validate and publish one mechanical guide-refresh candidate."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import guide_direction
import guide_retired
from nightly_publish import ALLOWLIST, BRANCH, REPOSITORY, publish
from refresh_backlogs import PREFIXES
from refresh_report import load_snapshots, render_report

ROOT = Path(__file__).resolve().parents[3]
GUIDE = ROOT / 'docs/work-guide'


def git(*args):
    return subprocess.run(['git', *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()


def output_hashes():
    return {str(path.relative_to(GUIDE)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in (GUIDE / 'outputs').rglob('*') if path.is_file()}


def command(args, log):
    with log.open('w', encoding='utf-8') as stream:
        return subprocess.run(args, cwd=ROOT, stdout=stream, stderr=subprocess.STDOUT).returncode


def require(args, log):
    if command(args, log):
        raise RuntimeError(f'Validation failed; see {log.name}. No branch was published.')


def close_direction_fixture(work):
    """Explicit dispatch fixture only: close one saved cite, never a GitHub issue."""
    issues = guide_retired.saved_issues(work)
    delivered = set(guide_direction.cited()['DELIVERED_SINCE'])
    key = next((key for key in guide_direction.cited()['SEQUENCE']
                if key not in delivered and issues[key]['state'] == 'OPEN'), None)
    if not key:
        raise RuntimeError('No open Direction sequence key available for the validation fixture')
    repository = {prefix: repo for repo, prefix in PREFIXES.items()}[key[0]]
    path = work / 'backlogs' / f'{repository}-issues.json'
    rows = json.loads(path.read_text())
    target = next(row for row in rows if row['number'] == int(key[1:]))
    target.update(state='CLOSED', stateReason='completed', closedAt=datetime.now(timezone.utc).isoformat())
    path.write_text(json.dumps(rows, indent=2, ensure_ascii=False) + '\n')
    (work / 'backlogs' / f'{repository}-digest.txt').write_text('\n'.join(
        f"#{row['number']} [{row['state']}] {row['title']}" for row in sorted(rows, key=lambda row: row['number'])) + '\n')
    path = work / 'backlogs/snapshot.json'
    snapshot = json.loads(path.read_text())
    snapshot['openIssues'] -= 1
    snapshot['repositories'][repository]['openIssues'] -= 1
    snapshot['validationFixture'] = {'closedDirectionKey': key, 'notLive': True}
    path.write_text(json.dumps(snapshot, indent=2) + '\n')
    for filename in ('hub-native-deps.json', 'device-native-deps.json'):
        path = work / 'backlogs' / filename
        document = json.loads(path.read_text())
        inventories = document['data']
        for alias, data in inventories.items():
            inventory = data['issues']
            prefix = 'H' if alias == 'repository' else alias.upper()
            if prefix == key[0]:
                inventory['nodes'] = [row for row in inventory['nodes'] if row['number'] != int(key[1:])]
                inventory['totalCount'] = len(inventory['nodes'])
            for row in inventory['nodes']:
                for dependency in row['blockedBy']['nodes']:
                    if dependency['repository']['nameWithOwner'] == 'jimmie-potts/' + repository and dependency['number'] == int(key[1:]):
                        dependency['state'] = 'CLOSED'
        path.write_text(json.dumps(document, indent=2) + '\n')
    return key


def validate(evidence):
    """No stderr matching or checker bypass can authorize the failure branch."""
    before = output_hashes()
    result_path = evidence / 'fresh-input-validation.json'
    status = command([sys.executable, str(GUIDE / 'work/build_guide.py'),
                      '--validate-inputs', '--validation-result', str(result_path)], evidence / 'fresh-input-validation.log')
    result = json.loads(result_path.read_text()) if result_path.exists() else {}
    if output_hashes() != before:
        raise RuntimeError('Input-only validation changed generated output')
    if status == 3 and result.get('status') == 'direction-stale':
        # Retain the actual default-build and maintenance failures as evidence.
        # Baseline regressions ran before replacing their accepted snapshot.
        build_status = command([sys.executable, str(GUIDE / 'work/build_guide.py')], evidence / 'blocked-build.log')
        maintenance_status = command([sys.executable, str(GUIDE / 'work/test_maintenance.py')], evidence / 'fresh-maintenance.log')
        if build_status == 0 or output_hashes() != before:
            raise RuntimeError('Stale Direction did not preserve the default build failure/output')
        result['maintenanceExit'] = maintenance_status
        return result
    if status != 0 or result.get('status') != 'passed':
        raise RuntimeError('Fresh-input validation has a non-Direction failure; no branch was published')
    require([sys.executable, str(GUIDE / 'work/build_guide.py')], evidence / 'build.log')
    generated = output_hashes()
    require([sys.executable, str(GUIDE / 'work/build_guide.py')], evidence / 'rebuild.log')
    if output_hashes() != generated:
        raise RuntimeError('Guide regeneration is not deterministic')
    require([sys.executable, str(GUIDE / 'work/test_maintenance.py')], evidence / 'fresh-maintenance.log')
    require(['node', str(GUIDE / 'work/check_guide.cjs')], evidence / 'browser.log')
    for pattern in ('guide-*.png', 'guide-print-check.pdf', 'guide-verification.json'):
        for path in (GUIDE / 'work').glob(pattern):
            shutil.copyfile(path, evidence / path.name)
    return dict(result, generatedOutputValidated=True, browserValidated=True, maintenanceExit=0)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=('live', 'replay', 'direction-failure'), default='live')
    parser.add_argument('--evidence', type=Path, required=True)
    args = parser.parse_args(argv)
    if args.mode != 'live' and os.environ.get('GITHUB_EVENT_NAME') != 'workflow_dispatch':
        parser.error('Fixture modes require an explicit workflow_dispatch')
    evidence = args.evidence.resolve()
    evidence.mkdir(parents=True, exist_ok=False)
    # These are code-regression checks against the reviewed, committed snapshot.
    # On a stale fresh Direction, they are not relabelled as fresh-output checks.
    require([sys.executable, str(GUIDE / 'work/test_maintenance.py')], evidence / 'baseline-maintenance.log')
    git('fetch', 'origin', 'main')
    base = git('rev-parse', 'origin/main')
    source = git('rev-parse', 'HEAD')
    source_paths = ['.github/workflows/guide-refresh.yml', 'docs/work-guide/work', 'docs/skins',
                    ':(exclude)docs/work-guide/work/backlogs/**',
                    ':(exclude)docs/work-guide/work/history/github-history.json']
    if git('diff', '--name-only', source, base, '--', *source_paths):
        raise RuntimeError('Main tooling or authored inputs changed after checkout; rerun on the current source')
    remote = git('ls-remote', '--heads', 'origin', 'refs/heads/' + BRANCH).split()
    rolling = remote[0] if remote else ''
    if rolling:
        git('fetch', 'origin', 'refs/heads/' + BRANCH)
        # The workflow owns these generated paths. Always run current source;
        # only the previous rolling data/output is used as the diff baseline.
        git('restore', '--source', rolling, '--worktree', '--', *ALLOWLIST)
    elif args.mode == 'replay':
        raise RuntimeError('Replay requires an existing rolling snapshot')
    before = evidence / 'before/work'
    for directory in ('backlogs', 'history'):
        shutil.copytree(GUIDE / 'work' / directory, before / directory)
    if args.mode == 'live':
        with (evidence / 'refresh.log').open('w', encoding='utf-8') as stream:
            process = subprocess.run([sys.executable, str(GUIDE / 'work/nightly_inputs.py')], cwd=ROOT,
                                     stdout=stream, stderr=subprocess.STDOUT)
        if process.returncode:
            raise RuntimeError('Input refresh failed; no partial snapshot was published')
    fixture = close_direction_fixture(GUIDE / 'work') if args.mode == 'direction-failure' else None
    validation = validate(evidence)
    warnings, errors = guide_retired.scan(guide_retired.saved_issues())
    if errors:
        raise RuntimeError('; '.join(errors))
    snapshot = json.loads((GUIDE / 'work/backlogs/snapshot.json').read_text())
    direction_errors = [validation['directionError']] if validation['status'] == 'direction-stale' else []
    report = render_report(load_snapshots(before / 'backlogs'), load_snapshots(GUIDE / 'work/backlogs'),
                           refreshed_at=snapshot['refreshedAt'], direction_errors=direction_errors, retired_warnings=warnings)
    if fixture:
        report += f'\n**Validation fixture, not live tracker state:** {fixture} was closed only in this saved test input. Do not merge this fixture PR.\n'
    report += f'\nSource: `{source}`. Mode: `{args.mode}`. Baseline maintenance passed before refresh.\n'
    if direction_errors:
        report += ('\nFresh non-Direction input validation passed. The default build remains failed; generated output is retained from the previous snapshot. '
                   'Fresh maintenance failures are retained in the run artifacts. Generated-output and browser validation are blocked until the owner rewrites Direction.\n')
    else:
        report += '\nFresh generation, deterministic rebuild, maintenance and browser checks passed.\n'
    report_path = evidence / 'report.md'
    report_path.write_text(report)
    conclusion = 'failure' if direction_errors else 'success'
    run_url = 'https://github.com/' + REPOSITORY + '/actions/runs/' + os.environ['GITHUB_RUN_ID']
    summary = f'Source `{source}`; snapshot `{snapshot["refreshedAt"]}`; mode `{args.mode}`.\n\n[Run logs and artifacts]({run_url})\n\n'
    summary += ('needs owner rewrite of guide_direction.py; fresh input checks passed, generated/browser checks blocked.\n' + '\n'.join(direction_errors)
                if direction_errors else 'Fresh generation, deterministic rebuild, maintenance and browser checks passed.')
    result = publish(ROOT, report_path, conclusion, summary, base, rolling)
    result.update(validation=validation, source=source, base=base, mode=args.mode)
    (evidence / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as stream:
        stream.write(('no change\n\n' if not result['changed'] else '') + report)
        stream.write('\n' + json.dumps(result) + '\n')
    print(json.dumps(result))
    return 1 if direction_errors else 0


if __name__ == '__main__':
    raise SystemExit(main())
