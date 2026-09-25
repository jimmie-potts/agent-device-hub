#!/usr/bin/env python3
"""Build B.U.N.N.Y.'s HTML document set from its inventory and authored HTML fragments."""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ID = re.compile(r"[A-Z][A-Z0-9-]*-[a-z][a-z0-9-]*\Z")
sys.path.insert(0, str(ROOT.parent / "work-guide" / "work"))
sys.path.insert(0, str(ROOT.parent / "skins"))
import architecture_diagrams as AD  # noqa: E402  the shared diagram definitions and their Archify renderings
import skin as SKIN  # noqa: E402  shared token files, theme and motion controls

REPO_LABEL = {"agent-device-hub": "Hub", "codex-nanoleaf": "Nanoleaf", "divoom-app-upgrade": "Pixoo"}


def escape(value):
    return html.escape(str(value), quote=True)


def load():
    data = json.loads((ROOT / "design.json").read_text(encoding="utf-8"))
    seen = set()
    for item in data["components"]:
        key = item["id"]
        if not ID.fullmatch(key) or key.casefold() in seen:
            raise ValueError(f"Invalid or duplicate document ID: {key}")
        seen.add(key.casefold())
        source = ROOT / "source" / f"{key}.html"
        if source.is_symlink() or not source.is_file():
            raise ValueError(f"Missing regular source document: {key}")
        if item["status"] not in {"delivered", "planned", "qualification", "optional", "mixed"}:
            raise ValueError(f"Unknown status: {key}")
    keys = {item["id"] for item in data["components"]}
    for item in data["components"]:
        if any(dep not in keys or dep == item["id"] for dep in item["depends_on"]):
            raise ValueError(f"Invalid dependency: {item['id']}")
    shared_diagrams(data)
    return data


def shared_diagrams(data):
    """Resolve the two shared definitions and check the atlas-owned links against them."""
    cfg = data["map"]
    by_id = {d["id"]: d for d in AD.DIAGRAMS}
    system, walk = by_id[cfg["diagrams"]["system"]], by_id[cfg["diagrams"]["walkthrough"]]
    node_ids = {c["id"] for c in system["spec"]["components"]}
    if set(system["details"]) != node_ids or set(cfg["nodes"]) != node_ids:
        raise ValueError("Map details and design.json nodes must match the shared map components")
    if not len(walk["phases"]) == len(walk["spec"]["segments"]) == len(cfg["phases"]):
        raise ValueError("Walkthrough phases must match the shared segments")
    keys = {item["id"] for item in data["components"]}
    for entry in [*cfg["nodes"].values(), *cfg["phases"]]:
        if any(doc not in keys for doc in entry.get("docs", [])):
            raise ValueError("Unknown component document in the map links")
    return system, walk


def diagram_svg(diagram):
    text = (AD.RENDERED / f'{diagram["id"]}.svg').read_text(encoding="utf-8")
    if "@@DESC@@" not in text:
        raise ValueError(f"Rendered diagram lacks its description slot: {diagram['id']}")
    return text.replace("@@DESC@@", escape(diagram["summary"]))


def link_rows(data, sources, docs, refs):
    items = {item["id"]: item for item in data["components"]}
    rows = []
    if sources:
        rows.append('<p class="detail-links"><span>Code and contracts</span>' + "".join(
            f'<a href="{escape(AD.src(repo, path))}" target="_blank" rel="noopener noreferrer">{escape(REPO_LABEL[repo])} {escape(path)}</a>' for repo, path in sources) + "</p>")
    if docs:
        rows.append('<p class="detail-links"><span>Design documents · 19 Sep 2026 snapshot</span>' + "".join(
            f'<a href="components/{doc}.html">{escape(items[doc]["name"])}</a>' for doc in docs) + "</p>")
    if refs:
        rows.append('<p class="detail-links"><span>Reference · 20 Sep 2026 baseline</span>' + "".join(
            f'<a href="{escape(url)}">{escape(label)}</a>' for label, url in refs) + "</p>")
    return "".join(rows)


