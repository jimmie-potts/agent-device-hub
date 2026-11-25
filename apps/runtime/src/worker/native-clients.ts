import {execFile, spawn} from 'node:child_process';
import {lstat} from 'node:fs/promises';
import {createConnection, createServer, type Server, type Socket} from 'node:net';
import {dirname, isAbsolute} from 'node:path';
import {promisify} from 'node:util';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import type {Reply} from '@jimmie-potts/sdk';
import type {CodingNativeClient, CodingNativeClientKind} from '@jimmie-potts/event-contracts/v2/coding';
import {checkStateDirectory, prepareStateDirectory} from '../state.js';

const exec = promisify(execFile);
const ATTEMPT = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MAX_LINE = 32_768;
export const NATIVE_UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
type State = CodingNativeClient['state'];
export type NativeTerminalPlan = {executable: string; cwd: string; args: string[]; env: Record<string, string>};
type PreparedLaunch = {intentId: string; client: CodingNativeClientKind; plan: NativeTerminalPlan;
  fresh: () => boolean; socket: Socket | undefined};
type Target = {
  session: string;
  clients: readonly CodingNativeClientKind[];
  build: (client: CodingNativeClientKind) => Promise<NativeTerminalPlan | undefined>;
  changed: (state: State) => Promise<void>;
  state: State;
  opening: boolean;
  prepared?: PreparedLaunch;
  socket?: Socket;
};

function lines(socket: Socket, receive: (line: string) => void): void {
  let pending = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    pending += chunk;
    if (Buffer.byteLength(pending) > MAX_LINE) {socket.destroy(); return;}
    let newline = pending.indexOf('\n');
    while (newline >= 0) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      receive(line);
      newline = pending.indexOf('\n');
    }
  });
  socket.on('error', () => {socket.destroy();});
}

/** Only the worker may offer a target. The local owner first waits in a terminal, then approves that attempt in Jobs. */
export class NativeClients {
  readonly #targets = new Map<string, Target>();
  readonly #waiting = new Map<string, Socket>();
  readonly #sockets = new Set<Socket>();
  #server: Server | undefined;

  constructor(readonly path: string, private readonly launchDesktop = async (plan: NativeTerminalPlan): Promise<boolean> => {
    const {stdout} = await exec(plan.executable, plan.args, {cwd: plan.cwd, env: plan.env, timeout: 10_000, maxBuffer: MAX_LINE});
    return stdout.split(/\r?\n/u).some(line => line.trim() === `Opening session ${plan.args.at(-1) ?? ''} in Claude Desktop`);
  }) {}

