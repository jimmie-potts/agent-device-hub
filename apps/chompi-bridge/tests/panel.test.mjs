import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DEFAULT_PROFILE_PATH } from '../dist/routing/profile.js';
import { DEFAULT_PAGE_COLORS } from '../dist/routing/profile.js';
import { describeLights, lightRoles } from '../dist/sim/panel.js';

const profile = JSON.parse(readFileSync(DEFAULT_PROFILE_PATH, 'utf8'));
const off = () => Array.from({ length: 35 }, () => [0, 0, 0]);

test('LED roles follow the profile: slot keys, the Record key, the two wheel LEDs and knob 4\'s page LED', () => {
  const roles = lightRoles(profile);
  assert.deepEqual(roles.slice(0, 15), Array(15).fill('slot'));
  assert.equal(roles[25], 'record');
  assert.deepEqual([roles[30], roles[31]], ['wheel', 'wheel']);
  assert.equal(roles[29], 'page');
  assert.equal(roles[16], 'unused', 'unmapped black keys have no light');
});

test('lights are named by role, so a held Record reads record although record and error share a color', () => {
  assert.deepEqual(profile.colors.record, profile.colors.error, 'the shipped profile uses one red for both');
  const leds = off();
  leds[25] = profile.colors.record;
  leds[30] = profile.colors.error;
  leds[0] = profile.colors.error;
  leds[1] = profile.colors.idle;
  leds[2] = profile.colors.attention.map(v => Math.round(v * 0.2));
  leds[3] = [1, 2, 3];
  const names = describeLights(profile, leds);
  assert.deepEqual([names[25], names[30], names[0], names[1], names[2], names[3], names[4]], ['record', 'error', 'error', 'idle', 'attention (pulse low)', 'rgb 1, 2, 3', 'off']);
});

test('knob 4\'s LED is named by its page color, or attention while it alternates for a hidden page', () => {
  assert.equal(profile.colors.pages, undefined, 'the shipped profile takes the default page colors');
  const leds = off();
  leds[29] = DEFAULT_PAGE_COLORS[1];
  assert.equal(describeLights(profile, leds)[29], 'page 2');
  leds[29] = profile.colors.attention;
  assert.equal(describeLights(profile, leds)[29], 'attention');
  const custom = { ...profile, colors: { ...profile.colors, pages: [[1, 1, 1], [2, 2, 2]] } };
  leds[29] = [2, 2, 2];
  assert.equal(describeLights(custom, leds)[29], 'page 2', 'a profile\'s own page colors');
  leds[29] = DEFAULT_PAGE_COLORS[0];
  assert.equal(describeLights(custom, leds)[29], `rgb ${DEFAULT_PAGE_COLORS[0].join(', ')}`, 'only the profile\'s colors name a page');
  leds[0] = DEFAULT_PAGE_COLORS[0];
  assert.equal(describeLights(profile, leds)[0], `rgb ${DEFAULT_PAGE_COLORS[0].join(', ')}`, 'a slot key never reads as a page');
});

test('the Attention key and the volume knob have light roles, from the router\'s key map (#865)', () => {
  const roles = lightRoles(profile);
  assert.equal(roles[15], 'attention', 'black key 1 (control 16) is the default Attention key');
  assert.equal(roles[16], 'unused');
  assert.equal(roles[34], 'volume');
  assert.equal(lightRoles({ ...profile, keys: { 20: 'attention', 21: 'back' } })[19], 'attention', 'the role follows the profile map');
  assert.equal(lightRoles({ ...profile, keys: {} })[15], 'unused');
  const leds = off();
  leds[15] = profile.colors.attention;
  leds[34] = profile.colors.error;
  const names = describeLights(profile, leds);
  assert.deepEqual([names[15], names[34]], ['attention', 'error']);
  leds[15] = profile.colors.error;
  assert.equal(describeLights(profile, leds)[15], 'error', 'a refused press flashes the error color');
});
