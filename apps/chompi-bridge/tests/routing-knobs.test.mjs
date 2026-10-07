// Knob 1 sets the model and knob 2 the effort of the Codex or Claude task in front (#906), keystroke-free where the
// client allows it.
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
const VERIFY_MS = PROFILE.timing.verifyTimeoutMs;
const MODEL_LED = 26, EFFORT_LED = 27;
const CHORDS = { codexEffortIncrease: ['LeftControl', 'LeftAlt', 'Equal'], codexEffortDecrease: ['LeftControl', 'LeftAlt', 'Minus'] };
const WITH_CHORDS = validateProfile({ ...base, shortcuts: { ...base.shortcuts, ...CHORDS } });
const TERMINAL = { packageIdentity: 'Microsoft.WindowsTerminal_8wekyb3d8bbwe', processName: 'WindowsTerminal.exe' };

async function setup(t, { profile = PROFILE, seed, lag = false } = {}) {
  const clock = new ManualClock(1_700_000_000_000);
  const adapter = new FakeAdapter(clock);
  const lights = new FakeLights();
  const slots = await SlotStore.open(join(tempDir(t), 'slots.json'), { clock });
  const logs = [];
  const router = new TaskRouter({ adapter, lights, slots, profile, clock, log: event => logs.push(event) });
  onCleanup(t, () => router.close());
  router.start();
  if (seed) adapter.pickers.seed(seed);
  adapter.pickers.lag = lag;
  // One Codex and one Claude task the router knows, so the Claude session in front can be told for the record readback.
  router.handleFeed(view([codexTask(1), claudeTask(2)]));
  adapter.claudeRecords.set(lid(2), { localId: lid(2), isArchived: false, lastFocusedAt: clock.now() - 60_000 });
  adapter.claudeSelected = lid(2);
  let sequence = 1;
  const event = (control, kind, extra = {}) => ({ type: 'input', at: clock.now(), epoch: 7, sequence: sequence++, control, kind, delta: 0, synthetic: false, ...extra });
  const ctx = {
    clock, adapter, lights, logs, router,
    press: control => router.handleBridgeEvent(event(control, 'press')),
    release: control => router.handleBridgeEvent(event(control, 'release')),
    /** A turn, then time for the flow to settle (its gating reads wait up to 400 ms for a lagging view). */
    async turn(control, delta) { router.handleBridgeEvent({ ...event(control, 'turn'), delta }); await advance(clock, 600); },
    /** A turn with no time after it, for a click while the knob still moves. */
    turnNow: (control, delta) => router.handleBridgeEvent({ ...event(control, 'turn'), delta }),
    async click(control) { ctx.press(control); await settle(); ctx.release(control); await advance(clock, 600); },
    /** Lets knob 1 be still for its click. */
    still: () => advance(clock, CLICK_STILL_MS + 50),
    logged: (type, fields = {}) => logs.filter(l => l.type === type && Object.entries(fields).every(([key, value]) => l[key] === value)),
    led: index => lights.last[index],
    actions: name => adapter.calls.filter(call => call[0] === name),
  };
  return ctx;
}

/** Puts `client` in front with its composer focused and no card. */
function front(ctx, client) {
  ctx.adapter.foreground = client === 'codex' ? { packageIdentity: CODEX_PACKAGE, processName: 'ChatGPT.exe' } : { packageIdentity: CLAUDE_PACKAGE, processName: 'claude.exe' };
  ctx.adapter.composer[client] = true;
}

/**
 * No knob flow typed a stray key (F1, F4): never Enter; Escape only into Codex's open picker, at most once per close;
 * Right and Left only into it; a chord only into Codex with nothing open. Send's own Enter is checked by its tests.
 */
function noStrayKeys(ctx, { sendEnters = 0 } = {}) {
  assert.equal(ctx.adapter.enters, sendEnters, 'Enter only from Send');
  const closes = ctx.logged('knob-menu', { action: 'closed', method: 'escape' }).length;
  for (const tap of ctx.adapter.clientTaps) {
    const chord = tap.keys.join('+');
    assert.ok(!tap.keys.includes('Enter'), 'a knob flow never sends Enter');
    if (chord === 'Escape' || chord === 'Right' || chord === 'Left') assert.deepEqual([tap.client, tap.picker], ['codex', 'picker-main'], `${chord} went only into Codex's open picker`);
    else assert.deepEqual([tap.client, tap.picker, CHORDS.codexEffortIncrease.join('+') === chord || CHORDS.codexEffortDecrease.join('+') === chord], ['codex', null, true], `${chord} is an owner chord into Codex with nothing open`);
  }
  assert.equal(ctx.adapter.tapped().filter(chord => chord === 'Escape').length, closes, 'one Escape per Codex close, never a second');
}

