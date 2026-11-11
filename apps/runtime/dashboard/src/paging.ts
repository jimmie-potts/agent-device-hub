// Browser-only paging over records the dashboard already holds (#1658): no request, no polling.
import type {HomeShape} from './home-shapes.ts';

/**
 * Rows per page for each list card, fixed so a list never makes its card taller than one page of rows. Agent status
 * counts rows of tiles; its tiles per page are these rows times the grid's current columns.
 */
export const listPageSize = {inbox: 5, timeline: 5, sessionRows: 2} as const;

/**
 * First rows per page in each Home shape (#1672), used until PagedList has measured how many rows the card's space
 * holds; then the measured count applies at every width. Off the unit grid the lists keep listPageSize. Timeline in one
 * row shows the latest entries that fit, with no pager; the rest is on the Timeline page.
 */
export const inboxShapePageSize: Readonly<Partial<Record<HomeShape, number>>> = {wide: 1, tall: 4, 'large-square': 4};
export const timelineShapePageSize: Readonly<Record<HomeShape, number>> = {square: 2, wide: 2, tall: 4, 'large-square': 4};
/** Agent status shows one row of tiles a page in a shape. */
export const sessionShapeRows = 1;

/** How many pages `count` rows fill; an empty list still has one (empty) page. */
export function pageCount(count: number, size: number): number {
  return Math.max(1, Math.ceil(count / Math.max(1, size)));
}

/** The page to show: a page that no longer exists, such as after its last row went away, moves back to the last one. */
export function clampPage(page: number, count: number, size: number): number {
  return Math.min(Math.max(0, page), pageCount(count, size) - 1);
}

/** The page holding the row at `index`. */
export function pageOf(index: number, size: number): number {
  return Math.floor(Math.max(0, index) / Math.max(1, size));
}

/** The keys shown on `page`. */
export function pageKeys<T>(keys: readonly T[], page: number, size: number): T[] {
  const current = clampPage(page, keys.length, size), step = Math.max(1, size);
  return keys.slice(current * step, current * step + step);
}
