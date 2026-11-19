import type {CompanionCard, CompanionCategory, CompanionOpportunity, CompanionSettings, CompanionState, SpokenReply} from '@jimmie-potts/event-contracts/v2/companions';
import type {Mode} from '@jimmie-potts/event-contracts/v2/families';
import {opportunityMatches, type SessionView} from '@jimmie-potts/event-contracts/v2/session-view';
/** The consumer whose notice acknowledgment withdraws a companion card's notice (Hub #1865, design decision 10). */
export const COMPANIONS_CONSUMER = 'companions';
/** Shared module-local guards for fixed-text output and deliberate browser previews. */
export function presentationRefusal(settings: CompanionSettings, category: CompanionCategory, available: boolean): string | undefined {
  if (!settings.enabled) return 'disabled';
  if (settings.muted.includes(category)) return 'category-muted';
  if (!available) return 'presentation-unavailable';
  return undefined;
}

/** Whether an opportunity is inside its own validity window: from its evidence instant until `validUntilMs`. */
export const withinWindow = (event: CompanionOpportunity, nowMs: number): boolean =>
  nowMs >= event.observedAtMs && (event.occurredAtMs === null || nowMs >= event.occurredAtMs) && nowMs < event.validUntilMs;

/**
 * The 30-second question priority (Hub #1865, decision 2). An admitted coding-attention opportunity holds priority
 * while it is inside its own validity window, which the core set from the reporting host's clock, and while it still
 * matches its session, so its attention item is still present. Nothing renews it: later progress raises no opportunity.
 */
export function attentionPriority(priority: readonly CompanionOpportunity[], sessions: readonly SessionView[], nowMs: number): boolean {
  return priority.some(event => event.context === 'live' && event.category === 'coding-attention' && withinWindow(event, nowMs) &&
    sessions.some(view => opportunityMatches(view, event, COMPANIONS_CONSUMER)));
}
/**
 * The browser's admitted coding-attention opportunity: the live question card Reachy presents. A browser part receives
 * no opportunities itself, so it takes the one the module admitted and published.
 */
export function presentedPriority(state: CompanionState | undefined): CompanionOpportunity[] {
  const opportunity = state?.presentation?.opportunity;
  return opportunity !== undefined && opportunity.context === 'live' && opportunity.category === 'coding-attention' ? [opportunity] : [];
}

/**
 * What the current checks read: the synced core copy as session views, and the admitted coding-attention opportunities
 * whose question window may still hold priority.
 */
export type CurrentPolicy = {nowMs: number; settings: CompanionSettings; mode: Mode | undefined; synced: boolean;
  sessions: readonly SessionView[]; priority: readonly CompanionOpportunity[]; scenarioAttention: boolean; available: boolean};
const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

/**
 * Current evidence checks shared by module admission and the browser's final speech check. A live opportunity must
 * still match its session. No session freshness, restart or age term refuses it (Hub #1865).
 */
export function currentRefusal(event: CompanionOpportunity, policy: CurrentPolicy): string | undefined {
  const {nowMs, settings} = policy;
  const presentation = presentationRefusal(settings, event.category, policy.available);
  if (presentation !== undefined) return presentation;
  if (!withinWindow(event, nowMs)) return 'expired';
  if (!policy.synced || policy.mode === undefined) return 'core-unavailable';
  if (event.context === 'live') {
    const session = policy.sessions.find(view => view.id === event.session);
    if (session === undefined) return 'stale-source';
    if (session.generation !== event.generation || session.revision < event.revision || !same(session.identity, event.identity) || !same(session.turn, event.turn)) return 'obsolete-turn';
    if ((event.turn.status === 'unknown' || event.attention?.id.status === 'unknown') && session.revision !== event.revision) return 'source-changed';
    if (event.category === 'coding-attention' && !session.attention.items.some(attention => same(attention, event.attention))) return 'attention-cleared';
    if (!opportunityMatches(session, event, COMPANIONS_CONSUMER)) return 'obsolete-turn';
  }
  const attention = policy.scenarioAttention || attentionPriority(policy.priority, policy.sessions, nowMs);
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
