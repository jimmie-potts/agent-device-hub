// A migration tool's entry point, held open after its line (Hub #1003), run by migration-signals.test.ts as a child
// process. It runs the named tool as its entry point does, with `abortOnSignals()`, writes `written` to stderr once the
// tool has written its line, and stays up for a second, so the test can send a signal in the moment between the
// line and the process's exit that an entry point has. Its stdout is the tool's line, and its exit code the tool's.
//   node signal-after-line.js <pixoo|nanoleaf> <tool arguments...>
import {runNanoleafMigration} from '../../src/nanoleaf-migration.js';
import {runPixooMigration} from '../../src/pixoo-migration.js';
import {abortOnSignals} from '../../src/signals.js';

const [tool, ...argv] = process.argv.slice(2);
const run = tool === 'pixoo' ? runPixooMigration : runNanoleafMigration;
process.exitCode = await run(argv, {write: line => { process.stdout.write(line); }, signal: abortOnSignals()});
process.stderr.write('written\n');
setTimeout(() => {}, 1000);
