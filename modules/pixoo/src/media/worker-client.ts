import {fork} from 'node:child_process';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {MediaError, RENDERER_VERSION, type MediaLimits, type MediaProfile, type Rendition, type Transform} from './contracts.js';
import {invalidTransfer, readFrame, readHeader, type RenderHeader} from './worker-transfer.js';

export interface WorkerRequest {input: string; output: string; sourceHash: string; id: string; transform: Transform; profile: MediaProfile; limits: MediaLimits}
export function signalError(signal: AbortSignal): MediaError {
  return new MediaError(signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError' ? 'timeout' : 'cancelled');
}
const WORKER_CODES: readonly string[] = ['invalid-input', 'unsupported', 'upload-limit', 'pixel-limit', 'profile-limit', 'decode-failed'];
const hash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
/**
 * Isolate native decoding in a child with a 256 MiB V8 heap and bounded source pixels. Transfer one bounded frame at
 * a time, acknowledged only after the parent writes it. The child never writes state and receives no output path.
 * Abort kills the owned child. Settle only after actual child close AND all parent writes, keeping the caller's slot
 * and staging alive until then. Parent exit can leave a decoder, but cannot leave a descendant rendition writer.
 */
export function runWorker(request: WorkerRequest, signal: AbortSignal, entry = new URL('./worker.js', import.meta.url)): Promise<void> {
  if (signal.aborted) return Promise.reject(signalError(signal));
  return new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(entry), {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: ['--max-old-space-size=256'],
      env: {PATH: process.env.PATH, SystemRoot: process.env.SystemRoot}, serialization: 'advanced',
    });
    let header: RenderHeader | undefined;
    const frames: Rendition['frames'] = [];
    let success = false;
    let busy = false;
    let writing: Promise<void> = Promise.resolve();
    let failure: MediaError | undefined;
    const fail = (error: MediaError): void => { failure ??= error; child.kill('SIGKILL'); };
    const check = (): void => {
      if (signal.aborted) throw signalError(signal);
      if (failure !== undefined) throw failure;
    };
    const abort = (): void => { failure = signalError(signal); child.kill('SIGKILL'); };
    const ack = (index: number): void => {
      check();
      child.send({ack: index}, error => { if (error !== null) fail(invalidTransfer()); });
    };
    signal.addEventListener('abort', abort, {once: true});
    child.on('message', (message: unknown) => {
      if (failure !== undefined) return;
      try {
        check();
        if (busy || success || message === null || typeof message !== 'object') throw invalidTransfer();
        const answer = message as {header?: unknown; frame?: unknown; ok?: boolean; code?: string};
        if (Object.hasOwn(answer, 'header')) {
          if (header !== undefined || Object.keys(answer).length !== 1) throw invalidTransfer();
          header = readHeader(answer.header, request.profile, request.limits);
          ack(-1);
        } else if (Object.hasOwn(answer, 'frame')) {
          if (header === undefined || Object.keys(answer).length !== 1) throw invalidTransfer();
          const frame = readFrame(answer.frame, header, frames.length);
          busy = true;
          writing = (async () => {
            check();
            await writeFile(join(request.output, `${frame.index}.rgb`), frame.rgb, {flag: 'wx'});
            check();
            await writeFile(join(request.output, `${frame.index}.png`), frame.preview, {flag: 'wx'});
            check();
            frames.push({index: frame.index, delayMs: frame.delayMs, rgbHash: hash(frame.rgb), previewHash: hash(frame.preview)});
            busy = false;
            ack(frame.index);
          })().catch((error: unknown) => { busy = false; fail(error instanceof MediaError ? error : invalidTransfer()); });
        } else if (answer.ok === true && Object.keys(answer).length === 1) {
          if (header === undefined || frames.length !== header.source.frameCount) throw invalidTransfer();
          success = true;
        } else if (answer.ok === false && typeof answer.code === 'string' && Object.keys(answer).length === 2) {
          fail(new MediaError(WORKER_CODES.includes(answer.code) ? answer.code as MediaError['code'] : 'decode-failed'));
        } else throw invalidTransfer();
      } catch (error) { fail(error instanceof MediaError ? error : invalidTransfer()); }
    });
    child.once('error', () => { fail(invalidTransfer()); });
    child.once('close', code => {
      void (async () => {
        await writing;
        check();
        if (code !== 0 || !success || header === undefined) throw invalidTransfer();
        const delays = frames.map(frame => frame.delayMs);
        const manifest: Rendition = {
          id: request.id, sourceHash: request.sourceHash, renderer: RENDERER_VERSION, transform: request.transform, profile: request.profile,
          source: header.source, warnings: header.warnings,
          effectiveDurationMs: delays.every((delay): delay is number => delay !== null) ? delays.reduce((total, delay) => total + delay, 0) : null,
          frames,
        };
        await writeFile(join(request.output, 'manifest.json'), JSON.stringify(manifest), {flag: 'wx'});
        check();
      })().then(resolve, (error: unknown) => reject(error instanceof MediaError ? error : invalidTransfer()))
        .finally(() => { signal.removeEventListener('abort', abort); });
    });
    // The output destination and rendition identity stay in this lease-owning process.
    child.send({input: request.input, sourceHash: request.sourceHash, transform: request.transform, profile: request.profile, limits: request.limits}, error => {
      if (error !== null) fail(invalidTransfer());
    });
    if (signal.aborted) abort();
  });
}
