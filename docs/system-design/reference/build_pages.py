#!/usr/bin/env python3
"""Build the offline reference entry page and Scalar viewers."""
import argparse
import html
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent.parent / 'skins'))
import skin as SKIN  # noqa: E402
SERVICES = (
    ('pixoo', 'Pixoo', '25 operations', 'Media, playlists, player, device settings and the event stream.'),
    ('nanoleaf-controller', 'Nanoleaf controller', '4 operations', 'Machine discovery, snapshots, change polling and mode commands.'),
    ('nanoleaf-map', 'Nanoleaf wall map', '8 operations', 'The existing browser UI’s wall, project and task operations.'),
)
DATABASES = (
    ('pixoo-library', 'Pixoo media library', '9 tables', 'Assets, immutable renditions, playlists, retained sessions and playback recovery.'),
    ('pixoo-owner', 'Pixoo ownership lock', '1 table', 'Separate lock storage used to keep one library writer. It is not a shared hub database.'),
    ('nanoleaf', 'Nanoleaf state', '18 tables', 'Tasks, projects, wall preferences and controller state. No foreign keys are declared in the source DDL.'),
)


def write(path, content, check):
    path = ROOT/path
    content = SKIN.inject_places(content, 'reference', path)
    if check:
        assert path.read_text() == content, f'Generated page drift: {path}'
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding='utf-8')


def build(check=False):
    sources = json.loads((ROOT/'sources.json').read_text())
    css = (ROOT/'assets/reference.css').read_text()
    api_cards = ''.join(f'''<article class="card"><p class="kicker">HTTP API · {count}</p><h3>{name}</h3><p>{description}</p><div class="links"><a class="primary" href="api/{slug}.html">Explore endpoints <span aria-hidden="true">↗</span></a><a href="openapi/{slug}.json" download>OpenAPI JSON ↓</a></div></article>''' for slug,name,count,description in SERVICES)
    db_cards = ''.join(f'''<article class="card"><p class="kicker">SQLITE SCHEMA · {count}</p><h3>{name}</h3><p>{description}</p><div class="links"><a class="primary" href="database/{slug}/index.html">Explore tables <span aria-hidden="true">↗</span></a><a href="database/{slug}/relationships.html">Relationships</a><a href="schemas/{slug}.sql" download>DDL ↓</a></div></article>''' for slug,name,count,description in DATABASES)
    pins = ''.join(f'<li><strong>{key.title()}</strong><a href="https://github.com/jimmie-potts/{pin["repository"]}/tree/{pin["revision"]}"><code>{pin["revision"][:12]}</code> ↗</a></li>' for key,pin in sources['pins'].items())
    page = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>API &amp; database reference · B.U.N.N.Y.</title><meta name="description" content="Explore B.U.N.N.Y.'s existing device service endpoints and SQLite schemas, from pinned source code."><style>{css}</style></head>
