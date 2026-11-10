// The owner's on-demand show of one saved artwork (Hub #1581). `art-show` on `bunny.cmd.art-show.hub` reuses the scheduled
// appearance's plan path: the exact saved compositions are prepared through the existing art-stage forwarding, each display
// gets one `moment-play/2.1` at a near-term common start and the browser one present, every surface its own tracked
// operation. A show starts no generation, changes no mode and never touches the schedule's claims, count or spacing. Its
// owner permit passes quiet hours and budgets; attention, device holds, pins and each display's own admission still decide.
import {errorBody, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import {ART_SHOW_BROWSER, ART_SHOW_KEY, ART_SHOW_LEAD_MS, ART_SHOW_SUBJECT, artShowPlanId, type ArtShowRequest} from '@jimmie-potts/event-contracts/v2/art-show';
import type {ArtRecord, ArtworkSummary} from '@jimmie-potts/event-contracts/v2/art-state';
import {coreValidator} from '@jimmie-potts/event-contracts/v2/families';
import {Outcome, type Command, type Reply, type TraceContext} from '@jimmie-potts/sdk';
import type {ArtCatalogRead} from './art-catalog.js';
import type {ArtPermit, ArtPlan, ArtPlanAttempt, ArtPlanResult, ArtPlans} from './art-plans.js';
import {START_TOLERANCE_MS} from './art-schedule-model.js';
import type {NewLogRow} from './automation-store.js';
import type {CoreHandle, CorePart} from './core.js';
import type {CoreTransaction} from './store.js';
import type {Operation} from './operations.js';
import type {CompletedOutcome} from './tracker.js';

/** The automation log's rule identity for owner shows: `priorityClass` `event`, so no flourish budget or spacing counts them. */
export const ART_SHOW_RULE = 'art-show';
const DURATION_MS = {pixoo: 10_000, tidbyt: 30_000} as const;
/** Time kept after a catalog read for the refusal to reach the dispatcher before the command's reply deadline. */
export const ART_CATALOG_REPLY_MARGIN_MS = 1000;
/** The longest catalog read, for a command without a reply deadline. */
const ART_CATALOG_LONGEST_MS = 5000;

export type ArtShowOptions = {
  clock: () => number; active: () => boolean; plans: Pick<ArtPlans, 'targets' | 'present'>;
  /** The art owner's current published record, read whatever the schedule policy says. */
  art: () => Promise<ArtRecord | undefined>;
  /** Retained art outside that record, from the art owner's catalog (Hub #1584); read only when the record lacks the artwork. */
  retained?: ArtCatalogRead;
  attention: () => boolean;
  /** Appends owner evidence beside scheduled and rule attempts. */
  log: (rows: readonly NewLogRow[]) => void;
  /** The tracker's record for a sent request: a display's own refusal is a tracked operation, not an admission. */
  operation: (requestId: string) => Pick<Operation, 'status' | 'error'> | undefined;
  failed: () => void;
};
type Refusal = {target: string; error: ErrorBody};
/** A checked show holding the one show slot. Nothing has been sent. */
export type PreparedShow = {requestId: string; plan: ArtPlan; refused: readonly Refusal[]};

const usable = (artwork: ArtworkSummary, kind: 'ui' | 'pixoo' | 'tidbyt'): string | undefined => artwork.compositions.find(item =>
  item.target === kind && item.outcome === Outcome.succeeded && item.compositionId !== null && item.renditions.length > 0)?.compositionId ?? undefined;

export function createArtShow(options: ArtShowOptions) {
  let showing = false;
  // Attention holds every surface, as it holds a scheduled appearance. Quiet hours, budgets, spacing and the schedule
  // policy do not apply: the owner chose this artwork and these surfaces now.
  const permit: ArtPermit = () => !options.active() ? errorBody('cancelled', {detail: 'the owner art show stopped before handoff'})
    : options.attention() ? errorBody('invalid-state', {detail: 'attention holds the displays; the owner art show was not sent'}) : undefined;
  const evidence = (shown: PreparedShow, result: ArtPlanResult | ErrorBody): void => {
    const atMs = options.clock(), {plan} = shown;
    const row = (target: string, outcome: NewLogRow['outcome'], family: string, attempt?: ArtPlanAttempt, reason?: string): NewLogRow => {
      // A tracked request that its owner refused was sent but not admitted: its row says so, beside the operation it names.
      const refused = attempt?.status === 'tracked' ? options.operation(attempt.requestId) : undefined;
      const admitted = refused?.status === 'rejected' ? 'not-sent' : outcome;
      return {atMs, ruleId: ART_SHOW_RULE, eventSource: 'owner', eventId: shown.requestId, eventKind: 'art-show', eventAlias: null, agent: null, task: null,
        momentId: plan.id, priorityClass: plan.priorityClass, coversStatus: plan.coversStatus, target, outcome: admitted,
        reason: reason ?? (attempt?.status === 'not-requested' ? attempt.error.error.code : refused?.status === 'rejected' ? refused.error?.code ?? 'unavailable' : null),
        detail: JSON.stringify({family, ...(attempt?.status === 'tracked' ? {requestId: attempt.requestId} : {})})};
    };
    const rows = shown.refused.map(({target, error}) => row(target, 'blocked', target === ART_SHOW_BROWSER ? 'art-auto' : 'moment-play', undefined, error.error.code));
    if ('error' in result) {
      rows.push(...plan.displays.map(display => row(display.target, 'not-sent', 'moment-play', undefined, result.error.code)));
      if (plan.browser !== undefined) rows.push(row(ART_SHOW_BROWSER, 'not-sent', 'art-auto', undefined, result.error.code));
    } else {
      rows.push(...result.displays.map(display => row(display.target, display.moment.status === 'tracked' ? 'receipt' : 'not-sent', 'moment-play', display.moment)));
      if (result.browser !== undefined) rows.push(row(ART_SHOW_BROWSER, result.browser.status === 'tracked' ? 'receipt' : 'not-sent', 'art-auto', result.browser));
    }
    try {options.log(rows);} catch {options.failed();}
  };
  return {
    /**
     * Checks one request against the current saved art and configured targets and takes the one show slot. Art outside
     * the published record is looked up in the art owner's retained catalog. A refusal sends nothing: art the owner no
     * longer retains is `not-found`, an unreadable catalog `unavailable`, a target with no usable composition
     * `unsupported-capability` and an unconfigured display `not-found`, each for that target alone unless no target remains.
     */
    async prepare(request: ArtShowRequest, replyByMs = Number.POSITIVE_INFINITY): Promise<PreparedShow | ErrorBody> {
      if (!options.active()) return errorBody('unavailable', {detail: 'the core is not taking art shows now'});
      if (showing) return errorBody('capacity', {detail: 'another owner art show is still preparing; read its results before a new request'});
      showing = true;
      let held = false;
      try {
        const catalog = await options.art();
        if (!options.active()) return errorBody('unavailable', {detail: 'the core is not taking art shows now'});
        if (catalog === undefined) return errorBody('unavailable', {detail: 'saved art records are unavailable now'});
        let artwork: ArtworkSummary | ErrorBody | undefined = catalog.artworks.find(value => value.artworkId === request.artworkId);
        if (artwork === undefined && options.retained !== undefined) {
          // The read ends before the command's reply deadline, so a slow catalog is refused, never left uncertain.
          const leftMs = Math.min(ART_CATALOG_LONGEST_MS, replyByMs - options.clock() - ART_CATALOG_REPLY_MARGIN_MS);
          if (leftMs <= 0) return errorBody('unavailable', {detail: 'no time is left to read the art owner\'s saved art catalog'});
          artwork = await options.retained(request.artworkId, leftMs);
          if (!options.active()) return errorBody('unavailable', {detail: 'the core is not taking art shows now'});
        }
        if (artwork === undefined) return errorBody('not-found', {detail: 'the art owner retains no such saved artwork'});
        if ('error' in artwork) return artwork;
        const configured = options.plans.targets(), refused: Refusal[] = [], displays: ArtPlan['displays'][number][] = [];
        let browser: string | undefined;
        for (const target of request.targets) {
          if (target === ART_SHOW_BROWSER) {
            browser = usable(artwork, 'ui');
            if (browser === undefined) refused.push({target, error: errorBody('unsupported-capability', {detail: 'the artwork has no browser composition'})});
            continue;
          }
          const display = configured.find(value => value.target === target);
          const compositionId = display === undefined ? undefined : usable(artwork, display.kind);
          if (display === undefined) refused.push({target, error: errorBody('not-found', {detail: 'the target is not a configured art display'})});
          else if (compositionId === undefined) refused.push({target, error: errorBody('unsupported-capability', {detail: 'the artwork has no composition for this display'})});
          else displays.push({target, compositionId, durationMs: DURATION_MS[display.kind]});
        }
        if (displays.length > 2) return errorBody('invalid-request', {detail: 'a show presents on at most two displays and the browser'});
        const first = refused[0];
        if (displays.length === 0 && browser === undefined) return first === undefined ? errorBody('invalid-request') : first.error;
        const startAtMs = options.clock() + ART_SHOW_LEAD_MS;
        const plan: ArtPlan = {id: await artShowPlanId(request.requestId), artworkId: artwork.artworkId, startAtMs, prepareUntilMs: startAtMs - 1000,
          toleranceMs: START_TOLERANCE_MS, mood: 'celebrate', priorityClass: 'event', coversStatus: request.coversStatus ?? true,
          displays, ...(browser === undefined ? {} : {browser: {compositionId: browser}})};
        held = true;
        return {requestId: request.requestId, plan, refused};
      } finally {if (!held) showing = false;}
    },
    /** Runs a prepared show once and logs each surface. It is never retried; a second show is a new command. */
    async run(shown: PreparedShow, parent?: TraceContext): Promise<ArtPlanResult | ErrorBody> {
      try {
        const result = await options.plans.present(shown.plan, permit, parent);
        evidence(shown, result);
        return result;
      } finally {showing = false;}
    },
    get showing(): boolean {return showing;},
  };
}
export type ArtShow = ReturnType<typeof createArtShow>;

/** The show's own outcome: the core observed its plan hand each surface off. Never an aggregate display success. */
export function artShowOutcome(result: ArtPlanResult | ErrorBody): Omit<CompletedOutcome, 'requestId'> {
  if ('error' in result) return {result: Outcome.failed, evidence: Outcome.none, error: result.error};
  const attempts = [...result.displays.map(display => display.moment), ...(result.browser === undefined ? [] : [result.browser])];
  if (attempts.some(attempt => attempt.status === 'tracked')) return {result: Outcome.succeeded, evidence: Outcome.observed};
  const refused = attempts.find(attempt => attempt.status === 'not-requested');
  return {result: Outcome.failed, evidence: Outcome.none, error: refused?.status === 'not-requested' ? refused.error.error : errorBody('unavailable').error};
}

/** Private constructor authority, bound by core.ts to its tracker, as for the Hub mode. */
export type ArtShowAdmission = {
  admit(command: Command<ArtShowRequest>): boolean;
  complete(tx: CoreTransaction, command: Command<ArtShowRequest>, result: Omit<CompletedOutcome, 'requestId'>): () => void;
  end(command: Command<ArtShowRequest>): void;
};

export class ArtShowPart implements CorePart {
  readonly #admission: ArtShowAdmission;
  readonly #show: () => ArtShow | undefined;
  readonly #validator = coreValidator();
  readonly #failed: () => void;
  #core: CoreHandle | undefined;
  #closed = false;

  constructor(admission: ArtShowAdmission, show: () => ArtShow | undefined, failed: () => void = () => {}) {
    this.#admission = admission;
    this.#show = show;
    this.#failed = failed;
  }

  /** Register before the core's first await, as every core responder does. */
  readonly start = (core: CoreHandle): Promise<unknown> => {
    this.#core = core;
    return core.sdk.respond<ArtShowRequest>(ART_SHOW_KEY, command => this.#answer(command));
  };

  async #answer(command: Command<ArtShowRequest>): Promise<Reply> {
    const checked = this.#validator.validate(command);
    if (!checked.ok) return errorBody(checked.error.code, {detail: 'the request is not a valid art-show command'});
    if (command.subject !== ART_SHOW_SUBJECT) return errorBody('not-found', {detail: 'art shows belong to the Hub'});
    if (!this.#admission.admit(command)) return errorBody('forbidden', {detail: 'this art show has no dispatcher admission'});
    const admitted: Command<ArtShowRequest> = {...command, data: structuredClone(command.data)};
    let handedOff = false;
    try {
      const core = this.#core, show = this.#show();
      if (this.#closed || core === undefined || show === undefined) return errorBody('unavailable', {detail: 'the core art show has not started'});
      await core.ready;
      const replyByMs = Date.parse(command.expiresat ?? '');
      const prepared = await show.prepare(admitted.data, Number.isNaN(replyByMs) ? undefined : replyByMs);
      if ('error' in prepared) return prepared;
      handedOff = true;
      void this.#finish(core, show, admitted, prepared);
      return {status: 'accepted'};
    } finally {
      if (!handedOff) this.#admission.end(admitted);
    }
  }

  /** A restart before completion leaves the show's operation to its deadline, `uncertain`; nothing replays. */
  async #finish(core: CoreHandle, show: ArtShow, command: Command<ArtShowRequest>, prepared: PreparedShow): Promise<void> {
    try {
      const result = await show.run(prepared, command);
      if (this.#closed) return;
      let committed: (() => void) | undefined;
      await core.transaction(tx => {tx.take(command);committed = this.#admission.complete(tx, command, artShowOutcome(result));});
      committed?.();
    } catch {
      // The tracker's deadline ends the operation uncertain; the fault itself is recorded here (ADR 0012).
      this.#failed();
    } finally {
      this.#admission.end(command);
    }
  }

  /** Closing the art plans cancels a running show's waits; its admission ends without a completion. */
  close(): void {this.#closed = true;}
}
