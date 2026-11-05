// Claude writes ideas through the Messages API, as `modules/companions/src/assistant/anthropic.ts` calls it: the module's own
// fetch, a versioned header, thinking left to the model's default. It returns text only and cannot draw. No retry and no
// fallback model. Thinking cannot be turned off on this model, so effort stays low and `max_tokens` bounds the call.
import {IDEA_MODEL} from './prices.js';
import {post, usageOf, type ArtProvider, type TextAnswer, type TextRequest, type Transport} from './provider.js';

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2026-10-21';
const MAX_RESPONSE_BYTES = 262_144;

export class AnthropicIdeas implements ArtProvider {
  readonly name = 'anthropic' as const;
  readonly model = IDEA_MODEL;
  readonly capabilities = {image: false, text: true} as const;
  readonly #key: string;
  readonly #transport: Transport;
  readonly #url: string;
  constructor(options: {readonly key: string; readonly transport?: Transport; readonly url?: string}) {
    this.#key = options.key; this.#transport = options.transport ?? ((url, init) => fetch(url, init)); this.#url = options.url ?? ANTHROPIC_URL;
  }
  async text(request: TextRequest, signal: AbortSignal): Promise<TextAnswer> {
    const body = JSON.stringify({model: request.model, max_tokens: request.maxTokens, system: request.system, messages: [{role: 'user', content: request.prompt}], output_config: {effort: 'low'}});
    const answer = await post(this.#transport, this.#url, {'x-api-key': this.#key, 'anthropic-version': ANTHROPIC_VERSION}, body, signal, MAX_RESPONSE_BYTES);
    const usage = usageOf(answer);
    const content = typeof answer === 'object' && answer !== null && 'content' in answer && Array.isArray(answer.content) ? answer.content as unknown[] : [];
    const stop = typeof answer === 'object' && answer !== null && 'stop_reason' in answer ? answer.stop_reason : undefined;
    // A refused or cut-off answer is no idea. The call still counts, from its usage.
    const text = stop === 'refusal' || stop === 'max_tokens' ? '' : content.flatMap(block => typeof block === 'object' && block !== null && 'type' in block && block.type === 'text' && 'text' in block && typeof block.text === 'string' ? [block.text] : []).join('\n').trim();
    return {text: text === '' ? null : text, usage};
  }
}
