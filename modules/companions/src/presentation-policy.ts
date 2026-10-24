import type {CompanionCategory, CompanionSettings} from '@jimmie-potts/event-contracts/v2/companions';
import type {SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
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
