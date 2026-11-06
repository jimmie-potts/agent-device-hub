import {createHash} from 'node:crypto';
import {errorBody, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import {commandSupported, type DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {MomentPlayRequest} from '@jimmie-potts/event-contracts/v2/families';
import {rainNoticeIssue, rainNoticeRefusal, type RainNotice} from '@jimmie-potts/event-contracts/v2/art-notice';
import {Outcome, type Cancel, type ModuleScheduler, type TraceContext} from '@jimmie-potts/sdk';
import type {Operation} from './operations.js';
import type {Action, ActionAnswer} from './tracker.js';

export type ArtPlanTarget = {target: string; kind: 'pixoo' | 'tidbyt'};
export type ArtPlan = Pick<MomentPlayRequest, 'mood' | 'priorityClass' | 'coversStatus' | 'startAtMs' | 'toleranceMs'> & {
  id: string; artworkId: string; prepareUntilMs: number;
  displays: readonly {target: string; compositionId: string; durationMs: number}[];
  browser?: {compositionId: string};
  notice?: RainNotice;
};
export type ArtSurface = {kind: 'display'; target: string} | {kind: 'browser'};
/** Opportunity selection, quiet hours and budgets belong to the caller under the automation owner. */
export type ArtPermit = (surface: ArtSurface) => ErrorBody | undefined;
/** A tracked attempt has its own operation; this is never an aggregate success claim. */
export type ArtPlanAttempt = {status: 'tracked'; requestId: string} | {status: 'not-requested'; error: ErrorBody};
export type ArtPlanResult = {id: string; displays: {target: string; prepare: ArtPlanAttempt; moment: ArtPlanAttempt}[]; browser?: ArtPlanAttempt};
type Options = {
  clock: () => number; scheduler: ModuleScheduler; active: () => boolean;
  targets: () => readonly ArtPlanTarget[]; current: (target: string) => DeviceRecord | undefined;
  dispatch: (action: Action) => Promise<ActionAnswer>; operation: (requestId: string) => Operation | undefined;
  claim: (id: string, digest: string) => ErrorBody | undefined;
};
const id = (value: string): boolean => /^[A-Za-z0-9_.-]{1,128}$/.test(value);
const composition = (value: string): boolean => /^[a-f0-9]{64}$/.test(value);
const instant = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;
const notRequested = (error: ErrorBody): ArtPlanAttempt => ({status: 'not-requested', error});
const cutoff = (): ErrorBody => errorBody('invalid-state', {detail: 'art presentation passed its preparation cutoff'});
const stopped = (): ErrorBody => errorBody('cancelled', {detail: 'art presentation stopped before handoff'});
export const artPlanRequestId = (id: string, phase: 'prepare'|'browser'|'moment'|'intent', target: string): string =>
  `art-plan-${createHash('sha256').update(`${id}\0${phase}\0${target}`).digest('hex')}`;
const requestId = (plan: ArtPlan, phase: 'prepare'|'browser'|'moment'|'intent', target: string): string => artPlanRequestId(plan.id,phase,target);
const planDigest = (plan: ArtPlan): string => createHash('sha256').update(JSON.stringify([
  plan.artworkId, plan.startAtMs, plan.prepareUntilMs, plan.toleranceMs, plan.mood, plan.priorityClass, plan.coversStatus,
  [...plan.displays].sort((a, b) => a.target < b.target ? -1 : a.target > b.target ? 1 : 0).map(value => [value.target, value.compositionId, value.durationMs]),
  plan.browser?.compositionId ?? null,
  plan.notice===undefined?null:[plan.notice.kind,plan.notice.likelihood,plan.notice.forecastStartAtMs,plan.notice.forecastEndAtMs,plan.notice.forecastUpdatedAtMs,plan.notice.observedAtMs,plan.notice.staleAtMs,plan.notice.weatherRevision],
])).digest('hex');

export function createArtPlans(options: Options) {
  let closed = false;
  const waits = new Set<{requestId?: string; inspect: () => void; cancel: () => void}>();
  const active = (): boolean => !closed && options.active();
  const targetRecord = (target: string): {kind: ArtPlanTarget['kind']; record: DeviceRecord} | ErrorBody => {
    const configured = options.targets().find(candidate => candidate.target === target);
    if (configured === undefined) return errorBody('not-found', {detail: 'the art target is not configured'});
    const record = options.current(target);
    if (record === undefined || record.id !== target || record.kind !== configured.kind || record.availability !== 'available' || record.held !== undefined)
      return errorBody('unavailable', {detail: 'the art target has no current available owner record'});
    if (!record.capabilities.moments.supported || record.capabilities.moments.art === undefined) return errorBody('unsupported-capability');
    if (record.externalControl.status === 'known' && record.externalControl.owner === 'external') return errorBody('invalid-state', {detail: 'the art target is under external control'});
    return {kind: configured.kind, record};
  };
  const attempt = async (action: Action & {requestId: string}): Promise<ArtPlanAttempt> => {
    const answer = await options.dispatch(action);
    if ('error' in answer && answer.error.code === 'duplicate-conflict') return notRequested(answer);
    return options.operation(action.requestId) !== undefined || !('error' in answer)
      ? {status: 'tracked', requestId: action.requestId} : notRequested(answer);
  };
  const prepareDisplay = async (action: Action & {requestId: string}, untilMs: number, admittedAtMs: number) => {
    const budget = Math.min(untilMs - options.clock(), untilMs - admittedAtMs);
    if (budget <= 0) return {prepare: notRequested(cutoff()), refusal: undefined};
    let expired = false, inspect: () => void = () => {};
    // Arm before sending. Neither a slow admission nor a wall correction buys a second preparation budget.
    const cancel = options.scheduler.after(budget, () => {expired = true; inspect();});
    try {
      const prepare = await attempt(action);
      if (prepare.status === 'not-requested') return {prepare, refusal: undefined};
      const refusal = await new Promise<ErrorBody | undefined>(resolve => {
        const finish = (error?: ErrorBody): void => {if (waits.delete(wait)) resolve(error);};
        const wait = {requestId: action.requestId, cancel: () => {finish(stopped());}, inspect: () => {
          if (!active()) {finish(stopped()); return;}
          if (expired || options.clock() >= untilMs) {finish(cutoff()); return;}
          const operation = options.operation(action.requestId);
          if (operation?.result === Outcome.succeeded) finish();
          else if (operation !== undefined && !['sent', 'accepted'].includes(operation.status)) {
            finish(operation.error === undefined ? errorBody('uncertain-result') : {error: operation.error});
          }
        }};
        waits.add(wait); inspect = wait.inspect; inspect();
      });
      return {prepare, refusal};
    } finally {cancel();}
  };
  const browser = (plan: ArtPlan, permit: ArtPermit, parent: TraceContext | undefined, admittedAtMs: number): Promise<ArtPlanAttempt> => new Promise((resolve, reject) => {
    const timers: Cancel[] = [], latest = plan.startAtMs + plan.toleranceMs;
    const take = (): boolean => {
      if (!waits.delete(wait)) return false;
      for (const cancel of timers) cancel();
      return true;
    };
    const wait = {cancel: () => {if (take()) resolve(notRequested(stopped()));}, inspect: () => {}};
    const outsideWindow = (): boolean => {
      const at = options.clock();
      return admittedAtMs > latest || at < plan.startAtMs || at > latest;
    };
    const missed = (): ArtPlanAttempt => notRequested(errorBody('invalid-state', {detail: 'browser art is outside its start window'}));
    const present = async (): Promise<ArtPlanAttempt> => {
      if (!active()) return notRequested(stopped());
      if (outsideWindow()) return missed();
      const refusal = permit({kind: 'browser'});
      if (refusal !== undefined) return notRequested(refusal);
      if (!active()) return notRequested(stopped());
      if (outsideWindow()) return missed();
      if (plan.browser === undefined) return notRequested(errorBody('invalid-request'));
      return attempt({requestId: requestId(plan, 'browser', 'art'), key: 'bunny.cmd.art-auto.art', requestedBy: 'bunny/core', ...(parent===undefined?{}:{parent}),
        draft: {type: 'org.bunny.art.auto.requested', subject: 'art', dataschema: 'https://bunny.invalid/events/art-auto/2.1',
          data: {action: 'present', artworkId: plan.artworkId, compositionId: plan.browser.compositionId}}});
    };
    waits.add(wait);
    const run = (): void => {if (take()) void present().then(resolve, reject);};
    const armedAtMs = options.clock();
    if (plan.startAtMs <= armedAtMs || admittedAtMs >= latest) {run(); return;}
    const delay = plan.startAtMs - armedAtMs, budget = Math.min(latest - armedAtMs, latest - admittedAtMs);
    // The first wake can be early on the wall clock. Only the originally allowed final wake may try again.
    if (delay < budget) {
      timers.push(options.scheduler.after(delay, () => {if (!active() || options.clock() >= plan.startAtMs) run();}));
    }
    timers.push(options.scheduler.after(budget, run));
  });
  const display = async (plan: ArtPlan, selected: ArtPlan['displays'][number], permit: ArtPermit, parent: TraceContext | undefined, admittedAtMs: number): Promise<ArtPlanResult['displays'][number]> => {
    const blocked = (error: ErrorBody) => ({target: selected.target, prepare: notRequested(error), moment: notRequested(error)});
    if (!active()) return blocked(stopped());
    if (options.clock() >= plan.prepareUntilMs) return blocked(cutoff());
    const original = structuredClone(targetRecord(selected.target));
    if ('error' in original) return blocked(original);
    const moment: MomentPlayRequest = {requestId: requestId(plan, 'moment', selected.target), momentId: requestId(plan, 'intent', 'art'),
      mood: plan.mood, durationMs: selected.durationMs, priorityClass: plan.priorityClass, coversStatus: plan.coversStatus,
      startAtMs: plan.startAtMs, toleranceMs: plan.toleranceMs, art: {compositionId: selected.compositionId},...(plan.notice===undefined?{}:{notice:plan.notice})};
    if (!commandSupported(original.record.capabilities, {family: 'moment-play', data: moment}) || original.kind === 'tidbyt' && selected.durationMs < 30_000)
      return blocked(errorBody('unsupported-capability'));
    const {prepare, refusal} = await prepareDisplay({requestId: requestId(plan, 'prepare', selected.target), key: 'bunny.cmd.art-auto.art', requestedBy: 'bunny/core', ...(parent===undefined?{}:{parent}),
      draft: {type: 'org.bunny.art.auto.requested', subject: 'art', dataschema: 'https://bunny.invalid/events/art-auto/2.1',
        data: {action: 'prepare', artworkId: plan.artworkId, compositionId: selected.compositionId, target: selected.target}}}, plan.prepareUntilMs, admittedAtMs);
    const result = (next: ArtPlanAttempt) => ({target: selected.target, prepare, moment: next});
    if (prepare.status === 'not-requested') return result(prepare);
    if (refusal !== undefined) return result(notRequested(refusal));
    if (!active()) return result(notRequested(stopped()));
    if (options.clock() >= plan.prepareUntilMs) return result(notRequested(cutoff()));
    const current = targetRecord(selected.target);
    if ('error' in current) return result(notRequested(current));
    if (current.kind !== original.kind || current.record.configurationRevision !== original.record.configurationRevision
      || current.record.generation.epoch !== original.record.generation.epoch || current.record.generation.sequence !== original.record.generation.sequence)
      return result(notRequested(errorBody('invalid-state', {detail: 'the art target changed while preparing'})));
    if (!commandSupported(current.record.capabilities, {family: 'moment-play', data: moment})) return result(notRequested(errorBody('unsupported-capability')));
    const policy = rainNoticeRefusal(plan.notice,moment,options.clock()) ?? permit({kind: 'display', target: selected.target});
    if (policy !== undefined) return result(notRequested(policy));
    if (!active()) return result(notRequested(stopped()));
    if (options.clock() >= plan.prepareUntilMs) return result(notRequested(cutoff()));
    return result(await attempt({requestId: moment.requestId, key: `bunny.cmd.moment-play.${selected.target}`, requestedBy: 'bunny/core', ...(parent===undefined?{}:{parent}),
      draft: {type: 'org.bunny.moment.play.requested', subject: selected.target, dataschema: `https://bunny.invalid/events/moment-play/${plan.notice===undefined?'2.1':'2.2'}`, data: moment}}));
  };
  return {
    targets: (): readonly ArtPlanTarget[] => options.targets().map(target => ({...target})),
    present: async (input: ArtPlan, permit: ArtPermit, parent?: TraceContext): Promise<ArtPlanResult | ErrorBody> => {
      const plan = structuredClone(input), now = options.clock();
      if (!active()) return errorBody('unavailable');
      if (!id(plan.id) || !id(plan.artworkId) || !instant(plan.startAtMs) || !instant(plan.prepareUntilMs) || plan.prepareUntilMs > plan.startAtMs
        || plan.startAtMs > now + 60_000 || !Number.isInteger(plan.toleranceMs) || plan.toleranceMs < 0 || plan.toleranceMs > 60_000
        || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(plan.mood) || plan.mood.length > 128 || !['event', 'flourish'].includes(plan.priorityClass)
        || typeof plan.coversStatus !== 'boolean' || plan.priorityClass === 'flourish' && plan.coversStatus
        || plan.displays.length > 2 || plan.displays.length === 0 && plan.browser === undefined
        || new Set(plan.displays.map(item => item.target)).size !== plan.displays.length
        || plan.displays.some(item => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.target) || item.target.length > 128 || !composition(item.compositionId)
          || !Number.isInteger(item.durationMs) || item.durationMs < 1000 || item.durationMs > 300_000)
        || plan.browser !== undefined && !composition(plan.browser.compositionId)) return errorBody('invalid-request');
      if(plan.notice!==undefined && (rainNoticeIssue(plan.notice,now)!==undefined || rainNoticeRefusal(plan.notice,{startAtMs:plan.startAtMs,toleranceMs:plan.toleranceMs,durationMs:Math.max(30_000,...plan.displays.map(item=>item.durationMs))},now)!==undefined))return errorBody('invalid-request');
      const refused = options.claim(plan.id, planDigest(plan));
      if (refused !== undefined) return refused;
      const [displays, browserResult] = await Promise.all([
        Promise.all(plan.displays.map(selected => display(plan, selected, permit, parent, now))),
        plan.browser === undefined ? undefined : browser(plan, permit, parent, now),
      ]);
      return {id: plan.id, displays, ...(browserResult === undefined ? {} : {browser: browserResult})};
    },
    changed: (request?: string): void => {for (const wait of [...waits]) if (wait.requestId !== undefined && (request === undefined || wait.requestId === request)) wait.inspect();},
    close: (): void => {closed = true; for (const wait of [...waits]) wait.cancel();},
  };
}
export type ArtPlans = ReturnType<typeof createArtPlans>;
