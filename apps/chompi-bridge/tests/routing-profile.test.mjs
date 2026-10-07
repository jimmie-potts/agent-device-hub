import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_APPLIED_COLOR, DEFAULT_ATTENTION_REPEAT_MS, DEFAULT_CARD_STEP_COUNTS, DEFAULT_EFFORT_SETTINGS, DEFAULT_KEY_ACTIONS, DEFAULT_MENU_TIMEOUT_MS, DEFAULT_MODEL_SETTINGS,
  DEFAULT_PROFILE_PATH, DEFAULT_VOLUME_SETTINGS, EFFORT_CLICK, EFFORT_TURN, KEY_NAMES, MODEL_CLICK, MODEL_TURN, ProfileError, ProfileWatcher, loadProfile, parseProfile, validateProfile,
} from '../dist/routing/profile.js';
import { ManualClock } from '../dist/clock.js';
import { advance, onCleanup, settle, tempDir } from './routing-helpers.mjs';

const shipped = () => JSON.parse(readFileSync(DEFAULT_PROFILE_PATH, 'utf8'));
const issues = fn => { try { fn(); } catch (error) { assert.ok(error instanceof ProfileError, String(error)); assert.equal(error.code, 'invalid-profile'); return error.issues; } assert.fail('expected ProfileError'); };

