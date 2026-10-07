// What the Nanoleaf migration (Hub #933) carries, reports and refuses. Every report carries counts, codes and SHA-256
// digests only: never a path, an address, a token, a project, favorite or scene name, or a file's content (ADR 0011, ADR
// 0012 "Safe errors").
import {createHash} from 'node:crypto';

/** The schema of every line the migration writes. */
export const MIGRATION_SCHEMA = 'nanoleaf-migration/1.0';

/**
 * The state the migration reads: the private state directory of codex-nanoleaf's Linux bridge, as its installed release
 * keeps it. The installed bridge's schema-defining files are those of codex-nanoleaf `revision`, the commit the port came
 * from (PORTING.md), whose `status.sqlite` is at model version 4 with each device's key. The migration also reads the
 * pre-change Linux database at model version 4 without device keys (the `linux-state-v4` fixture), whose rows all belong
 * to the Lines, `wall`.
 */
export const INSTALLED_STATE = {revision: 'c711e1812d6871952562e9070e20bdebe120db3a', modelVersion: '4'} as const;

/** Why the migration refused a source state directory. */
export type MigrationCode =
  | 'source-missing' | 'source-in-use' | 'source-not-clean' | 'source-schema' | 'source-corrupt' | 'source-config' | 'source-device-id'
  | 'source-not-configured';

const TEXT: Readonly<Record<MigrationCode, string>> = {
  'source-missing': 'The source directory holds no status.sqlite or no config.json.',
  'source-in-use': 'A Nanoleaf bridge process holds the source state: stop the bridge, its workers and the wall server first.',
  'source-not-clean': 'The source status.sqlite was not closed cleanly: it has a journal to roll back.',
  'source-schema': 'The source status.sqlite is not the installed bridge\'s model version 4, or a table the migration reads lacks a column.',
  'source-corrupt': 'The source status.sqlite fails SQLite\'s check, or config.json, layout.json or a scene file is damaged, too large or not a regular file.',
  'source-config': 'The source registry is malformed, or a registered device lacks a private IPv4 address or a token, or the module would refuse the converted section.',
  'source-device-id': 'A registered device ID is not a routing ID (lowercase letters and digits with single hyphens), which the runtime requires.',
  'source-not-configured': 'The source never configured shared input, so it names no qualified agent source for the module\'s section.',
};

/** A refusal of the source state. Its message is fixed text for its code. */
export class MigrationError extends Error {
  override readonly name = 'MigrationError';
  readonly code: MigrationCode;

  constructor(code: MigrationCode, options?: {cause?: unknown}) {
    super(TEXT[code], options);
    this.code = code;
  }
}

/**
 * The tables the migration carries, each with its columns in table order and the name its counts and mismatches use.
 * `device` tables carry the rows of registered devices only; a pre-change table without the column gives every row to
 * the Lines. `optional` tables may be missing from a pre-change database, which then carries none of their rows.
 */
export const CARRIED = {
  projects: {name: 'projects', columns: ['id', 'name', 'color', 'roots'], device: false, optional: false},
  palette: {name: 'palette', columns: ['role', 'color'], device: false, optional: true},
  line_prefs: {name: 'elements', columns: ['line_id', 'project', 'signature', 'device'], device: true, optional: false},
  map_settings: {name: 'mapSettings', columns: ['id', 'style', 'coverage', 'rotation', 'flip_x', 'flip_y', 'device'], device: true, optional: false},
  map_pending: {name: 'pendingEdits', columns: ['id', 'payload', 'device'], device: true, optional: true},
  animation_favorites: {name: 'favorites', columns: ['name', 'recipe'], device: false, optional: true},
} as const;
export type CarriedTable = keyof typeof CARRIED;
export const CARRIED_TABLES = Object.keys(CARRIED) as CarriedTable[];
export type CarriedName = typeof CARRIED[CarriedTable]['name'] | 'deviceState';

/**
 * The `meta` values carried for each registered device, under the device's key (`mode@panels`): its desired state, which
 * its `device` record publishes (Work, Quiet or Free, and any native power or brightness override), and how far its
 * worker has applied the mode. Every other `meta` value is a task or effect epoch, a display cache, a receipt, a hold or a
 * failure, which start fresh.
 */
export const CARRIED_META = ['mode', 'mode_revision', 'mode_applied', 'controller_power', 'controller_brightness'] as const;

