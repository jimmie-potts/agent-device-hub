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

/** Connection freshness applies to workers that publish resource declarations periodically. */
export const CODING_DECLARATION_TTL_MS = 120_000;
type Destination = import('@jimmie-potts/event-contracts/v2/coding').CodingDestination;
type Declaration = import('@jimmie-potts/event-contracts/v2/coding').CodingWorkerDeclaration;
export type CodingDestinationChoice = 'auto' | 'cloud' | Destination;
export function codingDestinationChoice(value: unknown): value is CodingDestinationChoice {
  return value === 'auto' || value === 'mac' || value === 'pc' || value === 'cloud' ||
    typeof value === 'string' && /^cloud-(?=[a-z0-9-]{1,32}$)[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value);
}
export type CodingResource = {kind: 'device-route' | 'device-proximity' | 'installation'; id: string};
export type CodingRequirements = {refusal?: 'unknown-resource' | 'ambiguous-resource' | 'conflicting-platform'; revision?: string; os?: Declaration['os']; toolchains?: string[]; testSlots?: 1 | 2; resource?: CodingResource};
export type CodingCandidate = {destination: Destination; endpointId: string; selectionId?: string; receivedAt: number; running: number;
  declaration?: Declaration; harnesses?: readonly CodingHarnessReadiness[]; legacyDefault?: boolean};
type Request = {destination: CodingDestinationChoice; choice: CodingChoice; repository: string; requirements?: CodingRequirements; now: number;
  allowed: (destination: Destination) => boolean; resourceAllowed?: (resource: CodingResource, destination: Destination) => boolean};
type Selection = {forbidden?: true; worker?: CodingCandidate; harness?: CodingHarness; revision?: string; reason: string};
type Eligible = Selection & {worker: CodingCandidate; score: number[]};
const pressureRank = {normal: 0, elevated: 1, unknown: 2, high: 3} as const;
const factors = ['resource pressure', 'active job count', 'available test slots', 'observed harness quota'];

/** Evaluate the source-bound declaration. Authorization comes from the Hub, separately from the worker's report. */
function evaluateWorker(worker: CodingCandidate, request: Request): Eligible | string {
  const {destination, declaration} = worker;
  const requirements = request.requirements ?? {};
  if (!request.allowed(destination)) return 'sharing permission is unavailable';
  if (requirements.resource !== undefined && request.resourceAllowed?.(requirements.resource, destination) !== true) return 'required resource authority is unavailable';
  const revision = declaration?.repositories.find(repository => repository.name === request.repository)?.revision;
  if (declaration === undefined) {
    if (destination !== 'mac' || Object.keys(requirements).length > 0) return 'the required worker capabilities are unknown';
  } else {
    if (worker.receivedAt > request.now || request.now - worker.receivedAt > CODING_DECLARATION_TTL_MS) return 'worker declaration is stale';
    if (revision === undefined || (requirements.revision !== undefined && requirements.revision !== revision)) return 'the approved repository or revision is unavailable';
    if (requirements.os !== undefined && requirements.os !== declaration.os) return 'the required operating system is unavailable';
    if (requirements.toolchains?.some(tool => !declaration.toolchains.includes(tool)) === true) return 'a required toolchain is unavailable';
    // #1681 measured five standard test slots on the Mac and eight on the PC. This limit applies only to test resources.
    const profileSlots = destination === 'mac' ? 5 : destination === 'pc' ? 8 : Number.MAX_SAFE_INTEGER;
    if (requirements.testSlots !== undefined && Math.min(profileSlots, declaration.testSlots ?? 0) < requirements.testSlots) return 'the required test slots are unavailable';
  }
  const harnesses = worker.harnesses?.filter(health => declaration === undefined ||
    (health.checkedAtMs <= request.now + 5000 && request.now - health.checkedAtMs <= CODING_DECLARATION_TTL_MS));
  const legacy = declaration === undefined && worker.legacyDefault === true && request.choice === 'auto';
  const route = legacy ? {harness: undefined, reason: 'The default Claude Code worker was selected.'} :
    chooseCodingHarness(request.choice, harnesses ?? [], request.now);
  if (!legacy && route.harness === undefined) {
    if (declaration !== undefined && worker.harnesses?.some(item => request.choice === 'auto' || request.choice === item.harness) === true &&
      !harnesses?.some(item => request.choice === 'auto' || request.choice === item.harness)) return 'the requested harness readiness is stale';
    return route.reason;
  }
  const health = harnesses?.find(item => item.harness === route.harness);
  const knownQuota = health?.limitsObservedAtMs != null && health.limitsObservedAtMs <= request.now + 5000 && request.now - health.limitsObservedAtMs <= CODING_DECLARATION_TTL_MS &&
    health.limits?.some(window => (window.status === 'allowed' || window.status === 'allowed-warning') &&
      (window.resetsAtMs === null || window.resetsAtMs > request.now)) === true;
  return {worker, ...(revision === undefined ? {} : {revision}), ...(route.harness === undefined ? {} : {harness: route.harness}),
    reason: route.reason, score: [pressureRank[declaration?.pressure ?? 'unknown'], worker.running,
      requirements.testSlots === undefined ? 0 : -(declaration?.testSlots ?? 0), knownQuota ? 0 : 1]};
}

