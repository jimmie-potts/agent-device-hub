// The 2.0 agent hook (Hub #926), as `@jimmie-potts/runtime/hook`: what `bin/monitor-hook.mjs` runs, and what the
// cutover's installer (#935) needs to check a producer file against the converted credentials. It loads only the
// normalizers, the SDK and the contracts, never the rest of the runtime, so a hook starts quickly.
export {HOOK_BUDGET_MS, MAX_INPUT_BYTES, runHook, type HookOptions, type HookResult} from './hook.js';
export {LIFECYCLE_SCHEMA, LIFECYCLE_TYPE, lifecycleMessage, observationOf} from './observation.js';
export {
  MAX_PRODUCER_BYTES, MAX_RECEIPT_BYTES, PRODUCER_PATH, producerCredentialId, producerSource, readProducer, type LifecycleVersion, type Producer,
} from './producer.js';
