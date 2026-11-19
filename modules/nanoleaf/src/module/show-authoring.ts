import {errorBody, type ErrorBody, type ErrorCode} from '@jimmie-potts/event-contracts/v2';
import {fullDisk, Outcome, recordLog, SdkError, type AddMessage, type Cancel, type Command, type ModuleContent, type ModuleContentRequest,
  type ModuleContext, type Outbox, type TraceContext} from '@jimmie-potts/sdk';
import {MAX_STYLE_LENGTH, prepareAuthoredTimeline} from '../music-show-authoring.js';
import type {MusicShowAuthoringInput, MusicShowAuthoringProvider} from '../music-show-authoring-provider.js';
import {MUSIC_AUTHORING_MODEL, SHOW_TARGET, showMeasurement, showProvenance, type ShowMeasurement, type ShowProvenance} from '../music-show-data.js';
import {prepareMusicTimeline, type MusicTimeline} from '../music-timeline.js';
import {isObject} from '../compat.js';
import {execute, first, rows, text, type Db} from '../sqlite.js';
import {NANOLEAF_FAMILIES, OUTCOME_SCHEMA} from './schemas.js';

export type GenerateShow = {source: 'measured' | 'generic'; style: string};
export type CancelGeneration = {generationRequestId: string};
type GenerationInput = Readonly<{disclosure: MusicShowAuthoringInput; measurement?: ShowMeasurement}>;
type GeneratedDraft = Readonly<{timeline: MusicTimeline; provenance: ShowProvenance; measurement?: ShowMeasurement}>;
type Reply = {status: 'accepted'} | ErrorBody;

const GENERATION_MS = 60_000;
const MAX_SETTLEMENT_RETRIES = 4;
const SETTLEMENT_RETRY_MS = 250;
const showGeneration = NANOLEAF_FAMILIES.showGenerate;
const cancelGeneration = NANOLEAF_FAMILIES.showGenerateCancel;

function completion(add: AddMessage, family: typeof showGeneration | typeof cancelGeneration, requestId: string,
  parent: TraceContext, error?: ErrorBody): void {
  add(`bunny.event.${family.family}.${SHOW_TARGET}`, {
    kind: 'outcome', type: family.type.replace(/\.requested$/, '.completed'), subject: SHOW_TARGET, dataschema: OUTCOME_SCHEMA,
    data: error === undefined ? {requestId, result: Outcome.succeeded, evidence: Outcome.observed} : {
      requestId, result: error.error.code === 'uncertain-result' ? Outcome.uncertain : Outcome.failed, evidence: Outcome.none, error: error.error,
    },
  }, {parent});
}

type Settlement = Readonly<{command: Command<GenerateShow>; draft?: GeneratedDraft; error?: ErrorBody; signal: AbortSignal}>;
type ActiveGeneration = {requestId: string; controller: AbortController; work: Promise<void>};

export class ShowAuthoring {
  #active: ActiveGeneration | undefined;
  #settlement: Settlement | undefined;
  #settlementRetry: Cancel | undefined;

  constructor(private readonly context: Pick<ModuleContext, 'clock' | 'scheduler' | 'signal' | 'log'>,
    private readonly db: Db, private readonly outbox: Outbox,
    private readonly provider: MusicShowAuthoringProvider | undefined,
    private readonly proofs: (draft: GeneratedDraft) => object) {
    db.exec(`CREATE TABLE IF NOT EXISTS nanoleaf_show_generation (
      request_id TEXT PRIMARY KEY, traceparent TEXT NOT NULL, status TEXT NOT NULL, draft TEXT);
      CREATE INDEX IF NOT EXISTS nanoleaf_show_generation_status ON nanoleaf_show_generation(status);`);
  }

  async recover(): Promise<void> {
    await this.outbox.transaction(add => {
      for (const row of rows(this.db, "SELECT request_id,traceparent FROM nanoleaf_show_generation WHERE status IN ('pending','cancelling')")) {
        const requestId = text(row, 0);
        execute(this.db, "UPDATE nanoleaf_show_generation SET status='finished' WHERE request_id=?", requestId);
        completion(add, showGeneration, requestId, {traceparent: text(row, 1)}, errorBody('uncertain-result', {
          detail: 'The runtime restarted during generation. The request was not sent again.',
        }));
      }
    });
  }

