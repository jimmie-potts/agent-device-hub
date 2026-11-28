// The Anthropic Messages API behind the turn contract (Hub #46), through the module's own fetch with a transport seam,
// as the Tidbyt module reaches its cloud. Request shape per the Claude API reference of 2026-10-21: versioned header,
// closed tool schemas, `output_config.effort`, thinking left to the model's default, one tool call per turn. The model's own
// content blocks, thinking blocks included, are kept with the assistant turn and replayed exactly as received, which the
// API requires for the turn whose tool call awaits its result. The key is held in memory, sent only as the request header
// and never logged, stored or published. ADR 0012 forbids automatic resends. Provider selection is fixed for the task.
import type {TokenUsage} from './spend-contract.js';
import {sectionTexts} from './context.js';
import {estimateHostedInputTokens, hostedInputBudget, hostedInputTokenCeiling} from './context-budget.js';
import {outputTokenCap, ProviderFault, textBytes, TOOL_RESPONSE_INSTRUCTIONS, type ModelProvider, type ToolCall, type ToolDefinition, type ToolInputSchema, type TranscriptItem, type TurnInput, type TurnReply, type TurnStop} from './provider.js';

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2026-10-21';
export const DEFAULT_MODEL = 'claude-opus-5-5';
export const EFFORTS = ['low', 'medium', 'high'] as const;
export type Effort = typeof EFFORTS[number];
/**
 * The cap on one answer's thinking plus text, as the reference sizes a non-streaming request. Thinking cannot be turned
 * off on the default model, so a short cap would cut answers; the engine's own reply and result bounds limit what is kept.
 */
export const MAX_TOKENS = 16_000;
/** The largest response body kept, in bytes; a larger `content-length` is refused before the body is read. */
const MAX_RESPONSE_BYTES = 262_144;
export type Transport = (url: string, init: {method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal; redirect: 'error'}) => Promise<Response>;
export type AnthropicOptions = {readonly key: string; readonly model?: string; readonly effort?: Effort; readonly transport?: Transport; readonly url?: string};
type Block = Record<string, unknown>;
type ApiMessage = {role: 'user' | 'assistant'; content: Block[]};

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const TOOL_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function conformsToSchema(schema: ToolInputSchema, input: ToolCall['input']): boolean {
  if (!schema.required.every(key => Object.hasOwn(input, key))) return false;
  return Object.entries(input).every(([key, value]) => {
    if (!Object.hasOwn(schema.properties, key)) return false;
    const property = schema.properties[key];
    if (property === undefined) return false;
    switch (property.type) {
      case 'string': return typeof value === 'string' && (property.enum === undefined || property.enum.includes(value));
      case 'integer': return typeof value === 'number' && Number.isSafeInteger(value);
      case 'boolean': return typeof value === 'boolean';
      case 'object': return object(value) && conformsToSchema(property, value);
      case 'array': {
        const {items} = property;
        return Array.isArray(value) && value.every(item => items.type === 'string'
          ? typeof item === 'string' : object(item) && conformsToSchema(items, item));
      }
    }
  });
}

/**
 * The transcript as Messages API turns. An assistant item that kept the provider's blocks replays them unchanged; one
 * without them (the synthetic provider's, or an older record) is rebuilt from its text and call. Tool results follow the
 * assistant turn that asked for them, as one user turn. A call gets one `tool_result`: a later word for a call already
 * answered, the coding worker's result after the hand-off acceptance (Hub #502, #1360), is a user text block naming the
 * call, since the API refuses a second result for one `tool_use_id`.
 */
