#!/usr/bin/env python3
"""Check that guide and atlas styles take their colors from the token files.

Fails, naming file:line, on any hex, color-function or named color in the authored
style sources outside docs/skins/*.css, and on a token file that breaks the skin
contract (missing or unknown roles, a fixed color redefined by a skin, a light
fallback that differs from the light block, or decoration outside its skin scope).

    python3 docs/skins/check_tokens.py
"""
import io
import re
import sys
import tokenize
from pathlib import Path

SKINS = Path(__file__).resolve().parent
DOCS = SKINS.parent

FIXED = ('--repo-hub', '--repo-nanoleaf', '--repo-pixoo',
         '--status-open', '--status-active', '--status-blocked', '--status-completed', '--status-closed',
         '--status-delivered', '--status-planned', '--status-qualification', '--status-mixed', '--status-optional',
         '--edge-observe', '--edge-feed', '--edge-command', '--edge-other', '--walk-alt')
# Roles whose value changes with the theme; every skin sets them for dark, light and print.
COLOR_ROLES = ('--bg', '--panel', '--panel-translucent', '--raised', '--inset', '--text', '--muted',
               '--edge', '--edge-strong', '--edge-faint', '--accent', '--accent-ink', '--link', '--focus',
               '--pending', '--glow', '--grid-image')
ROLES = COLOR_ROLES + ('--grid-size', '--radius', '--font', '--mono', '--type-body', '--type-small', '--type-label',
                       '--space-xs', '--space-s', '--space-m', '--space-l', '--space-xl')
TOKEN_BLOCKS = {  # (media, selector) -> block name
    ('', ':root'): 'dark',
    ('@media screen', ':root[data-theme="light"]'): 'light',
    ('@media screen and (prefers-color-scheme:light)', ':root:not([data-theme="dark"])'): 'fallback',
    ('@media print', ':root'): 'print',
}

NAMED = frozenset('''aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet
brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan
darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred
darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue
dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green
greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon
lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon
lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta
maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen
mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab
orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peru pink plum powderblue
purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue
slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white
whitesmoke yellow yellowgreen canvas canvastext linktext visitedtext activetext buttonface buttontext buttonborder
field fieldtext highlight highlighttext selecteditem selecteditemtext mark marktext graytext accentcolor
accentcolortext'''.split())
# A hash after url(, href= or a selector quote is a fragment id, not a color.
HEX = re.compile(r'(?<![\w&/-])(?<!url\()(?<!href=")(?<!href=\')(?<!\(\')(?<!\(")#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])')
FUNCTION = re.compile(r'\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(', re.IGNORECASE)
# Named colors count only as values of color-bearing properties or SVG color attributes.
DECLARATION = re.compile(r'(?:(?<=[{;\s"\'(])|^)(--[\w-]+|color|fill|stroke|filter|outline(?:-color)?|box-shadow|text-shadow'
                         r'|background(?:-color|-image)?|border(?:-(?:top|right|bottom|left|block|inline)(?:-start|-end)?)?(?:-color)?'
                         r'|(?:stop|flood|lighting|caret|accent|scrollbar)-color|text-decoration(?:-color)?|column-rule(?:-color)?)'
                         r'\s*:\s*([^;{}"\n]*)')
ATTRIBUTE = re.compile(r'\b(?:fill|stroke|stop-color|flood-color|lighting-color|color)\s*=\s*["\']([^"\']*)["\']')
WORD = re.compile(r'(?<![\w-])[A-Za-z]+(?![\w-])')


def sources():
    """Authored style sources of the guide and atlas generators (token CSS files excluded)."""
    guide, atlas = DOCS / 'work-guide' / 'work', DOCS / 'system-design'
    return [guide / 'build_guide.py', *sorted(guide.glob('guide_*.css')), guide / 'guide_overview.js', guide / 'timeline.py',
            *sorted((atlas / 'assets').glob('*.css')), *sorted((atlas / 'assets').glob('*.js')), atlas / 'build.py',
            SKINS / 'skin.py']


def shown(path):
    return path.relative_to(DOCS.parent) if path.is_relative_to(DOCS.parent) else path


def blank(match):
    return re.sub(r'[^\n]', ' ', match.group())


def chunks(text, suffix):
    """(first line, text) pieces that can carry styles: Python string literals, or code without comments."""
    if suffix == '.py':
        kinds = {tokenize.STRING, getattr(tokenize, 'FSTRING_MIDDLE', None), getattr(tokenize, 'TSTRING_MIDDLE', None)} - {None}
        for token in tokenize.generate_tokens(io.StringIO(text).readline):
            if token.type in kinds:
                yield token.start[0], token.string
        return
    text = re.sub(r'/\*.*?\*/', blank, text, flags=re.S)
    if suffix == '.js':
        text = re.sub(r'(?m)(?<![:\\])//.*$', blank, text)
    yield 1, text


