import { MAX_SUGGESTIONS, type NextSteps } from '../os-adapter.js';
import { PickerRefusal, type PickerEvent, type PickerResult } from './pickers.js';

/**
 * Claude's next-step suggestions (#907), as the 2026-10-06 qualification on #907 recorded them. The simulated desktop
 * and the router tests' fake adapter share this model, so both drive the same behavior:
 *
 * - After a turn, the `next-steps` mod shows a band above Claude's composer: a "next:" label, one button per suggestion
 *   and a "dismiss" button. The model holds only the suggestion buttons; "dismiss" is never a stop.
 * - The buttons take keyboard focus (`SetFocus`), which leaves the composer; `Invoke` on a suggestion writes its prompt
 *   into the composer as a draft. Here that happens only while the composer is empty, as the bridge's helper requires.
 * - Claude's ghost text (its own prompt suggestion, which with the mod is the top suggestion) is invisible to UI
 *   Automation: the empty composer reads as empty. A Right arrow into the focused, empty composer accepts it as the
 *   draft; a Right arrow anywhere else changes nothing here.
 * - Sending a message hides the band and the ghost text (the mod hides it on `turn.start`).
 * - With `lag` set, the read after each change returns the state from before it, once, as a lagging UI Automation view
 *   would.
 *
 * Suggestion text is synthetic and stays in the simulation: reads return counts and booleans only.
 */

/** Claude's composer as the band sees it. */
export interface SuggestionComposer {
  focused(): boolean;
  setFocused(focused: boolean): void;
  text(): string;
  setText(text: string): void;
}

/**
 * Whether a composer value counts as empty for the next-step knob: no text, or only one trailing line break. Claude's
 * empty composer reads as one `\n` (2026-10-06), and its ghost text never shows in the value.
 */
export function composerValueEmpty(value: string): boolean {
  return value === '' || value === '\n' || value === '\r\n';
}

export class SimSuggestions {
  /** When true, the read after each change returns the state from before it, once (a lagging UI Automation view). */
  lag = false;
  readonly #composer: SuggestionComposer;
  #labels: string[] = [];
  /** The suggestion holding keyboard focus; it loses focus whenever the composer takes it. */
  #focused: number | null = null;
  #ghost: string | null = null;
  #stale: NextSteps | undefined;

  constructor(composer: SuggestionComposer) { this.#composer = composer; }

  /** Shows a band of synthetic suggestions (at most `MAX_SUGGESTIONS`) and Claude's ghost text, by default the first. */
  show(labels: readonly string[], ghost: string | null = labels[0] ?? null): PickerEvent[] {
    return this.#change(() => {
      this.#labels = labels.slice(0, MAX_SUGGESTIONS).map(String);
      this.#focused = null;
      this.#ghost = ghost;
      return [{ action: 'show-suggestions', count: this.#labels.length }];
    });
  }

  /** Hides the band and the ghost text, as sending a message or the "dismiss" button does. */
  hide(): PickerEvent[] {
    return this.#change(() => {
      const shown = this.#labels.length > 0 || this.#ghost !== null;
      this.#labels = [];
      this.#focused = null;
      this.#ghost = null;
      return shown ? [{ action: 'hide-suggestions' }] : [];
    });
  }

  /** The composer took keyboard focus: no suggestion has it any more. */
  blur(): void {
    this.#change(() => { this.#focused = null; });
  }

  /** What the band shows, for the operator and the page; the labels are synthetic. */
  describe(): { labels: string[]; focused: number | null; ghost: string | null } {
    return { labels: [...this.#labels], focused: this.#current(), ghost: this.#ghost };
  }

  /** The `suggestionState` observation: counts and booleans only; with `lag`, the state from before the last change, once. */
  state(): NextSteps {
    const stale = this.#stale;
    if (stale) {
      this.#stale = undefined;
      return stale;
    }
    return this.#read();
  }

  /** `focusSuggestion`: moves keyboard focus to suggestion `index` of a band of `count`, out of the composer. */
  focus(index: number, count: number): PickerResult<number | null> {
    return this.#change(() => {
      this.#check(index, count);
      this.#focused = index;
      this.#composer.setFocused(false);
      return { value: index, composerFocused: false, events: [{ action: 'focus-suggestion', position: index + 1, count }] };
    });
  }

  /**
   * `invokeSuggestion`: writes suggestion `index` into the composer as a draft, only while it holds keyboard focus and the
   * composer is empty; `false`, with nothing done, otherwise. Focus stays on the button.
   */
  invoke(index: number, count: number): PickerResult<boolean> {
    return this.#change(() => {
      this.#check(index, count);
      if (this.#current() !== index || !composerValueEmpty(this.#composer.text())) return { value: false, events: [] };
      this.#composer.setText(this.#labels[index]);
      return { value: true, events: [{ action: 'fill-suggestion', position: index + 1, count }] };
    });
  }

  /** A Right arrow into Claude: accepts the ghost text into the focused, empty composer, or does nothing. */
  right(): PickerResult<boolean> {
    return this.#change(() => {
      if (this.#ghost === null || !this.#composer.focused() || !composerValueEmpty(this.#composer.text())) return { value: false, events: [] };
      this.#composer.setText(this.#ghost);
      this.#ghost = null;
      return { value: true, events: [{ action: 'accept-ghost' }] };
    });
  }

  #current(): number | null { return this.#composer.focused() ? null : this.#focused; }

  #read(): NextSteps {
    return {
      count: this.#labels.length, focused: this.#current(),
      composer: { focused: this.#composer.focused(), empty: composerValueEmpty(this.#composer.text()) },
    };
  }

  #check(index: number, count: number): void {
    if (this.#labels.length === 0) throw new PickerRefusal('band-absent');
    if (this.#labels.length !== count) throw new PickerRefusal('band-changed');
    if (!Number.isInteger(index) || index < 0 || index >= count) throw new PickerRefusal('invalid-suggestion-index');
  }

  /** Runs one change; with `lag`, the next read returns the state from before it. */
  #change<T>(change: () => T): T {
    const before = this.lag ? this.#read() : undefined;
    const result = change();
    if (before && JSON.stringify(before) !== JSON.stringify(this.#read())) this.#stale = before;
    return result;
  }
}
