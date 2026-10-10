import { randomUUID } from 'node:crypto';
import { errorBody, isErrorCode, type ErrorCode, } from '@jimmie-potts/event-contracts/v2';
import { fullDisk, SdkError, type AddMessage, type Cancel, type ModuleContext, type Outbox, } from '@jimmie-potts/sdk';
import type { ReadOptions, ReadTransport, Reading, VendorJson, } from '@jimmie-potts/roborock-transport';
import type { RoborockConfig } from './configuration.js';
import { emptyStatus, UNKNOWN, type RunRecord, type VacuumStatus } from './contracts.js';
import { activity, normalizeConsumables, normalizeRecord, normalizeStatus, normalizeSummary, type Status, } from './normalize.js';
import { projectConsumables, projectRun, projectStatusFields, projectTotals, } from './projection.js';
import { stateDrafts } from './state.js';
import { RoborockStore, validateObservationValue, type Episode, type Gap, type MapCapture, type MapReason, type Observation, type Operation, type QueueItem, } from './store.js';
export type CollectorTransport = ReadTransport & {
    identity(): Promise<string>;
};
const READ_MS = 10000;
// Leave the reader time to classify its timeout before the fallback abort fence.
const TRANSPORT_READ_MS = 9000;
const CYCLE_MS = 120000;
const MAP_WINDOW_MS = 60000;
const MAX_BACKOFF_MS = 300000;
const RECORD_BATCH = 4;
const NORMALIZATION_VERSION = 1;
type Guarded<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    code: ErrorCode;
};
type Entry<T> = {
    observation: Observation;
    requestedAt: number;
    value: T | undefined;
    at: number;
    ok: boolean;
    code: ErrorCode | undefined;
    episodeId: string;
    gapId: string;
};
type Candidate = {
    id: string;
    run: RunRecord;
    terminalAt: number;
    generation: number;
    gaps: number;
    reasons: MapReason[];
};
type Control = {
    status: VacuumStatus;
    generation: number;
    activeId: string | null;
    retiredId: string | null;
    openGapId: string | null;
    lastId: string | null;
    lastAt: number | null;
    failureStreak: number;
    identityReady: boolean;
    candidate: Candidate | undefined;
};
type Batch = {
    work: (control: Control) => Control;
    privateOnly?: boolean;
    publishOnly?: boolean;
    capturedCandidateId?: string;
};
type Cycle = {
    controller: AbortController;
    signal: AbortSignal;
    deadline: number;
    cancel: Cancel;
};
const codeOf = (error: unknown): ErrorCode => fullDisk(error) ? 'capacity'
    : error instanceof SdkError && isErrorCode(error.body.error.code)
        ? error.body.error.code : 'internal';
const fixed = (code: ErrorCode): SdkError => new SdkError(errorBody(code, { detail: 'Roborock collection could not complete.' }));
const retryDelay = (attempts: number): number => Math.min(MAX_BACKOFF_MS, 15000 * 2 ** Math.min(Math.max(0, attempts), 5));
function terminal(status: Status): boolean {
    return activity(status) === 'other'
        && status.stateCode.kind === 'known'
        && (status.stateCode.value === 8 || status.stateCode.value === 100);
}
function matching(run: RunRecord, episode: Episode, now: number): boolean {
    return run.complete.status === 'known' && run.complete.value === 1
        && run.endAtMs.status === 'known'
        && run.endAtMs.value <= now
        && (episode.terminal === undefined || run.endAtMs.value <= episode.terminal.observedAtMs)
        && episode.startAtMs >= run.startAtMs
        && episode.lastObservedAtMs <= run.endAtMs.value;
}
/**
 * One serialized owner of reads and storage.
 *
 * Construction and startlocal use only module-owned storage. Target/session
 * loading happens through identity() at the first actual poll. No login or
 * control commands are available through this class.
 */
