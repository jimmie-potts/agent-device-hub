import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readPreparedBackend } from './backend-files.mjs';
import { readHostRoots } from './host-roots.mjs';

/** One fresh owned process group. Never retry a producer or preserve raw stderr. */
export async function runIngestionProducer(directory, { signal, timeoutMs = 20000 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20000 || signal?.aborted) throw new Error('Producer invocation invalid');
  await readPreparedBackend(directory); await readHostRoots(directory);
  if (signal?.aborted) throw new Error('Producer invocation aborted');
  return new Promise(resolve => {
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, [new URL('./ingestion-producer.mjs', import.meta.url).pathname],
      { env, detached: true, stdio: ['pipe','pipe','pipe'] });
    const hash = createHash('sha256'), chunks = []; let stdoutBytes = 0, stderrBytes = 0, reason = null, killTimer, done = false;
    const started = performance.now();
    function terminate(why) {
      if (done || reason) return; reason = why;
      if (child.pid) {
        try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Exit readback determines completion. */ }
        killTimer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 2000);
      }
    }
    const abort = () => terminate('aborted'), timer = setTimeout(() => terminate('deadline'), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', chunk => { stdoutBytes += chunk.length;
      if (stdoutBytes <= 256 * 1024) chunks.push(chunk); else terminate('stdout-limit'); });
    child.stderr.on('data', chunk => { stderrBytes += chunk.length; hash.update(chunk);
      if (stderrBytes > 8192) terminate('stderr-limit'); });
    child.stdin.on('error', () => terminate('input-failed'));
    child.on('error', () => { reason ??= 'spawn-failed'; });
    child.on('close', (code, exitSignal) => {
      done = true; clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', abort);
      let output = null;
      if (stdoutBytes <= 256 * 1024) {
        try { output = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { reason ??= 'output-invalid'; }
      }
      resolve({ pid: child.pid ?? null, code, exitSignal, reason, elapsedMs: performance.now() - started, stdoutBytes, stderrBytes,
        stderrSha256: hash.digest('hex'), output });
    });
    if (signal?.aborted) abort(); else child.stdin.end(JSON.stringify({ directory }));
  });
}
