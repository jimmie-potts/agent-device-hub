"""Execution recommendation sections: parse, fingerprint, render and upsert.

Each story may carry one `## Execution recommendation` section in its GitHub
body. The guide reads it from the saved backlog bodies and never guesses: a
section that breaks the convention in docs/work-guide/README.md renders as
"assessment unavailable". `upsert` writes a section from assessor input; it does
not assess anything itself.
"""
from datetime import date
from pathlib import Path
import argparse
import difflib
import hashlib
import html
import json
import re
import subprocess
import sys

HEADING = 'Execution recommendation'
DIMENSIONS = ('Complexity', 'Uncertainty', 'Impact')
_LEVEL = r'(low[- ]to[- ]medium|medium[- ]to[- ]high|low|medium|high|unknown)'
RATING = re.compile(r'\b(Complexity|Uncertainty|Impact)\b[\s:*]*(?:is\s+)?\**\s*' + _LEVEL + r'\b', re.I)
RATING_BEFORE = re.compile(r'\b' + _LEVEL + r'\s+(complexity|uncertainty|impact)\b', re.I)
HOSTS = {'claude': 'Claude Code', 'codex': 'Codex'}
SESSION_TYPES = ('One-shot', 'Pair', 'Orchestrate', 'Investigate first')
ROWS = ('Model', 'Thinking level', 'Session type', 'Subagents', 'Availability', 'Checkpoints')
REQUIRED_ROWS = ROWS[:-1]
LABELS = ('Start with', 'Cheaper start', 'Why', 'Reassess when', 'Assessed', 'Status', 'Missing')
PROMPTS = {f'{prefix} ({name})': (start, host) for start, prefix in (('recommended', 'Prompt'), ('cheaper', 'Cheaper prompt'))
           for host, name in HOSTS.items()}
STATE_LABELS = {'stale': 'Needs reassessment', 'insufficient': 'Insufficient information',
                'unassessed': 'Not yet assessed', 'unavailable': 'Assessment unavailable'}
FINGERPRINT = re.compile(r'[0-9a-f]{12}')


class Unreadable(ValueError):
    """The section exists but does not follow the convention."""


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


def _assessment_heading(text):
    return 'assessment' in text.lower() or text.lower() == 'readiness'


def ratings(body):
    """Model-neutral ratings as the story records them: assessment sections
    first, then any other story text outside this section."""
    lines = without_section(body).split('\n')
    texts = ['\n'.join(lines[start:end]) for start, end in _sections(lines, _assessment_heading)] + ['\n'.join(lines)]
    found = {}
    for text in texts:
        pairs = RATING.findall(text) + [(name, level) for level, name in RATING_BEFORE.findall(text)]
        for name, level in pairs:
            found.setdefault(name.capitalize(), level.lower().replace('-', ' '))
    return {name: found[name] for name in DIMENSIONS if name in found}


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


def without_section(body):
    lines = (body or '').split('\n')
    for start, end in reversed(_sections(lines, (HEADING,))):
        del lines[start:end]
    return '\n'.join(lines)


def fingerprint(body):
    """Short SHA-256 of the normalized story body with this section removed."""
    return hashlib.sha256(normalize(without_section(body)).encode()).hexdigest()[:12]


# --- Parsing ----------------------------------------------------------------

def _cells(row):
    row = row.strip()
    if not (row.startswith('|') and row.endswith('|')):
        raise Unreadable('a table row must start and end with |')
    return [cell.strip().replace('\\|', '|') for cell in re.split(r'(?<!\\)\|', row[1:-1])]


def _plain(value):
    return re.sub(r'`([^`]*)`', r'\1', value).strip()


def _model(cell):
    match = re.fullmatch(r'(.+?) \(`([^`]+)`\)', cell)
    if not match:
        raise Unreadable(f'model "{cell}" must read Name (`identifier`)')
    return match.group(1), match.group(2)


