// Browser-only paging over records the dashboard already holds (#1658): no request, no polling.
import type {HomeShape} from './home-shapes.ts';

/**
 * Rows per page for each list card, fixed so a list never makes its card taller than one page of rows. Agent status
 * counts rows of tiles; its tiles per page are these rows times the grid's current columns.
 */
export const listPageSize = {inbox: 5, timeline: 5, sessionRows: 2} as const;

/**
 * Inbox rows per page in each Home shape (#1672), so a page and its pager fit the shape at the smallest unit. Stage A
 * prototype values for a 220px unit; Stage B derives them from the unit the owner chooses. Off the unit grid, and for
 * a shape the Inbox does not offer, the list keeps listPageSize.
 */
export const inboxShapePageSize: Readonly<Partial<Record<HomeShape, number>>> = {wide: 1, tall: 4, 'large-square': 4};

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
