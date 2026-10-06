// The entry point's first step. It imports nothing at run time, so that it runs before the rest of the runtime loads.
import type {BunnyModule} from '@jimmie-potts/sdk';

/** What the entry point loads: the process runner and the module list. */
export type Loaded = {runMain: (argv: readonly string[], modules: readonly BunnyModule[]) => Promise<void>; modules: readonly BunnyModule[]};

/** Loads the runtime with `load` and runs it with `argv`. */
export async function launch(argv: readonly string[], load: () => Promise<Loaded>): Promise<void> {
  const {runMain, modules} = await load();
  await runMain(argv, modules);
}
