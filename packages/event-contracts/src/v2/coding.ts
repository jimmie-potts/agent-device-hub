// Coding delegation (Hub #502): the companions module hands one bounded coding task to a host-local worker through the
// core's tracked dispatcher, the worker answers on its one connection-bound endpoint and reports progress as
// occurrences, and the module settles the operation. The worker never gets device or dashboard authority: its
// credential carries the `coding-worker` role, which grants exactly these families on its endpoint.
import type {Message, MessageValidator} from './index.js';
import type {AssistantProfile} from './assistant.js';
import {defineFamily, registerFamilies, routedSubject} from './registry.js';

/** The source the worker's credential acts as; the gateway binds the role to it. */
export const CODING_WORKER_SOURCE = 'bunny/parts/coding-worker';
/** Slice-one bounds the owner accepted: twenty minutes, sixty turns, five dollars per task. */
export const DEFAULT_CODING_BOUNDS: CodingBounds = Object.freeze({wallClockMs: 1_200_000, maxTurns: 60, budgetUsd: 5});
export type CodingBounds = {wallClockMs: number; maxTurns: number; budgetUsd: number};
/** What the module asks the core to dispatch, and what the core's tracked operation carries to the module. */
export type CodingDispatch = {requestId: string; endpointId: string; taskId: string; repository: string; brief: string; bounds: CodingBounds; harness?: CodingHarnessId};
export type CodingRun = CodingDispatch & {selectionId?: string};
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
export type CodingHarnessId = string;
export type CodingHarnessCapabilities = {steering: 'unsupported' | 'live'; resume: 'unsupported' | 'saved-session'; review: boolean};
export type CodingHarnessReadiness = Omit<CodingReadiness, 'tool'> & {harness: CodingHarnessId; capabilities: CodingHarnessCapabilities};
/** The companion a run belongs to (Hub #2028): one worker slot each for B.U.N.N.Y., Reachy and MicroDuck. */
export type CodingCompanion = AssistantProfile;
/** How many runs a worker from Hub #2028 declares it can hold at once: one slot per companion. */
export const CODING_WORKER_SLOTS = 3;
/**
 * Version 2.0 declares availability; 2.1 lets an enable carry the worker's readiness, and an enable from the selected
 * endpoint refreshes it; 2.2 (Hub #2028) lets an enable declare how many runs the worker holds at once.
 */
export type CodingEndpointControl = {requestId: string; action: 'enable' | 'disable'; readiness?: CodingReadiness; slots?: number; capacity?: 'uncapped'; harnesses?: CodingHarnessReadiness[]};
/** Version 2.1 (Hub #2028) tags a start with the companion that asked; a 2.0 start has no companion. */
export type CodingWork = {requestId: string; operationId: string} & ({action: 'start'; taskId: string; companion?: CodingCompanion; repository: string; brief: string; bounds: CodingBounds; harness?: CodingHarnessId} | {action: 'cancel'} | {action: 'message'; text: string});
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
export type CodingSetup = 'waiting' | 'running' | 'ready';
export const CODING_SETUP_HEARTBEAT_MS = 10_000;
export const CODING_SETUP_WAIT_MS = 45_000;
export const CODING_SETUP_WORK_MS = 270_000;
export type CodingProgressReason = 'spawn' | 'refused' | 'repository' | 'worktree' | 'exit' | 'timeout' | 'budget' | 'cancelled' | 'lost' | 'invalid-output' | 'usage-limit';
export type CodingProgress = {operationId: string; harness?: CodingHarnessId; sessionId?: string} & (
  | {status: 'started'; setup?: CodingSetup}
  | {status: 'completed'; result: CodingResult}
  | {status: 'failed' | 'cancelled' | 'uncertain'; reason: CodingProgressReason; result?: CodingResult | null}
);
export type CodingMessageObserved = {operationId: string; sessionId: string; messageId: string; status: 'message-observed'};
export type CodingAttemptContext = {operationId: string; status: 'attempt-context'; worktreeRef?: string; branch?: string | null; model?: string};
export type CodingWorkerProgress = CodingProgress | CodingMessageObserved | CodingAttemptContext;
export type CodingLost = {id: string};
/** One run the worker holds for a companion's slot, from dispatch to its end. */
export type CodingRunEntry = {operationId: string; taskId: string; companion: CodingCompanion; status: 'dispatching' | 'started' | 'cancelling'; setup?: CodingSetup; harness?: CodingHarnessId; sessionId?: string};
/** One approved hand-off waiting for its companion's slot, never sent yet. */
export type CodingWaiting = {operationId: string; taskId: string; companion: CodingCompanion};
/**
 * Version 2.1 adds the selected worker's latest `readiness`, null while none is selected or it reported none. Version
 * 2.2 (Hub #2028) adds the selected worker's declared `slots` (null for a worker that declares none, which holds one
 * run), every active run in `runs` and the approved hand-offs waiting for a slot in `waiting`, oldest first; `active`
 * stays the oldest run for older readers.
 */
