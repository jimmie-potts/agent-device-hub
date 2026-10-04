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

/** The two big-wheel LEDs (protocol LED indices 30 and 31). */
const WHEEL_LEDS = [30, 31];
const OFF: Rgb = [0, 0, 0];
/** Attention alternates between its color and this fraction of it. */
const PULSE_LOW = 0.2;

export interface SlotLight { state: SlotState; error: boolean; selected: boolean }
export interface RenderInput {
  profile: RoutingProfile;
  /** Index 0 is slot 1. */
  slots: readonly SlotLight[];
  recording: boolean;
  send: 'none' | 'ready' | 'blocked';
  pulseOn: boolean;
}

const scale = ([r, g, b]: Rgb, factor: number): Rgb => [Math.round(r * factor), Math.round(g * factor), Math.round(b * factor)];

/** The 35-LED frame for `bridge.setLeds`. LEDs without a routing meaning stay off. */
export function renderFrame({ profile, slots, recording, send, pulseOn }: RenderInput): Rgb[] {
  const frame: Rgb[] = Array.from({ length: LED_COUNT }, () => OFF);
  const { colors } = profile;
  slots.forEach((light, i) => {
    const index = ledIndex(profile.controls.slots[i]!);
    if (index === undefined) return;
    let color: Rgb = colors[light.state];
    if (light.state === 'attention' && !pulseOn) color = scale(color, PULSE_LOW);
    if (light.selected) color = colors.selected;
    if (light.error) color = colors.error;
    frame[index] = color;
  });
  const record = ledIndex(profile.controls.record);
  if (recording && record !== undefined) frame[record] = colors.record;
  if (send !== 'none') for (const index of WHEEL_LEDS) frame[index] = send === 'ready' ? colors.sendReady : colors.sendBlocked;
  return frame.map(([r, g, b]) => [r, g, b] as const);
}
