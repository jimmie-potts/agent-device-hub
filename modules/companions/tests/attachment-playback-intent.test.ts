import assert from 'node:assert/strict';
import {test} from 'node:test';
import {attachmentPlaybackIntent} from '../src/assistant/attachment-playback-intent.js';

void test('recognizes a direct playback instruction and keeps its exact requested destination', () => {
  assert.deepEqual(attachmentPlaybackIntent('Play this on the Tidbyt.'), {kind: 'display', destination: 'the Tidbyt'});
  assert.deepEqual(attachmentPlaybackIntent('Please show this image on id:sideboard-2'), {kind: 'display', destination: 'id:sideboard-2'});
  assert.deepEqual(attachmentPlaybackIntent('Show this GIF on Living Room'), {kind: 'display', destination: 'Living Room'});
});

void test('asks for a destination when the owner requests playback without one', () => {
  assert.deepEqual(attachmentPlaybackIntent('Play this'), {kind: 'choose-display'});
  assert.deepEqual(attachmentPlaybackIntent('  '), {kind: 'offer-display'});
});

void test('prose, quoted, conditional, negated and compound instructions grant no immediate display authority', () => {
  for (const prompt of [
    '“Play this on the Tidbyt”',
    'The caption says Play this on the Tidbyt',
    'If I ask later, play this on the Tidbyt',
    'Play this on the Tidbyt if I get home',
    'Do not show this on the Tidbyt',
    'Play this on Pixoo and Tidbyt',
    'Play this on the Tidbyt. Then turn it off.',
    'Play this on the Tidbyt\nTomorrow',
    'What do you think of this?',
  ]) assert.deepEqual(attachmentPlaybackIntent(prompt), {kind: 'message'}, prompt);
});
