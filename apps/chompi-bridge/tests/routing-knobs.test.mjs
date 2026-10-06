// Knob 1 sets the model and knob 2 the effort of the Codex or Claude task in front (#906).
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TaskRouter } from '../dist/routing/router.js';
import { SlotStore } from '../dist/routing/slots.js';
import { DEFAULT_PROFILE_PATH, validateProfile } from '../dist/routing/profile.js';
import { ManualClock } from '../dist/clock.js';
import { CLAUDE_PACKAGE, CODEX_PACKAGE, FakeAdapter, FakeLights, advance, claudeTask, codexTask, known, lid, onCleanup, settle, tempDir, view } from './routing-helpers.mjs';

const base = JSON.parse(readFileSync(DEFAULT_PROFILE_PATH, 'utf8'));
const PROFILE = validateProfile(base);
const MODEL_TURN = 44, MODEL_CLICK = 32, EFFORT_TURN = 41, EFFORT_CLICK = 29, RECORD = 26, PLAY = 27, PAGE_TURN = 43;
// The shipped knob defaults (#906), stated here too so the tests describe the device behavior on their own.
const STEP = PROFILE.model?.stepCounts ?? 6;
const CLICK_STILL_MS = PROFILE.model?.clickStillMs ?? 250;
const MENU_TIMEOUT_MS = PROFILE.timing.menuTimeoutMs ?? 5000;
const MODEL_LED = 26, EFFORT_LED = 27;
const CHORDS = { codexEffortIncrease: ['LeftControl', 'LeftAlt', 'Equal'], codexEffortDecrease: ['LeftControl', 'LeftAlt', 'Minus'] };
const TERMINAL = { packageIdentity: 'Microsoft.WindowsTerminal_8wekyb3d8bbwe', processName: 'WindowsTerminal.exe' };

async function setup(t, { profile = PROFILE, seed } = {}) {
  const clock = new ManualClock(1_700_000_000_000);
  const adapter = new FakeAdapter(clock);
  const lights = new FakeLights();
  const slots = await SlotStore.open(join(tempDir(t), 'slots.json'), { clock });
  const logs = [];
  const router = new TaskRouter({ adapter, lights, slots, profile, clock, log: event => logs.push(event) });
  onCleanup(t, () => router.close());
  router.start();
  if (seed) adapter.pickers.seed(seed);
  // One Codex and one Claude task the router knows, so the Claude session in front can be told for the record readback.
  const sessions = [codexTask(1), claudeTask(2)];
  router.handleFeed(view(sessions));
  adapter.claudeRecords.set(lid(2), { localId: lid(2), isArchived: false, lastFocusedAt: clock.now() - 60_000 });
  adapter.claudeSelected = lid(2);
  let sequence = 1;
  const event = (control, kind, extra = {}) => ({ type: 'input', at: clock.now(), epoch: 7, sequence: sequence++, control, kind, delta: 0, synthetic: false, ...extra });
  const ctx = {
    clock, adapter, lights, logs, router,
    press: control => router.handleBridgeEvent(event(control, 'press')),
    release: control => router.handleBridgeEvent(event(control, 'release')),
    async turn(control, delta) { router.handleBridgeEvent({ ...event(control, 'turn'), delta }); await advance(clock, 50); },
    async click(control) { ctx.press(control); await settle(); ctx.release(control); await advance(clock, 50); },
    /** Lets knob 1 be still for its click. */
    still: () => advance(clock, CLICK_STILL_MS + 50),
    logged: (type, fields = {}) => logs.filter(l => l.type === type && Object.entries(fields).every(([key, value]) => l[key] === value)),
    led: index => lights.last[index],
  };
  return ctx;
}

/** Puts `client` in front with its composer focused and no card. */
function front(ctx, client) {
  ctx.adapter.foreground = client === 'codex' ? { packageIdentity: CODEX_PACKAGE, processName: 'ChatGPT.exe' } : { packageIdentity: CLAUDE_PACKAGE, processName: 'claude.exe' };
  ctx.adapter.composer[client] = true;
}

/** Every Enter `tapInClient` typed went into an open menu or slider, and Send typed no Enter. */
function noPromptSent(ctx) {
  assert.equal(ctx.adapter.enters, 0, 'no Enter through sendKeys');
  for (const tap of ctx.adapter.clientTaps.filter(tap => tap.keys.includes('Enter'))) assert.ok(tap.menuOpen, 'an Enter went only into an open menu');
}

