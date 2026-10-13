// Synthetic production-store persistence proof. All four phases use this build;
// exact cross-release and installed/device qualification remain separate.
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {errorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import {InProcessBus, Outbox, SdkError, openModuleDatabaseFile} from '@jimmie-potts/sdk';
import {emptyStatus} from '../../src/contracts.js';
import {roborockValidator} from '../../src/families.js';
import {normalizeRecord, normalizeStatus} from '../../src/normalize.js';
import {projectRun, projectStatusFields} from '../../src/projection.js';
import {stateDrafts} from '../../src/state.js';
import {RoborockStore, type Observation} from '../../src/store.js';

const [directory, phase] = process.argv.slice(2);
assert.ok(typeof directory === 'string' && directory.length > 0);
const index = ['baseline', 'candidate', 'recovery', 'reupgrade'].indexOf(phase ?? '');
assert.ok(index >= 0);
process.umask(0o077);
const ID = 1_700_000_000, AT = ID * 1000, now = AT + index * 120_000 + 100_000;
const writing = phase === 'baseline' || phase === 'candidate';
const database = openModuleDatabaseFile(join(directory, 'roborock.sqlite'));
const store = new RoborockStore(database);
const bus = new InProcessBus({now: () => now});
const participant = bus.connect('bunny/modules/roborock'), observer = bus.connect('bunny/parts/qualification');
const received: string[] = [], deferred: string[] = [];
await observer.subscribe('bunny.state.*.*', message => {received.push(JSON.stringify(message));});
const outbox = new Outbox({database, clock: {now: () => now}, validator: roborockValidator(), sdk: {
  source: participant.source,
  subscribe: (pattern, handler) => participant.subscribe(pattern, handler),
  publishMessage: async <T extends object>(key: string, message: Message<T>) => {
    if (writing) throw new SdkError(errorBody('unavailable', {detail: 'Synthetic publication refusal.'}));
    return participant.publishMessage(key, message);
  },
}, onError: error => {assert.ok(error instanceof SdkError); deferred.push(error.body.error.code);}});
function present<T>(value: T | undefined): T {assert.ok(value !== undefined); return value;}
const tables = ['rr_meta', 'rr_observations', 'rr_projection', 'rr_runs', 'rr_run_versions', 'rr_run_fields',
  'rr_run_conflicts', 'rr_queue', 'rr_episodes', 'rr_episode_versions', 'rr_samples', 'rr_sample_links',
  'rr_gaps', 'rr_gap_versions', 'rr_checkpoint', 'rr_map_captures', 'rr_map_checks', 'rr_gap_recovery'];
function snapshot() {
  const archive: Record<string, unknown[]> = {};
  for (const table of tables) archive[table] = database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
  archive.rr_map_blobs = database.prepare('SELECT hash,hex(bytes) AS bytesHex FROM rr_map_blobs ORDER BY hash').all();
  const runs = store.listRuns().items;
  return {archive, identity: store.identity(), projection: present(store.loadProjection()),
    checkpoint: store.loadCheckpoint(), counts: store.counts(), runs,
    samples: runs.map(run => ({recordId: run.recordId, ...store.listSamples(run.recordId)})),
    captures: runs.flatMap(run => store.listMapCaptures(run.recordId)),
    outbox: database.prepare('SELECT seq,id,kind,routing_key,message,published FROM bunny_outbox ORDER BY seq').all()};
}
const observation = (id: string, operation: Observation['operation'], at: number, generation: number,
  value: unknown, requestedRecordId?: number): Observation => ({id, operation, observedAtMs: at, generation, value,
  ...(requestedRecordId === undefined ? {} : {requestedRecordId})});
function retainRecord(id: string, raw: unknown, recordId: number, at: number, generation: number) {
  store.appendObservation(observation(id, 'record', at, generation, raw, recordId));
  const run = projectRun(normalizeRecord(raw, recordId), at); assert.ok(run !== undefined); store.putRun(run);
}
let result: object | undefined;
try {
  // Read the committed archive before publication or new fixture writes.
  const boot = store.hasIdentity() ? snapshot() : null;
  if (writing) {
    const generation = phase === 'baseline' ? 1 : 2, start = AT + (generation - 1) * 120_000;
    const recordId = ID + (generation - 1) * 120, episodeId = `episode-${phase}`, postId = `post-${phase}`;
    const post = {state: 8, battery: generation === 1 ? 76 : 66};
    await outbox.transaction(add => {
      store.bindIdentity('synthetic-private-robot'); store.beginRecovery(generation);
      store.appendObservation(observation(`recovered-${phase}`, 'status', start, generation, {state: 8, battery: 82}));
      store.markSuccessfulStatus(generation, start); store.recoverOpenGaps();
      for (const sample of [1, 2, 3]) {
        const id = `sample-${phase}-${sample}`, at = start + sample * 1000, battery = (generation === 1 ? 80 : 70) - sample;
        store.appendObservation(observation(id, 'status', at, generation, {state: 5, battery, owner_note: `Synthetic private ${phase}`}));
        if (sample === 1) store.putEpisode({id: episodeId, generation, startAtMs: at, lastObservedAtMs: at,
          startObservationId: id, lastObservationId: id, endAtMs: null, runId: null});
        store.appendSample({id, episodeId, observedAtMs: at, batteryPercent: battery, runId: null});
      }
      retainRecord(`record-${phase}`, {begin: recordId, end: recordId + 60, duration: generation === 1 ? 40 : 55,
        area: generation === 1 ? 12_000_000 : 13_000_000, error: 0, complete: 1, finish_reason: 999,
        owner_note: `Synthetic private record ${phase}`}, recordId, start + 64_000, generation);
      store.appendObservation(observation(`rooms-${phase}`, 'rooms', start + 4000, generation, [[16, `Synthetic private room ${phase}`]]));
      store.appendObservation(observation(`summary-${phase}`, 'summary', start + 60_000, generation,
        {clean_time: 4000, clean_area: 900_000_000, clean_count: 50, records: [recordId]}));
      store.appendObservation(observation(postId, 'status', start + 63_000, generation, post));
      store.putEpisode({...present(store.getEpisode(episodeId)), lastObservationId: `sample-${phase}-3`,
        lastObservedAtMs: start + 3000, endAtMs: start + 60_000, terminal: {observationId: postId, observedAtMs: start + 63_000}});
      store.appendGap({id: `missed-${phase}`, episodeId, startAtMs: start + 1900, endAtMs: start + 2100, reason: 'missed-poll'});
      assert.deepEqual(store.attachEpisode({episodeId, recordId, startAtMs: start, endAtMs: start + 60_000,
        externallyValidated: true}), {attached: true, samples: 2});
      store.appendGap({id: `unavailable-${phase}`, episodeId: null, startAtMs: start + 70_000, endAtMs: null, reason: 'unavailable'});
      const mapId = `map-${phase}`;
      store.saveMapCapture({id: mapId, candidateRunId: recordId, requestAtMs: start + 61_000, responseAtMs: start + 62_000,
        generation, preObservationIds: [`summary-${phase}`], postObservationIds: [postId], mapIndex: 7, mapSequence: generation,
        association: 'unverified', reasons: ['candidate-window']}, Buffer.from(`Synthetic private decoded map ${phase}`));
      store.appendMapReason(mapId, start + 64_000, 'gap');
      store.putRun({...present(store.getRun(recordId)), map: {availability: 'unverified', reason: 'candidate-window'}});
      store.enqueueRecordIds([recordId + 3600], now); store.failReconciliation(recordId + 3600, 'unavailable', now + 60_000);
      store.saveEpisodeRecoveryCursor(generation); store.saveCheckpoint({generation, lastObservationId: postId,
        lastObservedAtMs: start + 63_000, activeEpisodeId: null});
      if (phase === 'candidate') {
        retainRecord('baseline-partial', {begin: ID, duration: 45, owner_note: 'Synthetic private partial update'}, ID, now, generation);
        retainRecord('baseline-empty', {begin: ID}, ID, now + 1, generation);
        const conflicting = {begin: ID + 99, owner_note: 'Synthetic private conflict'};
        store.appendObservation(observation('baseline-conflict', 'record', now + 2, generation, conflicting, ID));
        assert.equal(projectRun(normalizeRecord(conflicting, ID), now + 2), undefined);
        store.appendMapReason('map-baseline', now, 'restart');
      }
      const counts = store.counts(), status = {...emptyStatus('vacuum'), revision: generation,
        observedAtMs: {status: 'known', value: start + 63_000} as const, availability: 'available' as const,
        activity: 'other' as const, status: projectStatusFields(normalizeStatus(post)), collection: {
          ...emptyStatus('vacuum').collection, retainedRuns: counts.runs, observedSamples: counts.samples, gaps: counts.gaps}};
      store.saveProjection(status, false);
      const [vacuum, device] = stateDrafts(status, generation);
      add('bunny.state.roborock-vacuum.vacuum', vacuum); add('bunny.state.device.vacuum', device);
    });
    assert.deepEqual(deferred, ['unavailable']); assert.deepEqual(received, []);
  } else {
    assert.ok(boot !== null); assert.equal(await outbox.republish(), boot.outbox.length);
    for (let turn = 0; turn < 8; turn++) await new Promise<void>(resolve => {setImmediate(resolve);});
    assert.deepEqual(deferred, []);
  }
  result = {phase, pid: process.pid, boot, current: snapshot(), received};
} finally {database.close(); await observer.close(); await participant.close();}
assert.ok(result !== undefined); process.stdout.write(JSON.stringify(result));
