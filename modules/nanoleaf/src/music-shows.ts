import {isObject} from './compat.js';
import {validName} from './effects.js';
import {prepareMusicTimeline} from './music-timeline.js';
import {SHOW_LIMITS, SHOW_TARGET, SHOW_VERSION_SCHEMA, showMeasurement, validShowId, type ShowCatalog, type ShowSave, type ShowSummary, type ShowVersion} from './music-show-data.js';
import {execute, first, number, rows, text, type Db} from './sqlite.js';

export const SHOW_ERRORS = {
  'invalid-request': 'The show identity, names or cue plan is invalid.',
  'revision-conflict': 'The show changed. Read its latest version before saving.',
  capacity: 'The private show library is full; earlier versions are preserved.',
  'not-found': 'The selected show version does not exist.',
  'invalid-state': 'The saved show library is invalid; its data is preserved.',
} as const;
export class ShowFailure extends Error {
  constructor(readonly code: keyof typeof SHOW_ERRORS) {super(SHOW_ERRORS[code]);}
}
const fields = (value: object, names: readonly string[]): boolean =>
  Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const versionNumber = (value: unknown, minimum = 1): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= SHOW_LIMITS.versions;

/** Additive tables only; the caller's initialization transaction owns all schema changes. */
export function initShows(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS nanoleaf_shows (id TEXT PRIMARY KEY, version INTEGER NOT NULL, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS nanoleaf_show_versions (show_id TEXT NOT NULL, version INTEGER NOT NULL, version_name TEXT NOT NULL,
      body TEXT NOT NULL, PRIMARY KEY (show_id, version));
    CREATE TABLE IF NOT EXISTS nanoleaf_show_catalog (id TEXT PRIMARY KEY, revision INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS nanoleaf_measured_shows (show_id TEXT NOT NULL, version INTEGER NOT NULL,
      PRIMARY KEY (show_id, version));
    CREATE TABLE IF NOT EXISTS nanoleaf_show_save_receipts (show_id TEXT NOT NULL, version INTEGER NOT NULL,
      request_id TEXT NOT NULL, PRIMARY KEY (show_id, version));`);
}

/** Parse once at the owner boundary; presets are resolved into frozen explicit recipes. */
export function prepareShowSave(input: unknown): ShowSave {
  if (!isObject(input) || !fields(input, ['showId', 'expectedVersion', 'name', 'versionName', 'timeline', ...(Object.hasOwn(input, 'measurement') ? ['measurement'] : [])])
      || !validShowId(input.showId) || !versionNumber(input.expectedVersion, 0) || !validName(input.name) || !validName(input.versionName)) {
    throw new ShowFailure('invalid-request');
  }
  const measurement = showMeasurement(input.measurement);
  if (Object.hasOwn(input, 'measurement') && measurement === undefined) throw new ShowFailure('invalid-request');
  try {
    return Object.freeze({showId: input.showId, expectedVersion: input.expectedVersion, name: input.name, versionName: input.versionName,
      timeline: prepareMusicTimeline(input.timeline), ...(measurement === undefined ? {} : {measurement})});
  } catch {throw new ShowFailure('invalid-request');}
}

/** Metadata only. Never reads the plan bodies, a device or a layout. */
export function showCatalog(db: Db): ShowCatalog {
  const row = first(db, 'SELECT revision FROM nanoleaf_show_catalog WHERE id=?', SHOW_TARGET);
  const revision = row?.[0] ?? 0;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) throw new ShowFailure('invalid-state');
  const heads = rows(db, 'SELECT id,version,name FROM nanoleaf_shows ORDER BY id LIMIT ?', SHOW_LIMITS.shows + 1);
  const versions = rows(db, 'SELECT v.show_id,v.version,v.version_name,m.version,s.request_id FROM nanoleaf_show_versions v LEFT JOIN nanoleaf_measured_shows m '
    + 'ON v.show_id=m.show_id AND v.version=m.version LEFT JOIN nanoleaf_show_save_receipts s ON v.show_id=s.show_id AND v.version=s.version '
    + 'ORDER BY v.show_id,v.version LIMIT ?', SHOW_LIMITS.versions + 1);
  if (row === undefined && (heads.length !== 0 || versions.length !== 0)) throw new ShowFailure('invalid-state');
  if (heads.length > SHOW_LIMITS.shows || versions.length > SHOW_LIMITS.versions) throw new ShowFailure('invalid-state');
  const shows: ShowSummary[] = [];
  let counted = 0;
  for (const head of heads) {
    const [id, version, name] = head;
    if (!validShowId(id) || !versionNumber(version) || !validName(name)) throw new ShowFailure('invalid-state');
    const saved = versions.filter(row => row[0] === id).map(row => {
      const count = row[1], label = row[2], measured = row[3] !== null, receipt = row[4];
      if (!versionNumber(count) || !validName(label) || (receipt !== null && typeof receipt !== 'string')) throw new ShowFailure('invalid-state');
      return {version: count, versionName: label, ...(measured ? {kind: 'measured' as const} : {}),
        ...(typeof receipt === 'string' ? {savedByRequest: receipt} : {})};
    });
    if (saved.length !== version || saved.some((item, index) => item.version !== index + 1)) throw new ShowFailure('invalid-state');
    counted += saved.length;
    shows.push({id, name, version, versions: saved});
  }
  if (counted !== versions.length) throw new ShowFailure('invalid-state');
  return {id: SHOW_TARGET, revision, shows};
}

/** All writes belong to the caller's outbox transaction, including the catalog and outcome it appends. */
export function saveShow(db: Db, input: unknown, revision: number, requestId?: string): ShowVersion {
  if (!db.isTransaction) throw new TypeError('A show save requires its owner transaction.');
  const next = prepareShowSave(input), catalog = showCatalog(db);
  const head = catalog.shows.find(show => show.id === next.showId);
  if ((head?.version ?? 0) !== next.expectedVersion) throw new ShowFailure('revision-conflict');
  if (!Number.isSafeInteger(revision) || revision <= catalog.revision) throw new ShowFailure('invalid-state');
  if (head === undefined && catalog.shows.length >= SHOW_LIMITS.shows
      || catalog.shows.reduce((total, show) => total + show.versions.length, 0) >= SHOW_LIMITS.versions) throw new ShowFailure('capacity');
  const version: ShowVersion = Object.freeze({schema: SHOW_VERSION_SCHEMA, showId: next.showId, version: next.expectedVersion + 1,
    name: next.name, versionName: next.versionName, timeline: next.timeline,
    ...(next.measurement === undefined ? {kind: 'decorative' as const} : {kind: 'measured' as const, measurement: next.measurement})});
  const encoded = JSON.stringify(version);
  if (Buffer.byteLength(encoded, 'utf8') > SHOW_LIMITS.versionBytes) throw new ShowFailure('capacity');
  execute(db, 'INSERT INTO nanoleaf_show_versions VALUES (?,?,?,?)', version.showId, version.version, version.versionName, encoded);
  if (requestId !== undefined) execute(db, 'INSERT INTO nanoleaf_show_save_receipts VALUES (?,?,?)', version.showId, version.version, requestId);
  if (version.kind === 'measured') execute(db, 'INSERT INTO nanoleaf_measured_shows VALUES (?,?)', version.showId, version.version);
  execute(db, 'INSERT INTO nanoleaf_shows VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,name=excluded.name',
    version.showId, version.version, version.name);
  execute(db, 'INSERT INTO nanoleaf_show_catalog VALUES (?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision', SHOW_TARGET, revision);
  return version;
}

/** A single exact saved version. Invalid stored bytes are retained and never silently repaired. */
export function readShowVersion(db: Db, id: string, version: number): ShowVersion {
  if (!validShowId(id) || !versionNumber(version)) throw new ShowFailure('invalid-request');
  const row = first(db, 'SELECT CASE WHEN length(CAST(v.body AS BLOB))<=? THEN v.body ELSE NULL END,v.version_name,length(CAST(v.body AS BLOB)),m.version '
    + 'FROM nanoleaf_show_versions v LEFT JOIN nanoleaf_measured_shows m ON v.show_id=m.show_id AND v.version=m.version WHERE v.show_id=? AND v.version=?', SHOW_LIMITS.versionBytes, id, version);
  if (row === undefined) throw new ShowFailure('not-found');
  try {
    if (number(row, 2) > SHOW_LIMITS.versionBytes) throw new ShowFailure('invalid-state');
    const input: unknown = JSON.parse(text(row, 0));
    if (!isObject(input) || !fields(input, ['schema', 'showId', 'version', 'name', 'versionName', 'kind', 'timeline', ...(input.kind === 'measured' ? ['measurement'] : [])])
        || input.schema !== SHOW_VERSION_SCHEMA || input.showId !== id || input.version !== version || input.kind !== 'decorative' && input.kind !== 'measured'
        || input.versionName !== text(row, 1) || input.kind !== (row[3] === null ? 'decorative' : 'measured')) throw new ShowFailure('invalid-state');
    const prepared = prepareShowSave({showId: input.showId, expectedVersion: version - 1, name: input.name, versionName: input.versionName, timeline: input.timeline,
      ...(input.kind === 'measured' ? {measurement: input.measurement} : {})});
    if (JSON.stringify(prepared.timeline) !== JSON.stringify(input.timeline)) throw new ShowFailure('invalid-state');
    return Object.freeze({schema: SHOW_VERSION_SCHEMA, showId: id, version, name: prepared.name, versionName: prepared.versionName,
      timeline: prepared.timeline,
      ...(prepared.measurement === undefined ? {kind: 'decorative' as const} : {kind: 'measured' as const, measurement: prepared.measurement})});
  } catch {throw new ShowFailure('invalid-state');}
}