// Claude model (knob 1)

test('Claude model: the first knob 1 detent opens the model menu, each further detent moves one entry, and a still click applies the focused model', async t => {
  const ctx = await setup(t);
  front(ctx, 'claude');
  await ctx.turn(MODEL_TURN, STEP);
  assert.deepEqual(ctx.adapter.tapped('claude'), ['LeftControl+LeftShift+I'], 'the first detent only opens the menu');
  assert.equal(ctx.logged('knob-menu', { knob: 'model', client: 'claude', action: 'opened' }).length, 1);
  assert.equal(ctx.adapter.pickers.state('claude').menu.focused, null, 'Claude opens the menu with no entry focused');
  assert.deepEqual(ctx.led(MODEL_LED), PROFILE.colors.active, 'knob 1 shows that its menu is open');
  await ctx.turn(MODEL_TURN, STEP);
  assert.equal(ctx.adapter.pickers.state('claude').menu.focused, 0, 'the first Down focuses the first entry');
  await ctx.turn(MODEL_TURN, STEP);
  assert.deepEqual(ctx.adapter.tapped('claude'), ['LeftControl+LeftShift+I', 'Down', 'Down']);
  assert.deepEqual(ctx.logged('model-step').map(l => [l.index, l.count]), [[0, 5], [1, 5]]);
  await ctx.still();
  await ctx.click(MODEL_CLICK);
  assert.deepEqual(ctx.adapter.tapped('claude').at(-1), 'Enter');
  assert.equal(ctx.adapter.pickers.describe('claude').model, 'Fable 5.1');
  assert.deepEqual(ctx.logged('model').map(l => [l.client, l.outcome, l.index, l.evidence]), [['claude', 'applied', 1, 'button-and-record']]);
  assert.deepEqual(ctx.led(MODEL_LED), PROFILE.colors.applied, 'knob 1 flashes the applied color');
  assert.equal(ctx.adapter.composer.claude, true, 'the composer has focus again');
  noPromptSent(ctx);
  await advance(ctx.clock, PROFILE.timing.errorFlashMs + 100);
  assert.deepEqual(ctx.led(MODEL_LED), [0, 0, 0]);
});

test('Claude model: a click while knob 1 still moves, with nothing focused, or with no menu open picks nothing', async t => {
  const ctx = await setup(t);
  front(ctx, 'claude');
  await ctx.click(MODEL_CLICK);
  assert.deepEqual(ctx.logged('knob-refused').map(l => l.reason), ['menu-not-open']);
  await ctx.turn(MODEL_TURN, STEP);
  await ctx.click(MODEL_CLICK);
  await ctx.still();
  await ctx.click(MODEL_CLICK);
  assert.deepEqual(ctx.logged('knob-refused').map(l => l.reason), ['menu-not-open', 'knob-moving', 'nothing-chosen']);
  assert.deepEqual(ctx.adapter.tapped(), ['LeftControl+LeftShift+I'], 'no Enter');
  assert.equal(ctx.adapter.pickers.describe('claude').open, 'model-menu', 'the menu stays open');
  assert.deepEqual(ctx.led(MODEL_LED), PROFILE.colors.error);
});

test('Claude model: the readback keeps applied, mismatch and unverified apart', async t => {
  // Mismatch: the composer's Model button still names the earlier model.
  let ctx = await setup(t);
  front(ctx, 'claude');
  const state = ctx.adapter.pickers.state.bind(ctx.adapter.pickers);
  ctx.adapter.pickers.state = client => ({ ...state(client), model: 'Sonnet 5.5' });
  await ctx.turn(MODEL_TURN, STEP);
  await ctx.turn(MODEL_TURN, STEP);
  await ctx.still();
  await ctx.click(MODEL_CLICK);
  await advance(ctx.clock, PROFILE.timing.verifyTimeoutMs + 200);
  assert.deepEqual(ctx.logged('model').map(l => [l.outcome, l.reason]), [['mismatch', 'model-differs']]);
  assert.deepEqual(ctx.led(MODEL_LED), PROFILE.colors.error);

  // Mismatch: the button agrees but the session record's model never changed.
  ctx = await setup(t);
  front(ctx, 'claude');
  ctx.adapter.claudeSettings = async () => known({ model: 'claude-sonnet-5-5', effort: 'low' });
  await ctx.turn(MODEL_TURN, STEP);
  await ctx.turn(MODEL_TURN, STEP);
  await ctx.still();
  await ctx.click(MODEL_CLICK);
  await advance(ctx.clock, PROFILE.timing.verifyTimeoutMs + 200);
  assert.deepEqual(ctx.logged('model').map(l => [l.outcome, l.reason]), [['mismatch', 'record-unchanged']]);

  // Unverified: the controls cannot be read after the Enter.
  ctx = await setup(t);
  front(ctx, 'claude');
  await ctx.turn(MODEL_TURN, STEP);
  await ctx.turn(MODEL_TURN, STEP);
  await ctx.still();
  const pickerState = ctx.adapter.pickerState.bind(ctx.adapter);
  let reads = 0;
  ctx.adapter.pickerState = async client => (++reads > 1 ? { status: 'unknown', reason: 'scripted' } : pickerState(client));
  await ctx.click(MODEL_CLICK);
  await advance(ctx.clock, PROFILE.timing.verifyTimeoutMs + 200);
  assert.deepEqual(ctx.logged('model').map(l => [l.outcome, l.reason]), [['unverified', 'readback-unknown']]);
  assert.deepEqual(ctx.led(MODEL_LED), PROFILE.colors.unknown, 'unverified flashes the unknown color');
});

