import { readFile } from 'node:fs/promises';
import { systemClock, type Clock } from '../clock.js';
import type { Client } from '../os-adapter.js';
import { HOST_SESSION_ID, type FeedSession } from './feed.js';
import { writePrivateFileAtomic } from './files.js';

/**
 * Task slots: the 15 lower keys, assigned first-free and kept until explicit archive evidence or the Claude release
 * gesture. The store is the bridge's own private file, separate from Hub retention; Hub retirement, expiry, idle and a
 * stale feed never free a slot.
 */
export const SLOT_COUNT = 15;
export const SLOT_STATE_VERSION = 1;
const MAX_RELEASED = 256;

/** A task the feed offers for a slot. `taskId` is the Codex thread ID or the Claude Desktop `local_<id>`. */
export interface SlotTask {
  client: Client;
  provider: 'codex' | 'claude';
  hubClient: 'desktop' | 'code';
  hostId: string;
  sourceId: string;
  taskId: string;
  /** The newest Hub session ID seen for the task (for Claude it changes on `/clear`). */
  sessionId: string;
  title: string | null;
  lastEvidenceAtMs: number;
}

export interface SlotRecord {
  slot: number;
  client: Client;
  provider: 'codex' | 'claude';
  hubClient: 'desktop' | 'code';
  hostId: string;
  sourceId: string;
  taskId: string;
  sessionId: string;
  /** Last-known Hub title; Codex verification's fallback name when Codex has never named the thread. */
  title: string | null;
  assignedAt: number;
}

/** A released task stays out of the slots until it shows lifecycle evidence newer than its release. */
interface Released { provider: 'codex' | 'claude'; hubClient: 'desktop' | 'code'; hostId: string; sourceId: string; taskId: string; evidenceAtMs: number }

export type SlotReleaseReason = 'codex-archived' | 'claude-archived' | 'release-gesture';

export class SlotStateError extends Error {
  readonly code = 'invalid-slot-state';
}

const CODEX_ID = /^[A-Za-z0-9-]{1,128}$/;
const HUB_ID = /^[A-Za-z0-9_.-]{1,128}$/;

type Keyed = Pick<SlotTask, 'provider' | 'hubClient' | 'hostId' | 'sourceId' | 'taskId'>;
/** The full qualified identity of a slot's task. */
export const slotKey = (task: Keyed): string => [task.provider, task.hubClient, task.hostId, task.sourceId, task.taskId].join('\u0000');
const order = (a: Keyed, b: Keyed): number => {
  for (const field of ['provider', 'hubClient', 'hostId', 'sourceId', 'taskId'] as const) {
    if (a[field] !== b[field]) return a[field] < b[field] ? -1 : 1;
  }
  return 0;
};
const newer = (a: FeedSession, b: FeedSession): number =>
  b.lastEvidenceAtMs - a.lastEvidenceAtMs || (a.identity.sessionId < b.identity.sessionId ? 1 : a.identity.sessionId > b.identity.sessionId ? -1 : 0);

function taskOf(session: FeedSession): SlotTask | undefined {
  const { identity } = session;
  if (!session.root) return undefined;
  if (identity.provider === 'codex' && identity.client === 'desktop' && CODEX_ID.test(identity.sessionId)) {
    return { client: 'codex', provider: 'codex', hubClient: 'desktop', hostId: identity.hostId, sourceId: identity.sourceId, taskId: identity.sessionId,
      sessionId: identity.sessionId, title: session.title, lastEvidenceAtMs: session.lastEvidenceAtMs };
  }
  if (identity.provider === 'claude' && identity.client === 'code' && session.hostSessionId !== null) {
    return { client: 'claude', provider: 'claude', hubClient: 'code', hostId: identity.hostId, sourceId: identity.sourceId, taskId: session.hostSessionId,
      sessionId: identity.sessionId, title: session.title, lastEvidenceAtMs: session.lastEvidenceAtMs };
  }
  return undefined;
}

/**
 * Root Codex Desktop threads and root Claude Desktop sessions with a Desktop ID, one per qualified task (the newest
 * Hub record wins), in the deterministic slot order: provider, client, host, source, task ID.
 */
export function candidatesFromSessions(sessions: readonly FeedSession[]): SlotTask[] {
  const byKey = new Map<string, { task: SlotTask; session: FeedSession }>();
  for (const session of sessions) {
    const task = taskOf(session);
    if (!task) continue;
    const key = slotKey(task);
    const existing = byKey.get(key);
    if (!existing || newer(session, existing.session) < 0) byKey.set(key, { task, session });
  }
  return [...byKey.values()].map(entry => entry.task).sort(order);
}

/**
 * The Hub records for a slot, newest first. A Claude record that lost its Desktop ID (after a Hub restart, until its
 * next event) still matches by the last Hub session ID the slot saw.
 */
