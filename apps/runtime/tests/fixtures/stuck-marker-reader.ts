// A Codex Desktop marker reader that is stuck in a file system call (Hub #926): it reads the marker with a plain blocking
// read, and the tests make the marker a FIFO with no writer, so its `open` never returns, as a read on a stalled Windows
// mount would not. The module's own reader never blocks on a FIFO; this one stands in for a stalled mount.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

process.on('message', (request: unknown) => {
  const {id, home} = request as {id: number; home: string};
  readFileSync(join(home, '.codex-global-state.json'));
  process.send?.({id, result: {status: 'retry'}});
});
process.on('disconnect', () => { process.exit(0); });