// Claude effort (knob 2)

test('Claude effort: a knob 2 detent opens the Effort slider and applies one level, confirmed by the button and the record, with no Enter', async t => {
  const ctx = await setup(t);
  front(ctx, 'claude');
  await ctx.turn(EFFORT_TURN, STEP);
  assert.deepEqual(ctx.adapter.tapped('claude'), ['LeftControl+LeftShift+E', 'Right']);
  assert.equal(ctx.adapter.pickers.describe('claude').effort, 'Medium');
  assert.deepEqual(ctx.logged('effort').map(l => [l.client, l.route, l.direction, l.outcome, l.evidence]), [['claude', 'slider', 'up', 'applied', 'button-and-record']]);
  assert.deepEqual(ctx.led(EFFORT_LED), PROFILE.colors.applied);
  await ctx.turn(EFFORT_TURN, -STEP);
  assert.equal(ctx.adapter.pickers.describe('claude').effort, 'Low');
  assert.deepEqual(ctx.logged('effort').map(l => [l.direction, l.outcome]), [['up', 'applied'], ['down', 'applied']]);
  await ctx.turn(EFFORT_TURN, -STEP);
  await advance(ctx.clock, PROFILE.timing.verifyTimeoutMs + 200);
  assert.deepEqual(ctx.logged('effort').at(-1).outcome, 'mismatch', 'a step that changes nothing, at the end of the range, is not applied');
  assert.equal(ctx.logged('effort').at(-1).reason, 'unchanged');
  noPromptSent(ctx);
  assert.equal(ctx.adapter.pickers.describe('claude').model, 'Sonnet 5.5', 'the effort knob leaves the model alone');
});

test('Claude effort: a model without an Effort button (Haiku) is unsupported, with a red flash and no key', async t => {
  const ctx = await setup(t, { seed: { claude: { model: 'Haiku 4.5' } } });
  front(ctx, 'claude');
  await ctx.turn(EFFORT_TURN, STEP);
  assert.deepEqual(ctx.logged('effort').map(l => [l.client, l.outcome]), [['claude', 'unsupported']]);
  assert.deepEqual(ctx.adapter.tapped(), []);
  assert.deepEqual(ctx.led(EFFORT_LED), PROFILE.colors.error);
});

test('an open menu or slider closes with Escape after the timeout, and never when it is no longer open', async t => {
  const ctx = await setup(t);
  front(ctx, 'claude');
  await ctx.turn(EFFORT_TURN, STEP);
  await advance(ctx.clock, MENU_TIMEOUT_MS + 200);
  assert.deepEqual(ctx.adapter.tapped().at(-1), 'Escape');
  assert.deepEqual(ctx.logged('knob-menu', { action: 'closed' }).map(l => [l.knob, l.reason, l.escapes]), [['effort', 'timeout', 1]]);
  assert.equal(ctx.adapter.pickers.describe('claude').open, null);
  assert.equal(ctx.adapter.pickers.describe('claude').effort, 'Medium', 'Escape keeps the level');
  // The owner closes the menu with the mouse: the timeout finds nothing open and types nothing.
  await ctx.turn(MODEL_TURN, STEP);
  ctx.adapter.pickers.dismiss('claude');
  const typed = ctx.adapter.clientTaps.length;
  await advance(ctx.clock, MENU_TIMEOUT_MS + 200);
  assert.equal(ctx.adapter.clientTaps.length, typed, 'no Escape without a confirmed open menu');
  assert.deepEqual(ctx.logged('knob-menu', { action: 'closed' }).at(-1).escapes, 0);
});

