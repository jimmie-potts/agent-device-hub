import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {folderReader, type MarkerRead} from '../src/index.js';
import {it} from './support.js';

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
