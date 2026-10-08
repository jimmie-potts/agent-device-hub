// The Nanoleaf migration stopped by a real signal mid-run (Hub #933), run by nanoleaf-migration.test.ts as a child
// process. It runs the tool as its entry point does, with `abortOnSignals()`, and pauses at the named stage of the write
// until a signal comes, writing `paused <stage>` to stderr so the test sends the signal then. Its stdout is the tool's
// one line, and its exit code the tool's.
//   node nanoleaf-interrupt.js <stage> <tool arguments...>
import {runNanoleafMigration, type Stage} from '../../src/nanoleaf-migration.js';
import {abortOnSignals} from '../../src/signals.js';

const [pauseAt, ...argv] = process.argv.slice(2);
const signal = abortOnSignals();
const pause = (name: Stage): Promise<void> => {
  if (name !== pauseAt) return Promise.resolve();
  process.stderr.write(`paused ${name}\n`);
  return new Promise(resolve => {
    // The timer keeps the process alive while it waits, as the tool's own work would; without a signal, the run goes on
    // after 30 s, so a test run never hangs for good.
    const timer = setTimeout(resolve, 30_000);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, {once: true});
  });
};
process.exitCode = await runNanoleafMigration(argv, {write: line => { process.stdout.write(line); }, signal, stage: pause});
