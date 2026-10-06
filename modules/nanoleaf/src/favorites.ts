// Saved animation favorites: bounded private recipes, frozen when saved and played by name (integration_api.py).
// The integration API that admitted favorite edits is replaced by runtime commands (#844); its favorite checks live here.
import {encoded, isObject, parseJson} from './compat.js';
import {freeze, MAX_FAVORITES, Rejected, valid, validName, type AnimationCommand, type Recipe, type RecipeInput} from './effects.js';
import {ValueError} from './errors.js';
import {execute, first, rows, text, type Db} from './sqlite.js';

export const FAVORITE_OPERATIONS = ['animation.save', 'animation.rename', 'animation.forget'] as const;

export type FavoriteEdit =
  | {kind: 'animation.save'; name: string; animation: RecipeInput}
  | {kind: 'animation.rename'; name: string; newName: string}
  | {kind: 'animation.forget'; name: string};

export interface Favorite {
  name: string;
  animation: Recipe;
}

/** integration_api.Failure: a refused favorite edit or lookup, by its fixed code. */
export class Failure extends ValueError {
  override name = 'Failure';
  constructor(readonly code: 'capacity' | 'revision-conflict' | 'unsupported-capability') {
    super(code);
  }
}

const sameKeys = (value: object, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const EDIT_FIELDS: Readonly<Record<FavoriteEdit['kind'], readonly string[]>> = {'animation.save': ['kind', 'name', 'animation'],
  'animation.rename': ['kind', 'name', 'newName'], 'animation.forget': ['kind', 'name']};
const isEditKind = (value: unknown): value is FavoriteEdit['kind'] => FAVORITE_OPERATIONS.some(kind => kind === value);

/** Keep table creation inside the caller's initialization transaction. */
export function initFavorites(db: Db): void {
  db.exec('CREATE TABLE IF NOT EXISTS animation_favorites (name TEXT PRIMARY KEY, recipe TEXT NOT NULL)');
}

/** Bounded private recipes in name order; more than MAX_FAVORITES is a capacity failure. */
export function favorites(db: Db): Favorite[] {
  const entries = rows(db, 'SELECT name,recipe FROM animation_favorites ORDER BY name LIMIT ?', MAX_FAVORITES + 1);
  if (entries.length > MAX_FAVORITES) throw new Failure('capacity');
  return entries.map(row => ({name: text(row, 0), animation: parseJson(text(row, 1)) as Recipe}));
}

/** A command that names a favorite, replaced by its saved recipe; any other command unchanged. */
export function resolveAnimation(db: Db, command: AnimationCommand): Exclude<AnimationCommand, {favorite: string}> {
  if (!('favorite' in command)) return command;
  const row = first(db, 'SELECT recipe FROM animation_favorites WHERE name=?', command.favorite);
  if (row === undefined) throw new Rejected('unsupported-capability');
  const recipe = parseJson(text(row, 0));
  if (!isObject(recipe) || Object.hasOwn(recipe, 'kind')) throw new Rejected('unsupported-capability');
  const explicit = {kind: 'animation.play', ...recipe};
  if (!valid(explicit) || 'favorite' in explicit || 'preset' in explicit) throw new Rejected('unsupported-capability');
  return explicit;
}

/** Check a favorite edit now; with `apply`, check again and commit it inside the caller's transaction. */
export function favoriteEdit(db: Db, command: FavoriteEdit, apply = false): void {
  const exists = (name: string): boolean => first(db, 'SELECT 1 FROM animation_favorites WHERE name=?', name) !== undefined;
  switch (command.kind) {
    case 'animation.save': {
      if (exists(command.name)) throw new Failure('revision-conflict');
      const [count] = first(db, 'SELECT COUNT(*) FROM animation_favorites') ?? [0];
      if (typeof count !== 'number' || count >= MAX_FAVORITES) throw new Failure('capacity');
      if (apply) execute(db, 'INSERT INTO animation_favorites VALUES (?,?)', command.name, encoded(freeze(command.animation)));
      break;
    }
    case 'animation.rename':
      if (!exists(command.name)) throw new Failure('unsupported-capability');
      if (exists(command.newName)) throw new Failure('revision-conflict');
      if (apply) execute(db, 'UPDATE animation_favorites SET name=? WHERE name=?', command.newName, command.name);
      break;
    case 'animation.forget':
      if (!exists(command.name)) throw new Failure('unsupported-capability');
      if (apply) execute(db, 'DELETE FROM animation_favorites WHERE name=?', command.name);
      break;
  }
  // Python also bumped the controller ledger's revision here; the ledger is not ported. These recipes do not change the
  // current display or authorize another transport attempt, so the display is not woken.
}

/** The shape checks the integration API made on a favorite edit before admitting it. */
export function validFavoriteEdit(command: unknown): command is FavoriteEdit {
  if (!isObject(command) || !isEditKind(command.kind)) return false;
  const kind = command.kind;
  if (!sameKeys(command, EDIT_FIELDS[kind]) || !validName(command.name)) return false;
  if (kind === 'animation.rename' && !validName(command.newName)) return false;
  if (kind !== 'animation.save') return true;
  const recipe = command.animation;
  return isObject(recipe) && !Object.hasOwn(recipe, 'kind') && !Object.hasOwn(recipe, 'favorite') && valid({kind: 'animation.play', ...recipe});
}
