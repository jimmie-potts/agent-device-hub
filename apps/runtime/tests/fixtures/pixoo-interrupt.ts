// The Pixoo migration stopped by a real signal mid-copy (Hub #931, #1546), run by pixoo-migration.test.ts as a child
// process: `node pixoo-interrupt.js <tool arguments...>`. It runs the shipped entry point, migrate-pixoo.js, unchanged,
// after replacing the library's file read in this process only: the ninth read, with the first files already copied,
// writes `paused copy` to stderr and waits for a SIGINT or SIGTERM, so the test signals while the tool writes, however
// slow the host. Its stdout is the tool's one line, and its exit code the tool's.
import {InstalledLibrary} from '@jimmie-potts/pixoo';

const PAUSE_AT = 9;
const signalled = new Promise<void>(resolve => {
  const names = ['SIGINT', 'SIGTERM'] as const;
  // Both go with the first signal, as the entry point's own listeners do, so a second signal still stops the process.
  const heard = (): void => {
    for (const name of names) process.removeListener(name, heard);
    resolve();
  };
  for (const name of names) process.once(name, heard);
});
const read = Object.getOwnPropertyDescriptor(InstalledLibrary.prototype, 'read')?.value as InstalledLibrary['read'];
let reads = 0;
InstalledLibrary.prototype.read = async function pausedRead(this: InstalledLibrary, file) {
  reads += 1;
  if (reads === PAUSE_AT) {
    process.stderr.write('paused copy\n');
    // The timer keeps the process alive while it waits, as the tool's own work would; without a signal, the copy goes on
    // after 30 s, so a test run never hangs for good. The entry point's listener has aborted the tool by the time this
    // resumes: both listeners run before any promise callback.
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([signalled, new Promise(resolve => { timer = setTimeout(resolve, 30_000); })]);
    clearTimeout(timer);
  }
  return read.call(this, file);
};
await import('../../src/migrate-pixoo.js');
