// The status document's type, on its own so the browser entry can name it without reaching the module's store.
import type {LinkFact} from './facts.js';

export type VolcanoStatus = {
  schema: 'volcano-status/2.0'; id: string; revision: number; configurationRevision: number;
  availability: 'available' | 'unavailable'; link: LinkFact | 'unknown';
  observedAtMs: number | null; receivedAtMs: number | null; heater: 'on' | 'off' | 'unknown'; pump: 'on' | 'off' | 'unknown';
  status1: number | null; currentDeciC: number | null; targetDeciC: number | null; heatingCounterMinutes: number | null; displayFahrenheit: boolean | null;
  gapMinutes: number; recording: 'ok' | 'refused';
};
