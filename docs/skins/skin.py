"""Shared skin assets for the generated work guide and the B.U.N.N.Y. atlas.

Both generators inline stylesheet() ahead of their own CSS, mark <html> with
HTML_ATTRIBUTES, put head_script() in <head> and run controls_script(). Each page
supplies a #theme-toggle button. Stdlib only.
"""
from pathlib import Path
from html import escape
import json
import os
import re
from urllib.parse import urlsplit

DIR = Path(__file__).resolve().parent
REPO = DIR.parent.parent
SKIN = 'neon-geometry-wars'
HTML_ATTRIBUTES = f'data-skin="{SKIN}"'
# Shared by the guide and the atlas so a reader's choice follows them between the two.
THEME_KEY = 'bunny-design-theme'
# Stored by the retired Pause motion control; the head script removes it.
RETIRED_KEYS = ('bunny-design-motion',)
# Archify variables the skin owns inside an embedded diagram. The diagram's --text is
# left unset so the page text token applies; its category and arrow palette stays Archify's.
ARCHIFY_TOKENS = {'--text-muted': 'var(--muted)', '--text-dim': 'var(--muted)',
                  '--grid': 'var(--edge-faint)', '--mask': 'var(--inset)'}


def stylesheet():
    """Fixed-meaning tokens, then the skin's role tokens and decoration."""
    return ''.join((DIR / name).read_text(encoding='utf-8') for name in ('fixed.css', f'{SKIN}.css'))


def places():
    """Read and validate the shared, public-safe destination inventory."""
    data = json.loads((DIR / 'places.json').read_text(encoding='utf-8'))
    result = data['places']
    assert data['version'] == 1 and [p['id'] for p in result] == [
        'guide', 'architecture', 'atlas', 'reference', 'bunny', 'wall']
    assert [p['group'] for p in result] == ['Public'] * 4 + ['Local'] * 2
    assert [p['label'] for p in result] == [
        'Guide', 'Architecture', 'Atlas', 'Reference', 'B.U.N.N.Y.', 'Wall']
    for place in result:
        if place['group'] == 'Public':
            url = urlsplit(place['publicUrl'])
            assert url.scheme == 'https' and url.netloc == 'jimmie-potts.github.io'
            assert url.path.startswith('/agent-device-guide/') and not url.query and not url.fragment
            local = Path(place['localPath'])
            assert not local.is_absolute() and local.parts[0] == 'docs' and '..' not in local.parts
        else:
            url = urlsplit(place['localUrl'])
            assert url.scheme == 'http' and url.hostname == '127.0.0.1'
            assert url.path == '/' and not url.query and not url.fragment and not url.username
    return result


def places_stylesheet(include_fixed=False):
    return ((DIR / 'fixed.css').read_text(encoding='utf-8') if include_fixed else '') + (DIR / 'places-style.inc').read_text(encoding='utf-8')


def places_strip(current, output, public=False):
    """The same labels/order, with source-relative or published destinations."""
    output = Path(output).resolve()
    items = places()
    assert current in {p['id'] for p in items}
    links = []
    for place in items:
        label = escape(place['label'])
        tag = '<span class="places-nav__tag">Local</span>' if place['group'] == 'Local' else ''
        if place['id'] == current:
            links.append(f'<span class="places-nav__current" aria-current="page">{label}{tag}</span>')
        else:
            if place['group'] == 'Local':
                href = place['localUrl']
            elif public:
                href = place['publicUrl']
            else:
                href = os.path.relpath(REPO / place['localPath'], output.parent).replace(os.sep, '/')
            links.append(f'<a href="{escape(href, quote=True)}">{label}{tag}</a>')
    return (f'<!-- places:start --><nav class="places-nav" aria-label="Places" data-current="{current}">'
            f'<span class="places-nav__brand">B.U.N.N.Y. / {escape(next(p["label"] for p in items if p["id"] == current))}</span>'
            f'<span class="places-nav__links">{"".join(links)}</span></nav><!-- places:end -->')


def inject_places(document, current, output, public=False):
    """Insert or refresh one generated strip immediately after the body opens."""
    strip = places_strip(current, output, public=public)
    style = f'<style id="places-style">{places_stylesheet(include_fixed=True)}</style>'
    if '<style id="places-style">' in document:
        document, count = re.subn(r'<style id="places-style">.*?</style>', lambda _: style, document, count=1, flags=re.S)
        assert count == 1
    else:
        assert document.count('</head>') == 1
        document = document.replace('</head>', style + '</head>', 1)
    if '<!-- places:start -->' in document:
        changed, count = re.subn(r'<!-- places:start -->.*?<!-- places:end -->', strip, document, count=1, flags=re.S)
        assert count == 1 and '<!-- places:start -->' not in changed.replace(strip, '', 1)
        return changed
    changed, count = re.subn(r'(<body\b[^>]*>)', lambda m: m.group(1) + strip, document, count=1)
    assert count == 1
    return changed


def head_script():
    """Sets data-theme (stored choice, else system preference) before first paint."""
    retired = ''.join(f"localStorage.removeItem('{key}');" for key in RETIRED_KEYS)
    return ('<script>(()=>{const r=document.documentElement;let t=null;'
            f"try{{t=localStorage.getItem('{THEME_KEY}');{retired}}}catch{{}}"
            "r.dataset.theme=t==='light'||t==='dark'?t:matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';})();</script>")


def controls_script():
    """Theme toggle; the choice is stored for both pages."""
    return f'''(() => {{
 const root = document.documentElement, theme = document.querySelector('#theme-toggle');
 const store = (key, value) => {{ try {{ localStorage.setItem(key, value); }} catch {{}} }};
 const sync = () => theme.setAttribute('aria-pressed', String(root.dataset.theme === 'light'));
 theme.addEventListener('click', () => {{ root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light'; store('{THEME_KEY}', root.dataset.theme); sync(); }});
 sync();
}})();
'''


def archify_variables(classes, scope):
    """Per-theme variables for Archify's class rules inside `scope` (the embedded diagram)."""
    used = set(re.findall(r'var\((--[\w-]+)', ''.join(classes['rules'].values())))
    def palette(theme):
        return ';'.join(f'{name}:{value}' for name, value in classes[theme].items()
                        if name in used and name not in ARCHIFY_TOKENS and name != '--text')
    tokens = ';'.join(f'{name}:{value}' for name, value in ARCHIFY_TOKENS.items())
    light = palette('light')
    return (f'{scope}{{{palette("dark")};{tokens}}}'
            f'@media screen{{:root[data-theme="light"] {scope}{{{light}}}}}'
            f'@media screen and (prefers-color-scheme:light){{:root:not([data-theme="dark"]) {scope}{{{light}}}}}'
            f'@media print{{{scope}{{{light}}}}}')