export type CodingState = {id: 'coding'; revision: number; endpointId: string | null; availability: 'off' | 'available' | 'unavailable';
  active: {operationId: string; taskId: string; status: 'dispatching' | 'started' | 'cancelling' | 'uncertain'} | null; readiness?: CodingReadiness | null;
  slots?: number | null; capacity?: 'uncapped' | null; selectionId?: string; harnesses?: CodingHarnessReadiness[] | null; counts?: {runs: number; waiting: number}; runs?: CodingRunEntry[]; waiting?: CodingWaiting[]};

const codingSubject = (message: Message): string | undefined => message.subject === 'coding' ? undefined : 'envelope /subject must be coding';
const assistantSubject = (message: Message): string | undefined => message.subject === 'assistant' ? undefined : 'envelope /subject must be assistant';
function checkWork(message: Message): string | undefined {
  const routed = routedSubject('routing')(message);
  if (routed !== undefined) return routed;
  const data = message.data as CodingWork;
  if (data.action === 'message' && (data.text.trim() === '' || new TextEncoder().encode(data.text).byteLength > 4096)) return 'payload text must be nonblank and at most 4096 bytes';
  if (data.action === 'start' && data.brief.trim() === '') return 'payload brief must not be blank';
  return undefined;
}
function checkProgress(message: Message): string | undefined {
  const routed = routedSubject('routing')(message);
  if (routed !== undefined) return routed;
  const data = message.data as CodingWorkerProgress;
  if (data.status === 'message-observed' || data.status === 'attempt-context') return undefined;
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
  if (data.action === 'disable' && data.readiness !== undefined) return 'payload readiness goes with enable only';
  if (data.action === 'disable' && data.slots !== undefined) return 'payload slots go with enable only';
  if (data.action === 'disable' && data.harnesses !== undefined) return 'payload harnesses go with enable only';
  return checkHarnesses(data.harnesses);
}

function checkHarnesses(harnesses: CodingHarnessReadiness[] | null | undefined): string | undefined {
  if (harnesses == null) return undefined;
  return new Set(harnesses.map(entry => entry.harness)).size === harnesses.length ? undefined : 'payload harness identities must be unique';
}

/** A 2.2 state lists each operation once, at most one run per companion, and `active` as the oldest run. */
function checkState(message: Message): string | undefined {
  const subject = codingSubject(message);
  if (subject !== undefined) return subject;
  const data = message.data as Required<CodingState>;
  const harnessIssue = checkHarnesses(data.harnesses);
  if (harnessIssue !== undefined) return harnessIssue;
  const operations = [...data.runs, ...data.waiting].map(entry => entry.operationId);
  if (new Set(operations).size !== operations.length) return 'payload an operation is listed once';
  if (data.counts === undefined && new Set(data.runs.map(run => run.companion)).size !== data.runs.length) return 'payload a companion has at most one run';
  if (data.counts !== undefined && (data.runs.length !== Math.min(data.counts.runs, 8) ||
    data.waiting.length !== Math.min(data.counts.waiting, 32) || (data.capacity === 'uncapped' && data.slots !== null))) return 'payload summary disagrees with admission or counts';
  if (data.runs.length > 0 && data.active?.operationId !== data.runs[0]?.operationId) return 'payload active is the oldest run';
  return undefined;
}

