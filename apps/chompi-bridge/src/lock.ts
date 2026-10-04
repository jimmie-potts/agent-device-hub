import { createConnection, createServer, type Server } from 'node:net';
import { lstat, mkdir, unlink } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { dirname, posix } from 'node:path';

/**
 * Per-user single-instance lock. Holding it means owning a local IPC endpoint: a named pipe on Windows, a Unix
 * domain socket elsewhere. The operating system releases it when the process exits, however it exits. Take it
 * before opening any device.
 */
export interface InstanceLock {
  readonly path: string;
  release(): Promise<void>;
}

export class InstanceLockHeldError extends Error {
  readonly code = 'chompi-bridge-already-running';
  constructor() { super('chompi-bridge-already-running'); }
}

export interface LockPathContext {
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  username?: string;
  uid?: number;
  tmp?: string;
}

const PIPE_PREFIX = '\\\\.\\pipe\\';

/** `\\.\pipe\agent-chompi-bridge-<user>` on Windows; a socket in the user's runtime directory elsewhere. */
export function defaultLockPath(context: LockPathContext = {}): string {
  const platform = context.platform ?? process.platform;
  if (platform === 'win32') {
    const username = (context.username ?? userInfo().username).replace(/[^A-Za-z0-9._-]/g, '_');
    return `${PIPE_PREFIX}agent-chompi-bridge-${username}`;
  }
  const env = context.env ?? process.env;
  if (env.XDG_RUNTIME_DIR) return posix.join(env.XDG_RUNTIME_DIR, 'agent-chompi-bridge.sock');
  const uid = context.uid ?? process.getuid?.() ?? -1;
  return posix.join(context.tmp ?? tmpdir(), `agent-chompi-bridge-${uid}`, 'bridge.sock');
}

const unsafe = () => new Error('lock-path-unsafe');

/** The socket directory must be a real directory owned by this user with no group or other access. */
async function privateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) throw unsafe();
}

function listen(path: string): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer(socket => socket.destroy());
    server.once('error', reject);
    server.listen({ path, exclusive: true }, () => {
      server.off('error', reject);
      server.unref();
      resolve(server);
    });
  });
}

/** Whether a live process accepts connections on the socket. */
function probe(path: string): Promise<'live' | 'refused' | 'missing'> {
  return new Promise(resolve => {
    const socket = createConnection({ path });
    socket.once('connect', () => { socket.destroy(); resolve('live'); });
    socket.once('error', (error: NodeJS.ErrnoException) => resolve(error.code === 'ENOENT' ? 'missing' : 'refused'));
  });
}

/** Acquires the lock or rejects with InstanceLockHeldError. A stale Unix socket left by a dead holder is replaced. */
export async function acquireInstanceLock(path: string = defaultLockPath()): Promise<InstanceLock> {
  const pipe = path.startsWith(PIPE_PREFIX);
  if (!pipe) await privateDirectory(dirname(path));
  let server: Server | undefined;
  for (let attempt = 0; attempt < 2 && !server; attempt++) {
    try {
      server = await listen(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
      if (pipe) throw new InstanceLockHeldError();
      const before = await lstat(path).catch(() => undefined);
      const state = await probe(path);
      if (state === 'live') throw new InstanceLockHeldError();
      if (state === 'missing' || !before) continue;
      if (!before.isSocket() || before.uid !== process.getuid?.()) throw unsafe();
      const now = await lstat(path).catch(() => undefined);
      if (now && now.ino === before.ino && now.dev === before.dev) await unlink(path).catch(() => undefined);
    }
  }
  if (!server) throw new InstanceLockHeldError();
  const held = server;
  let released: Promise<void> | undefined;
  return {
    path,
    release: () => {
      released ??= new Promise<void>(resolve => held.close(() => resolve()));
      return released;
    },
  };
}
