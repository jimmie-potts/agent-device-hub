// The runtime's recorded spans in a bounded, private file pair in its state directory (Hub #950): the destination a
// disposable verification run reads from outside the runtime's process. It keeps the latest spans, like the in-memory
// buffer, and says how many it let go.
import assert from 'node:assert/strict';
import {chmod, link, mkdir, readFile, readdir, stat, symlink, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {RuntimeError} from '../src/index.js';
import {SPANS_FILE, SPANS_PREVIOUS_FILE, openSpanFile, readSpanFile} from '../src/span-file.js';
import {it, stateDir} from './support.js';

const span = (index: number): string => JSON.stringify({resourceSpans: [{scopeSpans: [{spans: [{spanId: String(index).padStart(16, '0')}]}]}]});
const idOf = (line: string): number => Number((JSON.parse(line) as {resourceSpans: {scopeSpans: {spans: {spanId: string}[]}[]}[]}).resourceSpans[0]?.scopeSpans[0]?.spans[0]?.spanId);

it('a finished span is a line in an owner-only file in the state directory, and reading returns it', async context => {
  const dir = await stateDir(context);
  const file = openSpanFile(dir);
  file.sink(span(1));
  file.sink(span(2));
  file.close();
  assert.equal((await stat(join(dir, SPANS_FILE))).mode & 0o777, 0o600);
  assert.deepEqual((await readdir(dir)).sort(), [SPANS_FILE]);
  const read = readSpanFile(dir);
  assert.deepEqual(read.lines.map(idOf), [1, 2]);
  assert.deepEqual([read.present, read.evicted, read.unreadable], [true, 0, 0]);
});

it('a state directory with no span file reads as absent, never as a file with no spans', async context => {
  const read = readSpanFile(await stateDir(context));
  assert.deepEqual([read.present, read.lines, read.evicted, read.unreadable], [false, [], undefined, 0]);
});

it('the file keeps the latest spans, in order, within its bound, and counts every span it let go', async context => {
  const dir = await stateDir(context);
  const file = openSpanFile(dir, {segmentSpans: 4});
  for (let index = 1; index <= 21; index += 1) file.sink(span(index));
  file.close();
  const read = readSpanFile(dir);
  const kept = read.lines.map(idOf);
  assert.ok(kept.length >= 4 && kept.length <= 8, `at most two segments: ${kept.length}`);
  assert.deepEqual(kept, Array.from({length: kept.length}, (_, offset) => 21 - kept.length + 1 + offset), 'the newest, oldest first, with no gap');
  assert.equal(read.evicted, 21 - kept.length, 'every span let go is counted');
  assert.deepEqual((await readdir(dir)).sort(), [SPANS_FILE, SPANS_PREVIOUS_FILE]);
  assert.equal((await stat(join(dir, SPANS_PREVIOUS_FILE))).mode & 0o777, 0o600);
});

it('a segment also ends at its byte bound, so a few large spans cannot exceed it', async context => {
  const dir = await stateDir(context);
  const big = (index: number): string => JSON.stringify({resourceSpans: [], index, padding: 'x'.repeat(1500)});
  const file = openSpanFile(dir, {segmentBytes: 4096});
  for (let index = 1; index <= 12; index += 1) file.sink(big(index));
  file.close();
  const bytes = (await stat(join(dir, SPANS_FILE))).size + (await stat(join(dir, SPANS_PREVIOUS_FILE))).size;
  assert.ok(bytes <= 2 * 4096 + 512, `two segments of 4 KiB and their headers: ${bytes}`);
  const read = readSpanFile(dir);
  assert.equal(read.lines.length + (read.evicted ?? 0), 12, 'kept and let go account for every span');
});

it('a restarted runtime continues the same files: the order and the count of spans let go carry over', async context => {
  const dir = await stateDir(context);
  const first = openSpanFile(dir, {segmentSpans: 3});
  for (let index = 1; index <= 7; index += 1) first.sink(span(index));
  first.close();
  const second = openSpanFile(dir, {segmentSpans: 3});
  for (let index = 8; index <= 11; index += 1) second.sink(span(index));
  second.close();
  const read = readSpanFile(dir);
  const kept = read.lines.map(idOf);
  assert.deepEqual(kept, Array.from({length: kept.length}, (_, offset) => 11 - kept.length + 1 + offset));
  assert.equal(read.evicted, 11 - kept.length);
});

it('a span line that could be read as two, or that is far over the contract\'s record size, is refused and not written', async context => {
  const dir = await stateDir(context);
  const file = openSpanFile(dir);
  assert.throws(() => { file.sink('{"a":1}\n{"b":2}'); });
  assert.throws(() => { file.sink('x'.repeat(8193)); });
  file.sink(span(1));
  file.close();
  assert.deepEqual(readSpanFile(dir).lines.map(idOf), [1]);
});

it('a closed file refuses a span, so the host counts it as lost', async context => {
  const file = openSpanFile(await stateDir(context));
  file.close();
  assert.throws(() => { file.sink(span(1)); });
  file.close();
});

it('a link, a second hard link and a group-readable file are refused, so a span never lands outside the state directory', async context => {
  const linked = await stateDir(context);
  await writeFile(join(linked, 'elsewhere'), '', {mode: 0o600});
  await symlink(join(linked, 'elsewhere'), join(linked, SPANS_FILE));
  assert.throws(() => openSpanFile(linked), (error: unknown) => error instanceof RuntimeError && error.code === 'span-file-not-private');
  assert.equal(await readFile(join(linked, 'elsewhere'), 'utf8'), '', 'nothing was written through the link');

  const shared = await stateDir(context);
  await writeFile(join(shared, 'other'), '', {mode: 0o600});
  await link(join(shared, 'other'), join(shared, SPANS_FILE));
  assert.throws(() => openSpanFile(shared), (error: unknown) => error instanceof RuntimeError && error.code === 'span-file-not-private');

  const open = await stateDir(context);
  await writeFile(join(open, SPANS_FILE), '', {mode: 0o600});
  await chmod(join(open, SPANS_FILE), 0o640);
  assert.throws(() => openSpanFile(open), (error: unknown) => error instanceof RuntimeError && error.code === 'span-file-not-private');
});

it('reading counts a line that is cut short or is not a span, and never returns it', async context => {
  const dir = await stateDir(context);
  const header = JSON.stringify({schema: 'runtime-spans/1.0', evicted: 5});
  await writeFile(join(dir, SPANS_FILE), `${header}\n${span(1)}\nnot json\n${span(2)}\n${span(3).slice(0, 20)}`, {mode: 0o600});
  const read = readSpanFile(dir);
  assert.deepEqual(read.lines.map(idOf), [1, 2]);
  assert.deepEqual([read.evicted, read.unreadable], [5, 2], 'the bad line and the cut line, and the count of spans let go from the header');
});

it('reading a file with no header, after a rotation, says the count of spans let go is unknown', async context => {
  const dir = await stateDir(context);
  await mkdir(dir, {recursive: true});
  await writeFile(join(dir, SPANS_PREVIOUS_FILE), `${span(1)}\n`, {mode: 0o600});
  await writeFile(join(dir, SPANS_FILE), `${span(2)}\n`, {mode: 0o600});
  const read = readSpanFile(dir);
  assert.deepEqual(read.lines.map(idOf), [1, 2]);
  assert.equal(read.evicted, undefined);
});

it('a file that grew past its bound is read only up to it, and says so', async context => {
  const dir = await stateDir(context);
  const lines = Array.from({length: 200}, (_, index) => span(index + 1)).join('\n');
  await writeFile(join(dir, SPANS_FILE), `${lines}\n`, {mode: 0o600});
  const read = readSpanFile(dir, {segmentBytes: 1024});
  assert.ok(read.lines.length < 200, 'not every line');
  assert.ok(read.truncated, 'and the read says it stopped');
});