def map_section(data, system):
    cfg, spec = data["map"], system["spec"]
    boundary_of = {node: b["label"] for b in spec["boundaries"] for node in b["wraps"]}
    pins = " · ".join(f"{REPO_LABEL[repo]} {rev[:8]}" for repo, rev in AD.SOURCES["sourceRevisions"].items())
    index, details = [], []
    for c in spec["components"]:
        node, detail, links, tag = c["id"], system["details"][c["id"]], cfg["nodes"][c["id"]], c.get("tag", "")
        index.append(f'<li><button type="button" class="node-button" data-node="{node}" aria-pressed="false"><span class="node-name">{escape(c["label"])}</span>'
                     f'<span class="node-sub">{escape(c["sublabel"])}</span>' + (f'<span class="node-tag">{escape(tag)}</span>' if tag else "") + "</button></li>")
        meta = " · ".join(x for x in [c["sublabel"], tag, boundary_of.get(node, "")] if x)
        details.append(f'<div class="node-detail" id="detail-{node}" data-node="{node}"><h3>{escape(c["label"])}</h3><p class="detail-meta">{escape(meta)}</p>'
                       f'<p>{escape(detail["role"])}</p>{link_rows(data, detail["sources"], links.get("docs", []), links.get("reference", []))}</div>')
    viewer = cfg["viewers"] + system["id"] + ".html"
    return f'''<section class="atlas-map" id="map" aria-labelledby="map-title">
<div class="map-head"><div><p class="eyebrow">SYSTEM MAP · SOURCE PINNED {escape(cfg["reviewed_at"])}</p><h2 id="map-title">What runs where.</h2></div>
<div class="map-aside"><p class="map-pins"><span>Pinned source</span>{escape(pins)} · <a href="{escape(viewer)}">Interactive viewer ↗</a></p>{stage_tools("Map zoom")}</div></div>
<p class="map-key"><span class="key key-observe">observation path</span><span class="key key-feed">state feed</span><span class="key key-command">explicit command</span><span class="key key-other">internal call · commit · import</span><span class="key-hint">Select a box, or Tab to it and press Enter, for its responsibility and owning links. Escape clears the selection.</span></p>
<div class="map-stage-wrap"><div class="map-stage"><div class="atlas-canvas" data-diagram="{system["id"]}">{diagram_svg(system)}</div></div></div>
<aside class="map-detail" id="map-detail" aria-live="polite" tabindex="-1"><p class="detail-hint">{escape(system["summary"])}</p><p class="detail-hint">Nothing selected. Choose a component on the map or in the list below.</p></aside>
<div class="map-reading">{reading_block(system)}</div>
<details class="map-index" id="map-index"><summary>All {len(index)} components as a list</summary><ul>{"".join(index)}</ul></details>
<div class="map-details" hidden>{"".join(details)}</div>
<p class="map-note">Tags describe source at the pinned revision; installed and physical acceptance are recorded only by the owning issues. {escape(cfg["reference_baseline"])}</p>
</section>'''


def reading_block(diagram):
    """The shared definition's reading and boundary bullets, as the guide renders them."""
    items = lambda key: "".join(f"<li>{escape(re.sub(r'\[\[[A-Z]+[0-9]+\]\]', lambda m: m.group(0)[2:-2], text))}</li>" for text in diagram[key])
    return (f'<div class="reading"><div><h4>How to read it</h4><ul>{items("reading")}</ul></div>'
            f'<div><h4>Boundaries and evidence</h4><ul>{items("boundaries")}</ul></div></div>')


def stage_tools(label):
    return (f'<div class="stage-tools" role="group" aria-label="{escape(label)}"><button type="button" class="zoom-out" aria-label="Zoom out">−</button>'
            '<button type="button" class="zoom-fit">Fit</button><button type="button" class="zoom-in" aria-label="Zoom in">+</button><span class="zoom-level" aria-live="polite">100%</span></div>')


