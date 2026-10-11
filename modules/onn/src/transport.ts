import {createHash} from 'node:crypto';
import {lstatSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {Socket} from 'node:net';
import {Readable} from 'node:stream';
import {AdbServerClient, AdbShellProtocolProcessImpl, AdbShellProtocolSpawner} from '@yume-chan/adb';
import {MaybeConsumable, type ReadableStream as AdbReadable} from '@yume-chan/stream-extra';
import type {ErrorCode} from '@jimmie-potts/event-contracts/v2';
import {CURRENT_APP_COMMAND, currentApp, keyCommand, launchCommand, launcherCommand, textCommand, type App, type CurrentApp, type Key} from './actions.js';
import type {OnnConfig} from './configuration.js';

export type OnnAction = {kind: 'key'; key: Key} | {kind: 'app'; app: App} | {kind: 'text'; text: string};
export type Attempt = {result: 'succeeded' | 'failed' | 'uncertain'; evidence: 'none' | 'transmitted'; code?: ErrorCode};
export type AppObservation = {app?: CurrentApp};
export interface OnnTransport {
  execute(action: OnnAction, signal: AbortSignal, beforeEffect: () => ErrorCode | undefined): Promise<Attempt>;
  read(signal: AbortSignal): Promise<AppObservation | undefined>;
}

/** A fixed refusal never carries a vendor message, private path or input. */
class DependencyUnavailable extends Error {}
class EffectRefused extends Error {constructor(readonly code: ErrorCode) {super();}}
function privateDependency(config: OnnConfig): void {
  const uid = process.getuid?.();
  if (uid === undefined) throw new DependencyUnavailable();
  const directory = (path: string): void => {
    const info = lstatSync(path);
    if (!info.isDirectory() || info.uid !== uid || (info.mode & 0o777) !== 0o700) throw new DependencyUnavailable();
  };
  directory(dirname(config.adbSocket)); directory(config.hostKeyDirectory);
  const socket = lstatSync(config.adbSocket), key = lstatSync(join(config.hostKeyDirectory, 'adbkey')), executable = lstatSync(config.hostExecutable);
  if (!socket.isSocket() || socket.uid !== uid || (socket.mode & 0o777) !== 0o600
    || !key.isFile() || key.uid !== uid || key.nlink !== 1 || (key.mode & 0o777) !== 0o600
    || !executable.isFile() || executable.uid !== uid || (executable.mode & 0o022) !== 0 || (executable.mode & 0o100) === 0
    || createHash('sha256').update(readFileSync(config.hostExecutable)).digest('hex') !== config.hostExecutableSha256) throw new DependencyUnavailable();
}

/** Every ADB convenience-method connection shares this operation's signal. */
class OperationConnector implements AdbServerClient.ServerConnector {
  constructor(readonly path: string, readonly signal: AbortSignal, readonly effect: string | undefined, readonly wrote: () => void, readonly transmitted: () => void) {}
  async connect(options: AdbServerClient.ServerConnectionOptions = {}): Promise<AdbServerClient.ServerConnection> {
    this.signal.throwIfAborted();
    // ADB's web-stream signal type omits DOM members; every connection is still
    // bound to our complete native operation signal, including convenience calls.
    options.signal?.throwIfAborted();
    const socket = new Socket({signal: this.signal});
    if (options.unref === true) socket.unref();
    const readable = Readable.toWeb(socket);
    const closed = new Promise<undefined>(resolve => socket.once('close', () => resolve(undefined)));
    await new Promise<void>((resolve, reject) => {
      const failed = (error: Error): void => {socket.off('connect', connected); reject(error);};
      const connected = (): void => {socket.off('error', failed); resolve();};
      socket.once('error', failed); socket.once('connect', connected); socket.connect({path: this.path});
    });
    const writable = new MaybeConsumable.WritableStream<Uint8Array>({
      write: chunk => new Promise<void>((resolve, reject) => {
        this.signal.throwIfAborted();
        const effect = this.effect !== undefined && Buffer.from(chunk).subarray(4).toString() === `shell,v2,raw:${this.effect}`;
        if (effect) this.wrote();
        socket.write(chunk, error => {
          if (error) reject(error);
          else {if (effect) this.transmitted(); resolve();}
        });
      }),
      close: () => {socket.end();}, abort: () => {socket.destroy();},
    });
    // Node and the library use the same WHATWG streams; their declarations differ
    // only in closed resolving void versus undefined.
    return {readable: readable as unknown as AdbReadable<Uint8Array>, writable, closed, close: () => {socket.destroy();}};
  }
  addReverseTunnel(): never {throw new DependencyUnavailable();}
  removeReverseTunnel(): never {throw new DependencyUnavailable();}
  clearReverseTunnels(): never {throw new DependencyUnavailable();}
}

async function boundedText(stream: AdbReadable<Uint8Array>, signal: AbortSignal): Promise<string> {
  const reader = stream.getReader(), parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const next = await reader.read();
      if (next.done) return new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(parts));
      size += next.value.byteLength;
      if (size > 16_384) throw new DependencyUnavailable();
      parts.push(next.value);
    }
  } finally {reader.releaseLock();}
}

