import assert from 'node:assert/strict';
import test from 'node:test';
import {homeColumns, packShapes, placementShape, shapeBox, shapeForSize, trailingFit, type HomeShape} from '../src/home-shapes.ts';
import {widgetCatalog} from '../src/widgets.ts';

const cards = (...shapes: HomeShape[]): {id: string; shape: HomeShape}[] => shapes.map((shape, index) => ({id: String.fromCharCode(97 + index), shape}));

void test('shapes pack in saved order and a later card fills an earlier hole', () => {
  const packed = packShapes(cards('wide', 'large-square', 'tall', 'square', 'square'), 5);
  assert.deepEqual(packed.cards.get('a'), {column: 1, row: 1, columns: 2, rows: 1});
  assert.deepEqual(packed.cards.get('b'), {column: 3, row: 1, columns: 2, rows: 2});
  assert.deepEqual(packed.cards.get('c'), {column: 5, row: 1, columns: 1, rows: 2});
  // The two squares fill the hole under the wide card.
  assert.deepEqual(packed.cards.get('d'), {column: 1, row: 2, columns: 1, rows: 1});
  assert.deepEqual(packed.cards.get('e'), {column: 2, row: 2, columns: 1, rows: 1});
  assert.equal(packed.rows, 2);assert.deepEqual(packed.holes, []);
});

void test('a two-wide card that does not fit the rest of a row moves down, leaving only a hole no later card fits', () => {
  const packed = packShapes(cards('large-square', 'large-square', 'large-square'), 5);
  assert.deepEqual([...packed.cards.values()].map(place => [place.column, place.row]), [[1, 1], [3, 1], [1, 3]]);
  assert.deepEqual(packed.holes.filter(hole => hole.row <= 2), [{column: 5, row: 1}, {column: 5, row: 2}]);
  // With an even column count the same cards leave no hole in their rows.
  assert.deepEqual(packShapes(cards('large-square', 'large-square'), 4).holes, []);
});

void test('columns follow the 220px unit and 16px gap: 3, 5 and 7 at the measured grid widths', () => {
  assert.equal(homeColumns(852), 3);assert.equal(homeColumns(1192), 5);assert.equal(homeColumns(1672), 7);
  assert.equal(homeColumns(300), 2);assert.equal(homeColumns(0), 2);
  assert.deepEqual(shapeBox('tall'), {width: 220, height: 456});assert.deepEqual(shapeBox('large-square'), {width: 456, height: 456});
});

void test('automatic art takes the largest shape in trailing empty cells only', () => {
  const all: readonly HomeShape[] = ['square', 'wide', 'tall', 'large-square'];
  // A large square in rows 1-2, then two squares in row 1: row 2 trails from column 3, wide enough for a Wide card.
  assert.deepEqual(trailingFit(packShapes(cards('large-square', 'square', 'square'), 5), 5, all), {column: 3, row: 2, columns: 2, rows: 1});
  assert.deepEqual(trailingFit(packShapes(cards('wide', 'wide'), 5), 5, all), {column: 5, row: 1, columns: 1, rows: 1});
  // The tall card's lower half ends at row 2 column 3, so only columns 4-5 of row 2 trail; art never adds a row.
  assert.deepEqual(trailingFit(packShapes(cards('wide', 'tall', 'wide'), 5), 5, all), {column: 4, row: 2, columns: 2, rows: 1});
  assert.equal(trailingFit(packShapes(cards('wide', 'wide', 'square'), 5), 5, all), undefined, 'a full grid leaves no room');
  assert.deepEqual(trailingFit(packShapes(cards('wide', 'square'), 5), 5, ['large-square']), undefined);
});

void test('every catalog widget offers shapes, its Standard shape among them, and each old width converts to an offered shape', () => {
  for (const widget of widgetCatalog) {
    assert.ok(widget.shapes.length > 0 && widget.shapes.includes(widget.standard), widget.id);
    for (const size of ['small', 'medium', 'large'] as const) assert.ok(widget.shapes.includes(shapeForSize(size, widget.shapes, widget.standard)), `${widget.id} ${size}`);
  }
  assert.equal(placementShape({size: 'small'}, ['wide', 'tall', 'large-square'], 'tall'), 'tall');
  assert.equal(placementShape({size: 'medium'}, ['square', 'wide', 'tall', 'large-square'], 'tall'), 'tall');
  assert.equal(placementShape({size: 'large'}, ['square', 'wide', 'tall', 'large-square'], 'tall'), 'large-square');
  assert.equal(placementShape({size: 'small', shape: 'wide'}, ['square', 'wide'], 'square'), 'wide');
  assert.equal(placementShape({size: 'small', shape: 'wide'}, ['square'], 'square'), 'square', 'a shape no longer offered converts');
});
