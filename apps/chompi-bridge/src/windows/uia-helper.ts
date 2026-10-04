import { spawn as spawnProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';

export const UIA_HELPER_PROTOCOL = 1;

/** The parts of a child process the helper client uses; a test can supply a scripted stand-in. */
export interface HelperChild {
  stdin: { write(chunk: string): unknown; end(): unknown; on?(event: 'error', listener: (error: Error) => void): unknown } | null;
  stdout: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown } | null;
  stderr?: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown } | null;
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  kill(): unknown;
}

export type SpawnHelper = () => HelperChild;

export type HelperReply = { ok: true; value: unknown } | { ok: false; reason: string };

/** What the adapter needs from a helper; `UiaHelper` is the real one. */
export interface UiaHelperLike {
  request(op: string, params?: Record<string, unknown>): Promise<HelperReply>;
  close(): Promise<void>;
  /** How many helper processes have started; a change means a restart. */
  readonly starts?: number;
}

/**
 * JSON with every non-ASCII UTF-16 code unit escaped as `\uXXXX`. Windows PowerShell 5.1 decodes redirected stdin
 * in the console code page, so raw UTF-8 would garble a title; `ConvertFrom-Json` decodes the escapes exactly.
 */
export function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export interface UiaHelperOptions {
  spawn?: SpawnHelper;
  /** Per-request limit; a request that runs over it kills the helper (default 4 s). */
  requestTimeoutMs?: number;
  /** Limit for the helper to load UI Automation and report ready (default 15 s). */
  startTimeoutMs?: number;
  /** Requests in flight at once (default 8). */
  maxPending?: number;
  /** Longest accepted reply line, in characters (default 64 KiB). */
  maxLineLength?: number;
  /** Starts allowed within a sliding window (default 5 per minute). */
  restartBudget?: { count: number; windowMs: number };
  now?: () => number;
}

/** The shipped helper script. It sits beside this module in `src/windows`, which the built `dist/windows` reaches. */
export function helperScriptPath(): string {
  return join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'src', 'windows', 'uia-helper.ps1');
}

/** `-EncodedCommand` takes base64 of UTF-16LE. Unlike `-Command -`, it leaves stdin free for the protocol. */
export function encodeHelperCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

/** Spawns Windows PowerShell 5.1 by absolute path with the helper script. */
export function defaultSpawnHelper(scriptPath = helperScriptPath(), env: NodeJS.ProcessEnv = process.env): SpawnHelper {
  return () => {
    const script = readFileSync(scriptPath, 'utf8');
    const powershell = join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    return spawnProcess(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodeHelperCommand(script)], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
  };
}

const REASON = /^[a-z0-9-]{1,64}$/;

interface Pending {
  message: string;
  resolve(reply: HelperReply): void;
  timer?: NodeJS.Timeout;
}

interface Running {
  child: HelperChild;
  ready: boolean;
  exited: boolean;
  buffer: string;
  decoder: StringDecoder;
  /** Request IDs waiting for the ready line. */
  queued: number[];
  startTimer: NodeJS.Timeout;
}

/**
 * Client for the long-lived UI Automation helper. Requests carry IDs and per-request timeouts; a timeout, crash
 * or protocol violation stops the helper and the next request starts a fresh one, within a restart budget.
 * `request` never throws: every failure is a reply with a fixed reason code. Nothing is logged; helper stderr is
 * drained and discarded because an exception there could repeat window text.
 */
export class UiaHelper implements UiaHelperLike {
  private readonly spawn: SpawnHelper;
  private readonly requestTimeoutMs: number;
  private readonly startTimeoutMs: number;
  private readonly maxPending: number;
  private readonly maxLineLength: number;
  private readonly budget: { count: number; windowMs: number };
  private readonly now: () => number;
  private readonly pending = new Map<number, Pending>();
  private readonly startTimes: number[] = [];
  private running: Running | null = null;
  private nextId = 1;
  private closed = false;

  constructor(options: UiaHelperOptions = {}) {
    this.spawn = options.spawn ?? defaultSpawnHelper();
    this.requestTimeoutMs = options.requestTimeoutMs ?? 4000;
    this.startTimeoutMs = options.startTimeoutMs ?? 15000;
    this.maxPending = options.maxPending ?? 8;
    this.maxLineLength = options.maxLineLength ?? 65536;
    this.budget = options.restartBudget ?? { count: 5, windowMs: 60000 };
    this.now = options.now ?? Date.now;
  }

  /** How many helper processes have been started. */
  get starts(): number { return this.startTimes.length; }

