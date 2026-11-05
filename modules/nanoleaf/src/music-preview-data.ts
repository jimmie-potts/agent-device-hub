import type {MusicRecipeV1} from './music-recipe-data.js';

export const MUSIC_PREVIEW_SCHEMA = 'nanoleaf-music-preview/2.0';
export const MUSIC_PREVIEW_STIMULUS = 'fixed-bands-v1';
export const MUSIC_PREVIEW_LIMITS = Object.freeze({requestBytes: 2048, responseBytes: 16384, samples: 20, zones: 12});
export const MUSIC_PREVIEW_MODELS = [
  {id: 'lines-demo-v1', label: 'Example Lines', kind: 'lines', zones: 12},
  {id: 'nl22-demo-v1', label: 'Example NL22 Panels', kind: 'panels', zones: 6},
] as const;
export type MusicPreviewModel = (typeof MUSIC_PREVIEW_MODELS)[number]['id'];
export type MusicPreviewEffect = MusicRecipeV1['effect'];

const palette = Object.freeze(['#00b4d8', '#8b5cf6', '#ff8c42']);
const base = {rendererVersion: 1, palette, intensity: 0.65, sensitivity: 1, smoothingMs: 100} as const;
const builtin = (label: string, recipe: MusicRecipeV1) => Object.freeze({id: recipe.effect, label, recipe: Object.freeze(recipe)});
export const MUSIC_PREVIEW_PRESETS = Object.freeze([
  builtin('Level glow', {...base, effect: 'level-glow'}),
  builtin('Bass pulse', {...base, effect: 'bass-pulse', halfLifeMs: 200}),
  builtin('Three-band spectrum', {...base, effect: 'spectrum', direction: 'right'}),
  builtin('Traveling wave', {...base, effect: 'traveling-wave', direction: 'right', periodMs: 2000}),
  builtin('Ambient colors', {...base, effect: 'ambient', smoothingMs: 1500}),
]);

export type MusicPreviewRequest = Readonly<{version: 1; preset: MusicPreviewEffect; palette: readonly string[];
  intensity: number; model: MusicPreviewModel}>;
export type MusicRecipePreviewRequest = Readonly<{version: 1; recipe: MusicRecipeV1; model: MusicPreviewModel}>;
export type MusicPreviewInput = MusicPreviewRequest | MusicRecipePreviewRequest;
export type MusicPreviewZone = Readonly<{id: number; rgb: readonly [number, number, number]}>;
export type MusicPreviewSample = Readonly<{offsetMs: number; rms: number;
  bands: Readonly<{bass: number; mid: number; treble: number}>; zones: readonly MusicPreviewZone[]}>;
export type MusicPreview = Readonly<{schema: typeof MUSIC_PREVIEW_SCHEMA; recipe: MusicRecipeV1;
  model: MusicPreviewModel; stimulus: typeof MUSIC_PREVIEW_STIMULUS; samples: readonly MusicPreviewSample[]}>;

export function musicPreviewDefault(): MusicPreviewRequest {
  return {version: 1, preset: 'level-glow', palette: [...palette], intensity: base.intensity, model: 'lines-demo-v1'};
}
