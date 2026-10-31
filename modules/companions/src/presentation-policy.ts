import type {CompanionCard, CompanionCategory, CompanionOpportunity, CompanionSettings, SpokenReply} from '@jimmie-potts/event-contracts/v2/companions';
import type {Mode, SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
/** Shared module-local guards for fixed-text output and deliberate browser previews. */
export function presentationRefusal(settings: CompanionSettings, category: CompanionCategory, available: boolean): string | undefined {
  if (!settings.enabled) return 'disabled';
  if (settings.muted.includes(category)) return 'category-muted';
  if (!available) return 'presentation-unavailable';
  return undefined;
}
export function staleSession(session: SessionRecord | undefined, nowMs: number): boolean {
  return session === undefined || session.freshness !== 'current' || session.restartUncertain || nowMs - session.lastEvidenceAtMs >= 300_000;
}

export type CurrentPolicy = {nowMs: number; settings: CompanionSettings; mode: Mode | undefined; synced: boolean;
  sessions: readonly SessionRecord[]; scenarioAttention: boolean; available: boolean};
const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

/** Current evidence checks shared by module admission and the browser's final speech check. */
export function currentRefusal(event: CompanionOpportunity, policy: CurrentPolicy): string | undefined {
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
  }
  return undefined;
}

/** What one utterance says: a newly admitted live Reachy card, or a saved assistant reply the owner typed for or asked to hear again (Hub #500). */
export type SpeechSource = {kind: 'card'; card: CompanionCard} | {kind: 'reply'; reply: SpokenReply};
export const speechDeadline = (source: SpeechSource): number => source.kind === 'reply' ? source.reply.validUntilMs : source.card.opportunity.validUntilMs;
export const speechText = (source: SpeechSource): string => source.kind === 'reply' ? source.reply.text : source.card.text;

/** A spoken reply answers the owner's own request: it honors Quiet and needs the synced Hub mode; Reachy's text enablement and category mutes do not govern it. */
export function replyRefusal(policy: Pick<CurrentPolicy, 'mode' | 'synced'>): string | undefined {
  if (!policy.synced || policy.mode === undefined) return 'core-unavailable';
  if (policy.mode === 'quiet') return 'restrictive-mode';
  return undefined;
}

/** Speech adds explicit live-card and Quiet restrictions without changing visual attention policy. */
export function speechRefusal(card: CompanionCard, policy: CurrentPolicy): string | undefined {
  if (card.history || card.opportunity.context !== 'live') return 'invalid-input';
  if (policy.mode === 'quiet') return 'restrictive-mode';
  return currentRefusal(card.opportunity, policy);
}
