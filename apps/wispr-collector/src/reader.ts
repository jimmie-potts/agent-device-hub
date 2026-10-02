import { fork } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { READ_CODES, SourceError, sourceLimits, type SourceLimits, type SourceRead, type SourceRow, type OptionalColumn, type ReadCode } from './reader-types.js';
export { SourceError } from './reader-types.js';

/** Production entrypoint; the CLI cannot turn the platform check off. */
export async function readSource(path: string, limits: Partial<SourceLimits> = {}): Promise<SourceRead> {
  if (process.platform !== 'win32') throw new SourceError('unsupported-platform');
  if (!/^[A-Za-z]:\\/.test(path) || path.includes(':', 2)) throw new SourceError('unsafe-path');
  return supervisedRead(path, limits);
}

/** Internal synthetic-test adapter; not exposed as a CLI option or package export. */
export async function readSyntheticSource(path: string, limits: Partial<SourceLimits> = {}): Promise<SourceRead> {
  return supervisedRead(path, limits);
}

async function supervisedRead(path: string, overrides: Partial<SourceLimits>): Promise<SourceRead> {
  const limits = sourceLimits(overrides);
  if (!isAbsolute(path)) throw new SourceError('unsafe-path');
  try {
    for (let part = resolve(path); ; part = dirname(part)) {
      if (lstatSync(part).isSymbolicLink()) throw new SourceError('unsafe-path');
      if (dirname(part) === part) break;
    }
    if (!lstatSync(path).isFile()) throw new SourceError('unsafe-path');
    if (realpathSync.native(path).toLowerCase() !== resolve(path).toLowerCase()) throw new SourceError('unsafe-path');
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new SourceError('source-unavailable');
  }
  return new Promise((resolveRead, reject) => {
    const child = fork(fileURLToPath(new URL('./reader-worker.js', import.meta.url)), [], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'advanced',
      execArgv: ['--max-old-space-size=192', '--max-semi-space-size=8'],
      env: { ...process.env, NODE_OPTIONS: '' },
    });
    let failure: ReadCode | undefined;
    let done: Omit<SourceRead, 'rows'> | undefined;
    let childMemory = 0;
    const rows: SourceRow[] = [];
    const fail = (code: ReadCode) => { failure ??= code; child.kill(); };
    const deadline = setTimeout(() => fail('source-deadline'), limits.deadlineMs);
    const memory = setInterval(() => {
      if (process.memoryUsage().rss + childMemory > limits.maxMemoryBytes) fail('source-capacity');
    }, 25);
    child.on('error', () => fail('source-read'));
    child.on('message', (raw) => {
      const message = raw as Record<string, unknown>;
      if (failure) return;
      if (message.type === 'batch' && Array.isArray(message.rows) && typeof message.rss === 'number') {
        childMemory = message.rss;
        if (message.rows.length > 128 || rows.length + message.rows.length > limits.maxRows || process.memoryUsage().rss + childMemory > limits.maxMemoryBytes) {
          fail('source-capacity'); return;
        }
        rows.push(...message.rows as SourceRow[]);
        child.send({ type: 'ack' });
      } else if (message.type === 'done' && typeof message.selectedBytes === 'number' && message.selectedBytes <= limits.maxBytes && message.coverage && typeof message.coverage === 'object') {
        done = { selectedBytes: message.selectedBytes, coverage: message.coverage as Record<OptionalColumn, boolean> };
      } else if (message.type === 'error' && READ_CODES.includes(message.code as ReadCode)) {
        fail(message.code as ReadCode);
      } else fail('source-read');
    });
    // Wait for process exit, including a killed synchronous read, before resolving.
    child.on('close', code => {
      clearTimeout(deadline); clearInterval(memory);
      if (failure || code !== 0 || !done) reject(new SourceError(failure ?? 'source-read'));
      else resolveRead({ rows, ...done });
    });
    child.send({ path, limits });
  });
}
