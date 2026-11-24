// The tool-capable turn contract every provider answers (Hub #46, #507, #2029). A provider sees the fixed instructions,
// the task's own transcript, the permitted tool definitions, the current Hub mode and the prompt context, which the
// sectioned context builder assembles for the task's companion (see context.ts): its curated personality, the owner's
// knowledge notes once the owner turns them on for it, the owner's active explicit preferences, an empty long-term memory
// slot and the recent messages of the task's own conversation. It answers with text, tool calls or a stop that ends the
// task. The engine owns limits, receipts, approval and effects; a provider never reaches the bus, a device or a file, and
// never sees another conversation, another companion's messages, an inactive preference or a removed message.
import type {ErrorCode} from '@jimmie-potts/event-contracts/v2';
import type {AssistantProvider} from '@jimmie-potts/event-contracts/v2/assistant';
import type {TokenUsage} from './spend-contract.js';
import type {PromptContext} from './context.js';
export type {PromptContext} from './context.js';

/** A closed JSON schema for a tool's input, as the Messages API's `input_schema` with `strict` takes it. */
type ToolProperty = {type: 'string'; description: string; enum?: readonly string[]}
  | {type: 'boolean' | 'integer'; description: string}
  | {type: 'array'; items: {type: 'string'}; description: string};
export type ToolInputSchema = {type: 'object'; properties: Readonly<Record<string, ToolProperty>>;
  required: readonly string[]; additionalProperties: false};
/** What a tool does when the model calls it: a question, a read, a private draft edit, or an approved command. */
export type ToolEffect = 'question' | 'read' | 'draft' | 'command';
export type ToolDefinition = {readonly name: string; readonly description: string; readonly input: ToolInputSchema; readonly effect: ToolEffect};
export type ToolCall = {id: string; name: string; input: Readonly<Record<string, unknown>>};
/**
 * One item of a task's transcript, kept in the task record so a turn can be replayed after restart. An assistant item
 * may keep the provider's own content blocks (`blocks`), which the provider replays unchanged: a hosted model's thinking
 * blocks must go back exactly as received with the turn whose tool call awaits its result.
 */
export type TranscriptItem =
  | {role: 'owner'; text: string}
  | {role: 'assistant'; text: string | null; calls: ToolCall[]; blocks?: unknown[]}
  | {role: 'tool'; call: string; name: string; result: string; ok: boolean};
export type TurnInput = {
  readonly instructions: string;
  readonly context: PromptContext;
  readonly transcript: readonly TranscriptItem[];
  readonly tools: readonly ToolDefinition[];
  /** The Hub mode the module's synced copy holds, or null when it has none. */
  readonly mode: {readonly mode: string; readonly revision: number} | null;
};
/** How a turn ended: a final answer, tool calls to act on, the provider's own refusal, or output cut at the provider's limit. */
export type TurnStop = 'end' | 'tool' | 'refusal' | 'truncated';
/**
 * A turn's answer. `units` is the reported usage's total, or null when unreported; `usage` breaks a paid provider's
 * report down by price class for the spend ledger (Hub #2024), null when unreported, and is absent for the synthetic provider.
 */
export type TurnReply = {text: string | null; calls: ToolCall[]; stop: TurnStop; units: number | null; usage?: TokenUsage | null; blocks?: unknown[]};
export type ModelProvider = {
  readonly name: AssistantProvider;
  readonly model: string;
  turn(input: TurnInput, signal: AbortSignal): Promise<TurnReply>;
};
/**
 * A provider's typed failure, mapped once at its boundary to a registry code; its message is fixed text. `uncertain`
 * marks a lost answer: the request may have reached the provider, so its usage is unknown and the call stays uncertain.
 * A definitive answer, such as a refusal or an error status, fails the call and the task with the code.
 */
export class ProviderFault extends Error {
  /**
   * `sizeLimit` names a request or response size refusal; `closingReason` is fixed text for the owner that ends the turn's
   * closing reply, such as Anthropic's reached monthly spend limit (Hub #2047).
   */
  constructor(readonly code: ErrorCode, readonly uncertain = false, readonly sizeLimit?: 'request' | 'response', readonly closingReason?: string) {super(`provider ${code}`);}
}
export const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;
export const textBytes = (value: string): number => Buffer.byteLength(value, 'utf8');
