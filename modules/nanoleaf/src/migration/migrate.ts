// Carries the bridge's preferences into the Nanoleaf module's own store and folder (Hub #933). The module's own schema code
// creates the destination's tables, as the module's start does; the carried rows go in through SQLite in one transaction,
// copied by SQL from the source attached read-only, so each value keeps its storage class; and the layout and scene files
// are written as new files private to their owner, never through a link. Nothing else is written: tasks, reservations,
// epochs, caches, the ledger and the legacy backup start fresh, and the module writes its own rows at its first start.
import {closeSync, constants, fsyncSync, openSync, rmSync, writeSync} from 'node:fs';
import {join} from 'node:path';
import type {DatabaseSync} from 'node:sqlite';
import {pyJsonIndented} from '../compat.js';
import {initialize} from '../database.js';
import {sceneFile, serialized} from '../devices.js';
import {MODULE_TABLES} from '../module/views.js';
import {transaction} from '../sqlite.js';
import {CARRIED_TABLES, filesDigest, MIGRATION_SCHEMA, sha256, storeDigest, type MigrationReport} from './contracts.js';
import {carriedMetaKeys, type InstalledState} from './installed.js';

/** Where the module keeps its state: its own SQLite database, open, and its private folder (Hub #919). */
export type Destination = {readonly database: DatabaseSync; readonly folder: string};

/** The layout file in the module's folder. */
export const LAYOUT_FILE = 'layout.json';

/** The files the destination's folder holds once migrated, by name: the layout of the registered devices and each scene file. */
export function expectedFiles(source: InstalledState): Map<string, unknown> {
  const files = new Map<string, unknown>();
  if (source.layouts.size > 0) files.set(LAYOUT_FILE, serialized(source.layouts));
  for (const [device, scene] of source.scenes) files.set(sceneFile(device), scene);
  return files;
}

/** The text the bridge's JSON writer gives a value, as the module's own writer does. */
export const fileText = (value: unknown): string => `${pyJsonIndented(value)}\n`;

/**
 * Migrates `source` into `destination`, which must be the module's fresh database and an empty private folder: the
 * caller checks both and holds the runtime's lease. Returns the report, with the digests of the carried rows and of the
 * written files. A failure part of the way leaves what was written; the caller discards the destination.
 */
export function migrateNanoleaf(source: InstalledState, destination: Destination): MigrationReport {
  const {database, folder} = destination;
  const ids = source.devices.map(device => device.id);
  // The module's own schema, as its start creates it.
  initialize(database, () => Date.now() / 1000);
  database.exec(MODULE_TABLES);
  const detach = source.attach(database);
  try {
    transaction(database, () => {
      // The schema seeds the Lines' default map settings; the source's rows of every registered device replace them.
      database.exec('DELETE FROM main.map_settings');
      for (const table of CARRIED_TABLES) {
        const copy = source.copyStatement(table, ids);
        if (copy !== undefined) database.prepare(copy.sql).run(...copy.params);
      }
      database.prepare('INSERT INTO main.meta (key, value) SELECT key, value FROM old.meta WHERE key IN (SELECT value FROM json_each(?))')
        .run(JSON.stringify(carriedMetaKeys(ids)));
    });
  } finally {
    detach();
  }
  const written: {name: string; sha256: string}[] = [];
  for (const [name, value] of expectedFiles(source)) {
    const text = fileText(value);
    writePrivate(join(folder, name), text);
    written.push({name, sha256: sha256(text)});
  }
  syncDirectory(folder);
  return {
    schema: MIGRATION_SCHEMA, operation: 'migrate', result: 'migrated', counts: source.counts, leftInBackup: source.leftInBackup,
    digest: {store: storeDigest(source.rows), files: filesDigest(written)},
  };
}

/**
 * Writes a new file private to its owner, which must not exist and is never reached through a link, and syncs it. A write
 * that fails part of the way removes the file it created.
 */
export function writePrivate(path: string, text: string): void {
  const descriptor = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  let whole = false;
  try {
    const bytes = Buffer.from(text, 'utf8');
    for (let offset = 0; offset < bytes.length;) offset += writeSync(descriptor, bytes, offset, bytes.length - offset);
    fsyncSync(descriptor);
    whole = true;
  } finally {
    closeSync(descriptor);
    // A file this call created and could not finish is its own to remove.
    if (!whole) rmSync(path, {force: true});
  }
}

/** Syncs a directory, so the names of the files created in it survive a crash. */
export function syncDirectory(path: string): void {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}
