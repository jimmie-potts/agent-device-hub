import type {ArtComposition, ArtOutcome, ArtRendition, ArtSelection, ArtTarget, ArtworkSummary} from '@jimmie-potts/event-contracts/v2/art-state';

export const CATALOG_PAGE_SIZE = 6;
export const ART_TARGETS: readonly ArtTarget[] = ['ui', 'tidbyt', 'pixoo'];
export const TARGET_LABELS: Readonly<Record<ArtTarget, string>> = {ui: 'Browser', tidbyt: 'Tidbyt', pixoo: 'Pixoo'};
const outcomes: readonly ArtOutcome[] = ['succeeded', 'partial', 'failed', 'uncertain', 'rejected', 'cancelled'];
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const number = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const member = <T extends string>(value: unknown, values: readonly T[]): value is T => typeof value === 'string' && values.some(item => item === value);
const identity = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(value);
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const nullableIdentity = (value: unknown): value is string | null => value === null || identity(value);
export const paletteOf = (value: unknown): string[] | undefined => Array.isArray(value) && value.length <= 8 && value.every((color: unknown): color is string => typeof color === 'string' && /^#[0-9A-F]{6}$/.test(color)) ? value : undefined;

function renditionOf(value: unknown): ArtRendition | undefined {
  if (!object(value) || !digest(value.renditionId) || !number(value.width, 1, 4096) || !number(value.height, 1, 4096)
    || !number(value.frames, 1, 64) || !number(value.durationMs, 0, 60_000) || !number(value.bytes, 1, 16_777_216)
    || !member(value.format, ['png', 'gif', 'webp'] as const) || value.ref !== `rendition.${value.renditionId}`) return undefined;
  return {renditionId: value.renditionId, width: value.width, height: value.height, frames: value.frames, durationMs: value.durationMs,
    format: value.format, bytes: value.bytes, ref: value.ref};
}
function compositionOf(value: unknown): ArtComposition | undefined {
  if (!object(value) || !member(value.target, ART_TARGETS) || !(value.compositionId === null || digest(value.compositionId))
    || !member(value.outcome, outcomes) || !member(value.motion, ['still', 'gif', 'local'] as const)
    || !Array.isArray(value.renditions) || value.renditions.length > 4) return undefined;
  const renditions = value.renditions.map(renditionOf);
  if (!renditions.every((item): item is ArtRendition => item !== undefined)) return undefined;
  return {target: value.target, compositionId: value.compositionId, outcome: value.outcome, motion: value.motion, renditions};
}
/** A private content response has no envelope. Admit only the bounded fields this frontend consumes. */
export function artworkOf(value: unknown): ArtworkSummary | undefined {
  if (!object(value) || !identity(value.artworkId) || !number(value.createdAtMs, 0, Number.MAX_SAFE_INTEGER) || typeof value.favorite !== 'boolean'
    || !(value.feedback === null || member(value.feedback, ['more', 'less', 'dismiss'] as const)) || !nullableIdentity(value.variationOf)
    || !object(value.provenance) || !member(value.provenance.generatedBy, ['openai', 'local'] as const) || value.provenance.factual !== false
    || !Array.isArray(value.compositions) || value.compositions.length > 3) return undefined;
  const palette = paletteOf(value.palette), compositions = value.compositions.map(compositionOf);
  if (palette === undefined || !compositions.every((item): item is ArtComposition => item !== undefined)
    || new Set(compositions.map(item => item.target)).size !== compositions.length) return undefined;
  return {artworkId: value.artworkId, createdAtMs: value.createdAtMs, favorite: value.favorite, feedback: value.feedback, variationOf: value.variationOf,
    palette, provenance: {generatedBy: value.provenance.generatedBy, factual: false}, compositions};
}
export type CatalogPage = {artworks: ArtworkSummary[]; nextAfter: number | null};
export function catalogOf(value: unknown): CatalogPage {
  if (!object(value) || !Array.isArray(value.artworks) || value.artworks.length > CATALOG_PAGE_SIZE
    || !(value.nextAfter === null || number(value.nextAfter, 1, Number.MAX_SAFE_INTEGER))) throw new Error('invalid-catalog');
  const artworks = value.artworks.map(artworkOf);
  if (!artworks.every((item): item is ArtworkSummary => item !== undefined) || new Set(artworks.map(item => item.artworkId)).size !== artworks.length) throw new Error('invalid-catalog');
  return {artworks, nextAfter: value.nextAfter};
}
export type BrowserArt = {artwork: ArtworkSummary; compositionId: string; rendition: ArtRendition};
export function browserArt(artwork: ArtworkSummary, compact = false): BrowserArt | undefined {
  const composition = artwork.compositions.find(item => item.target === 'ui' && item.outcome === 'succeeded' && item.motion === 'still');
  if (composition === undefined || composition.compositionId === null) return undefined;
  const renditions = composition.renditions.filter(item => item.frames === 1 && item.durationMs === 0 && (item.format === 'png' || item.format === 'webp')).sort((a, b) => a.width - b.width);
  const rendition = compact ? renditions[0] : renditions.at(-1);
  return rendition === undefined ? undefined : {artwork, compositionId: composition.compositionId, rendition};
}
export function latestBrowserArt(artworks: readonly ArtworkSummary[]): ArtworkSummary | undefined {
  return [...artworks].filter(artwork => artwork.feedback !== 'dismiss' && browserArt(artwork) !== undefined).sort((a, b) => b.createdAtMs - a.createdAtMs)[0];
}
/** A selection names one usable browser composition, never a substitute from the collection. */
export function selectedBrowserArtwork(value: unknown, selection: ArtSelection): ArtworkSummary | undefined {
  const artwork = artworkOf(value);
  return artwork?.artworkId === selection.artworkId && browserArt(artwork)?.compositionId === selection.compositionId ? artwork : undefined;
}
export const money = (micros: number): string => new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4}).format(micros / 1_000_000);
export const reasonText: Readonly<Record<string, string>> = {
  'no-key': 'Provider is not configured', unsupported: 'Provider cannot draw this composition', 'unknown-price': 'No verified price is available',
  'monthly-ceiling': 'Monthly allowance reached', 'daily-pace': 'Automatic daily allowance reached', 'loop-guard': 'Automatic call limit reached',
  moderation: 'Provider declined this request', 'provider-refused': 'Provider refused the call', 'invalid-output': 'Provider returned unusable artwork',
  'preview-refused': 'The image route refused this request', 'lost-response': 'Response lost; reserved spend remains uncertain',
  restart: 'Runtime restarted; no request was repeated', cancelled: 'Cancelled; already sent work may remain spent', storage: 'Artwork could not be saved',
};
