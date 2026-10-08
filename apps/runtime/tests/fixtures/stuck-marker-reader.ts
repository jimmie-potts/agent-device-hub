// A Codex Desktop marker reader that is stuck in a file system call (Hub #926): it reads the marker with a plain blocking
// open, and the tests make the marker a FIFO with no writer, so its `open` never returns, as a read on a stalled Windows
// mount would not. It serves reads as the module's own reader does; that one never blocks on a FIFO.
import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {MARKER_FILE, serveReads} from '@jimmie-potts/codex-desktop';

serveReads(async home => {
  await readFile(join(home, MARKER_FILE));
  return {status: 'retry'};
});
