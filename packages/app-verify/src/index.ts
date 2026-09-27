export * from './types.js';
export {runCli} from './cli.js';
export {validateReceipt} from './receipt.js';
export {runCaptureStep} from './capture.js';

export {VERSION} from './version.js';

import type {AppPlugin} from './types.js';

/** Identity helper that gives a JavaScript plug-in module its types. */
export function definePlugin(plugin: AppPlugin): AppPlugin {
  return plugin;
}
