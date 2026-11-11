// Which real work is in flight in this process, so the in-memory harness pauses in real time only while some is (Hub
// #1685). Virtual time runs much faster than real time, so work that runs outside this thread, such as image encoding on
// the thread pool, a module's media process or a file write, finishes within a scenario's virtual window only if the
// harness gives it real time. The harness learns of that work from Node's async hooks, without any module's help: each
// piece of such work is an asynchronous resource that Node creates when the work starts and calls back once when it ends.
import {createHook} from 'node:async_hooks';

/**
 * Resource kinds that are not themselves work in flight, so they never hold a pause. Connections, listeners, pipes,
 * open files and other handles last as long as their owner keeps them and call back many times; what passes over them
 * is this thread's work, which the harness's turns run. A module's worker thread is held separately: the harness waits
 * for each worker call itself. Timers, immediates, ticks, microtasks, promises and the test runner's own tests are this
 * thread's scheduling.
 */
export const IDLE_KINDS: ReadonlySet<string> = new Set([
  'DIRHANDLE', 'DNSCHANNEL', 'ELDHISTOGRAM', 'FILEHANDLE', 'FSEVENTWRAP', 'HEAPSNAPSHOT', 'HTTPCLIENTREQUEST', 'HTTPINCOMINGMESSAGE',
  'Immediate', 'INSPECTORJSBINDING', 'JSSTREAM', 'JSUDPWRAP', 'MESSAGEPORT', 'Microtask', 'PIPESERVERWRAP', 'PIPEWRAP', 'PROMISE',
  'SIGINTWATCHDOG', 'SIGNALWRAP', 'STATWATCHER', 'STREAM_END_OF_STREAM', 'TCPSERVERWRAP', 'TCPWRAP', 'Test', 'TickObject', 'Timeout',
  'TLSWRAP', 'TTYWRAP', 'UDPWRAP', 'WORKER', 'WORKERHEAPSNAPSHOT',
]);

/**
 * Whether a resource kind is a cryptography job, such as `RANDOMBYTESREQUEST` or `HASHREQUEST`. Node also runs these
 * synchronously, as `randomUUID` and `randomFillSync` do; such a job never calls back, and Node ends it only when it is
 * collected, so it counts only until its synchronous run returns its result.
 */
const isCryptoJob = (kind: string): boolean => kind.endsWith('REQUEST');

/** The work in flight in this process: each resource's id and its kind. */
const flight = new Map<number, string>();
let watching = false;

/** What `realWork` reports. */
export type RealWork = {
  /** Whether any real work is in flight now. */
  busy: () => boolean;
  /** The kinds in flight now, each with how many, for a test or a diagnosis. */
  kinds: () => ReadonlyMap<string, number>;
};

const view: RealWork = {
  busy: () => flight.size > 0,
  kinds: () => {
    const counts = new Map<string, number>();
    for (const kind of flight.values()) counts.set(kind, (counts.get(kind) ?? 0) + 1);
    return counts;
  },
};

/** A cryptography job's resource, whose `run` returns its result at once when the job runs synchronously. */
type Job = {run?: (...args: unknown[]) => unknown};

/**
 * Counts every other kind as work in flight from its start until its first callback or its end, whichever comes first:
 * the thread pool's requests (file system, image encoding through an addon, compression, cryptography, name lookups),
 * connects, writes and shutdowns, and a child process until it exits. A kind Node adds later counts as work too, so the
 * harness errs towards pausing.
 */
function started(id: number, kind: string, resource: object): void {
  if (IDLE_KINDS.has(kind)) return;
  flight.set(id, kind);
  if (!isCryptoJob(kind)) return;
  const job = resource as Job;
  const run = job.run;
  if (typeof run !== 'function') return;
  job.run = function (this: unknown, ...args: unknown[]): unknown {
    const result = run.apply(this, args);
    // A synchronous run returns its error and result; an asynchronous one calls back later.
    if (Array.isArray(result)) flight.delete(id);
    return result;
  };
}

/** The real pause one turn takes while real work is in flight, as every turn took before Hub #1685. */
export const PAUSE_MS = 1;

const realSleep = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });

/**
 * Gives real work its turn: a few turns of the event loop, which run the I/O callbacks that are ready, and then, only
 * while `pause` says real work is still in flight, `PAUSE_MS` of real time through `sleep`, so virtual time waits for
 * that work.
 */
export async function settle(pause: () => boolean, sleep: (ms: number) => Promise<void> = realSleep): Promise<void> {
  for (let turn = 0; turn < 4; turn += 1) await new Promise(resolve => { setImmediate(resolve); });
  if (pause()) await sleep(PAUSE_MS);
}

/**
 * Starts watching this process's real work, once per process, and returns the view of it. Work that started before the
 * first call is not seen, so the harness calls it before it starts a runtime.
 */
export function realWork(): RealWork {
  if (!watching) {
    watching = true;
    createHook({
      init: (id, kind, _trigger, resource) => { started(id, kind, resource); },
      after: id => { flight.delete(id); },
      destroy: id => { flight.delete(id); },
    }).enable();
  }
  return view;
}
