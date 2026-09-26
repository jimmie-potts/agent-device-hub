#!/usr/bin/env python3
"""Export the reviewed B.U.N.N.Y. atlas as a self-contained /atlas/ Pages tree."""

import argparse
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path, PurePosixPath
import re
import sys
from urllib.parse import unquote, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'skins'))
import skin as SKIN  # noqa: E402


ALLOWED_DATABASE_SUFFIXES = {
    ".css", ".dot", ".eot", ".html", ".js", ".map", ".otf",
    ".png", ".svg", ".ttf", ".txt", ".woff", ".woff2", ".xml",
}
PUBLIC_ROOT = "https://jimmie-potts.github.io/agent-device-guide/"


def digest(content):
    return hashlib.sha256(content).hexdigest()


def public_files(atlas):
    design = json.loads((atlas / "design.json").read_text(encoding="utf-8"))
    components = {f"components/{item['id']}.html" for item in design["components"]}
    if len(components) != 26:
        raise ValueError("The atlas component inventory changed; review the public export")
    files = {
        "index.html", "full-system-design.html", "diagrams/state-and-actions.html",
        "diagrams/state-and-actions.json", "reference/index.html",
        "reference/THIRD-PARTY-NOTICES.txt", "reference/sources.json",
        "reference/routes.json", "reference/tools.json",
        *components,
    }
    for folder, suffixes in {
        "assets": {".css", ".js"},
        "reference/api": {".html"},
        "reference/assets": {".css", ".js", ""},
        "reference/openapi": {".json"},
        "reference/schemas": {".json", ".sql"},
        "reference/database": ALLOWED_DATABASE_SUFFIXES,
    }.items():
        for file in (atlas / folder).rglob("*"):
            if file.is_file() and not file.name.startswith("."):
                if file.suffix not in suffixes:
                    raise ValueError(f"Unexpected public file type: {file.relative_to(atlas)}")
                files.add(file.relative_to(atlas).as_posix())
    for name in files:
        path = atlas / name
        if not path.is_file() or path.is_symlink():
            raise ValueError(f"Missing regular atlas file: {name}")
    return sorted(files)


def public_html(name, content):
    if '<!-- places:start -->' in content:
        match = re.search(r'data-current="([a-z]+)"', content)
        if not match:
            raise ValueError(f'Missing Places identity in {name}')
        content = SKIN.inject_places(content, match.group(1), Path(name), public=True)
    elif name.startswith('reference/database/'):
        content = SKIN.inject_places(content, 'reference', Path(name), public=True)
    else:
        raise ValueError(f'Missing source Places navigation in {name}')
    # The authored atlas uses a sibling path inside the private Hub repository.
    # Pages places the nine reviewed viewers directly under /architecture/.
    if "../work-guide/outputs/architecture/" in content:
        if name not in ("index.html", "full-system-design.html"):
            raise ValueError(f"Unexpected architecture link in {name}")
        content = content.replace("../work-guide/outputs/architecture/", "../architecture/")
    if "work-guide/outputs/architecture/" in content:
        raise ValueError(f"Unconverted private layout link in {name}")
    if name == "diagrams/state-and-actions.html":
        content, count = re.subn(
            r"\s*<!-- Async font load:.*?</noscript>", "", content, flags=re.DOTALL)
        if count != 1:
            raise ValueError("Expected one external font block in state/action viewer")
    if name in ("index.html", "full-system-design.html") or name.startswith("components/"):
        prefix = "../" if name.startswith("components/") else ""
        needle = f'<a class="overview-link" href="{prefix}index.html">System overview</a>'
        if content.count(needle) != 1:
            raise ValueError(f"Missing atlas navigation anchor in {name}")
        guide = "../../index.html" if prefix else "../index.html"
        content = content.replace(needle, needle + f'\n<a class="overview-link" href="{guide}">Work guide</a>')
    return content


