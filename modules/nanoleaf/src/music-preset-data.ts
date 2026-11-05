import {freezeMusicRecipe, type MusicRecipeV1} from './music-recipe-data.js';

export const REACTIVE_TARGET = 'reactive-presets';
export const REACTIVE_SCHEMA = 'nanoleaf-reactive-preset/2.0';
export const REACTIVE_ID_PATTERN = '^preset-[a-z0-9]+(?:-[a-z0-9]+)*$';
export const REACTIVE_LIMITS = Object.freeze({presets: 32, documentBytes: 2048, catalogBytes: 128 * 1024, name: 80, id: 64});
export type ReactivePreset = Readonly<{schema: typeof REACTIVE_SCHEMA; presetId: string; name: string; recipe: MusicRecipeV1}>;
export type ReactiveCatalog = Readonly<{id: typeof REACTIVE_TARGET; revision: number; presets: readonly ReactivePreset[]}>;
export type ReactiveSave = Readonly<{presetId: string; expectedRevision: number; name: string; recipe: MusicRecipeV1}>;
export const validReactiveId = (value: unknown): value is string => typeof value === 'string' && value.length <= REACTIVE_LIMITS.id && new RegExp(REACTIVE_ID_PATTERN).test(value);
export const validReactiveName = (value: unknown): value is string => typeof value === 'string' && [...value].length >= 1
  && [...value].length <= REACTIVE_LIMITS.name && value.trim() !== '' && !/\p{C}/u.test(value);
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
export const exactFields = (value: object, names: readonly string[]): boolean => Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const size = (value: object): number => new TextEncoder().encode(JSON.stringify(value)).byteLength;

/** Stored and received recipes must already contain every frozen V1 value. */
export function explicitMusicRecipe(value: unknown): MusicRecipeV1 {
  const recipe = freezeMusicRecipe(value);
  if (!object(value) || !exactFields(value, Object.keys(recipe))
      || Object.entries(recipe).some(([key, expected]) => key === 'palette'
        ? !Array.isArray(value.palette) || value.palette.length !== recipe.palette.length || value.palette.some((color, index) => color !== recipe.palette[index])
        : value[key] !== expected)) throw new TypeError('Invalid frozen music recipe.');
  return recipe;
}

/** Unknown catalog data is checked once at its browser/storage boundary. */
export function reactivePreset(value: unknown): ReactivePreset {
  if (!object(value) || !exactFields(value, ['schema', 'presetId', 'name', 'recipe']) || value.schema !== REACTIVE_SCHEMA
      || !validReactiveId(value.presetId) || !validReactiveName(value.name) || size(value) > REACTIVE_LIMITS.documentBytes) throw new TypeError('Invalid reactive preset.');
  return Object.freeze({schema: REACTIVE_SCHEMA, presetId: value.presetId, name: value.name, recipe: explicitMusicRecipe(value.recipe)});
}
export function reactiveCatalog(value: unknown): ReactiveCatalog {
  if (!object(value) || !exactFields(value, ['id', 'revision', 'presets']) || value.id !== REACTIVE_TARGET
      || typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 0
      || !Array.isArray(value.presets) || value.presets.length > REACTIVE_LIMITS.presets || size(value) > REACTIVE_LIMITS.catalogBytes) throw new TypeError('Invalid reactive catalog.');
  const presets = value.presets.map(reactivePreset);
  if (new Set(presets.map(preset => preset.presetId)).size !== presets.length) throw new TypeError('Duplicate reactive preset.');
  return Object.freeze({id: REACTIVE_TARGET, revision: value.revision, presets: Object.freeze(presets)});
}
