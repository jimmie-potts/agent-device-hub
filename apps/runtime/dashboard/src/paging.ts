// Browser-only paging over records the dashboard already holds (#1658): no request, no polling.

/**
 * Rows per page for each list card, chosen so a full page fits the long Home card height (home-layout.css) at every
 * wide-layout size. Agent status counts rows of tiles; its tiles per page are these rows times the grid's columns.
 */
export const listPageSize = {inbox: 8, timeline: 6, sessionRows: 2} as const;

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