def _table(rows):
    if len(rows) < 3 or [_plain(c) for c in _cells(rows[0])] != ['', 'Claude Code', 'Codex']:
        raise Unreadable('the table header must be | | Claude Code | Codex |')
    if not all(re.fullmatch(r':?-{3,}:?', cell) for cell in _cells(rows[1])) or len(_cells(rows[1])) != 3:
        raise Unreadable('the table needs a three-column separator row')
    table = {}
    for row in rows[2:]:
        cells = _cells(row)
        if len(cells) != 3:
            raise Unreadable('each table row needs a label and two host cells')
        name = cells[0]
        if name not in ROWS:
            raise Unreadable(f'unknown table row "{name}"')
        if name in table:
            raise Unreadable(f'duplicate table row "{name}"')
        if not all(cells[1:]):
            raise Unreadable(f'row "{name}" is missing a host value')
        table[name] = dict(zip(HOSTS, cells[1:]))
    missing = [name for name in REQUIRED_ROWS if name not in table]
    if missing:
        raise Unreadable('missing table rows: ' + ', '.join(missing))
    hosts = {}
    for host in HOSTS:
        name, identifier = _model(table['Model'][host])
        session = table['Session type'][host]
        if session not in SESSION_TYPES:
            raise Unreadable(f'unknown session type "{session}"')
        availability = re.fullmatch(r'(Verified|Provisional)\b[:.]?\s*(.*)', table['Availability'][host])
        if not availability:
            raise Unreadable('availability must start with Verified or Provisional')
        hosts[host] = dict(model=name, identifier=identifier, thinking=_plain(table['Thinking level'][host]),
                           session=session, subagents=table['Subagents'][host],
                           verified=availability.group(1) == 'Verified', availability=table['Availability'][host],
                           checkpoints=table.get('Checkpoints', {}).get(host))
    return hosts


def _assessed(value):
    parts = value.split(' · ')
    if len(parts) < 4 or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', parts[0]):
        raise Unreadable('Assessed must read date · policy · evidence · fingerprint')
    date.fromisoformat(parts[0])
    policy = re.fullmatch(r'policy `([^`]+)`', parts[1])
    fingerprint_part = re.fullmatch(r'fingerprint: `([^`]*)`', parts[-1])
    evidence = ' · '.join(parts[2:-1])
    if not policy or not evidence.startswith('evidence: '):
        raise Unreadable('Assessed must name the policy revision and evidence')
    if not fingerprint_part or not FINGERPRINT.fullmatch(fingerprint_part.group(1)):
        raise Unreadable('Assessed needs a 12-character fingerprint')
    return dict(date=parts[0], policy=policy.group(1), evidence=evidence[len('evidence: '):],
                fingerprint=fingerprint_part.group(1))


def _blocks(lines):
    """Split section lines into labeled values, the table and prompt blocks."""
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
        if key in PROMPTS:
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
        if key not in LABELS:
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


def _parse_section(lines):
    values, prompts, table = _blocks(lines)
    assessed = _assessed(values['Assessed']) if 'Assessed' in values else None
    if not assessed:
        raise Unreadable('missing Assessed')
    result = dict(assessed, why=values.get('Why'), reassess=values.get('Reassess when'))
    if 'Status' in values:
        if values['Status'] != 'insufficient':
            raise Unreadable('Status may only be "insufficient"')
        extra = set(values) - {'Status', 'Missing', 'Why', 'Reassess when', 'Assessed'}
        if extra or prompts or table is not None:
            raise Unreadable('an insufficient section carries no answer, table or prompts')
        if 'Missing' not in values:
            raise Unreadable('an insufficient section names what is Missing')
        return dict(result, state='insufficient', missing=values['Missing'])
    if 'Missing' in values:
        raise Unreadable('Missing belongs only to an insufficient section')
    for key in ('Start with', 'Why', 'Reassess when'):
        if key not in values:
            raise Unreadable(f'missing "{key}"')
    if table is None:
        raise Unreadable('missing the two-host table')
    hosts = _table(table)
    starts = {'recommended': {}, 'cheaper': {}}
    for key, prompt in prompts.items():
        start, host = PROMPTS[key]
        starts[start][host] = prompt
    if set(starts['recommended']) != set(HOSTS):
        raise Unreadable('both hosts need a prompt')
    if ('Cheaper start' in values) != bool(starts['cheaper']) or (starts['cheaper'] and set(starts['cheaper']) != set(HOSTS)):
        raise Unreadable('a cheaper start needs one line and both host prompts')
    return dict(result, state='recommended', answer=values['Start with'], hosts=hosts,
                cheaper=values.get('Cheaper start'), prompts={k: v or None for k, v in starts.items()})


