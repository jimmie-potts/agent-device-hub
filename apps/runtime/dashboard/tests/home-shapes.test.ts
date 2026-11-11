import assert from 'node:assert/strict';
import test from 'node:test';
import {homeColumns, packShapes, shapeForSize, type HomeShape} from '../src/home-shapes.ts';
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
});

void test('columns follow the minimum unit, at least two', () => {
  assert.equal(homeColumns(1192, 220, 16), 5);assert.equal(homeColumns(1192, 180, 16), 6);assert.equal(homeColumns(1192, 280, 16), 4);
  assert.equal(homeColumns(300, 220, 16), 2);
});

void test('every catalog widget offers shapes, its Standard shape among them, and each old size maps to an offered shape', () => {
  for (const widget of widgetCatalog) {
    assert.ok(widget.shapes.length > 0 && widget.shapes.includes(widget.standard), widget.id);
    for (const size of ['small', 'medium', 'large'] as const) assert.ok(widget.shapes.includes(shapeForSize(size, widget.shapes, widget.standard)), `${widget.id} ${size}`);
  }
  assert.equal(shapeForSize('small', ['wide', 'tall', 'large-square'], 'tall'), 'tall');
  assert.equal(shapeForSize('medium', ['square', 'wide', 'tall', 'large-square'], 'tall'), 'tall');
  assert.equal(shapeForSize('large', ['square', 'wide', 'tall', 'large-square'], 'tall'), 'large-square');
});
