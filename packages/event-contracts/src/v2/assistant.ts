import type {ErrorCode, MessageValidator} from './index.js';
import {defineFamily, registerFamilies} from './registry.js';

export type AssistantProfile = 'bunny' | 'reachy' | 'microduck';
export type AssistantStatus = 'running' | 'waiting' | 'paused' | 'succeeded' | 'failed' | 'cancelled' | 'uncertain';
export type AssistantTaskSummary = {taskId: string; conversationId: string; profile: AssistantProfile; status: AssistantStatus;
  runId: string | null; questionId: string | null; hasAnswer: boolean; code: ErrorCode | null;
  modelCalls: number; toolCalls: number; questions: number; activeMs: number; usageUnits: number | null; reservedUnits: number};
export type AssistantState = {id: 'assistant'; revision: number; enabled: boolean; available: boolean; tasks: AssistantTaskSummary[]};
export type AssistantInput = {requestId: string; inputRef: string};
export type AssistantControl = {requestId: string; expectedRevision: number; action: 'enable' | 'disable' | 'resume' | 'cancel'; taskId?: string};
export const assistantFamilies = [
  defineFamily('assistant-input', 'command', 'org.bunny.assistant.input.requested'),
  defineFamily('assistant-control', 'command', 'org.bunny.assistant.control.requested'),
  defineFamily('assistant-state', 'state', 'org.bunny.assistant-state.updated', message => message.subject === 'assistant' ? undefined : 'envelope /subject must be assistant'),
] as const;
export function registerAssistantFamilies(validator: MessageValidator): void {registerFamilies(validator, assistantFamilies);}
