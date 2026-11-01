import {spawn} from 'node:child_process';
import type {Readable, Writable} from 'node:stream';
import {CodexReadObserver} from './codex-observer.js';
import {openCodexReadPublisher, type CodexReadPublisher} from './codex-publisher.js';

export type CodexProxyOptions = {
  native: string; args: string[]; input: Readable; output: Writable; errors: Writable;
  producer?: string; env?: NodeJS.ProcessEnv;
};
export async function runCodexProxy(options: CodexProxyOptions): Promise<{code: number | null; signal: NodeJS.Signals | null}> {
  const child = spawn(options.native, options.args, {stdio: ['pipe', 'pipe', 'pipe'], ...(options.env === undefined ? {} : {env: options.env})});
  let publisher: CodexReadPublisher | undefined, ended = false;
  const observer = new CodexReadObserver({bind: (thread, turn) => publisher?.bind(thread, turn), accept: receipt => {publisher?.accept(receipt);}});
  const client = (bytes: Buffer) => {observer.observe('client', bytes);}, server = (bytes: Buffer) => {observer.observe('server', bytes);};
  const failed = () => {observer.close();};
  options.input.on('data', client); child.stdout.on('data', server);
  child.stdin.on('error', failed); child.stdout.on('error', failed); child.stderr.on('error', failed);
  options.input.pipe(child.stdin); child.stdout.pipe(options.output, {end: false}); child.stderr.pipe(options.errors, {end: false});
  const terminate = () => {child.kill('SIGTERM');}, interrupt = () => {child.kill('SIGINT');};
  process.on('SIGTERM', terminate); process.on('SIGINT', interrupt);
  if (options.producer !== undefined) {
    void openCodexReadPublisher(options.producer, () => {observer.reset();}).then(opened => {
      if (ended) void opened?.close(); else publisher = opened;
    }, failed);
  }
  try {
    const result = await new Promise<{code: number | null; signal: NodeJS.Signals | null}>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => {resolve({code, signal});});
    });
    for (const output of [options.output, options.errors]) {
      if (!output.destroyed) await new Promise<void>(resolve => {output.write('', () => {resolve();});});
    }
    return result;
  } finally {
    ended = true; observer.close();
    options.input.unpipe(child.stdin); options.input.removeListener('data', client); child.stdout.removeListener('data', server);
    process.removeListener('SIGTERM', terminate); process.removeListener('SIGINT', interrupt);
    // Native completion is never delayed by a slow or unavailable SDK connection.
    void publisher?.close();
  }
}