// Codex (knob 1 and knob 2)

test('Codex model: the picker opens, Enter goes only on its focused "Select model", a still click applies the focused model and Escape closes the picker', async t => {
  const ctx = await setup(t);
  front(ctx, 'codex');
  await ctx.turn(MODEL_TURN, STEP);
  assert.deepEqual(ctx.adapter.tapped('codex'), ['LeftControl+LeftShift+M', 'Enter']);
  const list = ctx.adapter.pickers.state('codex').menu;
  assert.equal(list.items[list.focused].label, 'GPT-6 Luna', 'the list opens on the current model');
  await ctx.turn(MODEL_TURN, STEP);
  assert.equal(ctx.logged('model-step').at(-1).index, list.focused + 1);
  await ctx.still();
  await ctx.click(MODEL_CLICK);
  assert.deepEqual(ctx.adapter.tapped('codex'), ['LeftControl+LeftShift+M', 'Enter', 'Down', 'Enter', 'Escape']);
  assert.equal(ctx.adapter.pickers.describe('codex').model, 'GPT-5.5');
  assert.equal(ctx.adapter.pickers.describe('codex').open, null, 'the picker, which stays open after a pick, is closed');
  assert.deepEqual(ctx.logged('model').map(l => [l.client, l.outcome, l.evidence]), [['codex', 'applied', 'announcement']]);
  noPromptSent(ctx);
});

test('Codex model: no Enter unless the picker is confirmed open with "Select model" focused', async t => {
  const ctx = await setup(t);
  front(ctx, 'codex');
  const state = ctx.adapter.pickers.state.bind(ctx.adapter.pickers);
  ctx.adapter.pickers.state = client => {
    const s = state(client);
    return s.menu?.label === 'Select effort' ? { ...s, menu: { ...s.menu, focused: 3 } } : s;
  };
  await ctx.turn(MODEL_TURN, STEP);
  await advance(ctx.clock, PROFILE.timing.verifyTimeoutMs + 200);
  assert.deepEqual(ctx.adapter.tapped('codex'), ['LeftControl+LeftShift+M', 'Escape'], 'the picker is closed, never entered');
  assert.deepEqual(ctx.logged('knob-refused').map(l => l.reason), ['menu-not-open']);
});

test('Codex effort: knob 2 steps the level through the picker\'s Power entry, reads the count from the announcement and stops at the top', async t => {
  const ctx = await setup(t);
  front(ctx, 'codex');
  await ctx.turn(EFFORT_TURN, STEP);
  assert.deepEqual(ctx.adapter.tapped('codex'), ['LeftControl+LeftShift+M', 'Down', 'Down', 'Down', 'Right']);
  assert.deepEqual(ctx.logged('effort').map(l => [l.route, l.outcome, l.position, l.count]), [['picker', 'applied', 2, 5]]);
  for (let i = 0; i < 3; i++) await ctx.turn(EFFORT_TURN, STEP);
  assert.equal(ctx.adapter.pickers.describe('codex').effort, 'Max');
  const typed = ctx.adapter.clientTaps.length;
  await ctx.turn(EFFORT_TURN, STEP);
  assert.equal(ctx.adapter.clientTaps.length, typed, 'no key at the top of the range');
  assert.deepEqual(ctx.logged('effort').at(-1), { type: 'effort', client: 'codex', route: 'picker', direction: 'up', outcome: 'at-limit', position: 5, count: 5 });
  assert.deepEqual(ctx.led(EFFORT_LED), PROFILE.colors.error);
  await ctx.click(EFFORT_CLICK);
  assert.deepEqual(ctx.adapter.tapped('codex').at(-1), 'Escape', 'knob 2\'s click closes the picker');
  assert.equal(ctx.adapter.pickers.describe('codex').open, null);
  noPromptSent(ctx);
});

