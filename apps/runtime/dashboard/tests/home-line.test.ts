import assert from 'node:assert/strict';
import test from 'node:test';
import {homeLine, type LineSave} from '../src/home-line.ts';

const grouping = {requestId: 'g', text: 'Grouping lamp-b with lamp-a.'};
const save = (requestId: string | undefined, text: string, locked: boolean): LineSave => ({requestId, text, locked});
const uncertain = 'Uncertain result. The command may have taken effect; it was not sent again.';
const conflict = 'Conflicting outcomes. Controls are locked until the operation is resolved.';

void test('a grouping says its progress, then nothing when saved, "Not grouped" when refused and its unknown outcome when uncertain', () => {
  assert.deepEqual(homeLine({save: save('g', 'Requested. Waiting for acceptance.', true), saveStamp: 1, grouping}), {text: grouping.text, recover: false});
  assert.deepEqual(homeLine({save: save('g', 'Accepted. Waiting for completion.', true), saveStamp: 2, grouping}), {text: grouping.text, recover: false});
  assert.deepEqual(homeLine({save: save('g', 'Completed: succeeded. The module observed the result.', false), saveStamp: 3, grouping}), {text: '', recover: false});
  assert.deepEqual(homeLine({save: save('g', 'Refused (revision-conflict) without changing state.', false), saveStamp: 3, grouping}),
    {text: 'Not grouped: Refused (revision-conflict) without changing state.', recover: true});
  assert.deepEqual(homeLine({save: save('g', 'Expired before the command reached its owner. Nothing was sent to the device.', false), saveStamp: 3, grouping}).text.startsWith('Not grouped: Expired'), true);
  assert.deepEqual(homeLine({save: save('g', 'Completed: failed (internal). No evidence of a device effect.', false), saveStamp: 3, grouping}).text, 'Not grouped: Completed: failed (internal). No evidence of a device effect.');
  assert.deepEqual(homeLine({save: save('g', uncertain, true), saveStamp: 3, grouping}), {text: `Grouping lamp-b with lamp-a: ${uncertain}`, recover: true});
  assert.deepEqual(homeLine({save: save('g', conflict, true), saveStamp: 3, grouping}), {text: `Grouping lamp-b with lamp-a: ${conflict}`, recover: true});
});

void test('another layout save from a Home card shows its progress and every result that needs attention, locked ones included', () => {
  assert.deepEqual(homeLine({save: save('u', 'Requested. Waiting for acceptance.', true), saveStamp: 1, grouping}), {text: 'Layout: Requested. Waiting for acceptance.', recover: false});
  assert.deepEqual(homeLine({save: save('u', 'Completed: succeeded. The module observed the result.', false), saveStamp: 2, grouping}), {text: '', recover: false});
  for (const [text, locked] of [[uncertain, true], [conflict, true], ['Refused (forbidden) without changing state.', false], ['Not sent: operation records are stale. Nothing was sent.', false]] as const) {
    assert.deepEqual(homeLine({save: save('u', text, locked), saveStamp: 2}), {text: `Layout: ${text}`, recover: true}, text);
  }
  assert.deepEqual(homeLine({save: save(undefined, 'No command sent from this page.', false), saveStamp: 0}), {text: '', recover: false});
});

void test('a note shows while it is newer than the save\'s last change, and a later result replaces it', () => {
  const note = {text: 'A light is unavailable or has conflicting owners', stamp: 5};
  // Said while a save was in flight: the note is newer.
  assert.deepEqual(homeLine({save: save('u', 'Requested. Waiting for acceptance.', true), saveStamp: 4, note}), {text: note.text, recover: false});
  // That save is then refused: its result is newer than the note and shows.
  assert.deepEqual(homeLine({save: save('u', 'Refused (revision-conflict) without changing state.', false), saveStamp: 6, note}), {text: 'Layout: Refused (revision-conflict) without changing state.', recover: true});
  // A note after a success shows; the next save replaces it.
  assert.deepEqual(homeLine({save: save('u', 'Completed: succeeded. The module observed the result.', false), saveStamp: 4, note}).text, note.text);
  assert.deepEqual(homeLine({save: save('v', 'Requested. Waiting for acceptance.', true), saveStamp: 7, note}).text, 'Layout: Requested. Waiting for acceptance.');
});

void test('a newer note never hides a save left locked with an unknown outcome, or its Refresh records (#1972 review)', () => {
  const note = {text: 'Waiting for a light\'s command result', stamp: 4};
  for (const text of [uncertain, conflict]) {
    assert.deepEqual(homeLine({save: save('u', text, true), saveStamp: 3, note}), {text: `Layout: ${text}`, recover: true}, text);
    assert.deepEqual(homeLine({save: save('g', text, true), saveStamp: 3, grouping, note}), {text: `Grouping lamp-b with lamp-a: ${text}`, recover: true}, text);
  }
  // A note may still show over a save in flight, which settles and then shows its result.
  assert.deepEqual(homeLine({save: save('u', 'Requested. Waiting for acceptance.', true), saveStamp: 3, note}), {text: note.text, recover: false});
});
