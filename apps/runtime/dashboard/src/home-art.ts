import type {HomeArrangements, HomeArtFormat, HomePlacement} from '@jimmie-potts/event-contracts/v2/families';

export type ArtFit = {format: Exclude<HomeArtFormat, 'auto'>; width: number; height: number};
// Reserve the wrapped phone toolbar, card heading, padding and provenance before allocating image space.
export const ART_CHROME_HEIGHT = 224;
/** Art owns only this trailing rectangle. No functional-card coordinates are changed. */
export function fitArt(width: number, height: number, format: HomeArtFormat = 'auto'): ArtFit | undefined {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 240 || height < ART_CHROME_HEIGHT + 80) return undefined;
  const chosen = format === 'auto' ? width >= 600 ? 'banner' : height >= width * 4 / 3 + ART_CHROME_HEIGHT ? 'tall' : 'square' : format;
  const ratio = {banner: 3, square: 1, tall: 0.75}[chosen];
  const limit = {banner: 960, square: 480, tall: 360}[chosen];
  const fittedWidth = Math.floor(Math.min(width, limit, (height - ART_CHROME_HEIGHT) * ratio));
  if (fittedWidth < 240) return undefined;
  return {format: chosen, width: fittedWidth, height: Math.ceil(fittedWidth / ratio) + ART_CHROME_HEIGHT};
}

/** Explicit changes affect one breakpoint; automatic fit is never passed to the owner. */
export function changeArtPlacement(layouts: HomeArrangements, breakpoint: keyof HomeArrangements, change: Partial<Pick<HomePlacement, 'hidden' | 'art'>>): HomeArrangements {
  const next = structuredClone(layouts), list = next[breakpoint];
  let entry = list.find(value => value.widget === 'art');
  if (entry === undefined) {
    if (list.length >= 128) return next;
    entry = {widget: 'art', size: 'medium', hidden: false, art: {format: 'auto', pinned: true}};
    list.push(entry);
  }
  Object.assign(entry, change);
  return next;
}
