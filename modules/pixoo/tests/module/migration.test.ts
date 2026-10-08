// The Pixoo library migration (Hub #931) on a synthetic library of the installed release's schema version 3: what it
// carries, what it leaves in the backup, what it refuses, what its verifier catches, that the module starts on what it
// wrote, and that it never changes the source.
import assert from 'node:assert/strict';
import {after, before, describe, test} from 'node:test';
import {appendFile, chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, truncate, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openModuleDatabaseFile} from '@jimmie-potts/sdk';
import {acquireOwner} from '../../src/library/files.js';
import {MIGRATIONS, migrate} from '../../src/library/migrations.js';
import {
  INSTALLED_LIBRARY, InstalledLibrary, MigrationError, migrateLibrary, verifyMigration, writeSyntheticLibrary, type MigrationReport, type Mismatches,
  type SyntheticLibrary, type VerificationReport,
} from '../../src/migration/index.js';
import {sha256} from '../../src/migration/contracts.js';
import {openImmutable} from '../../src/migration/installed.js';
import {FAMILIES, type PlaylistRecord, type RenditionRecord} from '../../src/module/schemas.js';
import {World, waitFor} from './support.js';

let root: string;
let library: string;
let synthetic: SyntheticLibrary;
let sourceBefore: Map<string, string>;

/** Every entry under `dir`, by relative path: its type, mode, size, modification time and, for a file, its SHA-256. */
async function snapshot(dir: string): Promise<Map<string, string>> {
  const entries = new Map<string, string>();
  const walk = async (relative: string): Promise<void> => {
    for (const entry of await readdir(join(dir, relative), {withFileTypes: true})) {
      const path = join(relative, entry.name);
      const info = await lstat(join(dir, path));
      const content = entry.isFile() ? sha256(await readFile(join(dir, path))) : '';
      entries.set(path, `${entry.isDirectory() ? 'dir' : entry.isFile() ? 'file' : 'other'} ${info.mode.toString(8)} ${info.size} ${info.mtimeMs} ${content}`);
      if (entry.isDirectory()) await walk(path);
    }
  };
  await walk('');
  return entries;
}

/** A new destination as the runtime would give the module: its database file, opened as the runtime opens it, and a private folder. */
async function destination(): Promise<{databaseFile: string; folder: string; database: DatabaseSync}> {
  const dir = await mkdtemp(join(root, 'dest-'));
  const databaseFile = join(dir, 'pixoo.sqlite');
  // Private to its owner, and opened as the runtime's `openModuleDatabase` opens it: WAL with exclusive locking (#972).
  await writeFile(databaseFile, '', {mode: 0o600, flag: 'wx'});
  const database = openModuleDatabaseFile(databaseFile);
  const folder = join(dir, 'pixoo');
  await mkdir(folder, {mode: 0o700});
  return {databaseFile, folder, database};
}

/** Migrates the synthetic library into a new destination and closes it, as the tool does. */
async function migrated(source = library): Promise<{report: MigrationReport; databaseFile: string; folder: string}> {
  const {database, databaseFile, folder} = await destination();
  const installed = await InstalledLibrary.open(source);
  try {
    const report = await migrateLibrary(installed, {database, folder});
    return {report, databaseFile, folder};
  } finally {
    database.close();
    installed.close();
  }
}

async function verified(store: {databaseFile: string; folder: string}, source = library): Promise<VerificationReport> {
  const installed = await InstalledLibrary.open(source);
  try {
    return await verifyMigration(installed, store);
  } finally {
    installed.close();
  }
}

/** A copy of the synthetic library to tamper with. */
async function copyOfLibrary(): Promise<string> {
  const copy = join(await mkdtemp(join(root, 'copy-')), 'library');
  await cp(library, copy, {recursive: true});
  return copy;
}

/** The rows `sql` reads, from a file opened read-only and immutable, so reading the source changes nothing beside it. */
const rowsOf = (file: string, sql: string): unknown[] => {
  const db = openImmutable(file);
  try {
    return db.prepare(sql).all().map(row => ({...row}));
  } finally {
    db.close();
  }
};

const sleep = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });

