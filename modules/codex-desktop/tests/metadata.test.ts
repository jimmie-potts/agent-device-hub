import assert from 'node:assert/strict';
import {mkdir, mkdtemp, open, readFile, rm, truncate, writeFile, type FileHandle} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {folderReader, type MarkerRead} from '../src/index.js';
import {readDesktopMetadata} from '../src/metadata.js';
import {it} from './support.js';

it('Desktop titles include the latest row in the bounded tail after successful short reads', async context => {
  const home = await mkdtemp(join(tmpdir(), 'desktop-metadata-short-read-'));
  context.after(async () => { await rm(home, {recursive: true, force: true}); });
  const path = join(home, 'session_index.jsonl');
  await writeFile(path, JSON.stringify({id: 'outside', thread_name: 'Outside the tail'}) + '\n'
    + 'x'.repeat(1024 * 1024) + '\n'
    + JSON.stringify({id: 'one', thread_name: 'Old title'}) + '\n'
    + JSON.stringify({id: 'one', thread_name: 'Latest title'}) + '\n');
  const handle = await open(path, 'r');
  const prototype = Object.getPrototypeOf(handle) as FileHandle;
  const read = Object.getOwnPropertyDescriptor(prototype, 'read')?.value as FileHandle['read'];
  await handle.close();
  context.mock.method(prototype, 'read', async function (this: FileHandle, buffer: Buffer, offset: number, length: number, position: number) {
    assert.ok(buffer.length <= 1024 * 1024, 'the selected tail stays bounded');
    return read.call(this, {buffer, offset, length: Math.min(length, 4096), position});
  });
  assert.deepEqual((await readDesktopMetadata(home)).titles, [{id: 'one', title: {value: 'Latest title', source: 'provider'}}]);
});

it('Desktop titles stop at EOF when the index shrinks during a short read', async context => {
  const home = await mkdtemp(join(tmpdir(), 'desktop-metadata-eof-'));
  context.after(async () => { await rm(home, {recursive: true, force: true}); });
  const path = join(home, 'session_index.jsonl');
  const first = JSON.stringify({id: 'one', thread_name: 'Retained title'}) + '\n';
  await writeFile(path, first + JSON.stringify({id: 'two', thread_name: 'Removed title'}) + '\n');
  const handle = await open(path, 'r');
  const prototype = Object.getPrototypeOf(handle) as FileHandle;
  const read = Object.getOwnPropertyDescriptor(prototype, 'read')?.value as FileHandle['read'];
  await handle.close();
  let reads = 0;
  context.mock.method(prototype, 'read', async function (this: FileHandle, buffer: Buffer, offset: number, length: number, position: number) {
    if (reads++ === 0) await truncate(path, Buffer.byteLength(first));
    assert.ok(reads <= 2, 'reading must stop when the file returns EOF');
    return read.call(this, {buffer, offset, length, position});
  });
  assert.deepEqual((await readDesktopMetadata(home)).titles, [{id: 'one', title: {value: 'Retained title', source: 'provider'}}]);
  assert.equal(reads, 2, 'the second read observes EOF');
});

it('Desktop metadata reads archive filenames and existing index titles independently of a missing marker', async context => {
  const home = await mkdtemp(join(tmpdir(), 'desktop-metadata-'));
  context.after(async () => { await rm(home, {recursive: true, force: true}); });
  await mkdir(join(home, 'archived_sessions'));
  const transcript = join(home, 'archived_sessions', 'rollout-2026-10-08T01-00-00-one.jsonl');
  await writeFile(transcript, 'PRIVATE_TRANSCRIPT_CANARY');
  await writeFile(join(home, 'session_index.jsonl'), [
    {id: 'one', thread_name: 'Old title'}, {id: 'one', thread_name: 'Desktop title'},
    {id: 'unsafe', thread_name: 'x'.repeat(160) + ' token=SECRET_CANARY'},
    {id: 'unicode', thread_name: '😀'.repeat(200)},
  ].map(row => JSON.stringify(row)).join('\n'));
  const reader = folderReader();context.after(() => { reader.close(); });
  const read = async () => await reader.read(home, '') as MarkerRead & {archived: string[] | null; titles: unknown[]};
  const result = await read();
  assert.deepEqual(result.archived, ['one']);
  assert.deepEqual(result.titles, [{id: 'one', title: {value: 'Desktop title', source: 'provider'}}, {id: 'unicode', title: {value: '😀'.repeat(160), source: 'provider'}}]);
  assert.equal(await readFile(transcript, 'utf8'), 'PRIVATE_TRANSCRIPT_CANARY');
  await rm(transcript);
  assert.deepEqual((await read()).archived, []);
  await rm(join(home, 'archived_sessions'), {recursive: true});
  assert.equal((await read()).archived, null);
});