export function toMessages(transcript: readonly TranscriptItem[]): ApiMessage[] {
  const messages: ApiMessage[] = [];
  const answered = new Set<string>();
  const push = (role: ApiMessage['role'], block: Block): void => {
    const last = messages.at(-1);
    if (last !== undefined && last.role === role) last.content.push(block); else messages.push({role, content: [block]});
  };
  for (const item of transcript) {
    if (item.role === 'owner') push('user', {type: 'text', text: item.text});
    else if (item.role === 'assistant') {
      if (item.blocks !== undefined) {for (const block of item.blocks) if (object(block)) push('assistant', {...block});}
      else {
        if (item.text !== null && item.text !== '') push('assistant', {type: 'text', text: item.text});
        for (const call of item.calls) push('assistant', {type: 'tool_use', id: call.id, name: call.name, input: {...call.input}});
      }
    } else if (answered.has(item.call)) push('user', {type: 'text', text: `${item.ok ? 'Later result' : 'Later failed result'} of the tool ${item.name} (${item.call}), the tool's own word and not the owner's: ${item.result}`});
    else {answered.add(item.call); push('user', {type: 'tool_result', tool_use_id: item.call, content: item.result, ...(item.ok ? {} : {is_error: true})});}
  }
  return messages;
}
/**
 * The reported usage by price class. Input and output counts are required; an absent or null cache count is zero, as the
 * API reports a request that wrote or read no cache. Anything else is unreported usage, which the engine never counts as zero.
 */
function usageOf(usage: Record<string, unknown>): TokenUsage | null {
  const count = (key: string, required: boolean): number | null => {const value = usage[key]; return value === undefined || value === null ? required ? null : 0 : integer(value) ? value : null;};
  const input = count('input_tokens', true), output = count('output_tokens', true), cacheWrite = count('cache_creation_input_tokens', false), cacheRead = count('cache_read_input_tokens', false);
  return input === null || output === null || cacheWrite === null || cacheRead === null ? null : {input, output, cacheWrite, cacheRead};
}
const stopOf = (reason: unknown, calls: number): TurnStop => reason === 'refusal' ? 'refusal' : reason === 'max_tokens' ? 'truncated' : calls > 0 ? 'tool' : 'end';
/**
 * The owner's text for a reached Anthropic spend limit (Hub #2047): the dedicated workspace's or the organization's
 * monthly limit, which Anthropic enforces on real billing. The task ends `capacity`; nothing more is sent and nothing retries.
 */
export const SPEND_LIMIT_REACHED = 'The monthly spend limit at Anthropic is reached, so the model call was refused and nothing more was sent for this turn. The Anthropic Console shows the limit, this month\'s real spend and when access resumes.';
const SPEND_LIMIT_MESSAGES = ['You have reached your specified API usage limits', 'You have reached your specified workspace API usage limits'];
/**
 * Whether an error answer is a spend-limit refusal, as Anthropic's rate-limit documentation of 2026-11-22 describes it: a
 * 400 `invalid_request_error` for a limit the owner set, whose message starts with one of two fixed phrases, or a 429
 * `rate_limit_error` with `error.details.error_code` `enforced_spend_limit_reached` for the tier's cap. Any other 400 or
 * 429 keeps its usual code.
 */
function spendLimitRefusal(status: number, text: string): boolean {
  let value: unknown;
  try {value = JSON.parse(text);} catch {return false;}
  const error = object(value) && object(value.error) ? value.error : undefined;
  if (error === undefined) return false;
  if (status === 400) return error.type === 'invalid_request_error' && typeof error.message === 'string' && SPEND_LIMIT_MESSAGES.some(start => (error.message as string).startsWith(start));
  return status === 429 && error.type === 'rate_limit_error' && object(error.details) && error.details.error_code === 'enforced_spend_limit_reached';
}
export const codeOfStatus = (status: number): ProviderFault => new ProviderFault(
  status === 401 ? 'unauthenticated' : status === 403 ? 'forbidden' : status === 404 ? 'not-found' : status === 429 ? 'capacity'
    : status === 400 || status === 422 ? 'invalid-request' : status === 413 ? 'too-large' : 'unavailable', false, status === 413 ? 'request' : undefined);
/**
 * The fault an error answer maps to, once: a documented spend-limit refusal, read from the bounded body of a 400 or 429, is
 * `capacity` with the monthly-limit text; anything else keeps its status's code. Task and title calls share it (Hub #2047).
 */
