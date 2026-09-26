"""Owner-maintained retired phrases; exact, case-insensitive saved-story checks."""
from pathlib import Path
import json

from guide_section import read

# Add a retirement with its delivered story key and the date of that decision.
RETIRED = (
    ('Pause motion', 'H264', '2026-09-25', 'The one-shot circuit trace replaced the motion control.'),
    ('tray.ps1', 'N131', '2026-09-25', 'The installed Nanoleaf runtime runs on Linux.'),
    ('install-modes.ps1', 'N131', '2026-09-25', 'The installed Nanoleaf runtime runs on Linux.'),
    ('PowerShell', 'N131', '2026-09-25', 'The installed Nanoleaf runtime runs on Linux.'),
)


def scan(issues, entries=RETIRED):
    """Return ordered warning/error lines; never modify issues or infer intent."""
    warnings, errors = [], []
    for term, retired_by, _date, _note in entries:
        if retired_by not in issues:
            errors.append(f'Retired term {term} cites {retired_by}, which is not in the snapshot')
    for key in sorted(issues, key=lambda key: (key[0], int(key[1:]))):
        issue = issues[key]
        if issue['state'] != 'OPEN':
            continue
        body = issue.get('body') or ''
        guide = read(body)
        rendered = []
        if guide['state'] == 'assigned':
            rendered = [guide.get('note') or '', guide.get('workaround') or '',
                        (guide.get('highlight') or {}).get('reason', '')]
        for term, retired_by, _date, _note in entries:
            if term.casefold() in body.casefold():
                warnings.append(f'{key}: story cites retired term {term} (retired by {retired_by})')
            if any(term.casefold() in line.casefold() for line in rendered):
                errors.append(f'{key}: Guide note cites retired term {term} (retired by {retired_by})')
    return warnings, errors


def saved_issues(work=None):
    work = work or Path(__file__).resolve().parent
    return {f'{prefix}{issue["number"]}': issue
            for prefix, repo in (('H', 'agent-device-hub'), ('N', 'codex-nanoleaf'), ('P', 'divoom-app-upgrade'))
            for issue in json.loads((work / 'backlogs' / f'{repo}-issues.json').read_text())}


if __name__ == '__main__':
    warnings, errors = scan(saved_issues())
    for line in warnings:
        print('WARNING: ' + line)
    for line in errors:
        print('ERROR: ' + line)
    raise SystemExit(bool(errors))
