import { lstat, open, opendir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ClaudeDesktopSession, Observation } from '../os-adapter.js';
import { LOCAL_ID, THREAD_ID } from './uri.js';

const unknown = (reason: string): { status: 'unknown'; reason: string } => ({ status: 'unknown', reason });
const known = <T>(value: T): Observation<T> => ({ status: 'known', value });
const errorCode = (error: unknown) => (error as NodeJS.ErrnoException | null)?.code;

const ROLLOUT_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/;

/**
 * Whether Codex has archived a thread: `archived_sessions/rollout-<timestamp>-<id>.jsonl` exists under the Codex
 * home. Reads directory entry names only, never file contents, and stops at `maxEntries` names.
 */
export async function codexArchived(codexHome: string, threadId: string, options: { maxEntries?: number } = {}): Promise<Observation<boolean>> {
  if (typeof threadId !== 'string' || !THREAD_ID.test(threadId)) return unknown('invalid-thread-id');
  const maxEntries = options.maxEntries ?? 100_000;
  const suffix = `-${threadId}.jsonl`;
  let directory;
  try {
    directory = await opendir(join(codexHome, 'archived_sessions'), { bufferSize: 256 });
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') return unknown('codex-archive-unreadable');
    try {
      await stat(codexHome);
      return known(false);
    } catch {
      return unknown('codex-home-missing');
    }
  }
  let seen = 0;
  let found = false;
  try {
    for await (const entry of directory) {
      if (++seen > maxEntries) return unknown('codex-archive-too-large');
      if (found || !entry.isFile() || !entry.name.startsWith('rollout-') || !entry.name.endsWith(suffix)) continue;
      found = ROLLOUT_TIMESTAMP.test(entry.name.slice('rollout-'.length, -suffix.length));
    }
  } catch {
    return unknown('codex-archive-unreadable');
  }
  return known(found);
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
