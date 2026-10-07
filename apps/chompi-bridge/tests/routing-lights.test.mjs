import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { SLOT_STATES, VOLUME_LED, ledIndex, renderFrame, slotState } from '../dist/routing/lights.js';
import { DEFAULT_PROFILE_PATH, validateProfile } from '../dist/routing/profile.js';
import { claudeTask, codexTask, view } from './routing-helpers.mjs';

const profile = validateProfile(JSON.parse(readFileSync(DEFAULT_PROFILE_PATH, 'utf8')));
const record = { slot: 1, client: 'codex', provider: 'codex', hubClient: 'desktop', hostId: 'pc', sourceId: 'codex-desktop', taskId: 'x', sessionId: 'x', title: 'T', assignedAt: 0 };
const state = (session, feed = 'current') => slotState(record, session ? view([session]).sessions : [], feed);
const blank = () => Array.from({ length: 15 }, () => ({ state: 'empty', error: false }));

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
    assert.notDeepEqual(renderFrame({ profile, slots, recording: false, pulseOn: true })[0], profile.colors.unread);
  }
});

test('the frame maps slots to their key LEDs, pulses attention and overlays error', () => {
  const slots = blank();
  slots[0].state = 'active';
  slots[1].state = 'attention';
  slots[2] = { state: 'idle', error: true };
  const on = renderFrame({ profile, slots, recording: false, pulseOn: true });
  const off = renderFrame({ profile, slots, recording: false, pulseOn: false });
  assert.equal(on.length, 35);
  assert.deepEqual(on[0], profile.colors.active);
  assert.deepEqual(on[1], profile.colors.attention);
  assert.notDeepEqual(off[1], on[1], 'attention pulses');
  assert.deepEqual(off[0], on[0], 'only attention pulses');
  assert.deepEqual(on[2], profile.colors.error);
  assert.deepEqual(on[4], [0, 0, 0]);
  for (let i = 15; i < 35; i++) assert.deepEqual(on[i], [0, 0, 0], `LED ${i} stays off`);
});

test('slot keys show task state only: a retired selected color never appears', () => {
  const withLegacy = validateProfile({ ...JSON.parse(readFileSync(DEFAULT_PROFILE_PATH, 'utf8')), colors: { ...profile.colors, selected: [255, 255, 255] } });
  const slots = blank();
  slots[0] = { state: 'attention', error: false };
  slots[1] = { state: 'active', error: false };
  const frames = [true, false].map(pulseOn => renderFrame({ profile: withLegacy, slots, recording: false, pulseOn }));
  for (const frame of frames) assert.ok(frame.every(color => JSON.stringify(color) !== '[255,255,255]'), 'no key is white');
  assert.deepEqual(frames[0][1], profile.colors.active);
});

test('the wheel LEDs flash the error color only for a refused or uncertain Send or card press', () => {
  const flashed = renderFrame({ profile, slots: blank(), recording: false, wheelError: true, pulseOn: true });
  assert.deepEqual(flashed[30], profile.colors.error);
  assert.deepEqual(flashed[31], profile.colors.error);
  for (let i = 0; i < 35; i++) if (i !== 30 && i !== 31) assert.deepEqual(flashed[i], [0, 0, 0], `LED ${i} is unaffected`);
});

test('the Record LED shows dictation and the wheel LEDs stay off otherwise', () => {
  const recording = renderFrame({ profile, slots: blank(), recording: true, pulseOn: true });
  assert.deepEqual(recording[ledIndex(26)], profile.colors.record);
  assert.deepEqual(recording[30], [0, 0, 0]);
  assert.deepEqual(recording[31], [0, 0, 0]);
  const idle = renderFrame({ profile, slots: blank(), recording: false, pulseOn: true });
  assert.deepEqual(idle[ledIndex(26)], [0, 0, 0]);
  assert.equal(ledIndex(1), 0);
  assert.equal(ledIndex(25), 24);
  assert.equal(ledIndex(27), 32);
  assert.equal(ledIndex(28), 33);
  assert.equal(ledIndex(33), undefined, 'encoder clicks have no single key LED');
});

test('knob 4\'s LED shows the visible page and alternates with attention while a hidden page has attention (#822)', () => {
  const steady = renderFrame({ profile, slots: blank(), recording: false, pulseOn: true, page: { number: 2, hiddenAttention: false } });
  assert.deepEqual(steady[29], profile.colors.pages[1]);
  const on = renderFrame({ profile, slots: blank(), recording: false, pulseOn: true, page: { number: 3, hiddenAttention: true } });
  const off = renderFrame({ profile, slots: blank(), recording: false, pulseOn: false, page: { number: 3, hiddenAttention: true } });
  assert.deepEqual(on[29], profile.colors.attention);
  assert.deepEqual(off[29], profile.colors.pages[2]);
  for (let i = 0; i < 35; i++) if (i !== 29) assert.deepEqual(steady[i], [0, 0, 0], `LED ${i} is unaffected`);
});

