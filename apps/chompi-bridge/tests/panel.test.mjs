import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DEFAULT_PROFILE_PATH } from '../dist/routing/profile.js';
import { describeLights, lightRoles } from '../dist/sim/panel.js';

const profile = JSON.parse(readFileSync(DEFAULT_PROFILE_PATH, 'utf8'));
const off = () => Array.from({ length: 35 }, () => [0, 0, 0]);

test('LED roles follow the profile: slot keys, the Record key and the two wheel LEDs', () => {
  const roles = lightRoles(profile);
  assert.deepEqual(roles.slice(0, 15), Array(15).fill('slot'));
  assert.equal(roles[25], 'record');
  assert.deepEqual([roles[30], roles[31]], ['wheel', 'wheel']);
  assert.equal(roles[15], 'unused');
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
