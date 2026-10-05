import type { Rgb } from '../protocol.js';
import { ledIndex } from '../routing/lights.js';

/**
 * The CHOMPI panel as protocol v1 numbers it (packages/chompi-protocol/README.md "Control and LED IDs"), for the
 * verification run's control page and the scenario catalog (#853). Encoder numbers follow the firmware: the four small
 * top knobs, left to right, are `ENC_4`, `ENC_1`, `ENC_2`, `ENC_3`; `ENC_5` is the big wheel and `ENC_6` the volume
 * knob. Encoder `ENC_n` clicks as control `28 + n` and turns as control `40 + n`.
 */

export interface PanelKey { control: number; led: number; label: string; row: 'white' | 'black' | 'panel' }
export interface PanelEncoder { id: string; label: string; encoder: number; click: number; turn: number; leds: readonly number[] }

const encoder = (id: string, label: string, n: number, leds: readonly number[]): PanelEncoder => ({ id, label, encoder: n, click: 28 + n, turn: 40 + n, leds });

export const PANEL_KEYS: readonly PanelKey[] = Object.freeze([
  ...Array.from({ length: 15 }, (_, i) => ({ control: i + 1, led: i, label: `Slot ${i + 1}`, row: 'white' as const })),
  ...Array.from({ length: 10 }, (_, i) => ({ control: i + 16, led: i + 15, label: `Black key ${i + 1}`, row: 'black' as const })),
  { control: 26, led: 25, label: 'Record (CHOMPI key)', row: 'panel' },
  { control: 27, led: 32, label: 'Play', row: 'panel' },
  { control: 28, led: 33, label: 'Loop', row: 'panel' },
]);

export const PANEL_ENCODERS: readonly PanelEncoder[] = Object.freeze([
  encoder('knob-1', 'Knob 1', 4, [26]),
  encoder('knob-2', 'Knob 2', 1, [27]),
  encoder('knob-3', 'Knob 3', 2, [28]),
  encoder('knob-4', 'Knob 4', 3, [29]),
  encoder('wheel', 'Big wheel', 5, [30, 31]),
  encoder('volume', 'Volume', 6, [34]),
]);

/** Named controls the shipped profile uses. */
export const CONTROL = Object.freeze({ record: 26, play: 27, loop: 28, wheelClick: 33, wheelTurn: 45 });
/** The big wheel's two LEDs. */
export const WHEEL_LEDS: readonly number[] = Object.freeze([30, 31]);

/** Which routing light an LED can show, from the profile's controls. */
export type LightRole = 'slot' | 'record' | 'wheel' | 'unused';

/** The colors each role can show, as the router renders them (`renderFrame`): slot states and the error flash, the Record color, the wheel's error flash. */
const ROLE_NAMES: Readonly<Record<LightRole, readonly string[]>> = Object.freeze({
  slot: ['active', 'idle', 'unread', 'attention', 'ended', 'unknown', 'stale', 'error'],
  record: ['record'],
  wheel: ['error'],
  unused: [],
});
/** Attention alternates with this fraction of its color (`PULSE_LOW` in routing/lights.ts). */
const PULSE_LOW = 0.2;

export interface LightProfile {
  controls: { slots: readonly number[]; record: number };
  colors: Readonly<Record<string, readonly number[]>>;
}

export function lightRoles(profile: LightProfile): LightRole[] {
  const roles: LightRole[] = Array.from({ length: 35 }, () => 'unused');
  for (const control of profile.controls.slots) {
    const index = ledIndex(control);
    if (index !== undefined) roles[index] = 'slot';
  }
  const record = ledIndex(profile.controls.record);
  if (record !== undefined) roles[record] = 'record';
  for (const index of WHEEL_LEDS) roles[index] = 'wheel';
  return roles;
}

/**
 * Names each LED by what its role can show, never by the first profile color that happens to match: the held Record
 * key reads "record" even when the record and error colors are the same red. Off is "off"; an unexpected color is
 * named by its RGB value.
 */
export function describeLights(profile: LightProfile, leds: readonly Rgb[]): string[] {
  const roles = lightRoles(profile);
  return leds.map((rgb, i) => {
    if (rgb.every(v => v === 0)) return 'off';
    const role = roles[i] ?? 'unused';
    const match = (color: readonly number[] | undefined) => !!color && color.every((v, c) => v === rgb[c]);
    // The error flash overrides a slot's state color, so a slot that is red reads "error" before any state.
    const names = role === 'slot' ? ['error', ...ROLE_NAMES.slot.filter(n => n !== 'error')] : ROLE_NAMES[role];
    const name = names.find(n => match(profile.colors[n]));
    if (name) return name;
    const attention = profile.colors.attention;
    if (role === 'slot' && attention && match(attention.map(v => Math.round(v * PULSE_LOW)))) return 'attention (pulse low)';
    return `rgb ${rgb.join(', ')}`;
  });
}