test('custom slot controls map to their own key LEDs', () => {
  const custom = validateProfile({ ...JSON.parse(readFileSync(DEFAULT_PROFILE_PATH, 'utf8')), controls: { ...profile.controls, slots: [11, 12, 13, 14, 15, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] } });
  const slots = blank();
  slots[0].state = 'active';
  assert.deepEqual(renderFrame({ profile: custom, slots, recording: false, pulseOn: true })[10], custom.colors.active);
});

test('a refused Attention click flashes knob 4\'s LED in the error color, then it shows the page again (#865)', () => {
  const refused = renderFrame({ profile, slots: blank(), recording: false, pulseOn: true, page: { number: 2, hiddenAttention: true, error: true } });
  assert.deepEqual(refused[29], profile.colors.error);
  const after = renderFrame({ profile, slots: blank(), recording: false, pulseOn: false, page: { number: 2, hiddenAttention: true, error: false } });
  assert.deepEqual(after[29], profile.colors.pages[1]);
});

test('no black key lights by default; a black key mapped to attention shows it while a task waits and error on a refusal (#865)', () => {
  const none = renderFrame({ profile, slots: blank(), recording: false, pulseOn: true, attentionWaiting: true });
  for (let i = 15; i < 25; i++) assert.deepEqual(none[i], [0, 0, 0], `black key LED ${i} stays off`);
  const mapped = validateProfile({ ...JSON.parse(readFileSync(DEFAULT_PROFILE_PATH, 'utf8')), keys: { 20: 'attention', 21: 'back' } });
  for (const pulseOn of [true, false]) {
    const frame = renderFrame({ profile: mapped, slots: blank(), recording: false, pulseOn, attentionWaiting: true });
    assert.deepEqual(frame[19], mapped.colors.attention, 'steady, not pulsing like a slot key');
    assert.deepEqual(frame[20], [0, 0, 0], 'a Back key has no light');
  }
  assert.deepEqual(renderFrame({ profile: mapped, slots: blank(), recording: false, pulseOn: true, attentionWaiting: false })[19], [0, 0, 0]);
  assert.deepEqual(renderFrame({ profile: mapped, slots: blank(), recording: false, pulseOn: true, attentionWaiting: true, keyErrors: new Set([20]) })[19], mapped.colors.error);
});

test('the volume knob LED lights only to flash a refused or failed volume key (#865)', () => {
  assert.equal(VOLUME_LED, 34);
  const flashed = renderFrame({ profile, slots: blank(), recording: false, pulseOn: true, volumeError: true });
  assert.deepEqual(flashed[VOLUME_LED], profile.colors.error);
  assert.deepEqual(renderFrame({ profile, slots: blank(), recording: false, pulseOn: true })[VOLUME_LED], [0, 0, 0]);
});

test('knob 1 and knob 2 show their open control, a confirmed or unconfirmed change and a refusal; otherwise they are off (#906)', async () => {
  const { KNOB_LEDS } = await import('../dist/routing/lights.js');
  const frame = knobs => renderFrame({ profile, slots: blank(), recording: false, knobs, pulseOn: true });
  assert.deepEqual([frame({})[KNOB_LEDS.model], frame({})[KNOB_LEDS.effort]], [[0, 0, 0], [0, 0, 0]]);
  const lit = frame({ model: 'open', effort: 'applied' });
  assert.deepEqual([lit[26], lit[27]], [profile.colors.active, profile.colors.applied]);
  const flashed = frame({ model: 'unverified', effort: 'error' });
  assert.deepEqual([flashed[26], flashed[27]], [profile.colors.unknown, profile.colors.error]);
  assert.deepEqual(flashed[28], [0, 0, 0], 'knob 3 is dark without a next-step light');
});

test('knob 3\'s LED (28) shows a highlighted suggestion, a filled draft, an unconfirmed fill and a refusal (#907)', async () => {
  const { KNOB_LEDS } = await import('../dist/routing/lights.js');
  assert.deepEqual(KNOB_LEDS, { model: 26, effort: 27, next: 28 });
  const frame = knobs => renderFrame({ profile, slots: blank(), recording: false, knobs, pulseOn: true });
  assert.deepEqual(frame({})[28], [0, 0, 0]);
  assert.deepEqual([frame({ next: 'open' })[28], frame({ next: 'applied' })[28], frame({ next: 'unverified' })[28], frame({ next: 'error' })[28]],
    [profile.colors.active, profile.colors.applied, profile.colors.unknown, profile.colors.error]);
});