// Claude model (knob 1)

test('Claude model: knob 1 expands the Model menu on the current model, moves focus one model per detent and a still click selects it, all without keys', async t => {
  const ctx = await setup(t);
  front(ctx, 'claude');
  await ctx.turn(MODEL_TURN, STEP);
  assert.deepEqual(ctx.actions('expandSetting').map(c => c.slice(1)), [['claude', 'claude-model']]);
  assert.equal(ctx.adapter.pickers.describe('claude').focus, 'Sonnet 5.5', 'the first detent opens the menu on the current model');
  assert.deepEqual(ctx.logged('knob-menu', { knob: 'model', action: 'opened' }).map(l => [l.client, l.count]), [['claude', 4]], '"More models" is not counted');
  assert.deepEqual(ctx.led(MODEL_LED), PROFILE.colors.active);
  await ctx.turn(MODEL_TURN, -STEP);
  assert.equal(ctx.adapter.pickers.describe('claude').focus, 'Fable 5.1');
  assert.deepEqual(ctx.logged('model-step').map(l => [l.index, l.count]), [[1, 4]]);
  await ctx.still();
  await ctx.click(MODEL_CLICK);
  assert.deepEqual(ctx.actions('selectMenuOption').map(c => c.slice(1)), [['claude', 'claude-model', 1, 5]]);
  assert.equal(ctx.adapter.pickers.describe('claude').model, 'Fable 5.1');
  assert.deepEqual(ctx.logged('model').map(l => [l.client, l.outcome, l.index, l.evidence]), [['claude', 'applied', 1, 'button-and-record']]);
  assert.deepEqual(ctx.led(MODEL_LED), PROFILE.colors.applied);
  assert.equal(ctx.actions('focusComposer').length, 1, 'the composer gets focus back');
  assert.equal(ctx.adapter.composer.claude, true);
  assert.deepEqual(ctx.adapter.clientTaps, [], 'no key at all');
  noStrayKeys(ctx);
  // Play still sends from the composer afterwards.
  await advance(ctx.clock, PROFILE.timing.sendRepeatWindowMs + 100);
  await ctx.click(PLAY);
  assert.equal(ctx.logged('sent', { client: 'claude' }).length, 1);
});

test('Claude model: "More models" is never a stop; a click while knob 1 moves, with no menu, or with focus moved away selects nothing', async t => {
  const ctx = await setup(t);
  front(ctx, 'claude');
  await ctx.click(MODEL_CLICK);
  await ctx.turn(MODEL_TURN, STEP);
  for (let i = 0; i < 2; i++) await ctx.turn(MODEL_TURN, STEP);
  assert.equal(ctx.adapter.pickers.describe('claude').focus, 'Haiku 4.5', 'the last model option is the end');
  assert.equal(ctx.logged('model-step').at(-1).clamped, true);
  ctx.turnNow(MODEL_TURN, STEP);
  await advance(ctx.clock, 100);
  await ctx.click(MODEL_CLICK);
  await ctx.still();
  ctx.adapter.pickers.focusEntry('claude', 'claude-model', 0, 5);
  await ctx.click(MODEL_CLICK);
  assert.deepEqual(ctx.logged('knob-refused').map(l => l.reason), ['menu-not-open', 'knob-moving', 'nothing-chosen']);
  assert.equal(ctx.actions('selectMenuOption').length, 0);
  assert.equal(ctx.adapter.pickers.describe('claude').open, 'model-menu', 'the menu stays open');
  assert.deepEqual(ctx.led(MODEL_LED), PROFILE.colors.error);
});

