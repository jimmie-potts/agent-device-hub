export * from './types.js';
export {runCli} from './cli.js';
export {inspectPrerequisites, prerequisitesSupport} from './prerequisites.js';
export {validateReceipt} from './receipt.js';
export {holdSingleRun, runActiveDetail, SingleRunRefused, type SingleRun} from './single-run.js';
export {liveRuns} from './systemd.js';
export {runCaptureStep} from './capture.js';
export {createProofHandler, proofLinks, PROOF_PREFIX, type ProofHandler, type ProofLink} from './proof.js';

export {VERSION} from './version.js';

import type {AppPlugin} from './types.js';

/** Identity helper that gives a JavaScript plug-in module its types. */
export function definePlugin(plugin: AppPlugin): AppPlugin {
  return plugin;
}