export function sessionsForSlot(record: SlotRecord, sessions: readonly FeedSession[]): FeedSession[] {
  return sessions.filter(session => {
    const { identity } = session;
    if (!session.root || identity.provider !== record.provider || identity.client !== record.hubClient
      || identity.hostId !== record.hostId || identity.sourceId !== record.sourceId) return false;
    if (record.client === 'codex') return identity.sessionId === record.taskId;
    return session.hostSessionId === record.taskId || (session.hostSessionId === null && identity.sessionId === record.sessionId);
  }).sort(newer);
}

export interface SlotStoreOptions {
  clock?: Clock;
  /** Called when persisting fails; the in-memory slots stay authoritative and the next change retries. */
  onWriteError?: (error: Error) => void;
}

export class SlotStore {
  readonly #path: string;
  readonly #clock: Clock;
  readonly #onWriteError: ((error: Error) => void) | undefined;
  readonly #slots = new Map<number, SlotRecord>();
  #released: Released[] = [];
  #overflow: SlotTask[] = [];
  #candidates: SlotTask[] = [];
  #dirty = false;
  #writing: Promise<void> | undefined;
  #writeError: Error | undefined;

  private constructor(path: string, options: SlotStoreOptions) {
    this.#path = path;
    this.#clock = options.clock ?? systemClock;
    this.#onWriteError = options.onWriteError;
  }

  /** Loads the slot file, or starts empty when it does not exist. An unreadable or invalid file throws `SlotStateError`. */
  static async open(path: string, options: SlotStoreOptions = {}): Promise<SlotStore> {
    const store = new SlotStore(path, options);
    let text: string | undefined;
    try {
      text = await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new SlotStateError(`slot state unreadable: ${(error as NodeJS.ErrnoException).code ?? 'error'}`);
    }
    if (text !== undefined) store.#load(text);
    return store;
  }