/** How many files the folder holds, at any depth. */
async function filesIn(folder: string): Promise<number> {
  return (await readdir(folder, {recursive: true, withFileTypes: true})).filter(entry => entry.isFile()).length;
}

/**
 * The installed library with each read slowed down, so several copies are under way at once, and `onRead` told the
 * read's number before it reads; it may throw to fail that read.
 */
async function slowLibrary(onRead: (count: number) => void): Promise<InstalledLibrary> {
  const installed = await InstalledLibrary.open(library);
  const read = installed.read.bind(installed);
  let reads = 0;
  installed.read = async file => {
    reads += 1;
    const count = reads;
    await sleep(15);
    onRead(count);
    return read(file);
  };
  return installed;
}

const zero: Mismatches = {total: 0, database: 0, assets: 0, renditions: 0, playlists: 0, items: 0, leftInBackup: 0, files: 0, unexpected: 0};

void before(async () => {
  root = await mkdtemp(join(tmpdir(), 'pixoo-migration-'));
  library = join(root, 'library');
  synthetic = await writeSyntheticLibrary(library);
  sourceBefore = await snapshot(library);
});

void after(async () => {
  await rm(root, {recursive: true, force: true});
});

void describe('the Pixoo library migration', () => {
  void test('pins the installed release\'s schema: the module\'s first three migrations are its text', () => {
    assert.deepEqual(MIGRATIONS.slice(0, INSTALLED_LIBRARY.version).map(migration => sha256(migration.sql)), [...INSTALLED_LIBRARY.checksums]);
  });

  void test('carries every asset, rendition, playlist and item, byte for byte, and leaves sessions, the checkpoint and cleanups in the backup', async () => {
    const {report, databaseFile, folder} = await migrated();
    assert.deepEqual(report.counts, {
      assets: synthetic.assets, renditions: synthetic.renditions, playlists: synthetic.playlists, items: synthetic.items, originals: synthetic.assets,
      renditionFiles: report.counts.renditionFiles, bytes: report.counts.bytes,
    });
    // The deleted asset's original and the upload left in staging are the two files no catalog entry names.
    assert.deepEqual(report.leftInBackup, {sessions: 1, checkpoints: 1, cleanupJobs: 1, files: 2});
    assert.equal(report.largeGifOriginals, synthetic.largeGifOriginals);

    // The rows, as SQLite holds them, are the source's own.
    const source = join(library, 'catalog.sqlite');
    for (const sql of ['SELECT * FROM assets ORDER BY id', 'SELECT * FROM renditions ORDER BY id', 'SELECT * FROM playlists ORDER BY id', 'SELECT * FROM items ORDER BY id']) {
      assert.deepEqual(rowsOf(databaseFile, sql), rowsOf(source, sql), sql);
    }
    // Each playlist keeps its order and its references to renditions.
    for (const playlist of synthetic.order) {
      assert.deepEqual(rowsOf(databaseFile, `SELECT rendition_id FROM items WHERE playlist_id = '${playlist.id}' ORDER BY position`).map(row => (row as {rendition_id: string}).rendition_id),
        playlist.renditionIds);
    }
    for (const table of ['sessions', 'session_refs', 'playback_checkpoint', 'cleanup_jobs']) assert.deepEqual(rowsOf(databaseFile, `SELECT * FROM ${table}`), [], table);
    // The library's own forward migration ran: the destination is at its current schema, with nothing changed since.
    assert.deepEqual(rowsOf(databaseFile, 'PRAGMA user_version'), [{user_version: MIGRATIONS.length}]);
    assert.deepEqual(rowsOf(databaseFile, 'SELECT revision FROM catalog_revision'), [{revision: 0}]);

    // Every file the catalog names is byte-identical and private; nothing else was copied.
    const copied = await snapshot(folder);
    const files = [...copied].filter(([, entry]) => entry.startsWith('file'));
    assert.equal(files.length, report.counts.originals + report.counts.renditionFiles);
    for (const [path, entry] of copied) {
      if (entry.startsWith('dir')) {
        assert.equal((await stat(join(folder, path))).mode & 0o777, 0o700, path);
        continue;
      }
      assert.ok(path.startsWith('media/'), path);
      assert.deepEqual(await readFile(join(folder, path)), await readFile(join(library, path)), path);
      assert.equal((await stat(join(folder, path))).mode & 0o777, 0o600, path);
    }
    assert.deepEqual(await readdir(join(folder, 'media', 'staging')), [], 'the leftover staging folder is not carried');
    const orphans = (await readdir(join(library, 'media', 'originals'))).filter(name => !copied.has(join('media', 'originals', name)));
    assert.equal(orphans.length, 1, 'the deleted asset\'s original stays behind');
  });

  void test('a rerun into a fresh destination gives the same result, and the verifier finds nothing', async () => {
    const first = await migrated();
    const second = await migrated();
    assert.deepEqual(second.report, first.report);
    assert.deepEqual([...(await snapshot(second.folder))].map(([path, entry]) => [path, entry.split(' ').at(-1)]),
      [...(await snapshot(first.folder))].map(([path, entry]) => [path, entry.split(' ').at(-1)]));
    for (const store of [first, second]) {
      const report = await verified(store);
      assert.equal(report.result, 'verified');
      assert.deepEqual(report.mismatches, zero);
      assert.deepEqual(report.digest, first.report.digest, 'the verifier reads back what the migration wrote');
      assert.deepEqual(report.counts, first.report.counts);
    }
  });

  void test('reports counts, codes and hashes only: no name, title or path', async () => {
    const {report, databaseFile, folder} = await migrated();
    const text = JSON.stringify([report, await verified({databaseFile, folder})]);
    for (const name of synthetic.names) assert.ok(!text.includes(name), 'a name leaked');
    for (const path of [root, library, folder, databaseFile, 'Synthetic', 'private-931', 'media/', '.sqlite']) assert.ok(!text.includes(path), `a path leaked: ${path}`);
  });

  void test('the module starts on the migrated store and serves the migrated catalog and playlists, and plays one', async () => {
    const world = await World.open();
    try {
      const installed = await InstalledLibrary.open(library);
      const database = new DatabaseSync(world.databaseFile);
      try {
        await mkdir(world.folder, {mode: 0o700});
        await migrateLibrary(installed, {database, folder: world.folder});
      } finally {
        database.close();
        installed.close();
      }
      await world.start();
      const renditions = await world.synced<RenditionRecord>(FAMILIES.rendition);
      assert.equal(renditions.length, synthetic.renditions);
      const playlists = await world.synced<PlaylistRecord>(FAMILIES.playlist);
      assert.deepEqual(playlists.map(playlist => ({id: playlist.id, renditionIds: playlist.items.map(item => item.renditionId)})).sort((a, b) => a.id < b.id ? -1 : 1),
        synthetic.order);
      const [morning] = synthetic.order;
      const started = await world.request('media-start', 'org.bunny.media.start.requested', {playlistId: morning?.id}, {requestId: 'migrated-start'});
      assert.equal(started.status, 'accepted');
      const outcome = await world.outcome('migrated-start', 20_000);
      assert.deepEqual([outcome.data.result, outcome.data.evidence], ['succeeded', 'transmitted']);
      await waitFor(() => world.device.state().shown, 'the first item on the simulated Pixoo');
      assert.deepEqual(world.failures(), []);
    } finally {
      await world.close();
    }
  });

  void test('a failed read stops every copy before the migration fails, so nothing is written after it', async () => {
    const installed = await slowLibrary(count => { if (count === 9) throw new MigrationError('source-corrupt'); });
    const {database, folder} = await destination();
    try {
      await assert.rejects(migrateLibrary(installed, {database, folder}), {name: 'MigrationError', code: 'source-corrupt'});
      const atFailure = await filesIn(folder);
      await sleep(300);
      assert.equal(await filesIn(folder), atFailure, 'no copy was still being written once the migration failed');
      assert.ok(atFailure < installed.files.length, 'the failure stopped the copy');
    } finally {
      database.close();
      installed.close();
    }
  });

  void test('an abort stops every copy, and the migration fails as interrupted', async () => {
    const controller = new AbortController();
    const installed = await slowLibrary(count => { if (count === 9) controller.abort(); });
    const {database, folder} = await destination();
    try {
      await assert.rejects(migrateLibrary(installed, {database, folder}, {signal: controller.signal}), {name: 'MigrationError', code: 'interrupted'});
      const atFailure = await filesIn(folder);
      await sleep(300);
      assert.equal(await filesIn(folder), atFailure, 'no copy was still being written once the migration stopped');
      assert.ok(atFailure < installed.files.length, 'the abort stopped the copy');
    } finally {
      database.close();
      installed.close();
    }
  });

  void test('a full database at any step fails as disk-short: the installed schema, the rows and the forward migration', async () => {
    const steps = new Map<string, number>();
    for (let pages = 1; pages <= 40; pages += 1) {
      const installed = await InstalledLibrary.open(library);
      const {database, folder} = await destination();
      // SQLite's own full-disk path, as tests/fixtures/disk.ts takes it: no more pages than this.
      database.exec(`PRAGMA max_page_count = ${pages}`);
      try {
        await migrateLibrary(installed, {database, folder});
        steps.set('migrated', (steps.get('migrated') ?? 0) + 1);
      } catch (error) {
        assert.ok(error instanceof MigrationError, `${pages} pages: a MigrationError`);
        assert.equal(error.code, 'disk-short', `${pages} pages`);
        const version = Number((database.prepare('PRAGMA user_version').get() as {user_version: number}).user_version);
        const rows = version < INSTALLED_LIBRARY.version ? 0 : Number((database.prepare('SELECT count(*) AS n FROM assets').get() as {n: number}).n);
        const step = version < INSTALLED_LIBRARY.version ? 'installed schema' : rows === 0 ? 'rows' : 'forward migration';
        steps.set(step, (steps.get(step) ?? 0) + 1);
      } finally {
        database.close();
        installed.close();
      }
    }
    for (const step of ['installed schema', 'rows', 'forward migration', 'migrated']) assert.ok((steps.get(step) ?? 0) > 0, `${step}: ${JSON.stringify([...steps])}`);
  });

  void describe('refuses a source it cannot carry safely, before writing anything', () => {
    const refused = async (path: string): Promise<string> => {
      try {
        const installed = await InstalledLibrary.open(path);
        installed.close();
      } catch (error) {
        assert.ok(error instanceof MigrationError);
        return error.code;
      }
      return 'opened';
    };

    void test('a directory without a catalog, a missing directory, and a file where the library\'s folder should be', async () => {
      assert.equal(await refused(await mkdtemp(join(root, 'empty-'))), 'source-missing');
      assert.equal(await refused(join(root, 'no-such-library')), 'source-missing');
      assert.equal(await refused(join(library, 'catalog.sqlite')), 'source-missing');
    });

    void test('a library the Pixoo service holds', async () => {
      const owner = await acquireOwner(join(library, 'owner.sqlite'));
      try {
        assert.equal(await refused(library), 'source-in-use');
      } finally {
        owner.close();
      }
    });

    void test('a library without its owner lock file, so nothing can show that the Pixoo service is stopped', async () => {
      const copy = await copyOfLibrary();
      await rm(join(copy, 'owner.sqlite'));
      assert.equal(await refused(copy), 'source-not-clean');
    });

    void test('a running migration keeps the Pixoo service from opening the library', async () => {
      const installed = await InstalledLibrary.open(library);
      try {
        await assert.rejects(acquireOwner(join(library, 'owner.sqlite')), {code: 'busy'});
      } finally {
        installed.close();
      }
    });

    void test('a catalog whose log holds commits the file lacks', async () => {
      const copy = await copyOfLibrary();
      await writeFile(join(copy, 'catalog.sqlite-wal'), 'synthetic log');
      assert.equal(await refused(copy), 'source-not-clean');
    });

    void test('a library whose application or version marks are not the installed release\'s', async () => {
      for (const pragma of ['PRAGMA application_id = 0', 'PRAGMA user_version = 2']) {
        const copy = await copyOfLibrary();
        const db = new DatabaseSync(join(copy, 'catalog.sqlite'));
        db.exec(pragma);
        db.close();
        assert.equal(await refused(copy), 'source-schema', pragma);
      }
    });

    void test('a library at the module\'s schema version 4, or with a changed table', async () => {
      const current = await copyOfLibrary();
      const db = new DatabaseSync(join(current, 'catalog.sqlite'));
      migrate(db);
      db.close();
      assert.equal(await refused(current), 'source-schema');
      const altered = await copyOfLibrary();
      const other = new DatabaseSync(join(altered, 'catalog.sqlite'));
      other.exec('ALTER TABLE playlists ADD COLUMN color TEXT');
      other.close();
      assert.equal(await refused(altered), 'source-schema');
    });

    void test('a missing rendition frame, or a link in place of an original', async () => {
      const missing = await copyOfLibrary();
      const [rendition] = await readdir(join(missing, 'media', 'renditions'));
      await rm(join(missing, 'media', 'renditions', rendition ?? '', '0.png'));
      assert.equal(await refused(missing), 'source-corrupt');
      const linked = await copyOfLibrary();
      const [original = ''] = await readdir(join(linked, 'media', 'originals'));
      await rm(join(linked, 'media', 'originals', original));
      await symlink(join(library, 'media', 'originals', original), join(linked, 'media', 'originals', original));
      assert.equal(await refused(linked), 'source-corrupt');
    });

    void test('a manifest that no longer matches its catalog row stops the migration', async () => {
      const copy = await copyOfLibrary();
      const [rendition] = await readdir(join(copy, 'media', 'renditions'));
      const manifest = join(copy, 'media', 'renditions', rendition ?? '', 'manifest.json');
      const value = JSON.parse(await readFile(manifest, 'utf8')) as {effectiveDurationMs: number | null};
      value.effectiveDurationMs = (value.effectiveDurationMs ?? 0) + 1;
      await writeFile(manifest, JSON.stringify(value));
      await assert.rejects(migrated(copy), {name: 'MigrationError', code: 'source-corrupt'});
    });

    void test('a file whose bytes no longer match its catalog stops the copy', async () => {
      const copy = await copyOfLibrary();
      const [rendition] = await readdir(join(copy, 'media', 'renditions'));
      const frame = join(copy, 'media', 'renditions', rendition ?? '', '0.rgb');
      const bytes = await readFile(frame);
      bytes[0] = (bytes[0] ?? 0) ^ 0xff;
      await writeFile(frame, bytes);
      await assert.rejects(migrated(copy), {name: 'MigrationError', code: 'source-corrupt'});
    });
  });

  void describe('the verifier counts a planted corruption and stops the cutover (negative controls)', () => {
    const plant = async (corrupt: (store: {databaseFile: string; folder: string}) => void | Promise<void>): Promise<Mismatches> => {
      const store = await migrated();
      await corrupt(store);
      const report = await verified(store);
      assert.equal(report.result, 'mismatch');
      return report.mismatches;
    };
    const firstRendition = async (folder: string): Promise<string> => join(folder, 'media', 'renditions', (await readdir(join(folder, 'media', 'renditions')))[0] ?? '');
    const anOriginal = async (folder: string): Promise<string> => join(folder, 'media', 'originals', (await readdir(join(folder, 'media', 'originals')))[0] ?? '');
    const sql = (file: string, statement: string): void => {
      const db = new DatabaseSync(file);
      db.exec(statement);
      db.close();
    };

    void test('a changed byte in a frame', async () => {
      const found = await plant(async ({folder}) => {
        const frame = join(await firstRendition(folder), '0.rgb');
        const bytes = await readFile(frame);
        bytes[7] = (bytes[7] ?? 0) ^ 1;
        await writeFile(frame, bytes);
      });
      assert.deepEqual(found, {...zero, total: 1, files: 1});
    });

    void test('a missing original, a truncated manifest and a file others may read', async () => {
      assert.deepEqual(await plant(async ({folder}) => { await rm(await anOriginal(folder)); }), {...zero, total: 1, files: 1});
      assert.deepEqual(await plant(async ({folder}) => { await truncate(join(await firstRendition(folder), 'manifest.json'), 10); }), {...zero, total: 1, files: 1});
      assert.deepEqual(await plant(async ({folder}) => { await chmod(await anOriginal(folder), 0o644); }), {...zero, total: 1, files: 1});
    });

    void test('a link in place of a copied file', async () => {
      const found = await plant(async ({folder}) => {
        const original = await anOriginal(folder);
        await rm(original);
        await symlink(join(library, 'media', 'originals', original.split('/').at(-1) ?? ''), original);
      });
      assert.deepEqual(found, {...zero, total: 2, files: 1, unexpected: 1});
    });

    void test('an extra file in the module\'s folder', async () => {
      assert.deepEqual(await plant(async ({folder}) => { await writeFile(join(folder, 'media', 'staging', 'stray'), 'x'); }), {...zero, total: 1, unexpected: 1});
    });

    void test('a changed playlist, a reordered playlist, an extra asset and a carried session', async () => {
      const [morning] = synthetic.order;
      // A change to a catalog table also raises the catalog's revision, which the migration leaves at 0.
      assert.deepEqual(await plant(({databaseFile}) => { sql(databaseFile, `UPDATE playlists SET name = 'Renamed' WHERE id = '${morning?.id ?? ''}'`); }),
        {...zero, total: 2, playlists: 1, database: 1});
      assert.deepEqual(await plant(({databaseFile}) => {
        // Swaps the first two items, through a free position, as UNIQUE(playlist_id, position) requires.
        const where = `playlist_id = '${morning?.id ?? ''}' AND position`;
        sql(databaseFile, `UPDATE items SET position = 100 WHERE ${where} = 0; UPDATE items SET position = 0 WHERE ${where} = 1;
          UPDATE items SET position = 1 WHERE ${where} = 100`);
      }), {...zero, total: 3, items: 2, database: 1});
      assert.deepEqual(await plant(({databaseFile}) => {
        sql(databaseFile, 'INSERT INTO assets VALUES (\'00000000-0000-4000-8000-0000000000ff\', \'' + 'a'.repeat(64) + '\', \'Extra\', \'{}\', \'2026-09-01T00:00:00.000Z\')');
      }), {...zero, total: 2, assets: 1, database: 1});
      assert.deepEqual(await plant(({databaseFile}) => { sql(databaseFile, 'INSERT INTO sessions VALUES (\'00000000-0000-4000-8000-0000000000fe\', \'2026-09-01T00:00:00.000Z\')'); }),
        {...zero, total: 1, leftInBackup: 1});
    });

    void test('a database with commits only in its log, or not at the library\'s current schema', async () => {
      assert.deepEqual(await plant(async ({databaseFile}) => { await appendFile(`${databaseFile}-wal`, 'synthetic log'); }), {...zero, total: 1, database: 1});
      assert.deepEqual(await plant(({databaseFile}) => { sql(databaseFile, 'CREATE TABLE extra (id INTEGER)'); }), {...zero, total: 1, database: 1});
    });

    void test('a changed catalog revision, and rows in the module\'s own tables, which start fresh', async () => {
      assert.deepEqual(await plant(({databaseFile}) => { sql(databaseFile, 'UPDATE catalog_revision SET revision = 3'); }), {...zero, total: 1, database: 1});
      assert.deepEqual(await plant(({databaseFile}) => {
        sql(databaseFile, 'CREATE TABLE pixoo_state (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT; INSERT INTO pixoo_state VALUES (\'revision\', \'7\')');
      }), {...zero, total: 1, leftInBackup: 1});
      assert.deepEqual(await plant(({databaseFile}) => {
        sql(databaseFile, 'CREATE TABLE bunny_outbox (id TEXT PRIMARY KEY); INSERT INTO bunny_outbox VALUES (\'m1\'), (\'m2\')');
      }), {...zero, total: 2, leftInBackup: 2});
    });

    void test('a missing database counts every row as missing', async () => {
      const found = await plant(async ({databaseFile}) => { await rm(databaseFile); });
      assert.deepEqual(found, {
        ...zero, database: 1, assets: synthetic.assets, renditions: synthetic.renditions, playlists: synthetic.playlists, items: synthetic.items,
        total: 1 + synthetic.assets + synthetic.renditions + synthetic.playlists + synthetic.items,
      });
    });
  });

  // Last: the source is exactly as it was written, with no file added, changed or touched.
  void test('never changes the source library', async () => {
    assert.deepEqual(await snapshot(library), sourceBefore);
  });
});
