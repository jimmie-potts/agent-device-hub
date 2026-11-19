// Home's hero (#1930): the light and plug chips summarize observed power truthfully. The hero itself is checked in a
// browser by home-hero.browser.ts.
import assert from 'node:assert/strict';
import test from 'node:test';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {lightsChip, observedPower, plugsChip} from '../src/home-hero.ts';
import {device} from './devices.test.ts';

const seen = (power: boolean, observedAtMs = 1000): DeviceRecord => ({...device, observed: {status: 'known', observedAtMs, power: {status: 'known', value: power}, brightness: {status: 'unknown'}}});

void test('only a synced, available device with observed power counts as on or off', () => {
  assert.equal(observedPower(seen(true), true), 'on');assert.equal(observedPower(seen(false), true), 'off');
  assert.equal(observedPower(seen(true), false), 'unknown', 'a stale copy');
  assert.equal(observedPower({...seen(true), availability: 'unavailable'}, true), 'unknown', 'an unavailable device');
  assert.equal(observedPower(device, true), 'unknown', 'requested power is not observed power');
  assert.equal(observedPower(seen(true, 1000), true, 16_001, 15_000), 'unknown', 'an observation older than the card allows');
  assert.equal(observedPower(seen(true, 1000), true, 16_000, 15_000), 'on');
});

void test('the lights chip counts lights on and says how many are unknown', () => {
  assert.equal(lightsChip([]), undefined, 'no lights, no chip');
  assert.equal(lightsChip(['on', 'on', 'off']), '2 lights on');
  assert.equal(lightsChip(['on', 'off']), '1 light on');
  assert.equal(lightsChip(['off', 'off']), 'No lights on');
  assert.equal(lightsChip(['on', 'unknown', 'unknown']), '1 light on · 2 unknown');
  assert.equal(lightsChip(['unknown', 'unknown']), 'Lights unknown', 'never "No lights on" when nothing is observed');
  assert.equal(lightsChip(['unknown']), 'Light unknown');
});

void test('the plugs chip names the plugs that are on', () => {
  const plug = (name: string, power: 'on' | 'off' | 'unknown'): {name: string; power: 'on' | 'off' | 'unknown'} => ({name, power});
  assert.equal(plugsChip([]), undefined);
  assert.equal(plugsChip([plug('Shelf lamp', 'on'), plug('Desk lamp', 'off')]), 'Shelf lamp on');
  assert.equal(plugsChip([plug('Shelf lamp', 'on'), plug('Desk lamp', 'on')]), 'Shelf lamp and Desk lamp on');
  assert.equal(plugsChip([plug('A', 'on'), plug('B', 'on'), plug('C', 'on')]), '3 plugs on');
  assert.equal(plugsChip([plug('A', 'off'), plug('B', 'off')]), 'Plugs off');
  assert.equal(plugsChip([plug('Shelf lamp', 'off')]), 'Shelf lamp off');
  assert.equal(plugsChip([plug('A', 'off'), plug('B', 'unknown')]), 'Plugs off · 1 unknown');
  assert.equal(plugsChip([plug('Shelf lamp', 'unknown')]), 'Shelf lamp unknown');
  assert.equal(plugsChip([plug('A', 'unknown'), plug('B', 'unknown')]), 'Plugs unknown');
});
