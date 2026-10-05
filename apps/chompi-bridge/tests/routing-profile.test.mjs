import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PROFILE_PATH, KEY_NAMES, ProfileError, ProfileWatcher, loadProfile, parseProfile, validateProfile } from '../dist/routing/profile.js';
import { ManualClock } from '../dist/clock.js';
import { advance, settle, tempDir } from './routing-helpers.mjs';

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
  assert.deepEqual(profile.cards, { stepCounts: 6, clickStillMs: 250 }, 'a quarter turn at an assumed 24 counts per revolution');
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
  for (const key of ['F13', 'RightControl', 'PageDown', 'Space']) {
    assert.match(issues(withShortcuts({ codexComposer: ['LeftAlt', key] }))[0], /^profile\.shortcuts\.codexComposer\[1\]: ".+" is not an allowed key name \(Enter, LeftShift, LeftControl, LeftAlt, LeftWindows, A-Z or 0-9\)$/);
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

test('reload swaps in a valid edit, keeps the last good profile on an invalid one and reports nothing when unchanged', async t => {
  const dir = tempDir(t);
  const path = join(dir, 'profile.json');
  writeFileSync(path, JSON.stringify(shipped()));
  const clock = new ManualClock();
  const reloaded = [], rejected = [];
  const initial = await loadProfile(path);
  const watcher = new ProfileWatcher({ path, initial, clock, onReload: p => reloaded.push(p), onReject: e => rejected.push(e) });
  t.after(() => watcher.stop());

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
