// The Neon skin's rule (style guide section 4), kept on the runtime's dashboard (Hub #922). It mirrors
// docs/skins/check_tokens.py: dashboard CSS reads colors only through the role and private tokens in src/skins/*.css,
// so this check flags any hex, rgb()/rgba()/hsl()/hsla() function or bare named color left in the authored styles, and
// any token the styles use that the skin does not define.
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {join, relative} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const SKINS = join(SRC, 'skins');

const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g;
const FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/gi;
const DECLARATION = /(?:(?<=[{;\s])|^)(color|fill|stroke|outline(?:-color)?|box-shadow|text-shadow|background(?:-color|-image)?|border(?:-(?:top|right|bottom|left))?(?:-color)?|accent-color|caret-color)\s*:\s*([^;{}]*)/gd;
const WORD = /(?<![\w-])[A-Za-z]+(?![\w-])/g;
const NAMED = new Set(['white', 'black', 'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'gray', 'grey',
  'cyan', 'magenta', 'lime', 'navy', 'teal', 'maroon', 'olive', 'silver', 'fuchsia', 'aqua']);
const TOKEN = /var\(\s*(--[\w-]+)/g;

/** Blanks comments to spaces so a literal mentioned in prose is never flagged, keeping line numbers stable. */
const stripComments = (text: string): string => text.replace(/\/\*.*?\*\//gs, comment => comment.replace(/[^\n]/g, ' '));

/** Sorted (line, literal) pairs for every color literal in the given CSS text. */
function colorLiterals(rawText: string): [number, string][] {
  const text = stripComments(rawText);
  const found: [number, string][] = [];
  for (const match of text.matchAll(HEX)) found.push([match.index, match[0]]);
  for (const match of text.matchAll(FUNCTION)) found.push([match.index, text.slice(match.index, text.indexOf(')', match.index) + 1)]);
  for (const match of text.matchAll(DECLARATION)) {
    const valueStart = match.indices?.[2]?.[0] ?? match.index;
    for (const word of (match[2] ?? '').matchAll(WORD)) if (NAMED.has(word[0].toLowerCase())) found.push([valueStart + word.index, word[0]]);
  }
  found.sort((a, b) => a[0] - b[0]);
  return found.map(([position, literal]) => [text.slice(0, position).split('\n').length, literal]);
}

/** (path, line, literal) for every color literal in the dashboard's authored CSS outside src/skins/. */
async function scanCssFiles(root = SRC): Promise<string[]> {
  const problems: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, {withFileTypes: true})) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (path !== SKINS) await walk(path);
        continue;
      }
      if (!entry.name.endsWith('.css')) continue;
      const text = await readFile(path, 'utf8');
      for (const [line, literal] of colorLiterals(text)) problems.push(`${relative('.', path)}:${line}: color literal ${literal} (use a token from ${relative('.', SKINS)})`);
    }
  };
  await walk(root);
  return problems;
}

/** Every custom property `var(--x)` names in `consumerText` that no rule in `tokenText` defines. */
function undefinedTokens(consumerText: string, tokenText: string): string[] {
  const defined = new Set([...stripComments(tokenText).matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]));
  const used = new Set([...stripComments(consumerText).matchAll(TOKEN)].map(match => match[1] ?? ''));
  return [...used].filter(name => !defined.has(name)).sort();
}

void test('dashboard CSS outside the skin file uses only role and private tokens', async () => {
  const problems = await scanCssFiles();
  assert.deepEqual(problems, [], problems.join('\n'));
});

void test('every token style.css consumes is defined in the skin file', async () => {
  const [style, skin] = await Promise.all([readFile(join(SRC, 'style.css'), 'utf8'), readFile(join(SKINS, 'neon-geometry-wars.css'), 'utf8')]);
  assert.deepEqual(undefinedTokens(style, skin), []);
});

void test('approval and input use blocked colors, while a continuing question keeps the question color', async () => {
  const style = stripComments(await readFile(join(SRC, 'style.css'), 'utf8'));
  for (const [state, token] of [['approval', '--chip-blocked'], ['input', '--chip-blocked'], ['question', '--chip-question']]) {
    for (const [element, properties] of [['session-dot', ['background']], ['chip', ['color', 'border-color']]] as const) {
      const selector = `.${element}[data-chip=${state}]`;
      const declarations = [...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter(match => (match[1] ?? '').split(',').some(part => part.trim() === selector))
        .flatMap(match => (match[2] ?? '').split(';'))
        .map(declaration => declaration.split(':').map(part => part.trim()));
      const values = new Map<string, string>();
      for (const [name, value] of declarations) if (name !== undefined && value !== undefined) values.set(name, value);
      for (const property of properties) assert.equal(values.get(property), `var(${token})`, `${selector} ${property}`);
    }
  }
});

void test('the check fails on a raw color added to style.css', () => {
  assert.deepEqual(colorLiterals('.example{color:#ff00aa}'), [[1, '#ff00aa']]);
  assert.deepEqual(colorLiterals('.example{background:rgba(255,0,0,.5)}'), [[1, 'rgba(255,0,0,.5)']]);
  assert.deepEqual(colorLiterals('.example{border-color:red}'), [[1, 'red']]);
  assert.deepEqual(colorLiterals('.example{background:var(--accent)}'), [], 'a token reference is not a color literal');
});

void test('a color literal mentioned only in a comment is not flagged', () => {
  assert.deepEqual(colorLiterals('/* was #ff00aa, now a token */.example{color:var(--text)}'), []);
});

void test('a typo’d token name is caught even though it is valid, silent CSS', () => {
  assert.deepEqual(undefinedTokens('.example{color:var(--acent)}', ':root{--accent:#22d3ee}'), ['--acent']);
  assert.deepEqual(undefinedTokens('.example{color:var(--accent)}', ':root{--accent:#22d3ee}'), []);
});
