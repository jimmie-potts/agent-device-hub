// Existing Desktop inputs only: positive rollout filenames and the bounded session_index.jsonl tail (Hub #990).
// Runs in the existing reader process; no archived transcript is opened and no path or raw row leaves this reader.
import {constants} from 'node:fs';
import {lstat, open, opendir} from 'node:fs/promises';
import {join} from 'node:path';
import {coreFamilies, type Title} from '@jimmie-potts/event-contracts/v2/families';

export type DesktopMetadata = {archived: readonly string[] | null; titles: readonly {id: string; title: Title}[]};
const ID = /^[A-Za-z0-9_.-]{1,128}$/;
const MAX_BYTES = 1024 * 1024, MAX_LINES = 8192, MAX_LINE_BYTES = 65536;
// Reuse the current title contract before truncating, so a credential past the display bound is still rejected.
const family = coreFamilies.find(candidate => candidate.family === 'session');
if (family === undefined) throw new Error('the Desktop reader needs the current session title contract');
const session = family.schema as {$defs: {displayText: {pattern: string}}};
const DISPLAY = new RegExp(session.$defs.displayText.pattern, 'u');
const titleOf = (value: unknown): Title | undefined => typeof value === 'string' && value.length > 0 && [...value].length <= MAX_LINE_BYTES && DISPLAY.test(value)
  ? {value: [...value].slice(0, 160).join(''), source: 'provider'} : undefined;

/** A complete filename scan, or null if evidence is unavailable. */
async function archives(home: string): Promise<string[] | null> {
  try {
    const path = join(home, 'archived_sessions'), info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) return null;
    const directory = await opendir(path), found = new Set<string>();
    let entries = 0;
    for await (const entry of directory) {
      if (++entries > 10000) return null;
      const match = /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-([A-Za-z0-9_.-]{1,128})\.jsonl$/.exec(entry.name);
      const id = match?.[1];
      if (entry.isFile() && id !== undefined) found.add(id);
    }
    return [...found];
  } catch { return null; }
}

/** The latest valid title for each ID in the old Hub's bounded tail; missing input gives no title. */
async function titles(home: string): Promise<DesktopMetadata['titles']> {
  try {
    const file = await open(join(home, 'session_index.jsonl'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = await file.stat();
      if (!info.isFile()) return [];
      const start = Math.max(0, info.size - MAX_BYTES), buffer = Buffer.alloc(Math.min(info.size, MAX_BYTES));
      let length = 0;
      while (length < buffer.length) {
        const {bytesRead} = await file.read(buffer, length, buffer.length - length, start + length);
        if (bytesRead === 0) break;
        length += bytesRead;
      }
      let bytes = buffer.subarray(0, length);
      if (start > 0) { const newline = bytes.indexOf(10); if (newline < 0) return []; bytes = bytes.subarray(newline + 1); }
      const lines = new TextDecoder('utf-8', {fatal: true}).decode(bytes).split('\n');
      if (lines.length > MAX_LINES) return [];
      const found = new Map<string, Title>();
      for (const line of lines) {
        if (line.length === 0 || Buffer.byteLength(line) > MAX_LINE_BYTES) continue;
        let row: unknown; try { row = JSON.parse(line); } catch { continue; }
        if (typeof row !== 'object' || row === null || Array.isArray(row)) continue;
        const {id, thread_name: name} = row as {id?: unknown; thread_name?: unknown};
        if (typeof id !== 'string' || !ID.test(id) || !Object.hasOwn(row, 'thread_name')) continue;
        const title = titleOf(name);
        if (title === undefined) found.delete(id); else found.set(id, title);
      }
      return [...found].map(([id, title]) => ({id, title}));
    } finally { await file.close(); }
  } catch { return []; }
}

export async function readDesktopMetadata(home: string): Promise<DesktopMetadata> {
  const [archived, observedTitles] = await Promise.all([archives(home), titles(home)]);
  return {archived, titles: observedTitles};
}

/** IPC admits only neutral IDs and already validated provider titles. */
export function metadataOf(value: Record<string, unknown>): Partial<DesktopMetadata> {
  const result: {archived?: string[] | null; titles?: {id: string; title: Title}[]} = {};
  if (value.archived === null || Array.isArray(value.archived) && value.archived.length <= 10000 && value.archived.every(id => typeof id === 'string' && ID.test(id))) {
    result.archived = value.archived === null ? null : (value.archived as unknown[]).filter((id): id is string => typeof id === 'string');
  }
  if (Array.isArray(value.titles) && value.titles.length <= MAX_LINES) {
    result.titles = value.titles.flatMap(entry => {
      if (typeof entry !== 'object' || entry === null) return [];
      const {id, title} = entry as {id?: unknown; title?: {value?: unknown; source?: unknown}};
      if (typeof id !== 'string' || !ID.test(id) || title?.source !== 'provider') return [];
      const checked = titleOf(title.value);
      return checked === undefined ? [] : [{id, title: checked}];
    });
  }
  return result;
}
