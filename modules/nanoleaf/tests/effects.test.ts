// Translated from codex-nanoleaf tests/test_effects.py: the display encoder, which slice 2a ports with the renderer. The
// rest of the file moves with slice 2b (PORTING.md).
import assert from 'node:assert/strict';
import * as effects from '../src/effects.js';
import {decode, suite, test} from './support.js';

suite('EncoderTest', () => {
  test('test_display_encodes_zone_frames', () => {
    const write = effects.display([[7, [[1, 2, 3, 4]]], [9, [[5, 6, 7, 1], [8, 9, 10, 2]]]], true, true, true);
    assert.equal(write.animData, '2 7 1 1 2 3 0 4 9 2 5 6 7 0 1 8 9 10 0 2');
    assert.deepEqual([write.command, write.animType, write.loop, write.logicalPanelsEnabled], ['display', 'custom', true, true]);
    const fixed = effects.display([[7, [[1, 2, 3, 1]]]], false, false, false);
    assert.equal(fixed.animType, 'static');
    assert.ok(!('logicalPanelsEnabled' in fixed));
  });
});

suite('test decoder checks the port adds', () => {
  test('animData tokens must be integers, as Python read them with int()', () => {
    assert.deepEqual(decode({write: {animData: '1 7 1 1 2 3 0 4'}}), new Map([[7, [[1, 2, 3, 0, 4]]]]));
    for (const animData of ['1 7 1 1 2 3 0 NaN', '1 7 1 1 2 3 0 4.5', '1 7 1 1 2 3 0 0x4', '1 7 1 1 2 3 0', '1 7']) {
      assert.throws(() => decode({write: {animData}}), Error, animData);
    }
  });
});
