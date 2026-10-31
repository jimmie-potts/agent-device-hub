import type {ErrorCode, MessageValidator} from './index.js';
import type {Mode} from './families.js';
import {defineFamily, registerFamilies} from './registry.js';

export type AssistantProfile = 'bunny' | 'reachy' | 'microduck';
export type AssistantStatus = 'running' | 'waiting' | 'paused' | 'succeeded' | 'failed' | 'cancelled' | 'uncertain';
/** Which provider answers the `bunny` profile's turns: the labelled synthetic one, or a configured hosted one (Hub #46). */
export type AssistantProvider = 'synthetic' | 'anthropic';
export type AssistantTaskSummary = {taskId: string; conversationId: string; profile: AssistantProfile; status: AssistantStatus;
  runId: string | null; questionId: string | null; hasAnswer: boolean; code: ErrorCode | null;
  modelCalls: number; toolCalls: number; questions: number; activeMs: number; usageUnits: number | null; reservedUnits: number};
export type AssistantState = {id: 'assistant'; revision: number; enabled: boolean; available: boolean;
  /** The configured provider and model, and the tool names the private section allows; never a key, prompt or transcript. */
  provider: AssistantProvider; model: string; tools: string[]; tasks: AssistantTaskSummary[]};
export type AssistantInput = {requestId: string; inputRef: string};
export type AssistantControl = {requestId: string; expectedRevision: number; action: 'enable' | 'disable' | 'resume' | 'cancel'; taskId?: string};
/**
 * `org.bunny.assistant.dispatch.requested`: the companions module asks the core to send one approved, allowlisted command
 * through its tracked dispatcher (Hub #46). The first slice allows `mode-set` for the Hub; the core refuses anything else.
 */
export type AssistantDispatch = {requestId: string; family: 'mode-set'; target: 'hub'; data: {mode: Mode; expectedRevision?: number}};
export const assistantFamilies = [
  defineFamily('assistant-input', 'command', 'org.bunny.assistant.input.requested'),
  defineFamily('assistant-control', 'command', 'org.bunny.assistant.control.requested'),
  defineFamily('assistant-dispatch', 'command', 'org.bunny.assistant.dispatch.requested', message => message.subject === 'assistant' ? undefined : 'envelope /subject must be assistant'),
  defineFamily('assistant-state', 'state', 'org.bunny.assistant-state.updated', message => message.subject === 'assistant' ? undefined : 'envelope /subject must be assistant'),
] as const;
export function registerAssistantFamilies(validator: MessageValidator): void {registerFamilies(validator, assistantFamilies);}
