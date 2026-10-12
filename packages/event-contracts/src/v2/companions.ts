// The minimum Reachy producer/module/dashboard payloads (Hub #1096). Selection and policy stay module-local.
import type {Message, MessageValidator} from './index.js';
import type {Attention, Identity, KnownId} from './families.js';
import {defineFamily, registerFamilies} from './registry.js';

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
export const companionFamilies = [
  defineFamily('companion-opportunity', 'occurrence', 'org.bunny.companion-opportunity.raised', checkOpportunity),
  defineFamily('companion-state', 'state', 'org.bunny.companion-state.updated', message => message.subject === 'reachy' ? undefined : 'envelope /subject must be reachy'),
  defineFamily('companion-settings-set', 'command', 'org.bunny.companion-settings.set.requested'),
  defineFamily('companion-fixture-run', 'command', 'org.bunny.companion-fixture.run.requested'),
] as const;
export const companionSchemas: Readonly<Record<string, object>> = Object.fromEntries(companionFamilies.map(family => [family.dataschema, family.schema]));
export function registerCompanionFamilies(validator: MessageValidator): void { registerFamilies(validator, companionFamilies); }
