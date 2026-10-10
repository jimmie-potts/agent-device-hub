import {fork, type ChildProcess} from 'node:child_process';
import {mkdir, open, type FileHandle} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {SdkError} from '@jimmie-potts/sdk';
import {UUID, type Adapter, type Gatt} from './transport.js';
export type NativeOptions = {targetAddress: string; adapterAddress: string; logDirectory: string; ownsWriter: () => boolean; launch?: (signal: AbortSignal) => Promise<Gatt>};
const refused = (): SdkError => new SdkError(errorBody('unavailable', {detail: 'BB-8 native transport unavailable'}));
const MAC = /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i;
export class NativeAdapter implements Adapter {
  readonly #options: NativeOptions;
  constructor(options: NativeOptions) {this.#options = options;}
  async open(signal: AbortSignal): Promise<Gatt> {
    const options = this.#options;
    if (!options.ownsWriter() || signal.aborted || !MAC.test(options.targetAddress) || !MAC.test(options.adapterAddress)) throw refused();
    if (options.launch !== undefined) return options.launch(signal);
    if (process.platform !== 'win32') throw refused();
    return NativeSession.open(options, signal);
  }
}
type NativeReply = {id: number; ok: boolean; characteristics?: [string, string[]][]} | {notification: number[]} | {lost: true};
/** The child has no SDK token and cannot publish native errors to the bus. Its streams are private and bounded. */
class NativeSession implements Gatt {
  readonly characteristics = new Map<string, readonly string[]>();
  readonly #child: ChildProcess;
  readonly #log: FileHandle;
  #logBytes = 0;
  #logTail: Promise<void> = Promise.resolve();
  #next = 0;
  #closed = false;
  #onLost: (() => void) | undefined;
  #logClosed: Promise<void> | undefined;
  #waiting = new Map<number, {resolve: (reply: NativeReply) => void; reject: (error: unknown) => void}>();
  #notification: ((bytes: Uint8Array) => void) | undefined;
  constructor(child: ChildProcess, log: FileHandle) {
    this.#child = child; this.#log = log;
    const capture = (chunk: Buffer): void => {
      if (this.#closed) return;
      const remaining = 65_536 - this.#logBytes;
      this.#logBytes += chunk.length;
      this.#logTail = this.#logTail.then(async () => {if (remaining > 0) await log.write(chunk.subarray(0, remaining));}).catch(() => {this.#lost();});
      if (this.#logBytes > 65_536) this.#lost();
    };
    child.stdout?.on('data', capture); child.stderr?.on('data', capture);
    child.on('error', () => {this.#lost();}); child.on('exit', () => {this.#lost();});
    child.on('message', (message: unknown) => {
      if (typeof message !== 'object' || message === null || this.#closed) return;
      const item = message as Partial<NativeReply> & {id?: unknown; notification?: unknown; lost?: unknown};
      if (item.lost === true) {this.#lost(); return;}
      if (Array.isArray(item.notification)) {
        if (item.notification.length > 1024 || !item.notification.every((b: unknown) => Number.isInteger(b) && Number(b) >= 0 && Number(b) <= 255)) {this.#lost(); return;}
        this.#notification?.(Uint8Array.from(item.notification as number[])); return;
      }
      if (typeof item.id === 'number') this.#waiting.get(item.id)?.resolve(message as NativeReply);
    });
  }
  static async open(options: NativeOptions, signal: AbortSignal): Promise<NativeSession> {
    await mkdir(options.logDirectory, {recursive: true, mode: 0o700});
    const log = await open(join(options.logDirectory, `native-${randomUUID()}.log`), 'wx', 0o600);
    const env: NodeJS.ProcessEnv = {};
    for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'TEMP', 'TMP']) if (process.env[key] !== undefined) env[key] = process.env[key];
    let child: ChildProcess;
    try {child = fork(new URL('./native-worker.js', import.meta.url), [], {stdio: ['ignore', 'pipe', 'pipe', 'ipc'], execArgv: [], env});}
    catch (error) {await log.close(); throw new SdkError(errorBody('unavailable', {detail: 'BB-8 native worker could not start'}), {cause: error});}
    const session = new NativeSession(child, log);
    try {
      const reply = await session.#call('open', {targetAddress: options.targetAddress, adapterAddress: options.adapterAddress}, signal, 10_000);
      if ('id' in reply && reply.ok && reply.characteristics !== undefined) for (const [id, properties] of reply.characteristics) session.characteristics.set(id, properties);
      else throw refused();
      return session;
    } catch (error) {await session.close(); throw error;}
  }
  onDisconnected(handler: () => void): void {this.#onLost = handler; if (this.#closed) handler();}
  #lost(notify = true): void {
    if (this.#closed) return;
    this.#closed = true; this.#child.kill();
    for (const call of this.#waiting.values()) call.reject(refused()); this.#waiting.clear();
    // Let a pending PacketV1 transaction fail immediately on a native disconnect.
    this.#notification?.(new Uint8Array(1025));
    if (notify) this.#onLost?.();
    this.#logClosed = this.#logTail.then(() => this.#log.close()).catch(() => {});
  }
  #call(method: string, data: object, signal: AbortSignal, timeoutMs = 2000): Promise<NativeReply> {
    if (this.#closed || signal.aborted || !this.#child.connected) return Promise.reject(refused());
    const id = this.#next++;
    return new Promise((resolve, reject) => {
      const end = (): void => {clearTimeout(timer); signal.removeEventListener('abort', aborted); this.#waiting.delete(id);};
      const aborted = (): void => {end(); this.#lost(); reject(refused());};
      const timer = setTimeout(aborted, timeoutMs);
      this.#waiting.set(id, {resolve: reply => {end(); if ('id' in reply && reply.ok) resolve(reply); else reject(refused());}, reject: error => {end(); reject(error);}});
      signal.addEventListener('abort', aborted, {once: true});
      this.#child.send({id, method, ...data}, error => {if (error !== null) {end(); this.#lost(); reject(refused());}});
    });
  }
  async subscribe(uuid: string, handler: (bytes: Uint8Array) => void, signal: AbortSignal): Promise<void> {
    if (uuid !== UUID.response) throw refused(); this.#notification = handler;
    await this.#call('subscribe', {uuid}, signal);
  }
  async write(uuid: string, bytes: Uint8Array, signal: AbortSignal): Promise<void> {
    if (![UUID.command, UUID.unlock, UUID.txPower, UUID.wake].some(id => id === uuid) || bytes.length > 20) throw refused();
    await this.#call('write', {uuid, bytes: [...bytes]}, signal);
  }
  async close(): Promise<void> {
    this.#lost(false); await this.#logClosed;
  }
}
