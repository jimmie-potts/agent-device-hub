import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {join, relative} from 'node:path';

// Mirrors docs/skins/check_tokens.py: dashboard CSS reads colors only through the
// role and private tokens in src/skins/*.css. This check flags any hex, rgb()/rgba()/
// hsl()/hsla() function or bare named color left in the authored dashboard styles.
const SRC = 'apps/dashboard/src';
const SKINS = join(SRC, 'skins');

const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g;
const FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/gi;
const DECLARATION = /(?:(?<=[{;\s])|^)(color|fill|stroke|outline(?:-color)?|box-shadow|text-shadow|background(?:-color|-image)?|border(?:-(?:top|right|bottom|left))?(?:-color)?|accent-color|caret-color)\s*:\s*([^;{}]*)/gd;
const WORD = /(?<![\w-])[A-Za-z]+(?![\w-])/g;
const NAMED = new Set(['white', 'black', 'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'gray', 'grey',
 'cyan', 'magenta', 'lime', 'navy', 'teal', 'maroon', 'olive', 'silver', 'fuchsia', 'aqua', 'transparent'].filter(w => w !== 'transparent'));

/** Sorted (line, literal) pairs for every color literal in the given CSS text. */
export function colorLiterals(text) {
 const found = [];
 for (const m of text.matchAll(HEX)) found.push([m.index, m[0]]);
 for (const m of text.matchAll(FUNCTION)) found.push([m.index, text.slice(m.index, text.indexOf(')', m.index) + 1)]);
 for (const m of text.matchAll(DECLARATION)) {
  const valueStart = m.indices[2][0];
  for (const w of m[2].matchAll(WORD)) if (NAMED.has(w[0].toLowerCase())) found.push([valueStart + w.index, w[0]]);
 }
 found.sort((a, b) => a[0] - b[0]);
 return found.map(([position, literal]) => [text.slice(0, position).split('\n').length, literal]);
}

/** (path, line, literal) for every color literal in the dashboard's authored CSS outside src/skins/. */
export async function scanCssFiles(root = SRC) {
 const problems = [];
 async function walk(dir) {
  for (const entry of await readdir(dir, {withFileTypes: true})) {
   const path = join(dir, entry.name);
   if (entry.isDirectory()) { if (path !== SKINS) await walk(path); continue; }
   if (!entry.name.endsWith('.css')) continue;
   const text = await readFile(path, 'utf8');
   for (const [line, literal] of colorLiterals(text)) problems.push(`${relative('.', path)}:${line}: color literal ${literal} (use a token from ${relative('.', SKINS)})`);
  }
 }
 await walk(root);
 return problems;
}

test('dashboard CSS outside the skin file uses only role and private tokens', async () => {
 const problems = await scanCssFiles();
 assert.deepEqual(problems, [], problems.join('\n'));
});

test('the check fails on a raw color added to style.css', () => {
 assert.deepEqual(colorLiterals('.example{color:#ff00aa}'), [[1, '#ff00aa']]);
 assert.deepEqual(colorLiterals('.example{background:rgba(255,0,0,.5)}'), [[1, 'rgba(255,0,0,.5)']]);
 assert.deepEqual(colorLiterals('.example{border-color:red}'), [[1, 'red']]);
 assert.deepEqual(colorLiterals('.example{background:var(--accent)}'), [], 'a token reference is not a color literal');
});
