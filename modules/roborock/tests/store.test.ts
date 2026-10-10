import assert from 'node:assert/strict';
import { chmod, copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { InProcessBus, Outbox, SdkError, fullDisk, openModuleDatabaseFile } from '@jimmie-potts/sdk';
import { emptyStatus, type RunRecord } from '../src/contracts.js';
import { RoborockStore, type Observation, type Episode, type MapCapture } from '../src/store.js';
const ID = 1700000000, AT = ID * 1000;
function present<T>(value: T | undefined | null): T { assert.ok(value !== undefined && value !== null); return value; }
const known = (value: number) => ({ status: 'known', value }) as const;
const unknown = { status: 'unknown' } as const;
function record(id = ID): RunRecord { return { recordId: id, observedAtMs: AT + 100000, startAtMs: id * 1000, endAtMs: known((id + 60) * 1000), durationSeconds: known(40), areaMm2: known(12000000), cleanedAreaMm2: unknown, errorCode: known(-1), complete: known(1), startType: unknown, cleanType: unknown, finishReason: known(999), avoidCount: unknown, washCount: unknown, battery: { availability: 'missing', samples: 0, clock: 'unqualified' }, map: { availability: 'missing', reason: 'not-observed' } }; }
const observation = (id: string, at = AT, battery = 80): Extract<Observation, {
    value: unknown;
}> => ({ id, operation: 'status', observedAtMs: at, generation: 1, value: { state: 5, battery, owner_note: 'Synthetic private room' } });
const episode = (id: string, obs: string, at = AT): Episode => ({ id, generation: 1, startAtMs: at, lastObservedAtMs: at, startObservationId: obs, lastObservationId: obs, endAtMs: null, runId: null });
const refusal = (code: string) => (e: unknown) => e instanceof SdkError && e.body.error.code === code;
async function world(t: TestContext) { const dir = await mkdtemp(join(tmpdir(), 'rr-store-')); const file = join(dir, 'module.sqlite'); const databases: ReturnType<typeof openModuleDatabaseFile>[] = []; t.after(async () => { for (const d of databases)
    if (d.isOpen)
        d.close(); await rm(dir, { recursive: true, force: true }); }); return { file, start: async () => { const database = openModuleDatabaseFile(file); databases.push(database); const store = new RoborockStore(database); const outbox = new Outbox({ sdk: new InProcessBus().connect('bunny/modules/roborock'), database, clock: { now: () => AT } }); await outbox.transaction(() => { store.bindIdentity('synthetic-a97'); }); return { database, store, outbox }; } }; }
void test('archive originals, conflicts and canonical history survive restart and partial updates', async (t) => { const w = await world(t), a = await w.start(); const rooms: Observation = { id: 'rooms', operation: 'rooms', observedAtMs: AT, generation: 1, value: [[16, 'Synthetic private room']] }; const conflict: Observation = { id: 'conflict', operation: 'record', requestedRecordId: ID, observedAtMs: AT, generation: 1, value: { begin: ID + 99, owner_note: 'Synthetic conflict' } }; await a.outbox.transaction(() => { a.store.appendObservation(rooms); a.store.appendObservation(conflict); a.store.putRun(record()); a.store.saveProjection({ ...emptyStatus('vacuum'), revision: 1 }, true); }); a.database.close(); const b = await w.start(); assert.deepEqual(b.store.getObservation('rooms')?.value, rooms.value); assert.deepEqual(b.store.getObservation('conflict')?.value, conflict.value); assert.equal(b.store.getRun(ID + 99), undefined); assert.equal(b.store.needsPublication(), true); await b.outbox.transaction(() => { assert.equal(b.store.appendObservation(rooms), false); b.store.putRun({ ...record(), observedAtMs: AT + 200000, durationSeconds: unknown, endAtMs: unknown }); }); assert.deepEqual(b.store.getRun(ID)?.durationSeconds, known(40)); assert.deepEqual(b.store.getRun(ID)?.endAtMs, known(AT + 60000)); assert.equal(b.store.counts().runs, 1); await assert.rejects(b.outbox.transaction(() => { b.store.putRun({ ...record(), startAtMs: AT + 99 }); }), refusal('invalid-request')); });
void test('identity, stable ID conflicts and mutation ownership refuse without erasing evidence', async (t) => { const { store, outbox } = await (await world(t)).start(); const o = observation('one'); await outbox.transaction(() => { store.appendObservation(o); }); await assert.rejects(outbox.transaction(() => { store.bindIdentity('other'); }), refusal('invalid-state')); await assert.rejects(outbox.transaction(() => { store.appendObservation({ ...observation('one'), value: { state: 8 } }); }), refusal('invalid-state')); assert.deepEqual(store.getObservation('one')?.value, o.value); assert.throws(() => store.putRun(record()), refusal('invalid-state')); });
void test('all summary IDs queue, bounded retries and subset/empty summaries retain history', async (t) => { const w = await world(t), a = await w.start(), ids = Array.from({ length: 30 }, (_, i) => ID + i * 100); await a.outbox.transaction(() => { assert.deepEqual(a.store.enqueueRecordIds([...ids, present(ids[0]), -1, 1.5], AT), { added: 30, invalid: 2 }); }); assert.equal(a.store.listReconciliation(AT).length, 25); await a.outbox.transaction(() => { for (const q of a.store.listReconciliation(AT)) {
    a.store.putRun(record(q.recordId));
    a.store.completeReconciliation(q.recordId);
} a.store.failReconciliation(present(ids[25]), 'unavailable', AT + 5000); }); assert.equal(a.store.listReconciliation(AT).length, 4); a.database.close(); const b = await w.start(); assert.equal(b.store.listReconciliation(AT + 5000).find(q => q.recordId === ids[25])?.attempts, 1); await b.outbox.transaction(() => { b.store.enqueueRecordIds([present(ids[0]), ID + 50000], AT + 10000); b.store.enqueueRecordIds([], AT + 10001); }); assert.equal(b.store.counts().runs, 25); assert.equal(b.store.counts().queuedRecords, 7); assert.throws(() => b.store.listReconciliation(AT, 26), refusal('invalid-request')); });
void test('interrupted Outbox callback atomically restores originals, projection and publication flag', async (t) => { const { store, outbox } = await (await world(t)).start(), before = { ...emptyStatus('vacuum'), revision: 1 }; await outbox.transaction(() => { store.appendObservation(observation('before')); store.saveProjection(before, true); }); await assert.rejects(outbox.transaction(() => { store.appendObservation(observation('rollback')); store.putRun(record()); store.saveProjection({ ...before, revision: 2 }, false); throw Error('Synthetic interruption'); }), /Synthetic interruption/u); assert.deepEqual(store.loadProjection(), before); assert.equal(store.needsPublication(), true); assert.equal(store.getObservation('rollback'), undefined); assert.equal(store.getRun(ID), undefined); await outbox.transaction(() => { store.appendObservation(observation('rollback')); store.putRun(record()); store.saveProjection({ ...before, revision: 2 }, false); }); assert.equal(store.counts().observations, 2); });
function samples(store: RoborockStore) { store.putRun(record()); for (const [id, time] of [['s1', AT + 1000], ['s2', AT + 2000], ['s3', AT + 3000]] as const) {
    store.appendObservation(observation(id, time));
    if (id === 's1')
        store.putEpisode(episode('ep', id, time));
    store.appendSample({ id, episodeId: 'ep', observedAtMs: time, batteryPercent: 80, runId: null });
} store.putEpisode({ ...present(store.getEpisode('ep')), lastObservationId: 's3', lastObservedAtMs: AT + 3000, endAtMs: AT + 60000 }); }
void test('compatible unique episode attaches only observed samples outside known gaps', async (t) => { const { store, outbox } = await (await world(t)).start(); await outbox.transaction(() => { samples(store); store.appendGap({ id: 'gap', episodeId: 'ep', startAtMs: AT + 1900, endAtMs: AT + 2100, reason: 'missed-poll' }); assert.deepEqual(store.attachEpisode({ episodeId: 'ep', recordId: ID, startAtMs: AT, endAtMs: AT + 60000, externallyValidated: true }), { attached: true, samples: 2 }); }); assert.deepEqual(store.listSamples(ID).samples.map(s => s.observationId), ['s1', 's3']); assert.equal(store.getSample('s2')?.runId, null); assert.equal(store.counts().samples, 3); });
void test('overlap leaves observations unattached and stable page cursors exclude later membership', async (t) => { const { store, outbox } = await (await world(t)).start(); await outbox.transaction(() => { samples(store); store.putRun(record(ID + 10)); assert.deepEqual(store.attachEpisode({ episodeId: 'ep', recordId: ID, startAtMs: AT, endAtMs: AT + 60000, externallyValidated: true }), { attached: false, samples: 0 }); for (let i = 2; i < 30; i++)
    store.putRun(record(ID + i * 100)); }); assert.equal(store.listSamples(ID).samples.length, 0); const page = store.listRuns(); assert.equal(page.items.length, 25); assert.ok(page.next !== null); await outbox.transaction(() => { store.putRun(record(ID + 50000)); }); assert.equal(store.listRuns(present(page.next)).items.length, 5); assert.equal(store.listRuns(present(page.next)).items.some(r => r.recordId === ID + 50000), false); });
void test('map bytes deduplicate, candidates remain unverified and failure provenance survives restart', async (t) => { const w = await world(t), a = await w.start(), bytes = Buffer.from('Synthetic decoded map'); const capture: MapCapture = { id: 'map1', candidateRunId: ID, requestAtMs: AT + 100, responseAtMs: AT + 200, generation: 1, preObservationIds: ['pre'], postObservationIds: ['post'], mapIndex: 7, mapSequence: 9, association: 'unverified', reasons: ['candidate-window'] }; let hash = ''; await a.outbox.transaction(() => { a.store.putRun(record()); a.store.appendObservation(observation('pre')); a.store.appendObservation(observation('post', AT + 300)); hash = present(a.store.saveMapCapture(capture, bytes)); a.store.saveMapCapture({ ...capture, id: 'map2' }, bytes); a.store.appendMapReason('map1', AT + 400, 'gap'); }); assert.equal(a.store.counts().mapBlobs, 1); a.database.close(); const b = await w.start(); assert.deepEqual(b.store.readMapBlob(hash), bytes); assert.equal(b.store.getMapCapture('map1')?.association, 'unverified'); assert.deepEqual(b.store.getMapCapture('map1')?.reasons, ['candidate-window', 'gap']); assert.equal(b.store.listMapCaptures(ID).length, 2); await assert.rejects(b.outbox.transaction(() => { b.store.saveMapCapture({ ...capture, id: 'bad', association: 'verified' } as unknown as MapCapture, bytes); }), refusal('invalid-request')); });
void test('checkpoint and open restart gaps retain evidence without fabricating samples', async (t) => { const w = await world(t), a = await w.start(); await a.outbox.transaction(() => { a.store.appendObservation(observation('checkpoint')); a.store.putEpisode(episode('unfinished', 'checkpoint')); a.store.saveCheckpoint({ generation: 1, lastObservationId: 'checkpoint', lastObservedAtMs: AT, activeEpisodeId: 'unfinished' }); a.store.appendGap({ id: 'restart', episodeId: 'unfinished', startAtMs: AT + 1000, endAtMs: null, reason: 'restart' }); }); a.database.close(); const b = await w.start(); assert.equal(b.store.loadCheckpoint()?.activeEpisodeId, 'unfinished'); assert.equal(b.store.getEpisode('unfinished')?.endAtMs, null); assert.equal(b.store.counts().samples, 0); await b.outbox.transaction(() => { b.store.closeGap('restart', AT + 5000); }); assert.equal(b.store.getGap('restart')?.endAtMs, AT + 5000); });
void test('real SQLite full-disk rollback preserves the committed snapshot and observation ID', async (t) => {
    const { database, store, outbox } = await (await world(t)).start();
    const before = { ...emptyStatus('vacuum'), revision: 1 };
    await outbox.transaction(() => { store.appendObservation(observation('durable')); store.saveProjection(before, true); });
    database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const pages = database.prepare('PRAGMA page_count').get() as {
        page_count: number;
    };
    database.exec(`PRAGMA max_page_count=${String(pages.page_count)}`);
    let failure: unknown;
    try {
        await outbox.transaction(() => { store.appendObservation(observation('retry')); store.saveProjection({ ...before, revision: 2 }, false); store.saveMapCapture({ id: 'full-map', candidateRunId: null, requestAtMs: AT, responseAtMs: AT, generation: 1, preObservationIds: [], postObservationIds: [], mapIndex: null, mapSequence: null, association: 'unverified', reasons: ['candidate-window'] }, Buffer.alloc(512 * 1024, 7)); });
    }
    catch (error) {
        failure = error;
    }
    assert.equal(fullDisk(failure), true);
    assert.deepEqual(store.loadProjection(), before);
    assert.equal(store.needsPublication(), true);
    assert.equal(store.getObservation('retry'), undefined);
    database.exec('PRAGMA max_page_count=1073741823');
    await outbox.transaction(() => { store.appendObservation(observation('retry')); store.saveProjection({ ...before, revision: 2 }, false); });
    assert.equal(store.counts().observations, 2);
});
void test('exclusive SQLite ownership refuses another connection; closed private backup restores originals', async (t) => {
    const w = await world(t), a = await w.start();
    await a.outbox.transaction(() => { a.store.appendObservation(observation('original')); a.store.putRun(record()); });
    assert.throws(() => openModuleDatabaseFile(w.file), (e: unknown) => typeof e === 'object' && e !== null && 'errcode' in e && typeof e.errcode === 'number' && (e.errcode & 255) === 5);
    a.database.close();
    const backup = join(w.file + '-backup');
    await copyFile(w.file, backup);
    await chmod(backup, 0o600);
    const restored = openModuleDatabaseFile(backup);
    t.after(() => { if (restored.isOpen)
        restored.close(); });
    const store = new RoborockStore(restored);
    assert.equal(store.identity(), 'synthetic-a97');
    assert.deepEqual(store.getObservation('original')?.value, observation('original').value);
    assert.equal(store.getRun(ID)?.recordId, ID);
});
void test('archive accepts shared JSON leaves while rejecting cycles and accessors without invoking them', async (t) => {
    const { store, outbox } = await (await world(t)).start(), shared = { status: 'unknown' }, cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    let read = false;
    const accessors = Object.defineProperty({}, 'private', { enumerable: true, get() { read = true; return 'Synthetic'; } });
    await outbox.transaction(() => { store.appendObservation({ ...observation('dag'), value: { a: shared, b: shared } }); });
    for (const [id, value] of [['cycle', cycle], ['accessor', accessors]] as const)
        await assert.rejects(outbox.transaction(() => { store.appendObservation({ ...observation(id), value }); }), refusal('invalid-request'));
    assert.equal(read, false);
    assert.equal(store.counts().observations, 1);
});
void test('known fields retain their own evidence time through partial and out-of-order records', async (t) => {
    const { database, store, outbox } = await (await world(t)).start();
    await outbox.transaction(() => { store.putRun({ ...record(), observedAtMs: AT + 1000, durationSeconds: known(40), map: { availability: 'unverified', reason: 'candidate-window' } }); store.putRun({ ...record(), observedAtMs: AT + 3000, durationSeconds: unknown, endAtMs: unknown }); store.putRun({ ...record(), observedAtMs: AT + 2000, durationSeconds: known(45), washCount: known(2), endAtMs: unknown }); });
    assert.deepEqual(store.getRun(ID)?.durationSeconds, known(45));
    assert.deepEqual(store.getRun(ID)?.washCount, known(2));
    assert.deepEqual(store.getRun(ID)?.endAtMs, known(AT + 60000));
    assert.equal(store.getRun(ID)?.observedAtMs, AT + 3000);
    assert.equal(store.getRun(ID)?.map.availability, 'unverified');
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM rr_run_versions').get()?.n, 3);
});
void test('late contradictory windows retire public samples but preserve private links and versions', async (t) => {
    const { database, store, outbox } = await (await world(t)).start();
    await outbox.transaction(() => { samples(store); store.attachEpisode({ episodeId: 'ep', recordId: ID, startAtMs: AT, endAtMs: AT + 60000, externallyValidated: true }); });
    assert.equal(store.getSample('s1')?.runId, ID);
    assert.equal(store.getRun(ID)?.battery.samples, 3);
    await outbox.transaction(() => { store.putRun({ ...record(), observedAtMs: AT + 200000, endAtMs: known(AT + 30000) }); });
    assert.equal(store.getSample('s1')?.runId, null);
    assert.equal(store.listSamples(ID).samples.length, 0);
    assert.equal(store.counts().unattachedSamples, 3);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM rr_sample_links').get()?.n, 3);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM rr_run_versions').get()?.n, 2);
});
void test('later overlap or gap retires sample eligibility without deleting original observations', async (t) => {
    const { store, outbox } = await (await world(t)).start();
    await outbox.transaction(() => { samples(store); store.attachEpisode({ episodeId: 'ep', recordId: ID, startAtMs: AT, endAtMs: AT + 60000, externallyValidated: true }); store.appendGap({ id: 'late-gap', episodeId: 'ep', startAtMs: AT + 900, endAtMs: AT + 1100, reason: 'missed-poll' }); });
    assert.equal(store.getSample('s1')?.runId, null);
    assert.equal(store.getRun(ID)?.battery.samples, 2);
    await outbox.transaction(() => { store.putRun(record(ID + 10)); });
    assert.equal(store.getSample('s2')?.runId, null);
    assert.equal(store.getRun(ID)?.battery.samples, 0);
    assert.equal(store.counts().samples, 3);
    assert.equal(store.counts().unattachedSamples, 3);
});
void test('recovery cursor skips ambiguous episodes, wraps, and survives restart', async (t) => {
    const w = await world(t);
    const a = await w.start();
    await a.outbox.transaction(() => {
        for (let index = 0; index < 31; index += 1) {
            const id = ID + index * 100;
            const at = id * 1000 + 1000;
            const observationId = `old-status-${String(index)}`;
            a.store.appendObservation(observation(observationId, at));
            a.store.putEpisode(episode(`old-episode-${String(index)}`, observationId, at));
        }
        a.store.beginRecovery(2);
    });
    const first = a.store.listUnresolvedEpisodes(2, 0);
    assert.equal(first.length, 25);
    await a.outbox.transaction(() => {
        a.store.saveEpisodeRecoveryCursor(present(first.at(-1)).sequence);
    });
    a.database.close();
    const b = await w.start();
    const second = b.store.listUnresolvedEpisodes(2, b.store.loadEpisodeRecoveryCursor());
    assert.equal(second.length, 6);
    await b.outbox.transaction(() => {
        for (const item of second) {
            const id = Math.floor(item.episode.startAtMs / 1000) - 1;
            b.store.putRun(record(id));
            const result = b.store.reconcileHistoricalEpisode(item.episode.id, id, 2, AT + 4000000);
            assert.equal(result.resolved, true);
            b.store.saveEpisodeRecoveryCursor(item.sequence);
        }
    });
    assert.equal(b.store.getEpisode('old-episode-0')?.endAtMs, null);
    assert.equal(b.store.getEpisode('old-episode-30')?.endAtMs, (ID + 3060) * 1000);
    const after = b.store.loadEpisodeRecoveryCursor();
    assert.deepEqual(b.store.listUnresolvedEpisodes(2, after), []);
    await b.outbox.transaction(() => {
        b.store.saveEpisodeRecoveryCursor(0);
        b.store.putRun(record(ID));
        assert.equal(b.store.reconcileHistoricalEpisode('old-episode-0', ID, 2, AT + 4000000).resolved, true);
    });
    assert.equal(b.store.getEpisode('old-episode-0')?.endAtMs, AT + 60000);
    assert.equal(b.store.counts().mapCaptures, 0);
});
void test('open-gap recovery pages retain the first recovery time across restart', async (t) => {
    const w = await world(t);
    const a = await w.start();
    await a.outbox.transaction(() => {
        for (let index = 0; index < 241; index += 1) {
            a.store.appendGap({
                id: `old-unavailable-${String(index)}`,
                episodeId: null,
                startAtMs: AT + index,
                endAtMs: null,
                reason: 'unavailable',
            });
        }
        a.store.beginRecovery(2);
        a.store.markSuccessfulStatus(2, AT + 1000);
        assert.deepEqual(a.store.recoverOpenGaps(), { closed: 100, incompatible: 0 });
    });
    assert.equal(a.store.listOpenUnavailableGaps(0, 241).length, 100);
    a.database.close();
    const b = await w.start();
    await b.outbox.transaction(() => {
        b.store.beginRecovery(3);
        b.store.markSuccessfulStatus(3, AT + 9000);
        assert.deepEqual(b.store.recoverOpenGaps(), { closed: 100, incompatible: 0 });
    });
    await b.outbox.transaction(() => {
        assert.deepEqual(b.store.recoverOpenGaps(), { closed: 41, incompatible: 0 });
    });
    assert.deepEqual(b.store.listOpenUnavailableGaps(0, 241), []);
    assert.equal(b.store.getGap('old-unavailable-240')?.endAtMs, AT + 1000);
    assert.equal(b.database.prepare('SELECT COUNT(*) AS n FROM rr_gap_versions').get()?.n, 482);
    const versions = b.database.prepare('SELECT data FROM rr_gap_versions WHERE gap_id=? ORDER BY seq').all('old-unavailable-240');
    assert.equal((JSON.parse(String(present(versions[0]).data)) as {
        endAtMs: number | null;
    }).endAtMs, null);
    assert.equal((JSON.parse(String(present(versions[1]).data)) as {
        endAtMs: number | null;
    }).endAtMs, AT + 1000);
});
void test('recovery transaction rollback preserves cursors and open originals', async (t) => {
    const { store, outbox, database } = await (await world(t)).start();
    await outbox.transaction(() => {
        store.appendGap({
            id: 'rollback-gap',
            episodeId: null,
            startAtMs: AT,
            endAtMs: null,
            reason: 'unavailable',
        });
        store.beginRecovery(2);
        store.markSuccessfulStatus(2, AT + 1000);
    });
    await assert.rejects(outbox.transaction(() => {
        store.recoverOpenGaps();
        store.saveEpisodeRecoveryCursor(99);
        throw new Error('Synthetic recovery interruption');
    }), /Synthetic recovery interruption/u);
    assert.equal(store.getGap('rollback-gap')?.endAtMs, null);
    assert.equal(store.loadEpisodeRecoveryCursor(), 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM rr_gap_versions').get()?.n, 1);
    await outbox.transaction(() => {
        assert.deepEqual(store.recoverOpenGaps(), { closed: 1, incompatible: 0 });
    });
    assert.equal(store.getGap('rollback-gap')?.endAtMs, AT + 1000);
});
void test('historical recovery refuses incomplete, future, overlapping and conflicting records', async (t) => {
    const { store, outbox } = await (await world(t)).start();
    await outbox.transaction(() => {
        store.appendObservation(observation('historical-source', AT + 1000));
        store.putEpisode(episode('historical', 'historical-source', AT + 1000));
        store.putRun({ ...record(), complete: unknown });
        assert.equal(store.reconcileHistoricalEpisode('historical', ID, 2, AT + 100000).resolved, false);
        store.putRun({ ...record(), observedAtMs: AT + 200000, complete: known(1) });
        assert.equal(store.reconcileHistoricalEpisode('historical', ID, 2, AT + 30000).resolved, false);
        store.putRun(record(ID + 10));
        assert.equal(store.reconcileHistoricalEpisode('historical', ID, 2, AT + 300000).resolved, false);
    });
    assert.equal(store.getEpisode('historical')?.endAtMs, null);
});
