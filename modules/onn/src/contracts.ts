import type {CommandGuards} from '@jimmie-potts/event-contracts/v2/devices';
import type {Ticket} from '@jimmie-potts/event-contracts/v2';
import type {App, CurrentApp, Key} from './actions.js';
export const FAMILIES = ['onn-key-press', 'onn-app-open', 'onn-text'] as const;
export type Family = typeof FAMILIES[number];
export const types: Readonly<Record<Family, string>> = {'onn-key-press': 'org.bunny.onn-key.press.requested', 'onn-app-open': 'org.bunny.onn-app.open.requested', 'onn-text': 'org.bunny.onn.text.requested'};
export const schemaOf = (family: string): string => `https://bunny.invalid/events/${family}/2.0`;
export type Input = CommandGuards & ({key: Key} | {app: App} | {text: string});
export type OnnState = {
  id: string; revision: number; configurationRevision: number; generation: Ticket;
  connection: 'unknown' | 'available' | 'unavailable';
  currentApp: {status: 'unknown'} | {status: 'known'; value: CurrentApp; observedAtMs: number};
  controls: {keys: readonly Key[]; apps: readonly App[]; text: {maximum: 256; alphabet: 'ascii-letters-digits-space-dot-underscore-hyphen'}};
};