test('Claude model: the readback keeps applied, mismatch and unverified apart', async t => {
  const pick = async ctx => { front(ctx, 'claude'); await ctx.turn(MODEL_TURN, STEP); await ctx.turn(MODEL_TURN, -STEP); await ctx.still(); };
  // Mismatch: the Model button still names the earlier model.
  let ctx = await setup(t);
  await pick(ctx);
  const state = ctx.adapter.pickers.state.bind(ctx.adapter.pickers);
  ctx.adapter.pickers.state = client => ({ ...state(client), model: { label: 'Sonnet 5.5', expanded: false } });
  await ctx.click(MODEL_CLICK);
  await advance(ctx.clock, VERIFY_MS + 200);
  assert.deepEqual(ctx.logged('model').map(l => [l.outcome, l.reason]), [['mismatch', 'model-differs']]);
  assert.deepEqual(ctx.led(MODEL_LED), PROFILE.colors.error);

  // Mismatch: the button agrees but the session record's model never changed.
  ctx = await setup(t);
  ctx.adapter.claudeSettings = async () => known({ model: 'claude-sonnet-5-5', effort: 'low' });
  await pick(ctx);
  await ctx.click(MODEL_CLICK);
  await advance(ctx.clock, VERIFY_MS + 200);
  assert.deepEqual(ctx.logged('model').map(l => [l.outcome, l.reason]), [['mismatch', 'record-unchanged']]);

  // Unverified: the controls cannot be read after the Select.
  ctx = await setup(t);
  await pick(ctx);
  const selectMenuOption = ctx.adapter.selectMenuOption.bind(ctx.adapter);
  ctx.adapter.selectMenuOption = async (...args) => { const answer = await selectMenuOption(...args); ctx.adapter.pickerUnknown = true; return answer; };
  await ctx.click(MODEL_CLICK);
  await advance(ctx.clock, VERIFY_MS + 200);
  assert.deepEqual(ctx.logged('model').map(l => [l.outcome, l.reason]), [['unverified', 'readback-unknown']]);
  assert.deepEqual(ctx.led(MODEL_LED), PROFILE.colors.unknown);
});

// Claude effort (knob 2)

test('Claude effort: knob 2 expands the Effort button and sets the slider one step per detent, confirmed by the button and the record', async t => {
  const ctx = await setup(t);
  front(ctx, 'claude');
  await ctx.turn(EFFORT_TURN, STEP);
  assert.deepEqual(ctx.actions('setSliderValue').map(c => c.slice(1)), [['claude', 0, 1]]);
  assert.equal(ctx.adapter.pickers.describe('claude').effort, 'Medium');
  assert.deepEqual(ctx.logged('effort').map(l => [l.client, l.route, l.direction, l.outcome, l.evidence, l.position, l.count]), [['claude', 'slider', 'up', 'applied', 'button-and-record', 2, 6]]);
  assert.deepEqual(ctx.led(EFFORT_LED), PROFILE.colors.applied);
  await ctx.turn(EFFORT_TURN, -STEP);
  assert.equal(ctx.adapter.pickers.describe('claude').effort, 'Low');
  await ctx.click(EFFORT_CLICK);
  assert.deepEqual(ctx.actions('collapseSetting').map(c => c.slice(1)), [['claude', 'claude-effort']]);
  assert.equal(ctx.adapter.composer.claude, true, 'the composer has focus again');
  assert.equal(ctx.adapter.pickers.describe('claude').model, 'Sonnet 5.5', 'the effort knob leaves the model alone');
  assert.deepEqual(ctx.adapter.clientTaps, []);
  noStrayKeys(ctx);
});

test('Claude effort: at the end of the slider range nothing is set, one at-limit flash, and the waiting detents are dropped (A1)', async t => {
  const ctx = await setup(t, { seed: { claude: { effort: 'Max' } } });
  front(ctx, 'claude');
  await ctx.turn(EFFORT_TURN, 3 * STEP);
  await advance(ctx.clock, 200);
  assert.deepEqual(ctx.actions('setSliderValue'), [], 'nothing is set at the top');
  assert.deepEqual(ctx.logged('effort').map(l => [l.outcome, l.position, l.count]), [['at-limit', 6, 6]], 'one at-limit for three detents');
  assert.deepEqual(ctx.led(EFFORT_LED), PROFILE.colors.error);
  await ctx.turn(EFFORT_TURN, -STEP);
  assert.equal(ctx.adapter.pickers.describe('claude').effort, 'Higher', 'the other direction still works at once');
});

test('Claude effort: a model without an Effort button (Haiku) is unsupported, with a red flash and nothing done', async t => {
  const ctx = await setup(t, { seed: { claude: { model: 'Haiku 4.5' } } });
  front(ctx, 'claude');
  await ctx.turn(EFFORT_TURN, STEP);
  assert.deepEqual(ctx.logged('effort').map(l => [l.client, l.outcome]), [['claude', 'unsupported']]);
  assert.deepEqual(ctx.actions('expandSetting'), []);
  assert.deepEqual(ctx.led(EFFORT_LED), PROFILE.colors.error);
});

