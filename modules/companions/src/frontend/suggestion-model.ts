import {presentationRefusal, staleSession} from '../presentation-policy.js';
import type {CompanionSettings} from '@jimmie-potts/event-contracts/v2/companions';
import type {Mode, SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
export const checkNames = ['tests', 'build', 'browser', 'accessibility'] as const;
export type CheckName = typeof checkNames[number];
export type CheckStatus = 'passed' | 'failed' | 'skipped' | 'unrun' | 'unknown';
export type CheckResult = {status: CheckStatus; reference: string};
export type TaskEvidence = {task: string; repository: string; base: string; head: string; evidenceHead: string; observedAtMs: number;
  session: SessionRecord; checks: Record<CheckName, CheckResult>};
export type SuggestionContext = {nowMs: number; connected: boolean; available: boolean; settings: CompanionSettings; mode: Mode | undefined; sessions: readonly SessionRecord[]};
export type Suggestion = {kind: 'proposal'; text: string; target: CheckName; validUntilMs: number} | {kind: 'gap'; reason: string};
export const EVIDENCE_TTL_MS = 300_000;
/** Require an unambiguous UTC millisecond instant from the deliberate form. */
export function observationTime(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return Number.NaN;
  const at = Date.parse(value);
  return Number.isFinite(at) && new Date(at).toISOString() === value ? at : Number.NaN;
}
const statuses: readonly string[] = ['passed', 'failed', 'skipped', 'unrun', 'unknown'];
const sha = (value: string): boolean => /^[a-f0-9]{40}$/.test(value);
const bounded = (value: string, max: number): boolean => typeof value === 'string' && value.length <= max && Array.from(value).every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127);
/** Pure, deliberate inspection. No submission, provider or clipboard effect. */
export function propose(input: TaskEvidence, context: SuggestionContext): Suggestion {
  const gap = (reason: string): Suggestion => ({kind: 'gap', reason});
  const refused = presentationRefusal(context.settings, 'coding-notice', context.available);
  if (refused !== undefined) return gap(refused);
  if (!context.connected || context.mode === undefined) return gap('core-unavailable');
  if (!bounded(input.task, 200) || input.task.trim() === '' || !bounded(input.repository, 500)) return gap('task-identity-required');
  if (!sha(input.head) || !sha(input.evidenceHead) || input.head !== input.evidenceHead || (input.base !== '' && !sha(input.base))) return gap('matching-head-required');
  if (!Number.isSafeInteger(input.observedAtMs) || input.observedAtMs < 0 || input.observedAtMs > context.nowMs || context.nowMs >= input.observedAtMs + EVIDENCE_TTL_MS) return gap('expired-evidence');
  const current = context.sessions.find(session => session.id === input.session.id);
  if (current === undefined || staleSession(current, context.nowMs) || current.lastEvidenceAtMs > context.nowMs) return gap('stale-session');
  if (current.revision !== input.session.revision || current.generation !== input.session.generation ||
      JSON.stringify(current.identity) !== JSON.stringify(input.session.identity) || JSON.stringify(current.turn) !== JSON.stringify(input.session.turn)) return gap('session-changed');
  if (context.sessions.some(session => session.freshness === 'current' && session.attention.length > 0)) return gap('attention-priority');
  if (Object.keys(input.checks).length !== checkNames.length || checkNames.some(name => {
    const check = input.checks[name];
    return check === undefined || !statuses.includes(check.status) || !bounded(check.reference, 500) ||
      (['passed', 'failed', 'skipped'].includes(check.status) && check.reference.trim() === '');
  })) return gap('unsupported-check-claim');
  const failed = checkNames.find(name => input.checks[name].status === 'failed');
  const unrun = (['build', 'browser', 'accessibility'] as const).find(name => input.checks[name].status === 'unrun');
  const target = failed ?? (input.checks.tests.status === 'passed' ? unrun : undefined);
  if (target === undefined) return gap('no-supported-next-check');
  const action = failed === undefined ? `Please run the unrun ${target} check and report its result and evidence reference.` :
    `Please investigate the failed ${target} check using its evidence reference, then report the cause and a proposed next step.`;
  const validUntilMs = Math.min(input.observedAtMs + EVIDENCE_TTL_MS, current.lastEvidenceAtMs + EVIDENCE_TTL_MS);
  const text = [`Owner-supplied evidence; results and repository revisions are not independently verified.`,
    `Target task: ${input.task}; session: ${current.identity.provider}/${current.identity.sessionId}; turn: ${current.turn.status === 'known' ? current.turn.id : 'unknown'}.`,
    `Source host: ${current.identity.hostId}; source: ${current.identity.sourceId}; session entity: ${current.id}; source revision/generation: ${current.revision}/${current.generation}.`,
    `Repository: ${input.repository === '' ? 'unknown' : input.repository}; base: ${input.base === '' ? 'unknown' : input.base}; current/evidence head: ${input.head}.`,
    `Observed: ${new Date(input.observedAtMs).toISOString()}; valid until: ${new Date(validUntilMs).toISOString()}.`,
    ...checkNames.map(name => `${name}: ${input.checks[name].status}; reference: ${input.checks[name].reference === '' ? 'unknown' : input.checks[name].reference}`), action,
    'Inspect before using. This suggestion submits nothing and grants no execution or approval authority.'].join('\n');
  return {kind: 'proposal', target, text, validUntilMs};
}
/** One page's last inspected evidence; changed equal-time claims are ambiguous. */
export function replacementRefusal(input: TaskEvidence, prior: TaskEvidence | undefined): string | undefined {
  if (prior === undefined || input.task !== prior.task || input.session.id !== prior.session.id || input.repository !== prior.repository) return undefined;
  if (input.observedAtMs < prior.observedAtMs) return 'older-evidence';
  if (input.observedAtMs === prior.observedAtMs && JSON.stringify(input) !== JSON.stringify(prior)) return 'ambiguous-replacement';
  return undefined;
}
/** Even a newer evidence gap supersedes an earlier useful proposal. */
export function inspectEvidence(input: TaskEvidence, context: SuggestionContext, prior: TaskEvidence | undefined): {decision: Suggestion; latest: TaskEvidence | undefined} {
  const conflict = replacementRefusal(input, prior);
  if (conflict !== undefined) return {decision: {kind: 'gap', reason: conflict}, latest: prior};
  const currentTime = Number.isSafeInteger(input.observedAtMs) && input.observedAtMs <= context.nowMs && context.nowMs < input.observedAtMs + EVIDENCE_TTL_MS;
  return {decision: propose(input, context), latest: currentTime && input.task.trim() !== '' ? structuredClone(input) : prior};
}