export async function faultOf(response: Response): Promise<ProviderFault> {
  if (response.status === 400 || response.status === 429) {
    const length = Number(response.headers.get('content-length') ?? '0');
    const body = Number.isSafeInteger(length) && length > MAX_RESPONSE_BYTES ? '' : await response.text().catch(() => '');
    if (textBytes(body) <= MAX_RESPONSE_BYTES && spendLimitRefusal(response.status, body)) return new ProviderFault('capacity', false, undefined, SPEND_LIMIT_REACHED);
  }
  return codeOfStatus(response.status);
}

export class AnthropicProvider implements ModelProvider {
  readonly name = 'anthropic' as const;
  readonly available: boolean;
  readonly model: string;
  readonly variant: string;
  readonly inputWindow: number;
  readonly #effort: Effort;
  readonly #transport: Transport;
  readonly #url: string;
  readonly #key: string;
  constructor(options: AnthropicOptions) {
    this.model = options.model ?? DEFAULT_MODEL; this.#effort = options.effort ?? 'medium'; this.#key = options.key;
    this.inputWindow = hostedInputBudget({provider: this.name, model: this.model, maxOutputTokens: MAX_TOKENS});
    this.variant = `messages-v1:${this.#effort}`;
    this.available = this.#key.trim() !== '';
    this.#transport = options.transport ?? ((url, init) => fetch(url, init)); this.#url = options.url ?? ANTHROPIC_URL;
  }
  #body(input: TurnInput): string {
    // The permitted catalog can exceed Claude's combined strict grammar budget even within its tool count limit.
    const tools = input.tools.map(tool => ({name: tool.name, description: tool.description, input_schema: tool.input}));
    return JSON.stringify({model: this.model, max_tokens: outputTokenCap(input, MAX_TOKENS), system: this.#system(input),
      ...(tools.length === 0 ? {} : {tools, tool_choice: {type: 'auto', disable_parallel_tool_use: true}}),
      messages: toMessages(input.transcript), output_config: {effort: this.#effort},
      // Automatic prompt caching (Hub #2024): the API places the breakpoint on the last cacheable block and moves it as the
      // transcript grows. Tools, then the system prompt, then the replayed transcript are byte-stable between a task's
      // calls, so the next call reads the earlier ones' prefix from the cache at the five-minute lifetime. The system
      // prompt's first block carries its own breakpoint (Hub #2029), so a later task also reads the stable sections.
      cache_control: {type: 'ephemeral'}});
  }

