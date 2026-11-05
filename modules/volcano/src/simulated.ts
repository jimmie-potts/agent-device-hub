// A synthetic VOLCANO HYBRID for the scenario harnesses: it has no radio and produces the snapshots a collector would. An
// action comes from a test host, never a gateway command, and nothing in the module can act on it.
import {randomUUID} from 'node:crypto';
import type {VolcanoFeed, VolcanoObservation, VolcanoLink} from '@jimmie-potts/event-contracts/v2/families';
import {FAHRENHEIT_BIT, HEATER_BIT, PUMP_BIT} from './facts.js';
import type {SyntheticFeed} from './module.js';

export const SIMULATION_ACTIONS = ['online', 'offline', 'heater-on', 'heater-off', 'pump-on', 'pump-off', 'setpoint', 'tick', 'counter-reset', 'other-device', 'collector-absent'] as const;
export type SimulationAction = typeof SIMULATION_ACTIONS[number];

export class SimulatedVolcano implements SyntheticFeed {
  readonly #epoch = randomUUID();
  #sequence = 0;
  #observedAtMs = 0;
  #link: VolcanoLink = 'connected';
  #absent = false;
  #heater = false;
  #pump = false;
  #targetDeciC = 1850;
  #currentDeciC = 400;
  #minutes = 725;
  readonly #listeners = new Set<() => void>();

  /** Applies one action and tells the module's feed. `deciC` is for `setpoint`. */
  act(action: SimulationAction, deciC?: number): void {
    switch (action) {
      case 'online': this.#link = 'connected'; this.#absent = false; break;
      case 'offline': this.#link = 'disconnected'; break;
      case 'heater-on': this.#heater = true; break;
      case 'heater-off': this.#heater = false; break;
      case 'pump-on': this.#pump = true; break;
      case 'pump-off': this.#pump = false; break;
      case 'setpoint': this.#targetDeciC = deciC ?? this.#targetDeciC; break;
      case 'tick': this.#minutes += 1; this.#currentDeciC += 50; break;
      case 'counter-reset': this.#minutes = 3; break;
      case 'other-device': this.#link = 'identity-mismatch'; break;
      case 'collector-absent': this.#absent = true; break;
    }
    for (const listener of this.#listeners) listener();
  }

  state(): object {
    return {link: this.#link, absent: this.#absent, heater: this.#heater, pump: this.#pump, targetDeciC: this.#targetDeciC, counterMinutes: this.#minutes};
  }

  snapshot(feed: VolcanoFeed, nowMs: number): VolcanoObservation | undefined {
    if (this.#absent) return undefined;
    this.#sequence += 1;
    // A harness's clock may stand still between two actions, and a collector's snapshots always move on.
    this.#observedAtMs = Math.max(nowMs, this.#observedAtMs + 1);
    return {
      feed, observedAtMs: this.#observedAtMs, collectorEpoch: this.#epoch, sequence: this.#sequence, link: this.#link,
      reading: this.#link !== 'connected' ? null : {
        status1: 0x0603 | (this.#heater ? HEATER_BIT : 0) | (this.#pump ? PUMP_BIT : 0), status2: FAHRENHEIT_BIT, currentDeciC: this.#currentDeciC, targetDeciC: this.#targetDeciC,
        heatingHours: Math.floor(this.#minutes / 60), heatingMinutes: this.#minutes % 60,
      },
    };
  }

  observe(feed: VolcanoFeed, nowMs: number): Promise<VolcanoObservation | undefined> {
    return Promise.resolve(this.snapshot(feed, nowMs));
  }

  onChange(changed: () => void): () => void {
    this.#listeners.add(changed);
    return () => { this.#listeners.delete(changed); };
  }
}
