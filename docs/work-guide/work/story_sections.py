"""Generic markdown-section engine shared by story-body sections.

A story section is one level-2 heading whose body is a set of `**Key:**
value` lines, at most one pipe table, and zero or more fenced ```text prompt
blocks. `recommendations.py`'s `## Execution recommendation` section and
`guide_section.py`'s `## Guide` section both parse, fingerprint and upsert
through these functions; each module owns only its own key set, validation
and rendering.
"""
import difflib
import json
import re
import subprocess


class Unreadable(ValueError):
    """The section exists but does not follow its convention."""


# --- Markdown structure -----------------------------------------------------

def _fence(line):
    match = re.match(r' {0,3}(`{3,}|~{3,})(.*)$', line)
    return (match.group(1), match.group(2).strip()) if match else None


def _headings(lines):
    """(index, level, text) for ATX headings outside fenced code blocks."""
    found, fence = [], None
    for index, raw in enumerate(lines):
        line = raw.rstrip('\r')
        if fence:
            closing = _fence(line)
            if closing and closing[0][0] == fence[0] and len(closing[0]) >= len(fence) and not closing[1]:
                fence = None
            continue
        opening = _fence(line)
        if opening:
            fence = opening[0]
            continue
        match = re.match(r' {0,3}(#{1,6})[ \t]+(.*?)[ \t#]*$', line)
        if match:
            found.append((index, len(match.group(1)), match.group(2).strip()))
    return found


def _sections(lines, names):
    """Line ranges [start, end) of level-2 sections titled with one of names,
    or whose title satisfies names when it is a predicate."""
    headings = _headings(lines)
    ranges = []
    for position, (index, level, text) in enumerate(headings):
        if level == 2 and (names(text) if callable(names) else text in names):
            end = next((later for later, later_level, _ in headings[position + 1:] if later_level <= 2), len(lines))
            ranges.append((index, end))
    return ranges


def normalize(text):
    """Line endings, trailing spaces and blank runs do not change meaning."""
    lines = [line.rstrip() for line in text.replace('\r\n', '\n').replace('\r', '\n').split('\n')]
    kept = []
    for line in lines:
        if line or (kept and kept[-1]):
            kept.append(line)
    while kept and not kept[-1]:
        kept.pop()
    return '\n'.join(kept)


def without_section(body, heading):
    lines = (body or '').split('\n')
    for start, end in reversed(_sections(lines, (heading,))):
        del lines[start:end]
    return '\n'.join(lines)


def _cells(row):
    row = row.strip()
    if not (row.startswith('|') and row.endswith('|')):
        raise Unreadable('a table row must start and end with |')
    return [cell.strip().replace('\\|', '|') for cell in re.split(r'(?<!\\)\|', row[1:-1])]


def blocks(lines, labels, prompt_keys=()):
    """Split section lines into labeled values, an optional table and prompt
    blocks. `labels` is the complete set of valid `**Key:**` labels,
    including any in `prompt_keys`; a key in `prompt_keys` must be followed
    by a blank-line-separated fenced ```text block instead of an inline
    value. At most one pipe table is allowed; the caller validates its shape."""
    values, prompts, table, index = {}, {}, None, 0
    def claim(key, store):
        if key in store:
            raise Unreadable(f'duplicate "{key}"')
    while index < len(lines):
        line = lines[index].rstrip('\r').rstrip()
        if not line:
            index += 1
            continue
        if line.lstrip().startswith('|'):
            if table is not None:
                raise Unreadable('only one table is allowed')
            table = []
            while index < len(lines) and lines[index].strip().startswith('|'):
                table.append(lines[index].rstrip('\r'))
                index += 1
            continue
        match = re.fullmatch(r'\*\*([^*]+?):\*\*(?:[ \t]+(.*))?', line)
        if not match:
            raise Unreadable(f'unexpected text "{line[:60]}"')
        key, value = match.group(1), (match.group(2) or '').strip()
        index += 1
        if key in prompt_keys:
            claim(key, prompts)
            if value:
                raise Unreadable(f'"{key}" must be followed by a fenced text block')
            while index < len(lines) and not lines[index].strip():
                index += 1
            opening = _fence(lines[index].rstrip('\r')) if index < len(lines) else None
            if not opening or opening[0][0] != '`' or opening[1] != 'text':
                raise Unreadable(f'"{key}" must be followed by a ```text block')
            body, index = [], index + 1
            while True:
                if index >= len(lines):
                    raise Unreadable(f'unclosed prompt block for "{key}"')
                closing = _fence(lines[index].rstrip('\r'))
                if closing and closing[0][0] == '`' and len(closing[0]) >= len(opening[0]) and not closing[1]:
                    break
                body.append(lines[index].rstrip('\r'))
                index += 1
            index += 1
            prompt = '\n'.join(body).strip()
            if not prompt:
                raise Unreadable(f'"{key}" is empty')
            prompts[key] = prompt
            continue
        if key not in labels:
            raise Unreadable(f'unknown key "{key}"')
        claim(key, values)
        # A wrapped value continues until a blank line or the next block.
        while index < len(lines):
            follow = lines[index].rstrip('\r').rstrip()
            if not follow or follow.lstrip().startswith(('|', '**')) or _fence(follow):
                break
            value += ' ' + follow.strip()
            index += 1
        if not value:
            raise Unreadable(f'"{key}" is empty')
        values[key] = value
    return values, prompts, table


