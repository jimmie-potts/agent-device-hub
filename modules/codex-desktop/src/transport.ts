// How the Codex Desktop module reaches its marker (Hub #926): `folderReader`, which reads the real Codex home in a child
// process of its own, or `SimulatedMarker` (simulated.ts), which tests and disposable runs use.
//
// The Codex home lies on a Windows mount (`/mnt/c`), whose file system calls can stall for as long as the mount does. A
// thread blocked in such a call cannot be stopped: a worker thread's `terminate()` and even `process.exit()` wait for it
// (measured on Node 24 with a FIFO's open, 2026-10-07), and the libuv pool's threads are the whole process's. So the
// reader runs in its own process, and the runtime never waits for it: a read that stalls only leaves this module without
// read evidence, the module's stop kills the reader, and the runtime still stops and exits. A runtime killed outright
// leaves none behind either: the reader's main thread stays free, hears its channel close and kills itself (serve.ts).
import {fork, type ChildProcess} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {markerReadOf, type MarkerRead} from './marker.js';

export type {MarkerRead} from './marker.js';

export interface MarkerTransport {
  /**
   * Reads the marker in `home` unless its stamp is still `stamp`. It rejects when the read failed, as when the reader
   * ended, and it may never settle while the folder stalls: the module gives each read its own deadline.
   */
  read(home: string, stamp: string): Promise<MarkerRead>;
  /** Ends what the transport holds, such as the reader's process. A read still under way may then never settle. */
  close(): void;
}

/** The reader's program: the module's own `reader.js`, beside this file once built. */
const READER = new URL('./reader.js', import.meta.url);

type Waiting = {resolve: (read: MarkerRead) => void; reject: (error: Error) => void};
/** One reader process and the reads it still owes. */
type Reader = {child: ChildProcess; waiting: Map<number, Waiting>};

/** Reads the marker in a child process of its own, started on the first read and again after it ended. */
class FolderReader implements MarkerTransport {
  readonly #program: URL;
  #reader: Reader | undefined;
  #next = 0;

  constructor(program: URL) {
    this.#program = program;
  }

  read(home: string, stamp: string): Promise<MarkerRead> {
    return new Promise((resolve, reject) => {
      const reader = this.#reader ?? this.#start();
      this.#next += 1;
      const id = this.#next;
      reader.waiting.set(id, {resolve, reject});
      reader.child.send({id, home, stamp}, error => {
        if (error === null || !reader.waiting.delete(id)) return;
        reject(new Error('the marker reader did not take the read'));
      });
    });
  }

  close(): void {
    const reader = this.#reader;
    this.#reader = undefined;
    // A reader blocked in a stalled call ends once the call returns; nothing waits for it.
    reader?.child.kill('SIGKILL');
  }

  #start(): Reader {
    // The reader gets no arguments, so no path shows in the process list; each read names the home over the channel.
    const child = fork(fileURLToPath(this.#program), [], {stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'json', execArgv: []});
    const reader: Reader = {child, waiting: new Map()};
    this.#reader = reader;
    // The reader never keeps the runtime's process alive.
    child.unref();
    child.channel?.unref();
    child.on('message', (reply: unknown) => {
      const {id, result} = typeof reply === 'object' && reply !== null ? reply as {id?: unknown; result?: unknown} : {};
      const waiting = typeof id === 'number' ? reader.waiting.get(id) : undefined;
      if (waiting === undefined || typeof id !== 'number') return;
      reader.waiting.delete(id);
      waiting.resolve(markerReadOf(result));
    });
    const ended = (): void => {
      if (this.#reader === reader) this.#reader = undefined;
      for (const waiting of reader.waiting.values()) waiting.reject(new Error('the marker reader ended'));
      reader.waiting.clear();
    };
    child.once('exit', ended);
    // A reader that cannot start, or whose channel fails, is ended too.
    child.on('error', () => {
      ended();
      child.kill('SIGKILL');
    });
    return reader;
  }
}

/**
 * The real Codex home's reader: one child process, `reader.js`, that reads the marker and answers over its IPC channel.
 * `program` replaces it, for a test that needs a reader that never answers.
 */
export const folderReader = (program: URL = READER): MarkerTransport => new FolderReader(program);
