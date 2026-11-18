// The hook's title reader and project name (Hub #1865, design decision 14): the runtime's copy of agent-state's
// `readSessionTitle` and `projectName` (packages/agent-state/src/metadata.ts at main 6adad7e7), moved with identical
// output, which tests/hook-golden.test.ts proves against the retained package. A producer that selected lifecycle 1.1
// or 1.2 gets a root session's title from a bounded tail of its transcript (Claude Code) or of `session_index.jsonl`
// in the Codex home (Codex), read without following a link or blocking on a FIFO, and abandoned after 100 ms.
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {homedir} from 'node:os';
import {isAbsolute, join, win32} from 'node:path';
// The hook loads this module on every invocation: the validator comes from the 1.x contracts' root module, as before.
import {validDisplayText} from '@jimmie-potts/agent-lifecycle-contracts';
import type {Title} from '@jimmie-potts/event-contracts/v2/families';

/** The tail read, the most lines in it, the longest line read, and how long the hook waits for a title. */
const MAX_BYTES = 1024 * 1024, MAX_LINES = 8192, MAX_LINE_BYTES = 65536, DEADLINE_MS = 100;
/** At most four title reads are under way at once in the process; a fifth gives no title. */
const MAX_PENDING = 4;
let pending = 0;

export type TitleOptions = {
  /** The Codex home, whose `session_index.jsonl` holds Codex's thread names. Defaults to `CODEX_HOME`, then `~/.codex`. */
  codexHome?: string;
};

/** Whether the text holds a C0 control character or DEL. */
const hasControl = (value: string): boolean => [...value].some(character => {
  const code = character.codePointAt(0) ?? 0;
  return code <= 0x1f || code === 0x7f;
});

/** The file a transcript path names, a Windows drive path as its WSL mount, or null when it is not one the reader opens. */
function filePath(value: string): string | null {
  if (value.length > 4096 || hasControl(value)) return null;
  if (process.platform === 'linux' && /^[A-Za-z]:[\\/]/u.test(value)) return `/mnt/${value.charAt(0).toLowerCase()}/${value.slice(3).replaceAll('\\', '/')}`;
  return isAbsolute(value) ? value : null;
}

/** The project's name: the last part of the hook's working directory, when it is display text other than `.` or `..`. */
export function projectName(cwd: string | null): string | undefined {
  if (cwd === null || cwd === '') return undefined;
  const name = win32.basename(cwd.replace(/[\\/]+$/u, ''));
  return validDisplayText(name, 80) && name !== '.' && name !== '..' ? name : undefined;
}

function titleOf(value: unknown, source: Title['source']): Title | undefined {
  // Validate before truncating, so a credential beyond the display bound cannot be hidden.
  if (typeof value !== 'string' || !validDisplayText(value, MAX_LINE_BYTES)) return undefined;
  return {value: [...value].slice(0, 160).join(''), source};
}

const isFields = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

async function lookup(path: string, provider: 'codex' | 'claude', sessionId: string, signal: AbortSignal): Promise<Title | undefined> {
  const selected = filePath(path);
  if (selected === null || !selected.endsWith('.jsonl') || signal.aborted) return undefined;
  const file = await open(selected, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || signal.aborted) return undefined;
    const start = Math.max(0, info.size - MAX_BYTES), buffer = Buffer.alloc(Math.min(info.size, MAX_BYTES));
    const {bytesRead} = await file.read(buffer, 0, buffer.length, start);
    if (signal.aborted) return undefined;
    let bytes = buffer.subarray(0, bytesRead);
    // The start of a bounded tail can split a UTF-8 character or JSON record.
    if (start > 0) {
      const newline = bytes.indexOf(10);
      if (newline < 0) return undefined;
      bytes = bytes.subarray(newline + 1);
    }
    const lines = new TextDecoder('utf-8', {fatal: true}).decode(bytes).split('\n');
    if (lines.length > MAX_LINES) return undefined;
    let custom: Title | undefined, automatic: Title | undefined;
    for (const line of lines) {
      if (signal.aborted) return undefined;
      if (line === '' || Buffer.byteLength(line) > MAX_LINE_BYTES) continue;
      let row: unknown;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isFields(row)) continue;
      if (provider === 'codex') {
        if (row.id === sessionId && Object.hasOwn(row, 'thread_name')) automatic = titleOf(row.thread_name, 'provider');
      } else if (row.sessionId === sessionId) {
        if (row.type === 'custom-title') custom = titleOf(row.customTitle, 'user');
        if (row.type === 'ai-title') automatic = titleOf(row.aiTitle, 'provider');
      }
    }
    // An older custom title may be outside a Claude tail: do not substitute an AI title for it.
    return provider === 'claude' ? custom ?? (start === 0 ? automatic : undefined) : automatic;
  } finally {
    await file.close();
  }
}

/**
 * A root session's title: Claude Code's latest custom title, or its AI title when the whole transcript was read, or
 * Codex's latest thread name. Undefined when there is none, it is not display text, or it took over 100 ms.
 */
export async function readSessionTitle(provider: 'codex' | 'claude', sessionId: string, transcriptPath: string | null, options: TitleOptions = {}): Promise<Title | undefined> {
  if (pending >= MAX_PENDING) return undefined;
  const home = options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), '.codex');
  const path = provider === 'codex' ? join(home, 'session_index.jsonl') : transcriptPath;
  if (path === null || path === '') return undefined;
  pending++;
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = lookup(path, provider, sessionId, abort.signal).catch(() => undefined).finally(() => { pending--; });
  try {
    return await Promise.race([work, new Promise<undefined>(resolve => { timer = setTimeout(() => { abort.abort(); resolve(undefined); }, DEADLINE_MS); })]);
  } finally {
    clearTimeout(timer);
    abort.abort();
  }
}
