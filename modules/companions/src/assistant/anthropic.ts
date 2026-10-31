// The Anthropic Messages API behind the turn contract (Hub #46), through the module's own fetch with a transport seam,
// as the Tidbyt module reaches its cloud. Request shape per the Claude API reference of 2026-10-21: versioned header,
// `strict` tools, `output_config.effort`, thinking left to the model's default, one tool call per turn. The key is held
// in memory, sent only as the request header and never logged, stored or published. No retry and no fallback model:
// ADR 0012 forbids automatic resends, and the owner declined a second model.
import {ProviderFault, textBytes, type ModelProvider, type ToolCall, type TranscriptItem, type TurnInput, type TurnReply, type TurnStop} from './provider.js';

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2026-10-21';
export const DEFAULT_MODEL = 'claude-opus-5-5';
export const EFFORTS = ['low', 'medium', 'high'] as const;
export type Effort = typeof EFFORTS[number];
/** The largest answer one turn may produce; a conversation reply is short and a tool call shorter. */
const MAX_TOKENS = 1024;
/** The largest response body read, in bytes, so a wrong endpoint cannot exhaust memory. */
const MAX_RESPONSE_BYTES = 262_144;
export type Transport = (url: string, init: {method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal}) => Promise<Response>;
export type AnthropicOptions = {readonly key: string; readonly model?: string; readonly effort?: Effort; readonly transport?: Transport; readonly url?: string};
type Block = {type: 'text'; text: string} | {type: 'tool_use'; id: string; name: string; input: Record<string, unknown>} | {type: 'tool_result'; tool_use_id: string; content: string; is_error?: true};
type ApiMessage = {role: 'user' | 'assistant'; content: Block[]};

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const TOOL_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** The transcript as Messages API turns: tool results follow the assistant turn that asked for them, as one user turn. */
export function toMessages(transcript: readonly TranscriptItem[]): ApiMessage[] {
  const messages: ApiMessage[] = [];
  const push = (role: ApiMessage['role'], block: Block): void => {
    const last = messages.at(-1);
    if (last !== undefined && last.role === role) last.content.push(block); else messages.push({role, content: [block]});
  };
  for (const item of transcript) {
    if (item.role === 'owner') push('user', {type: 'text', text: item.text});
    else if (item.role === 'assistant') {
      if (item.text !== null && item.text !== '') push('assistant', {type: 'text', text: item.text});
      for (const call of item.calls) push('assistant', {type: 'tool_use', id: call.id, name: call.name, input: {...call.input}});
    } else push('user', {type: 'tool_result', tool_use_id: item.call, content: item.result, ...(item.ok ? {} : {is_error: true as const})});
  }
  return messages;
}
const stopOf = (reason: unknown, calls: number): TurnStop => reason === 'refusal' ? 'refusal' : reason === 'max_tokens' ? 'truncated' : calls > 0 ? 'tool' : 'end';
const codeOfStatus = (status: number): ProviderFault => new ProviderFault(
  status === 401 ? 'unauthenticated' : status === 403 ? 'forbidden' : status === 404 ? 'not-found' : status === 429 ? 'capacity'
    : status === 400 || status === 422 ? 'invalid-request' : status === 413 ? 'too-large' : 'unavailable');

export class AnthropicProvider implements ModelProvider {
  readonly name = 'anthropic' as const;
  readonly model: string;
  readonly #effort: Effort;
  readonly #transport: Transport;
  readonly #url: string;
  readonly #key: string;
  constructor(options: AnthropicOptions) {
    this.model = options.model ?? DEFAULT_MODEL; this.#effort = options.effort ?? 'medium'; this.#key = options.key;
    this.#transport = options.transport ?? ((url, init) => fetch(url, init)); this.#url = options.url ?? ANTHROPIC_URL;
  }
  async turn(input: TurnInput, signal: AbortSignal): Promise<TurnReply> {
    const body = JSON.stringify({model: this.model, max_tokens: MAX_TOKENS, system: this.#system(input),
      tools: input.tools.map(tool => ({name: tool.name, description: tool.description, input_schema: tool.input, strict: true})),
      tool_choice: {type: 'auto', disable_parallel_tool_use: true}, messages: toMessages(input.transcript), output_config: {effort: this.#effort}});
    let response: Response;
    try {
      response = await this.#transport(this.#url, {method: 'POST', body, signal,
        headers: {'content-type': 'application/json', 'x-api-key': this.#key, 'anthropic-version': ANTHROPIC_VERSION}});
    } catch (error) {
      // The cause stays in memory: a transport error can carry the URL or the request.
      throw new ProviderFault(signal.aborted || (error instanceof Error && error.name === 'AbortError') ? 'cancelled' : 'unavailable', true);
    }
    if (!response.ok) throw codeOfStatus(response.status);
    let text: string;
    try {text = await response.text();} catch {throw new ProviderFault('unavailable', true);}
    if (textBytes(text) > MAX_RESPONSE_BYTES) throw new ProviderFault('too-large');
    let parsed: unknown;
    try {parsed = JSON.parse(text);} catch {throw new ProviderFault('invalid-message');}
    return this.#reply(parsed);
  }
  #system(input: TurnInput): string {
    const mode = input.mode === null ? 'The current Hub mode is unknown.' : `The current Hub mode is ${input.mode.mode}.`;
    return ['You are B.U.N.N.Y., the owner\'s home assistant. Answer in one to three short sentences.',
      'Use a tool when the request needs it and call at most one tool per turn. Reads need no approval.',
      'A command tool only proposes a change; the owner approves it, and the tool result says whether it was applied, refused or declined. Never claim a change was applied unless the result says so.',
      'If a request needs a detail you do not have, ask the owner with ask_owner. Do not invent device or session facts.',
      mode].join(' ');
  }
  #reply(value: unknown): TurnReply {
    if (!object(value) || !Array.isArray(value.content) || !object(value.usage)) throw new ProviderFault('invalid-message');
    const texts: string[] = [], calls: ToolCall[] = [];
    for (const block of value.content) {
      if (!object(block)) throw new ProviderFault('invalid-message');
      if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text);
      else if (block.type === 'tool_use') {
        if (typeof block.id !== 'string' || !TOOL_ID.test(block.id) || typeof block.name !== 'string' || !object(block.input)) throw new ProviderFault('invalid-message');
        calls.push({id: block.id, name: block.name, input: block.input});
      }
      // Thinking and other block types carry nothing the engine acts on.
    }
    const {usage} = value;
    const counted = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'].map(key => usage[key]).filter(count => count !== undefined && count !== null);
    const units = counted.length === 0 || !counted.every(integer) ? null : counted.reduce((sum, count) => sum + count, 0);
    const stop = stopOf(value.stop_reason, calls.length);
    const text = texts.join('\n').trim();
    return {text: text === '' ? null : text, calls: stop === 'tool' ? calls : [], stop, units};
  }
}
