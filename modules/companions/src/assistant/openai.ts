import {codeOfStatus, conformsToSchema, type Effort, type Transport} from './anthropic.js';
import {sectionTexts} from './context.js';
import {LIMITS} from './limits.js';
import {ProviderFault, textBytes, type ModelProvider, type ToolCall, type TurnInput, type TurnReply} from './provider.js';
import {TITLE_INSTRUCTIONS, TITLE_MAX_TOKENS, type TitleProvider, type TitleReply} from './titles.js';
import type {TokenUsage} from './spend-contract.js';

export const OPENAI_URL = 'https://api.openai.com/v1/responses';
export const OPENAI_MODEL = 'gpt-6.2-sol';
export const OPENAI_OUTPUT_TOKENS = LIMITS.outputUnits;
const RESPONSE_BYTES = 262_144;
const CALL_ID = /^[A-Za-z0-9_-]{1,128}$/;
type Item = Record<string, unknown>;
const object = (value: unknown): value is Item => typeof value === 'object' && value !== null && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

type Options = {key: string; model: string; effort: Effort; transport?: Transport};

export function responsesUsage(value: unknown): TokenUsage | null {
  if (!object(value) || !count(value.input_tokens) || !count(value.output_tokens)) return null;
  const details = value.input_tokens_details;
  if (!object(details)) return null;
  const read = details.cached_tokens, write = details.cache_write_tokens;
  if (!count(read) || !count(write) || read + write > value.input_tokens) return null;
  return {input: value.input_tokens - read - write, output: value.output_tokens, cacheRead: read, cacheWrite: write};
}

function replayItem(item: unknown): item is Item {
  if (!object(item)) return false;
  if (item.type === 'reasoning') return typeof item.encrypted_content === 'string' && typeof item.id === 'string' && Array.isArray(item.summary);
  return item.type === 'message' && item.role === 'assistant' || item.type === 'function_call';
}

function transcriptOf(input: TurnInput): Item[] {
  const items: Item[] = [], calls = new Set<string>(), answered = new Set<string>();
  for (const item of input.transcript) {
    if (item.role === 'owner') {
      items.push({role: 'user', content: item.text});
    } else if (item.role === 'assistant') {
      for (const block of item.blocks ?? []) {
        if (!replayItem(block)) throw new ProviderFault('invalid-message');
        items.push(block);
        if (block.type === 'function_call' && typeof block.call_id === 'string') calls.add(block.call_id);
      }
    } else if (calls.has(item.call) && !answered.has(item.call)) {
      answered.add(item.call);
      items.push({type: 'function_call_output', call_id: item.call, output: item.result});
    }
  }
  return items;
}

class ResponsesClient {
  readonly #transport: Transport;
  readonly #key: string;
  constructor(readonly model: string, readonly effort: Effort, options: Options) {
    this.#transport = options.transport ?? ((url, init) => fetch(url, init));
    this.#key = options.key;
  }

  body(input: Item[], instructions: string, maxOutput: number, tools: Item[] = []): string {
    return JSON.stringify({model: this.model, instructions, input, tools, store: false, parallel_tool_calls: false,
      max_output_tokens: maxOutput, reasoning: {effort: this.effort}, include: ['reasoning.encrypted_content'],
      service_tier: 'default', prompt_cache_options: {ttl: '30m'}});
  }

  async request(body: string, signal: AbortSignal): Promise<Item> {
    if (signal.aborted) throw new ProviderFault('cancelled');
    let response: Response;
    try {
      response = await this.#transport(OPENAI_URL, {method: 'POST', body, signal, redirect: 'error',
        headers: {'content-type': 'application/json', authorization: `Bearer ${this.#key}`}});
    } catch {
      throw new ProviderFault(signal.aborted ? 'cancelled' : 'unavailable', true);
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      const fault = codeOfStatus(response.status);
      throw new ProviderFault(fault.code, response.status === 408 || response.status >= 500, fault.sizeLimit);
    }
    if (Number(response.headers.get('content-length')) > RESPONSE_BYTES) {
      void response.body?.cancel().catch(() => {});
      throw new ProviderFault('too-large', true, 'response');
    }
    const reader = response.body?.getReader();
    if (reader === undefined) throw new ProviderFault('invalid-message', true);
    let bytes = 0, text = '';
    const decoder = new TextDecoder('utf-8', {fatal: true});
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > RESPONSE_BYTES) throw new ProviderFault('too-large', true, 'response');
        text += decoder.decode(part.value, {stream: true});
      }
      text += decoder.decode();
      const value: unknown = JSON.parse(text);
      if (!object(value) || !Array.isArray(value.output) || (value.status !== 'completed' && value.status !== 'incomplete')) {
        throw new ProviderFault('invalid-message', true);
      }
      return value;
    } catch (error) {
      if (error instanceof ProviderFault) throw error;
      throw new ProviderFault(signal.aborted ? 'cancelled' : 'invalid-message', true);
    } finally {
      void reader.cancel().catch(() => {});
    }
  }
}

