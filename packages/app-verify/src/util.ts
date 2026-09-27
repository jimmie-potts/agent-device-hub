import {execFile} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {delimiter, isAbsolute, join, posix} from 'node:path';

/** UTC time with second precision, as the receipt writes it: `2026-09-27T06:02:59Z`. */
export function iso(ms: number = Date.now()): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** A caller's mistake: printed as `{"error": "usage"}` with exit status 2, before the run changes. */
export class UsageError extends Error {}

export const APP_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export function runIdPattern(app: string): RegExp {
  return new RegExp(`^${app.replace(/-/g, '\\-')}-\\d{8}T\\d{6}Z-[0-9a-f]{6}$`);
}

export const ANY_RUN_ID = /^[a-z][a-z0-9-]*-\d{8}T\d{6}Z-[0-9a-f]{6}$/;

export function newRunId(app: string, now = Date.now()): string {
  const stamp = new Date(now).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `${app}-${stamp}-${randomBytes(3).toString('hex')}`;
}

export function sha256(bytes: Uint8Array | string): string {
  return 'sha256:' + createHash('sha256').update(bytes).digest('hex');
}

export function hex256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  error?: string;
}

/** Run a program without a shell. Never throws; a spawn failure is code -1. */
export function exec(file: string, args: readonly string[], options: {cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv} = {}): Promise<ExecResult> {
  return new Promise(resolve => {
    execFile(file, args, {cwd: options.cwd, timeout: options.timeoutMs ?? 30000, env: options.env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024}, (error, stdout, stderr) => {
      const code = error ? (typeof (error as {code?: unknown}).code === 'number' ? ((error as {code: number}).code) : -1) : 0;
      resolve({code, stdout: stdout ?? '', stderr: stderr ?? '', ...(error && code === -1 ? {error: error.message} : {})});
    });
  });
}

/** Resolve a program name on a PATH string; absolute and relative-with-slash paths pass through. */
export function which(program: string, path: string, cwd: string): string | undefined {
  if (program.includes('/')) {
    const resolved = isAbsolute(program) ? program : join(cwd, program);
    return existsSync(resolved) ? resolved : undefined;
  }
  for (const directory of path.split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, program);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * A loopback URL the core accepts, or why not: `http://127.0.0.1:<port>`
 * with no credentials, query or fragment, which the core records and prints.
 * An `endpoint` is exactly `http://127.0.0.1:<port>/`; a main URL may have a
 * path.
 */
export function loopback(value: unknown, endpoint = false): URL | string {
  let url: URL;
  try {
    url = new URL(String(value));
  } catch {
    return 'an invalid URL';
  }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port) return 'not 127.0.0.1 with an explicit port';
  if (url.username || url.password || url.href.includes('?') || url.href.includes('#')) return 'a URL with credentials, a query or a fragment';
  if (endpoint && url.pathname !== '/') return 'an endpoint with a path; an endpoint is exactly http://127.0.0.1:<port>/';
  return url;
}

/** Longest detail or reason the core records from an application, plug-in or tool error. */
export const DETAIL_LIMIT = 1000;

/*
 * What redact() matches, in order at each position:
 * 1. `file://` followed by an absolute path: the path is judged like any other.
 * 2. An http(s) or ws(s) URL: kept whole, with its path and query.
 * 3. An absolute path at the start or after whitespace, a quote, a backtick or
 *    one of ( = [ , < { ; | : . It never ends in `:`, so `<path>: ENOENT`
 *    keeps its colon.
 */
const PATH_TOKEN = "\\/[^\\s'\"\\x60()[\\]{}<>,;|]*[^\\s'\"\\x60()[\\]{}<>,;|:]";
const REDACTABLE = new RegExp(`(file:\\/\\/)(${PATH_TOKEN})|(?:https?|wss?):\\/\\/[^\\s'"\\x60<>]*|(^|[\\s'"\\x60(=[,<{;|:])(${PATH_TOKEN})`, 'gi');

/**
 * A detail fit for a receipt, event, log or printed line: every absolute path
 * outside the run's two roots becomes `<path>` (a tool's "Command failed:
 * /abs/…" can name private files), and the text is capped at
 * `DETAIL_LIMIT` characters. A path is judged after normalizing, so `..`
 * cannot climb out of a root. Full http(s) URLs and relative paths are kept;
 * a bare route such as `/api/x` cannot be told from a file path and is
 * replaced, so name routes by their full URL.
 */
export function redact(text: string, roots: {runtime: string; proof: string}): string {
  const bases = [roots.runtime, roots.proof].map(root => posix.normalize(root).replace(/\/+$/, ''));
  const inside = (path: string) => {
    const normal = posix.normalize(path);
    return bases.some(base => normal === base || normal.startsWith(`${base}/`));
  };
  const redacted = text.replace(REDACTABLE, (match: string, scheme?: string, filePath?: string, before?: string, path?: string) => {
    if (scheme !== undefined) return `${scheme}${inside(filePath!) ? filePath : '<path>'}`;
    if (path === undefined) return match;
    return `${before}${inside(path) ? path : '<path>'}`;
  });
  return redacted.length > DETAIL_LIMIT ? `${redacted.slice(0, DETAIL_LIMIT - 3)}...` : redacted;
}

export function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split('\n')[0]!.slice(0, 500);
}

/** A process's start time in clock ticks since boot (`/proc/<pid>/stat` field 22), or undefined. */
export async function startTime(pid: number): Promise<string | undefined> {
  const text = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => undefined);
  // The command name may contain spaces and parentheses; fields resume after the last ')'.
  return text?.slice(text.lastIndexOf(')') + 2).split(' ')[19];
}

/** `<pid> <start time>`: identifies a live process even across PID reuse. */
export async function holder(pid: number = process.pid): Promise<string> {
  return `${pid} ${(await startTime(pid)) ?? 'unknown'}\n`;
}

/** Whether a `holder()` record names a process that is still the same live process. */
export async function holderAlive(record: string): Promise<boolean> {
  const [pidText, started] = record.trim().split(' ');
  const pid = Number(pidText);
  return Number.isInteger(pid) && pid > 0 && started !== undefined && started !== 'unknown' && (await startTime(pid)) === started;
}
