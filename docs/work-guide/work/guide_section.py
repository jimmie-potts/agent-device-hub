"""Guide sections: parse, render and upsert.

Each open story may carry one `## Guide` section naming the topic guide that
owns it, an optional one-line reading note, an optional defect workaround,
an optional next-step/decision/later/idea highlight with its reason and, beside
an idea highlight only, the stories it would build on (`**Extends:**`). The
guide reads this from the saved (or live) story body and never guesses: a
section that breaks the convention renders as "topic invalid", the same as a
story that carries no section at all renders as "topic assignment pending".
`upsert` writes a section from caller input; it does not assign a topic.
"""
from pathlib import Path
import argparse
import json
import re
import sys

from story_sections import (
    Unreadable, _sections, blocks as _story_blocks, without_section as _without_section,
    replace_section, apply as _story_apply, read_issue, write_issue,
)
from guide_paths import PATHS

HEADING = 'Guide'
TOPIC_IDS = frozenset(PATHS)
LABELS = ('Topic', 'Note', 'Workaround', 'Highlight', 'Extends')
KINDS = ('next step', 'decision', 'later', 'idea')
_HIGHLIGHT = re.compile(r'(' + '|'.join(re.escape(kind) for kind in KINDS) + r')\s*,\s*(.+)', re.I)
# Guide keys: H (hub), N (Nanoleaf), P (Pixoo) and the issue number, comma separated.
_KEY = r'[HNP][1-9]\d*'
_EXTENDS = re.compile(_KEY + r'(?:\s*,\s*' + _KEY + r')*')


def without_section(body):
    return _without_section(body, HEADING)


def _one_line(value):
    return ' '.join(str(value).split())


def _parse_section(lines, topics, keys):
    values, prompts, table = _story_blocks(lines, LABELS)
    if prompts:
        raise Unreadable('the Guide section has no prompts')
    if table is not None:
        raise Unreadable('the Guide section has no table')
    if 'Topic' not in values:
        raise Unreadable('missing "Topic"')
    topic = values['Topic']
    if topic not in topics:
        raise Unreadable(f'unknown topic "{topic}"')
    highlight = None
    if 'Highlight' in values:
        match = _HIGHLIGHT.fullmatch(values['Highlight'])
        if not match:
            raise Unreadable('"Highlight" must read "next step | decision | later | idea, <reason>"')
        kind = next(candidate for candidate in KINDS if candidate == match.group(1).lower())
        highlight = dict(kind=kind, reason=match.group(2).strip())
    extends = []
    if 'Extends' in values:
        if not highlight or highlight['kind'] != 'idea':
            raise Unreadable('"Extends" is valid only beside an idea highlight')
        if not _EXTENDS.fullmatch(values['Extends']):
            raise Unreadable('"Extends" must list guide keys such as "H67, N47"')
        extends = [key.strip() for key in values['Extends'].split(',')]
        if len(set(extends)) != len(extends):
            raise Unreadable('"Extends" names a story twice')
        unknown = [key for key in extends if keys is not None and key not in keys]
        if unknown:
            raise Unreadable(f'"Extends" names {", ".join(unknown)}, which is not in the snapshot')
    return dict(topic=topic, note=values.get('Note'), workaround=values.get('Workaround'), highlight=highlight, extends=extends)


def read(body, topics=None, keys=None):
    """The story's guide placement; never a guessed default. `topics` is the
    set of valid topic ids; defaults to `guide_paths.PATHS`. `keys`, when
    given, is the set of guide keys an `Extends` line may name (the snapshot's
    issues); without it only the key form is checked."""
    topics = TOPIC_IDS if topics is None else topics
    lines = (body or '').split('\n')
    ranges = _sections(lines, (HEADING,))
    if not ranges:
        return dict(state='unassigned')
    if len(ranges) > 1:
        return dict(state='invalid', reason='the story has more than one Guide section')
    start, end = ranges[0]
    try:
        parsed = _parse_section(lines[start + 1:end], topics, keys)
    except (Unreadable, ValueError) as error:
        return dict(state='invalid', reason=str(error))
    return dict(parsed, state='assigned')