  entries(): SlotRecord[] { return [...this.#slots.values()].sort((a, b) => a.slot - b.slot).map(record => ({ ...record })); }
  get(slot: number): SlotRecord | undefined { const record = this.#slots.get(slot); return record && { ...record }; }
  /** Tasks the last reconcile could not place, in slot order. */
  overflow(): SlotTask[] { return this.#overflow.map(task => ({ ...task })); }

  /**
   * Places the feed's tasks: assigned keys never move, new keys take the lowest free slots in sort order, and the rest
   * become overflow. Assigned slots refresh their session ID and, when known, their title.
   */
  reconcile(candidates: readonly SlotTask[]): { assigned: SlotRecord[]; overflow: SlotTask[] } {
    this.#candidates = [...candidates].sort(order);
    const byKey = new Map([...this.#slots.values()].map(record => [slotKey(record), record]));
    const assigned: SlotRecord[] = [];
    const overflow: SlotTask[] = [];
    let changed = false;
    for (const task of this.#candidates) {
      const key = slotKey(task);
      const record = byKey.get(key);
      if (record) {
        if (record.sessionId !== task.sessionId) { record.sessionId = task.sessionId; changed = true; }
        if (task.title !== null && record.title !== task.title) { record.title = task.title; changed = true; }
        continue;
      }
      const released = this.#released.findIndex(entry => slotKey(entry) === key);
      if (released >= 0) {
        if (task.lastEvidenceAtMs <= this.#released[released]!.evidenceAtMs) continue;
        this.#released.splice(released, 1);
        changed = true;
      }
      const slot = this.#lowestFree();
      if (slot === undefined) { overflow.push(task); continue; }
      const { lastEvidenceAtMs: _, ...fields } = task;
      const placed: SlotRecord = { ...fields, slot, assignedAt: this.#clock.now() };
      this.#slots.set(slot, placed);
      byKey.set(key, placed);
      assigned.push({ ...placed });
      changed = true;
    }
    this.#overflow = overflow;
    if (changed) this.#markDirty();
    return { assigned, overflow: overflow.map(task => ({ ...task })) };
  }

  /** Frees a slot on explicit evidence. The task stays out until it shows newer lifecycle evidence. */
  release(slot: number, _reason: SlotReleaseReason): SlotRecord | undefined {
    const record = this.#slots.get(slot);
    if (!record) return undefined;
    this.#slots.delete(slot);
    const key = slotKey(record);
    const seen = this.#candidates.find(task => slotKey(task) === key);
    this.#released = this.#released.filter(entry => slotKey(entry) !== key);
    this.#released.push({ provider: record.provider, hubClient: record.hubClient, hostId: record.hostId, sourceId: record.sourceId, taskId: record.taskId,
      evidenceAtMs: seen?.lastEvidenceAtMs ?? this.#clock.now() });
    if (this.#released.length > MAX_RELEASED) this.#released.splice(0, this.#released.length - MAX_RELEASED);
    this.#markDirty();
    return { ...record };
  }

  /** Waits until every change is on disk; rethrows the last write failure. */
  async flush(): Promise<void> {
    while (this.#writing) await this.#writing;
    const error = this.#writeError;
    this.#writeError = undefined;
    if (error) throw error;
  }

  #lowestFree(): number | undefined {
    for (let slot = 1; slot <= SLOT_COUNT; slot++) if (!this.#slots.has(slot)) return slot;
    return undefined;
  }

  #markDirty(): void {
    this.#dirty = true;
    this.#writing ??= this.#drain();
  }

  async #drain(): Promise<void> {
    try {
      while (this.#dirty) {
        this.#dirty = false;
        try {
          await writePrivateFileAtomic(this.#path, this.#serialize());
          this.#writeError = undefined;
        } catch (error) {
          this.#writeError = error as Error;
          this.#onWriteError?.(error as Error);
        }
      }
    } finally {
      this.#writing = undefined;
    }
  }

  #serialize(): string {
    return `${JSON.stringify({ schemaVersion: SLOT_STATE_VERSION, slots: this.entries(), released: this.#released }, null, 2)}\n`;
  }

  #load(text: string): void {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new SlotStateError('slot state is not JSON');
    }
    const fail = (message: string): never => { throw new SlotStateError(`slot state ${message}`); };
    if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('must be an object');
    const state = value as Record<string, unknown>;
    if (state.schemaVersion !== SLOT_STATE_VERSION) fail('has an unsupported schemaVersion');
    if (Object.keys(state).some(key => !['schemaVersion', 'slots', 'released'].includes(key))) fail('has an unknown field');
    if (!Array.isArray(state.slots) || state.slots.length > SLOT_COUNT) fail('slots must be an array of at most 15');
    const keys = new Set<string>();
    for (const [i, entry] of (state.slots as unknown[]).entries()) {
      const record = validRecord(entry);
      if (!record) fail(`slots[${i}] is invalid`);
      if (this.#slots.has(record!.slot) || keys.has(slotKey(record!))) fail(`slots[${i}] repeats a slot or task`);
      this.#slots.set(record!.slot, record!);
      keys.add(slotKey(record!));
    }
    const released = state.released ?? [];
    if (!Array.isArray(released) || released.length > MAX_RELEASED) fail('released must be an array of at most 256');
    for (const [i, entry] of (released as unknown[]).entries()) {
      const item = validReleased(entry);
      if (!item) fail(`released[${i}] is invalid`);
      this.#released.push(item!);
    }
  }
}

const RECORD_FIELDS = ['slot', 'client', 'provider', 'hubClient', 'hostId', 'sourceId', 'taskId', 'sessionId', 'title', 'assignedAt'];

function validTask(value: Record<string, unknown>): boolean {
  const codex = value.provider === 'codex' && value.hubClient === 'desktop' && typeof value.taskId === 'string' && CODEX_ID.test(value.taskId);
  const claude = value.provider === 'claude' && value.hubClient === 'code' && typeof value.taskId === 'string' && HOST_SESSION_ID.test(value.taskId);
  return (codex || claude) && [value.hostId, value.sourceId].every(id => typeof id === 'string' && HUB_ID.test(id));
}

function validRecord(entry: unknown): SlotRecord | undefined {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return undefined;
  const value = entry as Record<string, unknown>;
  if (Object.keys(value).length !== RECORD_FIELDS.length || !RECORD_FIELDS.every(field => field in value)) return undefined;
  if (!Number.isInteger(value.slot) || (value.slot as number) < 1 || (value.slot as number) > SLOT_COUNT) return undefined;
  if (value.client !== value.provider || !validTask(value)) return undefined;
  if (typeof value.sessionId !== 'string' || !HUB_ID.test(value.sessionId)) return undefined;
  if (value.title !== null && (typeof value.title !== 'string' || value.title.length === 0 || [...value.title].length > 160)) return undefined;
  if (!Number.isSafeInteger(value.assignedAt) || (value.assignedAt as number) < 0) return undefined;
  return value as unknown as SlotRecord;
}

function validReleased(entry: unknown): Released | undefined {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return undefined;
  const value = entry as Record<string, unknown>;
  const fields = ['provider', 'hubClient', 'hostId', 'sourceId', 'taskId', 'evidenceAtMs'];
  if (Object.keys(value).length !== fields.length || !fields.every(field => field in value)) return undefined;
  if (!validTask(value) || !Number.isSafeInteger(value.evidenceAtMs) || (value.evidenceAtMs as number) < 0) return undefined;
  return value as unknown as Released;
}
