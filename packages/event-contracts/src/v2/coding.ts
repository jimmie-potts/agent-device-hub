// Coding delegation (Hub #502): the companions module hands one bounded coding task to a host-local worker through the
// core's tracked dispatcher, the worker answers on its one connection-bound endpoint and reports progress as
// occurrences, and the module settles the operation. The worker never gets device or dashboard authority: its
// credential carries the `coding-worker` role, which grants exactly these families on its endpoint.
import type {Message, MessageValidator} from './index.js';
import {defineFamily, registerFamilies, routedSubject} from './registry.js';

/** The source the worker's credential acts as; the gateway binds the role to it. */
export const CODING_WORKER_SOURCE = 'bunny/parts/coding-worker';
/** Slice-one bounds the owner accepted: twenty minutes, sixty turns, five dollars per task. */
export const DEFAULT_CODING_BOUNDS: CodingBounds = Object.freeze({wallClockMs: 1_200_000, maxTurns: 60, budgetUsd: 5});
export type CodingBounds = {wallClockMs: number; maxTurns: number; budgetUsd: number};
/** What the module asks the core to dispatch, and what the core's tracked operation carries to the module. */
export type CodingDispatch = {requestId: string; endpointId: string; taskId: string; repository: string; brief: string; bounds: CodingBounds};
export type CodingRun = CodingDispatch;
export type CodingEndpointControl = {requestId: string; action: 'enable' | 'disable'};
export type CodingWork = {requestId: string; operationId: string} & ({action: 'start'; taskId: string; repository: string; brief: string; bounds: CodingBounds} | {action: 'cancel'});
export type CodingCheck = {name: string; status: 'passed' | 'failed' | 'skipped' | 'unrun' | 'unknown'; detail?: string};
/** The structured handoff: git facts the worker observed itself, the checks and findings the harness reported, and usage or unknown. */
export type CodingResult = {
  outcome: 'tested-candidate' | 'incomplete' | 'failed'; repository: string; base: string | null; head: string | null; changedFiles: string[];
  checks: CodingCheck[]; findings: string[]; limitations: string[]; summary: string; sessionId: string | null;
  usage: {turns: number | null; costUsd: number | null; durationMs: number | null} | null;
};
export type CodingProgressReason = 'refused' | 'repository' | 'worktree' | 'exit' | 'timeout' | 'budget' | 'cancelled' | 'lost' | 'invalid-output';
export type CodingProgress = {operationId: string} & (
  | {status: 'started'}
  | {status: 'completed'; result: CodingResult}
  | {status: 'failed' | 'cancelled' | 'uncertain'; reason: CodingProgressReason; result?: CodingResult | null}
);
export type CodingLost = {id: string};
export type CodingState = {id: 'coding'; revision: number; endpointId: string | null; availability: 'off' | 'available' | 'unavailable';
  active: {operationId: string; taskId: string; status: 'dispatching' | 'started' | 'cancelling' | 'uncertain'} | null};

const assistantSubject = (message: Message): string | undefined => message.subject === 'assistant' ? undefined : 'envelope /subject must be assistant';
function checkWork(message: Message): string | undefined {
  const routed = routedSubject('routing')(message);
  if (routed !== undefined) return routed;
  const data = message.data as CodingWork;
  if (data.action === 'start' && data.brief.trim() === '') return 'payload brief must not be blank';
  return undefined;
}
function checkProgress(message: Message): string | undefined {
  const routed = routedSubject('routing')(message);
  if (routed !== undefined) return routed;
  const data = message.data as CodingProgress;
  if (data.status === 'completed' && data.result.summary.trim() === '') return 'payload summary must not be blank';
  return undefined;
}

export const codingFamilies = [
  defineFamily('coding-endpoint', 'command', 'org.bunny.coding.endpoint.requested', routedSubject('routing')),
  defineFamily('coding-dispatch', 'command', 'org.bunny.coding.dispatch.requested', assistantSubject),
  defineFamily('coding-run', 'command', 'org.bunny.coding.run.requested', assistantSubject),
  defineFamily('coding-work', 'command', 'org.bunny.coding.work.requested', checkWork),
  defineFamily('coding-progress', 'occurrence', 'org.bunny.coding.progress.observed', checkProgress),
  defineFamily('coding-lost', 'occurrence', 'org.bunny.coding.endpoint-lost', message =>
    message.subject === (message.data as CodingLost).id ? undefined : 'envelope /subject must name the lost endpoint'),
  defineFamily('coding-state', 'state', 'org.bunny.coding-state.updated', message => message.subject === 'coding' ? undefined : 'envelope /subject must be coding'),
] as const;
export const codingSchemas: Readonly<Record<string, object>> = Object.fromEntries(codingFamilies.map(family => [family.dataschema, family.schema]));
export function registerCodingFamilies(validator: MessageValidator): void { registerFamilies(validator, codingFamilies); }
