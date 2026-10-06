// The entry point's first step. It imports nothing at run time, so that its signal handlers are in place before the
// rest of the runtime loads; a signal before them takes Node's default action.
import type {BunnyModule} from '@jimmie-potts/sdk';

/** What the entry point loads: the process runner and the module list. */
export type Loaded = {runMain: (argv: readonly string[], modules: readonly BunnyModule[]) => Promise<void>; modules: readonly BunnyModule[]};

/**
 * Catches SIGTERM and SIGINT, loads the runtime with `load` and runs it with `argv`. A signal that arrives while it
 * loads exits 0 before the runtime starts, so nothing is created; once the runtime runs, its own handlers stop it.
 */
export async function launch(argv: readonly string[], load: () => Promise<Loaded>): Promise<void> {
  let signalled = false;
  const remember = (): void => { signalled = true; };
  process.on('SIGTERM', remember);
  process.on('SIGINT', remember);
  const {runMain, modules} = await load();
  // Loading may not turn the event loop, which delivers a signal that arrived meanwhile only on its next turn.
  await new Promise(resolve => { setImmediate(resolve); });
  if (signalled) process.exit(0);
  // runMain installs the runtime's own handlers before it returns, so no signal falls between the two.
  const running = runMain(argv, modules);
  process.off('SIGTERM', remember);
  process.off('SIGINT', remember);
  await running;
}