def label(result):
    """Compact text label, session type first, for rows and cards."""
    if result['state'] == 'stale':
        return f"{STATE_LABELS['stale']} (story text changed after {result['date']})"
    if result['state'] != 'recommended':
        return STATE_LABELS[result['state']]
    hosts = result['hosts']
    sessions = dict.fromkeys(host['session'] for host in hosts.values())
    return ' / '.join(sessions) + ' · ' + ' / '.join(f"{host['model']} {host['thinking']}" for host in hosts.values())


def read(body):
    """The story's recommendation state; never a guessed default."""
    lines = (body or '').split('\n')
    ranges = _sections(lines, (HEADING,))
    if not ranges:
        result = dict(state='unassessed')
    elif len(ranges) > 1:
        result = dict(state='unavailable', reason='the story has more than one Execution recommendation section')
    else:
        start, end = ranges[0]
        try:
            result = _parse_section(lines[start + 1:end])
        except (Unreadable, ValueError) as error:
            result = dict(state='unavailable', reason=str(error))
        else:
            current = fingerprint(body)
            if result['fingerprint'] != current:
                result = dict(result, saved_state=result['state'], state='stale', current=current)
    result['label'] = label(result)
    result['ratings'] = ratings(body)
    return result


def display(value):
    """Plain text for the page: code spans lose their backticks and links keep
    their text. Prompts are never passed through here; they are copied verbatim."""
    value = re.sub(r'\[([^\]]*)\]\([^)\s]*\)', r'\1', value)
    return re.sub(r'`([^`]*)`', r'\1', value)


def brief(result):
    """What the page may show for one story. Only a current recommendation
    carries its answer, hosts and prompts; other states carry their notice."""
    fields = {'recommended': ('date', 'policy', 'evidence', 'answer', 'hosts', 'why', 'reassess', 'cheaper', 'prompts'),
              'insufficient': ('date', 'policy', 'evidence', 'missing', 'why', 'reassess'),
              'stale': ('date', 'policy'), 'unavailable': ('reason',), 'unassessed': ()}[result['state']]
    shown = {name: result[name] for name in fields if result.get(name) is not None}
    for name in ('evidence', 'answer', 'why', 'reassess', 'cheaper', 'missing'):
        if name in shown:
            shown[name] = display(shown[name])
    if 'hosts' in shown:
        shown['hosts'] = {host: {name: display(value) if isinstance(value, str) else value for name, value in fields_.items()}
                          for host, fields_ in shown['hosts'].items()}
    return dict(shown, state=result['state'], label=result['label'], ratings=result.get('ratings', {}))


def label_html(key, result):
    """The row and card label; guide_overview.js renders the same markup."""
    return (f'<p class="rec" data-key="{html.escape(key)}" data-rec="{result["state"]}"><span class="rec-key">Start</span> '
            f'{html.escape(result["label"])}</p>')


# --- Rendering --------------------------------------------------------------

EFFORT = {'claude': ('effort', 'take the effort as stated rather than guessing it'),
          'codex': ('reasoning', 'take the reasoning level as stated rather than guessing it')}
SESSION_NOUN = {'One-shot': 'one-shot', 'Pair': 'paired', 'Orchestrate': 'orchestrating', 'Investigate first': 'read-only investigation'}


def _cell(value):
    return ' '.join(str(value).split()).replace('|', '\\|')


def _one_line(value):
    return ' '.join(str(value).split())


def _prompt_model(host, model):
    name, identifier = _model(model)
    return name if host == 'claude' else identifier


def prompt(entry, host, start, assessed_date):
    """One template per session type and host."""
    choice = entry['hosts'][host] if start == 'recommended' else entry['cheaper']['hosts'][host]
    session = choice['session']
    word, take = EFFORT[host]
    model = _prompt_model(host, choice['model'])
    url = f"https://github.com/jimmie-potts/{entry['repo']}/issues/{entry['number']}"
    scope = f"{entry['cheaper']['covers']} of " if start == 'cheaper' else ''
    parts = [f'Investigate {url} before any implementation.' if session == 'Investigate first'
             else f'Use the deliver-work skill to deliver {scope}{url}.',
             f'I started this session on {model} at {choice["thinking"]} {word}. '
             f'State the model you are running and stop if it is not {model}; {take}.']
    if session == 'One-shot':
        parts.append('Run as a one-shot session: implement directly without subagents.')
    elif session == 'Pair':
        parts.append(f'Run as a paired session: delegate the implementation to one {choice["delegate"]} worker, '
                     'advise it at the approach, blockers and final review, and apply every write yourself.')
    elif session == 'Orchestrate':
        parts.append(f'Run as an orchestrating session: break the work down, delegate {choice["delegate"]}, '
                     'and keep every write and review yourself.')
    else:
        parts.append("Read-only: don't change files, branches or GitHub. "
                     f'Answer this question: {entry["question"]} '
                     'Report the evidence and what it means for the story so it can be reassessed before implementation.')
    if choice.get('checkpoints'):
        parts.append(f'Stop to ask me at these checkpoints: {choice["checkpoints"]}.')
    if start == 'cheaper' and entry['cheaper'].get('limit'):
        parts.append(entry['cheaper']['limit'])
    parts.append(f"The issue's Execution recommendation (assessed {assessed_date}) is the basis; "
                 'if what you find no longer fits it, say so before changing strategy.')
    if session != 'Investigate first':
        parts.append("If deliver-work isn't available here, say so and stop.")
    return _one_line(' '.join(parts))


