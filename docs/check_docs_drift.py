"""Read-only documentation checks. Source drift warns; invalid commands/paths fail."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
HUB = 'agent-device-hub'
OWNER = 'jimmie-potts'
DOCUMENTS = ['AGENTS.md', 'README.md', 'docs/development.md', 'docs/sdlc.md',
             'docs/application-ui-style-guide.md', 'docs/app-verification.md']
GENERATED = ('.local/', 'dist/', 'node_modules/', 'artifacts/')


def read_json(path):
    return json.loads(path.read_text())


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args], text=True, stderr=subprocess.DEVNULL)


def inventory(root):
    """Reuse the authored pin owners, without rendering or changing their pins."""
    pins = []

    def add(document, repo, pin, paths):
        pins.append(dict(document=document, repo=repo, pin=pin, paths=sorted(set(paths))))

    spec = importlib.util.spec_from_file_location('retained_diagrams', root / 'docs/diagrams/architecture_diagrams.py')
    diagrams = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(diagrams)
    for diagram in diagrams.DIAGRAMS:
        for repo, pin in diagrams.pins(diagram).items():
            paths = [path for owner, path in diagram['sources'] if owner == repo]
            if paths:
                add('diagram/' + diagram['id'], repo, pin, paths)
    atlas = read_json(root / 'docs/system-design/design.json')
    for component in atlas['components']:
        groups = {}
        for source in component.get('sources', []):
            match = re.fullmatch(r'https://github.com/jimmie-potts/([^/]+)/blob/([0-9a-f]+)/(.+)', source['url'])
            if match:
                repo, pin, path = match.groups()
                groups.setdefault((repo, pin), []).append(path)
        for (repo, pin), paths in groups.items():
            add('atlas/' + component['id'], repo, pin, paths)
    reference = read_json(root / 'docs/system-design/reference/sources.json')
    for name, source in reference['files'].items():
        add('reference/' + name, source['repository'], source['revision'], [source['path']])
    current = read_json(root / 'docs/diagrams/current/provenance.json')
    for diagram in current['diagrams']:
        add('current/' + diagram['id'], HUB, current['sourceRevision'], diagram['sources'])
    architecture = read_json(root / 'docs/runtime-architecture.sources.json')
    add('current/runtime-architecture', HUB, architecture['revision'], architecture['paths'])
    return pins


def compare_files(data):
    files = data.get('files')
    # GitHub returns at most 300 files, on the first compare page only. At the
    # boundary completeness is unknowable, so never call it unchanged.
    if not isinstance(files, list) or len(files) >= 300:
        raise ValueError('comparison file list missing or potentially truncated (300-file limit)')
    result = set()
    for item in files:
        result.add(item['filename'])
        if 'previous_filename' in item:
            result.add(item['previous_filename'])
    return result


class Comparisons:
    def __init__(self, root, offline=False):
        self.root, self.offline = root, offline
        self.cache, self.heads = {}, {}

    def api(self, route):
        headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'hub-docs-drift',
                   'X-GitHub-Api-Version': '2022-11-28'}
        token = os.environ.get('GITHUB_TOKEN')
        if token:
            headers['Authorization'] = 'Bearer ' + token
        request = urllib.request.Request('https://api.github.com/repos/' + OWNER + '/' + route, headers=headers)
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.load(response)

    def __call__(self, repo, pin):
        key = (repo, pin)
        if key not in self.cache:
            head = 'unknown'
            try:
                if repo == HUB:
                    head = self.heads.setdefault(repo, git(self.root, 'rev-parse', 'HEAD').strip())
                    # --name-only without rename detection lists both deleted and
                    # added paths, including a pinned source renamed elsewhere.
                    paths = set(git(self.root, 'diff', '--no-renames', '--name-only', '-z', pin, head, '--').split('\0')) - {''}
                elif self.offline:
                    raise ValueError('external comparison disabled by --offline')
                else:
                    if repo not in self.heads:
                        branch = self.api(repo)['default_branch']
                        self.heads[repo] = self.api(repo + '/commits/' + branch)['sha']
                    head = self.heads[repo]
                    paths = compare_files(self.api(repo + '/compare/' + pin + '...' + head))
                self.cache[key] = (head, paths, None)
            except (OSError, ValueError, KeyError, subprocess.CalledProcessError, urllib.error.URLError):
                # Do not copy response bodies, headers, tokens or private logs.
                self.cache[key] = (head, None, 'comparison unavailable or incomplete')
        return self.cache[key]


def evaluate(pins, compare):
    results = []
    for item in sorted(pins, key=lambda p: (p['document'], p['repo'], p['pin'])):
        head, paths, error = compare(item['repo'], item['pin'])
        changed = sorted(path for path in paths if any(
            path.startswith(source) if source.endswith('/') else path == source
            for source in item['paths'])) if paths is not None else []
        results.append({**item, 'head': head, 'changed': changed, 'reason': error,
                        'status': 'not checked' if error else 'changed' if changed else 'unchanged'})
    return results


def is_example(path):
    return bool(re.search(r'[<>${}]|\.\.\.', path)) or path.startswith(GENERATED) or '/dist/' in path or '/node_modules/' in path


def check_document(root, name, text, prefixes):
    scripts = read_json(root / 'package.json')['scripts']
    errors = []
    for number, line in enumerate(text.splitlines(), 1):
        messages = set()
        for match in re.finditer(r'\bnpm\s+(?:-s\s+)?run\s+(?:-s\s+)?([\w:.-]+)', line):
            if not match[1].startswith('-') and match[1] not in scripts:
                messages.add('unknown npm script: ' + match[1])
        for match in re.finditer(r'\b(?:python3|node)\s+([\w./*-]+)', line):
            path = match[1].rstrip('.,;')
            if '/' in path and not is_example(path) and not path.startswith('/') and not (root / path).exists():
                messages.add('missing command file: ' + path)
        for match in re.finditer(r'`([^`\n]+)`', line):
            path = match[1].split('#')[0].rstrip('.,;')
            if '/' not in path or any(c.isspace() for c in path) or is_example(path):
                continue
            if line[match.end():].lstrip().startswith('(retired)'):
                continue
            if not any(path.startswith(prefix) for prefix in prefixes):
                continue
            # Owning guides also cite paths relative to their own directory.
            bases = (root, root / Path(name).parent)
            exists = any(bool(list(base.glob(path))) if any(c in path for c in '*?[')
                         else (base / path).exists() for base in bases)
            if not exists:
                messages.add('missing documented path: ' + path)
        errors.extend(dict(file=name, line=number, message=message) for message in sorted(messages))
    return errors


def documents(root):
    selected = set(DOCUMENTS)
    for pattern in ('apps/**/DEVELOPMENT.md', 'apps/**/verify/*.md', 'packages/**/TESTING.md', 'packages/**/OPERATIONS.md'):
        selected.update(str(path.relative_to(root)) for path in root.glob(pattern) if 'node_modules' not in path.parts)
    if (root / 'docs/static-analysis.md').exists():
        selected.add('docs/static-analysis.md')
    return sorted(selected)


def markdown(results, errors):
    lines = ['# Documentation drift', '', 'Source changes are warnings, including intentional lag in dated legacy views. '
             'Unavailable or incomplete comparisons are **not checked**, never unchanged. No pins are modified.', '',
             '| Document | Repository | Pin → checked head | Result | Changed pinned files |',
             '| --- | --- | --- | --- | --- |']
    for row in results:
        files = ', '.join('`' + path + '`' for path in row['changed']) or '—'
        lines.append(f"| {row['document']} | {row['repo']} | `{row['pin']}` → `{row['head']}` | {row['status']} ({len(row['changed'])}) | {files} |")
    lines.extend(['', f'Command/path errors: {len(errors)}.'])
    lines.extend(f"- {e['file']}:{e['line']}: {e['message']}" for e in errors)
    return '\n'.join(lines) + '\n'


def escape(value):
    return str(value).replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A').replace(',', '%2C').replace(':', '%3A')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true', help='report external source pins as not checked')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    tracked = git(ROOT, 'ls-files', '-z').split('\0')
    prefixes = {path.split('/')[0] + '/' for path in tracked if '/' in path}
    errors = []
    for name in documents(ROOT):
        errors.extend(check_document(ROOT, name, (ROOT / name).read_text(), prefixes))
    results = evaluate(inventory(ROOT), Comparisons(ROOT, args.offline))
    report = markdown(results, errors)
    if args.report:
        args.report.write_text(report)
    else:
        print(report)
    if os.environ.get('GITHUB_ACTIONS') == 'true':
        for row in results:
            if row['status'] != 'unchanged':
                print('::warning::' + escape(f"{row['document']} ({row['repo']}): {row['status']}; " + ', '.join(row['changed'])))
        for error in errors:
            print(f"::error file={escape(error['file'])},line={error['line']}::{escape(error['message'])}")
    return bool(errors)


if __name__ == '__main__':
    raise SystemExit(main())
