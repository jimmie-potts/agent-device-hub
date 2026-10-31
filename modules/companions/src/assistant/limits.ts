// The engine's per-task bounds (Hub #499, #46), as pure constants the module's store, engine and browser page share.
// A usage unit is one token a configured provider reports, or one fake unit of the synthetic provider.
export const LIMITS = Object.freeze({modelCalls: 6, toolCalls: 4, questions: 2, activeMs: 300_000, modelMs: 60_000,
  toolMs: 8000, controlMs: 5000, inputBytes: 4096, toolBytes: 8192, replyBytes: 16_384, stateBytes: 32_768, pageBytes: 65_536,
  units: 65_536, callUnits: 16_384});
