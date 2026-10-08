// What a signal does to the runtime's migration tools once they have written their line (Hub #1003): the shared
// `abortOnSignals` keeps its listeners until the first signal, so a SIGINT or SIGTERM that arrives between the line and
// the process's exit aborts nothing that still runs, and the process exits with the code the line reports, never by the
// signal. The runtime README's Offline tools section says so for both tools.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {EXIT as NANOLEAF_EXIT} from '../src/nanoleaf-migration.js';
import {EXIT as PIXOO_EXIT} from '../src/pixoo-migration.js';
import {it, waitFor} from './support.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/signal-after-line.js', import.meta.url));

it('a SIGINT or SIGTERM after a tool\'s line leaves the exit code the line reports', async () => {
  for (const [tool, usage] of [['pixoo', PIXOO_EXIT.usage], ['nanoleaf', NANOLEAF_EXIT.usage]] as const) {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      // A malformed command line: the tool refuses at once with its usage line and exit 2.
      const child = spawn(process.execPath, [FIXTURE, tool, 'migrate'], {stdio: ['ignore', 'pipe', 'pipe']});
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
      const exited = once(child, 'exit') as Promise<[number | null, NodeJS.Signals | null]>;
      await waitFor(() => stderr.includes('written'), 15_000, `${tool}: the line`);
      child.kill(signal);
      const [code, killed] = await exited;
      assert.deepEqual([code, killed], [usage, null], `${tool} ${signal}: the process exits with the line's code, not by the signal`);
      const lines = stdout.split('\n').filter(line => line !== '');
      assert.equal(lines.length, 1, `${tool} ${signal}: one line`);
      assert.equal((JSON.parse(lines[0] ?? '{}') as {code?: string}).code, 'usage');
    }
  }
});