test('the shipped default profile validates with the owner-decided mappings', async () => {
  assert.equal(fileURLToPath(new URL('../profiles/default.json', import.meta.url)), DEFAULT_PROFILE_PATH);
  const profile = await loadProfile(DEFAULT_PROFILE_PATH);
  assert.equal(profile.schemaVersion, 1);
  assert.deepEqual(profile.controls.slots, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  assert.equal(profile.controls.record, 26);
  assert.deepEqual(profile.controls.send, [33, 27]);
  assert.equal(profile.controls.back, 28);
  assert.equal(profile.controls.scroll, 45);
  assert.deepEqual(profile.scroll, { notchesPerStep: 1, invert: false });
  assert.deepEqual(profile.shortcuts.codexComposer, ['LeftAlt', 'L']);
  assert.deepEqual(profile.shortcuts.send, ['Enter']);
  assert.deepEqual(profile.shortcuts.dictation, ['LeftControl', 'LeftWindows']);
  assert.deepEqual(profile.qualifiedVersions.claude, ['2.19675.0.0']);
  assert.deepEqual(profile.qualifiedVersions.codex, ['26.930.3930.0'], 'Codex selectors are version-dependent too');
  assert.deepEqual(profile.cards, { stepCounts: 6, clickStillMs: 250 }, 'about a quarter turn at the measured 25 counts per revolution');
  assert.equal(DEFAULT_CARD_STEP_COUNTS, 6);
  assert.equal('cards' in shipped(), false, 'the shipped profile leaves the step default to the one constant in profile.ts');
  for (const name of ['selected', 'sendReady', 'sendBlocked']) assert.equal(name in profile.colors, false, `${name} has no meaning in the press-time model`);
  assert.ok(Object.isFrozen(profile) && Object.isFrozen(profile.controls.slots), 'a loaded profile is immutable');
});

test('Play can share the explicit Send action', () => {
  const profile = validateProfile({ ...shipped(), controls: { ...shipped().controls, send: [33, 27] } });
  assert.deepEqual(profile.controls.send, [33, 27]);
});

test('unknown fields, a wrong schema version and wrong types reject with path-qualified issues', () => {
  assert.deepEqual(issues(() => validateProfile({ ...shipped(), command: 'calc.exe' })), ['profile.command: unknown field']);
  assert.match(issues(() => validateProfile({ ...shipped(), schemaVersion: 2 }))[0], /^profile\.schemaVersion: /);
  assert.match(issues(() => validateProfile({ ...shipped(), colors: { ...shipped().colors, active: [0, 0, 256] } }))[0], /^profile\.colors\.active: /);
  assert.match(issues(() => validateProfile({ ...shipped(), brightnessPercent: 101 }))[0], /^profile\.brightnessPercent: /);
  assert.match(issues(() => validateProfile({ ...shipped(), timing: { ...shipped().timing, verifyTimeoutMs: '3000' } }))[0], /^profile\.timing\.verifyTimeoutMs: /);
  assert.match(issues(() => validateProfile({ ...shipped(), shortcuts: { ...shipped().shortcuts, open: ['Enter'] } }))[0], /^profile\.shortcuts\.open: unknown field/);
  const { colors: _, ...missing } = shipped();
  assert.match(issues(() => validateProfile(missing))[0], /^profile\.colors: required/);
  assert.match(issues(() => parseProfile('{ not json'))[0], /^profile: invalid JSON/);
  assert.match(issues(() => validateProfile([]))[0], /^profile: /);
});

test('small-knob clicks, the volume click, turns and other mapped controls can never be Send', () => {
  for (const control of [29, 30, 31, 32]) assert.match(issues(() => validateProfile({ ...shipped(), controls: { ...shipped().controls, send: [control] } }))[0], /small-knob click/);
  assert.match(issues(() => validateProfile({ ...shipped(), controls: { ...shipped().controls, send: [34] } }))[0], /volume/);
  assert.match(issues(() => validateProfile({ ...shipped(), controls: { ...shipped().controls, send: [45] } }))[0], /click control/);
  assert.match(issues(() => validateProfile({ ...shipped(), controls: { ...shipped().controls, send: [3] } }))[0], /already mapped/);
  assert.match(issues(() => validateProfile({ ...shipped(), controls: { ...shipped().controls, send: [] } }))[0], /^profile\.controls\.send: /);
  assert.match(issues(() => validateProfile({ ...shipped(), controls: { ...shipped().controls, back: 26 } }))[0], /already mapped/);
  assert.match(issues(() => validateProfile({ ...shipped(), controls: { ...shipped().controls, scroll: 33 } }))[0], /turn control/);
});

test('slots are 15 distinct key controls', () => {
  assert.match(issues(() => validateProfile({ ...shipped(), controls: { ...shipped().controls, slots: [1, 2, 3] } }))[0], /15/);
  const duplicate = [1, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  assert.match(issues(() => validateProfile({ ...shipped(), controls: { ...shipped().controls, slots: duplicate } }))[0], /already mapped/);
  const knob = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 29];
  assert.match(issues(() => validateProfile({ ...shipped(), controls: { ...shipped().controls, slots: knob } }))[0], /key control 1-25/);
});

test('shortcuts use only the key names the Windows adapter can type, and nothing but Send types Enter', async () => {
  const { VIRTUAL_KEYS } = await import('../dist/windows/index.js');
  assert.deepEqual([...KEY_NAMES].sort(), [...VIRTUAL_KEYS.keys()].sort(), 'the profile allowlist is the adapter key table');
  assert.ok(!KEY_NAMES.includes('Win+R') && !KEY_NAMES.includes('PageUp'));
  const withShortcuts = shortcuts => () => validateProfile({ ...shipped(), shortcuts: { ...shipped().shortcuts, ...shortcuts } });
  assert.match(issues(withShortcuts({ codexComposer: ['powershell -c calc'] }))[0], /not an allowed key name/);
  for (const key of ['F13', 'RightControl', 'PageDown', 'Space', 'Down', 'Escape']) {
    assert.match(issues(withShortcuts({ codexComposer: ['LeftAlt', key] }))[0], /^profile\.shortcuts\.codexComposer\[1\]: ".+" is not an allowed key name \(Enter, LeftShift, LeftControl, LeftAlt, LeftWindows, A-Z, 0-9, Equal or Minus\)$/);
  }
  assert.match(issues(withShortcuts({ send: ['LeftControl', 'Enter'] }))[0], /exactly \["Enter"\]/);
  assert.match(issues(withShortcuts({ dictation: ['LeftControl', 'Enter'] }))[0], /modifier/);
  assert.match(issues(withShortcuts({ dictation: [] }))[0], /^profile\.shortcuts\.dictation: /);
  assert.match(issues(withShortcuts({ dictation: ['LeftControl', 'K'] }))[0], /not a modifier/);
  assert.deepEqual(issues(withShortcuts({ scrollUp: ['J'] })), ['profile.shortcuts.scrollUp: unknown field'], 'scroll has no output keys yet');
  assert.match(issues(withShortcuts({ codexComposer: ['Enter'] }))[0], /must not include Enter/);
});

/** The profile installed for the #743 trial: the #820 Send mapping, the retired colors and no card settings. */
function installedTrialProfile() {
  const profile = shipped();
  delete profile.cards;
  profile.controls = { ...profile.controls, send: [33, 27] };
  profile.colors = { ...profile.colors, selected: [255, 255, 255], sendReady: [0, 255, 0], sendBlocked: [255, 120, 0] };
  return profile;
}

test('a profile from an earlier release still validates: card settings default and retired colors are ignored', () => {
  const profile = validateProfile(installedTrialProfile());
  assert.deepEqual(profile.controls.send, [33, 27]);
  assert.deepEqual(profile.cards, { stepCounts: 6, clickStillMs: 250 });
  for (const name of ['selected', 'sendReady', 'sendBlocked']) assert.equal(name in profile.colors, false, `${name} is accepted and ignored`);
  assert.match(issues(() => validateProfile({ ...installedTrialProfile(), colors: { ...installedTrialProfile().colors, selected: [256, 0, 0] } }))[0], /^profile\.colors\.selected: /, 'a retired color must still be a color');
});

test('card settings are optional, field by field, and bounded', () => {
  assert.deepEqual(validateProfile({ ...shipped(), cards: {} }).cards, { stepCounts: 6, clickStillMs: 250 });
  assert.deepEqual(validateProfile({ ...shipped(), cards: { stepCounts: 12 } }).cards, { stepCounts: 12, clickStillMs: 250 });
  assert.deepEqual(validateProfile({ ...shipped(), cards: { clickStillMs: 0 } }).cards, { stepCounts: 6, clickStillMs: 0 });
  for (const stepCounts of [0, 97, 2.5, '6']) assert.match(issues(() => validateProfile({ ...shipped(), cards: { stepCounts } }))[0], /^profile\.cards\.stepCounts: must be an integer 1-96$/);
  for (const clickStillMs of [-1, 2001, '250']) assert.match(issues(() => validateProfile({ ...shipped(), cards: { clickStillMs } }))[0], /^profile\.cards\.clickStillMs: must be an integer 0-2000 ms$/);
  assert.deepEqual(issues(() => validateProfile({ ...shipped(), cards: { stepCounts: 6, decayMs: 500 } })), ['profile.cards.decayMs: unknown field']);
  assert.match(issues(() => validateProfile({ ...shipped(), cards: [6] }))[0], /^profile\.cards: must be an object$/);
  assert.deepEqual(issues(() => validateProfile({ ...shipped(), sendToOtherApps: true })), ['profile.sendToOtherApps: unknown field'], 'Send never reaches other apps');
});

test('page settings are optional and bounded, with one color per page (#822)', () => {
  const profile = validateProfile(shipped());
  assert.deepEqual(profile.pages, { count: 4, stepCounts: DEFAULT_CARD_STEP_COUNTS, attentionClick: true });
  assert.equal(profile.colors.pages.length, 8);
  assert.equal(new Set(profile.colors.pages.map(c => JSON.stringify(c))).size, 8, 'distinct page colors');
  for (const color of profile.colors.pages) assert.notDeepEqual(color, profile.colors.attention, 'no page color looks like attention');
  assert.deepEqual(validateProfile(installedTrialProfile()).pages, { count: 4, stepCounts: 6, attentionClick: true }, 'an earlier profile keeps validating, with the Attention click');
  assert.deepEqual(validateProfile({ ...shipped(), pages: { count: 2 } }).pages, { count: 2, stepCounts: 6, attentionClick: true });
  assert.deepEqual(validateProfile({ ...shipped(), pages: { stepCounts: 12 } }).pages, { count: 4, stepCounts: 12, attentionClick: true });
  assert.deepEqual(validateProfile({ ...shipped(), pages: { attentionClick: false } }).pages, { count: 4, stepCounts: 6, attentionClick: false });
  for (const attentionClick of [1, 'true', null]) assert.deepEqual(issues(() => validateProfile({ ...shipped(), pages: { attentionClick } })), ['profile.pages.attentionClick: must be true or false']);
  for (const count of [0, 9, 1.5, '4']) assert.match(issues(() => validateProfile({ ...shipped(), pages: { count } }))[0], /^profile\.pages\.count: must be an integer 1-8$/);
  for (const stepCounts of [0, 97]) assert.match(issues(() => validateProfile({ ...shipped(), pages: { stepCounts } }))[0], /^profile\.pages\.stepCounts: must be an integer 1-96$/);
  assert.deepEqual(issues(() => validateProfile({ ...shipped(), pages: { count: 2, knob: 43 } })), ['profile.pages.knob: unknown field']);
  const red = [255, 0, 0];
  assert.deepEqual(validateProfile({ ...shipped(), pages: { count: 2 }, colors: { ...shipped().colors, pages: [red, [0, 0, 255]] } }).colors.pages, [red, [0, 0, 255]]);
  assert.match(issues(() => validateProfile({ ...shipped(), pages: { count: 3 }, colors: { ...shipped().colors, pages: [red, red] } }))[0],
    /^profile\.colors\.pages: must list a color for each of the 3 pages$/);
  assert.match(issues(() => validateProfile({ ...shipped(), colors: { ...shipped().colors, pages: [[0, 0, 256], red, red, red] } }))[0], /^profile\.colors\.pages\[0\]: /);
  assert.match(issues(() => validateProfile({ ...shipped(), controls: { ...shipped().controls, scroll: 43 } }))[0], /knob 4/, 'knob 4\'s turn pages and cannot scroll');
  for (const field of ['record', 'back']) {
    assert.deepEqual(issues(() => validateProfile({ ...shipped(), controls: { ...shipped().controls, [field]: 31 } })),
      [`profile.controls.${field}: 31 is small knob 4's click, which carries only the Attention action`]);
  }
  assert.match(issues(() => validateProfile({ ...shipped(), controls: { ...shipped().controls, send: [31] } }))[0], /small-knob click and can never send/);
});

test('scroll settings are bounded', () => {
  assert.match(issues(() => validateProfile({ ...shipped(), scroll: { notchesPerStep: 0, invert: false } }))[0], /^profile\.scroll\.notchesPerStep: /);
  assert.match(issues(() => validateProfile({ ...shipped(), scroll: { notchesPerStep: 1, invert: 'yes' } }))[0], /^profile\.scroll\.invert: /);
  assert.deepEqual(issues(() => validateProfile({ ...shipped(), scroll: { notchesPerStep: 1, invert: false, keys: ['J'] } })), ['profile.scroll.keys: unknown field']);
});

test('timing and qualified versions are bounded', () => {
  assert.match(issues(() => validateProfile({ ...shipped(), timing: { ...shipped().timing, verifyPollMs: 5000 } }))[0], /verifyPollMs/);
  assert.match(issues(() => validateProfile({ ...shipped(), qualifiedVersions: { codex: ['26.930.3930.0'], claude: [] } }))[0], /qualifiedVersions\.claude/);
  assert.deepEqual(issues(() => validateProfile({ ...shipped(), qualifiedVersions: { claude: ['2.19675.0.0'] } })), ['profile.qualifiedVersions.codex: required']);
  assert.match(issues(() => validateProfile({ ...shipped(), qualifiedVersions: { claude: ['2.19675.0.0'], codex: ['x y'] } }))[0], /qualifiedVersions\.codex\[0\]/);
});

test('black keys: an optional map from controls 16-25 to attention or back, with no default (#865)', () => {
  assert.equal('keys' in shipped(), false);
  assert.deepEqual(DEFAULT_KEY_ACTIONS, {}, 'the Attention action is on knob 4\'s click (owner decision of 2026-10-06)');
  assert.deepEqual(validateProfile(shipped()).keys, {});
  assert.deepEqual(validateProfile(installedTrialProfile()).keys, {});
  assert.deepEqual(validateProfile({ ...shipped(), keys: {} }).keys, {});
  assert.deepEqual(validateProfile({ ...shipped(), keys: { 25: 'attention', 17: 'back' } }).keys, { 17: 'back', 25: 'attention' });
  const withKeys = keys => () => validateProfile({ ...shipped(), keys });
  for (const control of ['15', '26', '1', 'x', '16.0', '016']) {
    assert.deepEqual(issues(withKeys({ [control]: 'attention' })), [`profile.keys.${control}: not a black key control 16-25`]);
  }
  for (const action of ['send', 'Attention', '', null, 1]) {
    assert.deepEqual(issues(withKeys({ 16: action })), ['profile.keys.16: must be "attention" or "back"']);
  }
  assert.match(issues(withKeys(['attention']))[0], /^profile\.keys: must be an object$/);
});

test('black keys: a control already used elsewhere is rejected; an older mapping of a black key still loads (#865)', () => {
  const slots = [16, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  assert.deepEqual(issues(() => validateProfile({ ...shipped(), controls: { ...shipped().controls, slots }, keys: { 16: 'attention' } })),
    ['profile.keys.16: 16 is already mapped by profile.controls.slots[0]']);
  for (const [field, value] of [['record', 17], ['back', 17], ['send', [17]]]) {
    assert.match(issues(() => validateProfile({ ...shipped(), controls: { ...shipped().controls, [field]: value }, keys: { 17: 'back' } }))[0],
      new RegExp(`^profile\\.keys\\.17: 17 is already mapped by profile\\.controls\\.${field}`));
  }
  // An earlier profile that already used a black key still loads: nothing is mapped there by default.
  assert.deepEqual(validateProfile({ ...shipped(), controls: { ...shipped().controls, record: 16 } }).keys, {});
  assert.deepEqual(validateProfile({ ...shipped(), controls: { ...shipped().controls, slots } }).keys, {});
});

test('volume: optional detent counts and direction; the knob\'s turn and click are reserved (#865)', () => {
  assert.equal('volume' in shipped(), false);
  assert.deepEqual(DEFAULT_VOLUME_SETTINGS, { stepCounts: 1, invert: false });
  assert.deepEqual(validateProfile(shipped()).volume, { stepCounts: 1, invert: false });
  assert.deepEqual(validateProfile(installedTrialProfile()).volume, { stepCounts: 1, invert: false });
  assert.deepEqual(validateProfile({ ...shipped(), volume: { stepCounts: 3 } }).volume, { stepCounts: 3, invert: false });
  assert.deepEqual(validateProfile({ ...shipped(), volume: { invert: true } }).volume, { stepCounts: 1, invert: true });
  for (const stepCounts of [0, 97, 1.5, '2']) assert.deepEqual(issues(() => validateProfile({ ...shipped(), volume: { stepCounts } })), ['profile.volume.stepCounts: must be an integer 1-96']);
  assert.deepEqual(issues(() => validateProfile({ ...shipped(), volume: { invert: 'no' } })), ['profile.volume.invert: must be true or false']);
  assert.deepEqual(issues(() => validateProfile({ ...shipped(), volume: { brightness: true } })), ['profile.volume.brightness: unknown field']);
  assert.match(issues(() => validateProfile({ ...shipped(), volume: 2 }))[0], /^profile\.volume: must be an object$/);
  const withVolume = controls => () => validateProfile({ ...shipped(), controls: { ...shipped().controls, ...controls }, volume: {} });
  assert.deepEqual(issues(withVolume({ scroll: 46 })), ['profile.controls.scroll: 46 is the volume knob\'s turn']);
  for (const field of ['record', 'back']) assert.deepEqual(issues(withVolume({ [field]: 34 })), [`profile.controls.${field}: 34 is the volume knob's click`]);
  // An earlier profile that used the volume knob for something else still loads, with the volume knob off.
  assert.equal(validateProfile({ ...shipped(), controls: { ...shipped().controls, scroll: 46 } }).volume, null);
  assert.equal(validateProfile({ ...shipped(), controls: { ...shipped().controls, back: 34 } }).volume, null);
});

test('the Attention key\'s repeat window is an optional timing field (#865)', () => {
  assert.equal('attentionRepeatMs' in shipped().timing, false);
  assert.equal(DEFAULT_ATTENTION_REPEAT_MS, 4000);
  assert.equal(validateProfile(shipped()).timing.attentionRepeatMs, 4000);
  assert.equal(validateProfile({ ...shipped(), timing: { ...shipped().timing, attentionRepeatMs: 2500 } }).timing.attentionRepeatMs, 2500);
  for (const attentionRepeatMs of [499, 30_001, '4000']) {
    assert.deepEqual(issues(() => validateProfile({ ...shipped(), timing: { ...shipped().timing, attentionRepeatMs } })), ['profile.timing.attentionRepeatMs: must be an integer 500-30000 ms']);
  }
});

test('reload swaps in a valid edit, keeps the last good profile on an invalid one and reports nothing when unchanged', async t => {
  const dir = tempDir(t);
  const path = join(dir, 'profile.json');
  writeFileSync(path, JSON.stringify(shipped()));
  const clock = new ManualClock();
  const reloaded = [], rejected = [];
  const initial = await loadProfile(path);
  const watcher = new ProfileWatcher({ path, initial, clock, onReload: p => reloaded.push(p), onReject: e => rejected.push(e) });
  onCleanup(t, () => watcher.stop());

  assert.equal(await watcher.check(), 'unchanged');
  writeFileSync(path, JSON.stringify({ ...shipped(), brightnessPercent: 10 }));
  assert.equal(await watcher.check(), 'reloaded');
  assert.equal(watcher.current.brightnessPercent, 10);
  assert.equal(reloaded.length, 1);

  writeFileSync(path, JSON.stringify({ ...shipped(), brightnessPercent: 10, controls: { ...shipped().controls, send: [30] } }));
  assert.equal(await watcher.check(), 'rejected');
  assert.equal(watcher.current.brightnessPercent, 10, 'the last good profile stays');
  assert.match(rejected[0].issues[0], /small-knob click/);
  assert.equal(await watcher.check(), 'unchanged', 'the same bad content is reported once');

  writeFileSync(path, '{"schemaVersion":1,');
  assert.equal(await watcher.check(), 'rejected');
  rmSync(path);
  assert.equal(await watcher.check(), 'rejected');
  assert.equal(watcher.current.brightnessPercent, 10);
  assert.equal(reloaded.length, 1);

  writeFileSync(path, JSON.stringify({ ...shipped(), padding: 'x'.repeat(70 * 1024) }));
  assert.equal(await watcher.check(), 'rejected');
  assert.match(rejected.at(-1).issues[0], /64 KiB/);

  writeFileSync(path, JSON.stringify({ ...shipped(), brightnessPercent: 20 }));
  watcher.start();
  await advance(clock, initial.timing.profilePollMs + 50);
  // The file read runs on the libuv pool, outside virtual time.
  for (let i = 0; i < 100 && watcher.current.brightnessPercent !== 20; i++) { await new Promise(resolve => setTimeout(resolve, 5)); await settle(); }
  assert.equal(watcher.current.brightnessPercent, 20, 'the watcher polls on the profile interval');
  assert.equal(reloaded.length, 2);
});

// Knob 1 (model) and knob 2 (effort), #906

test('the model and effort knobs are on by default with conservative step counts, without changing the shipped or an older profile', () => {
  assert.equal('model' in shipped() || 'effort' in shipped(), false, 'the shipped profile gives no knob sections');
  const profile = validateProfile(shipped());
  assert.equal(profile.schemaVersion, 1);
  assert.deepEqual(profile.model, DEFAULT_MODEL_SETTINGS);
  assert.deepEqual(profile.effort, DEFAULT_EFFORT_SETTINGS);
  assert.deepEqual(DEFAULT_MODEL_SETTINGS, { stepCounts: DEFAULT_CARD_STEP_COUNTS, invert: false, clickStillMs: 250 });
  assert.deepEqual(DEFAULT_EFFORT_SETTINGS, { stepCounts: DEFAULT_CARD_STEP_COUNTS, invert: false });
  assert.deepEqual([MODEL_TURN, MODEL_CLICK, EFFORT_TURN, EFFORT_CLICK], [44, 32, 41, 29], 'knob 1 is ENC_4 and knob 2 is ENC_1');
  assert.equal(profile.timing.menuTimeoutMs, DEFAULT_MENU_TIMEOUT_MS);
  assert.deepEqual(profile.colors.applied, [...DEFAULT_APPLIED_COLOR]);
  assert.deepEqual([profile.shortcuts.codexEffortIncrease, profile.shortcuts.codexEffortDecrease], [null, null], 'no chords: Codex effort uses its picker only');
  const tuned = validateProfile({
    ...shipped(), model: { stepCounts: 3, invert: true, clickStillMs: 400 }, effort: { stepCounts: 2 },
    timing: { ...shipped().timing, menuTimeoutMs: 8000 }, colors: { ...shipped().colors, applied: [1, 2, 3] },
  });
  assert.deepEqual(tuned.model, { stepCounts: 3, invert: true, clickStillMs: 400 });
  assert.deepEqual(tuned.effort, { stepCounts: 2, invert: false });
  assert.equal(tuned.timing.menuTimeoutMs, 8000);
  assert.deepEqual(tuned.colors.applied, [1, 2, 3]);
});

test('an older profile that maps a knob\'s turn or click elsewhere keeps the mapping and that knob is off; with a knob section it is an error', () => {
  const controls = shipped().controls;
  assert.equal(validateProfile({ ...shipped(), controls: { ...controls, scroll: 44 } }).model, null);
  assert.equal(validateProfile({ ...shipped(), controls: { ...controls, scroll: 41 } }).effort, null);
  assert.equal(validateProfile({ ...shipped(), controls: { ...controls, back: 32 } }).model, null);
  assert.equal(validateProfile({ ...shipped(), controls: { ...controls, record: 29 } }).effort, null);
  assert.notEqual(validateProfile({ ...shipped(), controls: { ...controls, scroll: 44 } }).effort, null, 'the other knob stays on');
  assert.deepEqual(issues(() => validateProfile({ ...shipped(), controls: { ...controls, scroll: 44 }, model: {} })), ['profile.controls.scroll: 44 is knob 1\'s turn']);
  assert.deepEqual(issues(() => validateProfile({ ...shipped(), controls: { ...controls, back: 29 }, effort: {} })), ['profile.controls.back: 29 is knob 2\'s click']);
  assert.deepEqual(issues(() => validateProfile({ ...shipped(), controls: { ...controls, send: [32] } })), ['profile.controls.send[0]: 32 is a small-knob click and can never send']);
});

test('knob sections and the menu timeout reject bad values with a path', () => {
  assert.deepEqual(issues(() => validateProfile({ ...shipped(), model: { stepCounts: 0, invert: 'no', clickStillMs: 3000, extra: 1 } })), ['profile.model.extra: unknown field']);
  assert.deepEqual(issues(() => validateProfile({ ...shipped(), model: { stepCounts: 0, invert: 'no', clickStillMs: 3000 } })), [
    'profile.model.stepCounts: must be an integer 1-96', 'profile.model.invert: must be true or false', 'profile.model.clickStillMs: must be an integer 0-2000 ms',
  ]);
  assert.deepEqual(issues(() => validateProfile({ ...shipped(), effort: { clickStillMs: 100 } })), ['profile.effort.clickStillMs: unknown field']);
  assert.deepEqual(issues(() => validateProfile({ ...shipped(), effort: [] })), ['profile.effort: must be an object']);
  assert.deepEqual(issues(() => validateProfile({ ...shipped(), timing: { ...shipped().timing, menuTimeoutMs: 999 } })), ['profile.timing.menuTimeoutMs: must be an integer 1000-30000 ms']);
  assert.deepEqual(issues(() => validateProfile({ ...shipped(), colors: { ...shipped().colors, applied: [0, 0] } })), ['profile.colors.applied: must be [r, g, b] with integers 0-255']);
});

test('the Codex effort chords are the owner\'s own: both or neither, a Control, Alt or Windows chord with one other key, never Enter', () => {
  const chords = { codexEffortIncrease: ['LeftControl', 'LeftAlt', 'Equal'], codexEffortDecrease: ['LeftControl', 'LeftAlt', 'Minus'] };
  assert.ok(KEY_NAMES.includes('Equal') && KEY_NAMES.includes('Minus'));
  for (const name of ['Up', 'Down', 'Left', 'Right', 'Escape']) assert.equal(KEY_NAMES.includes(name), false, `${name} is typed only by the knobs, never named in a profile`);
  const profile = validateProfile({ ...shipped(), shortcuts: { ...shipped().shortcuts, ...chords } });
  assert.deepEqual([profile.shortcuts.codexEffortIncrease, profile.shortcuts.codexEffortDecrease], [chords.codexEffortIncrease, chords.codexEffortDecrease]);
  const bad = extra => issues(() => validateProfile({ ...shipped(), shortcuts: { ...shipped().shortcuts, ...extra } }));
  assert.deepEqual(bad({ codexEffortIncrease: chords.codexEffortIncrease }), ['profile.shortcuts: codexEffortIncrease and codexEffortDecrease go together; give both or neither']);
  assert.deepEqual(bad({ ...chords, codexEffortDecrease: ['LeftShift', 'Minus'] }), ['profile.shortcuts.codexEffortDecrease: must hold LeftControl, LeftAlt or LeftWindows with exactly one other key']);
  assert.deepEqual(bad({ ...chords, codexEffortDecrease: ['Minus'] }), ['profile.shortcuts.codexEffortDecrease: must hold LeftControl, LeftAlt or LeftWindows with exactly one other key']);
  assert.deepEqual(bad({ ...chords, codexEffortDecrease: ['LeftControl', 'A', 'B'] }), ['profile.shortcuts.codexEffortDecrease: must hold LeftControl, LeftAlt or LeftWindows with exactly one other key']);
  assert.deepEqual(bad({ ...chords, codexEffortDecrease: ['LeftControl', 'Enter'] }), ['profile.shortcuts.codexEffortDecrease[1]: must not include Enter; only Send types Enter']);
  assert.deepEqual(bad({ ...chords, codexEffortDecrease: ['LeftAlt', 'LeftControl', 'Equal'] }), ['profile.shortcuts.codexEffortDecrease: must differ from codexEffortIncrease']);
  assert.deepEqual(bad({ ...chords, codexEffortDecrease: ['LeftControl', 'Down'] }), ['profile.shortcuts.codexEffortDecrease[1]: "Down" is not an allowed key name (Enter, LeftShift, LeftControl, LeftAlt, LeftWindows, A-Z, 0-9, Equal or Minus)']);
});