def _replace(lines, span, replacement):
    start, end = span
    # One blank line before the next heading, or the body's final newline.
    return lines[:start] + replacement + [''] + lines[end:]


def _append(lines, block):
    while lines and not lines[-1].strip():
        lines = lines[:-1]
    return lines + ['', *block, '']


def replace_section(body, heading, render_section):
    """Replace (or append) one level-2 section. `render_section` receives no
    arguments and returns the section's lines, including its heading; called
    only once. Returns (new body, outcome) where outcome is 'created',
    'updated' or 'unchanged'."""
    lines = (body or '').split('\n')
    ranges = _sections(lines, (heading,))
    if len(ranges) > 1:
        raise ValueError(f'the story has more than one {heading} section')
    section = render_section().split('\n')
    if ranges:
        start, end = ranges[0]
        if normalize('\n'.join(lines[start:end])) == normalize('\n'.join(section)):
            return body, 'unchanged'
        lines = _replace(lines, ranges[0], section)
        outcome = 'updated'
    else:
        lines = _append(lines, section)
        outcome = 'created'
    return '\n'.join(lines), outcome


# --- GitHub I/O -------------------------------------------------------------

def _gh(*args, payload=None):
    result = subprocess.run(['gh', *args], input=payload, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or f'gh {args[0]} failed')
    return json.loads(result.stdout) if result.stdout.strip() else None


def read_issue(repo, number):
    return _gh('api', f'repos/jimmie-potts/{repo}/issues/{number}')


def write_issue(repo, number, body):
    return _gh('api', '-X', 'PATCH', f'repos/jimmie-potts/{repo}/issues/{number}', '--input', '-',
               payload=json.dumps({'body': body}))


def apply(entries, today, dry_run, upsert, describe, receipt=None, reader=read_issue, writer=write_issue):
    """Re-read each live body, write only a changed section and read it back.
    `upsert(body, entry, today)` returns (new body, outcome); `describe(new
    body)` returns the extra fields a caller wants reported per story (state,
    label, and so on)."""
    results = []
    for entry in entries:
        key = f"{entry['repo']}#{entry['number']}"
        row, body = dict(key=key), None
        try:
            live = reader(entry['repo'], entry['number'])
            if live.get('pull_request') or live['state'] != 'open':
                raise ValueError('not an open issue')
            body = live.get('body') or ''
            new, outcome = upsert(body, entry, today)
            # The assessor read the story at a known time; a later edit needs a fresh look.
            if outcome != 'unchanged' and entry.get('read_at') and live.get('updated_at', '') > entry['read_at']:
                raise RuntimeError(f"the story changed at {live['updated_at']}, after it was read at {entry['read_at']}; nothing was written")
            row.update(outcome=outcome)
            if outcome != 'unchanged':
                row['diff'] = ''.join(difflib.unified_diff(normalize(body).splitlines(True), normalize(new).splitlines(True), key, key, n=1))
                if not dry_run:
                    # Guard: the body must still be the one this change was computed from.
                    if normalize(reader(entry['repo'], entry['number']).get('body') or '') != normalize(body):
                        raise RuntimeError('the story changed while it was being updated; nothing was written')
                    writer(entry['repo'], entry['number'], new)
                    back = reader(entry['repo'], entry['number']).get('body') or ''
                    if normalize(back) != normalize(new):
                        raise RuntimeError('readback differs from the written body')
                    row['readback'] = describe(back).get('state')
            row.update(describe(new))
        except Exception as error:  # reported per story; the pass continues
            row.update(outcome='error', error=str(error))
        results.append(row)
        if receipt:
            with open(receipt, 'a', encoding='utf-8') as handle:
                handle.write(json.dumps(dict(row, dryRun=dry_run, previousBody=body if row.get('diff') and not dry_run else None)) + '\n')
    return results
