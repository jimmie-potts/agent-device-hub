// The price table behind every reservation (docs/art-generation-qualification.md, "Spending limits"). Amounts are integer
// micro-dollars, so a listed price of $5 per million tokens is 5 micro-dollars per token. An image entry holds the largest
// output the 2026-11-03 trial observed for it, and a reservation doubles that. A call with no entry is refused, so a size,
// quality or input image nobody has observed cannot run until it is added here.
export const PROMPT_LIMIT = 4000;
export const IDEA_MAX_TOKENS = 2000;
export const IMAGE_MODEL = 'gpt-image-2';
export const IDEA_MODEL = 'claude-opus-5-5';

export type ImageQuality = 'low' | 'medium';
export type ImageSize = `${number}x${number}`;
export type PriceKey =
  | {readonly provider: 'openai'; readonly model: string; readonly quality: string; readonly size: string}
  | {readonly provider: 'anthropic'; readonly model: string; readonly maxTokens: number};
export type Usage = {readonly inputTokens: number; readonly outputTokens: number};
type Price = {readonly inputMicrosPerToken: number; readonly outputMicrosPerToken: number; readonly maxOutputTokens: number};

/** OpenAI's listed input and image-output prices, as the trial's reported usage confirmed them. */
const GPT_IMAGE_2 = {inputMicrosPerToken: 5, outputMicrosPerToken: 30};
const IMAGE_PRICES: Readonly<Record<string, Price>> = {
  // Largest observed output tokens from the record's trial, doubled for the worst case.
  [`${IMAGE_MODEL}/low/1024x1024`]: {...GPT_IMAGE_2, maxOutputTokens: 2 * 196},
  [`${IMAGE_MODEL}/medium/1024x1024`]: {...GPT_IMAGE_2, maxOutputTokens: 2 * 1756},
  [`${IMAGE_MODEL}/low/1536x768`]: {...GPT_IMAGE_2, maxOutputTokens: 2 * 102},
  [`${IMAGE_MODEL}/medium/1536x768`]: {...GPT_IMAGE_2, maxOutputTokens: 2 * 916},
  [`${IMAGE_MODEL}/medium/1536x1024`]: {...GPT_IMAGE_2, maxOutputTokens: 2 * 1372},
};
/** Listed Claude prices per token. A text entry needs no observation: its output is bounded by `max_tokens`. */
const TEXT_PRICES: Readonly<Record<string, Price>> = {
  [`${IDEA_MODEL}/${IDEA_MAX_TOKENS}`]: {inputMicrosPerToken: 4, outputMicrosPerToken: 20, maxOutputTokens: IDEA_MAX_TOKENS},
};

export const priceOf = (key: PriceKey): Price | undefined => key.provider === 'openai'
  ? IMAGE_PRICES[`${key.model}/${key.quality}/${key.size}`]
  : TEXT_PRICES[`${key.model}/${key.maxTokens}`];

const worst = (price: Price): number => PROMPT_LIMIT * price.inputMicrosPerToken + price.maxOutputTokens * price.outputMicrosPerToken;
/** A call's worst case: every prompt is at most `PROMPT_LIMIT` characters, counted as that many tokens. Undefined when no entry exists. */
export function reservationOf(key: PriceKey): number | undefined {
  const price = priceOf(key);
  return price === undefined ? undefined : worst(price);
}
/** What a response's reported usage costs. */
export function costOf(key: PriceKey, usage: Usage): number | undefined {
  const price = priceOf(key);
  return price === undefined ? undefined : usage.inputTokens * price.inputMicrosPerToken + usage.outputTokens * price.outputMicrosPerToken;
}
