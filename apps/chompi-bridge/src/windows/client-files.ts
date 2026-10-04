import { lstat, open, opendir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ClaudeDesktopSession, Observation } from '../os-adapter.js';
import { LOCAL_ID, THREAD_ID } from './uri.js';

const unknown = (reason: string): { status: 'unknown'; reason: string } => ({ status: 'unknown', reason });
const known = <T>(value: T): Observation<T> => ({ status: 'known', value });
const errorCode = (error: unknown) => (error as NodeJS.ErrnoException | null)?.code;

const ROLLOUT = /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;

export interface CodexArchiveOptions {
  /** Longest one directory scan may run before its result is unknown (default 1 s). */
  scanTimeoutMs?: number;
  /** How long a complete scan answers, positive or negative, before the next lookup rescans (default 10 s). */
  ttlMs?: number;
  now?: () => number;
}

type Scan = { ids: Set<string>; complete: boolean; reason?: string; at: number };

/**
 * Whether Codex has archived a thread: `archived_sessions/rollout-<timestamp>-<id>.jsonl` exists under the Codex
 * home. Reads directory entry names only, never file contents. One time-bounded scan collects every archived ID,
 * so concurrent and nearby lookups for different slots share it. A complete scan replaces the previous set and
 * answers for `ttlMs`, so an unarchived thread reads as not archived after at most one TTL. A scan that times out
 * or fails never replaces the complete set; it answers only the positive matches it read, otherwise unknown.
 */
export class CodexArchiveIndex {
  private readonly home: string;
  private readonly scanTimeoutMs: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private complete: Scan | null = null;
  private inflight: Promise<Scan> | null = null;

  constructor(home: string, options: CodexArchiveOptions = {}) {
    this.home = home;
    this.scanTimeoutMs = options.scanTimeoutMs ?? 1000;
    this.ttlMs = options.ttlMs ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  async archivedThread(threadId: string): Promise<Observation<boolean>> {
    if (typeof threadId !== 'string' || !THREAD_ID.test(threadId)) return unknown('invalid-thread-id');
    if (this.complete && this.now() - this.complete.at < this.ttlMs) return known(this.complete.ids.has(threadId));
    const scan = await (this.inflight ??= this.scan().finally(() => { this.inflight = null; }));
    if (scan.complete) return known(scan.ids.has(threadId));
    return scan.ids.has(threadId) ? known(true) : unknown(scan.reason ?? 'codex-archive-unreadable');
  }

  private async scan(): Promise<Scan> {
    const started = this.now();
    const ids = new Set<string>();
    const result = (complete: boolean, reason?: string): Scan => {
      const scan: Scan = { ids, complete, at: started, ...(reason ? { reason } : {}) };
      if (complete) this.complete = scan;
      return scan;
    };
    let directory;
    try {
      directory = await opendir(join(this.home, 'archived_sessions'), { bufferSize: 256 });
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') return result(false, 'codex-archive-unreadable');
      try {
        await stat(this.home);
        return result(true);
      } catch {
        return result(false, 'codex-home-missing');
      }
    }
    try {
      for await (const entry of directory) {
        if (this.now() - started > this.scanTimeoutMs) return result(false, 'codex-archive-timeout');
        const match = entry.isFile() ? ROLLOUT.exec(entry.name) : null;
        if (match) ids.add(match[1]!);
      }
    } catch {
      return result(false, 'codex-archive-unreadable');
    }
    // Leaving the for-await loop, by completion, return or error, closes the directory.
    return result(true);
  }
}

/** One-off lookup without a shared cache. */
export async function codexArchived(codexHome: string, threadId: string, options: CodexArchiveOptions = {}): Promise<Observation<boolean>> {
  return new CodexArchiveIndex(codexHome, options).archivedThread(threadId);
}

export interface CodexThreadNameOptions {
  /** Largest `session_index.jsonl` the reader parses (default 16 MiB); a larger file is unknown. */
  maxBytes?: number;
}

/** The longest thread name the adapter compares, matching its title bound. */
export const MAX_THREAD_NAME = 1024;

/** A thread's current Codex name: named, never named, or unusable (its newest entry is invalid or out of order). */
export type CodexThreadName = { status: 'named'; name: string } | { status: 'none' } | { status: 'invalid' };

/** A thread's parsed index entries: its current name (`null` when unusable) and every name its lines carried. */
export type CodexThreadEntries = { current: string | null; seen: ReadonlySet<string> };

/** One parsed `session_index.jsonl`: each thread's current name and which threads could be showing each name. */
export class CodexThreadNameIndex {
  private readonly threads: Map<string, CodexThreadEntries>;
  private readonly holders = new Map<string, Set<string>>();

