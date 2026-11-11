// Home card shapes on one unit grid (#1672). Pure functions of saved order, shapes and the grid's width; the browser
// places each card on a CSS grid with these coordinates. They read and write nothing else.
import type {WidgetSize} from './widgets.ts';

/** The four shapes, in unit squares: 1×1, 2 wide × 1 tall, 1 wide × 2 tall and 2×2. */
export type HomeShape = 'square' | 'wide' | 'tall' | 'large-square';
export const homeShapes: readonly HomeShape[] = ['square', 'wide', 'tall', 'large-square'];
export const shapeSpan: Readonly<Record<HomeShape, {columns: 1 | 2; rows: 1 | 2}>> = {
  square: {columns: 1, rows: 1}, wide: {columns: 2, rows: 1}, tall: {columns: 1, rows: 2}, 'large-square': {columns: 2, rows: 2},
};
export const shapeName: Readonly<Record<HomeShape, string>> = {square: 'Small square', wide: 'Wide', tall: 'Tall', 'large-square': 'Large square'};

/**
 * The shape a placement saved with only a width (Small / Standard / Wide) shows, from the shapes its card offers.
 * `preferred` is the card's own choice for Standard; Small prefers one column and Wide prefers two columns, two rows.
 */
export function shapeForSize(size: WidgetSize, offered: readonly HomeShape[], preferred?: HomeShape): HomeShape {
  const wanted: readonly HomeShape[] = size === 'small' ? ['square', 'tall', 'wide', 'large-square']
    : size === 'large' ? ['large-square', 'wide', 'tall', 'square']
      : [...(preferred === undefined ? [] : [preferred]), 'wide', 'tall', 'large-square', 'square'];
  return wanted.find(shape => offered.includes(shape)) ?? offered[0] ?? 'square';
}

/** Columns for a grid `width` px wide: as many units of at least `unit` px as fit with `gap` between them, and at least two. */
export function homeColumns(width: number, unit: number, gap: number): number {
  if (!Number.isFinite(width) || width <= 0) return 2;
  return Math.max(2, Math.floor((width + gap) / (unit + gap)));
}

export type ShapePlacement = {column: number; row: number; columns: 1 | 2; rows: 1 | 2};
export type ShapePacking = {cards: Map<string, ShapePlacement>; rows: number; holes: {column: number; row: number}[]};

/**
 * Places cards in saved order, each at the first free position, row by row, where its shape fits ("dense" first fit).
 * A later card fills an earlier hole when it fits there, so the only holes left are ones no later card could fill;
 * that is also the only case where a card appears before one saved ahead of it. DOM and Tab order stay the saved order.
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