def render(topic, note=None, workaround=None, highlight=None, extends=None):
    """The canonical section text for one placement."""
    lines = [f'## {HEADING}', '', f'**Topic:** {topic}']
    if note:
        lines.append(f'**Note:** {_one_line(note)}')
    if workaround:
        lines.append(f'**Workaround:** {_one_line(workaround)}')
    if highlight:
        lines.append(f'**Highlight:** {highlight["kind"]}, {_one_line(highlight["reason"])}')
    if extends:
        lines.append(f'**Extends:** {", ".join(extends)}')
    return '\n'.join(lines)


def upsert(body, entry, today=None, topics=None):
    """Return (new body, outcome). Replaces only this section. `entry` needs
    `topic` and may carry `note`, `workaround`, `highlight`
    (`{'kind': ..., 'reason': ...}`) and, beside an idea highlight, `extends`
    (a list of guide keys). `topics` is the set of valid topic ids used to
    validate the round trip; defaults to `guide_paths.PATHS`."""
    new, outcome = replace_section(body, HEADING, lambda: render(entry['topic'], entry.get('note'), entry.get('workaround'),
                                                                 entry.get('highlight'), entry.get('extends')))
    check = read(new, topics)
    if check['state'] != 'assigned' or check['topic'] != entry['topic'] or check['extends'] != list(entry.get('extends') or []):
        raise ValueError(f"rendered section does not read back: {check.get('reason', check['state'])}")
    return new, outcome


# --- GitHub I/O -------------------------------------------------------------

def apply(entries, today, dry_run, receipt=None, reader=read_issue, writer=write_issue):
    """Re-read each live body, write only a changed section and read it back."""
    return _story_apply(entries, today, dry_run, upsert, lambda body: read(body, TOPIC_IDS), receipt, reader, writer)


def _saved(root):
    for prefix, repo in (('H', 'agent-device-hub'), ('N', 'codex-nanoleaf'), ('P', 'divoom-app-upgrade')):
        for issue in json.loads((root / 'backlogs' / f'{repo}-issues.json').read_text()):
            if issue['state'] == 'OPEN':
                yield f'{prefix}{issue["number"]}', issue


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    commands = parser.add_subparsers(dest='command', required=True)
    write = commands.add_parser('upsert', help='write sections from input (a JSON list of entries)')
    write.add_argument('--input', required=True, type=Path)
    write.add_argument('--only', help='comma-separated repo#number keys to process')
    write.add_argument('--dry-run', action='store_true', help='read live bodies and print diffs; write nothing')
    write.add_argument('--receipt', type=Path, help='append one JSON line per story, outside Git')
    write.add_argument('--today', default=None)
    commands.add_parser('report', help='list the saved backlog Guide-section state per open story')
    args = parser.parse_args(argv)
    if args.command == 'report':
        rows = sorted(_saved(Path(__file__).resolve().parent), key=lambda item: (item[0][0], int(item[0][1:])))
        counts = {}
        for key, issue in rows:
            result = read(issue['body'], TOPIC_IDS)
            counts[result['state']] = counts.get(result['state'], 0) + 1
            print(json.dumps(dict(key=key, url=issue['url'], state=result['state'],
                                  topic=result.get('topic'), reason=result.get('reason'))))
        print(json.dumps(dict(total=len(rows), counts=counts)))
        return 0
    entries = json.loads(args.input.read_text())
    if args.only:
        wanted = set(args.only.split(','))
        entries = [entry for entry in entries if f"{entry['repo']}#{entry['number']}" in wanted]
    results = apply(entries, args.today, args.dry_run, args.receipt)
    for row in results:
        print(json.dumps({k: v for k, v in row.items() if k != 'diff'}))
        if args.dry_run and row.get('diff'):
            print(row['diff'])
    return 1 if any(row['outcome'] == 'error' for row in results) else 0


if __name__ == '__main__':
    sys.exit(main())
