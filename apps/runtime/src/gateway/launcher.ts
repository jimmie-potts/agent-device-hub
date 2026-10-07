// The browser launcher's socket (Hub #835), as the old Hub's `browser-launch.ts`: a Unix socket in the runtime's private
// state directory, owner-only, that hands each connection one launch code and the runtime's origin. The launcher opens
// the browser at the origin with the code, and the page exchanges the code for a session once (`POST
// /api/v2/browser/launch`). Only the runtime's own user can reach the socket.
import {chmod, lstat, unlink} from 'node:fs/promises';
import {createConnection, createServer, type Server} from 'node:net';
import {join} from 'node:path';
import {RuntimeError} from '../state.js';

/** What the socket hands each connection: the runtime's origin and a launch code. */
export type BrowserLaunch = {url: string; code: string};
/** The launcher's socket in the state directory. */
export const LAUNCH_SOCKET = 'bunny-launch.sock';
/** The longest Unix socket path Linux takes, in bytes. */
const MAX_SOCKET_PATH = 107;
const CODE = /^[A-Za-z0-9_-]{43}$/;

const missing = (error: unknown): boolean => error instanceof Error && 'code' in error && error.code === 'ENOENT';

/** Removes a socket that a stopped runtime left behind; refuses one that another runtime still serves or another user owns. */
async function removeStale(path: string): Promise<void> {
  const previous = await lstat(path).catch((error: unknown) => {
    if (missing(error)) return undefined;
    throw error;
  });
  if (previous === undefined) return;
  if (!previous.isSocket() || previous.uid !== process.getuid?.()) throw new Error('invalid-launch-socket');
  const stale = await new Promise<boolean>((resolve, reject) => {
    const probe = createConnection(path);
    probe.setTimeout(1500, () => { probe.destroy(new Error('launch-probe-timeout')); });
    probe.once('connect', () => {
      probe.destroy();
      resolve(false);
    });
    probe.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ECONNREFUSED') resolve(true);
      else reject(error);
    });
  });
  if (!stale) throw new Error('launch-socket-in-use');
  const current = await lstat(path).catch(() => undefined);
  if (current !== undefined && current.dev === previous.dev && current.ino === previous.ino) await unlink(path);
}

/**
 * Serves the launcher's socket in `stateDir` until the returned function closes it. `issue` makes each connection's
 * launch; a connection that cannot have one is closed without an answer.
 */
export async function startLauncher(stateDir: string, issue: () => BrowserLaunch): Promise<() => Promise<void>> {
  const path = join(stateDir, LAUNCH_SOCKET);
  // A Unix socket's path holds at most 107 bytes on Linux; a longer one would be cut short where nobody looks for it.
  if (Buffer.byteLength(path, 'utf8') > MAX_SOCKET_PATH) {
    throw new RuntimeError('launcher-path-too-long', 'the launcher\'s socket path is too long; shorten the state directory or set the edge\'s launcher to false');
  }
  await removeStale(path);
  const server: Server = createServer(socket => {
    socket.setTimeout(1500, () => { socket.destroy(); });
    try {
      socket.end(`${JSON.stringify(issue())}\n`);
    } catch {
      socket.destroy();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, () => {
      server.off('error', reject);
      resolve();
    });
  });
  try {
    await chmod(path, 0o600);
  } catch (error) {
    await new Promise<void>(resolve => { server.close(() => { resolve(); }); });
    throw error;
  }
  const own = await lstat(path);
  return async () => {
    await new Promise<void>(resolve => { server.close(() => { resolve(); }); });
    const current = await lstat(path).catch(() => undefined);
    if (current?.dev === own.dev && current.ino === own.ino) await unlink(path).catch(() => {});
  };
}

/**
 * Asks the runtime whose state directory is `stateDir` for a launch, as the launcher does before it opens the
 * browser at `<url>#launch=<code>`. Rejects when no runtime serves the socket or its answer is malformed.
 */
export function requestBrowserLaunch(stateDir: string): Promise<BrowserLaunch> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(join(stateDir, LAUNCH_SOCKET));
    let text = '';
    socket.setTimeout(2000, () => { socket.destroy(new Error('launch-timeout')); });
    socket.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8');
      if (text.length > 1024) socket.destroy(new Error('launch-capacity'));
    });
    socket.once('error', reject);
    socket.once('end', () => {
      try {
        const answer = JSON.parse(text) as Partial<BrowserLaunch>;
        const url = new URL(typeof answer.url === 'string' ? answer.url : '');
        if (typeof answer.code !== 'string' || !CODE.test(answer.code) || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port === '' ||
          url.pathname !== '/' || url.search !== '' || url.hash !== '') throw new Error('invalid-launch-response');
        resolve({url: url.href, code: answer.code});
      } catch (error) {
        reject(error instanceof Error ? error : new Error('invalid-launch-response'));
      }
    });
  });
}