  request(op: string, params: Record<string, unknown> = {}): Promise<HelperReply> {
    if (this.closed) return Promise.resolve({ ok: false, reason: 'helper-closed' });
    if (this.pending.size >= this.maxPending) return Promise.resolve({ ok: false, reason: 'helper-busy' });
    const id = this.nextId++;
    return new Promise<HelperReply>(resolve => {
      this.pending.set(id, { message: `${asciiJson({ ...params, id, op })}\n`, resolve });
      const running = this.ensureRunning();
      if (typeof running === 'string') this.settle(id, { ok: false, reason: running });
      else if (running.ready) this.send(running, id);
      else running.queued.push(id);
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    const running = this.running;
    this.failAll('helper-closed');
    if (!running) return;
    this.running = null;
    clearTimeout(running.startTimer);
    if (running.exited) return;
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { this.kill(running); resolve(); }, 1000);
      running.child.on('exit', () => { clearTimeout(timer); resolve(); });
      try { running.child.stdin?.end(); } catch { clearTimeout(timer); this.kill(running); resolve(); }
    });
  }

  private ensureRunning(): Running | string {
    if (this.running) return this.running;
    const now = this.now();
    while (this.startTimes.length > 0 && now - this.startTimes[0]! >= this.budget.windowMs) this.startTimes.shift();
    if (this.startTimes.length >= this.budget.count) return 'helper-restart-limit';
    this.startTimes.push(now);
    let child: HelperChild;
    try {
      child = this.spawn();
    } catch {
      return 'helper-spawn-failed';
    }
    const running: Running = {
      child, ready: false, exited: false, buffer: '', decoder: new StringDecoder('utf8'), queued: [],
      startTimer: setTimeout(() => this.stop(running, 'helper-start-timeout'), this.startTimeoutMs),
    };
    const onExit = () => {
      if (running.exited) return;
      running.exited = true;
      clearTimeout(running.startTimer);
      if (this.running === running) { this.running = null; this.failAll('helper-exited'); }
    };
    child.on('exit', onExit);
    child.on('error', onExit);
    child.stderr?.on('data', () => undefined);
    // A closed pipe (EPIPE) is a helper failure, never an uncaught exception.
    child.stdin?.on?.('error', () => this.stop(running, 'helper-exited'));
    child.stdout?.on('data', chunk => this.onData(running, typeof chunk === 'string' ? chunk : running.decoder.write(chunk)));
    this.running = running;
    return running;
  }

  private send(running: Running, id: number): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    pending.timer = setTimeout(() => {
      this.settle(id, { ok: false, reason: 'helper-timeout' });
      this.stop(running, 'helper-restarted');
    }, this.requestTimeoutMs);
    try {
      running.child.stdin?.write(pending.message);
    } catch {
      this.stop(running, 'helper-exited');
    }
  }

  private onData(running: Running, chunk: string): void {
    if (this.running !== running) return;
    running.buffer += chunk;
    let newline: number;
    while ((newline = running.buffer.indexOf('\n')) >= 0) {
      const line = running.buffer.slice(0, newline).trim();
      running.buffer = running.buffer.slice(newline + 1);
      if (line.length > this.maxLineLength) { this.stop(running, 'helper-protocol-error'); return; }
      if (line) this.onLine(running, line);
      if (this.running !== running) return;
    }
    if (running.buffer.length > this.maxLineLength) this.stop(running, 'helper-protocol-error');
  }

  private onLine(running: Running, line: string): void {
    let message: unknown;
    try { message = JSON.parse(line); } catch { this.stop(running, 'helper-protocol-error'); return; }
    if (typeof message !== 'object' || message === null) { this.stop(running, 'helper-protocol-error'); return; }
    const record = message as Record<string, unknown>;
    if (record.ready === true) {
      if (record.protocol !== UIA_HELPER_PROTOCOL || running.ready) { this.stop(running, 'helper-protocol-error'); return; }
      running.ready = true;
      clearTimeout(running.startTimer);
      for (const id of running.queued.splice(0)) this.send(running, id);
      return;
    }
    if (typeof record.id !== 'number' || !this.pending.has(record.id)) return;
    if (record.ok === true) this.settle(record.id, { ok: true, value: record.value });
    else this.settle(record.id, { ok: false, reason: typeof record.reason === 'string' && REASON.test(record.reason) ? record.reason : 'helper-error' });
  }

  private settle(id: number, reply: HelperReply): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    pending.resolve(reply);
  }

  private failAll(reason: string): void {
    for (const id of [...this.pending.keys()]) this.settle(id, { ok: false, reason });
  }

  /** Stops a helper and fails what it owed. Only the current helper owns pending requests. */
  private stop(running: Running, reason: string): void {
    clearTimeout(running.startTimer);
    if (this.running === running) { this.running = null; this.failAll(reason); }
    this.kill(running);
  }

  private kill(running: Running): void {
    try { running.child.kill(); } catch { /* already gone */ }
  }
}