<body><a class="skip" href="#main">Skip to reference</a><header class="top"><a class="brand" href="../index.html">B/ <span>B.U.N.N.Y.</span></a><nav aria-label="Reference navigation"><a href="../full-system-design.html">System design</a><a href="#apis">Endpoints</a><a href="#databases">Tables</a></nav></header>
<main id="main"><section class="hero"><p class="kicker">SYSTEM REFERENCE / 01</p><h1>See the interfaces.<br><span>Follow the data.</span></h1><p class="lead">Browse the endpoints and database structures behind the current Pixoo and Nanoleaf services.</p><div class="metrics"><div><strong>37</strong><span>HTTP operations</span></div><div><strong>28</strong><span>database tables</span></div><div><strong>2</strong><span>pinned source revisions</span></div></div></section>
<section id="apis"><div class="section-title"><div><p class="kicker">01 / SERVICE INTERFACES</p><h2>Endpoints, requests &amp; responses</h2></div><span class="tag">Scalar + OpenAPI 3.1</span></div><p class="intro">Search operations, inspect request fields and copy native-client examples. Each operation links to its source handler.</p><div class="cards">{api_cards}</div><aside class="note"><h3>From reference to a live request</h3><p>These pages work offline. Browser request controls are disabled because the services enforce their own origins and credentials. Download an OpenAPI file for a native API client and set its server to the configured local listener; <code>127.0.0.1:0</code> is an inactive documentation placeholder.</p><p>Pixoo native mutations require <code>X-Pixoo-Request: 1</code>. Nanoleaf’s machine API requires its controller bearer credential. The wall-map API uses a separate per-page token and origin check. Keep those credentials in the owning client.</p></aside></section>
<section id="databases"><div class="section-title"><div><p class="kicker">02 / PERSISTENT STRUCTURE</p><h2>Tables, keys &amp; relationships</h2></div><span class="tag">SchemaSpy · schema only</span></div><p class="intro">Generated from empty databases built from source DDL. Browse columns, indexes and declared foreign keys without connecting to a running controller.</p><div class="cards">{db_cards}</div><aside class="note"><h3>What these diagrams establish</h3><p>Relationships represent declared foreign keys, with inference disabled. Application-level links can exist without a database constraint. Index names in SchemaSpy may be JDBC display names; the downloadable DDL and <a href="schemas/nanoleaf.json">SQLite metadata</a> retain the source definition.</p><p>The planned B.U.N.N.Y. hub database has no delivered schema here. Controller storage remains private to each owner. These reports contain no task records, credentials, media or other live rows.</p></aside></section>
<section class="provenance"><div><p class="kicker">03 / EVIDENCE</p><h2>A reference you can trace</h2><p>Source baseline: 20 September 2026. The inventory covers explicit REST/SSE handlers; it excludes static assets, automatic HEAD routes and optional MCP protocol transports. Source delivery does not establish installation or physical-device acceptance.</p></div><div><ul class="pins">{pins}</ul><p><a href="sources.json">Source files &amp; hashes</a> · <a href="routes.json">Route inventory</a> · <a href="tools.json">Tool versions</a> · <a href="THIRD-PARTY-NOTICES.txt">Third-party notices</a></p></div></section></main><footer><span>B.U.N.N.Y. / source-backed reference</span><a href="../components/OPS-runbook.html">Refresh instructions ↗</a></footer></body></html>
'''
    write('index.html', page, check)
    for slug,name,_,_ in SERVICES:
        spec = json.loads((ROOT/'openapi'/f'{slug}.json').read_text())
        config = {
            'content':spec, 'theme':'kepler', 'layout':'modern', 'darkMode':True,
            'defaultOpenAllTags':True,
            'withDefaultFonts':False, 'telemetry':False, 'persistAuth':False,
            'hideTestRequestButton':True, 'hideClientButton':True,
            'showDeveloperTools':'never', 'agent':{'disabled':True},
            'customCss':':root { --scalar-font: system-ui, sans-serif; --scalar-font-code: ui-monospace, monospace; }',
        }
        serialized = json.dumps(config, ensure_ascii=False).replace('<','\\u003c')
        viewer = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{html.escape(name)} API · B.U.N.N.Y.</title><meta http-equiv="Content-Security-Policy" content="connect-src 'none'; font-src 'self' data:; img-src 'self' data: blob:;"><style>body{{margin:0;background:#101820;color:#edf4f4;font:15px/1.5 system-ui,sans-serif}}.reference-header{{padding:14px 24px;border-bottom:1px solid #384b4b;display:flex;flex-wrap:wrap;gap:8px 24px;align-items:center}}.reference-header a{{color:#9cf1d5}}.reference-header small{{color:#c1cccd}}a:focus-visible{{outline:2px solid #9cf1d5;outline-offset:4px}}</style></head><body><header class="reference-header"><a href="../index.html">← B.U.N.N.Y. reference</a><strong>{html.escape(name)}</strong><small>Offline reference · browser requests disabled · port 0 is a placeholder</small><a href="../openapi/{slug}.json" download>Download OpenAPI</a></header><main id="app"></main><script src="../assets/scalar-1.69.2.js"></script><script>Scalar.createApiReference('#app', {serialized});</script></body></html>
'''
        write(f'api/{slug}.html', viewer, check)
    print('Verified 4 reference pages.' if check else 'Built 4 reference pages.')


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check',action='store_true')
    build(parser.parse_args().check)
