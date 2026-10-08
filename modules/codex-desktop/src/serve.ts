// The marker reader's process loop (Hub #926), which reader.ts runs with the marker's read, and a test's stuck reader
// with its own: each message on the IPC channel names a Codex home and the last stamp, and the answer is one
// `MarkerRead`. A read is asynchronous, so one stuck on a stalled mount holds a thread of the libuv pool while the main
// thread still hears its parent go. The reader then ends itself by signal, at once: a runtime killed during a stall
// leaves no reader behind, and `process.exit` would wait for the stuck read (transport.ts).
import type {MarkerRead} from './marker.js';

/** One read of the marker in `home` unless its stamp is still `stamp`. */
export type ReadMarker = (home: string, stamp: string) => Promise<MarkerRead>;

/** Answers each read request from the parent with `read`, and ends the process when the parent goes. */
export function serveReads(read: ReadMarker): void {
  process.on('message', (request: unknown) => {
    const {id, home, stamp} = typeof request === 'object' && request !== null ? request as {id?: unknown; home?: unknown; stamp?: unknown} : {};
    if (typeof id !== 'number' || typeof home !== 'string' || typeof stamp !== 'string') return;
    void read(home, stamp).catch((): MarkerRead => ({status: 'read', stamp: '', unread: null})).then(result => {
      // A parent that went meanwhile gets nothing: the disconnect ends this process.
      if (process.connected) process.send?.({id, result}, undefined, undefined, () => {});
    });
  });
  process.on('disconnect', () => { process.kill(process.pid, 'SIGKILL'); });
}
