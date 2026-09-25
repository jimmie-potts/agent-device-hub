#!/usr/bin/env python3
"""Verify generated HTML, authored-source preservation, IDs, links and inventory."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit
import hashlib
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / "work-guide" / "work"))
import architecture_diagrams as AD  # noqa: E402


class Document(HTMLParser):
    def __init__(self, path):
        super().__init__(convert_charrefs=True)
        self.path, self.ids, self.links, self.h1 = path, set(), [], 0
        self.feed(path.read_text(encoding="utf-8"))

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if "id" in attrs:
            assert attrs["id"] not in self.ids, f"Duplicate ID {attrs['id']} in {self.path}"
            self.ids.add(attrs["id"])
        if tag == "a" and "href" in attrs:
            self.links.append(attrs["href"])
            if attrs.get("target") == "_blank":
                assert "noopener" in attrs.get("rel", ""), self.path
        if tag == "h1":
            self.h1 += 1


def hashes(paths):
    return {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}


if __name__ == "__main__":
    sources = [ROOT / "design.json", *sorted((ROOT / "source").glob("*.html"))]
    before = hashes(sources)
    subprocess.run([sys.executable, str(ROOT / "build.py"), "--check"], check=True)
    subprocess.run([sys.executable, str(ROOT / "reference/check_reference.py")], check=True)
    # Atlas and guide colors come only from the shared token files.
    subprocess.run([sys.executable, str(ROOT.parent / "skins/check_tokens.py")], check=True)
    assert before == hashes(sources), "Source documents changed during verification"
    data = json.loads((ROOT / "design.json").read_text())
    paths = [ROOT / "index.html", ROOT / "full-system-design.html", *sorted((ROOT / "components").glob("*.html"))]
    assert len(paths) == len(data["components"]) + 2
    parsed = {p.resolve(): Document(p) for p in paths}
    links = 0
    for path, doc in parsed.items():
        assert doc.h1 == 1, f"Expected one h1: {path}"
        for href in doc.links:
            url = urlsplit(href)
            if url.scheme:
                assert url.scheme == "https", f"Unexpected URL scheme: {href}"
                continue
            target = (path.parent / unquote(url.path)).resolve() if url.path else path
            assert target.is_file(), f"Broken link in {path.name}: {href}"
            if url.fragment:
                target_doc = parsed[target] if target in parsed else Document(target)
                assert unquote(url.fragment) in target_doc.ids, f"Broken anchor: {path.name}: {href}"
            links += 1
    # The overview embeds the two shared diagrams. Their saved specifications and rendered
    # SVGs must still match the editable definitions, and every map node needs a detail block.
    receipts = {d["id"]: d for d in json.loads((AD.ARCH / "diagram-receipts.json").read_text())["diagrams"]}
    overview = (ROOT / "index.html").read_text(encoding="utf-8")
    for key in ("system", "walkthrough"):
        diagram = next(d for d in AD.DIAGRAMS if d["id"] == data["map"]["diagrams"][key])
        saved = json.loads((AD.SPECS / f'{diagram["id"]}.json').read_text(encoding="utf-8"))
        assert saved == diagram["spec"], f"Saved specification drifted from the shared definition: {diagram['id']}"
        rendered = AD.RENDERED / f'{diagram["id"]}.svg'
        assert hashlib.sha256(rendered.read_bytes()).hexdigest() == receipts[diagram["id"]]["svgSha256"], f"Rendered SVG differs from its receipt: {diagram['id']}"
        assert overview.count(f'data-diagram="{diagram["id"]}"') == 1, f"Overview embeds {diagram['id']} once"
    components = [c["id"] for c in next(d for d in AD.DIAGRAMS if d["id"] == data["map"]["diagrams"]["system"])["spec"]["components"]]
    assert all(f'id="detail-{node}"' in overview for node in components), "Every map node has a detail block"
    assert overview.count('class="walk-phase"') == len(data["map"]["phases"]), "Every walkthrough phase is rendered"
    full = parsed[(ROOT / "full-system-design.html").resolve()]
    assert all(item["id"] in full.ids for item in data["components"])
    for item in data["components"]:
        assert item["sources"], f"Missing evidence for {item['id']}"
        assert (ROOT / "source" / f'{item["id"]}.html').stat().st_size > 800
    assert "{{" not in (ROOT / "full-system-design.html").read_text(), "Unfilled template prompt"
    print(f"PASS: {len(paths)} HTML documents; {links} local links; unique anchors, inventory, evidence and unchanged sources.")