test('Claude: a menu left open collapses after the timeout and the composer gets focus; a menu the owner closed gets nothing', async t => {
  const ctx = await setup(t);
  front(ctx, 'claude');
  await ctx.turn(MODEL_TURN, STEP);
  await advance(ctx.clock, MENU_TIMEOUT_MS + 200);
  assert.deepEqual(ctx.logged('knob-menu', { action: 'closed' }).map(l => [l.knob, l.reason, l.method, l.verified]), [['model', 'timeout', 'collapse', true]]);
  assert.equal(ctx.adapter.pickers.describe('claude').open, null);
  assert.equal(ctx.adapter.pickers.describe('claude').model, 'Sonnet 5.5', 'Collapse changes nothing');
  assert.equal(ctx.adapter.composer.claude, true);
  await ctx.turn(EFFORT_TURN, STEP);
  ctx.adapter.pickers.dismiss('claude');
  await advance(ctx.clock, MENU_TIMEOUT_MS + 200);
  assert.deepEqual(ctx.logged('knob-menu', { action: 'closed' }).at(-1).method, 'none');
  assert.equal(ctx.actions('collapseSetting').length, 1, 'no Collapse without a confirmed open control');
});

// Codex model (knob 1)

test('Codex model: knob 1 expands the picker, invokes "Select model", moves focus over the list, and a still click selects; one Escape closes the picker', async t => {
  const ctx = await setup(t);
  front(ctx, 'codex');
  await ctx.turn(MODEL_TURN, STEP);
  assert.deepEqual([ctx.actions('expandSetting').length, ctx.actions('invokeSelectModel').length], [1, 1]);
  assert.equal(ctx.adapter.pickers.describe('codex').focus, 'GPT-6 Luna', 'the list opens on the current model');
  await ctx.turn(MODEL_TURN, -STEP);
  assert.equal(ctx.adapter.pickers.describe('codex').focus, 'GPT-6 Astra');
  await ctx.still();
  await ctx.click(MODEL_CLICK);
  assert.equal(ctx.adapter.pickers.describe('codex').model, 'GPT-6 Astra');
  assert.equal(ctx.adapter.pickers.describe('codex').open, null, 'the picker, which stays open after a pick, is closed');
  assert.deepEqual(ctx.adapter.tapped('codex'), ['Escape'], 'the one key: a single Escape into the open picker');
  assert.deepEqual(ctx.logged('model').map(l => [l.client, l.outcome, l.evidence]), [['codex', 'applied', 'picker-name']]);
  assert.deepEqual(ctx.logged('knob-menu', { action: 'closed' }).map(l => [l.reason, l.method, l.verified]), [['picked', 'escape', true]]);
  noStrayKeys(ctx);
});

test('Codex model: a list left without a pick selects its current model to return to the picker, then one Escape; never Escape from the list', async t => {
  const ctx = await setup(t);
  front(ctx, 'codex');
  await ctx.turn(MODEL_TURN, STEP);
  await ctx.turn(MODEL_TURN, STEP);
  await advance(ctx.clock, MENU_TIMEOUT_MS + 300);
  assert.equal(ctx.adapter.pickers.describe('codex').model, 'GPT-6 Luna', 'nothing changed');
  assert.equal(ctx.adapter.pickers.describe('codex').open, null);
  assert.deepEqual(ctx.actions('selectMenuOption').map(c => c[3]), [2], 'the current model, to leave the list');
  assert.deepEqual(ctx.adapter.tapped('codex'), ['Escape']);
  assert.equal(ctx.adapter.pickerEvents.some(e => e.action === 'close-model-list'), false, 'no Escape reached the list');
  noStrayKeys(ctx);
});

test('Codex picker: a picker still open after its one Escape is logged closed and unverified, and never gets a second Escape (F1)', async t => {
  const ctx = await setup(t);
  front(ctx, 'codex');
  await ctx.turn(MODEL_TURN, STEP);
  const tap = ctx.adapter.pickers.tap.bind(ctx.adapter.pickers);
  ctx.adapter.pickers.tap = (client, chord, context) => chord === 'Escape' ? { value: true, events: [] } : tap(client, chord, context);
  await advance(ctx.clock, MENU_TIMEOUT_MS + VERIFY_MS + 500);
  assert.deepEqual(ctx.adapter.tapped('codex'), ['Escape']);
  assert.deepEqual(ctx.logged('knob-menu', { action: 'closed' }).map(l => [l.method, l.verified]), [['escape', false]]);
});