/** The `meta` value the module's schema itself writes, which the destination holds beside the carried ones. */
export const SCHEMA_META = {key: 'model_version', value: '4'} as const;

/**
 * The fresh `shared_input` row the destination keeps: shared input not selected (`'legacy'`, which the module reads as not
 * selected), with no configuration, envelope or legacy task backup. The module configures shared input from its section
 * at each start and selects it at its first sync.
 */
export const FRESH_SHARED_INPUT = [1, 'legacy', 0, null, null, null, 'unavailable', null, null] as const;

/** One carried value with its SQLite storage class, so a comparison sees `5`, `5.0` and `'5'` as different. */
export type TypedValue = readonly [type: 'null' | 'integer' | 'real' | 'text' | 'blob', value: string | number | null];
export type TypedRow = readonly TypedValue[];
/** Each carried table's rows, and the carried `meta` rows as `deviceState`, each in a stable order. */
export type CarriedRows = Record<CarriedTable | 'meta', readonly TypedRow[]>;

/** What the migration carries, counted from the source. */
export type MigrationCounts = {
  /** Registered devices, each with its address and token in the module's section. */
  devices: number;
  projects: number; palette: number; elements: number; mapSettings: number; pendingEdits: number; favorites: number;
  /** Carried `meta` values: each device's mode, its revisions and its native overrides. */
  deviceState: number;
  /** Layout entries carried into `layout.json`, one per registered device that had one. */
  layouts: number;
  /** Scene files carried, one per registered device that had one. */
  scenes: number;
};

/**
 * What stays only in the backup, counted (owner decision 10 and the #26 decision): tasks and what follows them, display
 * caches, the controller ledger and the integration API's requests, the legacy task backup, the shared-input
 * configuration's `bindings`, the `meta` values that start fresh, and the rows, `meta` values, layout entries and scene
 * files of devices the registry no longer names.
 */
export type LeftInBackup = {
  sessions: number;
  /** Task rows that follow live sessions: task details, activity, waits, receipts and the shared-input task tables. */
  taskRows: number;
  reservations: number; comets: number; locates: number; displayCaches: number;
  controllerLedger: number; integrationRequests: number;
  legacyBackup: number; bindings: number;
  otherMeta: number;
  unregistered: number;
};

/**
 * SHA-256 digests of what the destination holds: `store` over the carried rows in table order, `files` over each file's
 * name in the module's folder and its SHA-256, sorted by name. Two migrations of one source give the same digests.
 */
export type MigrationDigest = {store: string; files: string};

export type MigrationReport = {
  schema: typeof MIGRATION_SCHEMA; operation: 'migrate'; result: 'migrated';
  counts: MigrationCounts; leftInBackup: LeftInBackup; digest: MigrationDigest;
};

/**
 * What the verifier found wrong in the store and the folder, by kind. `database`: the module's SQLite file is missing,
 * not private, unclean, not the module's schema or fails SQLite's checks. Each carried table, and `deviceState` for the
 * carried `meta` values: rows missing, extra or different. `startFresh`: a row in a table that starts fresh, a `meta`
 * value that is neither carried nor the schema's, or a `shared_input` row other than the fresh one. `layout` and
 * `scenes`: a file missing, different from the source, or not a private regular file. `unexpected`: anything else in
 * the module's folder, or a folder that is not private.
 */
export type StoreMismatches = {
  database: number; projects: number; palette: number; elements: number; mapSettings: number; pendingEdits: number; favorites: number;
  deviceState: number; startFresh: number; layout: number; scenes: number; unexpected: number;
};

export type StoreVerification = {counts: MigrationCounts; mismatches: StoreMismatches; digest: MigrationDigest};

export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
/** Orders rows by their JSON text, a stable order that needs no key. */
export const byText = (a: TypedRow, b: TypedRow): number => compare(JSON.stringify(a), JSON.stringify(b));

/** The digest of the carried rows, each table's rows in text order. */
export function storeDigest(rows: CarriedRows): string {
  return sha256(JSON.stringify([...CARRIED_TABLES, 'meta' as const].map(table => [table, [...rows[table]].sort(byText)])));
}

/** The digest of the files, as `<name> <sha256>` lines sorted by name. */
export function filesDigest(files: readonly {name: string; sha256: string}[]): string {
  return sha256([...files].sort((a, b) => compare(a.name, b.name)).map(file => `${file.name} ${file.sha256}\n`).join(''));
}
