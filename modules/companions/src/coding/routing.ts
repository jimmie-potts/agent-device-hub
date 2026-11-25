import type {CodingHarnessReadiness} from '@jimmie-potts/event-contracts/v2/coding';

export type CodingHarness = 'claude-code' | 'codex';
export type CodingChoice = 'auto' | CodingHarness;
export type CodingRoute = {harness?: CodingHarness; reason: string};

export function codingHarness(value: unknown): value is CodingHarness {
  return value === 'claude-code' || value === 'codex';
}

export function codingChoice(value: unknown): value is CodingChoice {
  return value === 'auto' || codingHarness(value);
}

const label = {'claude-code': 'Claude Code', codex: 'Codex'} as const;

function eligibility(harness: CodingHarness, health: CodingHarnessReadiness | undefined, now: number): {eligible: boolean; reason: string} {
  const name = label[harness];
  if (health === undefined) return {eligible: false, reason: `${name} is not advertised.`};
  if (health.installed !== 'yes' || health.signedIn !== 'yes') return {eligible: false, reason: `${name} subscription readiness is unavailable.`};
  const rejected = health.limits?.find(window => window.status === 'rejected' && (window.resetsAtMs === null || window.resetsAtMs > now));
  if (rejected !== undefined) {
    const reset = rejected.resetsAtMs === null ? undefined : new Date(rejected.resetsAtMs);
    const when = reset === undefined || Number.isNaN(reset.getTime()) ? 'reset unknown' : `resets ${reset.toISOString()}`;
    return {eligible: false, reason: `${name} quota exhausted (${when}).`};
  }
  const reported = health.limits?.some(window => window.status === 'allowed' || window.status === 'allowed-warning') === true;
  return {eligible: true, reason: reported ? `${name} reported an available quota window.` : `${name} quota unknown.`};
}

export function chooseCodingHarness(choice: CodingChoice, harnesses: readonly CodingHarnessReadiness[], now: number): CodingRoute {
  const check = (harness: CodingHarness) => eligibility(harness, harnesses.find(item => item.harness === harness), now);
  if (choice !== 'auto') {
    const route = check(choice);
    return route.eligible ? {harness: choice, reason: `${label[choice]} selected explicitly. ${route.reason}`} : {reason: route.reason};
  }
  const preferred = check('claude-code');
  if (preferred.eligible) return {harness: 'claude-code', reason: `Preferred Claude Code selected. ${preferred.reason}`};
  const other = check('codex');
  const reason = `${preferred.reason} ${other.reason}`;
  return other.eligible ? {harness: 'codex', reason} : {reason};
}
