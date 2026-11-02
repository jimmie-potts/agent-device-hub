import type {Identity} from '@jimmie-potts/event-contracts/v2/families';

export type CodexReadTarget = {identity: Identity; turnId: string; generation: number; noticeId: string};
export type AcceptedCodexRead = {target: CodexReadTarget; seenRevision: string; acceptedRevision: string; observedAtMs: number};
export type CodexObserverOptions = {
  bind: (threadId: string, turnId: string) => CodexReadTarget | undefined;
  accept: (receipt: AcceptedCodexRead) => void;
  now?: () => number;
};

const MAX_FRAME = 1024 * 1024, MAX_PENDING = 128, MAX_THREADS = 256, MAX_IDS = 65_536, TTL_MS = 30_000;
const token = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const fields = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const requestKey = (value: unknown): string | undefined => typeof value === 'number' && Number.isSafeInteger(value) ? `n:${value}`
  : typeof value === 'string' && value.length > 0 && value.length <= 128 ? `s:${value}` : undefined;
type Selection = {at: number; revision?: string; turnId?: string};
type Pending = {at: number} & (
  | {kind: 'initialize'}
  | {kind: 'snapshot' | 'selection'; threadId: string; selection: Selection}
  | {kind: 'read'; threadId: string; target: CodexReadTarget; seenRevision: string});

function unread(state: unknown): state is {revision: string; firstUnread: object} {
  if (!fields(state) || !token(state.revision) || !fields(state.firstUnread)) return false;
  return state.firstUnread.type === 'threadStart' || state.firstUnread.type === 'turn' && token(state.firstUnread.turnId);
}

/** One enrolled Desktop connection. Native I/O remains the caller's responsibility. */
export class CodexReadObserver {
  readonly #options: CodexObserverOptions;
  readonly #now: () => number;
  readonly #pending = new Map<string, Pending>();
  readonly #ids = new Set<string>();
  readonly #threads = new Map<string, Selection>();
  readonly #buffers = {client: Buffer.alloc(0), server: Buffer.alloc(0)};
  #closed = false;
  #initialized = false;

