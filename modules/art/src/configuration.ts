// The module's private section. Each provider has its own monthly ceiling and daily pace, $150 and about $5 by default
// (owner decisions of 2026-11-03). A limit is edited in this section and takes effect at the next start, the one
// configuration path a module has (`ModuleSettings`). Key files are named under `secrets`; a key's absence is not an error.
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import type {ArtProviderName} from '@jimmie-potts/event-contracts/v2/art-state';
import type {Configure} from '@jimmie-potts/sdk';
import type {Limits, ProviderLimits} from './ledger.js';

export const OPENAI_KEY = 'openai-api-key';
/** The same key file companions names. */
export const ANTHROPIC_KEY = 'anthropic-api-key';
export const DEFAULT_CEILING_USD = 150;
export const DEFAULT_PACE_USD = 5;
export const DEFAULT_RECENT = 200;
const MAX_USD = 100_000;
export type ArtConfig = {limits: Limits; recentLimit: number; keys: Readonly<Record<ArtProviderName, boolean>>};

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const only = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).every(key => keys.includes(key));
const dollars = (value: unknown, fallback: number): number | undefined => {
  const amount = value ?? fallback;
  return typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 && amount <= MAX_USD ? Math.round(amount * 1_000_000) : undefined;
};
const invalid = () => errorBody('invalid-request', {detail: 'art takes limits per provider in dollars, a whole recentLimit and its secrets'});
function limitsOf(value: unknown): ProviderLimits | undefined {
  if (value !== undefined && (!object(value) || !only(value, ['monthlyCeilingUsd', 'dailyPaceUsd']))) return undefined;
  const entry = (value ?? {}) as {monthlyCeilingUsd?: unknown; dailyPaceUsd?: unknown};
  const ceilingMicros = dollars(entry.monthlyCeilingUsd, DEFAULT_CEILING_USD), paceMicros = dollars(entry.dailyPaceUsd, DEFAULT_PACE_USD);
  return ceilingMicros === undefined || paceMicros === undefined ? undefined : {ceilingMicros, paceMicros};
}
export const configureArt: Configure<ArtConfig> = section => {
  if (!object(section) || !only(section, ['limits', 'recentLimit', 'secrets'])) return invalid();
  const {limits = {}, recentLimit = DEFAULT_RECENT, secrets = {}} = section;
  if (!object(limits) || !only(limits, ['openai', 'anthropic']) || !object(secrets) || !only(secrets, [OPENAI_KEY, ANTHROPIC_KEY])) return invalid();
  if (typeof recentLimit !== 'number' || !Number.isSafeInteger(recentLimit) || recentLimit < 1 || recentLimit > 100_000) return invalid();
  const openai = limitsOf(limits.openai), anthropic = limitsOf(limits.anthropic);
  if (openai === undefined || anthropic === undefined) return invalid();
  return {config: {limits: {openai, anthropic}, recentLimit, keys: {openai: Object.hasOwn(secrets, OPENAI_KEY), anthropic: Object.hasOwn(secrets, ANTHROPIC_KEY)}}};
};
