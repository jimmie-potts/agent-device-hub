// Home card shapes on one unit grid (#1672). Pure functions of saved order, shapes and the grid's width; the browser
// places each card on a CSS grid with these coordinates. They read and write nothing else.
import type {HomeArtFormat, HomePlacement, HomeShape, HomeSize} from '@jimmie-potts/event-contracts/v2/families';
export type {HomeShape} from '@jimmie-potts/event-contracts/v2/families';

/** The owner's unit (D1, 2026-11-11): columns are at least this wide, and each row is one column tall. */
export const HOME_UNIT = 220;
export const HOME_GAP = 16;

/** The four shapes, in unit squares: 1×1, 2 wide × 1 tall, 1 wide × 2 tall and 2×2. */
export const homeShapes: readonly HomeShape[] = ['square', 'wide', 'tall', 'large-square'];
export const shapeSpan: Readonly<Record<HomeShape, {columns: 1 | 2; rows: 1 | 2}>> = {
  square: {columns: 1, rows: 1}, wide: {columns: 2, rows: 1}, tall: {columns: 1, rows: 2}, 'large-square': {columns: 2, rows: 2},
};
export const shapeName: Readonly<Record<HomeShape, string>> = {square: 'Small square', wide: 'Wide', tall: 'Tall', 'large-square': 'Large square'};
/**
 * The width stored beside a shape, so a dashboard that knows only widths shows a close one. It equals the contracts'
 * `homeShapeSize`, which the core uses to keep a shape only while its width agrees; a unit test checks they match.
 */
export const shapeStoredSize: Readonly<Record<HomeShape, HomeSize>> = {square: 'small', tall: 'small', wide: 'medium', 'large-square': 'medium'};

/** The pixel box of a shape at a cell size, gaps included. */
export function shapeBox(shape: HomeShape, cell = HOME_UNIT, gap = HOME_GAP): {width: number; height: number} {
  const span = shapeSpan[shape];
  return {width: span.columns * cell + (span.columns - 1) * gap, height: span.rows * cell + (span.rows - 1) * gap};
}

/**
 * The shape a placement shows: its saved shape when the card offers it, otherwise the conversion of its saved width
 * (Small prefers one column, Standard the card's Standard shape, Wide two columns and two rows), and for art its saved
 * format (banner Wide, tall Tall, square and auto Large square).
 */
export function placementShape(entry: Pick<HomePlacement, 'size' | 'shape' | 'art'>, offered: readonly HomeShape[], standard: HomeShape): HomeShape {
  if (entry.shape !== undefined && offered.includes(entry.shape)) return entry.shape;
  if (entry.art !== undefined) return pick(artShape(entry.art.format), offered, standard);
  return shapeForSize(entry.size, offered, standard);
}
export function shapeForSize(size: HomeSize, offered: readonly HomeShape[], standard: HomeShape): HomeShape {
  const wanted: readonly HomeShape[] = size === 'small' ? ['square', 'tall', 'wide', 'large-square']
    : size === 'large' ? ['large-square', 'wide', 'tall', 'square'] : [standard, 'tall', 'wide', 'large-square', 'square'];
  return wanted.find(shape => offered.includes(shape)) ?? offered[0] ?? 'square';
}
/** The shape an art format shows on the grid: banner Wide, tall Tall, square and auto Large square. */
export const artShape = (format: HomeArtFormat): HomeShape => format === 'banner' ? 'wide' : format === 'tall' ? 'tall' : 'large-square';
const pick = (shape: HomeShape, offered: readonly HomeShape[], standard: HomeShape): HomeShape => offered.includes(shape) ? shape : offered.includes(standard) ? standard : offered[0] ?? 'square';
/** The art format an older dashboard shows for an art card in a shape. */
export const shapeArtFormat: Readonly<Record<HomeShape, Exclude<HomeArtFormat, 'auto'>>> = {square: 'square', wide: 'banner', tall: 'tall', 'large-square': 'square'};

/** Columns for a grid `width` px wide: as many units of at least `unit` px as fit with `gap` between them, and at least two. */
export function homeColumns(width: number, unit = HOME_UNIT, gap = HOME_GAP): number {
  if (!Number.isFinite(width) || width <= 0) return 2;
  return Math.max(2, Math.floor((width + gap) / (unit + gap)));
}

export type ShapePlacement = {column: number; row: number; columns: 1 | 2; rows: 1 | 2};
export type ShapePacking = {cards: Map<string, ShapePlacement>; rows: number; holes: {column: number; row: number}[]};

/**
 * Places cards in saved order, each at the first free position, row by row, where its shape fits ("dense" first fit).
 * A later card fills an earlier hole when it fits there, so the only holes left are ones no later card could fill;
 * that is also the only case where a card appears before one saved ahead of it. DOM and Tab order stay the saved order.
 * `holes` lists the empty cells inside the rows the cards use, the trailing cells of the last row included.
 */
export function packShapes(cards: readonly {id: string; shape: HomeShape}[], columns: number): ShapePacking {
  const width = Math.max(1, Math.floor(columns)), filled: boolean[][] = [], placed = new Map<string, ShapePlacement>();
  const free = (row: number, column: number): boolean => filled[row]?.[column] !== true;
  for (const card of cards) {
    const span = shapeSpan[card.shape], wide = Math.min(span.columns, width) as 1 | 2;
    for (let row = 0, done = false; !done; row += 1) {
      for (let column = 0; column + wide <= width && !done; column += 1) {
        let fits = true;
        for (let r = row; r < row + span.rows && fits; r += 1) for (let c = column; c < column + wide && fits; c += 1) fits = free(r, c);
        if (!fits) continue;
        for (let r = row; r < row + span.rows; r += 1) {const line = filled[r] ?? (filled[r] = []);for (let c = column; c < column + wide; c += 1) line[c] = true;}
        placed.set(card.id, {column: column + 1, row: row + 1, columns: wide, rows: span.rows});done = true;
      }
    }
  }
  const holes: {column: number; row: number}[] = [];
  for (let row = 0; row < filled.length; row += 1) for (let column = 0; column < width; column += 1) if (free(row, column)) holes.push({column: column + 1, row: row + 1});
  return {cards: placed, rows: filled.length, holes};
}

/** The largest offered shape that fits wholly in the trailing empty cells of a packing (automatic art), if any. */
export function trailingFit(packing: ShapePacking, columns: number, offered: readonly HomeShape[]): ShapePlacement | undefined {
  const empty = new Set(packing.holes.map(hole => `${String(hole.row)}:${String(hole.column)}`));
  // Only cells after every occupied cell, in reading order, count as trailing: the free run at the end of the last row.
  let lastEnd = 0;
  for (const place of packing.cards.values()) lastEnd = Math.max(lastEnd, (place.row + place.rows - 2) * columns + place.column + place.columns - 1);
  const trailing = (row: number, column: number): boolean => (row - 1) * columns + column > lastEnd && (row > packing.rows || empty.has(`${String(row)}:${String(column)}`));
  for (const shape of ['large-square', 'wide', 'tall', 'square'] as const) {
    if (!offered.includes(shape)) continue;
    const span = shapeSpan[shape];
    for (let row = 1; row <= packing.rows; row += 1) for (let column = 1; column + span.columns - 1 <= columns; column += 1) {
      let fits = true;
      for (let r = row; r < row + span.rows && fits; r += 1) for (let c = column; c < column + span.columns && fits; c += 1) fits = trailing(r, c) && r <= packing.rows;
      if (fits) return {column, row, columns: span.columns, rows: span.rows};
    }
  }
  return undefined;
}
