import {presentationRefusal, staleSession} from './presentation-policy.js';
import {createHash} from 'node:crypto';
import type {CompanionCard, CompanionOpportunity, CompanionSettings} from '@jimmie-potts/event-contracts/v2/companions';
import type {Mode, SessionRecord} from '@jimmie-potts/event-contracts/v2/families';

export type Allowance = {day: string; count: number; lastAtMs: number | null};
export type Admission = {key: string; atMs: number};
export type Policy = {nowMs: number; settings: CompanionSettings; mode: Mode | undefined; synced: boolean;
  sessions: readonly SessionRecord[]; scenarioAttention: boolean; allowance: Allowance; admissions: readonly Admission[]; available: boolean};
export const categories = ['coding-attention', 'coding-notice', 'simulated-social'] as const;
export const defaultSettings = (): CompanionSettings => ({enabled: false, muted: [], snoozedUntilMs: 0,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone});
export const localDay = (atMs: number, zone: string): string => new Intl.DateTimeFormat('en-CA', {
  timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(atMs));
export const admissionKey = (event: CompanionOpportunity): string => createHash('sha256')
  .update(JSON.stringify([event.context, event.origin.source, event.context === 'scenario' ? event.origin.id : null, event.session, event.generation, event.turn, event.attention, event.noticeId, event.cue])).digest('hex');
const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
/** Reused for admission and immediately before presentation; it neither saves state nor emits effects. */
export function refusal(event: CompanionOpportunity, policy: Policy, reserved = false): string | undefined {
  const {nowMs, settings} = policy;
  const presentation = presentationRefusal(settings, event.category, policy.available);
  if (presentation !== undefined) return presentation;
  if (nowMs < event.observedAtMs || (event.occurredAtMs !== null && nowMs < event.occurredAtMs) || nowMs >= event.validUntilMs) return 'expired';
  if (!policy.synced || policy.mode === undefined) return 'core-unavailable';
  if (event.context === 'live') {
    const session = policy.sessions.find(record => record.id === event.session);
    if (session === undefined || staleSession(session, nowMs)) return 'stale-source';
    if (session.generation !== event.generation || session.revision < event.revision || !same(session.identity, event.identity) || !same(session.turn, event.turn)) return 'obsolete-turn';
    if ((event.turn.status === 'unknown' || event.attention?.id.status === 'unknown') && session.revision !== event.revision) return 'source-changed';
    if (event.category === 'coding-attention' && !session.attention.some(attention => same(attention, event.attention))) return 'attention-cleared';
    if (event.category === 'coding-notice' && (event.noticeId === null || !session.notices.some(notice => notice.id === event.noticeId))) return 'obsolete-turn';
  }
  const attention = policy.scenarioAttention || policy.sessions.some(session => session.freshness === 'current' && session.attention.length > 0);
  if (event.category !== 'coding-attention' && attention) return 'attention-priority';
  if (event.category === 'simulated-social') {
    if (policy.mode !== 'free') return 'restrictive-mode';
    if (event.busy === null || event.media === null) return 'unknown-context';
    if (event.busy) return 'busy';
    if (event.media) return 'media';
    if (nowMs < settings.snoozedUntilMs) return 'snoozed';
    if (!reserved) {
      if (policy.allowance.day === localDay(nowMs, settings.timeZone) && policy.allowance.count >= 3) return 'social-budget';
      if (policy.allowance.lastAtMs !== null && nowMs - policy.allowance.lastAtMs < 10_800_000) return 'social-spacing';
    }
  }
  if (!reserved && policy.admissions.some(record => record.key === admissionKey(event))) return 'repetition';
  return undefined;
}
const PHRASES: Readonly<Record<CompanionOpportunity['cue'], readonly string[]>> = {
  question: ['May I borrow your attention? This coding session has a question for you.', 'A question is waiting in this coding session. Your judgment is requested.'],
  input: ['This coding session is waiting for your input. I am keeping the request within reach.', 'Your input is requested in this coding session. Please check its attention item.'],
  approval: ['This coding session requests your approval decision. Please review the request yourself.', 'An approval request is waiting for you in this coding session. The decision is yours.'],
  'turn-ended': ['This coding turn ended. Its response content is unavailable to me.', 'The coding turn has ended. I have no response content or result to report.'],
  arrival: ['A simulated arrival gives us a moment to say hello. Welcome, whoever you may be.', 'Hello from the desk. This is a simulated arrival; identity and location are unknown.'],
  visit: ['A simulated visit is here. A small hello seems appropriate; identity and location remain unknown.', 'A diplomatic hello for this simulated visit. I do not know who or where.'],
};
/** Stable seeded variation over admitted fixed phrases, with no model or response content. */
export function selectCard(event: CompanionOpportunity, nowMs: number, seed: string): CompanionCard {
  const choices = PHRASES[event.cue];
  const phrase = createHash('sha256').update(`${seed}:${event.origin.id}`).digest().readUInt32BE(0) % choices.length;
  const text = choices[phrase];
  if (text === undefined) throw new Error('companion-phrase-missing');
  return {opportunity: event, text, phrase, presentedAtMs: nowMs, history: false, content: 'unavailable'};
}