def walkthrough_section(data, walk):
    cfg, spec = data["map"], walk["spec"]
    names = {p["id"]: p["label"] for p in spec["participants"]}
    phases = []
    for n, (segment, phase, links) in enumerate(zip(spec["segments"], walk["phases"], cfg["phases"])):
        steps = [(i, m) for i, m in enumerate(spec["messages"]) if segment["from"] <= m["y"] < segment["to"]]
        if not steps:
            raise ValueError(f"Walkthrough segment without messages: {segment['label']}")
        items = "".join(f'<li data-step="{i}"><strong>{escape(names[m["from"]])} → {escape(names[m["to"]])}</strong> {escape(m["label"])}'
                        + (f' <em>{escape(m["note"])}</em>' if m.get("note") else "") + "</li>" for i, m in steps)
        phases.append(f'<li class="walk-phase" data-phase="{n}" data-steps="{",".join(str(i) for i, _ in steps)}"><button type="button" class="phase-button" aria-expanded="false" aria-controls="phase-{n}">'
                      f'<span class="phase-label">{escape(segment["label"])}</span><span class="phase-count">{len(steps)} messages</span></button>'
                      f'<div class="phase-body" id="phase-{n}" hidden><p>{escape(phase["text"])}</p><ol class="phase-messages">{items}</ol>{link_rows(data, phase["sources"], links.get("docs", []), [])}</div></li>')
    viewer = cfg["viewers"] + walk["id"] + ".html"
    return f'''<section class="atlas-walk" id="walkthrough" aria-labelledby="walkthrough-title">
<div class="map-head"><div><p class="eyebrow">WALKTHROUGH · ONE OBSERVATION, NO DEVICE EXPERIMENT</p><h2 id="walkthrough-title">{escape(spec["meta"]["title"])}.</h2><p class="map-lead">{escape(walk["summary"])}</p></div>
<div class="map-aside"><p class="map-pins"><a href="{escape(viewer)}">Interactive viewer ↗</a></p>{stage_tools("Walkthrough zoom")}</div></div>
<p class="map-key"><span class="key-hint">Open a phase for its messages, explanation and links; the matching arrows stay highlighted on the diagram. Phase labels on the diagram open the same phase.</span></p>
<div class="map-stage-wrap"><div class="map-stage"><div class="atlas-canvas" data-diagram="{walk["id"]}">{diagram_svg(walk)}</div></div></div>
<ol class="walk-steps" id="walk-steps">{"".join(phases)}</ol>
<div class="walk-reading">{reading_block(walk)}</div>
</section>'''


def archify_css():
    classes = json.loads((AD.RENDERED / "archify-classes.json").read_text(encoding="utf-8"))
    scope = lambda selector: ", ".join(f".atlas-canvas {part.strip()}" for part in selector.split(","))
    rules = "".join(f"{scope(selector)}{{{body}}}" for selector, body in classes["rules"].items())
    return rules + SKIN.archify_variables(classes, ".atlas-canvas")


def link(item, mode):
    if mode == "full":
        return "#" + item["id"]
    return ("" if mode == "component" else "components/") + item["id"] + ".html"


def badge(item):
    return f'<span class="badge {escape(item["status"])}">At snapshot: {escape(item["status_label"])}</span>'


def navigation(data, mode, current):
    prefix = "../" if mode == "component" else ""
    parts = [f'<a class="overview-link" href="{prefix}index.html">System overview</a>',
             f'<a class="overview-link" href="{prefix}full-system-design.html">Complete reading view</a>',
             f'<a class="overview-link" href="{prefix}reference/index.html">API &amp; database reference</a>']
    for group in dict.fromkeys(item["group"] for item in data["components"]):
        parts.append(f'<div class="nav-group"><p class="nav-label">{escape(group)}</p>')
        for item in data["components"]:
            if item["group"] != group:
                continue
            active = ' aria-current="page"' if item["id"] == current else ""
            search = escape(" ".join([item["id"], item["name"], item["summary"], group]))
            parts.append(f'<a class="nav-item" data-search="{search}" href="{link(item, mode)}"{active}>'
                         f'<span class="nav-dot {item["status"]}"></span><span>{escape(item["name"])}</span></a>')
        parts.append("</div>")
    return "\n".join(parts)


