import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { SLOT_STATES, ledIndex, renderFrame, slotState } from '../dist/routing/lights.js';
import { DEFAULT_PROFILE_PATH, validateProfile } from '../dist/routing/profile.js';
import { claudeTask, codexTask, view } from './routing-helpers.mjs';

const profile = validateProfile(JSON.parse(readFileSync(DEFAULT_PROFILE_PATH, 'utf8')));
const record = { slot: 1, client: 'codex', provider: 'codex', hubClient: 'desktop', hostId: 'pc', sourceId: 'codex-desktop', taskId: 'x', sessionId: 'x', title: 'T', assignedAt: 0 };
const state = (session, feed = 'current') => slotState(record, session ? view([session]).sessions : [], feed);
const blank = () => Array.from({ length: 15 }, () => ({ state: 'empty', error: false, selected: false }));

test('activity, attention, notice acknowledgment, read evidence and freshness stay distinct', () => {
  assert.equal(state(codexTask(1, { activity: 'active' })), 'active');
  assert.equal(state(codexTask(1, { activity: 'active', attention: ['approval'] })), 'attention', 'attention shows even while active');
  assert.equal(state(codexTask(1, { activity: 'idle', attention: ['question'] })), 'attention');
  assert.equal(state(codexTask(1, { activity: 'idle', notices: [[]] })), 'unread', 'an unacknowledged completion notice');
  assert.equal(state(codexTask(1, { activity: 'idle', notices: [['dashboard']] })), 'idle', 'an acknowledged notice');
  assert.equal(state(codexTask(1, { activity: 'idle', notices: [[]], read: 'read' })), 'idle', 'read evidence settles the completion color');
  assert.equal(state(codexTask(1, { activity: 'interrupted' })), 'idle');
  assert.equal(state(codexTask(1, { activity: 'unknown' })), 'unknown');
  assert.equal(state(codexTask(1, { activity: 'idle', notices: [[]], freshness: 'uncertain' })), 'unknown', 'uncertain freshness never shows completion');
  assert.equal(state(codexTask(1, { activity: 'active', restartUncertain: true })), 'unknown');
  assert.equal(state(codexTask(1, { activity: 'ended' })), 'ended');
  assert.equal(state(undefined), 'ended', 'a retired or expired Hub record keeps the slot as ended');
  assert.equal(state(codexTask(1, { activity: 'idle', notices: [[]] }), 'stale'), 'stale', 'a stale feed overrides last-known state');
  assert.equal(state(codexTask(1), 'unavailable'), 'stale');
  assert.equal(slotState(undefined, [], 'current'), 'empty');
  assert.ok(SLOT_STATES.includes('unread'));
});

test('several Hub records for one slot display from the newest', () => {
  const sessions = view([claudeTask(4, { sessionId: 'old', activity: 'active', lastEvidenceAtMs: 100 }), claudeTask(4, { sessionId: 'new', activity: 'idle', lastEvidenceAtMs: 200 })]).sessions;
  assert.equal(slotState({ ...record, client: 'claude' }, sessions, 'current'), 'idle');
});

test('unknown, ended and stale never use the completion color', () => {
  for (const name of ['unknown', 'ended', 'stale', 'empty', 'idle', 'active']) assert.notDeepEqual(profile.colors[name], profile.colors.unread, name);
  for (const name of ['unknown', 'ended', 'stale']) {
    const slots = blank();
    slots[0].state = name;
    assert.notDeepEqual(renderFrame({ profile, slots, recording: false, send: 'none', pulseOn: true })[0], profile.colors.unread);
  }
});

test('the frame maps slots to their key LEDs, pulses attention and overlays error and selection', () => {
  const slots = blank();
  slots[0].state = 'active';
  slots[1].state = 'attention';
  slots[2] = { state: 'idle', error: true, selected: false };
  slots[3] = { state: 'idle', error: false, selected: true };
  const on = renderFrame({ profile, slots, recording: false, send: 'none', pulseOn: true });
  const off = renderFrame({ profile, slots, recording: false, send: 'none', pulseOn: false });
  assert.equal(on.length, 35);
  assert.deepEqual(on[0], profile.colors.active);
  assert.deepEqual(on[1], profile.colors.attention);
  assert.notDeepEqual(off[1], on[1], 'attention pulses');
  assert.deepEqual(off[0], on[0], 'only attention pulses');
  assert.deepEqual(on[2], profile.colors.error);
  assert.deepEqual(on[3], profile.colors.selected);
  assert.deepEqual(on[4], [0, 0, 0]);
  for (let i = 15; i < 35; i++) assert.deepEqual(on[i], [0, 0, 0], `LED ${i} stays off`);
});

test('a selected key with attention keeps pulsing, so focus never looks like acknowledgment', () => {
  const slots = blank();
  slots[0] = { state: 'attention', error: false, selected: true };
  slots[1] = { state: 'active', error: false, selected: true };
  const on = renderFrame({ profile, slots, recording: false, send: 'none', pulseOn: true });
  const off = renderFrame({ profile, slots, recording: false, send: 'none', pulseOn: false });
  assert.notDeepEqual(on[0], off[0], 'attention still pulses on the selected key');
  assert.deepEqual(on[0], profile.colors.attention);
  assert.deepEqual(off[0], profile.colors.selected);
  assert.deepEqual(on[1], profile.colors.selected, 'a selected key without attention is steady');
  assert.deepEqual(off[1], profile.colors.selected);
});

test('Record and the wheel LEDs show dictation and Send readiness', () => {
  const ready = renderFrame({ profile, slots: blank(), recording: true, send: 'ready', pulseOn: true });
  assert.deepEqual(ready[ledIndex(26)], profile.colors.record);
  assert.deepEqual(ready[30], profile.colors.sendReady);
  assert.deepEqual(ready[31], profile.colors.sendReady);
  const blocked = renderFrame({ profile, slots: blank(), recording: false, send: 'blocked', pulseOn: true });
  assert.deepEqual(blocked[30], profile.colors.sendBlocked);
  assert.deepEqual(blocked[ledIndex(26)], [0, 0, 0]);
  assert.equal(ledIndex(1), 0);
  assert.equal(ledIndex(25), 24);
  assert.equal(ledIndex(27), 32);
  assert.equal(ledIndex(28), 33);
  assert.equal(ledIndex(33), undefined, 'encoder clicks have no single key LED');
});

test('custom slot controls map to their own key LEDs', () => {
  const custom = validateProfile({ ...JSON.parse(readFileSync(DEFAULT_PROFILE_PATH, 'utf8')), controls: { ...profile.controls, slots: [11, 12, 13, 14, 15, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] } });
  const slots = blank();
  slots[0].state = 'active';
  assert.deepEqual(renderFrame({ profile: custom, slots, recording: false, send: 'none', pulseOn: true })[10], custom.colors.active);
});
