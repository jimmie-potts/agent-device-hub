// The one small interface behind which either provider can be replaced (docs/art-generation-qualification.md, "Selected
// route"). A provider answers or throws `ProviderFault`, which says what the case table needs: whether the call definitely
// ended, and whether it reported usage. It never carries a key, a prompt or a provider's text.
import type {ErrorCode} from '@jimmie-potts/event-contracts/v2';
import type {ArtProviderName, ArtReason} from '@jimmie-potts/event-contracts/v2/art-state';
import type {Usage} from './prices.js';

/** `gif` asks for OpenAI's preview GIF output. The API answers with one GIF in place of a PNG, on this endpoint only. */
export type ImageRequest = {readonly model: string; readonly quality: string; readonly size: string; readonly prompt: string; readonly gif?: {readonly frameCount: number; readonly frameDurationMs: number}};
export type ImageAnswer = {readonly bytes: Uint8Array; readonly usage: Usage | null};
export type TextRequest = {readonly model: string; readonly system: string; readonly prompt: string; readonly maxTokens: number};
export type TextAnswer = {readonly text: string | null; readonly usage: Usage | null};
export interface ArtProvider {
  readonly name: ArtProviderName;
  readonly model: string;
  readonly capabilities: {readonly image: boolean; readonly text: boolean};
  image?(request: ImageRequest, signal: AbortSignal): Promise<ImageAnswer>;
  text?(request: TextRequest, signal: AbortSignal): Promise<TextAnswer>;
}
export type Transport = (url: string, init: {method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal; redirect: 'error'}) => Promise<Response>;

/**
 * How a call ended without a usable answer. `uncertain` means the call's effect is unknown, so the target is uncertain.
 * Spend follows `usage`: reported usage settles the call. Without it, a definite refusal settles at zero when `keep` is
 * false, and otherwise the reservation is kept.
 */
export class ProviderFault extends Error {
  constructor(readonly code: ErrorCode, readonly reason: ArtReason, readonly options: {uncertain?: boolean; keep?: boolean; usage?: Usage | null} = {}) {super(code);}
  get uncertain(): boolean {return this.options.uncertain === true;}
  get keep(): boolean {return this.options.keep === true;}
  get usage(): Usage | null {return this.options.usage ?? null;}
}
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
/** `usage` from either API's body, or null unless both counts are present and whole. */
export function usageOf(body: unknown): Usage | null {
  if (!object(body) || !object(body.usage)) return null;
  const {input_tokens: inputTokens, output_tokens: outputTokens} = body.usage;
  return count(inputTokens) && count(outputTokens) ? {inputTokens, outputTokens} : null;
}
const codeOfStatus = (status: number): ErrorCode => status === 401 ? 'unauthenticated' : status === 403 ? 'forbidden' : status === 404 ? 'not-found' : status === 429 ? 'capacity'
  : status === 413 ? 'too-large' : status === 400 || status === 422 ? 'invalid-request' : 'unavailable';
/**
 * Sends one request, never twice. The API never redirects, and refusing one keeps the key from following it to another
 * origin. The answer's body is read to at most `maxBytes`; a call whose body is lost stays uncertain.
 */
export async function post(transport: Transport, url: string, headers: Record<string, string>, body: string, signal: AbortSignal, maxBytes: number): Promise<unknown> {
  let response: Response;
  try {
    response = await transport(url, {method: 'POST', headers: {'content-type': 'application/json', ...headers}, body, signal, redirect: 'error'});
  } catch {
    // The cause stays in memory: a transport error can carry the URL or the request.
    throw new ProviderFault(signal.aborted ? 'cancelled' : 'uncertain-result', signal.aborted ? 'cancelled' : 'lost-response', {uncertain: true, keep: true});
  }
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (Number.isSafeInteger(declared) && declared > maxBytes) {
    void response.body?.cancel().catch(() => {});
    if (!response.ok) throw statusFault(response.status, null);
    throw new ProviderFault('too-large', 'invalid-output', {keep: true});
  }
  let text: string;
  try {text = await boundedText(response, maxBytes);} catch (error) {
    if (!response.ok) throw statusFault(response.status, null);
    if (error instanceof ProviderFault) throw error;
    throw new ProviderFault('uncertain-result', 'lost-response', {uncertain: true, keep: true});
  }
  let parsed: unknown;
  try {parsed = JSON.parse(text);} catch {
    if (!response.ok) throw statusFault(response.status, null);
    throw new ProviderFault('invalid-message', 'invalid-output', {keep: true});
  }
  if (!response.ok) throw statusFault(response.status, parsed);
  return parsed;
}
async function boundedText(response: Response, maxBytes: number): Promise<string> {
  if (response.body === null) return '';
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) return Buffer.concat(chunks, bytes).toString('utf8');
      bytes += part.value.byteLength;
      if (bytes > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new ProviderFault('too-large', 'invalid-output', {keep: true});
      }
      chunks.push(part.value);
    }
  } finally {reader.releaseLock();}
}
function statusFault(status: number, body: unknown): ProviderFault {
  const usage = usageOf(body), detail = object(body) && object(body.error) ? body.error : undefined;
  const moderation = detail?.code === 'moderation_blocked';
  // A 5xx without usage may have run; a 4xx did not, unless it says so.
  if (status >= 500 && usage === null) return new ProviderFault('uncertain-result', 'lost-response', {uncertain: true, keep: true});
  return new ProviderFault(codeOfStatus(status), moderation ? 'moderation' : 'provider-refused', {usage});
}
