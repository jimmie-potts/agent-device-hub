import {execFile} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {delimiter, isAbsolute, join} from 'node:path';

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

/** Longest detail or reason the core records from an application, plug-in or tool error. */
export const DETAIL_LIMIT = 1000;

/**
 * A detail fit for a receipt, event or result line: every absolute path
 * outside the run's two roots becomes `<path>` (a tool's "Command failed:
 * /abs/…" can name private files), and the text is capped at
 * `DETAIL_LIMIT` characters. URLs and relative paths are kept.
 */
export function redact(text: string, roots: {runtime: string; proof: string}): string {
  const inside = (path: string) => [roots.runtime, roots.proof].some(root => path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`));
  const redacted = text.replace(/(^|[\s'"(=[,])(\/[^\s'"()[\],]+)/g, (_, before: string, path: string) => `${before}${inside(path) ? path : '<path>'}`);
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
