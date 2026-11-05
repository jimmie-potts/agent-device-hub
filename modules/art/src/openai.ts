// OpenAI's Image API through the module's own fetch, with a transport seam, as `modules/companions` reaches Anthropic. One
// request yields one image and its reported usage (the record's live trial). The key is held in memory, sent only as the
// request header and never logged, stored or published. No retry: ADR 0012 forbids automatic resends.
import {IMAGE_MODEL} from './prices.js';
import {MAX_IMAGE_BYTES} from './media.js';
import {ProviderFault, post, usageOf, type ArtProvider, type ImageAnswer, type ImageRequest, type Transport} from './provider.js';

export const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';
/** Base64 grows the image by a third, and the JSON around it is small. */
const MAX_RESPONSE_BYTES = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 65_536;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export class OpenAiImages implements ArtProvider {
  readonly name = 'openai' as const;
  readonly model = IMAGE_MODEL;
  readonly capabilities = {image: true, text: false} as const;
  readonly #key: string;
  readonly #transport: Transport;
  readonly #url: string;
  constructor(options: {readonly key: string; readonly transport?: Transport; readonly url?: string}) {
    this.#key = options.key; this.#transport = options.transport ?? ((url, init) => fetch(url, init)); this.#url = options.url ?? OPENAI_IMAGES_URL;
  }
  async image(request: ImageRequest, signal: AbortSignal): Promise<ImageAnswer> {
    const body = JSON.stringify({model: request.model, prompt: request.prompt, size: request.size, quality: request.quality, n: 1,
      ...(request.gif === undefined ? {output_format: 'png'} : {output_format: 'gif', frame_count: request.gif.frameCount, frame_duration_ms: request.gif.frameDurationMs})});
    const answer = await post(this.#transport, this.#url, {authorization: `Bearer ${this.#key}`}, body, signal, MAX_RESPONSE_BYTES, request.gif !== undefined);
    const usage = usageOf(answer);
    const first = typeof answer === 'object' && answer !== null && 'data' in answer && Array.isArray(answer.data) ? answer.data[0] as unknown : undefined;
    const encoded = typeof first === 'object' && first !== null && 'b64_json' in first ? first.b64_json : undefined;
    if (typeof encoded !== 'string' || !BASE64.test(encoded)) throw new ProviderFault('invalid-message', 'invalid-output', {usage, keep: usage === null});
    return {bytes: Buffer.from(encoded, 'base64'), usage};
  }
}
