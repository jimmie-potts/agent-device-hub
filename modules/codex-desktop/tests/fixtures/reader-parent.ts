// A process that starts the stuck marker reader and waits on its read, as a runtime would (Hub #926), so a test can kill
// it outright and watch the reader go. `node reader-parent.js <Codex home>`; it prints `reading` once the read is sent.
import {folderReader} from '../../src/index.js';

const reader = folderReader(new URL('./blocking-reader.js', import.meta.url));
void reader.read(process.argv[2] ?? '', '').catch(() => {});
process.stdout.write('reading\n');
// The read never settles: this process waits until it is killed.
setInterval(() => {}, 60_000);
