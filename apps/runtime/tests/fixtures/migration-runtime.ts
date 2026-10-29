// Real shipped runtime children for the migration lease checks. Cancellation kills only this test's child.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import type {TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';
import {waitFor} from '../support.js';

const MAIN = fileURLToPath(new URL('../../src/main.js', import.meta.url));
type Exit = [number | null, NodeJS.Signals | null];

/** Starts the shipped entry point, captures both streams and reaps it even when readiness or an assertion fails. */
export function migrationRuntime(context: TestContext, dir: string): {
  ready: () => Promise<void>; stop: () => Promise<void>; exited: Promise<Exit>; stderr: () => string;
} {
  const child = spawn(process.execPath, [MAIN, '--port', '0', '--state-dir', dir], {stdio: ['ignore', 'pipe', 'pipe']});
  let stdout = '';
  let stderr = '';
  let launchError: Error | undefined;
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
  child.once('error', error => { launchError = error; });
  const exited = once(child, 'close') as Promise<Exit>;
  // A spawn error can precede the ready/exit await; retain its rejection without making it unhandled.
  void exited.catch(() => {});
  const kill = (): void => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); };
  context.signal.addEventListener('abort', kill, {once: true});
  context.after(async () => {
    kill();
    try { await exited; }
    finally { context.signal.removeEventListener('abort', kill); }
  });
  return {
    ready: async () => {
      await waitFor(() => {
        if (launchError !== undefined) throw launchError;
        assert.equal(child.exitCode, null, stderr);
        assert.equal(child.signalCode, null, stderr);
        return stdout.includes('\n');
      }, 15_000, 'the runtime ready line');
      assert.equal((JSON.parse(stdout.split('\n')[0] ?? '') as {event: string}).event, 'runtime.ready');
    },
    stop: async () => { child.kill('SIGTERM'); await exited; },
    exited,
    stderr: () => stderr,
  };
}