  async start(command: Command<GenerateShow>, input: () => GenerationInput | ErrorBody): Promise<Reply> {
    const provider = this.provider;
    const {requestId, style} = command.data;
    if (provider === undefined || this.context.signal.aborted) return errorBody('unavailable', {detail: 'Claude is unavailable for Music show generation.'});
    if (style.trim() === '' || style.length > MAX_STYLE_LENGTH) return errorBody('invalid-request', {detail: 'Enter a short style request.'});
    if (this.#settlement !== undefined) await this.#settle(this.#settlement, MAX_SETTLEMENT_RETRIES);
    const generation = input();
    if ('error' in generation) return generation;
    const controller = new AbortController();
    try {
      const refused = await this.outbox.transaction(() => {
        if (first(this.db, 'SELECT 1 FROM nanoleaf_show_generation WHERE request_id=?', requestId) !== undefined) {
          return errorBody('duplicate-conflict');
        }
        if (this.context.signal.aborted) return errorBody('unavailable');
        if (command.expiresat === undefined || Date.parse(command.expiresat) <= this.context.clock.now()) return errorBody('expired');
        if (this.#active !== undefined || first(this.db, "SELECT 1 FROM nanoleaf_show_generation WHERE status IN ('pending','cancelling')") !== undefined) {
          return errorBody('capacity', {detail: 'A Music show generation is already in progress.'});
        }
        execute(this.db, "INSERT INTO nanoleaf_show_generation VALUES (?,?,'pending',NULL)", requestId, command.traceparent);
        return undefined;
      });
      if (refused !== undefined) return refused;
    } catch (error) {
      return errorBody(fullDisk(error) ? 'capacity' : 'internal', {detail: 'The generation request could not be saved.'});
    }
    const work = this.#generate(command, generation, provider, controller).finally(() => {this.#active = undefined;});
    this.#active = {requestId, controller, work};
    return {status: 'accepted'};
  }

  async cancel(command: Command<CancelGeneration>): Promise<Reply> {
    const active = this.#active;
    if (active?.requestId !== command.data.generationRequestId) return errorBody('not-found', {detail: 'That generation is no longer running.'});
    try {
      const refused = await this.outbox.transaction(add => {
        if (command.expiresat === undefined || Date.parse(command.expiresat) <= this.context.clock.now()) return errorBody('expired');
        if (execute(this.db, "UPDATE nanoleaf_show_generation SET status='cancelling' WHERE request_id=? AND status='pending'",
          active.requestId) !== 1) return errorBody('not-found');
        completion(add, cancelGeneration, command.data.requestId, command);
        return undefined;
      });
      if (refused !== undefined) return refused;
    } catch (error) {
      return errorBody(fullDisk(error) ? 'capacity' : 'internal', {detail: 'The cancellation could not be recorded.'});
    }
    active.controller.abort();
    return {status: 'accepted'};
  }

  content(request: ModuleContentRequest | undefined, latest: boolean): ModuleContent | ErrorBody {
    if (request === undefined) return errorBody('invalid-request');
    const {requestId} = request.query;
    if (latest ? Object.keys(request.query).length !== 0
      : Object.keys(request.query).length !== 1 || requestId === undefined || !/^[A-Za-z0-9_.-]{1,128}$/.test(requestId)) {
      return errorBody('invalid-request');
    }
    if (request.signal.aborted) return errorBody('cancelled');
    const row = latest
      ? first(this.db, "SELECT draft FROM nanoleaf_show_generation WHERE status='drafted' ORDER BY rowid DESC LIMIT 1")
      : first(this.db, "SELECT draft FROM nanoleaf_show_generation WHERE request_id=? AND status='drafted'", requestId ?? '');
    if (row === undefined) return errorBody('not-found');
    try {
      const stored: unknown = JSON.parse(text(row, 0));
      if (!isObject(stored)) return errorBody('invalid-state');
      const provenance = showProvenance(stored.provenance);
      const measurement = showMeasurement(stored.measurement);
      if (provenance === undefined || (provenance.confidence === 'measured-excerpt') !== (measurement !== undefined)) {
        return errorBody('invalid-state');
      }
      const draft = {timeline: prepareMusicTimeline(stored.timeline), provenance, ...(measurement === undefined ? {} : {measurement})};
      return {type: 'application/json', bytes: Buffer.from(JSON.stringify({...draft, ...this.proofs(draft)}))};
    } catch {return errorBody('invalid-state');}
  }

  async stop(): Promise<void> {
    this.#active?.controller.abort();
    await this.#active?.work;
    this.#settlementRetry?.();
    this.#settlementRetry = undefined;
    if (this.#settlement !== undefined) await this.#settle(this.#settlement, MAX_SETTLEMENT_RETRIES);
  }

  async #generate(command: Command<GenerateShow>, input: GenerationInput, provider: MusicShowAuthoringProvider,
    controller: AbortController): Promise<void> {
    const {requestId} = command.data;
    const stop = this.context.scheduler.after(GENERATION_MS, () => controller.abort());
    const signal = AbortSignal.any([controller.signal, this.context.signal]);
    let draft: GeneratedDraft | undefined;
    let error: ErrorBody | undefined;
    try {
      const result = await provider(input.disclosure, signal, requestId);
      if (signal.aborted) throw new SdkError(errorBody('cancelled'));
      try {
        draft = {timeline: prepareAuthoredTimeline(result.draft, input.disclosure.analysis?.spans ?? null), provenance: {
          model: MUSIC_AUTHORING_MODEL, costUsd: result.costUsd, confidence: input.measurement === undefined ? 'generic' : 'measured-excerpt',
          ...(result.costBasis === undefined ? {} : {costBasis: result.costBasis}),
        }, ...(input.measurement === undefined ? {} : {measurement: input.measurement})};
      } catch {
        error = errorBody('invalid-message', {detail: 'Claude returned cues outside the supported effects or measured timing.'});
      }
    } catch (cause) {
      error = cause instanceof SdkError ? cause.body : errorBody('uncertain-result', {detail: 'The generation attempt could not be confirmed.'});
    } finally {stop();}

    const settlement = {command, signal, ...(draft === undefined ? {} : {draft}), ...(error === undefined ? {} : {error})};
    this.#settlement = settlement;
    await this.#settle(settlement, 0);
  }

  /** Repeat only the local outcome transaction. The provider has already finished. */
  async #settle(settlement: Settlement, attempt: number): Promise<void> {
    const {command, signal, draft, error} = settlement;
    const {requestId} = command.data;
    try {
      await this.outbox.transaction(add => {
        const row = first(this.db, 'SELECT status FROM nanoleaf_show_generation WHERE request_id=?', requestId);
        if (row === undefined || (row[0] !== 'pending' && row[0] !== 'cancelling')) return;
        const failure = error ?? (signal.aborted || row[0] === 'cancelling' ? errorBody('cancelled') : undefined);
        const ready = failure === undefined && draft !== undefined;
        execute(this.db, 'UPDATE nanoleaf_show_generation SET status=?,draft=? WHERE request_id=?',
          ready ? 'drafted' : 'finished', ready ? JSON.stringify(draft) : null, requestId);
        completion(add, showGeneration, requestId, command, failure);
      });
      if (this.#settlement === settlement) {
        this.#settlement = undefined;
        this.#settlementRetry?.();
        this.#settlementRetry = undefined;
      }
    } catch (cause) {
      if (attempt === 0) {
        const code: ErrorCode = fullDisk(cause) ? 'capacity' : 'internal';
        recordLog(this.context.log, 'operation.failed', {'bunny.operation': 'storage', 'bunny.outcome': Outcome.failed,
          'bunny.code': code, 'bunny.request.id': requestId}, command);
      }
      if (attempt >= MAX_SETTLEMENT_RETRIES || this.context.signal.aborted || this.#settlement !== settlement || this.#settlementRetry !== undefined) return;
      this.#settlementRetry = this.context.scheduler.after(SETTLEMENT_RETRY_MS * 2 ** attempt, () => {
        this.#settlementRetry = undefined;
        void this.#settle(settlement, attempt + 1);
      });
    }
  }
}