export const codingFamilies = [
  defineFamily('coding-endpoint', 'command', 'org.bunny.coding.endpoint.requested', routedSubject('routing')),
  defineFamily('coding-endpoint', 'command', 'org.bunny.coding.endpoint.requested', checkEndpoint, '2.1'),
  defineFamily('coding-endpoint', 'command', 'org.bunny.coding.endpoint.requested', checkEndpoint, '2.2'),
  defineFamily('coding-endpoint', 'command', 'org.bunny.coding.endpoint.requested', checkEndpoint, '2.3'),
  defineFamily('coding-endpoint', 'command', 'org.bunny.coding.endpoint.requested', checkEndpoint, '2.4'),
  defineFamily('coding-dispatch', 'command', 'org.bunny.coding.dispatch.requested', assistantSubject),
  defineFamily('coding-dispatch', 'command', 'org.bunny.coding.dispatch.requested', assistantSubject, '2.1'),
  defineFamily('coding-run', 'command', 'org.bunny.coding.run.requested', assistantSubject),
  defineFamily('coding-run', 'command', 'org.bunny.coding.run.requested', assistantSubject, '2.1'),
  defineFamily('coding-work', 'command', 'org.bunny.coding.work.requested', checkWork),
  defineFamily('coding-work', 'command', 'org.bunny.coding.work.requested', checkWork, '2.1'),
  defineFamily('coding-work', 'command', 'org.bunny.coding.work.requested', checkWork, '2.2'),
  defineFamily('coding-work', 'command', 'org.bunny.coding.work.requested', checkWork, '2.4'),
  defineFamily('coding-progress', 'occurrence', 'org.bunny.coding.progress.observed', checkProgress),
  defineFamily('coding-progress', 'occurrence', 'org.bunny.coding.progress.observed', checkProgress, '2.1'),
  defineFamily('coding-progress', 'occurrence', 'org.bunny.coding.progress.observed', checkProgress, '2.2'),
  defineFamily('coding-progress', 'occurrence', 'org.bunny.coding.progress.observed', checkProgress, '2.3'),
  defineFamily('coding-progress', 'occurrence', 'org.bunny.coding.progress.observed', checkProgress, '2.5'),
  defineFamily('coding-lost', 'occurrence', 'org.bunny.coding.endpoint-lost', message =>
    message.subject === (message.data as CodingLost).id ? undefined : 'envelope /subject must name the lost endpoint'),
  defineFamily('coding-state', 'state', 'org.bunny.coding-state.updated', codingSubject),
  defineFamily('coding-state', 'state', 'org.bunny.coding-state.updated', codingSubject, '2.1'),
  defineFamily('coding-state', 'state', 'org.bunny.coding-state.updated', checkState, '2.2'),
  defineFamily('coding-state', 'state', 'org.bunny.coding-state.updated', checkState, '2.3'),
  defineFamily('coding-state', 'state', 'org.bunny.coding-state.updated', checkState, '2.4'),
  defineFamily('coding-run', 'command', 'org.bunny.coding.run.requested', assistantSubject, '2.2'),
] as const;
export const codingSchemas: Readonly<Record<string, object>> = Object.fromEntries(codingFamilies.map(family => [family.dataschema, family.schema]));
export function registerCodingFamilies(validator: MessageValidator): void { registerFamilies(validator, codingFamilies); }
