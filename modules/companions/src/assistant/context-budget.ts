/** Local operating budget for the full hosted input. Keep optional history from consuming the long-context window. */
export const HOSTED_CONTEXT_INPUT_TOKENS = 128_000;

// Leave room for server-side protocol and tool framing that is absent from the request body.
const PROVIDER_FRAMING_TOKENS = 8192;
type HostedProviderName = 'anthropic' | 'openai';

// Claude's model table gives a 1M context window for these two published defaults.
// https://platform.claude.com/docs/en/models/overview
// OpenAI publishes separate input and total context limits for the configured Responses model.
// https://developers.openai.com/api/docs/models/gpt-6.2-sol
const MODEL_WINDOWS: Readonly<Record<string, {contextTokens: number; maxInputTokens?: number}>> = {
  'anthropic:claude-opus-5-5': {contextTokens: 1_000_000},
  'anthropic:claude-haiku-5-5': {contextTokens: 1_000_000},
  'openai:gpt-6.2-sol': {contextTokens: 1_050_000, maxInputTokens: 922_000},
};

/** Estimate ordinary English at three letters per token, with each word rounded up.
 * OpenAI's published rule of thumb is about four characters per token for English:
 * https://help.openai.com/en/articles/4936856-understanding-and-counting-tokens
 * Charge all other bytes individually, including punctuation, escapes, non-ASCII text and long opaque runs.
 */
export function estimateTextTokens(text: string): number {
  let tokens = Buffer.byteLength(text, 'utf8');
  for (const [word] of text.matchAll(/[A-Za-z0-9+/=_-]+/gu)) {
    if (word.length <= 24 && /^[A-Za-z]+$/u.test(word)) tokens -= word.length - Math.ceil(word.length / 3);
  }
  return tokens;
}

/** Measure the complete serialized request, including tool schemas and native continuation, without sending it. */
export function estimateHostedInputTokens(renderedBody: string, model?: {name: HostedProviderName; model: string}): number {
  const known = model === undefined || Object.hasOwn(MODEL_WINDOWS, `${model.name}:${model.model}`);
  return known ? estimateTextTokens(renderedBody) + PROVIDER_FRAMING_TOKENS : hostedInputTokenCeiling(renderedBody);
}

/** Conservative upper estimate for preflight at the provider boundary. */
export function hostedInputTokenCeiling(renderedBody: string): number {
  return Buffer.byteLength(renderedBody, 'utf8') + PROVIDER_FRAMING_TOKENS;
}

export function hostedInputBudget({provider, model, maxOutputTokens}: {
  provider: HostedProviderName; model: string; maxOutputTokens: number;
}): number {
  const key = `${provider}:${model}`;
  // For a custom model without local metadata, use the operating budget as a conservative combined planning allowance.
  const window = MODEL_WINDOWS[key] ?? {contextTokens: HOSTED_CONTEXT_INPUT_TOKENS};
  return Math.max(0, Math.min(window.contextTokens - maxOutputTokens, window.maxInputTokens ?? window.contextTokens));
}
