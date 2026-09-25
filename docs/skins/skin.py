"""Shared skin assets for the generated work guide and the BUNNY atlas.

Both generators inline stylesheet() ahead of their own CSS, mark <html> with
HTML_ATTRIBUTES, put head_script() in <head> and run controls_script(). Each page
supplies a #theme-toggle and a #motion-toggle button. Stdlib only.
"""
from pathlib import Path
import re

DIR = Path(__file__).resolve().parent
SKIN = 'neon-geometry-wars'
HTML_ATTRIBUTES = f'data-skin="{SKIN}"'
# Shared by the guide and the atlas so a reader's choice follows them between the two.
THEME_KEY, MOTION_KEY = 'bunny-design-theme', 'bunny-design-motion'
# Archify variables the skin owns inside an embedded diagram. The diagram's --text is
# left unset so the page text token applies; its category and arrow palette stays Archify's.
ARCHIFY_TOKENS = {'--text-muted': 'var(--muted)', '--text-dim': 'var(--muted)',
                  '--grid': 'var(--edge-faint)', '--mask': 'var(--inset)'}


def stylesheet():
    """Fixed-meaning tokens, then the skin's role tokens and decoration."""
    return ''.join((DIR / name).read_text(encoding='utf-8') for name in ('fixed.css', f'{SKIN}.css'))


def head_script():
    """Sets data-theme (stored choice, else system preference) and a stored pause before first paint."""
    return ('<script>(()=>{const r=document.documentElement;let t=null,m=null;'
            f"try{{t=localStorage.getItem('{THEME_KEY}');m=localStorage.getItem('{MOTION_KEY}');}}catch{{}}"
            "r.dataset.theme=t==='light'||t==='dark'?t:matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';"
            "if(m==='paused')r.dataset.motion='paused';})();</script>")


def controls_script():
    """Theme and motion toggles. Only the paused state is stored; Resume never replays the opening."""
    return f'''(() => {{
 const root = document.documentElement, theme = document.querySelector('#theme-toggle'), motion = document.querySelector('#motion-toggle');
 const store = (key, value) => {{ try {{ if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); }} catch {{}} }};
 const sync = () => {{ theme.setAttribute('aria-pressed', String(root.dataset.theme === 'light')); motion.setAttribute('aria-pressed', String(root.dataset.motion === 'paused')); }};
 theme.addEventListener('click', () => {{ root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light'; store('{THEME_KEY}', root.dataset.theme); sync(); }});
 motion.addEventListener('click', () => {{ const pause = root.dataset.motion !== 'paused'; root.dataset.motion = pause ? 'paused' : 'running'; store('{MOTION_KEY}', pause ? 'paused' : null); sync(); }});
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
