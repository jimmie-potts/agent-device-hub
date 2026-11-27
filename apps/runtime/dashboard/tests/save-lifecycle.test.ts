import assert from 'node:assert/strict';
import test from 'node:test';
import {advanceSave, saveBlocked, type SaveEvent, type SaveState} from '../src/save-lifecycle.ts';

const input = {revision: 3};
const idle: SaveState<typeof input, number> = {kind: 'idle'};
const sending: SaveState<typeof input, number> = {kind: 'sending', input};
const accepted: SaveState<typeof input, number> = {kind: 'accepted', input, value: 4};
const refused: SaveState<typeof input, number> = {kind: 'refused', input, code: 'revision-conflict'};
const uncertain: SaveState<typeof input, number> = {kind: 'uncertain', input};
const confirmed: SaveState<typeof input, number> = {kind: 'confirmed', input};
const cases: readonly [string, SaveState<typeof input, number>, SaveEvent<typeof input, number>, SaveState<typeof input, number>][] = [
  ['start after idle', idle, {kind: 'start', input}, sending],
  ['ignore a second start while sending', sending, {kind: 'start', input: {revision: 4}}, sending],
  ['ignore a late reply for a different attempt', sending, {kind: 'reply', input: {revision: 3}, reply: {kind: 'accepted', value: 4}}, sending],
  ['keep sending until a reply even when copy evidence arrives first', sending, {kind: 'confirm'}, sending],
  ['keep a definite refusal code', sending, {kind: 'reply', input, reply: {kind: 'refused', code: 'revision-conflict'}}, refused],
  ['keep uncertainty distinct from refusal', sending, {kind: 'reply', input, reply: {kind: 'uncertain'}}, uncertain],
  ['keep receipt without confirming', sending, {kind: 'reply', input, reply: {kind: 'accepted', value: 4}}, accepted],
  ['accept authoritative evidence after acknowledgment', accepted, {kind: 'confirm'}, confirmed],
  ['accept authoritative evidence after a lost reply', uncertain, {kind: 'confirm'}, confirmed],
  ['do not replace a definite refusal with an observation', refused, {kind: 'confirm'}, refused],
  ['discard a settled attempt after explicit recovery', uncertain, {kind: 'reset'}, idle],
  ['do not interrupt a send on reset', sending, {kind: 'reset'}, sending],
];

for (const [name, state, event, result] of cases) void test(name, () => { assert.deepEqual(advanceSave(state, event), result); });

void test('caller policies block a current revision or allow a revision-guarded manual retry', () => {
  const locksCurrent = (attempt: typeof input): boolean => attempt.revision === 3;
  const lock = {accepted: locksCurrent, uncertain: locksCurrent};
  for (const state of [sending, accepted, uncertain]) assert.equal(saveBlocked(state, lock), true);
  for (const state of [idle, refused, confirmed]) assert.equal(saveBlocked(state, lock), false);
  assert.equal(saveBlocked(uncertain, {uncertain: () => false}), false);
  assert.equal(saveBlocked(uncertain, {uncertain: () => true}), true);
});