  constructor(threads: Map<string, CodexThreadEntries>) {
    this.threads = threads;
    // A thread with a usable name holds only that name. One whose name is unusable might still show any name its
    // lines carried, so it holds all of them and the uniqueness check stays on the safe side.
    for (const [id, { current, seen }] of threads) {
      for (const name of current !== null ? [current] : seen) {
        let ids = this.holders.get(name);
        if (!ids) this.holders.set(name, ids = new Set());
        ids.add(id);
      }
    }
  }

  nameOf(threadId: string): CodexThreadName {
    const thread = this.threads.get(threadId);
    if (!thread) return { status: 'none' };
    return thread.current === null ? { status: 'invalid' } : { status: 'named', name: thread.current };
  }

  /**
   * Whether a thread other than `threadId` currently has `name`, or might show it because its own name is unusable,
   * rendered in the sidebar or not (collapsed projects, archived or deleted threads all count), so a name match can
   * never stand in for the exact thread.
   */
  sharedWithOtherThread(name: string, threadId: string): boolean {
    const ids = this.holders.get(name);
    return ids !== undefined && [...ids].some(id => id !== threadId);
  }
}

type NameCache = { mtimeMs: number; size: number; index: CodexThreadNameIndex };

/**
 * Codex's own thread names, the names its sidebar shows, from `<home>/session_index.jsonl`: one JSON object per line
 * with `id`, `thread_name` and `updated_at`. Codex appends a line when it names or renames a thread, so a thread's
 * last line is its current name; a tie in `updated_at` goes to the later line. The name is unusable when that last
 * line has an empty, overlong or non-string name or an unparsable `updated_at`, or when an earlier line for the
 * thread has a later `updated_at`. Only those three keys are read, and names never leave the adapter. The parsed index
 * is kept until the file's size or modification time changes.
 */
export class CodexThreadNames {
  private readonly home: string;
  private readonly maxBytes: number;
  private cache: NameCache | null = null;

  constructor(home: string, options: CodexThreadNameOptions = {}) {
    this.home = home;
    this.maxBytes = options.maxBytes ?? 16 * 1024 * 1024;
  }

  /** The parsed index; an empty one when Codex has written none yet; unknown when the index cannot be read. */
  async read(): Promise<Observation<CodexThreadNameIndex>> {
    const path = join(this.home, 'session_index.jsonl');
    let handle;
    try {
      handle = await open(path, 'r');
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') return unknown('codex-index-unreadable');
      try {
        await stat(this.home);
        return known(new CodexThreadNameIndex(new Map()));
      } catch {
        return unknown('codex-home-missing');
      }
    }
    try {
      const info = await handle.stat();
      if (!info.isFile()) return unknown('codex-index-unreadable');
      if (info.size > this.maxBytes) return unknown('codex-index-too-large');
      if (!this.cache || this.cache.mtimeMs !== info.mtimeMs || this.cache.size !== info.size) {
        const text = await handle.readFile('utf8');
        if (Buffer.byteLength(text, 'utf8') > this.maxBytes) return unknown('codex-index-too-large');
        this.cache = { mtimeMs: info.mtimeMs, size: info.size, index: new CodexThreadNameIndex(parseThreadNames(text)) };
      }
      return known(this.cache.index);
    } catch {
      return unknown('codex-index-unreadable');
    } finally {
      await handle.close();
    }
  }
}

function parseThreadNames(text: string): Map<string, CodexThreadEntries> {
  const last = new Map<string, { name: string | null; at: number; earlierMax: number; seen: Set<string> }>();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let entry: unknown;
    try { entry = JSON.parse(line); } catch { continue; }
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const { id, thread_name: name, updated_at: updatedAt } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || !THREAD_ID.test(id)) continue;
    const at = typeof updatedAt === 'string' ? Date.parse(updatedAt) : Number.NaN;
    const usable = typeof name === 'string' && name.length > 0 && name.length <= MAX_THREAD_NAME && Number.isFinite(at);
    const previous = last.get(id);
    const earlierMax = previous ? Math.max(previous.earlierMax, Number.isFinite(previous.at) ? previous.at : Number.NEGATIVE_INFINITY) : Number.NEGATIVE_INFINITY;
    const seen = previous?.seen ?? new Set<string>();
    if (typeof name === 'string' && name.length > 0 && name.length <= MAX_THREAD_NAME) seen.add(name);
    last.set(id, { name: usable ? name as string : null, at, earlierMax, seen });
  }
  return new Map([...last].map(([id, { name, at, earlierMax, seen }]) => [id, { current: name !== null && at >= earlierMax ? name : null, seen }]));
}

