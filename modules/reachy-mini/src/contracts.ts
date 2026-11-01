import type {CommandGuards, CompletedOutcome, DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {Ticket} from '@jimmie-potts/event-contracts/v2';
export const gestures = ['notice', 'attention', 'neutral'] as const;
export type Gesture = typeof gestures[number];
export const controls = ['enable-auto', 'disable-auto', 'takeover', 'resume-auto'] as const;
export type Control = typeof controls[number];
export const families = ['reachy-gesture', 'reachy-stop', 'reachy-control', 'reachy-auto'] as const;
export type Family = typeof families[number];
export const schemaOf = (family: string): string => `https://bunny.invalid/events/${family}/2.0`;
export const typeOf = (family: string): string => `org.bunny.reachy.${family.slice(7)}.requested`;
export type Guards = CommandGuards & {heldRequestId?: string; recovered?: true; validUntilMs?: number};
export type Observation = {antennas: [number, number]};
export type Active = {requestId: string; gesture: Gesture; moveId: string | null; automatic: boolean};
export type Hold = {requestId: string; heldAtMs: number; moveId: string | null};
export type ReachyState = {
  id: string; revision: number; configurationRevision: number; generation: Ticket;
  simulated: true; connection: 'unknown' | 'available' | 'unavailable' | 'stale' | 'mismatch';
  enabled: boolean; takeover: boolean; observation: null | (Observation & {observedAtMs: number});
  active: Active | null; pending: number; held: Hold | null; lastOutcome: CompletedOutcome | null; lastTransmission: DeviceRecord['lastTransmission'];
};
export const stages = (gesture: Gesture): readonly [number, number][] =>
  gesture === 'neutral' ? [[0, 0]] : [gesture === 'notice' ? [.2, -.2] : [.2, .2], [0, 0]];