test('Codex effort: the owner\'s chords are a fallback only without the picker\'s Power entry, sent only with Codex in front; without chords it is unsupported', async t => {
  for (const chords of [false, true]) {
    const ctx = await setup(t, { profile: validateProfile({ ...base, shortcuts: { ...base.shortcuts, ...(chords ? CHORDS : {}) } }) });
    front(ctx, 'codex');
    const state = ctx.adapter.pickers.state.bind(ctx.adapter.pickers);
    ctx.adapter.pickers.state = client => {
      const s = state(client);
      return s.menu?.label === 'Select effort' ? { ...s, menu: { ...s.menu, items: s.menu.items.slice(0, 3), focused: Math.min(s.menu.focused, 2) } } : s;
    };
    await ctx.turn(EFFORT_TURN, STEP);
    await advance(ctx.clock, 1000);
    if (!chords) {
      assert.deepEqual(ctx.logged('effort').map(l => [l.outcome, l.reason]), [['unsupported', 'power-unavailable']]);
      assert.equal(ctx.adapter.tapped('codex').at(-1), 'Escape', 'the picker it opened is closed');
      continue;
    }
    assert.deepEqual(ctx.adapter.tapped('codex').slice(-2), ['Escape', 'LeftControl+LeftAlt+Equal']);
    assert.deepEqual(ctx.logged('effort').map(l => [l.route, l.outcome]), [['chord', 'unverified']], 'a chord has no readback');
    assert.deepEqual(ctx.led(EFFORT_LED), PROFILE.colors.unknown);
    // Claude comes to the front: the chord, which splits a Claude pane, is never sent there.
    front(ctx, 'claude');
    await ctx.turn(EFFORT_TURN, -STEP);
    assert.equal(ctx.adapter.tapped('claude').length, 0);
    assert.equal(ctx.adapter.pickerEvents.some(e => e.action === 'split-pane'), false);
    assert.equal(ctx.logged('knob-menu', { action: 'closed' }).at(-1).reason, 'not-codex');
  }
});

// Refusals and interactions

test('the knobs refuse with a red flash and type nothing for another app, a card, an unqualified client, an unknown picker or an unfocused Claude composer', async t => {
  const ctx = await setup(t);
  const refusals = [
    ['not-agent-client', () => { ctx.adapter.foreground = TERMINAL; }],
    ['card-open', () => { front(ctx, 'claude'); ctx.adapter.openCard('claude', 3); }],
    ['client-unqualified', () => { ctx.adapter.closeCard('claude'); ctx.adapter.versions = { ...ctx.adapter.versions, claude: known('9.9.9.9') }; }],
    ['picker-unknown', () => { ctx.adapter.versions = { ...ctx.adapter.versions, claude: known('2.19675.0.0') }; ctx.adapter.pickerUnknown = true; }],
    ['composer-unfocused', () => { ctx.adapter.pickerUnknown = false; ctx.adapter.composer.claude = false; }],
  ];
  for (const [reason, arrange] of refusals) {
    arrange();
    for (const [turn, knob, led] of [[MODEL_TURN, 'model', MODEL_LED], [EFFORT_TURN, 'effort', EFFORT_LED]]) {
      await ctx.turn(turn, STEP);
      assert.deepEqual(ctx.logged('knob-refused').at(-1), { type: 'knob-refused', knob, reason, ...(reason === 'not-agent-client' ? {} : { client: 'claude' }),
        ...(reason === 'client-unqualified' ? { observedVersion: '9.9.9.9' } : {}) }, `${knob}: ${reason}`);
      assert.deepEqual(ctx.led(led), PROFILE.colors.error);
    }
  }
  assert.deepEqual(ctx.adapter.clientTaps, [], 'nothing was typed');
  assert.equal(ctx.adapter.enters, 0);
});

test('a light touch on a knob changes nothing: one step needs a full step of counts', async t => {
  const ctx = await setup(t);
  front(ctx, 'claude');
  await ctx.turn(EFFORT_TURN, STEP - 1);
  await ctx.turn(EFFORT_TURN, -1);
  assert.deepEqual(ctx.adapter.tapped(), []);
});

