#!/usr/bin/env python3
"""Stage current architecture in the existing public checkout; never publish it."""
import argparse
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
from urllib.parse import unquote, urlsplit

HERE = Path(__file__).resolve().parent
DOCS = HERE.parent
PUBLIC = 'https://jimmie-potts.github.io/agent-device-guide/'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def outputs(root):
    overview = (HERE / 'overview.html').read_text()
    overview = overview.replace('../runtime-architecture.html', 'runtime-architecture.html')
    overview = overview.replace('../diagrams/current/', '')
    overview = overview.replace(PUBLIC + 'architecture/history/', 'history/')
    result = {
        'architecture/arch-shared-system.html': overview.encode(),
        'architecture/runtime-architecture.html': (DOCS / 'runtime-architecture.html').read_bytes(),
        'architecture/runtime-sync.html': (DOCS / 'diagrams/current/runtime-sync.html').read_bytes(),
        'architecture/runtime-outcomes.html': (DOCS / 'diagrams/current/runtime-outcomes.html').read_bytes(),
        'architecture/history/index.html': (HERE / 'history.html').read_bytes(),
        'index.html': b'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="0; url=architecture/arch-shared-system.html"><title>B.U.N.N.Y. architecture</title></head><body><a href="architecture/arch-shared-system.html">Open the current B.U.N.N.Y. architecture</a></body></html>\n',
    }
    # The atlas's pinned September map must still open its matching viewer.
    for name in ('atlas/index.html', 'atlas/full-system-design.html'):
        result[name] = (root / name).read_bytes().replace(
            b'href="../architecture/arch-shared-system.html"',
            b'href="../architecture/history/arch-shared-system.html"')
    atlas_manifest = json.loads((root / 'atlas/manifest.json').read_text())
    for name in ('index.html', 'full-system-design.html'):
        atlas_manifest['files'][name] = digest(result['atlas/' + name])
    result['atlas/manifest.json'] = (json.dumps(atlas_manifest, indent=2) + '\n').encode()
    return result


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ('a', 'iframe'):
            value = attrs.get('href' if tag == 'a' else 'src')
            if value:
                self.links.append(value)


def check(root, expected):
    for name, data in expected.items():
        path = root / name
        if path.read_bytes() != data:
            raise ValueError(f'Export differs: {name}')
        if path.suffix != '.html':
            continue
        links = Links()
        links.feed(data.decode())
        for href in links.links:
            url = urlsplit(href)
            if url.scheme or url.netloc or not url.path:
                continue
            target = (path.parent / unquote(url.path)).resolve()
            if not target.is_relative_to(root):
                raise ValueError(f'Link escapes public root: {name}: {href}')
            if not target.exists():
                raise ValueError(f'Missing link: {name}: {href}')
    manifest = json.loads((root / 'architecture/manifest.json').read_text())
    for name, sha in manifest['files'].items():
        if digest((root / name).read_bytes()) != sha:
            raise ValueError(f'Manifest mismatch: {name}')
    print(f'PASS: {len(expected)} current export files, local destinations and {len(manifest["files"])} hashes')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('public_checkout', type=Path)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    root = args.public_checkout.resolve()
    if not (root / '.nojekyll').is_file() or not (root / 'atlas/manifest.json').is_file():
        parser.error('Expected the existing public guide checkout')
    expected = outputs(root)
    if not args.check:
        # Preserve the two original public entry points before replacing them. Existing
        # archives are immutable inputs on repeated exports, not regenerated snapshots.
        for source, destination, marker in (
            ('architecture/arch-shared-system.html', 'architecture/history/arch-shared-system.html', 'Linux hub process (apps/hub)'),
            ('index.html', 'history/work-guide.html', 'Agent device work guides'),
        ):
            target = root / destination
            if not target.exists():
                old = (root / source).read_bytes()
                if marker.encode() not in old:
                    raise ValueError(f'Original historical input missing: {source}')
                target.parent.mkdir(parents=True, exist_ok=True)
                # The work guide's relative links still resolve from the old site root.
                if source == 'index.html':
                    old = old.replace(b'<head>', b'<head><base href="../">', 1)
                target.write_bytes(old)
        for name, data in expected.items():
            target = root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        names = sorted([*expected, 'architecture/history/arch-shared-system.html', 'history/work-guide.html'])
        manifest = {'sourceReviewRevision': '1d21bd2e3891cf3c7481920a3f73a949952c1d51',
                    'reviewedAt': '2026-11-14',
                    'files': {name: digest((root / name).read_bytes()) for name in names}}
        (root / 'architecture/manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    check(root, expected)


if __name__ == '__main__':
    main()