export class Collector {
    readonly #context: ModuleContext<RoborockConfig>;
    readonly #store: RoborockStore;
    readonly #outbox: Outbox;
    readonly #transport: CollectorTransport;
    readonly #identity: () => Promise<string>;
    readonly #stopController = new AbortController();
    readonly #onContextAbort: () => void;
    readonly #reservedGeneration: number;
    #control: Control;
    #started = false;
    #stopped = false;
    #halted = false;
    #timer: Cancel | undefined;
    #inflight: Promise<void> | undefined;
    #trailing: Promise<void> | undefined;
    #wirePending = false;
    #delivery: Promise<unknown> | undefined;
    #pending: Batch | undefined;
    #pendingMap: Candidate | undefined;
    #storageBlockedAt: number | undefined;
    #failure: ErrorCode | undefined;
    #reported: ErrorCode | undefined;
    #cycles = 0;
    #identityPending: Promise<string> | undefined;
    #storageFailure: ErrorCode | undefined;
    storageFailure(): ErrorCode | undefined {
        return this.#storageFailure;
    }
    constructor(context: ModuleContext<RoborockConfig>, store: RoborockStore, outbox: Outbox, transport: CollectorTransport, identity: () => Promise<string> = () => transport.identity()) {
        if (context.config === undefined)
            throw fixed('invalid-request');
        this.#context = context;
        this.#store = store;
        this.#outbox = outbox;
        this.#transport = transport;
        this.#identity = identity;
        const bound = store.hasIdentity();
        const checkpoint = bound ? store.loadCheckpoint() : undefined;
        const projection = bound ? store.loadProjection() : undefined;
        if (projection !== undefined && projection.id !== context.config.id) {
            throw fixed('invalid-state');
        }
        const generation = checkpoint?.generation ?? 0;
        if (!Number.isSafeInteger(generation + 1))
            throw fixed('capacity');
        this.#reservedGeneration = generation + 1;
        this.#control = {
            status: projection ?? emptyStatus(context.config.id),
            generation,
            activeId: checkpoint?.activeEpisodeId ?? null,
            retiredId: null,
            openGapId: null,
            lastId: checkpoint?.lastObservationId ?? null,
            lastAt: checkpoint?.lastObservedAtMs ?? null,
            failureStreak: 0,
            identityReady: false,
            candidate: undefined,
        };
        this.#onContextAbort = () => { void this.stop(); };
        context.signal.addEventListener('abort', this.#onContextAbort, { once: true });
        if (context.signal.aborted)
            void this.stop();
    }
    state(): VacuumStatus {
        return structuredClone(this.#control.status);
    }
    generation(): number {
        return this.#control.generation;
    }
    /** Fixed code for module diagnostics/refusals; never raw exception text. */
    failure(): ErrorCode | undefined {
        return this.#failure;
    }
    /**
     * Persist a new local startup revision when a store is already bound.
     * Add no messages and load no secrets. An unbound store starts as unknown.
     */
    startlocal(): void {
        if (this.#started || !this.#alive())
            return;
        this.#started = true;
        const work = this.#startup().catch(error => { this.#report(codeOf(error)); });
        this.#inflight = work.finally(() => {
            this.#inflight = undefined;
            this.#schedule(1);
        });
    }
    /** Ordinary requests join the current cycle. */
    poll(): Promise<void> {
        if (!this.#alive() || this.#halted)
            return Promise.resolve();
        if (!this.#started)
            this.startlocal();
        if (this.#inflight !== undefined)
            return this.#inflight;
        this.#timer?.();
        this.#timer = undefined;
        const work = this.#perform().catch(error => { this.#report(codeOf(error)); });
        this.#inflight = work.finally(() => {
            this.#inflight = undefined;
            this.#schedule();
        });
        return this.#inflight;
    }
    /** Host-held synthetic seam: coalesce one poll after an existing cycle. */
    refreshForTest(): Promise<void> {
        if (!this.#alive() || this.#halted)
            return Promise.resolve();
        if (this.#inflight === undefined)
            return this.poll();
        if (this.#trailing !== undefined)
            return this.#trailing;
        const current = this.#inflight;
        this.#trailing = current.then(() => {
            this.#trailing = undefined;
            return this.#alive() ? this.poll() : undefined;
        }).catch(error => { this.#report(codeOf(error)); });
        return this.#trailing;
    }
    stop(): Promise<void> {
        if (this.#stopped)
            return Promise.resolve();
        this.#stopped = true;
        this.#timer?.();
        this.#timer = undefined;
        this.#stopController.abort();
        this.#context.signal.removeEventListener('abort', this.#onContextAbort);
        try {
            this.#transport.stop();
        }
        catch {
            this.#report('internal');
        }
        return Promise.resolve();
    }
    #alive(): boolean {
        return !this.#stopped && !this.#context.signal.aborted;
    }
    #now(): number {
        const value = this.#context.clock.now();
        if (!Number.isSafeInteger(value) || value < 0)
            throw fixed('invalid-state');
        return value;
    }
    #copy(): Control {
        return structuredClone(this.#control);
    }
    #report(code: ErrorCode): void {
        this.#failure = code;
        if (this.#reported === code)
            return;
        this.#reported = code;
        this.#context.log[code === 'internal' ? 'error' : 'warn']('operation.failed', {
            'bunny.operation': 'status',
            'bunny.code': code,
        });
    }
    #schedule(explicit?: number): void {
        if (!this.#started || !this.#alive() || this.#halted)
            return;
        this.#timer?.();
        const status = this.#control.status;
        const cadence = status.activity === 'cleaning' || status.activity === 'returning'
            ? 15000 : 60000;
        const delay = explicit ?? (this.#pending !== undefined || this.#control.failureStreak > 0
            ? retryDelay(this.#control.failureStreak)
            : this.#store.hasIdentity() && this.#store.hasGapRecoveryWork()
                ? 1
                : Math.max(1, (status.observedAtMs.status === 'known'
                    ? status.observedAtMs.value + cadence : this.#now() + cadence) - this.#now()));
        try {
            this.#timer = this.#context.scheduler.after(delay, () => { void this.poll(); });
        }
        catch {
            if (this.#alive())
                this.#report('internal');
        }
    }
    #cycle(): Cycle {
        const controller = new AbortController();
        const signal = AbortSignal.any([
            controller.signal, this.#stopController.signal, this.#context.signal,
        ]);
        const cancel = this.#context.scheduler.after(CYCLE_MS, () => { controller.abort(); });
        return { controller, signal, deadline: this.#now() + CYCLE_MS, cancel };
    }
    /** Race even a dependency that ignores its signal; discard every late result. */
    #guard<T>(call: (signal: AbortSignal) => Promise<T>, milliseconds: number, parent: AbortSignal = this.#stopController.signal): Promise<Guarded<T>> {
        return new Promise(resolve => {
            const request = new AbortController();
            const signal = AbortSignal.any([
                request.signal, parent, this.#stopController.signal, this.#context.signal,
            ]);
            let settled = false;
            let cancel: Cancel = () => { };
            const finish = (result: Guarded<T>): void => {
                if (settled)
                    return;
                settled = true;
                cancel();
                signal.removeEventListener('abort', aborted);
                resolve(result);
            };
            const aborted = (): void => {
                finish({ ok: false, code: this.#alive() ? 'unavailable' : 'cancelled' });
            };
            signal.addEventListener('abort', aborted, { once: true });
            if (signal.aborted) {
                aborted();
                return;
            }
            try {
                cancel = this.#context.scheduler.after(Math.max(1, milliseconds), () => {
                    request.abort();
                    finish({ ok: false, code: this.#alive() ? 'unavailable' : 'cancelled' });
                });
                void Promise.resolve().then(() => {
                    if (signal.aborted)
                        throw fixed(this.#alive() ? 'unavailable' : 'cancelled');
                    return call(signal);
                }).then(value => { finish({ ok: true, value }); }, error => { finish({ ok: false, code: codeOf(error) }); });
            }
            catch {
                finish({ ok: false, code: this.#alive() ? 'internal' : 'cancelled' });
            }
        });
    }
    #track<T>(promise: Promise<T>): Promise<T> {
        this.#delivery = promise;
        const clear = (): void => {
            if (this.#delivery === promise)
                this.#delivery = undefined;
        };
        void promise.then(clear, clear);
        return promise;
    }
    async #waitDelivery(): Promise<boolean> {
        const pending = this.#delivery;
        if (pending === undefined)
            return true;
        const result = await this.#guard(() => pending, READ_MS);
        return result.ok && this.#delivery === undefined;
    }
    /** A settled refusal permits private work; a hung send pauses admission. */
    async #drain(): Promise<boolean> {
        if (!await this.#waitDelivery())
            return false;
        if (!this.#alive())
            return false;
        const result = await this.#guard(() => this.#track(this.#outbox.republish()), READ_MS);
        if (!result.ok && this.#alive())
            this.#report(result.code);
        return result.ok;
    }
    #addStates(add: AddMessage, status: VacuumStatus, generation: number): void {
        const [vacuum, device] = stateDrafts(status, generation);
        add(`bunny.state.roborock-vacuum.${status.id}`, vacuum);
        add(`bunny.state.device.${status.id}`, device);
    }
    /**
     * The SDK commits SQL synchronously before waiting for publication. Confirm
     * the durable revision after transaction() returns; do not treat a later
     * publication timeout as a rollback or repeat the committed batch.
     */
    async #commit(batch: Batch): Promise<boolean> {
        if (!this.#alive())
            return false;
        this.#pending = batch;
        if (!await this.#waitDelivery())
            return false;
        const publish = batch.privateOnly === true ? false : await this.#drain();
        if (!this.#alive() || this.#delivery !== undefined)
            return false;
        let proposed: Control | undefined;
        const completion = this.#track(this.#outbox.transaction(add => {
            if (!this.#alive())
                throw fixed('cancelled');
            const control = batch.work(this.#copy());
            const counts = this.#store.counts();
            const status: VacuumStatus = {
                ...control.status,
                revision: batch.publishOnly === true
                    ? control.status.revision : control.status.revision + 1,
                collection: {
                    ...control.status.collection,
                    retainedRuns: counts.runs,
                    observedSamples: counts.samples,
                    gaps: counts.gaps,
                },
            };
            control.status = status;
            this.#store.saveCheckpoint({
                generation: control.generation,
                lastObservationId: control.lastId,
                lastObservedAtMs: control.lastAt,
                activeEpisodeId: control.activeId,
            });
            this.#store.saveProjection(status, !publish);
            if (publish)
                this.#addStates(add, status, control.generation);
            proposed = control;
            return control;
        }));
        const candidate = proposed;
        const saved = this.#store.hasIdentity() ? this.#store.loadProjection() : undefined;
        const committed = candidate !== undefined && !this.#store.database.isTransaction
            && saved?.revision === candidate.status.revision
            && JSON.stringify(saved) === JSON.stringify(candidate.status);
        if (committed) {
            this.#storageFailure = undefined;
            this.#pending = undefined;
            // Retire on durable commit, including a replay of the retained batch.
            if (this.#pendingMap?.id === batch.capturedCandidateId)
                this.#pendingMap = undefined;
            if (this.#alive()) {
                this.#control = candidate;
                if (candidate.candidate !== undefined)
                    this.#pendingMap = candidate.candidate;
                this.#control.candidate = undefined;
            }
        }
        const settled = await this.#guard(() => completion, READ_MS);
        if (!committed) {
            if (this.#alive()) {
                const code = settled.ok ? 'internal' : settled.code;
                this.#storageBlockedAt ??= this.#now();
                this.#storageFailure = code;
                this.#report(code);
            }
            return false;
        }
        return true;
    }
    async #startup(): Promise<void> {
        if (!this.#store.hasIdentity() || !this.#alive())
            return;
        const checkpoint = this.#store.loadCheckpoint();
        const at = this.#now();
        const gap: Gap | undefined = checkpoint?.lastObservedAtMs === null
            || checkpoint?.lastObservedAtMs === undefined ? undefined : {
            id: randomUUID(), episodeId: checkpoint.activeEpisodeId,
            startAtMs: Math.min(checkpoint.lastObservedAtMs, at),
            endAtMs: at, reason: 'restart',
        };
        await this.#commit({
            privateOnly: true,
            work: control => {
                if (gap !== undefined)
                    this.#store.appendGap(gap);
                control.generation = this.#reservedGeneration;
                this.#store.beginRecovery(control.generation);
                control.lastId = null;
                control.lastAt = null;
                control.status = { ...control.status, availability: 'unknown', activity: 'unknown' };
                return control;
            },
        });
    }
    async #ensureIdentity(): Promise<boolean> {
        if (this.#control.identityReady)
            return true;
        if (this.#identityPending !== undefined)
            return false;
        const result = await this.#guard(() => {
            const pending = Promise.resolve().then(() => this.#identity());
            this.#identityPending = pending;
            const clear = (): void => {
                if (this.#identityPending === pending)
                    this.#identityPending = undefined;
            };
            void pending.then(clear, clear);
            return pending;
        }, READ_MS);
        if (!result.ok) {
            this.#report(result.code);
            return false;
        }
        if (!this.#alive())
            return false;
        const identity = result.value;
        if (this.#store.hasIdentity()) {
            if (this.#store.identity() !== identity) {
                this.#halted = true;
                this.#report('invalid-state');
                this.#transport.stop();
                return false;
            }
            this.#control.identityReady = true;
            return true;
        }
        return this.#commit({
            privateOnly: true,
            work: control => {
                this.#store.bindIdentity(identity);
                control.generation = this.#reservedGeneration;
                this.#store.beginRecovery(control.generation);
                control.identityReady = true;
                return control;
            },
        });
    }
    async #read<T>(operation: Operation, call: (options: ReadOptions) => Promise<Reading<T>>, cycle: Cycle, requestedRecordId?: number): Promise<Entry<T>> {
        const id = randomUUID();
        const episodeId = randomUUID();
        const gapId = randomUUID();
        const started = this.#now();
        const context = {
            id, operation, observedAtMs: started,
            generation: this.#control.generation,
            normalizationVersion: NORMALIZATION_VERSION,
            ...(requestedRecordId === undefined ? {} : { requestedRecordId }),
        };
        const failure = (code: ErrorCode): Entry<T> => ({
            observation: { ...context, observedAtMs: this.#now(), failureCode: code },
            requestedAt: started, value: undefined, at: this.#now(), ok: false, code, episodeId, gapId,
        });
        if (!this.#alive())
            return failure('cancelled');
        if (cycle.signal.aborted || this.#wirePending)
            return failure('unavailable');
        const result = await this.#guard(signal => {
            this.#wirePending = true;
            let promise: Promise<Reading<T>>;
            try {
                promise = call({ signal, timeoutMs: Math.min(TRANSPORT_READ_MS, Math.max(1, cycle.deadline - started - 1000)) });
            }
            catch (error) {
                this.#wirePending = false;
                throw error;
            }
            const clear = (): void => { this.#wirePending = false; };
            void promise.then(clear, clear);
            return promise;
        }, Math.min(READ_MS, Math.max(1, cycle.deadline - started)), cycle.signal);
        if (!result.ok)
            return failure(result.code);
        const reading = result.value;
        if (!reading.ok) {
            return failure(isErrorCode(reading.error.error.code)
                ? reading.error.error.code : 'internal');
        }
        const received = this.#now();
        const observed = typeof reading.observedAt === 'string'
            ? Date.parse(reading.observedAt) : NaN;
        const validTime = Number.isSafeInteger(observed)
            && observed >= started && observed <= received;
        let value: T;
        try {
            if (operation === 'map') {
                if (!Buffer.isBuffer(reading.value)
                    || reading.value.length < 1
                    || reading.value.length > 2 * 1024 * 1024)
                    return failure('invalid-request');
                value = Buffer.from(reading.value) as T;
            }
            else {
                validateObservationValue(reading.value);
                value = structuredClone(reading.value);
            }
        }
        catch {
            return failure('invalid-request');
        }
        // Invalid injected times refuse projection, while retaining received domain
        // JSON at receipt time. Map bytes go only to the BLOB/capture boundary.
        const at = validTime ? observed : received;
        return {
            observation: {
                ...context,
                observedAtMs: at,
                value: operation === 'map'
                    ? { decodedBytes: (value as Buffer).length } : value,
            },
            requestedAt: started, value, at, ok: validTime,
            code: validTime ? undefined : 'invalid-request',
            episodeId, gapId,
        };
    }
    #applyStatus(control: Control, entry: Entry<VendorJson>): void {
        control.lastId = entry.observation.id;
        control.lastAt = entry.at;
        const normalized = entry.ok && entry.value !== undefined
            ? normalizeStatus(entry.value) : undefined;
        if (normalized === undefined || normalized.layout.kind !== 'known') {
            const code = entry.code ?? 'invalid-request';
            control.status = {
                ...control.status,
                availability: 'unavailable',
                collection: {
                    ...control.status.collection,
                    lastFailure: { status: 'known', value: code },
                },
            };
            control.failureStreak += 1;
            if (control.openGapId === null) {
                this.#store.appendGap({
                    id: entry.gapId,
                    episodeId: control.activeId,
                    startAtMs: control.status.observedAtMs.status === 'known'
                        ? Math.min(control.status.observedAtMs.value, entry.at) : entry.at,
                    endAtMs: null,
                    reason: 'unavailable',
                });
                control.openGapId = entry.gapId;
            }
            return;
        }
        // Poll admission applies to ordinary status reads and map fences alike.
        // A bounded successful response is not a missed request deadline.
        // Unavailable/restart/storage recovery has its own interval evidence.
        if (control.status.availability === 'available' && control.openGapId === null
            && control.status.observedAtMs.status === 'known') {
            const cadence = control.status.activity === 'cleaning' || control.status.activity === 'returning'
                ? 15000 : 60000;
            const expected = control.status.observedAtMs.value + cadence;
            if (entry.requestedAt > expected + 1) {
                this.#store.appendGap({
                    id: entry.gapId, episodeId: control.activeId,
                    startAtMs: expected, endAtMs: entry.at, reason: 'missed-poll',
                });
            }
        }
        this.#store.markSuccessfulStatus(control.generation, entry.at);
        if (control.openGapId !== null) {
            this.#store.closeGap(control.openGapId, entry.at);
            control.openGapId = null;
        }
        control.failureStreak = 0;
        const currentActivity = activity(normalized);
        control.status = {
            ...control.status,
            observedAtMs: { status: 'known', value: entry.at },
            availability: 'available', activity: currentActivity,
            status: projectStatusFields(normalized),
            collection: { ...control.status.collection, lastFailure: UNKNOWN },
        };
        let episode = control.activeId === null
            ? undefined : this.#store.getEpisode(control.activeId);
        const positive = currentActivity === 'cleaning' || currentActivity === 'returning';
        const paused = normalized.stateCode.kind === 'known'
            && normalized.stateCode.value === 10;
        if (positive && (episode === undefined || episode.endAtMs !== null
            || episode.terminal !== undefined || episode.generation !== control.generation)) {
            if (episode !== undefined && episode.endAtMs === null)
                control.retiredId = episode.id;
            episode = {
                id: entry.episodeId, generation: control.generation,
                startAtMs: entry.at, lastObservedAtMs: entry.at,
                startObservationId: entry.observation.id,
                lastObservationId: entry.observation.id,
                endAtMs: null, runId: null,
            };
            this.#store.putEpisode(episode);
            control.activeId = episode.id;
        }
        else if (episode !== undefined && episode.endAtMs === null
            && episode.terminal === undefined && episode.generation === control.generation && (positive || paused)) {
            episode = {
                ...episode, lastObservedAtMs: entry.at,
                lastObservationId: entry.observation.id,
            };
            this.#store.putEpisode(episode);
        }
        if (episode !== undefined && episode.endAtMs === null && episode.terminal === undefined
            && episode.generation === control.generation && terminal(normalized)) {
            episode = { ...episode, terminal: { observationId: entry.observation.id, observedAtMs: entry.at } };
            this.#store.putEpisode(episode);
        }
        if (episode !== undefined && episode.endAtMs === null
            && episode.generation === control.generation
            && (episode.terminal === undefined || episode.terminal.observationId === entry.observation.id)
            && normalized.batteryPercent.kind === 'known') {
            this.#store.appendSample({
                id: entry.observation.id, episodeId: episode.id,
                observedAtMs: entry.at, batteryPercent: normalized.batteryPercent.value,
                runId: null,
            });
        }
    }
    #applyAncillary(control: Control, consumables: Entry<VendorJson> | undefined, summary: Entry<VendorJson> | undefined): void {
        for (const entry of [consumables, summary]) {
            if (entry !== undefined && !entry.ok) {
                control.status.collection.lastFailure = {
                    status: 'known', value: entry.code ?? 'internal',
                };
            }
        }
        if (consumables?.ok === true && consumables.value !== undefined) {
            control.status.consumables = projectConsumables(normalizeConsumables(consumables.value), consumables.at);
        }
        if (summary?.ok === true && summary.value !== undefined) {
            const normalized = normalizeSummary(summary.value);
            control.status.totals = projectTotals(normalized, summary.at);
            if (normalized.recordIds.kind === 'known') {
                this.#store.enqueueRecordIds(normalized.recordIds.value, summary.at);
            }
        }
    }
    #recoverHistorical(control: Control, checkedAt: number): Control {
        let after = this.#store.loadEpisodeRecoveryCursor();
        let page = this.#store.listUnresolvedEpisodes(control.generation, after, 25);
        if (page.length === 0 && after > 0) {
            after = 0;
            page = this.#store.listUnresolvedEpisodes(control.generation, 0, 25);
        }
        for (const { sequence, episode } of page) {
            const candidates = this.#store.findRunsOverlappingEpisode(episode.id, 25);
            if (!candidates.overflow) {
                const matches = candidates.runs.filter(run => matching(run, episode, checkedAt));
                const only = matches.length === 1 ? matches[0] : undefined;
                if (only !== undefined) {
                    const result = this.#store.reconcileHistoricalEpisode(episode.id, only.recordId, control.generation, checkedAt);
                    if (result.resolved) {
                        if (control.activeId === episode.id)
                            control.activeId = null;
                        if (control.retiredId === episode.id)
                            control.retiredId = null;
                    }
                }
            }
            // Advance even for missing records, conflicts, or ambiguous candidates.
            after = sequence;
        }
        this.#store.saveEpisodeRecoveryCursor(after);
        return control;
    }
    async #perform(): Promise<void> {
        if (!this.#alive() || this.#halted)
            return;
        if (this.#pending !== undefined) {
            const pending = this.#pending;
            if (!await this.#commit(pending))
                return;
            if (this.#storageBlockedAt !== undefined && this.#alive()) {
                const start = this.#storageBlockedAt;
                const end = this.#now();
                const id = randomUUID();
                this.#storageBlockedAt = undefined;
                await this.#commit({
                    work: control => {
                        this.#store.appendGap({
                            id, episodeId: control.activeId,
                            startAtMs: Math.min(start, end), endAtMs: end, reason: 'storage',
                        });
                        control.status.availability = 'unknown';
                        return control;
                    },
                });
            }
            return;
        }
        if (!await this.#waitDelivery() || this.#wirePending)
            return;
        if (!await this.#ensureIdentity() || !this.#alive())
            return;
        if (this.#store.needsPublication() && this.#cycles > 0 && await this.#drain()) {
            await this.#commit({ publishOnly: true, work: control => control });
            return;
        }
        if (this.#delivery !== undefined)
            return;
        if (this.#store.hasGapRecoveryWork()) {
            await this.#commit({
                work: control => {
                    this.#store.recoverOpenGaps(100);
                    return control;
                },
            });
            return;
        }
        const cycle = this.#cycle();
        try {
            if (this.#pendingMap !== undefined) {
                await this.#capture(this.#pendingMap, cycle);
                return;
            }
            const status = await this.#read('status', options => this.#transport.readStatus(options), cycle);
            if (!this.#alive())
                return;
            const normalized = status.ok && status.value !== undefined
                ? normalizeStatus(status.value) : undefined;
            const ending = normalized !== undefined && terminal(normalized)
                && this.#control.activeId !== null;
            const ancillary = this.#cycles === 0 || this.#cycles % 10 === 0;
            const consumables = ancillary
                ? await this.#read('consumables', options => this.#transport.readConsumables(options), cycle)
                : undefined;
            const summary = ancillary || ending
                ? await this.#read('summary', options => this.#transport.readCleanSummary(options), cycle)
                : undefined;
            const rooms = ancillary
                ? await this.#read('rooms', options => this.#transport.readRoomMapping(options), cycle)
                : undefined;
            if (!this.#alive())
                return;
            const observations = [status, consumables, summary, rooms]
                .filter((entry): entry is Entry<VendorJson> => entry !== undefined);
            if (!await this.#commit({
                work: control => {
                    for (const entry of observations)
                        this.#store.appendObservation(entry.observation);
                    this.#applyStatus(control, status);
                    this.#store.recoverOpenGaps(100);
                    this.#applyAncillary(control, consumables, summary);
                    return control;
                },
            }))
                return;
            this.#cycles += 1;
            if (!this.#alive() || this.#delivery !== undefined || cycle.signal.aborted)
                return;
            const due = this.#store.listReconciliation(this.#now(), RECORD_BATCH);
            const queue = new Map<number, QueueItem>();
            if (ending && summary?.ok === true && summary.value !== undefined
                && this.#control.activeId !== null) {
                const episode = this.#store.getEpisode(this.#control.activeId);
                const ids = normalizeSummary(summary.value).recordIds;
                if (episode !== undefined && ids.kind === 'known') {
                    const newest = ids.value.filter(id => id * 1000 <= episode.startAtMs)
                        .sort((a, b) => b - a)[0];
                    const candidate = newest === undefined ? undefined : this.#store.getReconciliation(newest);
                    if (candidate !== undefined && candidate.nextAttemptAtMs <= this.#now()) {
                        queue.set(candidate.recordId, candidate);
                    }
                }
            }
            for (const item of due) {
                if (queue.size >= RECORD_BATCH)
                    break;
                queue.set(item.recordId, item);
            }
            const entries: {
                item: QueueItem;
                entry: Entry<VendorJson>;
                run: RunRecord | undefined;
            }[] = [];
            for (const item of queue.values()) {
                if (!this.#alive() || cycle.signal.aborted)
                    break;
                const entry = await this.#read('record', options => this.#transport.readCleanRecord(item.recordId, options), cycle, item.recordId);
                const run = entry.ok && entry.value !== undefined
                    ? projectRun(normalizeRecord(entry.value, item.recordId), entry.at) : undefined;
                entries.push({ item, entry, run });
            }
            if (!this.#alive())
                return;
            const checkedAt = this.#now();
            const terminalAt = ending ? status.at : undefined;
            const candidateId = randomUUID();
            if (entries.length > 0) {
                if (!await this.#commit({
                    work: control => {
                        for (const { item, entry, run } of entries) {
                            this.#store.appendObservation(entry.observation);
                            if (run !== undefined) {
                                this.#store.putRun(run);
                                this.#store.completeReconciliation(item.recordId);
                            }
                            else {
                                this.#store.failReconciliation(item.recordId, entry.code ?? 'invalid-request', checkedAt + retryDelay(item.attempts + 1));
                            }
                        }
                        const accepted = entries.flatMap(item => {
                            if (item.run === undefined)
                                return [];
                            const canonical = this.#store.getRun(item.run.recordId);
                            return canonical === undefined ? [] : [canonical];
                        });
                        for (const episodeId of [...new Set([control.activeId, control.retiredId])]) {
                            if (episodeId === null || terminalAt === undefined)
                                continue;
                            const episode = this.#store.getEpisode(episodeId);
                            if (episode === undefined || episode.endAtMs !== null
                                || episode.generation !== control.generation
                                || episode.terminal?.observationId !== status.observation.id)
                                continue;
                            const matches = accepted.filter(run => matching(run, episode, checkedAt));
                            const run = matches.length === 1 ? matches[0] : undefined;
                            if (run === undefined || run.endAtMs.status !== 'known'
                                || run.endAtMs.value > terminalAt
                                || this.#store.runWindowConflicts(run.recordId))
                                continue;
                            this.#store.putEpisode({ ...episode, endAtMs: run.endAtMs.value });
                            const association = this.#store.attachEpisode({
                                episodeId,
                                recordId: run.recordId,
                                startAtMs: run.startAtMs,
                                endAtMs: run.endAtMs.value,
                                externallyValidated: true,
                            });
                            if (control.activeId === episodeId)
                                control.activeId = null;
                            if (control.retiredId === episodeId)
                                control.retiredId = null;
                            control.candidate = {
                                id: candidateId,
                                run,
                                terminalAt,
                                generation: control.generation,
                                gaps: this.#store.counts().gaps,
                                reasons: association.attached ? [] : ['ambiguous-window'],
                            };
                        }
                        return control;
                    },
                }))
                    return;
            }
            if (this.#alive()
                && this.#store.hasHistoricalEpisodes(this.#control.generation)) {
                const recoveryAt = this.#now();
                if (!await this.#commit({
                    work: control => this.#recoverHistorical(control, recoveryAt),
                }))
                    return;
            }
            // The matching run transaction has committed before any current-map read.
            if (this.#pendingMap !== undefined && this.#alive()
                && this.#delivery === undefined && !cycle.signal.aborted) {
                await this.#capture(this.#pendingMap, cycle);
            }
        }
        finally {
            cycle.cancel();
            cycle.controller.abort();
        }
    }
    async #capture(candidate: Candidate, cycle: Cycle): Promise<void> {
        const reasons = new Set<MapReason>(candidate.reasons);
        const late = this.#now() - candidate.terminalAt > MAP_WINDOW_MS
            || cycle.signal.aborted || candidate.generation !== this.#control.generation;
        if (late) {
            reasons.add('late');
            reasons.add('capture-failed');
        }
        const preStatus = late ? undefined : await this.#read('status', options => this.#transport.readStatus(options), cycle);
        const preSummary = late ? undefined : await this.#read('summary', options => this.#transport.readCleanSummary(options), cycle);
        const requestAt = this.#now();
        const map = late ? undefined : await this.#read('map', options => this.#transport.readCurrentMap(options), cycle);
        const responseAt = this.#now();
        const postStatus = late ? undefined : await this.#read('status', options => this.#transport.readStatus(options), cycle);
        const postSummary = late ? undefined : await this.#read('summary', options => this.#transport.readCleanSummary(options), cycle);
        if (!this.#alive())
            return;
        const summaries = [preSummary, postSummary].map(entry => entry?.ok === true && entry.value !== undefined ? normalizeSummary(entry.value).recordIds : undefined);
        for (const entry of [preStatus, postStatus]) {
            if (entry?.ok !== true || entry.value === undefined) {
                reasons.add('ambiguous-window');
            }
            else {
                const state = normalizeStatus(entry.value);
                const observedActivity = activity(state);
                if (observedActivity === 'cleaning' || observedActivity === 'returning')
                    reasons.add('newer-run');
                else if (!terminal(state))
                    reasons.add('ambiguous-window');
            }
        }
        for (const ids of summaries) {
            if (ids?.kind !== 'known')
                reasons.add('ambiguous-window');
            else if (ids.value.some(id => id > candidate.run.recordId))
                reasons.add('newer-run');
        }
        if (summaries[0]?.kind === 'known' && summaries[1]?.kind === 'known') {
            const before = [...summaries[0].value].sort((a, b) => a - b);
            const after = [...summaries[1].value].sort((a, b) => a - b);
            if (JSON.stringify(before) !== JSON.stringify(after))
                reasons.add('ambiguous-window');
        }
        if (responseAt - candidate.terminalAt > MAP_WINDOW_MS)
            reasons.add('late');
        const bytes = map?.value;
        if (map?.ok !== true || bytes === undefined)
            reasons.add('capture-failed');
        if (bytes !== undefined && bytes.length < 0x14)
            reasons.add('ambiguous-window');
        const entries = [preStatus, preSummary, postStatus, postSummary]
            .filter((entry): entry is Entry<VendorJson> => entry !== undefined);
        const mapObservation: Observation = map?.observation ?? {
            id: randomUUID(), operation: 'map', observedAtMs: responseAt,
            generation: candidate.generation, failureCode: 'unavailable',
        };
        const capture: MapCapture = {
            id: candidate.id, candidateRunId: candidate.run.recordId,
            requestAtMs: requestAt, responseAtMs: responseAt,
            generation: candidate.generation,
            preObservationIds: [preStatus, preSummary].flatMap(entry => entry === undefined ? [] : [entry.observation.id]),
            postObservationIds: [postStatus, postSummary].flatMap(entry => entry === undefined ? [] : [entry.observation.id]),
            mapIndex: bytes !== undefined && bytes.length >= 0x14 ? bytes.readUInt32LE(0x0c) : null,
            mapSequence: bytes !== undefined && bytes.length >= 0x14 ? bytes.readUInt32LE(0x10) : null,
            association: 'unverified',
            reasons: [],
        };
        await this.#commit({
            capturedCandidateId: candidate.id,
            work: control => {
                for (const entry of entries)
                    this.#store.appendObservation(entry.observation);
                this.#store.appendObservation(mapObservation);
                for (const entry of [preStatus, postStatus]) {
                    if (entry !== undefined)
                        this.#applyStatus(control, entry);
                }
                this.#applyAncillary(control, undefined, postSummary);
                if (this.#store.counts().gaps !== candidate.gaps)
                    reasons.add('gap');
                capture.reasons = reasons.size === 0 ? ['candidate-window'] : [...reasons];
                this.#store.saveMapCapture(capture, bytes);
                const run = this.#store.getRun(candidate.run.recordId);
                if (run === undefined)
                    throw fixed('invalid-state');
                this.#store.putRun({
                    ...run,
                    // Map evidence has its own capture times. Do not refresh record fields.
                    observedAtMs: run.observedAtMs,
                    map: {
                        availability: bytes === undefined ? 'missing' : 'unverified',
                        reason: bytes === undefined ? 'capture-failed'
                            : capture.reasons.length === 1 && capture.reasons[0] === 'candidate-window'
                                ? 'candidate-window' : 'ambiguous-window',
                    },
                });
                return control;
            },
        });
    }
}
