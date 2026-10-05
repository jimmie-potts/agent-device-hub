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
