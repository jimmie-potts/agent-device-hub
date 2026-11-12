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
/**
 * The worker's readiness (Hub #1743, `coding-endpoint/2.1` and `coding-state/2.1`): what its harness reported without
 * starting a task, with `unknown` or null wherever the tool did not say. `limits` are the windows the latest run
 * reported, observed at `limitsObservedAtMs`, or null before any run reported one.
 */
export type CodingLimitWindow = {window: string; status: 'allowed' | 'allowed-warning' | 'rejected' | 'unknown'; resetsAtMs: number | null; utilization: number | null};
export type CodingReadiness = {
  tool: 'claude-code'; installed: 'yes' | 'no' | 'unknown'; version: string | null; signedIn: 'yes' | 'no' | 'unknown'; plan: string | null;
  limits: CodingLimitWindow[] | null; limitsObservedAtMs: number | null; checkedAtMs: number;
};
/** Version 2.0 declares availability; 2.1 lets an enable carry the worker's readiness, and an enable from the selected endpoint refreshes it. */
export type CodingEndpointControl = {requestId: string; action: 'enable' | 'disable'; readiness?: CodingReadiness};
export type CodingWork = {requestId: string; operationId: string} & ({action: 'start'; taskId: string; repository: string; brief: string; bounds: CodingBounds} | {action: 'cancel'});
export type CodingCheck = {name: string; status: 'passed' | 'failed' | 'skipped' | 'unrun' | 'unknown'; detail?: string};
/** A usage limit the harness reported: the window it named and when it resets, each null when the tool did not say. */
export type CodingLimit = {window: string | null; resetsAtMs: number | null};
/**
 * The structured handoff: git facts the worker observed itself, the checks and findings the harness reported, and usage or
 * unknown. Version 2.1 adds the `usage-limit` outcome, which carries `limit`, and `waiting-for-owner`, whose question is a finding.
 */
export type CodingResult = {
  outcome: 'tested-candidate' | 'incomplete' | 'failed' | 'usage-limit' | 'waiting-for-owner'; repository: string; base: string | null; head: string | null; changedFiles: string[];
  checks: CodingCheck[]; findings: string[]; limitations: string[]; summary: string; sessionId: string | null;
  usage: {turns: number | null; costUsd: number | null; durationMs: number | null} | null;
  limit?: CodingLimit;
};
export type CodingProgressReason = 'refused' | 'repository' | 'worktree' | 'exit' | 'timeout' | 'budget' | 'cancelled' | 'lost' | 'invalid-output' | 'usage-limit';
export type CodingProgress = {operationId: string} & (
  | {status: 'started'}
  | {status: 'completed'; result: CodingResult}
  | {status: 'failed' | 'cancelled' | 'uncertain'; reason: CodingProgressReason; result?: CodingResult | null}
);
export type CodingLost = {id: string};
/** Version 2.1 adds the selected worker's latest `readiness`, null while none is selected or it reported none. */
export type CodingState = {id: 'coding'; revision: number; endpointId: string | null; availability: 'off' | 'available' | 'unavailable';
  active: {operationId: string; taskId: string; status: 'dispatching' | 'started' | 'cancelling' | 'uncertain'} | null; readiness?: CodingReadiness | null};

const codingSubject = (message: Message): string | undefined => message.subject === 'coding' ? undefined : 'envelope /subject must be coding';
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
  const result = data.status === 'started' ? undefined : data.result ?? undefined;
  if (result !== undefined && (result.outcome === 'usage-limit') !== (result.limit !== undefined)) return 'payload limit goes with the usage-limit outcome only';
  if (data.status === 'completed' && result?.outcome === 'usage-limit') return 'payload a usage-limit result ends failed with reason usage-limit';
  if (data.status !== 'started' && data.status !== 'completed' && data.reason === 'usage-limit' && result?.outcome !== 'usage-limit') return 'payload reason usage-limit needs the usage-limit result';
  return undefined;
}
function checkEndpoint(message: Message): string | undefined {
  const routed = routedSubject('routing')(message);
  if (routed !== undefined) return routed;
  const data = message.data as CodingEndpointControl;
  return data.action === 'disable' && data.readiness !== undefined ? 'payload readiness goes with enable only' : undefined;
}

export const codingFamilies = [
  defineFamily('coding-endpoint', 'command', 'org.bunny.coding.endpoint.requested', routedSubject('routing')),
  defineFamily('coding-endpoint', 'command', 'org.bunny.coding.endpoint.requested', checkEndpoint, '2.1'),
  defineFamily('coding-dispatch', 'command', 'org.bunny.coding.dispatch.requested', assistantSubject),
  defineFamily('coding-run', 'command', 'org.bunny.coding.run.requested', assistantSubject),
  defineFamily('coding-work', 'command', 'org.bunny.coding.work.requested', checkWork),
  defineFamily('coding-progress', 'occurrence', 'org.bunny.coding.progress.observed', checkProgress),
  defineFamily('coding-progress', 'occurrence', 'org.bunny.coding.progress.observed', checkProgress, '2.1'),
  defineFamily('coding-lost', 'occurrence', 'org.bunny.coding.endpoint-lost', message =>
    message.subject === (message.data as CodingLost).id ? undefined : 'envelope /subject must name the lost endpoint'),
  defineFamily('coding-state', 'state', 'org.bunny.coding-state.updated', codingSubject),
  defineFamily('coding-state', 'state', 'org.bunny.coding-state.updated', codingSubject, '2.1'),
] as const;
export const codingSchemas: Readonly<Record<string, object>> = Object.fromEntries(codingFamilies.map(family => [family.dataschema, family.schema]));
export function registerCodingFamilies(validator: MessageValidator): void { registerFamilies(validator, codingFamilies); }
