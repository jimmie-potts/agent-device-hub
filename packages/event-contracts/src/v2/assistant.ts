import type {CatalogProposal} from './assistant-actions.js';
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
export const ASSISTANT_LEGACY_TOOL_LIMIT = 32;
export const ASSISTANT_TOOL_LIMIT = 64;
/** Why a conversation's message queue is held (Hub #2030): the owner stopped its task, the runtime started again, or the next message could not start. */
export type AssistantQueueHold = 'stop' | 'restart' | 'refused';
/**
 * One current conversation's message queue in `assistant-state/2.2`: how many messages wait (1 to 8), whether it is
 * held, and the refusal's code. No text. `assistant-state/2.3` (Hub #2031) allows up to 16, which only steers a stopped
 * or closed turn returned to the queue can reach.
 */
export type AssistantQueueSummary = {conversationId: string; profile: AssistantProfile; messages: number; held: AssistantQueueHold | null; code: ErrorCode | null};
export type AssistantState = {id: 'assistant'; revision: number; enabled: boolean; available: boolean;
  /** The configured provider and model, and the tool names the private section allows; never a key, prompt or transcript. */
  provider: AssistantProvider; model: string; tools: string[]; tasks: AssistantTaskSummary[];
  /**
   * Version 2.2 (Hub #2030): each current conversation whose queue holds messages; absent when none does. Version 2.3
   * (Hub #2031) is published while a queue holds more than 8, after a stopped turn returned its unread steers.
   */
  queues?: AssistantQueueSummary[]};
export type AssistantInput = {requestId: string; inputRef: string};
/**
 * `org.bunny.assistant.control.requested`. Version 2.1 (Hub #2025) adds `rename`, the owner's title for a profile's
 * conversation, which carries `profile` and `title` and no task or message; the other actions carry neither. Version 2.2
 * (Hub #2030) adds the message queue's `withdraw` and `reorder`, which name the `profile` and the `queuedId`, with
 * `beforeId` for a reorder (null moves it to the end), and `resume-queue`, which names the `profile`.
 */
export type AssistantControl = {requestId: string; expectedRevision: number; action: 'enable' | 'disable' | 'resume' | 'cancel' | 'speak' | 'rename' | 'withdraw' | 'reorder' | 'resume-queue';
  taskId?: string; messageId?: string; profile?: AssistantProfile; title?: string; queuedId?: string; beforeId?: string | null};
export type ContinueCodingControl = {requestId: string; action: 'continue-coding-job'; jobId: string; operationId: string; harness: 'claude-code' | 'codex'};
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
export type AssistantDispatch = {requestId: string} & (AssistantDeviceAction | (CatalogProposal & {admitByMs?: number}) | {family: 'mode-set'; target: 'hub'; data: {mode: Mode; expectedRevision?: number}});
export const assistantFamilies = [
  defineFamily('assistant-input', 'command', 'org.bunny.assistant.input.requested'),
  defineFamily('assistant-control', 'command', 'org.bunny.assistant.control.requested'),
  defineFamily('assistant-control', 'command', 'org.bunny.assistant.control.requested', undefined, '2.1'),
  defineFamily('assistant-control', 'command', 'org.bunny.assistant.control.requested', undefined, '2.2'),
  defineFamily('assistant-control', 'command', 'org.bunny.assistant.control.requested', undefined, '2.3'),
  defineFamily('assistant-dispatch', 'command', 'org.bunny.assistant.dispatch.requested', message => message.subject === 'assistant' ? undefined : 'envelope /subject must be assistant'),
  defineFamily('assistant-dispatch', 'command', 'org.bunny.assistant.dispatch.requested', message => message.subject === 'assistant' ? undefined : 'envelope /subject must be assistant', '2.1'),
  defineFamily('assistant-dispatch', 'command', 'org.bunny.assistant.dispatch.requested', message => message.subject === 'assistant' ? undefined : 'envelope /subject must be assistant', '2.2'),
  defineFamily('assistant-dispatch', 'command', 'org.bunny.assistant.dispatch.requested', message => message.subject === 'assistant' ? undefined : 'envelope /subject must be assistant', '2.3'),
  defineFamily('assistant-state', 'state', 'org.bunny.assistant-state.updated', message => message.subject === 'assistant' ? undefined : 'envelope /subject must be assistant'),
  defineFamily('assistant-state', 'state', 'org.bunny.assistant-state.updated', message => message.subject === 'assistant' ? undefined : 'envelope /subject must be assistant', '2.1'),
  defineFamily('assistant-state', 'state', 'org.bunny.assistant-state.updated', message => message.subject === 'assistant' ? undefined : 'envelope /subject must be assistant', '2.2'),
  defineFamily('assistant-state', 'state', 'org.bunny.assistant-state.updated', message => message.subject === 'assistant' ? undefined : 'envelope /subject must be assistant', '2.3'),
] as const;
export function registerAssistantFamilies(validator: MessageValidator): void {registerFamilies(validator, assistantFamilies);}
