// The glass journeys' glyph contrast (#1950): ink measured behind glyphs only, and near-invisible text never passes.
import assert from 'node:assert/strict';
import test from 'node:test';
import {glyphContrast, type Capture, type TextRun} from './glyph-contrast.ts';

const WIDTH = 20, HEIGHT = 10;
/** A capture of one flat grey, with the given pixels painted another grey. */
function capture(ground: number, paint: {x: number; y: number; value: number}[] = []): Capture {
  const data = new Uint8Array(WIDTH * HEIGHT * 3).fill(ground);
  for (const {x, y, value} of paint) data.fill(value, (y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3);
  return {data, info: {width: WIDTH, channels: 3}};
}
const run = (x: number, color: string, text: string, whole = true): TextRun => ({x, y: 0, width: 10, height: HEIGHT, color, text, whole});
const strokes = (x: number, value: number): {x: number; y: number; value: number}[] => [2, 3, 4, 5].map(y => ({x: x + 3, y, value}));

void test('only glyph pixels are measured, so an empty row over a dark shadow is not text', () => {
  // The ground is light, with a dark band in the run's last row where no glyph is drawn.
  const ground = capture(240, Array.from({length: 10}, (_, x) => ({x, y: 9, value: 60})));
  const inked = capture(240, [...strokes(0, 40), ...Array.from({length: 10}, (_, x) => ({x, y: 9, value: 60}))]);
  const result = glyphContrast(inked, ground, [run(0, 'rgb(40, 40, 40)', 'Readable')]);
  assert.equal(result.glyphs, 4);
  assert.ok(result.min > 10, `the dark glyphs on the light ground measure high: ${String(result.min)}`);
  assert.deepEqual(result.inkless, []);
});

void test('a run whose ink is nearly its ground has no glyph pixels and is reported, never skipped', () => {
  // Negative control: ink of 236 on a ground of 240 differs by 12 over RGB, under the ink threshold, at about 1.03:1.
  const ground = capture(240), inked = capture(240, [...strokes(0, 40), ...strokes(10, 236)]);
  const result = glyphContrast(inked, ground, [run(0, 'rgb(40, 40, 40)', 'Readable'), run(10, 'rgb(236, 236, 236)', 'Invisible')]);
  assert.deepEqual(result.inkless, ['"Invisible" in rgb(236, 236, 236)'], 'the near-invisible run is named');
  assert.ok(result.min > 10, 'the readable run alone sets the lowest ratio, which would pass without the inkless check');
});

void test('a run cut by the window\'s edge may have no glyph pixels without failing', () => {
  const result = glyphContrast(capture(240), capture(240), [run(0, 'rgb(40, 40, 40)', 'Clipped', false)]);
  assert.deepEqual(result.inkless, []);
});