def public_css(name, content):
    if name.endswith(("AdminLTE.css", "AdminLTE-without-plugins.css",
                      "AdminLTE-without-plugins.min.css")):
        content, count = re.subn(
            r"@import url\(https://fonts\.googleapis\.com[^;]+;", "", content)
        if count != 1:
            raise ValueError(f"Expected one external font import in {name}")
    return content


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag in {"a", "link", "script", "img", "iframe"}:
            self.links.extend(value for key, value in attrs if key in {"href", "src"} and value)


def check_links(atlas, files):
    for name in files:
        if not name.endswith(".html"):
            continue
        parser = Links()
        parser.feed((atlas / name).read_text(encoding="utf-8"))
        for link in parser.links:
            parsed = urlsplit(link)
            if parsed.scheme or parsed.netloc or not parsed.path:
                continue
            path = unquote(parsed.path)
            if path.startswith("/"):
                raise ValueError(f"Absolute local link in {name}: {link}")
            target = PurePosixPath(name).parent.joinpath(path)
            parts = []
            for part in target.parts:
                if part == "..":
                    if parts:
                        parts.pop()
                    else:
                        parts.append("..")
                elif part != ".":
                    parts.append(part)
            resolved = PurePosixPath(*parts)
            if str(resolved) in {"../index.html"} or str(resolved).startswith("../architecture/"):
                continue  # supplied by the public guide at the site root
            if ".." in resolved.parts or not (atlas / str(resolved)).exists():
                raise ValueError(f"Broken public atlas link in {name}: {link}")


def export(source, site):
    atlas = source / "docs/system-design"
    if not atlas.is_dir() or site.exists():
        raise ValueError("Use an existing Hub source tree and a new output directory")
    files = public_files(atlas)
    target = site / "atlas"
    target.mkdir(parents=True)
    manifest = {}
    for name in files:
        content = (atlas / name).read_bytes()
        if name.endswith(".html"):
            content = public_html(name, content.decode("utf-8")).encode("utf-8")
        elif name.endswith(".css"):
            content = public_css(name, content.decode("utf-8")).encode("utf-8")
        output = target / name
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(content)
        manifest[name] = digest(content)
    check_links(target, files)
    guide_root = source / "docs/work-guide/outputs"
    guide = (guide_root / "agent-device-work-guides.html").read_text(encoding="utf-8")
    local_link = 'class="atlas-link" href="../../system-design/index.html"'
    if guide.count(local_link) != 1:
        raise ValueError("Missing local atlas link in generated work guide")
    (site / "index.html").write_text(
        SKIN.inject_places(guide.replace(local_link, 'class="atlas-link" href="atlas/index.html"'), 'guide', site / 'index.html', public=True), encoding="utf-8")
    viewers = sorted((guide_root / "architecture").glob("*.html"))
    if len(viewers) != 9 or any(path.is_symlink() for path in viewers):
        raise ValueError("Expected nine regular architecture viewers")
    architecture = site / "architecture"
    architecture.mkdir()
    for viewer in viewers:
        document = viewer.read_text(encoding='utf-8')
        (architecture / viewer.name).write_text(
            SKIN.inject_places(document, 'architecture', architecture / viewer.name, public=True), encoding='utf-8')
    places_pages = {}
    for page in sorted(site.rglob('*.html')):
        document = page.read_text(encoding='utf-8')
        match = re.search(r'data-current="([a-z]+)"', document)
        if not match or document.count('<!-- places:start -->') != 1:
            raise ValueError(f'Missing exported Places navigation: {page.relative_to(site)}')
        if SKIN.inject_places(document, match.group(1), page, public=True) != document:
            raise ValueError(f'Non-public Places destination: {page.relative_to(site)}')
        places_pages[page.relative_to(site).as_posix()] = digest(page.read_bytes())
    (target / "manifest.json").write_text(
        json.dumps({"version": 1, "publicRoot": PUBLIC_ROOT + "atlas/", "files": manifest,
                    "placesPages": places_pages}, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Exported guide, {len(viewers)} viewers, {len(files)} atlas files and manifest to {site}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="New public site staging directory")
    parser.add_argument("--source-root", type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args()
    export(args.source_root.resolve(), args.output.resolve())
