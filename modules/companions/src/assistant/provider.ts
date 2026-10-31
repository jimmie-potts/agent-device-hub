// The tool-capable turn contract every provider answers (Hub #46, #507). A provider sees the fixed instructions, the
// task's own transcript, the permitted tool definitions, the current Hub mode and the prompt context (the profile's
// curated persona and the owner's active explicit preferences), and answers with text, tool calls or a stop that ends
// the task. The engine owns limits, receipts, approval and effects; a provider never reaches the bus, a device or a
// file, and never sees a knowledge entry, a conversation's history, an inactive preference or another task.
import type {ErrorCode} from '@jimmie-potts/event-contracts/v2';
import type {AssistantProvider} from '@jimmie-potts/event-contracts/v2/assistant';

/** A closed JSON schema for a tool's input, as the Messages API's `input_schema` with `strict` takes it. */
export type ToolInputSchema = {type: 'object'; properties: Readonly<Record<string, {type: 'string'; description: string; enum?: readonly string[]}>>;
  required: readonly string[]; additionalProperties: false};
/** What a tool does when the model calls it: a question for the owner, a read, or a command that needs the owner's approval. */
export type ToolEffect = 'question' | 'read' | 'command';
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
/**
 * What the module knows about the owner that may shape an answer (Hub #507, decision 5 as amended 2026-10-31): the
 * task profile's curated persona and the owner's currently active explicit preferences, read at each model call. It is
 * data, never an instruction that grants a tool or a permission; the engine bounds its rendered size before a call.
 */
export type PromptContext = {
  readonly persona: {readonly name: string; readonly character: string};
  readonly preferences: readonly {readonly title: string; readonly text: string}[];
};
/** The bytes a prompt context occupies when rendered: every title and text, as the engine's bound counts them. */
export const contextBytes = (context: PromptContext): number =>
  textBytes(context.persona.name) + textBytes(context.persona.character) + context.preferences.reduce((sum, entry) => sum + textBytes(entry.title) + textBytes(entry.text), 0);
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
export type TurnReply = {text: string | null; calls: ToolCall[]; stop: TurnStop; units: number | null; blocks?: unknown[]};
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
  constructor(readonly code: ErrorCode, readonly uncertain = false) {super(`provider ${code}`);}
}
export const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;
export const textBytes = (value: string): number => Buffer.byteLength(value, 'utf8');
