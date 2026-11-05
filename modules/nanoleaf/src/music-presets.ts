import {isObject} from './compat.js';
import {freezeMusicRecipe} from './music-recipe-data.js';
import {exactFields, REACTIVE_LIMITS, REACTIVE_SCHEMA, REACTIVE_TARGET, reactiveCatalog, validReactiveId, validReactiveName,
  type ReactiveCatalog, type ReactivePreset, type ReactiveSave} from './music-preset-data.js';
import {execute, first, rows, type Db} from './sqlite.js';

export const REACTIVE_ERRORS = {
  'invalid-request': 'The reactive preset identity, name or recipe is invalid.',
  'revision-conflict': 'The reactive library changed. Refresh it before saving.',
  capacity: 'The private reactive library is full; earlier presets are preserved.',
  'invalid-state': 'The saved reactive library is invalid; its data is preserved.',
} as const;
export class ReactiveFailure extends Error {
  constructor(readonly code: keyof typeof REACTIVE_ERRORS) {super(REACTIVE_ERRORS[code]);}
}
export function initReactivePresets(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS nanoleaf_reactive_presets (id TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS nanoleaf_reactive_catalog (id TEXT PRIMARY KEY, revision INTEGER NOT NULL);`);
}
export function prepareReactiveSave(input: unknown): ReactiveSave {
  if (!isObject(input) || !exactFields(input, ['presetId', 'expectedRevision', 'name', 'recipe'])
      || !validReactiveId(input.presetId) || !validReactiveName(input.name) || typeof input.expectedRevision !== 'number'
      || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new ReactiveFailure('invalid-request');
  try {return Object.freeze({presetId: input.presetId, expectedRevision: input.expectedRevision, name: input.name, recipe: freezeMusicRecipe(input.recipe)});}
  catch {throw new ReactiveFailure('invalid-request');}
}
export function readReactiveCatalog(db: Db): ReactiveCatalog {
  try {
    const row = first(db, 'SELECT revision FROM nanoleaf_reactive_catalog WHERE id=?', REACTIVE_TARGET);
    const saved = rows(db, 'SELECT id,CASE WHEN length(CAST(body AS BLOB))<=? THEN body ELSE NULL END FROM nanoleaf_reactive_presets ORDER BY id LIMIT ?',
      REACTIVE_LIMITS.documentBytes, REACTIVE_LIMITS.presets + 1);
    if (row === undefined && saved.length !== 0) throw new ReactiveFailure('invalid-state');
    const presets = saved.map(([id, body]) => {
      if (typeof body !== 'string') throw new ReactiveFailure('invalid-state');
      const value: unknown = JSON.parse(body);
      if (!isObject(value) || value.presetId !== id) throw new ReactiveFailure('invalid-state');
      return value;
    });
    return reactiveCatalog({id: REACTIVE_TARGET, revision: row?.[0] ?? 0, presets});
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError || error instanceof ReactiveFailure) throw new ReactiveFailure('invalid-state');
    throw error;
  }
}
/** Save, catalog and outcome are owned by the caller's one outbox transaction. */
export function saveReactivePreset(db: Db, input: unknown, revision: number): ReactivePreset {
  if (!db.isTransaction) throw new TypeError('A reactive preset save requires its owner transaction.');
  const next = prepareReactiveSave(input), catalog = readReactiveCatalog(db);
  if (next.expectedRevision !== catalog.revision || catalog.presets.some(preset => preset.presetId === next.presetId)) throw new ReactiveFailure('revision-conflict');
  if (!Number.isSafeInteger(revision) || revision <= catalog.revision) throw new ReactiveFailure('invalid-state');
  if (catalog.presets.length >= REACTIVE_LIMITS.presets) throw new ReactiveFailure('capacity');
  const preset: ReactivePreset = Object.freeze({schema: REACTIVE_SCHEMA, presetId: next.presetId, name: next.name, recipe: next.recipe});
  const encoded = JSON.stringify(preset);
  if (Buffer.byteLength(encoded, 'utf8') > REACTIVE_LIMITS.documentBytes
      || Buffer.byteLength(JSON.stringify({...catalog, revision, presets: [...catalog.presets, preset]}), 'utf8') > REACTIVE_LIMITS.catalogBytes) throw new ReactiveFailure('capacity');
  execute(db, 'INSERT INTO nanoleaf_reactive_presets VALUES (?,?)', preset.presetId, encoded);
  execute(db, 'INSERT INTO nanoleaf_reactive_catalog VALUES (?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision', REACTIVE_TARGET, revision);
  return preset;
}