// Codex effort (knob 2)

test('Codex effort: with the owner\'s chords, one chord per detent, confirmed by the picker button\'s name; an unchanged name drops the waiting detents', async t => {
  const ctx = await setup(t, { profile: WITH_CHORDS });
  front(ctx, 'codex');
  await ctx.turn(EFFORT_TURN, STEP);
  assert.deepEqual(ctx.adapter.tapped('codex'), ['LeftControl+LeftAlt+Equal']);
  assert.deepEqual(ctx.logged('effort').map(l => [l.route, l.outcome, l.evidence]), [['chord', 'applied', 'picker-name']]);
  assert.equal(ctx.adapter.pickers.describe('codex').effort, 'Standard');
  assert.deepEqual(ctx.actions('expandSetting'), [], 'the picker is never opened');
  for (let i = 0; i < 3; i++) await ctx.turn(EFFORT_TURN, STEP);
  assert.equal(ctx.adapter.pickers.describe('codex').effort, 'Extra High');
  await ctx.turn(EFFORT_TURN, 3 * STEP);
  await advance(ctx.clock, VERIFY_MS + 200);
  assert.deepEqual(ctx.logged('effort').at(-1), { type: 'effort', client: 'codex', route: 'chord', direction: 'up', outcome: 'mismatch', reason: 'unchanged' });
  assert.equal(ctx.adapter.tapped('codex').length, 5, 'one chord for the three detents at the top');
  assert.deepEqual(ctx.led(EFFORT_LED), PROFILE.colors.error);
  noStrayKeys(ctx);
});

test('Codex effort chords are never sent to Claude, with a card, or with the picker open', async t => {
  const ctx = await setup(t, { profile: WITH_CHORDS });
  front(ctx, 'claude');
  await ctx.turn(EFFORT_TURN, STEP);
  assert.deepEqual(ctx.adapter.tapped(), [], 'Claude uses its own slider');
  assert.equal(ctx.adapter.pickerEvents.some(e => e.action === 'split-pane'), false);
  await ctx.click(EFFORT_CLICK);
  front(ctx, 'codex');
  ctx.adapter.openCard('codex', 2);
  await ctx.turn(EFFORT_TURN, STEP);
  ctx.adapter.closeCard('codex');
  ctx.adapter.pickers.expand('codex', 'codex-picker');
  await ctx.turn(EFFORT_TURN, STEP);
  assert.deepEqual(ctx.logged('knob-refused').map(l => l.reason), ['card-open', 'menu-open']);
  assert.deepEqual(ctx.adapter.tapped('codex'), []);
});

test('Codex effort without chords: the picker\'s Power entry, focused by UI Automation, with Right and Left; at the top nothing is sent; its click closes with one Escape', async t => {
  const ctx = await setup(t);
  front(ctx, 'codex');
  await ctx.turn(EFFORT_TURN, STEP);
  assert.deepEqual(ctx.actions('focusMenuEntry').map(c => c.slice(1)), [['codex', 'codex-picker', 3, 4]]);
  assert.deepEqual(ctx.adapter.tapped('codex'), ['Right']);
  assert.deepEqual(ctx.logged('effort').map(l => [l.route, l.outcome, l.position, l.count]), [['picker', 'applied', 2, 5]]);
  for (let i = 0; i < 3; i++) await ctx.turn(EFFORT_TURN, STEP);
  await ctx.turn(EFFORT_TURN, 2 * STEP);
  assert.equal(ctx.adapter.tapped('codex').length, 4, 'no key at the top');
  assert.deepEqual(ctx.logged('effort').at(-1), { type: 'effort', client: 'codex', route: 'picker', direction: 'up', outcome: 'at-limit', position: 5, count: 5 });
  await ctx.click(EFFORT_CLICK);
  assert.deepEqual(ctx.adapter.tapped('codex').at(-1), 'Escape');
  assert.equal(ctx.adapter.pickers.describe('codex').open, null);
  noStrayKeys(ctx);
});

