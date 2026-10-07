// A module's bounded worker calls (Hub #919): one request and one reply in a new worker thread, with a deadline, ended
// when the module stops. The runtime and the module test kit's harness both give a module its `workers.call` with this,
// so a module behaves the same under each. A failed call rejects with a registry code and a fixed detail; what the
// worker threw stays in memory as the error's cause and never reaches its message. A call refused before its worker
// starts had no effect. Once the worker has the request, every ending but its reply is `uncertain-result`, because
// the worker may have done part of its work (ADR 0012: a rejection proves no effect, and cancellation is not undo).
import {Worker} from 'node:worker_threads';
import {errorBody, type ErrorCode} from '@jimmie-potts/event-contracts/v2';
import {MAX_WORKER_CALLS, type WorkerCallOptions} from './module.js';
import {MAX_TIMEOUT_MS, SdkError, type Scheduler} from './sdk.js';

export type WorkerCallsOptions = {
  /** Runs each call's deadline: the runtime's scheduler. */
  scheduler: Scheduler;
  /** The module's signal: aborting it cancels every call and refuses new ones. */
  signal: AbortSignal;
  /** Hears of each worker a call starts, so that the host terminates it at the module's stop and counts it until it exits. */
  track: (worker: Worker) => void;
};

const failure = (code: ErrorCode, detail: string, cause?: unknown): SdkError =>
  new SdkError(errorBody(code, {detail}), cause === undefined ? undefined : {cause});

/** One module's worker calls. */
export class WorkerCalls {
  readonly #options: WorkerCallsOptions;
  #running = 0;

  constructor(options: WorkerCallsOptions) {
    this.#options = options;
  }

  /** Runs one call; see `Workers.call`. */
  call<Reply = unknown>(file: URL, request: unknown, {timeoutMs, signal, transferList}: WorkerCallOptions): Promise<Reply> {
    const {scheduler, signal: module, track} = this.#options;
    if (module.aborted) return Promise.reject(failure('invalid-state', 'the module has stopped'));
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
      return Promise.reject(failure('invalid-request', `timeoutMs must be an integer from 1 to ${MAX_TIMEOUT_MS}`));
    }
    if (signal?.aborted === true) return Promise.reject(failure('cancelled', 'the call was cancelled'));
    if (this.#running >= MAX_WORKER_CALLS) return Promise.reject(failure('capacity', `the module already has ${MAX_WORKER_CALLS} worker calls running`));
    let worker: Worker;
    try {
      worker = new Worker(file, {workerData: request, ...(transferList === undefined ? {} : {transferList: [...transferList]})});
    } catch (error) {
      return Promise.reject(failure('internal', 'the worker could not start', error));
    }
    this.#running += 1;
    track(worker);
    return new Promise<Reply>((resolve, reject) => {
      let done = false;
      let cancelDeadline = (): void => {};
      // From here on the worker has the request, so no ending but its reply proves that nothing happened.
      const uncertain = (detail: string, cause?: unknown): void => { end(() => { reject(failure('uncertain-result', detail, cause)); }); };
      const stopped = (): void => { uncertain('the module stopped while the worker had the request'); };
      const cancelled = (): void => { uncertain('the call was cancelled while the worker had the request'); };
      /** Settles the call once, and ends its worker, its deadline and its listeners whichever way it ended. */
      const end = (settle: () => void): void => {
        if (done) return;
        done = true;
        this.#running -= 1;
        cancelDeadline();
        module.removeEventListener('abort', stopped);
        signal?.removeEventListener('abort', cancelled);
        void worker.terminate();
        settle();
      };
      worker.once('message', (reply: Reply) => { end(() => { resolve(reply); }); });
      worker.once('error', error => { uncertain('the worker failed', error); });
      worker.once('messageerror', error => { uncertain('the worker\'s reply could not be read', error); });
      worker.once('exit', () => { uncertain('the worker ended without a reply'); });
      module.addEventListener('abort', stopped, {once: true});
      signal?.addEventListener('abort', cancelled, {once: true});
      cancelDeadline = scheduler.after(timeoutMs, () => { uncertain(`the worker did not reply within ${timeoutMs} ms`); });
    });
  }
}
