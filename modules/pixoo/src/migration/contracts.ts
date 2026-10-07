// What the Pixoo library migration (Hub #931) reports and refuses. Every report carries counts, codes and SHA-256 digests
// only: never a path, a name, a title or a file's content (ADR 0011, ADR 0012 "Safe errors").
import {createHash} from 'node:crypto';

/** The schema of every line the migration writes. */
export const MIGRATION_SCHEMA = 'pixoo-migration/1.0';

/**
 * The library the migration reads: the Pixoo service's release that the installed `pixoo-playlist-controller` runs,
 * divoom-app-upgrade at `revision`, whose library stops at schema `version` 3. `checksums` are the SHA-256 digests of its
 * three migrations' SQL, as its `schema_migrations` table records them; the module's first three migrations are the same
 * text. The tool accepts this schema version only (owner decision, 2026-10-07).
 */
export const INSTALLED_LIBRARY = {
  revision: '1b4115c3b4f22220102382278052d55b6d287b9c',
  version: 3,
  checksums: [
    '3e655b485e4c17266f4de9cd091914b77ec9420d67ab2ac4d5dbd9c63a3dfcc8',
    '60f7d11b55fd4853e245d2f61f6d6417bacdec2ddb7f38b4b7328fa41912dfbc',
    '8b4b76645f94d1a907959d29d5e2916a9a77f965ac4bd1953e5db29161f0fd46',
  ],
} as const;

/** Why the migration refused a source library or gave up on one. */
export type MigrationCode = 'source-missing' | 'source-in-use' | 'source-not-clean' | 'source-schema' | 'source-corrupt';

const TEXT: Readonly<Record<MigrationCode, string>> = {
  'source-missing': 'The library directory holds no catalog file.',
  'source-in-use': 'The Pixoo service holds the library: stop it first.',
  'source-not-clean': 'The library was not closed cleanly: its catalog has a log or journal with commits the file lacks.',
  'source-schema': 'The library is not the installed release\'s schema version 3, or its tables differ from it.',
  'source-corrupt': 'The library\'s catalog or a media file it names is damaged, missing or not a regular file.',
};

/** A refusal of the source library. Its message is fixed text for its code. */
export class MigrationError extends Error {
  override readonly name = 'MigrationError';
  readonly code: MigrationCode;

  constructor(code: MigrationCode, options?: {cause?: unknown}) {
    super(TEXT[code], options);
    this.code = code;
  }
}

/** The catalog tables the migration carries, each with its columns in table order. */
export const CARRIED = {
  assets: ['id', 'content_hash', 'name', 'source_json', 'created_at'],
  renditions: ['id', 'asset_id', 'manifest_json', 'created_at'],
  playlists: ['id', 'name', 'revision', 'repeat', 'shuffle', 'created_at', 'updated_at'],
  items: ['id', 'playlist_id', 'position', 'rendition_id', 'policy_json'],
} as const;
export type CarriedTable = keyof typeof CARRIED;
export const CARRIED_TABLES = Object.keys(CARRIED) as CarriedTable[];
/** The columns that hold integers; every other carried column holds text. */
export const INTEGER_COLUMNS: ReadonlySet<string> = new Set(['revision', 'repeat', 'shuffle', 'position']);

/**
 * The tables that start fresh (owner decision 10): the player's checkpoint and the sessions that retain renditions for
 * it, and the cleanup journal of deleted assets, whose files are not carried. They stay in the cutover backup.
 */
export const LEFT_IN_BACKUP = ['sessions', 'session_refs', 'playback_checkpoint', 'cleanup_jobs'] as const;

/** One carried row: its columns' values in table order. */
export type Row = readonly (string | number)[];
export type CatalogRows = Record<CarriedTable, readonly Row[]>;

/** What the migration carries, counted from the source. */
export type MigrationCounts = {
  assets: number; renditions: number; playlists: number; items: number;
  /** One original per asset. */
  originals: number;
  /** Each rendition's manifest and its frames, as raw RGB and as PNG. */
  renditionFiles: number;
  /** The bytes of every original and rendition file. */
  bytes: number;
};

/** Rows the migration leaves in the backup: the sessions, the player's checkpoint and pending cleanups. */
export type LeftInBackup = {sessions: number; checkpoints: number; cleanupJobs: number};

/**
 * SHA-256 digests of what the destination holds: `catalog` over the carried rows in table and ID order, `files` over each
 * file's path in the module's folder and its SHA-256, sorted by path. Two migrations of one library give the same digests.
 */
export type MigrationDigest = {catalog: string; files: string};

export type MigrationReport = {
  schema: typeof MIGRATION_SCHEMA; operation: 'migrate'; result: 'migrated';
  counts: MigrationCounts; leftInBackup: LeftInBackup;
  /**
   * GIF originals whose logical screen is over 4,096 x 4,096 pixels. The module plays their stored renditions but refuses
   * to render them again (Hub #843). Counted, never named.
   */
  largeGifOriginals: number;
  digest: MigrationDigest;
};

/**
 * What the verifier found wrong, by kind. `database`: the module's SQLite file is missing, not private, unclean, not the
 * library's current schema or fails SQLite's checks. The four tables: rows missing, extra or different. `leftInBackup`:
 * rows in a table that starts fresh. `files`: a file missing, different from the source, not a private regular file, or
 * a source file that no longer matches its catalog. `unexpected`: anything else in the module's folder, or a directory
 * there that is not private.
 */
export type Mismatches = {
  total: number; database: number; assets: number; renditions: number; playlists: number; items: number;
  leftInBackup: number; files: number; unexpected: number;
};

export type VerificationReport = {
  schema: typeof MIGRATION_SCHEMA; operation: 'verify'; result: 'verified' | 'mismatch';
  counts: MigrationCounts; mismatches: Mismatches; largeGifOriginals: number; digest: MigrationDigest;
};

export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

/** The digest of the carried rows, each table's rows in ID order. */
export function catalogDigest(rows: CatalogRows): string {
  return sha256(JSON.stringify(CARRIED_TABLES.map(table => [table, [...rows[table]].sort(byId)])));
}

/** The digest of the files, as `<path> <sha256>` lines sorted by path. */
export function filesDigest(files: readonly {path: string; sha256: string}[]): string {
  return sha256([...files].sort((a, b) => compare(a.path, b.path)).map(file => `${file.path} ${file.sha256}\n`).join(''));
}

const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
/** Orders rows by their first column, the table's ID. */
export const byId = (a: Row, b: Row): number => compare(String(a[0]), String(b[0]));
