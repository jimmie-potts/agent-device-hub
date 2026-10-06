import type { Rgb } from '../protocol.js';
import { LED_COUNT } from '../protocol.js';
import { PAGE_LED, PULSE_LOW, SLOT_STATES, VOLUME_LED, WHEEL_LEDS, keyControls, ledIndex, scale } from '../routing/lights.js';
import { DEFAULT_KEY_ACTIONS, DEFAULT_PAGE_COLORS, PAGE_TURN, VOLUME_CLICK, VOLUME_TURN, type KeyMap } from '../routing/profile.js';

export { PAGE_LED, VOLUME_LED, WHEEL_LEDS };

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

/**
 * Named controls the shipped profile uses: knob 4's turn, which always pages tasks (#822), the default Attention key
 * (black key 1) and the volume knob (#865).
 */
export const CONTROL = Object.freeze({
  record: 26, play: 27, loop: 28, wheelClick: 33, wheelTurn: 45, pageTurn: PAGE_TURN, attention: 16, volumeTurn: VOLUME_TURN, volumeClick: VOLUME_CLICK,
});
/** The default Attention key's LED. */
export const ATTENTION_KEY_LED = ledIndex(CONTROL.attention)!;

/** Which routing light an LED can show, from the profile's controls. */
export type LightRole = 'slot' | 'record' | 'wheel' | 'page' | 'attention' | 'volume' | 'unused';

/**
 * The colors each role can show, as the router renders them (`renderFrame` in routing/lights.ts): the error flash
 * before any slot state (it overrides one), the Record color, the wheel's error flash, on knob 4's page LED the
 * attention color it alternates with while a hidden page has attention (the page colors are matched separately), the
 * Attention key's attention color and refusal flash, and the volume knob's error flash.
 */
const ROLE_NAMES: Readonly<Record<LightRole, readonly string[]>> = Object.freeze({
  slot: ['error', ...SLOT_STATES.filter(state => state !== 'empty')],
  record: ['record'],
  wheel: ['error'],
  page: ['attention'],
  attention: ['error', 'attention'],
  volume: ['error'],
  unused: [],
});

export interface LightProfile {
  controls: { slots: readonly number[]; record: number };
  /** Black-key actions; absent, the router's default (an Attention key on control 16). */
  keys?: KeyMap;
  /** Named colors, and `pages`: knob 4's color for each task page, page 1 first (the shipped defaults when absent). */
  colors: Readonly<Record<string, readonly number[]>> & { readonly pages?: readonly (readonly number[])[] };
}

export function lightRoles(profile: LightProfile): LightRole[] {
  const roles: LightRole[] = Array.from({ length: LED_COUNT }, () => 'unused');
  for (const control of profile.controls.slots) {
    const index = ledIndex(control);
    if (index !== undefined) roles[index] = 'slot';
  }
  const record = ledIndex(profile.controls.record);
  if (record !== undefined) roles[record] = 'record';
  for (const index of WHEEL_LEDS) roles[index] = 'wheel';
  roles[PAGE_LED] = 'page';
  for (const control of keyControls(profile.keys ?? DEFAULT_KEY_ACTIONS, 'attention')) {
    const index = ledIndex(control);
    // A default Attention key yields to a control the profile already maps, as profile validation does.
    if (index !== undefined && roles[index] === 'unused') roles[index] = 'attention';
  }
  roles[VOLUME_LED] = 'volume';
  return roles;
}

/**
 * Names each LED by what its role can show, never by the first profile color that happens to match: the held Record
 * key reads "record" even when the record and error colors are the same red, and knob 4's LED reads "page 2" or, while
 * it alternates for a hidden page's attention, "attention". Off is "off"; an unexpected color is named by its RGB value.
 */
export function describeLights(profile: LightProfile, leds: readonly Rgb[]): string[] {
  const roles = lightRoles(profile);
  return leds.map((rgb, i) => {
    if (rgb.every(v => v === 0)) return 'off';
    const role = roles[i] ?? 'unused';
    const match = (color: readonly number[] | undefined) => !!color && color.every((v, c) => v === rgb[c]);
    const name = ROLE_NAMES[role].find(n => match(profile.colors[n]));
    if (name) return name;
    if (role === 'page') {
      const page = (profile.colors.pages ?? DEFAULT_PAGE_COLORS).findIndex(match);
      if (page >= 0) return `page ${page + 1}`;
    }
    const attention = profile.colors.attention;
    if (role === 'slot' && attention && match(scale(attention as unknown as Rgb, PULSE_LOW))) return 'attention (pulse low)';
    return `rgb ${rgb.join(', ')}`;
  });
}