  constructor(options: CodexObserverOptions) {this.#options = options; this.#now = options.now ?? Date.now;}

  /** A bounded synchronous metadata tap; it performs no publication, file access or native writes. */
  observe(direction: 'client' | 'server', chunk: Uint8Array): void {
    if (this.#closed) return;
    try {
      const bytes = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      let offset = 0, frames = 0;
      while (offset < bytes.length && !this.#closed) {
        const end = bytes.indexOf(10, offset), part = bytes.subarray(offset, end < 0 ? bytes.length : end);
        if (this.#buffers[direction].length + part.length > MAX_FRAME || ++frames > 256) {this.close(); return;}
        const line = Buffer.concat([this.#buffers[direction], part]);
        this.#buffers[direction] = end < 0 ? line : Buffer.alloc(0);
        if (end < 0) return;
        this.#message(direction, JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(line)) as unknown);
        offset = end + 1;
      }
    } catch {this.close();}
  }

  /** Owner-stream gaps invalidate every candidate; a later sync permits only new native actions. */
  reset(): void {
    this.#threads.clear();
    for (const [key, pending] of this.#pending) if (pending.kind !== 'initialize') this.#pending.delete(key);
  }

  close(): void {
    this.#closed = true; this.#pending.clear(); this.#threads.clear(); this.#ids.clear();
    this.#buffers.client = Buffer.alloc(0); this.#buffers.server = Buffer.alloc(0);
  }

  #invalidate(threadId: string): void {
    this.#threads.delete(threadId);
    for (const [key, pending] of this.#pending) if ('threadId' in pending && pending.threadId === threadId) this.#pending.delete(key);
  }

  #track(key: string, pending: Pending): void {
    if (this.#pending.size >= MAX_PENDING) this.close();
    else this.#pending.set(key, pending);
  }

  #message(direction: 'client' | 'server', raw: unknown): void {
    if (!fields(raw)) {this.close(); return;}
    const now = this.#now();
    for (const [key, pending] of this.#pending) if (now - pending.at >= TTL_MS) this.#pending.delete(key);
    for (const [id, selection] of this.#threads) if (now - selection.at >= TTL_MS) this.#invalidate(id);
    if (typeof raw.method === 'string') {
      const params = fields(raw.params) ? raw.params : {};
      if (direction === 'client' && 'id' in raw) {
        const key = requestKey(raw.id);
        if (key === undefined || this.#ids.has(key) || this.#ids.size >= MAX_IDS) {this.close(); return;}
        this.#ids.add(key);
        this.#request(key, raw.method, params, now);
      } else if (direction === 'server' && token(params.threadId)) {
        if (['turn/started', 'turn/completed', 'thread/closed', 'thread/archived'].includes(raw.method) ||
          raw.method === 'thread/readState/changed' && unread(params.readState)) this.#invalidate(params.threadId);
      }
      return;
    }
    if (direction !== 'server') return;
    const key = requestKey(raw.id);
    if (key === undefined) return;
    const pending = this.#pending.get(key); this.#pending.delete(key);
    if (pending === undefined || 'error' in raw || !fields(raw.result)) return;
    this.#response(pending, raw.result, now);
  }

  #request(key: string, method: string, params: Record<string, unknown>, now: number): void {
    if (method === 'initialize') {
      if (this.#initialized || !fields(params.clientInfo) || params.clientInfo.name !== 'Codex Desktop') {this.close(); return;}
      this.#track(key, {kind: 'initialize', at: now}); return;
    }
    if (!this.#initialized || !token(params.threadId)) return;
    const threadId = params.threadId;
    if (['turn/start', 'turn/steer', 'thread/rollback', 'thread/archive', 'thread/unsubscribe'].includes(method)) {
      this.#invalidate(threadId); return;
    }
    if (method === 'thread/read') {
      this.#invalidate(threadId);
      if (params.includeTurns !== false) return;
      if (this.#threads.size >= MAX_THREADS) {this.close(); return;}
      const selection: Selection = {at: now}; this.#threads.set(threadId, selection);
      this.#track(key, {kind: 'snapshot', threadId, selection, at: now}); return;
    }
    const selection = this.#threads.get(threadId);
    if (method === 'thread/turns/list') {
      if (selection?.revision === undefined || params.cursor !== null || params.limit !== 1 ||
        params.sortDirection !== 'desc' || params.itemsView !== 'notLoaded') return;
      delete selection.turnId;
      this.#track(key, {kind: 'selection', threadId, selection, at: now}); return;
    }
    if (method !== 'thread/readState/update' || !fields(params.operation)) return;
    if (params.operation.type !== 'read') {this.#invalidate(threadId); return;}
    if (selection?.turnId === undefined || selection.revision !== params.expectedRevision) return;
    const target = this.#options.bind(threadId, selection.turnId);
    this.#invalidate(threadId);
    if (target === undefined || !token(params.expectedRevision)) return;
    this.#track(key, {kind: 'read', threadId, target: structuredClone(target), seenRevision: params.expectedRevision, at: now});
  }

  #response(pending: Pending, result: Record<string, unknown>, now: number): void {
    if (pending.kind === 'initialize') {this.#initialized = true; return;}
    if (pending.kind === 'read') {
      if (!fields(result.readState) || result.readState.firstUnread !== null || !token(result.readState.revision) ||
        result.readState.revision === pending.seenRevision) return;
      this.#options.accept({target: pending.target, seenRevision: pending.seenRevision, acceptedRevision: result.readState.revision, observedAtMs: now});
      return;
    }
    if (this.#threads.get(pending.threadId) !== pending.selection) return;
    if (pending.kind === 'snapshot') {
      if (fields(result.thread) && result.thread.id === pending.threadId && unread(result.readState)) {
        pending.selection.revision = result.readState.revision;
      }
      return;
    }
    const turn: unknown = Array.isArray(result.data) ? result.data[0] : undefined;
    if (fields(turn) && token(turn.id) && ['completed', 'interrupted', 'failed'].includes(String(turn.status))) pending.selection.turnId = turn.id;
  }
}