  async start(): Promise<void> {
    await prepareStateDirectory(dirname(this.path));
    const server = createServer(socket => {this.#listen(socket);});
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.path, () => {server.off('error', reject); resolve();});
    });
    this.#server = server;
  }

  stop(): void {
    this.clear();
    for (const socket of this.#sockets) socket.destroy();
    this.#server?.close();
    this.#server = undefined;
  }

  clear(): void {
    for (const [operationId, target] of this.#targets) {
      if (target.state === 'available') this.#targets.delete(operationId);
      else target.state = 'uncertain';
    }
    for (const socket of this.#waiting.values()) socket.destroy();
    this.#waiting.clear();
  }

  async offer(operationId: string, session: string, clients: readonly CodingNativeClientKind[], build: Target['build'], changed: Target['changed']): Promise<void> {
    if (this.#server === undefined || this.#targets.has(operationId) ||
      [...this.#targets.values()].some(target => target.session === session)) return;
    this.#targets.set(operationId, {session, clients, build, changed, state: 'available', opening: false});
    await changed('available');
  }

  writerMayBePresent(operationId: string): boolean {
    const entry = this.#targets.get(operationId);
    return entry !== undefined && (entry.opening || entry.state !== 'available');
  }

  retire(operationId: string): void {
    this.#targets.delete(operationId);
    this.#waiting.get(operationId)?.destroy();
  }

  async prepare(operationId: string, client: CodingNativeClientKind, intentId: string, fresh: () => boolean): Promise<Reply> {
    const target = this.#targets.get(operationId), socket = this.#waiting.get(operationId);
    if (target?.clients.includes(client) !== true) return errorBody('unsupported-capability');
    if (target.opening || target.state !== 'available') return errorBody('invalid-state');
    if (client === 'terminal' && (socket === undefined || socket.destroyed)) {
      return errorBody('unavailable', {detail: 'Wait for this attempt in a terminal on the worker host first.'});
    }
    target.opening = true;
    delete target.prepared;
    try {
      const plan = await target.build(client);
      if (plan === undefined || !fresh() || this.#targets.get(operationId) !== target || socket?.destroyed === true) return errorBody('unavailable');
      target.prepared = {intentId, client, plan, fresh, socket};
      return {status: 'accepted'};
    } finally {target.opening = false;}
  }

  async launch(operationId: string, client: CodingNativeClientKind, intentId: string, fresh: () => boolean): Promise<Reply> {
    const target = this.#targets.get(operationId), prepared = target?.prepared;
    if (target?.clients.includes(client) !== true) return errorBody('unsupported-capability');
    if (target.opening || target.state !== 'available') return errorBody('invalid-state');
    if (prepared?.intentId !== intentId || prepared.client !== client || !prepared.fresh() || !fresh()) return errorBody('unavailable');
    const {plan, socket} = prepared;
    if (client === 'terminal' && (socket === undefined || socket.destroyed || this.#waiting.get(operationId) !== socket)) return errorBody('unavailable');
    delete target.prepared;
    if (client === 'claude-desktop') {
      this.#waiting.get(operationId)?.destroy();
      // The CLI can acknowledge the exact launch request. Desktop supplies no writer release receipt.
      target.state = 'uncertain';
      const acknowledged = await this.launchDesktop(plan).catch(() => false);
      if (acknowledged && this.#targets.get(operationId) === target) target.state = 'desktop';
      await target.changed(target.state);
    } else if (socket !== undefined) {
      this.#waiting.delete(operationId);
      target.state = 'terminal-pending';
      target.socket = socket;
      socket.setTimeout(0);
      socket.once('close', () => {
        if ((target.state === 'terminal-pending' || target.state === 'terminal') && this.#targets.get(operationId) === target) {
          target.state = 'uncertain';
          void target.changed('uncertain');
        }
      });
      socket.write(JSON.stringify(plan) + '\n');
      await target.changed('terminal-pending');
    }
    return {status: 'accepted'};
  }

  #listen(socket: Socket): void {
    this.#sockets.add(socket);
    socket.setTimeout(90_000, () => socket.destroy());
    let operationId: string | undefined;
    socket.on('close', () => {
      this.#sockets.delete(socket);
      if (operationId !== undefined && this.#waiting.get(operationId) === socket) this.#waiting.delete(operationId);
    });
    lines(socket, line => {
      if (operationId === undefined) {
        const target = this.#targets.get(line);
        if (!ATTEMPT.test(line) || target?.state !== 'available' || !target.clients.includes('terminal') || this.#waiting.has(line)) {socket.destroy(); return;}
        operationId = line;
        this.#waiting.set(line, socket);
        socket.write('waiting\n');
        return;
      }
      const target = this.#targets.get(operationId);
      if (target?.socket !== socket) {socket.destroy(); return;}
      if (line === 'spawned' && target.state === 'terminal-pending') {
        target.state = 'terminal';
        void target.changed('terminal');
      } else if (line === 'closed' && target.state === 'terminal') {
        target.state = 'terminal-closed';
        delete target.socket;
        void target.changed('terminal-closed');
        socket.end();
      } else socket.destroy();
    });
  }
}

function parsePlan(line: string): NativeTerminalPlan | undefined {
  try {
    const value: unknown = JSON.parse(line);
    if (typeof value !== 'object' || value === null || !('executable' in value) || typeof value.executable !== 'string' ||
      !isAbsolute(value.executable) || !('cwd' in value) || typeof value.cwd !== 'string' || !isAbsolute(value.cwd) ||
      !('args' in value) || !Array.isArray(value.args) || !value.args.every(arg => typeof arg === 'string') ||
      !('env' in value) || typeof value.env !== 'object' || value.env === null || Array.isArray(value.env)) return undefined;
    const env: Record<string, string> = {};
    for (const [key, entry] of Object.entries(value.env)) {
      if (!/^[A-Z_][A-Z0-9_]*$/u.test(key) || typeof entry !== 'string') return undefined;
      env[key] = entry;
    }
    return {executable: value.executable, cwd: value.cwd, args: value.args, env};
  } catch {return undefined;}
}

async function foregroundHelper(): Promise<boolean> {
  const {stdout} = await exec('/bin/ps', ['-p', String(process.pid), '-o', 'pgid=,tpgid='], {timeout: 2000});
  const [group, foreground] = stdout.trim().split(/\s+/u).map(Number);
  return group !== undefined && group > 0 && group === foreground;
}

/** Run on the worker's own account from a foreground terminal. The helper never reads Hub credentials. */
export async function nativeTerminal(path: string, operationId: string, foreground: boolean, log: (line: string) => void): Promise<void> {
  if (!ATTEMPT.test(operationId) || !foreground || !await foregroundHelper()) {
    throw new Error('coding-worker-native: use a foreground terminal on the worker host');
  }
  await checkStateDirectory(dirname(path));
  const info = await lstat(path);
  if (!info.isSocket() || info.uid !== process.getuid?.()) throw new Error('coding-worker-native: the private worker socket is unavailable');
  const socket = createConnection(path);
  let claimed = false, complete = false;
  await new Promise<void>((resolve, reject) => {
    socket.on('close', () => {if (!complete) reject(new Error('coding-worker-native: terminal connection closed before the exit receipt')); else resolve();});
    socket.on('connect', () => {socket.write(operationId + '\n');});
    lines(socket, line => {
      if (line === 'waiting' && !claimed) {
        log('Waiting for this attempt’s native terminal request in B.U.N.N.Y. Jobs.');
        return;
      }
      if (claimed) {socket.destroy(); return;}
      claimed = true;
      const plan = parsePlan(line);
      if (plan === undefined) {socket.destroy(); return;}
      const {executable, cwd, args, env} = plan;
      const child = spawn(executable, args, {cwd, env: {...env, ...(process.env.TERM === undefined ? {} : {TERM: process.env.TERM})}, stdio: 'inherit'});
      child.once('spawn', () => {if (!socket.destroyed) socket.write('spawned\n');});
      child.once('error', () => {socket.destroy();});
      child.once('close', () => {
        if (socket.destroyed) return;
        complete = true;
        socket.write('closed\n');
      });
    });
  });
}