function answer(value: Item, tools: TurnInput['tools']): TurnReply {
  const blocks: Item[] = [], calls: ToolCall[] = [], texts: string[] = [];
  let refused = false;
  for (const item of value.output as unknown[]) {
    if (!object(item)) throw new ProviderFault('invalid-message', true);
    if (item.type === 'message' && item.role === 'assistant' && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (object(part) && part.type === 'refusal') refused = true;
        else if (object(part) && part.type === 'output_text' && typeof part.text === 'string') texts.push(part.text);
        else throw new ProviderFault('invalid-message', true);
      }
    } else if (item.type === 'function_call') {
      if (value.status === 'incomplete') continue;
      if (typeof item.call_id !== 'string' || !CALL_ID.test(item.call_id) || typeof item.name !== 'string' ||
          typeof item.arguments !== 'string' || calls.length > 0) throw new ProviderFault('invalid-message', true);
      let input: unknown;
      try {input = JSON.parse(item.arguments);} catch {throw new ProviderFault('invalid-message', true);}
      const definition = tools.find(tool => tool.name === item.name);
      if (definition === undefined || !object(input) || !conformsToSchema(definition.input, input)) throw new ProviderFault('invalid-message', true);
      calls.push({id: item.call_id, name: item.name, input});
    } else if (item.type !== 'reasoning' || !replayItem(item)) {
      throw new ProviderFault('invalid-message', true);
    }
    blocks.push(item);
  }
  const filtered = object(value.incomplete_details) && value.incomplete_details.reason === 'content_filter';
  const stop = refused || filtered ? 'refusal' : value.status === 'incomplete' ? 'truncated' : calls.length > 0 ? 'tool' : 'end';
  const text = texts.join('\n').trim();
  const usage = responsesUsage(value.usage), units = usage === null ? null : usage.input + usage.cacheRead + usage.cacheWrite + usage.output;
  return {text: text === '' ? null : text, stop, calls: stop === 'tool' ? calls : [], usage, units,
    blocks: stop === 'tool' || stop === 'end' ? blocks : []};
}

export class OpenAIProvider implements ModelProvider {
  readonly name = 'openai' as const;
  readonly variant: string;
  readonly available: boolean;
  readonly model: string;
  readonly #client: ResponsesClient;

  constructor(options: Options) {
    this.model = options.model;
    this.available = options.key.trim() !== '';
    this.variant = `responses-v1:${options.effort}`;
    this.#client = new ResponsesClient(this.model, options.effort, options);
  }

  #body(input: TurnInput): string {
    const instructions = [input.instructions, ...sectionTexts(input.context),
      ...(input.mode === null ? [] : [`The Hub mode is ${input.mode.mode} now.`]),
      'Use at most one tool per turn. Only an explicit current owner request can authorize a control. Ask the owner when a detail is missing. Claim applied effects only with confirming tool evidence.'].join('\n\n');
    return this.#client.body(transcriptOf(input), instructions, OPENAI_OUTPUT_TOKENS, input.tools.map(tool =>
      ({type: 'function', name: tool.name, description: tool.description, parameters: tool.input, strict: Object.keys(tool.input.properties).length === tool.input.required.length})));
  }

  inputUnits(input: TurnInput): number {return textBytes(this.#body(input)) + LIMITS.overheadUnits;}

  async turn(input: TurnInput, signal: AbortSignal): Promise<TurnReply> {
    if (!this.available) throw new ProviderFault('unavailable');
    return answer(await this.#client.request(this.#body(input), signal), input.tools);
  }
}

export class OpenAITitleProvider implements TitleProvider {
  readonly name = 'openai' as const;
  readonly model: string;
  readonly #client: ResponsesClient;

  constructor(options: Omit<Options, 'effort'>) {
    this.model = options.model;
    this.#client = new ResponsesClient(this.model, 'low', {...options, effort: 'low'});
  }

  #body(prompt: string): string {
    return this.#client.body([{role: 'user', content: prompt}], TITLE_INSTRUCTIONS, TITLE_MAX_TOKENS);
  }

  inputUnits(prompt: string): number {return textBytes(this.#body(prompt)) + LIMITS.overheadUnits;}

  async title(prompt: string, signal: AbortSignal): Promise<TitleReply> {
    const reply = answer(await this.#client.request(this.#body(prompt), signal), []);
    return {text: reply.stop === 'end' ? reply.text : null, usage: reply.usage ?? null};
  }
}
