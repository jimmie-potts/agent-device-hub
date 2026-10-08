// Codex Desktop's read marker (Hub #926, from Hub #191): the unread thread IDs that Desktop keeps in
// `.codex-global-state.json` in the Codex home. The parsing and the read are the old Hub's (`unreadSessions` and
// `createDesktopRead` in apps/hub/src/codex-desktop.ts at main 8590332f): only the known version 1 shape counts, an
// unusable marker gives no unread set, and a file that changed while it was read is read again. The marker is only read,
// never written, and neither its path nor its content leaves the module: only the unread IDs reach the module's main
// thread. It runs in the reader's own process (reader.ts), asynchronously, so a read stuck on a stalled mount holds one
// thread of that process's pool and its main thread still hears the runtime go.
import {constants} from 'node:fs';
import {open, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {metadataOf, type DesktopMetadata} from './metadata.js';

/** The marker's name in the Codex home. */
export const MARKER_FILE = '.codex-global-state.json';
/** The largest marker read; a larger one is unusable until it changes. */
export const MAX_MARKER_BYTES = 16 * 1024 * 1024;
const ID = /^[A-Za-z0-9_.-]{1,128}$/;

/**
 * One read of the marker. `unchanged`: its stamp is the one the reader was given, so the last read stands. `retry`: it
 * changed while it was read, so it gives nothing now and is read again next time. `read`: its new stamp and its unread
 * thread IDs, or null when it is missing, unreadable, oversized or not the known shape. A missing or unreadable marker
 * has the empty stamp, so the next read looks again.
 */
/** Existing marker response with independently read, validated Desktop metadata over the same private IPC. */
export type MarkerRead = ({status: 'unchanged'} | {status: 'retry'} | {status: 'read'; stamp: string; unread: readonly string[] | null}) & Partial<DesktopMetadata>;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is string => typeof value === 'string' && ID.test(value);

/** The unread thread IDs in a marker's text, or null when it is not the known version 1 shape. */
export function unreadSessions(text: string): Set<string> | null {
  let state: unknown;
  try {
    state = JSON.parse(text);
  } catch {
    return null;
  }
  const marker = isObject(state) ? state['electron-thread-read-state-v1'] : undefined;
  if (!isObject(marker) || marker.version !== 1 || !isObject(marker.unreadByIdentity)) return null;
  const unread = new Set<string>();
  for (const host of Object.values(marker.unreadByIdentity)) {
    if (!isObject(host)) return null;
    for (const list of Object.values(host)) {
      if (!Array.isArray(list) || !list.every(isId)) return null;
      for (const session of list) unread.add(session);
    }
  }
  return unread;
}

/** The file's version: its modification time in nanoseconds and its size. */
const stampOf = (info: {mtimeNs: bigint; size: bigint}): string => `${info.mtimeNs}:${info.size}`;

/**
 * The marker's bytes, read through one descriptor without blocking on a special file, or undefined when it is not a
 * regular file, is over the bound or grew while it was read. The buffer fits the file, so a read holds no more memory
 * than the marker needs.
 */
async function readBounded(path: string): Promise<Buffer | undefined> {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > MAX_MARKER_BYTES) return undefined;
    const buffer = Buffer.alloc(info.size + 1);
    let size = 0;
    for (;;) {
      const {bytesRead} = await file.read(buffer, size, buffer.length - size, null);
      if (bytesRead === 0) return buffer.subarray(0, size);
      size += bytesRead;
      if (size > info.size) return undefined;
    }
  } finally {
    await file.close();
  }
}

/** Reads the marker in `home` unless its stamp is still `stamp`. It never rejects and never writes. */
export async function readMarker(home: string, stamp: string): Promise<MarkerRead> {
  const path = join(home, MARKER_FILE);
  try {
    const before = await stat(path, {bigint: true});
    const version = stampOf(before);
    if (version === stamp) return {status: 'unchanged'};
    // A stable unusable file stays unusable until it changes.
    if (!before.isFile() || before.size > BigInt(MAX_MARKER_BYTES)) return {status: 'read', stamp: version, unread: null};
    const bytes = await readBounded(path);
    if (bytes === undefined || stampOf(await stat(path, {bigint: true})) !== version) return {status: 'retry'};
    let text: string;
    try {
      text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    } catch {
      return {status: 'read', stamp: version, unread: null};
    }
    const unread = unreadSessions(text);
    return {status: 'read', stamp: version, unread: unread === null ? null : [...unread]};
  } catch {
    return {status: 'read', stamp: '', unread: null};
  }
}

/** A reply as the module takes it from another process: one of the three shapes, or else a read that gives nothing. */
export function markerReadOf(value: unknown): MarkerRead {
  if (isObject(value)) {
    if (value.status === 'unchanged' || value.status === 'retry') return {status: value.status, ...metadataOf(value)};
    const {stamp, unread} = value;
    if (value.status === 'read' && typeof stamp === 'string' && (unread === null || (Array.isArray(unread) && unread.every(isId)))) {
      return {status: 'read', stamp, unread: unread === null ? null : [...unread], ...metadataOf(value)};
    }
  }
  return {status: 'read', stamp: '', unread: null};
}
