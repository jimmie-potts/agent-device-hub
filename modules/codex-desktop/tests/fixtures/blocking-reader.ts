// A marker reader for the transport's tests (Hub #926) that reads the marker with a plain blocking read, so a marker that
// is a FIFO with no writer blocks it in `open`, a file system call that does not return, as a read on a stalled mount
// would. The module's own reader never blocks on a FIFO.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

process.on('message', (request: unknown) => {
  const {id, home} = request as {id: number; home: string};
  readFileSync(join(home, '.codex-global-state.json'));
  process.send?.({id, result: {status: 'retry'}});
});
process.on('disconnect', () => { process.exit(0); });
