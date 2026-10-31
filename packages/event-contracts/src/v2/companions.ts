// The minimum Reachy producer/module/dashboard payloads (Hub #1096). Selection and policy stay module-local.
import type {Message, MessageValidator} from './index.js';
import type {Attention, Identity, KnownId} from './families.js';
import {defineFamily, registerFamilies, routedSubject} from './registry.js';

export type PreferenceState = {id: 'preferences'; revision: number};

export type CompanionCategory = 'coding-attention' | 'coding-notice' | 'simulated-social';
export type CompanionOpportunity = {
  origin: {id: string; source: string; type: string}; sourceKind: 'coding' | 'simulated-apartment'; context: 'live' | 'scenario';
  category: CompanionCategory; cue: 'question' | 'input' | 'approval' | 'turn-ended' | 'arrival' | 'visit';
  revision: number; generation: number; session: string | null; identity: Identity | null; turn: KnownId; attention: Attention | null;
  noticeId: string | null; evidence: 'lifecycle-metadata' | 'fixture'; occurredAtMs: number | null; observedAtMs: number; validUntilMs: number;
  busy: boolean | null; media: boolean | null; visitor: null; location: null;
};
export type CompanionSettings = {enabled: boolean; muted: CompanionCategory[]; snoozedUntilMs: number; timeZone: string};
export type CompanionCard = {opportunity: CompanionOpportunity; text: string; phrase: number; presentedAtMs: number; history: boolean; content: 'unavailable'};
export type CompanionState = {id: 'reachy'; revision: number; settings: CompanionSettings; presentation: CompanionCard | null;
  decision: string; availability: 'available' | 'unavailable'};
export type CompanionSettingsSet = {requestId: string; expectedRevision: number; enabled: boolean; muted: CompanionCategory[]; snooze: 'keep' | 'one-hour' | 'clear'};
export type CompanionFixtureRun = {requestId: string; scenario: 'arrival' | 'visit' | 'question-and-arrival'; busy: boolean | null; media: boolean | null};

export type SpeechEndpointControl = {requestId: string} & ({action: 'enable'; available: true} | {action: 'mute' | 'stop'});
export type SpeechDispatch = {requestId: string; candidateId: string; endpointId: string};
/** One saved assistant message the owner asked to hear, or that ended a turn: its text and the deadline after which it is stale (Hub #500). */
export type SpokenReply = {taskId: string; messageId: string; text: string; validUntilMs: number};
export const SPOKEN_REPLY_TTL_MS = 60_000;
export type SpeechOutput = {requestId: string; operationId: string} & ({action: 'speak'; card: CompanionCard} | {action: 'speak'; reply: SpokenReply} | {action: 'stop'});
export type SpeechPlayback = {operationId: string} & (
  | {status: 'started' | 'completed'; started: true}
  | {status: 'stopped' | 'uncertain'; started: boolean}
  | {status: 'failed'; started: false}
  | {status: 'not-started'; started: false; reason: 'disabled' | 'unavailable' | 'busy' | 'expired' | 'policy' | 'stopped' | 'invalid-input'}
);
export type SpeechEndpointLost = {id: string};
export type SpeechState = {id: 'reachy'; revision: number; endpointId: string | null; availability: 'off' | 'available' | 'unavailable';
  playback: SpeechPlayback | {operationId: string; status: 'dispatching'; started: false} | null; pending: boolean};