def _fenced(text):
    longest = max((len(run) for run in re.findall(r'`+', text)), default=0)
    fence = '`' * max(3, longest + 1)
    return [f'{fence}text', text, fence]


def render(entry, assessed_date, story_fingerprint):
    """The canonical section text for one assessor entry."""
    assessed = entry['assessed']
    closing = [f"**Assessed:** {assessed_date} · policy `{assessed['policy']}` · evidence: {_one_line(assessed['evidence'])} · fingerprint: `{story_fingerprint}`"]
    if entry.get('why'):
        closing.insert(0, f"**Why:** {_one_line(entry['why'])}")
    if entry.get('reassess'):
        closing.insert(len(closing) - 1, f"**Reassess when:** {_one_line(entry['reassess'])}")
    if entry['status'] == 'insufficient':
        lines = [f'## {HEADING}', '', '**Status:** insufficient', f"**Missing:** {_one_line(entry['missing'])}", '', *closing]
        return '\n'.join(lines)
    hosts = entry['hosts']
    rows = {'Model': 'model', 'Thinking level': 'thinking', 'Session type': 'session',
            'Subagents': 'subagents', 'Availability': 'availability', 'Checkpoints': 'checkpoints'}
    lines = [f'## {HEADING}', '', f"**Start with:** {_one_line(entry['answer'])}", '',
             '| | Claude Code | Codex |', '| --- | --- | --- |']
    for row, field in rows.items():
        values = [hosts[host].get(field) for host in HOSTS]
        if row == 'Checkpoints' and not any(values):
            continue
        if field == 'thinking':
            values = [f'`{value}`' for value in values]
        lines.append(f'| {row} | ' + ' | '.join(_cell(value or 'None') for value in values) + ' |')
    for host, name in HOSTS.items():
        lines += ['', f'**Prompt ({name}):**', '', *_fenced(prompt(entry, host, 'recommended', assessed_date))]
    cheaper = entry.get('cheaper')
    if cheaper:
        choices = cheaper['hosts']
        sessions = dict.fromkeys(SESSION_NOUN[choice['session']] for choice in choices.values())
        described = ' or '.join(f"{name} on {choices[host]['model']} `{choices[host]['thinking']}`" for host, name in HOSTS.items())
        line = f"{cheaper['covers'][0].upper()}{cheaper['covers'][1:]}, as a {' / '.join(sessions)} session in {described}."
        if cheaper.get('note'):
            line += ' ' + cheaper['note']
        lines += ['', f'**Cheaper start:** {_one_line(line)}']
        for host, name in HOSTS.items():
            lines += ['', f'**Cheaper prompt ({name}):**', '', *_fenced(prompt(entry, host, 'cheaper', assessed_date))]
    lines += ['', *closing]
    return '\n'.join(lines)


def _replace(lines, span, replacement):
    start, end = span
    # One blank line before the next heading, or the body's final newline.
    return lines[:start] + replacement + [''] + lines[end:]


def _append(lines, block):
    while lines and not lines[-1].strip():
        lines = lines[:-1]
    return lines + ['', *block, '']


