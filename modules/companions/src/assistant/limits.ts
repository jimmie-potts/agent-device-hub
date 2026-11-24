// The engine's per-turn bounds (Hub #499, #46, relaxed by #2024), as pure constants the module's store, engine and
// browser page share. A usage unit is one token a configured provider reports, or one fake unit of the synthetic provider.
// A model call reserves the units its request could use before it is sent: the request's UTF-8 bytes (a token covers at
// least one byte of the text it encodes) plus `overheadUnits` for the provider's own framing, plus `outputUnits`, the
// most output a call may report. The staging, checkpoint and page bounds are sized so the largest owner message, answer
// and saved message still fit after JSON escaping (six bytes for a control character).
export const LIMITS = Object.freeze({modelCalls: 50, toolCalls: 40, questions: 10, activeMs: 2_400_000, modelMs: 360_000,
  toolMs: 30_000, controlMs: 5000, inputBytes: 32_768, toolBytes: 8192, replyBytes: 16_384, stateBytes: 1_048_576,
  stageBytes: 197_632, checkpointBytes: 262_144, pageBytes: 524_288, units: 1_000_000, outputUnits: 16_384, overheadUnits: 8192, spokenChars: 512});
/** The shared spend limits across all profiles (Hub #2024), in millionths of a US dollar, by the runtime host's local day and month. */
export const SPEND_LIMITS = Object.freeze({dayMicros: 20_000_000, monthMicros: 150_000_000});
/** Millionths of a dollar as dollars and cents, for limit messages and the page. */
export const dollars = (micros: number): string => `$${(micros / 1_000_000).toFixed(2)}`;
