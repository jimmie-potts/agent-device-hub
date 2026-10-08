// A marker reader for the transport's tests (Hub #926) that reads the marker with a plain blocking open, so a marker that
// is a FIFO with no writer holds the read in `open`, a file system call that does not return, as a read on a stalled
// mount would. It serves reads as the module's own reader does (serve.ts); that one never blocks on a FIFO.
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {MARKER_FILE} from '../../src/marker.js';
import {serveReads} from '../../src/serve.js';

serveReads(async home => {
  await readFile(join(home, MARKER_FILE));
  return {status: 'retry'};
});