  contextInputUnits(input: TurnInput): number {return estimateHostedInputTokens(this.#body(input), this);}

  async turn(input: TurnInput, signal: AbortSignal): Promise<TurnReply> {
    if (!this.available) throw new ProviderFault('unavailable');
    const body = this.#body(input);
    if (hostedInputTokenCeiling(body) > this.inputWindow) throw new ProviderFault('too-large', false, 'request');
    let response: Response;
    try {
      // The API never redirects; refusing one keeps the key from following a redirect to another origin.
      response = await this.#transport(this.#url, {method: 'POST', body, signal, redirect: 'error',
        headers: {'content-type': 'application/json', 'x-api-key': this.#key, 'anthropic-version': ANTHROPIC_VERSION}});
    } catch (error) {
      // The cause stays in memory: a transport error can carry the URL or the request. The answer is lost, so the call stays uncertain.
      throw new ProviderFault(signal.aborted || (error instanceof Error && error.name === 'AbortError') ? 'cancelled' : 'unavailable', true);
    }
    if (!response.ok) throw await faultOf(response);
    const length = Number(response.headers.get('content-length') ?? '0');
    if (Number.isSafeInteger(length) && length > MAX_RESPONSE_BYTES) throw new ProviderFault('too-large', false, 'response');
    let text: string;
    try {text = await response.text();} catch {throw new ProviderFault('unavailable', true);}
    if (textBytes(text) > MAX_RESPONSE_BYTES) throw new ProviderFault('too-large', false, 'response');
    let parsed: unknown;
    try {parsed = JSON.parse(text);} catch {throw new ProviderFault('invalid-message');}
    return this.#reply(parsed, input.tools);
  }
  /**
   * The system prompt as two text blocks (Hub #2029). The first holds the instructions, the personality, the fixed rules,
   * the knowledge notes, the preferences and the memory slot, and carries an explicit cache breakpoint, so a later task of
   * the conversation reads that prefix from the cache even though its recent conversation differs. The second holds the
   * recent conversation and the Hub mode. The top-level automatic breakpoint still covers the growing transcript.
   */
  #system(input: TurnInput): {type: 'text'; text: string; cache_control?: {type: 'ephemeral'}}[] {
    // The mode line is the mode now: in a turn after an approved command it already shows the applied value, and a model that
    // read it as the earlier state told the owner "already in Work" after switching from Free (#504 readout, 2026-11-01).
    const mode = input.mode === null ? 'The Hub mode is unknown now.'
      : `The Hub mode is ${input.mode.mode} now. This is the state after any command already applied earlier in this task, not the mode before it.`;
    // The context builder's sections in their fixed order (Hub #2029): the personality and the fixed rules, then the
    // knowledge notes, preferences and memory, which change rarely, then the recent conversation, which changes with each
    // task, and the mode last, so the cached prefix reaches as far as possible.
    const stable = [input.instructions, ...sectionTexts(input.context, ['personality']),
      TOOL_RESPONSE_INSTRUCTIONS, 'Use a tool when the request needs it. Reads need no approval.',
      'Run a Hub or device control only for a clear request in the current owner message. Earlier messages can identify what a current request refers to. Status questions, hypotheticals, and suggestions never authorize a control. Paid artwork and coding delegation still ask for approval. Claim a change was applied only with confirming tool evidence.',
      'If a request needs a detail you do not have, ask the owner with ask_owner. Do not invent device or session facts.',
      ...sectionTexts(input.context, ['knowledge', 'preferences', 'memory'])].join('\n\n');
    return [{type: 'text', text: stable, cache_control: {type: 'ephemeral'}}, {type: 'text', text: [...sectionTexts(input.context, ['recent']), mode].join('\n\n')}];
  }
  #reply(value: unknown, tools: readonly ToolDefinition[]): TurnReply {
    if (!object(value) || !object(value.usage)) throw new ProviderFault('invalid-message');
    const usage = usageOf(value.usage);
    const malformed = () => new ProviderFault('invalid-message', false, undefined, undefined, usage);
    if (!Array.isArray(value.content)) throw malformed();
    const texts: string[] = [], calls: ToolCall[] = [], blocks: Block[] = [];
    for (const block of value.content) {
      if (!object(block)) throw malformed();
      if (block.type === 'text' && typeof block.text === 'string') {texts.push(block.text); blocks.push(block);}
      else if (block.type === 'tool_use') {
        if (typeof block.id !== 'string' || !TOOL_ID.test(block.id) || typeof block.name !== 'string' || !object(block.input)) throw malformed();
        // The engine acts on one call per model response; a further call is dropped here so no replayed tool_use lacks its result.
        if (calls.length === 0) {calls.push({id: block.id, name: block.name, input: block.input}); blocks.push(block);}
      } else blocks.push(block);
      // Thinking and any other block the model returned are kept as received for replay; the engine acts on none of them.
    }
    const units = usage === null ? null : usage.input + usage.output + usage.cacheWrite + usage.cacheRead;
    const stop = stopOf(value.stop_reason, calls.length);
    const call = calls[0];
    if (stop === 'tool' && call !== undefined) {
      const definition = tools.find(tool => tool.name === call.name);
      if (definition !== undefined && !conformsToSchema(definition.input, call.input)) throw malformed();
    }
    const text = texts.join('\n').trim();
    return {text: text === '' ? null : text, calls: stop === 'tool' ? calls : [], stop, units, usage, blocks};
  }
}
