// The runtime's lease on its state directory, for offline tools (Hub #931): the core's lock database,
// `modules/core.sqlite-owner`, whose exclusive transaction the core holds from its start until it stops (Hub #831). A
// tool that changes a module's files holds the lease for as long as it runs, so no runtime starts on the directory
// meanwhile: a runtime that starts then waits for the lease until its core's deadline, fails, and is restarted by its
// service manager. The Pixoo library migration takes it, and #933's Nanoleaf migration is to take it too.
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {takeLock, type Lock} from './core/store.js';
import {RuntimeError} from './state.js';

/** The runtime's lease, held until `release`. */
export type RuntimeLease = Lock;

/**
 * Takes the runtime's lease on `stateDir`, a directory that `prepareStateDirectory` accepted, without waiting: refuses
 * with `runtime-running` while a runtime (or another tool) holds it, and with `lease-unavailable` when its lock file is
 * not a regular file private to this user. Creates `modules/` (mode 700) and the lock file (mode 600) when they are
 * missing, as the core's start does; the lock file holds no data, and taking the lease writes nothing to it.
 */
export async function holdRuntimeLease(stateDir: string): Promise<RuntimeLease> {
  mkdirSync(join(stateDir, 'modules'), {recursive: true, mode: 0o700});
  try {
    return await takeLock(join(stateDir, 'modules', 'core.sqlite'), AbortSignal.abort());
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new RuntimeError('runtime-running', 'a runtime holds the state directory\'s lease: stop it first');
    }
    throw new RuntimeError('lease-unavailable', 'the runtime\'s lease file is not a regular file private to this user');
  }
}
