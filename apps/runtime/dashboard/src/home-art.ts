import type {HomeArrangements, HomePlacement} from '@jimmie-potts/event-contracts/v2/families';

/**
 * The art placement after one explicit change, in one breakpoint's arrangement. Home's hero (#1930) changes it with
 * its Pin or Unpin, Dismiss and Restore chips; the art is never drawn in the grid, so only these flags matter.
 */
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
