// Saved animation favorites: bounded private recipes, frozen when saved and played by name (integration_api.py).
// The integration API that admitted favorite edits is replaced by runtime commands (#844); its favorite checks live here.
import type {AnimationCommand, Recipe, RecipeInput} from './effects.js';
import {ValueError} from './errors.js';
import type {Db} from './sqlite.js';

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

const notPorted = (): never => {
  throw new Error('Not ported yet (Hub #26, slice 2b).');
};

/** Keep table creation inside the caller's initialization transaction. */
export function initFavorites(db: Db): void {
  db.exec('CREATE TABLE IF NOT EXISTS animation_favorites (name TEXT PRIMARY KEY, recipe TEXT NOT NULL)');
}

/** Bounded private recipes in name order; more than MAX_FAVORITES is a capacity failure. */
export function favorites(_db: Db): Favorite[] {
  return notPorted();
}

/** A command that names a favorite, replaced by its saved recipe; any other command unchanged. */
export function resolveAnimation(_db: Db, _command: AnimationCommand): Exclude<AnimationCommand, {favorite: string}> {
  return notPorted();
}

/** Check a favorite edit now; with `apply`, check again and commit it inside the caller's transaction. */
export function favoriteEdit(_db: Db, _command: FavoriteEdit, _apply = false): void {
  notPorted();
}

/** The shape checks the integration API made on a favorite edit before admitting it. */
export function validFavoriteEdit(_command: unknown): _command is FavoriteEdit {
  return notPorted();
}
