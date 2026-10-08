// What a signal does to the runtime's migration tools once they have written their line (Hub #1003): the shared
// `abortOnSignals` keeps its listeners until the first signal, so a SIGINT or SIGTERM that arrives between the line and
// the process's exit aborts nothing that still runs, and the process exits with the code the line reports, never by the
// signal. The runtime README's Offline tools section says so for both tools. Each tool runs from its real entry point,
// held open after its line by a preloaded keep-alive that adds no signal listener.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {EXIT as NANOLEAF_EXIT} from '../src/nanoleaf-migration.js';
import {EXIT as PIXOO_EXIT} from '../src/pixoo-migration.js';
import {it, waitFor} from './support.js';

const KEEP_ALIVE = new URL('./fixtures/keep-alive.js', import.meta.url).href;
const ENTRIES = [
  ['pixoo', fileURLToPath(new URL('../src/migrate-pixoo.js', import.meta.url)), PIXOO_EXIT.usage],
  ['nanoleaf', fileURLToPath(new URL('../src/migrate-nanoleaf.js', import.meta.url)), NANOLEAF_EXIT.usage],
] as const;

it('a SIGINT or SIGTERM after a tool\'s line leaves the exit code the line reports', async () => {
  for (const [tool, entry, usage] of ENTRIES) {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      // A malformed command line: the tool refuses at once with its usage line and exit 2.
      const child = spawn(process.execPath, ['--import', KEEP_ALIVE, entry, 'migrate'], {stdio: ['pipe', 'pipe', 'pipe']});
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
      const exited = once(child, 'exit') as Promise<[number | null, NodeJS.Signals | null]>;
      await waitFor(() => stderr.includes('settled'), 15_000, `${tool}: the entry point set its exit code`);
      assert.ok(stdout.endsWith('\n'), `${tool}: the line came first`);
      assert.equal(child.kill(signal), true, `${tool} ${signal}: the signal was sent`);
      // A signal the entry point no longer listens for ends the process before it reads the end of its stdin.
      child.stdin.end();
      const [code, killed] = await exited;
      assert.deepEqual([code, killed], [usage, null], `${tool} ${signal}: the process exits with the line's code, not by the signal`);
      const lines = stdout.split('\n').filter(line => line !== '');
      assert.equal(lines.length, 1, `${tool} ${signal}: one line`);
      assert.equal((JSON.parse(lines[0] ?? '{}') as {code?: string}).code, 'usage');
    }
  }
});