export const OPPORTUNITY_TTL_MS = 30_000;
export function checkOpportunity(message: Message): string | undefined {
  const value = message.data as CompanionOpportunity;
  const at = Math.min(value.observedAtMs, value.occurredAtMs ?? value.observedAtMs);
  if (value.validUntilMs <= at || value.validUntilMs - at > OPPORTUNITY_TTL_MS)
    return 'payload /validUntilMs must bound the opportunity to thirty seconds';
  if (value.context === 'live' && (value.sourceKind !== 'coding' || value.evidence !== 'lifecycle-metadata' || value.identity === null || value.session === null))
    return 'payload live opportunities require qualified coding metadata';
  if (value.context === 'scenario' && (value.evidence !== 'fixture' || value.identity !== null))
    return 'payload scenarios carry fixture evidence and unknown identity';
  const category = value.cue === 'turn-ended' ? 'coding-notice' : value.cue === 'arrival' || value.cue === 'visit' ? 'simulated-social' : 'coding-attention';
  if (value.category !== category || (category === 'simulated-social') !== (value.sourceKind === 'simulated-apartment'))
    return 'payload category must match the selected cue and source kind';
  if (category === 'coding-attention' && value.attention?.kind !== value.cue) return 'payload attention must match its cue';
  return undefined;
}

function checkSpeechOutput(message: Message): string | undefined {
  const routed = routedSubject('routing')(message);
  if (routed !== undefined) return routed;
  const data = message.data as SpeechOutput;
  if (data.action === 'stop') return undefined;
  if ('reply' in data) {
    const {reply} = data;
    if (reply.text.trim() === '') return 'payload speech text must not be blank';
    if (Date.parse(message.expiresat ?? '') > reply.validUntilMs) return 'payload speech must stay within the reply deadline';
    return undefined;
  }
  const {card} = data;
  const checked = checkOpportunity({...message, data: card.opportunity});
  if (checked !== undefined) return checked;
  if (card.history || card.opportunity.context !== 'live') return 'payload speech requires a newly admitted live card';
  if (card.text.trim() === '') return 'payload speech text must not be blank';
  if (card.presentedAtMs < card.opportunity.observedAtMs || card.presentedAtMs >= card.opportunity.validUntilMs ||
    Date.parse(message.expiresat ?? '') > card.opportunity.validUntilMs) return 'payload speech must stay within the opportunity deadline';
  return undefined;
}

export const companionFamilies = [
  defineFamily('preference-state', 'state', 'org.bunny.preference-state.updated', message => message.subject === 'preferences' ? undefined : 'envelope /subject must be preferences'),
  defineFamily('companion-opportunity', 'occurrence', 'org.bunny.companion-opportunity.raised', checkOpportunity),
  defineFamily('companion-state', 'state', 'org.bunny.companion-state.updated', message => message.subject === 'reachy' ? undefined : 'envelope /subject must be reachy'),
  defineFamily('companion-settings-set', 'command', 'org.bunny.companion-settings.set.requested'),
  defineFamily('companion-fixture-run', 'command', 'org.bunny.companion-fixture.run.requested'),
  defineFamily('companion-speech-endpoint', 'command', 'org.bunny.companion-speech.endpoint.requested', routedSubject('routing')),
  defineFamily('companion-speech-output', 'command', 'org.bunny.companion-speech.output.requested', checkSpeechOutput),
  defineFamily('companion-speech-playback', 'occurrence', 'org.bunny.companion-speech.playback.observed', routedSubject('routing')),
  defineFamily('companion-speech-lost', 'occurrence', 'org.bunny.companion-speech.endpoint-lost', message =>
    message.subject === (message.data as SpeechEndpointLost).id ? undefined : 'envelope /subject must name the lost endpoint'),
  defineFamily('companion-speech-dispatch', 'command', 'org.bunny.companion-speech.dispatch.requested', message => message.subject === 'reachy' ? undefined : 'envelope /subject must be reachy'),
  defineFamily('companion-speech-play', 'command', 'org.bunny.companion-speech.play.requested', message => message.subject === 'reachy' ? undefined : 'envelope /subject must be reachy'),
  defineFamily('companion-speech-state', 'state', 'org.bunny.companion-speech-state.updated', message => message.subject === 'reachy' ? undefined : 'envelope /subject must be reachy'),
] as const;
export const companionSchemas: Readonly<Record<string, object>> = Object.fromEntries(companionFamilies.map(family => [family.dataschema, family.schema]));
export function registerCompanionFamilies(validator: MessageValidator): void { registerFamilies(validator, companionFamilies); }
