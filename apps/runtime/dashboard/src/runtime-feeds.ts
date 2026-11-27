import type {ArtScheduleRecord} from '@jimmie-potts/event-contracts/v2/art-schedule';
import {FAMILY as PRESENCE_FAMILY, type PresenceObservation} from '@jimmie-potts/presence-pro/contracts';
// Device owners, operations and playback share the dashboard's existing participant; no second connection or polling.
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {HomeLayoutRecord, PlaybackLayoutRecord, LightingLayoutRecord, InboxItem, PowerLimitRecord, ModeState, OperationRecord, PlaybackState} from '@jimmie-potts/event-contracts/v2/families';
import type {LifxLight} from '@jimmie-potts/lifx';
import type {WallRecord} from '@jimmie-potts/nanoleaf/frontend';
import type {Diagnostic, RemoteParticipant, Scheduler, SyncChange, SyncedCopy} from '@jimmie-potts/sdk/remote';
import {mayControl, moduleOwner, readModules, type ModuleEntry} from './modules.ts';
import type {Route} from './routes.ts';
export type RuntimeRecord = ArtScheduleRecord | HomeLayoutRecord | DeviceRecord | OperationRecord | PlaybackState | ModeState | InboxItem | PowerLimitRecord | LightingLayoutRecord | PlaybackLayoutRecord | LifxLight | WallRecord | PresenceObservation;
export type RuntimeCopy = {owner: string; family: 'art-schedule' | 'device' | 'operation' | 'playback' | 'mode' | 'inbox-item' | 'power-limit' | 'lighting-layout' | 'home-layout' | 'playback-layout' | 'lifx-light' | 'nanoleaf-wall' | typeof PRESENCE_FAMILY; synced: boolean; records: readonly RuntimeRecord[]; refused?: string};
export type RuntimeData = {modules: readonly ModuleEntry[] | undefined; control: boolean; copies: readonly RuntimeCopy[]; catalogFailed: boolean};

/**
 * Whether the page holds a current copy of every owner's records it follows: `loading` until the catalog is read,
 * `syncing` while any copy waits for its sync, `synced` once every copy has one, and `unavailable` when the catalog
 * could not be read. The shell shows it on the page's main region, beside the feed.
 */
export type CopiesState = 'loading' | 'syncing' | 'synced' | 'unavailable';
export const copiesState = (runtime: RuntimeData): CopiesState =>
  runtime.catalogFailed ? 'unavailable' : runtime.modules === undefined ? 'loading' : runtime.copies.every(copy => copy.synced) ? 'synced' : 'syncing';

/**
 * Whether the page at a route cannot yet be told apart from a missing one: a module or brand page waits for the
 * catalog, and a device or playback page also for the device and playback copies. Until then the shell says it is
 * loading, not that nothing is at the address (#1919). A copy its owner refused decides nothing more by waiting.
 */
export function awaitsRecords(route: Route, runtime: RuntimeData): boolean {
  if (runtime.catalogFailed) return false;
  if (route.kind === 'module' || route.kind === 'lighting-brand') return runtime.modules === undefined;
  if (route.kind !== 'component' && route.kind !== 'playback') return false;
  return runtime.modules === undefined || runtime.copies.some(copy => (copy.family === 'device' || copy.family === 'playback') && !copy.synced && copy.refused === undefined);
}
type Follow = {state: RuntimeCopy; copy?: SyncedCopy<RuntimeRecord> | undefined; epoch: number; completionRequired: boolean; retryMs: number; cancel: () => void};

export class RuntimeFeeds {
  #participant: RemoteParticipant | undefined;
  #closed = false;
  #disconnected = false;
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
        || ((family === 'art-schedule' || family === 'lighting-layout' || family === 'playback-layout' || family === 'home-layout') && module.name === 'core') || (family === 'lifx-light' && module.name === 'lifx') || (family === 'nanoleaf-wall' && module.name === 'nanoleaf') || (family === PRESENCE_FAMILY && module.name === 'presence-pro')
        ? [{state: {owner: moduleOwner(module.name), family, synced: false, records: []}, epoch: 0, completionRequired: false, retryMs: 1000, cancel: () => {}}] : []));
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
    if (this.#closed) return;
    if (diagnostic.event === 'remote.reconnected') this.#disconnected = false;
    if (diagnostic.event !== 'remote.disconnected') return;
    this.#disconnected = true;
    for (const follow of this.#follows) {
      follow.completionRequired = true;
      follow.state = {...follow.state, synced: false};
    }
    this.#show();
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
    // Stale at once: closing the replaced copy waits for the edge, and its records must not stay current meanwhile.
    follow.cancel(); follow.completionRequired = this.#disconnected; follow.state = {...follow.state, synced: false}; this.#show();
    const replaced = follow.copy; follow.copy = undefined; await replaced?.close();
    let refused = false;
    const current = (): boolean => !this.#closed && !refused && follow.epoch === epoch;
    const show = (): void => {
      if (!current() || follow.completionRequired || follow.copy === undefined) return;
      follow.state = {owner: follow.state.owner, family: follow.state.family, synced: true, records: follow.copy.states().map(message => message.data)};
      this.#show();
    };
    const failed = (code: string): void => {
      if (!current()) return;
      refused = true;
      if (code === 'unauthenticated' || code === 'forbidden') { this.#ended(); return; }
      follow.state = {...follow.state, synced: false, refused: code}; this.#show();
      follow.cancel = this.#scheduler.after(follow.retryMs, () => { void this.#sync(follow); });
      follow.retryMs = Math.min(30_000, follow.retryMs * 2);
    };
    try {
      const result = await participant.sync<RuntimeRecord>([follow.state.family], (change: SyncChange<RuntimeRecord>) => {
        if (!current()) return;
        if (change.type === 'failed') { failed(change.error.error.code); return; }
        if (change.type === 'synced' && !this.#disconnected) follow.completionRequired = false;
        show();
      }, {owner: follow.state.owner, timeoutMs: 5000, onRestarted: () => {
        if (!current()) return;
        follow.completionRequired = true;
        if (!follow.state.synced) return;
        follow.state = {...follow.state, synced: false};
        this.#show();
      }});
      if (result.status === 'rejected') { failed(result.error.error.code); return false; }
      if (!current()) { await result.copy.close(); return false; }
      follow.copy = result.copy; follow.retryMs = 1000; show(); return follow.state.synced;
    } catch { failed('unavailable'); return false; }
  }
  #show(): void { this.#state = {...this.#state, copies: this.#follows.map(follow => follow.state)}; this.#changed(this.#state); }
}
