// The network guard of a verification run's runtime (Hub #920). `guardEnvironment` loads it through NODE_OPTIONS, so it
// runs first in the runtime's main thread, in each worker thread that inherits its environment (a file worker, as the
// runtime starts) and in every Node process the runtime starts.
// The runtime only listens; it never opens a connection itself, and its simulated devices are reached over the IPC
// channel. So the guard refuses, before anything leaves, every outbound TCP connection (`net.Socket#connect`, which
// net, tls, http, https and fetch all use) and every UDP datagram or connect (`dgram.Socket#send` and `#connect`), and
// appends each attempt to the run's report file, which the no-outbound-connections check reads. A Unix socket or pipe
// path is local and passes.
//
// It does not cover what bypasses those JavaScript APIs: a native addon, a non-Node binary the runtime executes, a Node
// process or worker thread started with NODE_OPTIONS cleared or replaced (a worker given its own `env`, or an `eval`
// worker), or a name lookup through node:dns, which asks the system's resolver. The runtime does none of these today.
import dgram from 'node:dgram';
import {appendFileSync} from 'node:fs';
import net from 'node:net';
import {isMainThread} from 'node:worker_threads';
import type {Attempt} from './protocol.js';

const REPORT = process.env.BUNNY_GUARD_REPORT;

/** Appends the attempt to the run's report file. A guard without one still refuses. */
function report(attempt: Attempt): void {
  if (REPORT === undefined || REPORT === '') return;
  try {
    appendFileSync(REPORT, `${JSON.stringify(attempt)}\n`, {mode: 0o600});
  } catch {
    // The attempt is refused either way; the check reads what was written.
  }
}

const refusal = (attempt: Attempt): Error =>
  Object.assign(new Error(`blocked-by-verification-run: ${attempt.protocol} ${attempt.host}:${attempt.port}`), {code: 'EACCES'});

/** The TCP target of a `Socket#connect` call, or undefined for a local path such as a Unix socket or pipe. */
function tcpTarget(args: readonly unknown[]): Attempt | undefined {
  // `net.connect` passes its normalized arguments as one array.
  const first: unknown = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0];
  if (typeof first === 'object' && first !== null) {
    const options = first as {port?: unknown; host?: unknown; path?: unknown};
    // As net decides: a pipe only when the path is a non-empty string. http and https pass `path: null`.
    if (typeof options.path === 'string' && options.path !== '') return undefined;
    return {protocol: 'tcp', host: typeof options.host === 'string' ? options.host : 'localhost', port: Number(options.port)};
  }
  if (typeof first === 'string' && !/^\d+$/.test(first)) return undefined;
  return {protocol: 'tcp', host: typeof args[1] === 'string' ? args[1] : 'localhost', port: Number(first)};
}

/** Replaces a prototype method, keeping it configurable and writable as Node's own are. */
function replace(prototype: object, name: string, value: (this: never, ...args: unknown[]) => unknown): void {
  Object.defineProperty(prototype, name, {configurable: true, writable: true, value});
}

const connect = Reflect.get(net.Socket.prototype, 'connect') as (this: net.Socket, ...args: unknown[]) => net.Socket;
replace(net.Socket.prototype, 'connect', function guarded(this: net.Socket, ...args: unknown[]): net.Socket {
  const target = tcpTarget(args);
  if (target === undefined) return connect.apply(this, args);
  report(target);
  process.nextTick(() => { this.destroy(refusal(target)); });
  return this;
});

/** The UDP target of `send(msg[, offset, length], port[, address][, callback])`, or undefined for a connected send. */
function udpTarget(args: readonly unknown[]): Attempt | undefined {
  const rest = args.slice(1).filter(arg => typeof arg !== 'function' && arg !== undefined);
  if (rest.length === 0) return undefined;
  const [port, host] = rest.length >= 3 && typeof rest[0] === 'number' && typeof rest[1] === 'number' ? [rest[2], rest[3]] : [rest[0], rest[1]];
  return {protocol: 'udp', host: typeof host === 'string' ? host : 'localhost', port: Number(port)};
}

/** Settles a refused UDP call as Node does: through its callback when it has one, otherwise as the socket's error. */
function refuseUdp(socket: dgram.Socket, attempt: Attempt, args: readonly unknown[]): void {
  report(attempt);
  const last = args.at(-1);
  const callback = typeof last === 'function' ? last as (error: Error) => void : undefined;
  process.nextTick(() => {
    if (callback === undefined) socket.emit('error', refusal(attempt));
    else callback(refusal(attempt));
  });
}

const send = Reflect.get(dgram.Socket.prototype, 'send') as (this: dgram.Socket, ...args: unknown[]) => void;
replace(dgram.Socket.prototype, 'send', function guarded(this: dgram.Socket, ...args: unknown[]): void {
  const target = udpTarget(args);
  // A send without a target needs a connected socket, which the guard never lets a socket become.
  if (target === undefined) {
    send.apply(this, args);
    return;
  }
  refuseUdp(this, target, args);
});

replace(dgram.Socket.prototype, 'connect', function guarded(this: dgram.Socket, ...args: unknown[]): void {
  const [port, host] = args;
  refuseUdp(this, {protocol: 'udp', host: typeof host === 'string' ? host : 'localhost', port: Number(port)}, args);
});

// The runtime's own process, which the supervisor forked: once the supervisor is gone, nothing reads its output or
// messages, and writing fails with EPIPE, which must not become an error the runtime fails on. The runtime then stops as
// on SIGTERM, and exits within the stop deadline anyway. Worker threads and processes it starts have no IPC channel.
if (isMainThread && process.channel !== undefined) {
  for (const stream of [process.stdout, process.stderr]) stream.on('error', () => {});
  process.on('disconnect', () => {
    process.kill(process.pid, 'SIGTERM');
    setTimeout(() => { process.exit(0); }, 15_000).unref();
  });
}