test('Codex effort without chords and without a Power entry is unsupported, and the picker it opened is closed', async t => {
  const ctx = await setup(t);
  front(ctx, 'codex');
  const state = ctx.adapter.pickers.state.bind(ctx.adapter.pickers);
  ctx.adapter.pickers.state = client => {
    const s = state(client);
    return s.menu?.kind === 'codex-picker' ? { ...s, menu: { ...s.menu, items: s.menu.items.slice(0, 3) } } : s;
  };
  await ctx.turn(EFFORT_TURN, STEP);
  assert.deepEqual(ctx.logged('effort').map(l => [l.outcome, l.reason]), [['unsupported', 'power-unavailable']]);
  assert.deepEqual(ctx.adapter.tapped('codex'), ['Escape']);
  noStrayKeys(ctx);
});

// Lagging UI Automation reads (F1)

test('with every read lagging one change behind, each flow still acts once: one Escape per Codex close, one Collapse per Claude close, no stray key', async t => {
  const ctx = await setup(t, { lag: true });
  front(ctx, 'codex');
  await ctx.turn(MODEL_TURN, STEP);
  await advance(ctx.clock, 300);
  await ctx.turn(MODEL_TURN, -STEP);
  await advance(ctx.clock, 300);
  await ctx.still();
  await ctx.click(MODEL_CLICK);
  await advance(ctx.clock, VERIFY_MS + 300);
  assert.equal(ctx.adapter.pickers.describe('codex').open, null);
  assert.deepEqual(ctx.adapter.tapped('codex'), ['Escape'], 'one Escape, though the first read after it showed the picker open');
  await ctx.turn(EFFORT_TURN, STEP);
  await advance(ctx.clock, 300);
  await advance(ctx.clock, MENU_TIMEOUT_MS + VERIFY_MS + 300);
  assert.equal(ctx.adapter.pickers.describe('codex').open, null);
  front(ctx, 'claude');
  await ctx.turn(MODEL_TURN, STEP);
  await advance(ctx.clock, MENU_TIMEOUT_MS + VERIFY_MS + 300);
  await ctx.turn(EFFORT_TURN, STEP);
  await advance(ctx.clock, MENU_TIMEOUT_MS + VERIFY_MS + 300);
  assert.equal(ctx.adapter.pickers.describe('claude').open, null);
  assert.ok(ctx.actions('collapseSetting').length <= 2, 'at most one Collapse per Claude close');
  noStrayKeys(ctx);
});

// Refusals and interactions

