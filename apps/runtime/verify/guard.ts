// The network guard of a verification run's runtime child (Hub #920), loaded with `--import` before the runtime. The
// runtime only listens; it never opens a connection itself, and its simulated devices are reached over the IPC channel.
// So the guard refuses every outbound TCP connection before it is made, and reports each attempt to the supervisor, which
// the no-outbound-connections check reads. A child whose supervisor goes away stops itself.
import net from 'node:net';

type Target = {host: string; port: number};

/** The TCP target of a `Socket.connect` call, or undefined for a local path such as a pipe. */
function targetOf(args: readonly unknown[]): Target | undefined {
  // `net.connect` passes its normalized arguments as one array.
  const first: unknown = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0];
  if (typeof first === 'object' && first !== null) {
    const options = first as {port?: unknown; host?: unknown; path?: unknown};
    if (options.path !== undefined) return undefined;
    return {host: typeof options.host === 'string' ? options.host : 'localhost', port: Number(options.port)};
  }
  if (typeof first === 'number' || (typeof first === 'string' && /^\d+$/.test(first))) {
    return {host: typeof args[1] === 'string' ? args[1] : 'localhost', port: Number(first)};
  }
  return undefined;
}

const connect = Reflect.get(net.Socket.prototype, 'connect') as (this: net.Socket, ...args: unknown[]) => net.Socket;
Object.defineProperty(net.Socket.prototype, 'connect', {
  configurable: true,
  writable: true,
  value: function guarded(this: net.Socket, ...args: unknown[]): net.Socket {
    const target = targetOf(args);
    if (target === undefined) return connect.apply(this, args);
    if (process.connected) process.send?.({type: 'guard', host: target.host, port: target.port});
    process.nextTick(() => { this.destroy(new Error(`blocked-by-verification-run: ${target.host}:${target.port}`)); });
    return this;
  },
});

// Once the supervisor is gone, nothing reads the child's output or messages: writing fails with EPIPE, which must not
// become an error the runtime fails on. The runtime then stops as on SIGTERM, and exits within the stop deadline anyway.
for (const stream of [process.stdout, process.stderr]) stream.on('error', () => {});
process.on('disconnect', () => {
  process.kill(process.pid, 'SIGTERM');
  setTimeout(() => { process.exit(0); }, 15_000).unref();
});
