// #839: the runtime's upgrade tools carry their own copy of the retained legacy Hub's installer helpers. This test
// proves the copy matches while both exist; delete it with apps/hub when #839 retires the Hub. The source check
// is the proof: each copied declaration equals the Hub's text apart from the listed rewrites, which the runtime's
// strict lint profile requires and which keep behavior for every argument. The fixture run is a spot check.
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {test} from 'node:test';

const source = (path: string): Promise<string> => readFile(join(process.cwd(), path), 'utf8');
const load = async (path: string): Promise<Record<string, unknown>> =>
  await import(pathToFileURL(join(process.cwd(), path)).href) as Record<string, unknown>;
/** The copy without its provenance header and imports. */
const body = (text: string): string => text.split('\n').filter(line => !line.startsWith('// ') && !line.startsWith('import ')).join('\n').trim();
const rewrite = (text: string, rewrites: readonly (readonly [string, string])[]): string => rewrites.reduce((result, [from, to]) => {
  assert.equal(result.split(from).length, 2, `one occurrence of ${from}`);
  return result.replace(from, to);
}, text);

/** Each rewrite is exact: `Boolean(x)` is `!!x`, `bytesRead` is a non-negative integer, `prefix` is always a string. */
const fileRewrites = [
  ['return !!path&&', 'return Boolean(path)&&'],
  ['if(!bytesRead)break;', 'if(bytesRead===0)break;'],
  ["const path=prefix?prefix+'/'+name:name;", "const path=prefix!==''?prefix+'/'+name:name;"],
] as const;
/** The cast calls the same function the non-null assertion did. */
const stageRewrites = [['info.uid!==process.getuid!()', 'info.uid!==(process.getuid as ()=>number)()']] as const;

/** The text of one top-level declaration: its first line through the first line that closes it at column 0. */
function declaration(text: string, name: string): string {
  const lines = text.split('\n');
  const start = lines.findIndex(line => new RegExp(`^(export )?async function ${name}\\(`).test(line));
  assert.ok(start >= 0, `${name} is declared`);
  if ((lines[start] ?? '').endsWith('}')) return lines[start] ?? '';
  const end = lines.findIndex((line, index) => index > start && line === '}');
  assert.ok(end > start, `${name} is closed`);
  return lines.slice(start, end + 1).join('\n');
}

void test('the runtime upgrade file helpers are the Hub helpers that the runtime uses, with the listed rewrites', async () => {
  const hub = (await source('apps/hub/src/install/files.ts')).split('\n');
  // Hub lines 7-12 and 16-70: hashing, canonical JSON, inventory types, validators, bounded reads and the inventory.
  // Its release identity types, release verifier and archive extractor stay with the Hub; the runtime does not use them.
  const copied = [...hub.slice(6, 12), ...hub.slice(15, 70)].join('\n');
  assert.match(copied, /^export const sha256/);
  assert.match(hub[70] ?? '', /^$/);
  assert.equal(body(await source('apps/runtime/src/upgrade-files.ts')), rewrite(copied, fileRewrites).trim());
});

void test('the runtime release-selection primitives are the Hub installer primitives, with the listed rewrite', async () => {
  const plan = await source('apps/hub/src/install/plan.ts'), stage = await source('apps/hub/src/install/stage.ts');
  const expected = [
    ...['optionalStat', 'privateRoot'].map(name => declaration(plan, name)),
    ...['syncDirectory', 'switchCurrent'].map(name => declaration(stage, name)),
  ].join('\n');
  assert.equal(body(await source('apps/runtime/src/upgrade-stage.ts')), rewrite(expected, stageRewrites));
  assert.deepEqual(Object.keys(await load('apps/runtime/dist/src/upgrade-stage.js')).sort(), ['privateRoot', 'switchCurrent', 'syncDirectory']);
});

void test('the runtime and Hub file helpers agree on the same fixtures', async t => {
  const runtime = await load('apps/runtime/dist/src/upgrade-files.js'), hub = await load('apps/hub/dist/install/files.js');
  const names = ['canonical', 'digest', 'fullRevision', 'hashRegular', 'inventory', 'readRegular', 'safeRelative', 'sha256'];
  assert.deepEqual(Object.keys(runtime).sort(), names);
  const root = await mkdtemp(join(tmpdir(), 'bunny-upgrade-files-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, 'tree/nested'), {recursive: true, mode: 0o700});
  await writeFile(join(root, 'tree/a.txt'), 'alpha\n', {mode: 0o600});
  await writeFile(join(root, 'tree/nested/b.bin'), Buffer.alloc(200 * 1024, 7), {mode: 0o640});
  await writeFile(join(root, 'tree/empty'), '', {mode: 0o600});
  await symlink('nested/b.bin', join(root, 'tree/link'));
  await mkdir(join(root, 'escape'), {mode: 0o700});
  await symlink('../../tree/a.txt', join(root, 'escape/out'));
  const outcome = async (name: string, args: unknown[]): Promise<unknown> => {
    const call = (module: Record<string, unknown>) => (module[name] as (...values: unknown[]) => unknown)(...args);
    const settle = async (module: Record<string, unknown>) => {
      try { return {value: await call(module)}; } catch (error) { return {error: String(error)}; }
    };
    const [left, right] = [await settle(runtime), await settle(hub)];
    assert.deepEqual(left, right, `${name}(${JSON.stringify(args)})`);
    return left;
  };
  const values: unknown[] = ['', 'a', 'a/b', '/a', 'a//b', './a', 'a/..', 'a\\b', 'a\0b', 0, 1, null, undefined, false, true, [], {},
    'a'.repeat(40), 'f'.repeat(64), 'F'.repeat(64), {b: [1, {d: 2, c: 'x'}], a: null}, [undefined]];
  for (const value of values) for (const name of ['canonical', 'digest', 'fullRevision', 'safeRelative']) await outcome(name, [value]);
  await outcome('sha256', ['text']);
  for (const path of ['tree/a.txt', 'tree/nested/b.bin', 'tree/empty', 'tree/link', 'tree', 'missing']) {
    await outcome('readRegular', [join(root, path)]);
    await outcome('hashRegular', [join(root, path)]);
  }
  await outcome('hashRegular', [join(root, 'tree/nested/b.bin'), 1024]);
  assert.ok('value' in (await outcome('inventory', [join(root, 'tree')]) as object), 'the fixture tree inventories');
  for (const args of [[join(root, 'escape')], [join(root, 'tree/link')], [join(root, 'tree'), 0], [join(root, 'tree'), 1024]]) await outcome('inventory', args);
});