def fragment(item, full=False):
    content = (ROOT / "source" / f'{item["id"]}.html').read_text(encoding="utf-8")
    if "{{" in content:
        raise ValueError(f"Unfilled template field: {item['id']}")
    if full:
        content = content.replace('href="../reference/', 'href="reference/')
        content = re.sub(r'href="([A-Z][A-Z0-9-]*-[a-z][a-z0-9-]*)\.html(#[^"]*)?"',
                         lambda m: 'href="' + (m[2] or "#" + m[1]) + '"', content)
    else:
        content = content.replace('<h3>', '<h2>').replace('</h3>', '</h2>')
    return content


def frame(data, title, content, mode="overview", current=""):
    css = SKIN.stylesheet() + (ROOT / "assets/style.css").read_text(encoding="utf-8") + archify_css()
    script = SKIN.controls_script() + (ROOT / "assets/app.js").read_text(encoding="utf-8")
    prefix = "../" if mode == "component" else ""
    nav = navigation(data, mode, current)
    notice = "" if mode == "overview" else f'<aside class="notice" aria-label="Snapshot date"><strong>Design snapshot: {escape(data["reviewed_at"])}.</strong> Implementation labels, issue states and open decisions describe the pinned baseline at that date. Follow the linked owning issues and application guides for current status.</aside>'
    return f'''<!doctype html>
<html lang="en" {SKIN.HTML_ATTRIBUTES}>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">{SKIN.head_script()}
<title>{escape(title)} · B.U.N.N.Y. system design</title>
<meta name="description" content="B.U.N.N.Y. design snapshot from {escape(data['reviewed_at'])}. Component ownership, contracts, event flows, deployment and verification.">
<style>{css}</style></head>
<body><a class="skip" href="#main">Skip to document</a>
<header class="mobile-bar"><a href="{prefix}index.html">B.U.N.N.Y. / SYSTEM DESIGN</a><button id="menu-toggle" aria-expanded="false" aria-controls="sidebar">Documents</button></header>
<aside class="sidebar" id="sidebar"><a class="wordmark" href="{prefix}index.html"><span class="mark" aria-hidden="true">B/</span><span>B.U.N.N.Y.<small>SYSTEM DESIGN ATLAS</small></span></a>
<p class="edition">Working name · local first</p>
<label class="search-label" for="search">Find a document</label><input id="search" type="search" placeholder="Music, state, storage…" autocomplete="off">
<p id="search-count" class="search-count" role="status" aria-live="polite">{len(data['components'])} component documents</p>
<nav aria-label="Document navigation">{nav}</nav>
<div class="sidebar-foot">Historical design snapshot<br><strong>{escape(data['reviewed_at'])}</strong><br>Follow owning issues for current status.</div></aside>
<div class="page"><div class="topbar"><span>PERSONAL DEVICE SYSTEM / DESIGN DOCUMENTS</span><div><button id="theme-toggle" type="button" aria-pressed="false">Light mode</button><button id="motion-toggle" type="button" aria-pressed="false">Pause motion</button><button id="print" type="button">Print</button></div></div>
<main id="main" tabindex="-1">{notice}{content}</main>
<footer><span>B.U.N.N.Y. · dated design snapshot, generated HTML</span><a href="{escape(data['issue'])}" target="_blank" rel="noopener noreferrer">Documentation issue ↗</a></footer></div>
<script>{script}</script></body></html>\n'''


