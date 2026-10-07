// Waiting for a stopped runtime's last lines (Hub #950). A child's `exit` can come before the supervisor has read what
// the child wrote to stderr; Node's own documentation says the `close` event is the one that follows the streams. The
// runtime's last record, `runtime.stopped`, is the evidence that it stopped cleanly, so the supervisor reads it before it
// starts the next runtime.
import type {ChildProcess} from 'node:child_process';

/** How long a stopped runtime's last records have to reach the journal before the next runtime starts. */
export const DRAIN_MS = 1000;

/**
 * Resolves once `child` has closed, which is after it exited and every stdio stream ended, so every line it wrote has been
 * read, or `drainMs` after it exited, whichever comes first. A descendant that kept the pipe open costs only the bound.
 * Call it before the child can exit, so that no event is missed.
 */
export function drained(child: ChildProcess, drainMs: number = DRAIN_MS): Promise<void> {
  return new Promise(resolve => {
    let timer: NodeJS.Timeout | undefined;
    const done = (): void => {
      clearTimeout(timer);
      resolve();
    };
    child.once('close', done);
    child.once('exit', () => { timer = setTimeout(done, drainMs); });
  });
}
