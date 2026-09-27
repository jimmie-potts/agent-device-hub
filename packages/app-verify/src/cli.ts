import type {AppPlugin, RunOptions} from './types.js';

/** Run one operation for `plugin` and return the process exit code. */
export async function runCli(_plugin: AppPlugin, _argv: readonly string[], _options: RunOptions = {}): Promise<number> {
  throw new Error('not implemented');
}
