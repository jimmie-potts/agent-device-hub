/**
 * The visualizer's effect choice (#1619, owner decision 2026-11-10): a per-viewer preference kept in this browser. It is
 * not a shared saved setting and has no message format. Storage may be missing or refuse access; the choice then lasts
 * for the page only.
 */
import {defaultEffect, visualizerEffects} from './music-visualizer-effects.ts';
import type {VisualizerEffect} from './music-visualizer-model.ts';

export const EFFECT_CHOICE_KEY = 'bunny.music-visualizer.effect';
type ChoiceStorage = Pick<Storage, 'getItem' | 'setItem'>;

export class EffectChoiceStore {
  readonly #storage: () => ChoiceStorage;
  readonly #effects: readonly VisualizerEffect[];
  readonly #listeners = new Set<() => void>();
  #choice: string;
  constructor(storage: () => ChoiceStorage, effects: readonly VisualizerEffect[] = visualizerEffects) {
    this.#storage = storage; this.#effects = effects;
    let saved: string | null = null;
    try {saved = storage().getItem(EFFECT_CHOICE_KEY);} catch {/* Storage is unavailable; use the default. */}
    this.#choice = this.#known(saved) ? saved : this.#effects[0]?.id ?? defaultEffect.id;
  }
  readonly getSnapshot = (): string => this.#choice;
  readonly subscribe = (listener: () => void): (() => void) => {this.#listeners.add(listener); return () => {this.#listeners.delete(listener);};};
  choose(id: string): void {
    if (!this.#known(id) || id === this.#choice) return;
    this.#choice = id;
    try {this.#storage().setItem(EFFECT_CHOICE_KEY, id);} catch {/* The choice still applies to this page. */}
    this.#notify();
  }
  /** Follows a choice made in another tab of this browser. */
  storageChanged(key: string | null, value: string | null): void {
    if (key !== EFFECT_CHOICE_KEY || !this.#known(value) || value === this.#choice) return;
    this.#choice = value; this.#notify();
  }
  #known(id: string | null): id is string {return id !== null && this.#effects.some(effect => effect.id === id);}
  #notify(): void {for (const listener of this.#listeners) listener();}
}