export class AdbTransport implements OnnTransport {
  constructor(readonly config: OnnConfig) {}
  async #shell(command: string, signal: AbortSignal, effect: boolean, wrote: () => void, transmitted: () => void): Promise<{stdout: string; stderr: string; exitCode: number}> {
    signal.throwIfAborted();
    privateDependency(this.config);
    const end = new AbortController(), lifetime = AbortSignal.any([signal, end.signal]);
    const client = new AdbServerClient(new OperationConnector(this.config.adbSocket, lifetime, effect ? command : undefined, wrote, transmitted));
    const service = new AdbShellProtocolSpawner(async (parts, operationSignal) => {
      const socket = await client.createDeviceConnection({serial: this.config.serial}, `shell,v2,raw:${parts.join(' ')}`);
      operationSignal?.throwIfAborted();
      return new AdbShellProtocolProcessImpl(socket, operationSignal);
    });
    try {
      const process = await service.spawn(command, lifetime);
      const [stdout, stderr, exitCode] = await Promise.all([boundedText(process.stdout, lifetime), boundedText(process.stderr, lifetime), process.exited]);
      return {stdout, stderr, exitCode};
    } finally {end.abort();}
  }
  async execute(action: OnnAction, signal: AbortSignal, beforeEffect: () => ErrorCode | undefined = () => undefined): Promise<Attempt> {
    let possible = false, sent = false;
    const wrote = (): void => {const code = beforeEffect(); if (code !== undefined) throw new EffectRefused(code); possible = true;}, transmitted = (): void => {sent = true;};
    try {
      let command: string | undefined;
      if (action.kind === 'key') command = keyCommand(action.key);
      else if (action.kind === 'text') command = textCommand(action.text);
      else {
        const resolve = launcherCommand(action.app);
        if (resolve === undefined) return {result: 'failed', evidence: 'none', code: 'unsupported-capability'};
        const launcher = await this.#shell(resolve, signal, false, wrote, transmitted);
        if (launcher.exitCode !== 0 || launcher.stderr !== '') return {result: 'failed', evidence: 'none', code: 'not-found'};
        command = launchCommand(action.app, launcher.stdout);
      }
      if (command === undefined) return {result: 'failed', evidence: 'none', code: 'unsupported-capability'};
      const response = await this.#shell(command, signal, true, wrote, transmitted);
      const launchOkay = action.kind !== 'app' || /^Status: ok\r?$/m.test(response.stdout);
      const outputOkay = action.kind === 'app' || response.stdout === '';
      if (response.exitCode !== 0 || response.stderr !== '' || !launchOkay || !outputOkay) return {result: 'uncertain', evidence: sent ? 'transmitted' : 'none', code: 'uncertain-result'};
      return {result: 'succeeded', evidence: 'transmitted'};
    } catch (error) {
      if (error instanceof EffectRefused) return {result: 'failed', evidence: 'none', code: error.code};
      return {result: possible ? 'uncertain' : 'failed', evidence: sent ? 'transmitted' : 'none', code: possible ? 'uncertain-result' : 'unavailable'};
    }
  }
  async read(signal: AbortSignal): Promise<AppObservation | undefined> {
    try {
      const result = await this.#shell(CURRENT_APP_COMMAND, signal, false, () => {}, () => {});
      if (result.exitCode !== 0 || result.stderr !== '') return undefined;
      const app = currentApp(result.stdout);
      return app === undefined ? {} : {app};
    } catch {return undefined;}
  }
}
