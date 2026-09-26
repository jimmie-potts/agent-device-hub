"""Stage complete read-only refreshes before exposing a nightly candidate."""
from pathlib import Path
import json
import shutil
import subprocess
import sys
import tempfile

REPOS = ('agent-device-hub', 'codex-nanoleaf', 'divoom-app-upgrade')
ROLLING_BRANCH = 'guide/nightly-refresh'


def run_helper(script):
    subprocess.run([sys.executable, str(script)], check=True)


def remove_rolling_pr(work):
    """The refresh must not ingest its own branch/head/body into its next diff."""
    path = work / 'backlogs/agent-device-hub-prs.json'
    if not path.exists():
        return
    rows = json.loads(path.read_text())
    kept = [row for row in rows if row.get('head', {}).get('ref') != ROLLING_BRANCH]
    if kept == rows:
        return
    path.write_text(json.dumps(kept, indent=2, ensure_ascii=False) + '\n')
    path = work / 'backlogs/snapshot.json'
    snapshot = json.loads(path.read_text())
    snapshot['repositories']['agent-device-hub']['openPRs'] = len(kept)
    path.write_text(json.dumps(snapshot, indent=2) + '\n')


def retain_unchanged_time(before, after):
    """A no-change check retains the previous observation, never invents freshness."""
    old = before / 'backlogs/snapshot.json'
    new = after / 'backlogs/snapshot.json'
    previous, current = json.loads(old.read_text()), json.loads(new.read_text())
    for field in ('startedAt', 'refreshedAt'):
        current[field] = previous.get(field)
    files = sorted(p.relative_to(after) for folder in ('backlogs', 'history')
                   for p in (after / folder).rglob('*') if p.is_file())
    old_files = sorted(p.relative_to(before) for folder in ('backlogs', 'history')
                       for p in (before / folder).rglob('*') if p.is_file())
    if files != old_files or current != previous:
        return False
    for relative in files:
        if relative == Path('backlogs/snapshot.json'):
            continue
        if (before / relative).read_bytes() != (after / relative).read_bytes():
            return False
    new.write_bytes(old.read_bytes())
    return True


def collect(guide, run=run_helper):
    """Read in a disposable copy. A helper failure leaves every input untouched.

    Use an on-disk TMPDIR on WSL: the existing guide inputs exceed a few MB.
    No build, diagram, issue or Git mutation is performed here.
    """
    guide = Path(guide)
    with tempfile.TemporaryDirectory(prefix='nightly-inputs-') as directory:
        staged = Path(directory) / 'guide'
        work = staged / 'work'
        shutil.copytree(guide / 'work', work, ignore=shutil.ignore_patterns(
            '__pycache__', '*.png', '*.pdf', 'guide-verification.json'))
        for name in ('refresh_backlogs.py', 'refresh_history.py'):
            run(work / name)
        remove_rolling_pr(work)
        unchanged = retain_unchanged_time(guide / 'work', work)
        # Only complete inputs become a candidate. A later validation/push failure
        # still cannot expose a partial remote branch: the publisher runs last.
        for folder in ('backlogs', 'history'):
            for source in (work / folder).rglob('*'):
                if source.is_file():
                    target = guide / 'work' / source.relative_to(work)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(source, target)
        return not unchanged


if __name__ == '__main__':
    print('changed' if collect(Path(__file__).resolve().parent.parent) else 'no change')