def color_literals(text, suffix):
    """Sorted (line, literal) pairs for every color literal in the given source text."""
    found = []
    for first, chunk in chunks(text, suffix):
        hits = [(m.start(), m.group()) for m in HEX.finditer(chunk)]
        hits += [(m.start(), chunk[m.start():chunk.find(')', m.start()) + 1]) for m in FUNCTION.finditer(chunk)]
        for m in DECLARATION.finditer(chunk):
            hits += [(m.start(2) + w.start(), w.group()) for w in WORD.finditer(m.group(2)) if w.group().lower() in NAMED]
        for m in ATTRIBUTE.finditer(chunk):
            if m.group(1).strip().lower() in NAMED:
                hits.append((m.start(1), m.group(1).strip()))
        found += [(first + chunk.count('\n', 0, position), literal) for position, literal in hits]
    return sorted(found)


def rules(css, media=''):
    """(media, selector, body) for each rule; nested @media flattens, other at-rules keep their prelude."""
    index = 0
    while (start := css.find('{', index)) >= 0:
        depth, end = 1, start + 1
        while depth:
            depth += {'{': 1, '}': -1}.get(css[end], 0)
            end += 1
        prelude, body = ' '.join(css[index:start].split()), css[start + 1:end - 1]
        if prelude.startswith('@media'):
            yield from rules(body, prelude)
        else:
            yield media, prelude, body
        index = end


def selectors(prelude):
    parts, depth, current = [], 0, ''
    for character in prelude:
        depth += {'(': 1, ')': -1}.get(character, 0)
        if character == ',' and depth == 0:
            parts.append(current.strip())
            current = ''
        else:
            current += character
    return parts + [current.strip()]


def token_file_problems(path, expected):
    """Contract problems for a token file; `expected` maps block names to required names."""
    name, problems, found, path = path.stem, [], {}, shown(path)
    css = re.sub(r'/\*.*?\*/', '', (DOCS.parent / path).read_text(encoding='utf-8'), flags=re.S)
    for media, prelude, body in rules(css):
        block = TOKEN_BLOCKS.get((media, prelude))
        if block:
            if block in found:
                problems.append(f'{path}: duplicate {block} token block')
            found[block] = (' '.join(body.split()), re.findall(r'(--[\w-]+)\s*:', body))
        elif prelude.startswith('@keyframes') or name == 'fixed':
            if name == 'fixed':
                problems.append(f'{path}: only token blocks belong here: {media} {prelude}'.strip())
        else:
            outside = [s for s in selectors(prelude) if not s.startswith(f'html[data-skin="{name}"]')]
            problems += [f'{path}: decoration outside html[data-skin="{name}"]: {s}' for s in outside]
    for block, required in expected.items():
        if block not in found:
            problems.append(f'{path}: missing {block} token block')
            continue
        names = found[block][1]
        problems += [f'{path}: {block} block lacks {role}' for role in required if role not in names]
        problems += [f'{path}: {block} block sets unknown or fixed token {token}' for token in names if token not in (FIXED if name == 'fixed' else ROLES)]
    if 'light' in found and 'fallback' in found and found['light'][0] != found['fallback'][0]:
        problems.append(f'{path}: the prefers-color-scheme fallback must match the light block')
    return problems


def main():
    problems = []
    scanned = sources()
    for path in scanned:
        if not path.is_file():
            problems.append(f'{shown(path)}: expected style source is missing')
            continue
        for line, literal in color_literals(path.read_text(encoding='utf-8'), path.suffix):
            problems.append(f'{shown(path)}:{line}: color literal {literal} (use a token from docs/skins)')
    problems += token_file_problems(SKINS / 'fixed.css', dict.fromkeys(('dark', 'light', 'fallback', 'print'), FIXED))
    skins = sorted(p for p in SKINS.glob('*.css') if p.name != 'fixed.css')
    if not skins:
        problems.append(f'{SKINS}: no skin file')
    for skin in skins:
        problems += token_file_problems(skin, {'dark': ROLES, 'light': COLOR_ROLES, 'fallback': COLOR_ROLES, 'print': COLOR_ROLES})
    for problem in problems:
        print(problem)
    if problems:
        print(f'FAIL: {len(problems)} token problems')
        return 1
    print(f'PASS: {len(scanned)} style sources use tokens only; fixed.css and {len(skins)} skin(s) '
          f'({", ".join(p.stem for p in skins)}) define every role')
    return 0


if __name__ == '__main__':
    sys.exit(main())