def upsert(body, entry, today):
    """Return (new body, outcome). Replaces only this section, plus a newly
    derived assessment section when the entry supplies one."""
    body = body or ''
    lines = body.split('\n')
    changed_assessment = False
    if entry.get('assessment'):
        block = entry['assessment'].strip('\n').split('\n')
        if not re.fullmatch(r'## Work assessment[ \t]*', block[0]):
            raise ValueError('a derived assessment section must start with "## Work assessment"')
        existing = _sections(lines, ('Work assessment',))
        if len(existing) > 1:
            raise ValueError('the story has more than one Work assessment section')
        if existing and normalize('\n'.join(lines[existing[0][0]:existing[0][1]])) != normalize('\n'.join(block)):
            if not entry.get('replace_assessment'):
                raise ValueError('the story already has a Work assessment section; set replace_assessment to change it')
            lines = _replace(lines, existing[0], block)
            changed_assessment = True
        elif not existing:
            recorded, derived = ratings(body), ratings('\n'.join(block))
            if set(recorded) == set(DIMENSIONS):
                raise ValueError('the story already records every rating; reuse them instead of deriving new ones')
            if set(recorded) & set(derived):
                raise ValueError('a derived assessment may add only the ratings the story does not record')
            ranges = _sections(lines, (HEADING,))
            if ranges:
                start = ranges[0][0]
                lines = lines[:start] + block + [''] + lines[start:]
            else:
                lines = _append(lines, block)
            changed_assessment = True
    ranges = _sections(lines, (HEADING,))
    if len(ranges) > 1:
        raise ValueError('the story has more than one Execution recommendation section')
    candidate = '\n'.join(lines)
    story_fingerprint = fingerprint(candidate)
    previous = read(body) if ranges else dict(state='unassessed')
    keep_date = previous.get('fingerprint') == story_fingerprint and previous['state'] in ('recommended', 'insufficient')
    assessed_date = previous['date'] if keep_date else entry['assessed'].get('date', today)
    section = render(entry, assessed_date, story_fingerprint).split('\n')
    if ranges:
        start, end = ranges[0]
        if normalize('\n'.join(lines[start:end])) == normalize('\n'.join(section)) and not changed_assessment:
            return body, 'unchanged'
        lines = _replace(lines, ranges[0], section)
        outcome = 'updated'
    else:
        lines = _append(lines, section)
        outcome = 'created'
    result = '\n'.join(lines)
    check = read(result)
    if check['state'] != entry['status']:
        raise ValueError(f"rendered section does not read back: {check.get('reason', check['state'])}")
    return result, outcome


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


def apply(entries, today, dry_run, receipt=None, reader=read_issue, writer=write_issue):
    """Re-read each live body, write only a changed section and read it back."""
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
            row.update(outcome=outcome, before=fingerprint(body))
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
                    row['readback'] = read(back)['state']
            state = read(new)
            row.update(state=state['state'], label=state['label'], date=state.get('date'), fingerprint=state.get('fingerprint'))
        except Exception as error:  # reported per story; the pass continues
            row.update(outcome='error', error=str(error))
        results.append(row)
        if receipt:
            with open(receipt, 'a', encoding='utf-8') as handle:
                handle.write(json.dumps(dict(row, dryRun=dry_run, previousBody=body if row.get('diff') and not dry_run else None)) + '\n')
    return results


def _saved(root):
    for prefix, repo in (('H', 'agent-device-hub'), ('N', 'codex-nanoleaf'), ('P', 'divoom-app-upgrade')):
        for issue in json.loads((root / 'backlogs' / f'{repo}-issues.json').read_text()):
            if issue['state'] == 'OPEN':
                yield f'{prefix}{issue["number"]}', issue


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    commands = parser.add_subparsers(dest='command', required=True)
    write = commands.add_parser('upsert', help='write sections from assessor input (a JSON list of entries)')
    write.add_argument('--input', required=True, type=Path)
    write.add_argument('--only', help='comma-separated repo#number keys to process')
    write.add_argument('--dry-run', action='store_true', help='read live bodies and print diffs; write nothing')
    write.add_argument('--receipt', type=Path, help='append one JSON line per story, outside Git')
    write.add_argument('--today', default=date.today().isoformat())
    commands.add_parser('report', help='list the saved backlog recommendation state per open story')
    args = parser.parse_args(argv)
    if args.command == 'report':
        rows = sorted(_saved(Path(__file__).resolve().parent), key=lambda item: (item[0][0], int(item[0][1:])))
        counts = {}
        for key, issue in rows:
            result = read(issue['body'])
            counts[result['state']] = counts.get(result['state'], 0) + 1
            print(json.dumps(dict(key=key, url=issue['url'], state=result['state'], label=result['label'],
                                  date=result.get('date'), reason=result.get('reason'), missing=result.get('missing'))))
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
