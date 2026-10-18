// Device owners, operations and playback share the dashboard's existing participant; no second connection or polling.
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {PlaybackLayoutRecord, LightingLayoutRecord, InboxItem, PowerLimitRecord, ModeState, OperationRecord, PlaybackState} from '@jimmie-potts/event-contracts/v2/families';
import type {LifxLight} from '@jimmie-potts/lifx';
import type {WallRecord} from '@jimmie-potts/nanoleaf/frontend';
import type {Diagnostic, RemoteParticipant, Scheduler, SyncChange, SyncedCopy} from '@jimmie-potts/sdk/remote';
import {mayControl, moduleOwner, readModules, type ModuleEntry} from './modules.ts';
export type RuntimeRecord = DeviceRecord | OperationRecord | PlaybackState | ModeState | InboxItem | PowerLimitRecord | LightingLayoutRecord | PlaybackLayoutRecord | LifxLight | WallRecord;
export type RuntimeCopy = {owner: string; family: 'device' | 'operation' | 'playback' | 'mode' | 'inbox-item' | 'power-limit' | 'lighting-layout' | 'playback-layout' | 'lifx-light' | 'nanoleaf-wall'; synced: boolean; records: readonly RuntimeRecord[]; refused?: string};
export type RuntimeData = {modules: readonly ModuleEntry[] | undefined; control: boolean; copies: readonly RuntimeCopy[]; catalogFailed: boolean};
type Follow = {state: RuntimeCopy; copy?: SyncedCopy<RuntimeRecord> | undefined; epoch: number; retryMs: number; cancel: () => void};

export class RuntimeFeeds {
  #participant: RemoteParticipant | undefined;
  #closed = false;
  #follows: Follow[] = [];
  #state: RuntimeData = {modules: undefined, control: false, copies: [], catalogFailed: false};
  readonly #scheduler: Scheduler;
  readonly #changed: (state: RuntimeData) => void;
  readonly #ended: () => void;
  #catalogCancel: () => void = () => {};
  constructor(scheduler: Scheduler, changed: (state: RuntimeData) => void, ended: () => void) {
    this.#scheduler = scheduler; this.#changed = changed; this.#ended = ended;
  }
  async start(participant: RemoteParticipant): Promise<void> {
    this.#participant = participant;
    try {
      const [modules, control] = await Promise.all([readModules(), mayControl()]);
      if (this.#closed) return;
      this.#state = {...this.#state, modules, control, catalogFailed: false};
      this.#follows = modules.flatMap(module => module.serves.flatMap(family => family === 'device' || family === 'operation' || family === 'playback' || family === 'mode' || family === 'inbox-item' || family === 'power-limit'
        || ((family === 'lighting-layout' || family === 'playback-layout') && module.name === 'core') || (family === 'lifx-light' && module.name === 'lifx') || (family === 'nanoleaf-wall' && module.name === 'nanoleaf')
        ? [{state: {owner: moduleOwner(module.name), family, synced: false, records: []}, epoch: 0, retryMs: 1000, cancel: () => {}}] : []));
      this.#show();
      await Promise.all(this.#follows.map(follow => this.#sync(follow)));
    } catch {
      if (this.#closed) return;
      this.#state = {...this.#state, catalogFailed: true}; this.#show();
      this.#catalogCancel = this.#scheduler.after(5000, () => { void this.start(participant); });
    }
  }
  close(): void {
    this.#closed = true; this.#catalogCancel();
    for (const follow of this.#follows) { follow.cancel(); void follow.copy?.close(); }
  }
  hear(diagnostic: Diagnostic): void {
    if (diagnostic.event === 'remote.disconnected') {
      for (const follow of this.#follows) follow.state = {...follow.state, synced: false};
      this.#show();
    } else if (diagnostic.event === 'sync.restarted') {
      // The SDK names the family, not the owner, on overflow. Replace each same-family copy so none stays falsely fresh.
      for (const follow of this.#follows) if (diagnostic.pattern === undefined || diagnostic.pattern === `sync ${follow.state.family}`) {
        follow.state = {...follow.state, synced: false};
        void this.#sync(follow);
      }
      this.#show();
    }
  }
  /** Explicit refresh changes only current copies; it sends no command and never replays an attempt. */
  async refresh(required?: readonly {owner: string; family: RuntimeCopy['family']}[]): Promise<boolean> {
    if (this.#closed || this.#participant === undefined) return false;
    const follows = required === undefined ? this.#follows : this.#follows.filter(follow => required.some(copy => copy.owner === follow.state.owner && copy.family === follow.state.family));
    if (required?.some(copy => !follows.some(follow => copy.owner === follow.state.owner && copy.family === follow.state.family)) === true) return false;
    const results = await Promise.all(follows.map(follow => this.#sync(follow)));
    return !this.#closed && results.every(Boolean);
  }
  async #sync(follow: Follow): Promise<boolean> {
    const participant = this.#participant;
    if (participant === undefined || this.#closed) return false;
    const epoch = ++follow.epoch;
    follow.cancel(); await follow.copy?.close(); follow.copy = undefined;
    follow.state = {...follow.state, synced: false}; this.#show();
    const current = (): boolean => !this.#closed && follow.epoch === epoch;
    const show = (): void => {
      if (!current() || follow.copy === undefined) return;
      follow.state = {owner: follow.state.owner, family: follow.state.family, synced: true, records: follow.copy.states().map(message => message.data)};
      this.#show();
    };
    const failed = (code: string): void => {
      if (!current()) return;
      if (code === 'unauthenticated' || code === 'forbidden') { this.#ended(); return; }
      follow.state = {...follow.state, synced: false, refused: code}; this.#show();
      follow.cancel = this.#scheduler.after(follow.retryMs, () => { void this.#sync(follow); });
      follow.retryMs = Math.min(30_000, follow.retryMs * 2);
    };
    try {
      const result = await participant.sync<RuntimeRecord>([follow.state.family], (change: SyncChange<RuntimeRecord>) => {
        if (change.type === 'failed') failed(change.error.error.code); else show();
      }, {owner: follow.state.owner, timeoutMs: 5000});
      if (result.status === 'rejected') { failed(result.error.error.code); return false; }
      if (!current()) { await result.copy.close(); return false; }
      follow.copy = result.copy; follow.retryMs = 1000; show(); return true;
    } catch { failed('unavailable'); return false; }
  }
  #show(): void { this.#state = {...this.#state, copies: this.#follows.map(follow => follow.state)}; this.#changed(this.#state); }
}
