import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {MediaError, type MediaLimits, type MediaProfile, type Transform} from './contracts.js';

export interface WorkerRequest {input: string; output: string; sourceHash: string; id: string; transform: Transform; profile: MediaProfile; limits: MediaLimits}
export function signalError(signal: AbortSignal): MediaError {
  return new MediaError(signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError' ? 'timeout' : 'cancelled');
}
const WORKER_CODES: readonly string[] = ['invalid-input', 'unsupported', 'upload-limit', 'pixel-limit', 'profile-limit', 'decode-failed'];
/**
 * Decodes and renders one source in a forked child process, so a bad or hostile image cannot exhaust the runtime's
 * memory or stop it. `--max-old-space-size=256` caps only V8's old space; decoded pixels live in buffers outside it,
 * which the media limits bound instead: a GIF's declared canvas (at most 4096 x 4096, about 200 MiB of child memory at
 * that size) and a still's pixel count (libvips shrinks stills as it loads them, about 80 MiB for 49 megapixels). An
 * abort kills the child with SIGKILL. The promise settles only once the child has exited, so the caller's slot and
 * staging folder are released after it is gone.
 */
export function runWorker(request: WorkerRequest, signal: AbortSignal, entry = new URL('./worker.js', import.meta.url)): Promise<void> {
  if (signal.aborted) return Promise.reject(signalError(signal));
  return new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(entry), {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: ['--max-old-space-size=256'],
      env: {PATH: process.env.PATH, SystemRoot: process.env.SystemRoot}, serialization: 'advanced',
    });
    let success = false;
    let failure: MediaError | undefined;
    const abort = (): void => {
      failure = signalError(signal);
      child.kill('SIGKILL');
    };
    signal.addEventListener('abort', abort, {once: true});
    child.on('message', message => {
      const answer = message as {ok?: boolean; code?: string} | null;
      if (answer?.ok === true) success = true;
      else {
        const code = answer?.code ?? '';
        failure = new MediaError(WORKER_CODES.includes(code) ? code as MediaError['code'] : 'decode-failed');
      }
    });
    child.once('error', () => { failure ??= new MediaError('decode-failed'); });
    // Reap the process before releasing the caller's slot or staging.
    child.once('close', code => {
      signal.removeEventListener('abort', abort);
      if (failure !== undefined) reject(failure);
      else if (code === 0 && success) resolve();
      else reject(new MediaError('decode-failed'));
    });
    child.send(request, error => {
      if (error !== null) {
        failure ??= new MediaError('decode-failed');
        child.kill('SIGKILL');
      }
    });
  });
}
