export * from './types.js';
export {runCli} from './cli.js';
export {validateReceipt} from './receipt.js';

import type {AppPlugin} from './types.js';

/** Package version, also the release tag suffix (`app-verify-v<VERSION>`). */
export const VERSION = '1.0.0';

/** Identity helper that gives a JavaScript plug-in module its types. */
export function definePlugin(plugin: AppPlugin): AppPlugin {
  return plugin;
}