test('any other control closes the open menu with Escape before it acts, so Send types its Enter into the composer, never the menu', async t => {
  const ctx = await setup(t);
  front(ctx, 'claude');
  await ctx.turn(MODEL_TURN, STEP);
  await ctx.turn(MODEL_TURN, STEP);
  await ctx.click(PLAY);
  await advance(ctx.clock, 200);
  const order = ctx.adapter.calls.filter(c => (c[0] === 'tapInClient' && c[2].includes('Escape')) || (c[0] === 'sendKeys' && c[1].keys.includes('Enter'))).map(c => c[0]);
  assert.deepEqual(order, ['tapInClient', 'sendKeys'], 'Escape first, then Send\'s Enter');
  assert.equal(ctx.logged('knob-menu', { action: 'closed' }).at(-1).reason, 'other-control');
  assert.equal(ctx.logged('sent', { client: 'claude' }).length, 1);
  assert.equal(ctx.adapter.pickers.describe('claude').model, 'Sonnet 5.5', 'the menu picked nothing');
  assert.equal(ctx.logged('model').length, 0);
});

test('knob 1 and knob 2 work independently: a knob 2 turn closes knob 1\'s menu first, and each changes only its own setting', async t => {
  const ctx = await setup(t);
  front(ctx, 'claude');
  await ctx.turn(MODEL_TURN, STEP);
  await ctx.turn(EFFORT_TURN, STEP);
  await advance(ctx.clock, 200);
  assert.deepEqual(ctx.adapter.tapped('claude'), ['LeftControl+LeftShift+I', 'Escape', 'LeftControl+LeftShift+E', 'Right']);
  assert.deepEqual(ctx.adapter.pickers.describe('claude'), { model: 'Sonnet 5.5', effort: 'Medium', open: 'effort-slider', focus: null });
  assert.deepEqual(ctx.logged('knob-menu').map(l => [l.knob, l.action]), [['model', 'opened'], ['model', 'closed'], ['effort', 'opened']]);
});

test('Record, knob 4 paging and a profile reload each close an open menu first; a knob turn while Record holds the chord is refused', async t => {
  const ctx = await setup(t);
  front(ctx, 'claude');
  await ctx.turn(MODEL_TURN, STEP);
  ctx.press(RECORD);
  await advance(ctx.clock, 100);
  assert.deepEqual(ctx.adapter.tapped().at(-1), 'Escape');
  assert.ok(ctx.adapter.held.has('LeftControl') && ctx.adapter.held.has('LeftWindows'), 'then the dictation chord goes down');
  const typed = ctx.adapter.clientTaps.length;
  await ctx.turn(EFFORT_TURN, STEP);
  assert.equal(ctx.adapter.clientTaps.length, typed);
  assert.deepEqual(ctx.logged('knob-refused').at(-1), { type: 'knob-refused', knob: 'effort', reason: 'dictating' });
  ctx.release(RECORD);
  await advance(ctx.clock, 100);

  await ctx.turn(MODEL_TURN, STEP);
  await ctx.turn(PAGE_TURN, PROFILE.pages.stepCounts);
  assert.deepEqual(ctx.adapter.tapped().slice(-2), ['LeftControl+LeftShift+I', 'Escape']);
  assert.equal(ctx.logged('page').at(-1).page, 2, 'then knob 4 pages');

  await ctx.turn(MODEL_TURN, STEP);
  ctx.router.setProfile(validateProfile({ ...base, profileVersion: 2 }));
  await advance(ctx.clock, 100);
  assert.deepEqual(ctx.adapter.tapped().slice(-2), ['LeftControl+LeftShift+I', 'Escape']);
  assert.equal(ctx.logged('knob-menu', { action: 'closed' }).at(-1).reason, 'profile-reload');
  noPromptSent(ctx);
});

test('a controller loss drops waiting input and still closes the open menu, replaying nothing', async t => {
  const ctx = await setup(t);
  front(ctx, 'claude');
  await ctx.turn(MODEL_TURN, STEP);
  ctx.router.handleBridgeEvent({ type: 'disconnected', at: ctx.clock.now(), epoch: 7 });
  await advance(ctx.clock, 100);
  assert.deepEqual(ctx.adapter.tapped(), ['LeftControl+LeftShift+I', 'Escape']);
  assert.equal(ctx.logged('knob-menu', { action: 'closed' }).at(-1).reason, 'disconnected');
});

test('an older profile that maps knob 1\'s turn as the scroll wheel keeps it, and knob 1 sets no model', async t => {
  const profile = validateProfile({ ...base, controls: { ...base.controls, scroll: 44 } });
  assert.equal(profile.model, null);
  const ctx = await setup(t, { profile });
  front(ctx, 'claude');
  await ctx.turn(MODEL_TURN, STEP);
  assert.deepEqual(ctx.adapter.tapped(), []);
  assert.equal(ctx.adapter.scrolled.length, 1, 'the turn scrolls as before');
});