test('the knobs refuse with a red flash and do nothing for another app, a card, an unqualified client or an unknown picker', async t => {
  const ctx = await setup(t);
  const refusals = [
    ['not-agent-client', () => { ctx.adapter.foreground = TERMINAL; }],
    ['card-open', () => { front(ctx, 'claude'); ctx.adapter.openCard('claude', 3); }],
    ['client-unqualified', () => { ctx.adapter.closeCard('claude'); ctx.adapter.versions = { ...ctx.adapter.versions, claude: known('9.9.9.9') }; }],
    ['picker-unknown', () => { ctx.adapter.versions = { ...ctx.adapter.versions, claude: known('2.19675.0.0') }; ctx.adapter.pickerUnknown = true; }],
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
  assert.deepEqual(ctx.adapter.clientTaps, []);
  assert.deepEqual([ctx.actions('expandSetting').length, ctx.adapter.enters], [0, 0]);
});

test('a light touch on a knob changes nothing: one step needs a full step of counts', async t => {
  const ctx = await setup(t);
  front(ctx, 'claude');
  await ctx.turn(EFFORT_TURN, STEP - 1);
  await ctx.turn(EFFORT_TURN, -1);
  assert.deepEqual(ctx.actions('expandSetting'), []);
});

test('any other control closes the open menu first, so Send types its Enter into the composer, never the menu', async t => {
  const ctx = await setup(t);
  front(ctx, 'claude');
  await ctx.turn(MODEL_TURN, STEP);
  await ctx.turn(MODEL_TURN, STEP);
  await ctx.click(PLAY);
  await advance(ctx.clock, 200);
  const order = ctx.adapter.calls.filter(c => ['collapseSetting', 'focusComposer'].includes(c[0]) || (c[0] === 'sendKeys' && c[1].keys.includes('Enter'))).map(c => c[0]);
  assert.deepEqual(order, ['collapseSetting', 'focusComposer', 'sendKeys'], 'Collapse and composer focus first, then Send\'s Enter');
  assert.equal(ctx.logged('knob-menu', { action: 'closed' }).at(-1).reason, 'other-control');
  assert.equal(ctx.logged('sent', { client: 'claude' }).length, 1);
  assert.equal(ctx.adapter.pickers.describe('claude').model, 'Sonnet 5.5', 'the menu picked nothing');
  noStrayKeys(ctx, { sendEnters: 1 });
});

test('knob 1 and knob 2 work independently: a knob 2 turn closes knob 1\'s menu first, and each changes only its own setting', async t => {
  const ctx = await setup(t);
  front(ctx, 'claude');
  await ctx.turn(MODEL_TURN, STEP);
  await ctx.turn(EFFORT_TURN, STEP);
  await advance(ctx.clock, 200);
  assert.deepEqual(ctx.adapter.calls.filter(c => ['expandSetting', 'collapseSetting', 'setSliderValue'].includes(c[0])).map(c => [c[0], c[2]]),
    [['expandSetting', 'claude-model'], ['collapseSetting', 'claude-model'], ['expandSetting', 'claude-effort'], ['setSliderValue', 0]]);
  assert.deepEqual(ctx.adapter.pickers.describe('claude'), { model: 'Sonnet 5.5', effort: 'Medium', open: 'effort-slider', focus: null });
  assert.deepEqual(ctx.logged('knob-menu').map(l => [l.knob, l.action]), [['model', 'opened'], ['model', 'closed'], ['effort', 'opened']]);
});

test('Record, knob 4 paging and a profile reload each close an open menu first; a knob turn while Record holds the chord is refused', async t => {
  const ctx = await setup(t);
  front(ctx, 'codex');
  await ctx.turn(MODEL_TURN, STEP);
  ctx.press(RECORD);
  await advance(ctx.clock, 300);
  assert.deepEqual(ctx.adapter.tapped(), ['Escape'], 'the list was left by Select and the picker closed with one Escape');
  assert.ok(ctx.adapter.held.has('LeftControl') && ctx.adapter.held.has('LeftWindows'), 'then the dictation chord goes down');
  await ctx.turn(EFFORT_TURN, STEP);
  assert.deepEqual(ctx.logged('knob-refused').at(-1), { type: 'knob-refused', knob: 'effort', reason: 'dictating' });
  ctx.release(RECORD);
  await advance(ctx.clock, 100);

  front(ctx, 'claude');
  await ctx.turn(MODEL_TURN, STEP);
  await ctx.turn(PAGE_TURN, PROFILE.pages.stepCounts);
  await advance(ctx.clock, 100);
  assert.equal(ctx.logged('knob-menu', { action: 'closed' }).at(-1).reason, 'other-control');
  assert.equal(ctx.logged('page').at(-1).page, 2, 'then knob 4 pages');

  await ctx.turn(MODEL_TURN, STEP);
  ctx.router.setProfile(validateProfile({ ...base, profileVersion: 2 }));
  await advance(ctx.clock, 100);
  assert.equal(ctx.logged('knob-menu', { action: 'closed' }).at(-1).reason, 'profile-reload');
  assert.equal(ctx.adapter.pickers.describe('claude').open, null);
  noStrayKeys(ctx);
});

test('a controller loss drops waiting input and still closes the open menu, replaying nothing', async t => {
  const ctx = await setup(t);
  front(ctx, 'claude');
  await ctx.turn(MODEL_TURN, STEP);
  ctx.router.handleBridgeEvent({ type: 'disconnected', at: ctx.clock.now(), epoch: 7 });
  await advance(ctx.clock, 100);
  assert.equal(ctx.logged('knob-menu', { action: 'closed' }).at(-1).reason, 'disconnected');
  assert.equal(ctx.adapter.pickers.describe('claude').open, null);
});

test('an older profile that maps knob 1\'s turn as the scroll wheel keeps it, and knob 1 sets no model', async t => {
  const profile = validateProfile({ ...base, controls: { ...base.controls, scroll: 44 } });
  assert.equal(profile.model, null);
  const ctx = await setup(t, { profile });
  front(ctx, 'claude');
  await ctx.turn(MODEL_TURN, STEP);
  assert.deepEqual(ctx.actions('expandSetting'), []);
  assert.equal(ctx.adapter.scrolled.length, 1, 'the turn scrolls as before');
});