def component_body(item, data, full=False):
    title = "h2" if full else "h1"
    section_title = "h3" if full else "h2"
    dep_items = {x["id"]: x for x in data["components"]}
    dependencies = "".join(f'<a href="{link(dep_items[d], "full" if full else "component")}">{escape(d)}</a>'
                           for d in item["depends_on"]) or "No selected design dependency"
    evidence = "".join(f'<li><a href="{escape(s["url"])}" target="_blank" rel="noopener noreferrer">{escape(s["label"])}</a></li>'
                       for s in item["sources"])
    return f'''<article class="document" id="{item['id']}"><header class="doc-header"><p class="eyebrow">{escape(item['group'])} / {escape(item['id'])}</p>
<{title}>{escape(item['name'])}</{title}><p class="lead">{escape(item['summary'])}</p><div class="doc-meta">{badge(item)}<span>{escape(item['type'])}</span></div></header>
<div class="dependency-strip"><span>Design references</span>{dependencies}</div>
<div class="prose">{fragment(item, full)}</div>
<section class="evidence" id="{item['id']}-sources"><{section_title}>Source and delivery owners</{section_title}><ul>{evidence}</ul></section></article>'''


def build(check=False):
    data = load()
    system, walk = shared_diagrams(data)
    intro = (ROOT / "source/system.html").read_text(encoding="utf-8")
    if intro.count("<!--SYSTEM-MAP-->") != 1 or intro.count("<!--WALKTHROUGH-->") != 1:
        raise ValueError("system.html must contain one system-map marker and one walkthrough marker")
    intro = intro.replace("<!--SYSTEM-MAP-->", map_section(data, system)).replace("<!--WALKTHROUGH-->", walkthrough_section(data, walk))
    cards = []
    for item in data["components"]:
        cards.append(f'''<a class="component-card" href="components/{item['id']}.html" data-search="{escape(item['id']+' '+item['name']+' '+item['summary']+' '+item['group'])}">
<div class="card-top"><span>{escape(item['id'])}</span>{badge(item)}</div><h3>{escape(item['name'])}</h3><p>{escape(item['summary'])}</p><span class="card-foot">{escape(item['group'])}<span aria-hidden="true">↗</span></span></a>''')
    catalog = '<section id="catalog"><div class="section-heading"><p class="eyebrow">THE DOCUMENT SET</p><h2>Explore the system.</h2><p>Each document owns one responsibility. References connect the designs without implying separate processes or startup order.</p></div><div class="catalog">'+"".join(cards)+'</div><p id="empty" hidden>No matching documents. Try a component name or clear the search.</p></section>'
    outputs = {ROOT / "index.html": frame(data, "Overview", intro + catalog)}
    full_intro = re.sub(r'href="components/([A-Z][A-Z0-9-]*-[a-z][a-z0-9-]*)\.html(#[^"]*)?"',
                        lambda m: 'href="' + (m[2] or "#" + m[1]) + '"', intro)
    full_intro = full_intro.replace('<details class="prose baseline"', '<details class="prose baseline" open')
    outputs[ROOT / "full-system-design.html"] = frame(data, "Complete reading view", full_intro +
        '<section id="catalog"><h2>Component documents</h2><p class="reading-note">Complete reading view. Component documents follow in inventory order; use the sidebar to jump between them.</p></section>' +
        "".join(component_body(item, data, True) for item in data["components"]), "full")
    for item in data["components"]:
        outputs[ROOT / "components" / f'{item["id"]}.html'] = frame(data, item["name"], component_body(item, data), "component", item["id"])
    for path, content in outputs.items():
        if check:
            if not path.is_file() or path.read_text(encoding="utf-8") != content:
                raise ValueError(f"Generated document drift: {path.relative_to(ROOT)}")
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
    print(f'{"Verified" if check else "Built"} {len(outputs)} HTML documents from {len(data["components"])} component sources.')


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Check generated files without writing")
    build(parser.parse_args().check)