export function selectCodingWorker(workers: readonly CodingCandidate[], request: Request): Selection {
  const refusal = request.requirements?.refusal;
  if (refusal !== undefined) return {reason: refusal === 'conflicting-platform' ? 'Clarify which operating system this step requires.' :
    refusal === 'ambiguous-resource' ? 'Clarify the single device or installed operation required by this step.' : 'The requested device or installed operation has no known authorized route.'};
  const matches = (destination: Destination) => request.destination === 'auto' || request.destination === destination ||
    request.destination === 'cloud' && destination.startsWith('cloud-');
  const eligible: Eligible[] = [], alternatives: string[] = [], reasons: string[] = [];
  let permissionDenials = 0;
  for (const worker of workers) {
    const result = evaluateWorker(worker, request);
    if (typeof result === 'string') {
      if (matches(worker.destination) && result === 'sharing permission is unavailable') permissionDenials++;
      if (matches(worker.destination)) reasons.push(`${worker.destination}: ${result}`);
      if (request.choice !== 'auto') {
        const alternative = evaluateWorker(worker, {...request, choice: request.choice === 'codex' ? 'claude-code' : 'codex'});
        if (typeof alternative !== 'string' && alternative.harness !== undefined) alternatives.push(`${worker.destination} with ${label[alternative.harness]}`);
      }
    } else if (matches(worker.destination)) eligible.push(result);
    else alternatives.push(worker.destination);
  }
  eligible.sort((a, b) => {
    for (let i = 0; i < a.score.length; i++) if (a.score[i] !== b.score[i]) return a.score[i]! - b.score[i]!;
    return a.worker.destination < b.worker.destination ? -1 : a.worker.destination === b.worker.destination ? 0 : 1;
  });
  const selected = eligible[0];
  if (selected === undefined) return {...(permissionDenials > 0 && permissionDenials === reasons.length ? {forbidden: true} : {}), reason: `${reasons.sort().join(' ') || `No connected ${request.destination} worker is eligible.`}${alternatives.length === 0 ? '' : ` Eligible alternatives: ${alternatives.sort().join(', ')}.`}`};
  const runnerUp = eligible[1];
  const deciding = runnerUp === undefined ? request.destination === 'auto' ? 'only eligible destination' : 'requested destination' :
    factors[selected.score.findIndex((value, index) => value !== runnerUp.score[index])] ?? 'stable destination identity';
  const {worker, harness, revision} = selected;
  return {worker, ...(harness === undefined ? {} : {harness}), ...(revision === undefined ? {} : {revision}),
    reason: `${worker.destination} selected by ${deciding}. ${selected.reason}`};
}
