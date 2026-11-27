import assert from 'node:assert/strict';
import test from 'node:test';
import {frontendCommandView, type FrontendCommandPhase} from '@jimmie-potts/sdk/frontend';
import {homeLine, type LineSave} from '../src/home-line.ts';

const grouping = {requestId: 'g', text: 'Grouping lamp-b with lamp-a.'};
const save = (requestId: string | undefined, phase: FrontendCommandPhase): LineSave => ({requestId, ...frontendCommandView(phase)});
const success = {kind: 'completed', result: 'succeeded', family: 'lighting-layout-set', evidence: 'observed', code: undefined} as const;
const uncertain = 'Uncertain result. The command may have taken effect; it was not sent again.';
const conflict = 'Conflicting outcomes. Controls are locked until the operation is resolved.';

void test('a grouping says its progress, then nothing when saved, "Not grouped" when refused and its unknown outcome when uncertain', () => {
  assert.deepEqual(homeLine({save: save('g', {kind: 'requested'}), saveStamp: 1, grouping}), {text: grouping.text, recover: false});
  assert.deepEqual(homeLine({save: save('g', {kind: 'accepted'}), saveStamp: 2, grouping}), {text: grouping.text, recover: false});
  assert.deepEqual(homeLine({save: save('g', success), saveStamp: 3, grouping}), {text: '', recover: false});
  assert.deepEqual(homeLine({save: save('g', {kind: 'refused', code: 'revision-conflict'}), saveStamp: 3, grouping}),
    {text: 'Not grouped: Refused (revision-conflict) without changing state.', recover: true});
  assert.deepEqual(homeLine({save: save('g', {kind: 'expired'}), saveStamp: 3, grouping}).text.startsWith('Not grouped: Expired'), true);
  assert.deepEqual(homeLine({save: save('g', {kind: 'completed', result: 'failed', family: 'lighting-layout-set', evidence: 'none', code: 'internal'}), saveStamp: 3, grouping}).text, 'Not grouped: Completed: failed (internal). No evidence of a device effect.');
  assert.deepEqual(homeLine({save: save('g', {kind: 'uncertain'}), saveStamp: 3, grouping}), {text: `Grouping lamp-b with lamp-a: ${uncertain}`, recover: true});
  assert.deepEqual(homeLine({save: save('g', {kind: 'conflict'}), saveStamp: 3, grouping}), {text: `Grouping lamp-b with lamp-a: ${conflict}`, recover: true});
});

void test('another layout save from a Home card shows its progress and every result that needs attention, locked ones included', () => {
  assert.deepEqual(homeLine({save: save('u', {kind: 'requested'}), saveStamp: 1, grouping}), {text: 'Layout: Requested. Waiting for acceptance.', recover: false});
  assert.deepEqual(homeLine({save: save('u', success), saveStamp: 2, grouping}), {text: '', recover: false});
  for (const [phase, text] of [[{kind: 'uncertain'}, uncertain], [{kind: 'conflict'}, conflict],
    [{kind: 'refused', code: 'forbidden'}, 'Refused (forbidden) without changing state.'],
    [{kind: 'not-sent', reason: 'operation records are stale'}, 'Not sent: operation records are stale. Nothing was sent.']] as const) {
    assert.deepEqual(homeLine({save: save('u', phase), saveStamp: 2}), {text: `Layout: ${text}`, recover: true}, text);
  }
  assert.deepEqual(homeLine({save: save(undefined, {kind: 'none'}), saveStamp: 0}), {text: '', recover: false});
});

void test('a note shows while it is newer than the save\'s last change, and a later result replaces it', () => {
  const note = {text: 'A light is unavailable or has conflicting owners', stamp: 5};
  // Said while a save was in flight: the note is newer.
  assert.deepEqual(homeLine({save: save('u', {kind: 'requested'}), saveStamp: 4, note}), {text: note.text, recover: false});
  // That save is then refused: its result is newer than the note and shows.
  assert.deepEqual(homeLine({save: save('u', {kind: 'refused', code: 'revision-conflict'}), saveStamp: 6, note}), {text: 'Layout: Refused (revision-conflict) without changing state.', recover: true});
  // A note after a success shows; the next save replaces it.
  assert.deepEqual(homeLine({save: save('u', success), saveStamp: 4, note}).text, note.text);
  assert.deepEqual(homeLine({save: save('v', {kind: 'requested'}), saveStamp: 7, note}).text, 'Layout: Requested. Waiting for acceptance.');
});

void test('a newer note never hides a save left locked with an unknown outcome, or its Refresh records (#1972 review)', () => {
  const note = {text: 'Waiting for a light\'s command result', stamp: 4};
  for (const [kind, text] of [['uncertain', uncertain], ['conflict', conflict]] as const) {
    assert.deepEqual(homeLine({save: save('u', {kind}), saveStamp: 3, note}), {text: `Layout: ${text}`, recover: true}, text);
    assert.deepEqual(homeLine({save: save('g', {kind}), saveStamp: 3, grouping, note}), {text: `Grouping lamp-b with lamp-a: ${text}`, recover: true}, text);
  }
  // A note may still show over a save in flight, which settles and then shows its result.
  assert.deepEqual(homeLine({save: save('u', {kind: 'requested'}), saveStamp: 3, note}), {text: note.text, recover: false});
});

void test('the Home line does not infer command phases from revised copy', () => {
  const waiting = {...save('g', {kind: 'requested'}), text: 'Waiting for a reply.'};
  assert.deepEqual(homeLine({save: waiting, saveStamp: 2, grouping}), {text: grouping.text, recover: false});
  const saved = {...save('g', success), text: 'Layout confirmed.'};
  assert.deepEqual(homeLine({save: saved, saveStamp: 3, grouping}), {text: '', recover: false});
});