async function boundedDirectories(path: string, limit: number): Promise<string[] | 'too-large'> {
  const entries = await readdir(path, { withFileTypes: true });
  if (entries.length > limit) return 'too-large';
  return entries.filter(entry => entry.isDirectory()).map(entry => join(path, entry.name));
}

async function readRecord(path: string, maxBytes: number): Promise<string | { reason: string }> {
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile()) return { reason: 'claude-record-not-file' };
    if (info.size > maxBytes) return { reason: 'claude-record-too-large' };
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}

/** Keeps only the three allowlisted keys; every other key in the record is dropped here and never returned. */
function pickSession(localId: string, text: string): ClaudeDesktopSession | { reason: string } {
  let record: unknown;
  try { record = JSON.parse(text); } catch { return { reason: 'claude-record-unreadable' }; }
  if (typeof record !== 'object' || record === null || Array.isArray(record)) return { reason: 'claude-record-invalid' };
  const { sessionId, isArchived, lastFocusedAt } = record as Record<string, unknown>;
  if (sessionId !== localId) return { reason: 'claude-record-mismatch' };
  if (typeof isArchived !== 'boolean') return { reason: 'claude-record-invalid' };
  if (lastFocusedAt !== undefined && lastFocusedAt !== null && !(typeof lastFocusedAt === 'number' && Number.isFinite(lastFocusedAt) && lastFocusedAt >= 0)) {
    return { reason: 'claude-record-invalid' };
  }
  return { localId, isArchived, lastFocusedAt: typeof lastFocusedAt === 'number' ? lastFocusedAt : null };
}

/**
 * Claude Desktop session records from `<root>/<account>/<org>/local_<uuid>.json`. Only the requested files are
 * opened, and only `sessionId`, `isArchived` and `lastFocusedAt` are read from them. A missing record is omitted;
 * any unreadable, oversized, ambiguous or malformed record makes the whole observation unknown.
 */
export async function claudeSessions(
  root: string,
  localIds: readonly string[],
  options: { maxRecordBytes?: number; maxDirectories?: number; maxIds?: number } = {},
): Promise<Observation<ClaudeDesktopSession[]>> {
  const maxIds = options.maxIds ?? 64;
  if (!Array.isArray(localIds)) return unknown('invalid-local-id');
  if (localIds.length > maxIds) return unknown('too-many-local-ids');
  if (!localIds.every(id => typeof id === 'string' && LOCAL_ID.test(id))) return unknown('invalid-local-id');
  const ids = [...new Set(localIds)];
  if (ids.length === 0) return known([]);
  const maxDirectories = options.maxDirectories ?? 32;
  const maxRecordBytes = options.maxRecordBytes ?? 1024 * 1024;

  let organizations: string[];
  try {
    const accounts = await boundedDirectories(root, maxDirectories);
    if (accounts === 'too-large') return unknown('claude-store-too-large');
    organizations = [];
    for (const account of accounts) {
      const found = await boundedDirectories(account, maxDirectories);
      if (found === 'too-large') return unknown('claude-store-too-large');
      organizations.push(...found);
    }
  } catch (error) {
    return errorCode(error) === 'ENOENT' ? known([]) : unknown('claude-store-unreadable');
  }

  const sessions: ClaudeDesktopSession[] = [];
  for (const localId of ids) {
    const paths: string[] = [];
    for (const organization of organizations) {
      const path = join(organization, `${localId}.json`);
      try {
        const info = await lstat(path);
        if (!info.isFile()) return unknown('claude-record-not-file');
        paths.push(path);
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') return unknown('claude-record-unreadable');
      }
    }
    if (paths.length === 0) continue;
    if (paths.length > 1) return unknown('claude-record-duplicate');
    let text: string | { reason: string };
    try {
      text = await readRecord(paths[0]!, maxRecordBytes);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') continue;
      return unknown('claude-record-unreadable');
    }
    if (typeof text !== 'string') return unknown(text.reason);
    const session = pickSession(localId, text);
    if ('reason' in session) return unknown(session.reason);
    sessions.push(session);
  }
  return known(sessions);
}
