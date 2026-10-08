// Hub #931: the `pixoo-migrated` run, which migrates a synthetic Pixoo library into its state directory before the
// shipped runtime starts on it, as the installer will at the cutover. The runtime serves the migrated library, and the
// migration tool refuses the run's state directory while its runtime holds the lease.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {pathToFileURL} from 'node:url';
import type {PlaylistRecord, RenditionRecord} from '@jimmie-potts/pixoo';
import {PIXOO_MIGRATION_EXIT, runPixooMigration} from '../../src/index.js';
import {pixooLibraryOf} from '../../tests/scenarios/modules/pixoo.js';
import {migrationOf, partTokensOf, stateDirOf} from '../seed.js';
import {base, startRun} from './support.js';

type Line = {result: string; code?: string; counts?: {renditions: number; playlists: number}; mismatches?: {total: number}; digest?: unknown};

/** The source library's playlists, each with its items' rendition IDs in order, read without changing the library. */
function sourcePlaylists(library: string): {id: string; renditionIds: string[]}[] {
  const url = pathToFileURL(join(library, 'catalog.sqlite'));
  url.search = '?mode=ro&immutable=1';
  const db = new DatabaseSync(url, {readOnly: true});
  try {
    return db.prepare('SELECT id FROM playlists ORDER BY id').all().map(row => ({
      id: String(row.id),
      renditionIds: db.prepare('SELECT rendition_id FROM items WHERE playlist_id = ? ORDER BY position').all(String(row.id)).map(item => String(item.rendition_id)),
    }));
  } finally {
    db.close();
  }
}

void test('the pixoo-migrated run serves the migrated library, and the tool refuses its running runtime', {timeout: 120_000}, async context => {
  const run = await startRun(context, await base(context), 'pixoo-migrated');
  try {
    const migrated = JSON.parse(await readFile(join(migrationOf(run.dataDir), 'migrate.json'), 'utf8')) as Line;
    const verified = JSON.parse(await readFile(join(migrationOf(run.dataDir), 'verify.json'), 'utf8')) as Line;
    assert.deepEqual([migrated.result, verified.result, verified.mismatches?.total], ['migrated', 'verified', 0]);
    assert.deepEqual(verified.digest, migrated.digest);

    const {reader} = JSON.parse(await readFile(partTokensOf(run.dataDir), 'utf8')) as {reader: string};
    const read = async <T>(family: string): Promise<T[]> => {
      const response = await fetch(new URL(`/api/v2/families/${family}`, run.url), {headers: {authorization: `Bearer ${reader}`}});
      assert.equal(response.status, 200, family);
      return (await response.json() as {records: T[]}).records;
    };
    const playlists = await read<PlaylistRecord>('pixoo-playlist');
    assert.deepEqual(playlists.map(playlist => ({id: playlist.id, renditionIds: playlist.items.map(item => item.renditionId)})).sort((a, b) => a.id < b.id ? -1 : 1),
      sourcePlaylists(pixooLibraryOf(run.dataDir)));
    assert.equal((await read<RenditionRecord>('pixoo-rendition')).length, migrated.counts?.renditions);

    let text = '';
    const exit = await runPixooMigration(['verify', '--library', pixooLibraryOf(run.dataDir), '--state-dir', stateDirOf(run.dataDir)], {write: line => { text += line; }});
    assert.deepEqual([exit, (JSON.parse(text) as Line).code], [PIXOO_MIGRATION_EXIT.refused, 'runtime-running']);
  } finally {
    await run.stop();
  }
});
