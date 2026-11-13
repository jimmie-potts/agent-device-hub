// A Codex Desktop marker reader that is stuck in a file system call (Hub #926): it reads the marker with a plain blocking
// open, and the tests make the marker a FIFO with no writer, so its `open` never returns, as a read on a stalled Windows
// mount would not. It serves reads as the module's own reader does; that one never blocks on a FIFO.
import {join} from 'node:path';
import {open, writeFile} from 'node:fs/promises';
import {MARKER_FILE, serveReads} from '@jimmie-potts/codex-desktop';

serveReads(async home => {
  const marker = join(home, MARKER_FILE);
  // Dispatch the blocking open first, then signal the test without opening the FIFO for writing.
  const [file] = await Promise.all([open(marker, 'r'), writeFile(`${marker}.opening`, '', {mode: 0o600})]);
  await file.close();
  return {status: 'retry'};
});
