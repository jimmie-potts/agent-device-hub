// Read-only Audio-page scope for Music lighting (#722): the core's per-light session records and the Nanoleaf module's
// saved reactive presets, both over the shell's existing participant. Opening, refreshing or closing sends no command.
import type {LightingState} from '@jimmie-potts/event-contracts/v2/music-lighting-data';
import type {ReactiveCatalogView, ReactiveSync} from '@jimmie-potts/nanoleaf/reactive-presets';
import type {RemoteParticipant, SyncedCopy} from '@jimmie-potts/sdk/remote';
import {lightingRecord} from './music-lighting-model.ts';

export const NANOLEAF_OWNER = 'bunny/modules/nanoleaf';
export type MusicLightingView = {synced: boolean; records: readonly LightingState[]; presets: ReactiveCatalogView};
/** The Wall page's own catalog follower, `followReactivePresets`, supplied by the page that bundles it. */
export type PresetFollower = (sync: ReactiveSync, show: (view: ReactiveCatalogView) => void, retained?: ReactiveCatalogView['value']) => () => void;
type LightingParticipant = Pick<RemoteParticipant, 'sync'>;

export class MusicLightingFeed {
  #view: MusicLightingView = {synced: false, records: [], presets: {value: undefined, live: false, pending: true, failed: false}};
  readonly #listeners = new Set<() => void>();
  readonly #participant: LightingParticipant;
  readonly #follow: PresetFollower;
  readonly #onClosed: () => void;
  #copy: SyncedCopy<LightingState> | undefined;
  #presets: () => void = () => {};
  #epoch = 0;
  #closed = false;
  constructor({participant, follow, onClosed = () => {}}: {participant: LightingParticipant; follow: PresetFollower; onClosed?: () => void}) {
    this.#participant = participant; this.#follow = follow; this.#onClosed = onClosed;
  }
  readonly getSnapshot = (): MusicLightingView => this.#view;
  readonly subscribe = (listener: () => void): (() => void) => {this.#listeners.add(listener); return () => {this.#listeners.delete(listener);};};

  /** One explicit read of both copies. A failed read leaves the view stale until the next explicit refresh. */
  async refresh(): Promise<boolean> {
    if (this.#closed) return false;
    const epoch = ++this.#epoch;
    const current = (): boolean => !this.#closed && this.#epoch === epoch;
    this.#update({synced: false});
    this.#presets();
    // The replaced copy closes in the background: its close waits for the edge, and the card keeps Refresh disabled until
    // this read settles. Its handler checks the epoch, so nothing it delivers meanwhile reaches the view.
    const previous = this.#copy; this.#copy = undefined; void previous?.close().catch(() => {});
    this.#presets = this.#follow((changed, options) => this.#participant.sync(['nanoleaf-reactive-presets'], changed, {...options, owner: NANOLEAF_OWNER, timeoutMs: 5000}),
      presets => {if (current()) this.#update({presets});}, this.#view.presets.value);
    let completed = false, restarted = false;
    try {
      const result = await this.#participant.sync<LightingState>(['music-lighting-state'], change => {
        if (!current()) return;
        if (change.type === 'failed') {completed = false; restarted = true; this.#update({synced: false}); return;}
        if (change.type === 'synced') {completed = true; this.#snapshot(true); return;}
        this.#snapshot(this.#view.synced);
      }, {owner: 'bunny/core', timeoutMs: 5000, onRestarted: () => {if (current()) {completed = false; restarted = true; this.#update({synced: false});}}});
      if (result.status === 'rejected') {if (current()) this.#update({synced: false}); return false;}
      if (!current()) {void result.copy.close().catch(() => {}); return false;}
      this.#copy = result.copy;
      this.#snapshot(completed || !restarted);
      return this.#view.synced;
    } catch {if (current()) this.#update({synced: false}); return false;}
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true; ++this.#epoch; this.#presets(); this.#update({synced: false}); this.#onClosed();
    const copy = this.#copy; this.#copy = undefined; await copy?.close();
  }

  /** Every record must be the core's own valid record; one that is not makes the whole copy unavailable. */
  #snapshot(qualified: boolean): void {
    if (this.#copy === undefined) return;
    const records = this.#copy.states().map(lightingRecord);
    if (records.some(record => record === undefined)) {this.#update({synced: false, records: []}); return;}
    this.#update({synced: qualified, records: (records as LightingState[]).sort((a, b) => a.id.localeCompare(b.id))});
  }
  #update(change: Partial<MusicLightingView>): void {
    this.#view = {...this.#view, ...change};
    for (const listener of this.#listeners) listener();
  }
}
