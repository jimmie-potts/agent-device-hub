import { normalizeRecord } from '../src/normalize.js';
import { projectRun } from '../src/projection.js';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { errorBody, type Message, } from '@jimmie-potts/event-contracts/v2';
import { InProcessBus, Outbox, SdkError, openModuleDatabaseFile, type LogFields, type ModuleContext, type Scheduler, } from '@jimmie-potts/sdk';
import { checkModuleRecord, type HarnessRecord } from '@jimmie-potts/sdk/testing';
import type { Reading, ReadOptions, VendorJson, } from '@jimmie-potts/roborock-transport';
import { Collector, type CollectorTransport } from '../src/collector.js';
import type { RoborockConfig } from '../src/configuration.js';
import { RoborockStore } from '../src/store.js';
import { roborockValidator, validateStatus } from '../src/families.js';
import { reader } from '../transport/src/transport/reader.js';
const BEGIN = 1700000000;
const START = BEGIN * 1000;
const flush = async (): Promise<void> => {
    for (let count = 0; count < 8; count += 1) {
        await new Promise<void>(resolve => { setImmediate(resolve); });
    }
};
function manualClock() {
    let now = START;
    let sequence = 0;
    const timers = new Map<number, {
        at: number;
        callback: () => void;
    }>();
    const scheduler: Scheduler = {
        after: (delay, callback) => {
            const id = sequence++;
            timers.set(id, { at: now + delay, callback });
            return () => { timers.delete(id); };
        },
    };
    return {
        now: () => now,
        jump: (milliseconds: number): void => { now += milliseconds; },
        scheduler,
        advance: async (milliseconds: number): Promise<void> => {
            const end = now + milliseconds;
            for (;;) {
                await flush();
                const due = [...timers.entries()]
                    .filter(([, timer]) => timer.at <= end)
                    .sort((a, b) => a[1].at !== b[1].at ? a[1].at - b[1].at : a[0] - b[0])[0];
                if (due === undefined)
                    break;
                timers.delete(due[0]);
                now = due[1].at;
                due[1].callback();
            }
            now = end;
            await flush();
        },
    };
}
function deferred<T>() {
    let resolve: (value: T) => void = () => { };
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}
class FakeTransport implements CollectorTransport {
    status: VendorJson = { state: 8, battery: 90, in_cleaning: 0, in_returning: 0 };
    summary: VendorJson = { clean_time: 0, clean_area: 0, clean_count: 0, records: [] };
    consumables: VendorJson = { strainer_work_times: 7, cleaning_brush_work_times: 3 };
    rooms: VendorJson = [[16, 'Synthetic private room']];
    records = new Map<number, VendorJson>();
    bytes = Buffer.alloc(0x14);
    calls: string[] = [];
    identities = 0;
    stopped = false;
    active = 0;
    maximumActive = 0;
    statusHook: ((options?: ReadOptions) => Promise<Reading<VendorJson>>) | undefined;
    constructor(readonly now: () => number) {
        this.bytes.writeUInt32LE(7, 0x0c);
        this.bytes.writeUInt32LE(9, 0x10);
    }
    identity(): Promise<string> {
        this.identities += 1;
        return Promise.resolve('synthetic-a97');
    }
    async #invoke<T>(operation: string, call: () => Reading<T> | Promise<Reading<T>>): Promise<Reading<T>> {
        this.calls.push(operation);
        this.active += 1;
        this.maximumActive = Math.max(this.maximumActive, this.active);
        try {
            if (this.stopped)
                return { ok: false, error: errorBody('cancelled') };
            return await call();
        }
        finally {
            this.active -= 1;
        }
    }
    #success<T>(value: T): Reading<T> {
        return { ok: true, value: structuredClone(value), observedAt: new Date(this.now()).toISOString() };
    }
    readStatus(options?: ReadOptions): Promise<Reading<VendorJson>> {
        return this.#invoke('status', async () => this.statusHook === undefined
            ? this.#success(this.status) : this.statusHook(options));
    }
    readConsumables(): Promise<Reading<VendorJson>> {
        return this.#invoke('consumables', () => this.#success(this.consumables));
    }
    readCleanSummary(): Promise<Reading<VendorJson>> {
        return this.#invoke('summary', () => this.#success(this.summary));
    }
    readCleanRecord(id: number): Promise<Reading<VendorJson>> {
        return this.#invoke(`record:${String(id)}`, () => {
            const value = this.records.get(id);
            return value === undefined
                ? { ok: false, error: errorBody('unavailable', { detail: 'synthetic private vendor body' }) }
                : this.#success(value);
        });
    }
    readRoomMapping(): Promise<Reading<VendorJson>> {
        return this.#invoke('rooms', () => this.#success(this.rooms));
    }
    readCurrentMap(_options?: ReadOptions): Promise<Reading<Buffer>> {
        return this.#invoke('map', () => ({
            ok: true, value: Buffer.from(this.bytes),
            observedAt: new Date(this.now()).toISOString(),
        }));
    }
    stop(): void {
        this.stopped = true;
    }
}
async function world(context: TestContext) {
    const dir = await mkdtemp(join(tmpdir(), 'rr-collector-'));
    await chmod(dir, 0o700);
    const file = join(dir, 'module.sqlite');
    const database = openModuleDatabaseFile(file);
    await chmod(file, 0o600);
    const clock = manualClock();
    const transport = new FakeTransport(clock.now);
    const store = new RoborockStore(database);
    const bus = new InProcessBus({ now: clock.now, scheduler: clock.scheduler });
    const participant = bus.connect('bunny/modules/roborock');
    const publication: {
        refuse: boolean;
        messages: Message<object>[];
        holdAfterRun?: Promise<void>;
    } = { refuse: false, messages: [] };
    const sdk: typeof participant = {
        ...participant,
        publishMessage: async (key, message) => {
            if (publication.holdAfterRun !== undefined && store.getRun(BEGIN) !== undefined)
                await publication.holdAfterRun;
            if (publication.refuse)
                throw new SdkError(errorBody('unavailable'));
            publication.messages.push(message);
            return participant.publishMessage(key, message);
        },
    };
    const controller = new AbortController();
    const logs: unknown[] = [];
    const diagnostics: HarnessRecord[] = [];
    const log = {
        debug: () => { }, info: () => { },
        warn: (event: string, fields: LogFields = {}) => { logs.push(fields); diagnostics.push({ level: 'warn', event, fields }); },
        error: (event: string, fields: LogFields = {}) => { logs.push(fields); diagnostics.push({ level: 'error', event, fields }); },
    };
    const moduleContext = {
        sdk, clock: { now: clock.now }, scheduler: clock.scheduler,
        signal: controller.signal, config: { id: 'vacuum' }, log,
        secrets: { read: () => Promise.reject(new Error('unexpected secret access')) },
        database: () => database,
    } as unknown as ModuleContext<RoborockConfig>;
    const outbox = new Outbox({
        sdk, database, clock: { now: clock.now },
        validator: roborockValidator(), onError: () => { },
    });
    const collector = new Collector(moduleContext, store, outbox, transport);
    context.after(async () => {
        await collector.stop();
        database.close();
        await participant.close();
        await rm(dir, { recursive: true, force: true });
    });
    return { collector, store, database, clock, transport, publication, controller, logs, diagnostics, outbox };
}
for (const code of ['capacity', 'internal', 'invalid-state'] as const) {
    void test(`collector ${code} failures produce admissible module diagnostics`, async (context) => {
        const w = await world(context);
        w.collector.startlocal();
        await w.clock.advance(1);
        w.store.saveProjection = () => { throw new SdkError(errorBody(code)); };
        await w.collector.poll();
        assert.equal(w.collector.storageFailure(), code);
        const record = w.diagnostics.find(item => item.event === 'operation.failed');
        assert.ok(record !== undefined);
        assert.equal(record.fields['bunny.code'], code);
        assert.equal(record.level, code === 'internal' ? 'error' : 'warn');
        assert.equal(checkModuleRecord('roborock', record), undefined);
    });
}
void test('local start is inert, first cycle retains private originals and publishes exact records', async (context) => {
    const w = await world(context);
    w.collector.startlocal();
    await flush();
    assert.equal(w.transport.identities, 0);
    assert.deepEqual(w.transport.calls, []);
    assert.equal(w.collector.state().availability, 'unknown');
    await w.clock.advance(1);
    assert.equal(w.transport.identities, 1);
    assert.deepEqual(w.transport.calls, ['status', 'consumables', 'summary', 'rooms']);
    const state = w.collector.state();
    assert.equal(validateStatus(state), true);
    assert.equal(state.availability, 'available');
    assert.deepEqual(state.consumables.strainerCycles, { status: 'known', value: 7 });
    assert.equal(w.store.counts().observations, 4);
    assert.equal(JSON.stringify(state).includes('Synthetic private room'), false);
    const rows = w.database.prepare("SELECT data FROM rr_observations WHERE operation='rooms'").all();
    assert.equal(String(rows[0]?.data).includes('Synthetic private room'), true);
    const latest = w.publication.messages.slice(-2);
    assert.equal(latest.length, 2);
    const vacuum = latest[0], device = latest[1];
    assert.ok(vacuum !== undefined && device !== undefined);
    assert.equal((vacuum.data as {
        revision: number;
    }).revision, state.revision);
    assert.equal((device.data as {
        revision: number;
    }).revision, state.revision);
    assert.equal(w.store.loadCheckpoint()?.generation, w.collector.generation());
    assert.equal(w.transport.maximumActive, 1);
});
void test('cadence follows observed activity and never overlaps transport reads', async (context) => {
    const w = await world(context);
    w.collector.startlocal();
    await w.clock.advance(1);
    const initial = w.transport.calls.filter(call => call === 'status').length;
    await w.clock.advance(59999);
    assert.equal(w.transport.calls.filter(call => call === 'status').length, initial);
    w.transport.status = { state: 5, battery: 85, in_cleaning: 1, in_returning: 0 };
    await w.clock.advance(1);
    const active = w.transport.calls.filter(call => call === 'status').length;
    await w.clock.advance(14999);
    assert.equal(w.transport.calls.filter(call => call === 'status').length, active);
    await w.clock.advance(1);
    assert.equal(w.transport.calls.filter(call => call === 'status').length, active + 1);
    assert.equal(w.transport.maximumActive, 1);
});
for (const cleaning of [true, false]) {
    void test(`slow serialized reads retain the missed ${cleaning ? 'active' : 'idle'} poll deadline`, async (context) => {
        const w = await world(context);
        if (cleaning) w.transport.status = { state: 5, battery: 85, in_cleaning: 1, in_returning: 0 };
        const wait = () => new Promise<void>(resolve => { w.clock.scheduler.after(9000, resolve); });
        for (const method of ['readConsumables', 'readCleanSummary', 'readRoomMapping'] as const) {
            const original = w.transport[method].bind(w.transport);
            w.transport[method] = async () => { await wait(); return original(); };
        }
        if (!cleaning) {
            const ids = Array.from({ length: 4 }, (_, index) => BEGIN - 1000 - index * 100);
            w.transport.summary = { records: ids };
            for (const id of ids) w.transport.records.set(id, { begin: id, end: id + 30, complete: 1 });
            const original = w.transport.readCleanRecord.bind(w.transport);
            w.transport.readCleanRecord = async id => { await wait(); return original(id); };
        }
        w.collector.startlocal();
        await w.clock.advance(cleaning ? 27002 : 63002);
        const gaps = w.database.prepare('SELECT data FROM rr_gaps ORDER BY seq').all()
            .map(row => JSON.parse(String(row.data)) as { startAtMs: number; endAtMs: number; reason: string });
        assert.deepEqual(gaps.map(gap => ({ startAtMs: gap.startAtMs, endAtMs: gap.endAtMs, reason: gap.reason })), [{
            startAtMs: START + 1 + (cleaning ? 15000 : 60000),
            endAtMs: START + (cleaning ? 27002 : 63002), reason: 'missed-poll',
        }]);
        assert.equal(w.transport.maximumActive, 1);
        assert.equal(w.collector.state().availability, 'available');
        assert.equal(w.store.counts().samples, cleaning ? 2 : 0);
    });
}
void test('synthetic refresh follows an existing cycle with one new poll', async (context) => {
    const w = await world(context);
    w.collector.startlocal();
    await w.clock.advance(1);
    const held = deferred<Reading<VendorJson>>();
    const old: VendorJson = structuredClone(w.transport.status);
    let once = true;
    w.transport.statusHook = async () => {
        if (once) {
            once = false;
            return held.promise;
        }
        return {
            ok: true, value: w.transport.status,
            observedAt: new Date(w.clock.now()).toISOString(),
        };
    };
    const running = w.collector.poll();
    await flush();
    w.transport.status = { state: 5, battery: 80, in_cleaning: 1, in_returning: 0 };
    const first = w.collector.refreshForTest();
    const second = w.collector.refreshForTest();
    held.resolve({ ok: true, value: old, observedAt: new Date(w.clock.now()).toISOString() });
    await Promise.all([running, first, second]);
    assert.equal(w.collector.state().activity, 'cleaning');
    assert.equal(w.transport.maximumActive, 1);
});
void test('storage retry preserves previous projection and reuses a batch without new reads', async (context) => {
    const w = await world(context);
    w.collector.startlocal();
    await w.clock.advance(1);
    const before = w.collector.state();
    const original = w.store.saveProjection.bind(w.store);
    let failing = true;
    w.store.saveProjection = (status, needed) => {
        if (failing)
            throw Object.assign(new Error('synthetic private storage detail'), { errcode: 13 });
        original(status, needed);
    };
    w.transport.status = { state: 5, battery: 80, in_cleaning: 1, in_returning: 0 };
    await w.collector.poll();
    const calls = w.transport.calls.length;
    assert.deepEqual(w.collector.state(), before);
    assert.equal(w.collector.failure(), 'capacity');
    assert.equal(w.collector.storageFailure(), 'capacity');
    await w.collector.poll();
    assert.equal(w.transport.calls.length, calls);
    failing = false;
    await w.collector.poll();
    assert.equal(w.transport.calls.length, calls);
    assert.equal(w.collector.state().activity, 'cleaning');
    assert.equal(w.collector.storageFailure(), undefined);
    assert.equal(w.collector.failure(), 'capacity');
    assert.equal(w.store.counts().samples, 1);
    const ids = w.database.prepare('SELECT id FROM rr_observations').all().map(row => row.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(JSON.stringify(w.logs).includes('synthetic private storage detail'), false);
});
void test('publication refusal bounds queued states and recovers latest projection without recollection', async (context) => {
    const w = await world(context);
    w.publication.refuse = true;
    w.collector.startlocal();
    await w.clock.advance(1);
    for (let count = 0; count < 3; count += 1)
        await w.collector.poll();
    const pending = w.database.prepare('SELECT COUNT(*) AS n FROM bunny_outbox').get();
    assert.equal(pending?.n, 2);
    assert.equal(w.store.needsPublication(), true);
    const committedRevision = w.collector.state().revision;
    const calls = w.transport.calls.length;
    const originals = w.store.counts().observations;
    w.publication.refuse = false;
    await w.collector.poll();
    assert.equal(w.transport.calls.length, calls);
    assert.equal(w.store.counts().observations, originals);
    assert.equal(w.store.needsPublication(), false);
    assert.equal(w.collector.state().revision, committedRevision);
    assert.equal(w.database.prepare('SELECT COUNT(*) AS n FROM bunny_outbox').get()?.n, 0);
    const published = w.publication.messages.at(-1);
    assert.ok(published !== undefined);
    assert.equal((published.data as {
        revision: number;
    }).revision, committedRevision);
});
void test('supported record end commits before candidate map and keeps association unverified', async (context) => {
    const w = await world(context);
    w.transport.status = { state: 5, battery: 90, in_cleaning: 1, in_returning: 0 };
    w.collector.startlocal();
    await w.clock.advance(1);
    await w.clock.advance(15000);
    w.transport.status = { state: 8, battery: 80, in_cleaning: 0, in_returning: 0 };
    w.transport.summary = { clean_time: 30, clean_area: 12000000, clean_count: 1, records: [BEGIN] };
    w.transport.records.set(BEGIN, {
        begin: BEGIN, end: BEGIN + 30, duration: 25,
        area: 12000000, cleaned_area: 13000000, complete: 1, error: 0,
    });
    // End must not be after the successful terminal observation.
    const beforeMap = w.transport.readCurrentMap.bind(w.transport);
    w.transport.readCurrentMap = async (options) => {
        assert.ok(w.store.getRun(BEGIN) !== undefined, 'record already committed');
        return beforeMap(options);
    };
    await w.clock.advance(15000);
    const captures = w.store.listMapCaptures(BEGIN);
    assert.equal(captures.length, 1);
    const stored = captures[0];
    assert.ok(stored !== undefined);
    const capture = stored.capture;
    assert.equal(capture.association, 'unverified');
    assert.equal(capture.mapIndex, 7);
    assert.equal(capture.mapSequence, 9);
    assert.ok(capture.blobHash !== null);
    assert.deepEqual(w.store.readMapBlob(capture.blobHash), w.transport.bytes);
    assert.equal(w.store.getRun(BEGIN)?.battery.availability, 'partial');
    assert.equal(w.collector.state().collection.maps, 'unverified');
});
void test('map storage retry commits retained bytes once and resumes later polls', async (context) => {
    const w = await world(context);
    w.transport.status = { state: 5, battery: 90, in_cleaning: 1, in_returning: 0 };
    w.collector.startlocal();
    await w.clock.advance(1);
    await w.clock.advance(15000);
    w.transport.status = { state: 8, battery: 80, in_cleaning: 0, in_returning: 0 };
    w.transport.summary = { records: [BEGIN] };
    w.transport.records.set(BEGIN, { begin: BEGIN, end: BEGIN + 30, complete: 1, duration: 25 });
    const save = w.store.saveMapCapture.bind(w.store);
    let full = true;
    w.store.saveMapCapture = (...args) => {
        if (full) throw Object.assign(new Error('synthetic disk full'), { errcode: 13 });
        return save(...args);
    };
    await w.clock.advance(15000);
    assert.equal(w.collector.storageFailure(), 'capacity');
    assert.equal(w.transport.calls.filter(call => call === 'map').length, 1);
    full = false;
    await w.collector.poll();
    assert.equal(w.collector.storageFailure(), undefined);
    assert.equal(w.store.counts().mapCaptures, 1);
    const before = w.collector.state().revision;
    for (let count = 0; count < 3; count += 1) await w.collector.poll();
    assert.equal(w.collector.storageFailure(), undefined);
    assert.ok(w.collector.state().revision > before);
    assert.equal(w.transport.calls.filter(call => call === 'map').length, 1);
    assert.equal(w.store.counts().mapCaptures, 1);
});
void test('startup historical records and pauses do not fetch historical maps or infer completion', async (context) => {
    const w = await world(context);
    w.transport.summary = { records: [BEGIN - 100] };
    w.transport.records.set(BEGIN - 100, {
        begin: BEGIN - 100, end: BEGIN - 50, duration: 40, complete: 1, area: 10,
    });
    w.collector.startlocal();
    await w.clock.advance(1);
    assert.ok(w.store.getRun(BEGIN - 100) !== undefined);
    assert.equal(w.transport.calls.includes('map'), false);
    w.transport.status = { state: 5, battery: 80, in_cleaning: 1, in_returning: 0 };
    await w.collector.poll();
    w.transport.status = { state: 10, battery: 79, in_cleaning: 0, in_returning: 0 };
    await w.collector.poll();
    const active = w.store.loadCheckpoint()?.activeEpisodeId;
    assert.ok(active !== null && active !== undefined);
    assert.equal(w.store.getEpisode(active)?.endAtMs, null);
    assert.equal(w.transport.calls.includes('map'), false);
});
void test('delayed records reconcile distinct observed runs without capturing an old map', async (context) => {
    const w = await world(context);
    const cleaning = (battery: number) => { w.transport.status = { state: 5, battery, in_cleaning: 1, in_returning: 0 }; };
    const docked = (battery: number) => { w.transport.status = { state: 8, battery, in_cleaning: 0, in_returning: 0 }; };
    cleaning(90);
    w.collector.startlocal();
    await w.clock.advance(1);
    const first = required(w.store.loadCheckpoint()?.activeEpisodeId);
    w.clock.jump(19999);
    docked(85);
    await w.collector.poll();
    assert.equal(w.store.getEpisode(first)?.endAtMs, null);
    assert.equal(w.store.getEpisode(first)?.runId, null);
    assert.equal(w.store.counts().runs, 0);
    w.clock.jump(20000);
    cleaning(80);
    await w.collector.poll();
    assert.equal(w.store.counts().episodes, 2);
    assert.equal(w.store.getEpisode(first)?.endAtMs, null);
    w.clock.jump(20000);
    docked(75);
    w.transport.summary = { records: [BEGIN, BEGIN + 35] };
    w.transport.records.set(BEGIN, { begin: BEGIN, end: BEGIN + 15, complete: 1 });
    w.transport.records.set(BEGIN + 35, { begin: BEGIN + 35, end: BEGIN + 55, complete: 1 });
    await w.collector.poll();
    for (const id of [BEGIN, BEGIN + 35]) {
        assert.equal(w.store.listSamples(id).samples.length, 1);
        assert.equal(w.store.getRun(id)?.battery.availability, 'partial');
    }
    assert.equal(w.store.listMapCaptures(BEGIN).length, 0);
    assert.equal(w.store.listMapCaptures(BEGIN + 35).length, 1);
    w.clock.jump(20000);
    cleaning(70);
    await w.collector.poll();
    assert.equal(w.store.counts().episodes, 3);
    w.clock.jump(20000);
    docked(65);
    w.transport.summary = { records: [BEGIN + 75, BEGIN + 35, BEGIN] };
    w.transport.records.set(BEGIN + 75, { begin: BEGIN + 75, end: BEGIN + 95, complete: 1 });
    await w.collector.poll();
    assert.equal(w.store.listSamples(BEGIN + 75).samples.length, 1);
    assert.equal(w.store.listMapCaptures(BEGIN + 75).length, 1);
    assert.equal(w.collector.storageFailure(), undefined);
    assert.equal(w.store.counts().samples, 6);
});
void test('multiple delayed completed records recover during a newer active run without maps', async (context) => {
    const w = await world(context);
    w.transport.status = { state: 5, battery: 90, in_cleaning: 1, in_returning: 0 };
    w.collector.startlocal();
    await w.clock.advance(1);
    for (const [at, state, battery] of [[20, 8, 85], [40, 5, 80], [60, 8, 75]] as const) {
        w.clock.jump(START + at * 1000 - w.clock.now());
        w.transport.status = { state, battery, in_cleaning: state === 5 ? 1 : 0, in_returning: 0 };
        w.transport.summary = { records: at === 20 ? [BEGIN] : [BEGIN, BEGIN + 35] };
        await w.collector.poll();
    }
    assert.equal(w.store.counts().episodes, 2);
    assert.equal(w.store.counts().runs, 0);
    w.transport.records.set(BEGIN, { begin: BEGIN, end: BEGIN + 15, complete: 1 });
    w.transport.records.set(BEGIN + 35, { begin: BEGIN + 35, end: BEGIN + 55, complete: 1 });
    w.transport.status = { state: 5, battery: 70, in_cleaning: 1, in_returning: 0 };
    for (const at of [100, 130]) {
        w.clock.jump(START + at * 1000 - w.clock.now());
        await w.collector.poll();
    }
    assert.equal(w.store.counts().episodes, 3);
    for (const id of [BEGIN, BEGIN + 35]) assert.equal(w.store.listSamples(id).samples.length, 1);
    assert.equal(w.transport.calls.filter(call => call === 'map').length, 0);
    const active = required(w.store.loadCheckpoint()?.activeEpisodeId);
    assert.equal(w.store.getEpisode(active)?.endAtMs, null);
    assert.equal(w.store.getEpisode(active)?.runId, null);
});
void test('deadline and stop retire late reads without another overlapping call or late commit', async (context) => {
    const w = await world(context);
    const held = deferred<Reading<VendorJson>>();
    w.transport.statusHook = async () => held.promise;
    w.collector.startlocal();
    await w.clock.advance(1);
    await w.clock.advance(10000);
    assert.equal(w.transport.calls.filter(call => call === 'status').length, 1);
    const afterDeadline = w.collector.state();
    await w.collector.poll();
    assert.equal(w.transport.calls.filter(call => call === 'status').length, 1);
    await w.collector.stop();
    held.resolve({
        ok: true, value: { state: 5, battery: 1, in_cleaning: 1 },
        observedAt: new Date(w.clock.now()).toISOString(),
    });
    await flush();
    assert.deepEqual(w.collector.state(), afterDeadline);
    assert.equal(w.transport.maximumActive, 1);
    assert.equal(w.transport.stopped, true);
});
void test('collector preserves real reader timeout and recovery diagnostics', async (context) => {
    const w = await world(context);
    const events: string[] = [];
    const config = {
        schemaVersion: 1 as const, deviceId: 'synthetic-a97', address: '192.168.10.20',
        broker: 'mqtts://mqtt-us.roborock.com:8883', region: 'us' as const,
    };
    const session = {
        schemaVersion: 1 as const, deviceId: config.deviceId, model: 'roborock.vacuum.a97' as const,
        protocol: '1.0' as const, localKey: '0123456789abcdef', broker: config.broker,
        rriot: { u: 'synthetic-user', s: 'sentinel-auth-secret', k: 'sentinel-auth-key' },
    };
    let silent = true;
    const wire = () => silent ? new Promise<never>(() => { }) : Promise.resolve({
        kind: 'json' as const, value: { state: 8, battery: 90, in_cleaning: 0, in_returning: 0 },
    });
    const record = (event: string): void => { events.push(event); };
    const owner = reader(config, session, {
        clock: { now: w.clock.now }, scheduler: w.clock.scheduler,
        local: wire, mqtt: wire, log: { debug: record, info: record, warn: record, error: record },
    });
    context.after(() => { owner.stop(); });
    w.transport.readStatus = options => owner.readStatus(options);
    w.collector.startlocal();
    await w.clock.advance(10001);
    assert.equal(w.collector.state().availability, 'unavailable');
    assert.deepEqual(events, ['device.unavailable']);
    silent = false;
    await w.collector.poll();
    assert.equal(w.collector.state().availability, 'available');
    assert.deepEqual(events, ['device.unavailable', 'device.available']);
});
function required<T>(value: T | null | undefined): T {
    assert.ok(value !== undefined && value !== null);
    return value;
}
void test('older episodes beyond the first page reconcile without historical maps', async (context) => {
    const w = await world(context);
    await w.outbox.transaction(() => {
        w.store.bindIdentity('synthetic-a97');
        for (let index = 0; index < 31; index += 1) {
            const recordId = BEGIN - 4000 + index * 100;
            const at = recordId * 1000 + 1000;
            const sourceId = `historical-status-${String(index)}`;
            w.store.appendObservation({
                id: sourceId, operation: 'status', generation: 0, observedAtMs: at,
                value: { state: 5, battery: 80, in_cleaning: 1, in_returning: 0 },
            });
            w.store.putEpisode({
                id: `historical-episode-${String(index)}`,
                generation: 0, startAtMs: at, lastObservedAtMs: at,
                startObservationId: sourceId, lastObservationId: sourceId,
                endAtMs: null, runId: null,
            });
            if (index >= 25) {
                const run = required(projectRun(normalizeRecord({
                    begin: recordId, end: recordId + 60, duration: 50, complete: 1,
                }, recordId), START));
                w.store.putRun(run);
            }
        }
    });
    w.collector.startlocal();
    await w.clock.advance(1);
    assert.equal(w.store.getEpisode('historical-episode-30')?.endAtMs, null);
    await w.collector.poll();
    assert.equal(w.store.getEpisode('historical-episode-30')?.endAtMs, (BEGIN - 940) * 1000);
    assert.equal(w.store.getEpisode('historical-episode-0')?.endAtMs, null);
    assert.equal(w.transport.calls.includes('map'), false);
    assert.equal(w.store.counts().observations, 31 + w.transport.calls.length);
});
void test('more than 100 old unavailable gaps drain locally at the first successful status time', async (context) => {
    const w = await world(context);
    await w.outbox.transaction(() => {
        w.store.bindIdentity('synthetic-a97');
        for (let index = 0; index < 241; index += 1) {
            w.store.appendGap({
                id: `prior-process-${String(index)}`,
                episodeId: null, startAtMs: START - 1000 + index,
                endAtMs: null, reason: 'unavailable',
            });
        }
    });
    w.collector.startlocal();
    await w.clock.advance(1);
    const recoveryAt = START + 1;
    const calls = w.transport.calls.length;
    assert.equal(w.store.listOpenUnavailableGaps(0, 241).length, 100);
    await w.clock.advance(4);
    assert.deepEqual(w.store.listOpenUnavailableGaps(0, 241), []);
    assert.equal(w.transport.calls.length, calls);
    assert.equal(w.store.getGap('prior-process-240')?.endAtMs, recoveryAt);
    assert.equal(w.database.prepare('SELECT COUNT(*) AS n FROM rr_gap_versions').get()?.n, 482);
    assert.equal(w.collector.state().observedAtMs.status, 'known');
});
void test('malformed status layouts retain originals and open an unavailable gap', async (context) => {
    const w = await world(context);
    w.collector.startlocal();
    await w.clock.advance(1);
    const before = w.collector.state().observedAtMs;
    w.transport.status = ['Synthetic original'];
    await w.collector.poll();
    assert.equal(w.collector.state().availability, 'unavailable');
    assert.deepEqual(w.collector.state().observedAtMs, before);
    assert.equal(w.store.listOpenUnavailableGaps(0, Number.MAX_SAFE_INTEGER).length, 1);
    const raw = w.database.prepare("SELECT data FROM rr_observations WHERE operation='status' ORDER BY seq DESC LIMIT 1").get();
    assert.equal(String(raw?.data).includes('Synthetic original'), true);
    w.transport.status = { state: 8, battery: 80, in_cleaning: 0, in_returning: 0 };
    await w.collector.poll();
    assert.deepEqual(w.store.listOpenUnavailableGaps(0, Number.MAX_SAFE_INTEGER), []);
    assert.equal(w.collector.storageFailure(), undefined);
});
void test('non-JSON injected success becomes a fixed failure without blocking storage recovery', async (context) => {
    const w = await world(context);
    w.transport.statusHook = () => Promise.resolve({
        ok: true,
        value: undefined as unknown as VendorJson,
        observedAt: new Date(w.clock.now()).toISOString(),
    });
    w.collector.startlocal();
    await w.clock.advance(1);
    assert.equal(w.collector.state().availability, 'unavailable');
    assert.equal(w.collector.storageFailure(), undefined);
    const raw = w.database.prepare("SELECT data FROM rr_observations WHERE operation='status' ORDER BY seq DESC LIMIT 1").get();
    assert.equal((JSON.parse(String(raw?.data)) as {
        failureCode: string;
    }).failureCode, 'invalid-request');
    w.transport.statusHook = undefined;
    await w.collector.poll();
    assert.equal(w.collector.state().availability, 'available');
    assert.equal(w.collector.storageFailure(), undefined);
});
void test('identity timeout admits one outstanding dependency and stop prevents late binding', async (context) => {
    const w = await world(context);
    const held = deferred<string>();
    w.transport.identity = () => {
        w.transport.identities += 1;
        return held.promise;
    };
    w.collector.startlocal();
    await w.clock.advance(1);
    await w.clock.advance(10000);
    for (let count = 0; count < 3; count += 1)
        await w.collector.poll();
    assert.equal(w.transport.identities, 1);
    assert.equal(w.store.hasIdentity(), false);
    assert.deepEqual(w.transport.calls, []);
    await w.collector.stop();
    held.resolve('synthetic-a97');
    await flush();
    assert.equal(w.store.hasIdentity(), false);
    assert.deepEqual(w.transport.calls, []);
});
async function activeRun(w: Awaited<ReturnType<typeof world>>): Promise<void> {
    w.transport.status = { state: 5, battery: 90, in_cleaning: 1, in_returning: 0 };
    w.collector.startlocal();
    await w.clock.advance(1);
    await w.clock.advance(15000);
    w.transport.status = { state: 8, battery: 80, in_cleaning: 0, in_returning: 0 };
    w.transport.summary = { records: [BEGIN] };
    w.transport.records.set(BEGIN, { begin: BEGIN, end: BEGIN + 30, complete: 1, duration: 25 });
}
void test('failed candidate map retains capture provenance without a BLOB or verified coverage', async (context) => {
    const w = await world(context);
    await activeRun(w);
    w.transport.readCurrentMap = () => Promise.resolve({ ok: false, error: errorBody('unavailable') });
    await w.clock.advance(15000);
    const capture = required(w.store.listMapCaptures(BEGIN)[0]).capture;
    assert.equal(capture.blobHash, null);
    assert.ok(capture.reasons.includes('capture-failed'));
    assert.equal(capture.association, 'unverified');
    assert.equal(w.store.getRun(BEGIN)?.map.availability, 'missing');
});
void test('new activity during map capture keeps original bytes and refuses attribution', async (context) => {
    const w = await world(context);
    await activeRun(w);
    const readMap = w.transport.readCurrentMap.bind(w.transport);
    w.transport.readCurrentMap = options => {
        w.transport.status = { state: 5, battery: 78, in_cleaning: 1, in_returning: 0 };
        return readMap(options);
    };
    await w.clock.advance(15000);
    const capture = required(w.store.listMapCaptures(BEGIN)[0]).capture;
    assert.ok(capture.reasons.includes('newer-run'));
    assert.equal(capture.association, 'unverified');
    assert.deepEqual(w.store.readMapBlob(required(capture.blobHash)), w.transport.bytes);
    assert.equal(w.store.getRun(BEGIN)?.map.reason, 'ambiguous-window');
});
void test('successful map-capture status reads expose missed battery intervals for a newer run', async (context) => {
    const w = await world(context);
    await activeRun(w);
    w.transport.records.set(BEGIN, { begin: BEGIN, end: BEGIN + 29, complete: 1 });
    const record = w.transport.readCleanRecord.bind(w.transport);
    let newerRun = false;
    w.transport.readCleanRecord = async id => {
        const result = await record(id);
        w.transport.status = { state: 5, battery: 78, in_cleaning: 1, in_returning: 0 };
        newerRun = true;
        return result;
    };
    const summary = w.transport.readCleanSummary.bind(w.transport);
    let delaySummary = true;
    w.transport.readCleanSummary = async () => {
        if (newerRun && delaySummary) {
            delaySummary = false;
            w.clock.jump(8000);
        }
        return summary();
    };
    const map = w.transport.readCurrentMap.bind(w.transport);
    w.transport.readCurrentMap = options => { w.clock.jump(8000); return map(options); };
    let newerStatuses = 0;
    w.transport.statusHook = () => {
        if (newerRun && ++newerStatuses === 2) w.clock.jump(8000);
        return Promise.resolve({ ok: true, value: w.transport.status, observedAt: new Date(w.clock.now()).toISOString() });
    };
    w.clock.jump(15000);
    await w.collector.poll();
    assert.equal(w.clock.now(), START + 54001);
    const capture = required(w.store.listMapCaptures(BEGIN)[0]).capture;
    assert.ok(capture.reasons.includes('newer-run'));
    assert.equal(capture.association, 'unverified');
    w.transport.readCleanRecord = record;
    w.transport.readCleanSummary = summary;
    w.transport.readCurrentMap = map;
    w.transport.statusHook = undefined;
    w.clock.jump(6000);
    await w.collector.poll();
    w.transport.status = { state: 8, battery: 76, in_cleaning: 0, in_returning: 0 };
    w.transport.summary = { records: [BEGIN, BEGIN + 30] };
    w.transport.records.set(BEGIN + 30, { begin: BEGIN + 30, end: BEGIN + 65, complete: 1 });
    w.clock.jump(9000);
    await w.collector.poll();
    const page = w.store.listSamples(BEGIN + 30);
    assert.deepEqual(page.gaps, [{
        startAtMs: START + 45001, endAtMs: { status: 'known', value: START + 54001 }, reason: 'missed-poll',
    }]);
    // The archive retains the post-status sample. Existing conservative gap
    // eligibility excludes its boundary, but later evidence remains plottable.
    assert.equal(w.database.prepare('SELECT COUNT(*) AS n FROM rr_samples WHERE observed_at_ms=?').get(START + 54001)?.n, 1);
    assert.deepEqual(page.samples.map(sample => sample.observedAtMs), [START + 30001, START + 60001]);
    assert.equal(page.next, null);
    assert.ok(capture.reasons.includes('gap'));
    assert.equal(w.collector.state().availability, 'available');
    assert.equal(w.collector.storageFailure(), undefined);
});
void test('an unavailable post-map observation records a gap and preserves unverified bytes', async (context) => {
    const w = await world(context);
    await activeRun(w);
    const readMap = w.transport.readCurrentMap.bind(w.transport);
    w.transport.readCurrentMap = options => {
        w.transport.statusHook = () => Promise.resolve({ ok: false, error: errorBody('unavailable') });
        return readMap(options);
    };
    await w.clock.advance(15000);
    const capture = required(w.store.listMapCaptures(BEGIN)[0]).capture;
    assert.ok(capture.reasons.includes('gap'));
    assert.ok(capture.reasons.includes('ambiguous-window'));
    assert.equal(capture.association, 'unverified');
    assert.deepEqual(w.store.readMapBlob(required(capture.blobHash)), w.transport.bytes);
});
void test('hung publication pauses capture admission and late candidate never reads a current map', async (context) => {
    const w = await world(context);
    await activeRun(w);
    const held = deferred<void>();
    w.publication.holdAfterRun = held.promise;
    await w.clock.advance(15000);
    await w.clock.advance(90000);
    assert.ok(w.store.getRun(BEGIN) !== undefined, 'matching record committed despite unfinished publication');
    assert.equal(w.transport.calls.includes('map'), false);
    const calls = w.transport.calls.length;
    await w.clock.advance(10000);
    assert.equal(w.transport.calls.length, calls, 'unsettled publisher admits no new device work');
    delete w.publication.holdAfterRun;
    held.resolve();
    await flush();
    await w.collector.poll();
    const capture = required(w.store.listMapCaptures(BEGIN)[0]).capture;
    assert.ok(capture.reasons.includes('late'));
    assert.ok(capture.reasons.includes('capture-failed'));
    assert.equal(capture.blobHash, null);
    assert.equal(capture.association, 'unverified');
    assert.equal(w.transport.calls.includes('map'), false);
});
