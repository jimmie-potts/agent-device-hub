#!/usr/bin/env python3
"""Build BUNNY's HTML document set from its inventory and authored HTML fragments."""
from __future__ import annotations

import argparse
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ID = re.compile(r"[A-Z][A-Z0-9-]*-[a-z][a-z0-9-]*\Z")


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
    return data


def link(item, mode):
    if mode == "full":
        return "#" + item["id"]
    return ("" if mode == "component" else "components/") + item["id"] + ".html"


def badge(item):
    return f'<span class="badge {escape(item["status"])}">{escape(item["status_label"])}</span>'


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
    css = (ROOT / "assets/style.css").read_text(encoding="utf-8")
    script = (ROOT / "assets/app.js").read_text(encoding="utf-8")
    prefix = "../" if mode == "component" else ""
    nav = navigation(data, mode, current)
    return f'''<!doctype html>
<html lang="en" data-theme="dark">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{escape(title)} · BUNNY system design</title>
<meta name="description" content="BUNNY system design. Component ownership, contracts, event flows, deployment and verification.">
<style>{css}</style></head>
<body><a class="skip" href="#main">Skip to document</a>
<header class="mobile-bar"><a href="{prefix}index.html">BUNNY / SYSTEM DESIGN</a><button id="menu-toggle" aria-expanded="false" aria-controls="sidebar">Documents</button></header>
<aside class="sidebar" id="sidebar"><a class="wordmark" href="{prefix}index.html"><span class="mark" aria-hidden="true">B/</span><span>BUNNY<small>SYSTEM DESIGN ATLAS</small></span></a>
<p class="edition">Working name · local first</p>
<label class="search-label" for="search">Find a document</label><input id="search" type="search" placeholder="Music, state, storage…" autocomplete="off">
<p id="search-count" class="search-count" role="status" aria-live="polite">{len(data['components'])} component documents</p>
<nav aria-label="Document navigation">{nav}</nav>
<div class="sidebar-foot">Design baseline<br><strong>{escape(data['reviewed_at'])}</strong><br>Source and runtime evidence stay separate.</div></aside>
<div class="page"><div class="topbar"><span>PERSONAL DEVICE SYSTEM / DESIGN DOCUMENTS</span><div><button id="theme-toggle" type="button">Light mode</button><button id="print" type="button">Print</button></div></div>
<main id="main" tabindex="-1">{content}</main>
<footer><span>BUNNY · editable design, generated HTML</span><a href="{escape(data['issue'])}" target="_blank" rel="noopener noreferrer">Documentation issue ↗</a></footer></div>
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
    intro = (ROOT / "source/system.html").read_text(encoding="utf-8")
    cards = []
    for item in data["components"]:
        cards.append(f'''<a class="component-card" href="components/{item['id']}.html" data-search="{escape(item['id']+' '+item['name']+' '+item['summary']+' '+item['group'])}">
<div class="card-top"><span>{escape(item['id'])}</span>{badge(item)}</div><h3>{escape(item['name'])}</h3><p>{escape(item['summary'])}</p><span class="card-foot">{escape(item['group'])}<span aria-hidden="true">↗</span></span></a>''')
    catalog = '<section id="catalog"><div class="section-heading"><p class="eyebrow">THE DOCUMENT SET</p><h2>Explore the system.</h2><p>Each document owns one responsibility. References connect the designs without implying separate processes or startup order.</p></div><div class="catalog">'+"".join(cards)+'</div><p id="empty" hidden>No matching documents. Try a component name or clear the search.</p></section>'
    outputs = {ROOT / "index.html": frame(data, "Overview", intro + catalog)}
    full_intro = re.sub(r'href="components/([A-Z][A-Z0-9-]*-[a-z][a-z0-9-]*)\.html(#[^"]*)?"',
                        lambda m: 'href="' + (m[2] or "#" + m[1]) + '"', intro)
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
