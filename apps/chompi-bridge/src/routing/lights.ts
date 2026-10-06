import { LED_COUNT, type Rgb } from '../protocol.js';
import type { FeedSession, FeedStatus } from './feed.js';
import type { RoutingProfile } from './profile.js';
import type { SlotRecord } from './slots.js';

/**
 * Slot states, kept apart the way the Hub keeps them apart: activity, attention, notice acknowledgment, read evidence
 * and freshness. Only `unread` uses the completion color; unknown, ended and stale never do.
 */
export const SLOT_STATES = ['empty', 'active', 'idle', 'unread', 'attention', 'unknown', 'ended', 'stale'] as const;
export type SlotState = typeof SLOT_STATES[number];

/**
 * The display state of one slot from its own Hub records (`sessionsForSlot`), newest first or in any order.
 * A missing record means the Hub retired or expired the session; the slot is kept and shows `ended`.
 */
export function slotState(record: SlotRecord | undefined, sessions: readonly FeedSession[], feed: FeedStatus): SlotState {
  if (!record) return 'empty';
  if (feed !== 'current') return 'stale';
  const newest = sessions.reduce<FeedSession | undefined>((best, s) => !best || s.lastEvidenceAtMs > best.lastEvidenceAtMs ? s : best, undefined);
  if (!newest) return 'ended';
  if (newest.attention.length > 0) return 'attention';
  if (newest.activity === 'ended') return 'ended';
  if (newest.activity === 'unknown' || newest.freshness === 'uncertain' || newest.restartUncertain) return 'unknown';
  if (newest.activity === 'active') return 'active';
  return newest.unacknowledgedNotices > 0 && newest.read !== 'read' ? 'unread' : 'idle';
}

/** The LED under a key control, or undefined for controls without a single LED of their own (encoder clicks). */
export function ledIndex(control: number): number | undefined {
  if (Number.isInteger(control) && control >= 1 && control <= 25) return control - 1;
  return ({ 26: 25, 27: 32, 28: 33 } as Record<number, number>)[control];
}

const OFF: Rgb = [0, 0, 0];
/** Attention alternates between its color and this fraction of it. */
export const PULSE_LOW = 0.2;

/** A slot key shows its task state only (#821): nothing marks a selected or targeted task. */
export interface SlotLight { state: SlotState; error: boolean }
export interface RenderInput {
  profile: RoutingProfile;
  /** Index 0 is slot 1. */
  slots: readonly SlotLight[];
  recording: boolean;
  /** A refused or uncertain Send or card press: both big-wheel LEDs show the error color. */
  wheelError?: boolean;
  /** The visible task page (1-based) for knob 4's LED, and whether a hidden page holds a task with attention. */
  page?: { number: number; hiddenAttention: boolean };
  /** Whether any task on a page waits for the owner: the Attention key's light (#865). */
  attentionWaiting?: boolean;
  /** Black-key controls flashing the error color for a refused press. */
  keyErrors?: ReadonlySet<number>;
  /** A volume key ignored during Record or failed: the volume knob's LED shows the error color. */
  volumeError?: boolean;
  pulseOn: boolean;
}

export const scale = ([r, g, b]: Rgb, factor: number): Rgb => [Math.round(r * factor), Math.round(g * factor), Math.round(b * factor)];

/** The two big-wheel LEDs (protocol LED indices 30 and 31). */
export const WHEEL_LEDS: readonly number[] = [30, 31];
/** Small knob 4's LED (protocol LED index 29): the page indicator (#822). */
export const PAGE_LED = 29;
/** The volume knob's LED (protocol LED index 34): it lights only to flash an ignored or failed volume key (#865). */
export const VOLUME_LED = 34;

/** The black-key controls the profile gives `action`, in control order. */
export function keyControls(keys: Readonly<Partial<Record<string, string>>>, action: string): number[] {
  return Object.entries(keys).filter(([, value]) => value === action).map(([control]) => Number(control)).sort((a, b) => a - b);
}

/**
 * The 35-LED frame for `bridge.setLeds`. LEDs without a routing meaning stay off. The big wheel's LEDs light only to
 * flash a refused or uncertain Send or card press (not a `repeat` bounce or a Send abandoned for Record): readiness is
 * decided at the press, and nothing polls the window in front to show it.
 */
export function renderFrame({
  profile, slots, recording, wheelError = false, page, attentionWaiting = false, keyErrors, volumeError = false, pulseOn,
}: RenderInput): Rgb[] {
  const frame: Rgb[] = Array.from({ length: LED_COUNT }, () => OFF);
  const { colors } = profile;
  slots.forEach((light, i) => {
    const index = ledIndex(profile.controls.slots[i]!);
    if (index === undefined) return;
    let color: Rgb = colors[light.state];
    if (light.state === 'attention' && !pulseOn) color = scale(color, PULSE_LOW);
    if (light.error) color = colors.error;
    frame[index] = color;
  });
  const record = ledIndex(profile.controls.record);
  if (recording && record !== undefined) frame[record] = colors.record;
  if (wheelError) for (const index of WHEEL_LEDS) frame[index] = colors.error;
  // Knob 4's LED shows the visible page; it alternates with the attention color while a hidden page has attention.
  if (page) frame[PAGE_LED] = page.hiddenAttention && pulseOn ? colors.attention : colors.pages[page.number - 1] ?? OFF;
  // The Attention key shows the attention color, steady, while any task waits; a Back key has no light.
  for (const control of keyControls(profile.keys, 'attention')) {
    const index = ledIndex(control);
    if (index !== undefined) frame[index] = keyErrors?.has(control) ? colors.error : attentionWaiting ? colors.attention : OFF;
  }
  if (volumeError) frame[VOLUME_LED] = colors.error;
  return frame.map(([r, g, b]) => [r, g, b] as const);
}
