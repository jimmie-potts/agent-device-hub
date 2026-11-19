import type {ErrorCode, MessageValidator} from './index.js';
import type {CommandGuards} from './devices.js';
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
export type AssistantControl = {requestId: string; expectedRevision: number; action: 'enable' | 'disable' | 'resume' | 'cancel' | 'speak'; taskId?: string; messageId?: string};
/**
 * `org.bunny.assistant.dispatch.requested`: the companions module asks the core to send one approved, allowlisted command
 * through its tracked dispatcher. Version 2.0 carries Hub mode. Version 2.1 carries guarded LIFX commands. Version 2.2 binds Wemo power to its owner.
 */
type LightGuards = Required<Pick<CommandGuards, 'expectedConfigurationRevision' | 'expectedGeneration'>>;
export const ASSISTANT_LIGHT_OWNER = 'bunny/modules/lifx';
export type AssistantLightAction = {family: 'power-set'; target: string; data: LightGuards & {on: boolean}}
  | {family: 'brightness-set'; target: string; data: LightGuards & {percent: number}};
export const ASSISTANT_WEMO_OWNER = 'bunny/modules/wemo';
export type AssistantDeviceOwner = typeof ASSISTANT_LIGHT_OWNER | typeof ASSISTANT_WEMO_OWNER;
export type AssistantWemoAction = {family: 'power-set'; target: string; owner: typeof ASSISTANT_WEMO_OWNER; data: LightGuards & {on: boolean}};
export type AssistantDeviceAction = AssistantLightAction | AssistantWemoAction;
export type AssistantDispatch = {requestId: string} & (AssistantDeviceAction | {family: 'mode-set'; target: 'hub'; data: {mode: Mode; expectedRevision?: number}});
export const assistantFamilies = [
  defineFamily('assistant-input', 'command', 'org.bunny.assistant.input.requested'),
  defineFamily('assistant-control', 'command', 'org.bunny.assistant.control.requested'),
  defineFamily('assistant-dispatch', 'command', 'org.bunny.assistant.dispatch.requested', message => message.subject === 'assistant' ? undefined : 'envelope /subject must be assistant'),
  defineFamily('assistant-dispatch', 'command', 'org.bunny.assistant.dispatch.requested', message => message.subject === 'assistant' ? undefined : 'envelope /subject must be assistant', '2.1'),
  defineFamily('assistant-dispatch', 'command', 'org.bunny.assistant.dispatch.requested', message => message.subject === 'assistant' ? undefined : 'envelope /subject must be assistant', '2.2'),
  defineFamily('assistant-state', 'state', 'org.bunny.assistant-state.updated', message => message.subject === 'assistant' ? undefined : 'envelope /subject must be assistant'),
] as const;
export function registerAssistantFamilies(validator: MessageValidator): void {registerFamilies(validator, assistantFamilies);}
