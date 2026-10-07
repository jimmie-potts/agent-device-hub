// Hub #950: the supervisor reads a stopped runtime's last lines before it starts the next one, so a clean stop's
// `runtime.stopped` record is in the journal and the follow query does not call a clean runtime killed.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {test} from 'node:test';
import {DRAIN_MS, drained} from '../drain.js';

/** A child that writes `lines` lines to stderr and exits at once; a slow reader gets them after it has exited. */
function writer(lines: number): ReturnType<typeof spawn> {
  // Each line is 100 bytes, so the burst spans several reads of the pipe.
  const script = `for (let i = 0; i < ${lines}; i += 1) process.stderr.write(String(i).padStart(98, 'x') + '\\n');`;
  return spawn(process.execPath, ['-e', script], {stdio: ['ignore', 'ignore', 'pipe']});
}

void test('waiting for the drain delivers every line the child wrote, though the reader is slower than its exit', {timeout: 30_000}, async () => {
  const child = writer(6000);
  const seen: string[] = [];
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
    // A reader that falls behind: the child has exited long before it has read everything.
    const until = performance.now() + 60;
    while (performance.now() < until) { /* busy */ }
    seen.push(chunk);
  });
  const done = drained(child);
  await done;
  assert.equal(seen.join('').split('\n').filter(line => line !== '').length, 6000, 'every line was read before the wait ended');
  assert.equal(child.exitCode, 0);
});

void test('a descendant that keeps the pipe open costs only the bound', {timeout: 30_000}, async () => {
  const script = `require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], {stdio: ['ignore', 'ignore', 'inherit'], detached: true}).unref();`;
  const child = spawn(process.execPath, ['-e', script], {stdio: ['ignore', 'ignore', 'pipe']});
  child.stderr?.resume();
  const started = performance.now();
  await drained(child, 300);
  const waited = performance.now() - started;
  assert.ok(waited >= 250 && waited < 3000, `the wait ended at the bound: ${Math.round(waited)} ms`);
  assert.equal(DRAIN_MS, 1000);
});
