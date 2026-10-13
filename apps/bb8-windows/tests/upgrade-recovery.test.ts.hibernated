import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {InProcessBus, openModuleDatabaseFile} from '@jimmie-potts/sdk';
import {HELPER_SOURCE, type LinkResult} from '@jimmie-potts/bb8/link';
import {HelperOwner} from '../src/owner.js';
import {Receipts} from '../src/receipts.js';

const scheduler = {after: (ms: number, work: () => void) => {const timer = setTimeout(work, ms); return () => clearTimeout(timer);}};
const completion = (id: string): LinkResult => ({id, revision: 1, robotId: 'bb8', parentRequestId: `parent-${id}`, helperEpoch: 'prior-helper', connectionGeneration: 2, requestId: id, result: 'succeeded', evidence: 'transmitted', completedAtMs: 1234});

void test('latest on-disk helper receipts survive recovery and re-upgrade without native access', async t => {
  const phase = process.env.BUNNY_BB8_RECOVERY_PHASE;
  if (phase === undefined) {
    const directory = await mkdtemp(join(tmpdir(), 'bb8-helper-recovery-'));
    t.after(() => rm(directory, {recursive: true, force: true}));
    for (const role of ['baseline', 'candidate', 'recovery', 'reupgrade']) {
      const childEnvironment: NodeJS.ProcessEnv = {...process.env, BUNNY_BB8_RECOVERY_PHASE: role, BUNNY_BB8_RECOVERY_DIRECTORY: directory};
      delete childEnvironment.NODE_TEST_CONTEXT;
      const child = await promisify(execFile)(process.execPath, ['--test', '--test-reporter=tap', fileURLToPath(import.meta.url)], {
        env: childEnvironment, timeout: 15_000,
      });
      assert.match(child.stdout, /^# tests 1$/m, 'the child must actually execute its qualification test');
      assert.match(child.stdout, /^# pass 1$/m, 'a skipped child is not qualification evidence');
      assert.match(child.stdout, /^# fail 0$/m);
      t.diagnostic(`${role}: separate process exited zero after closing its SQLite owner`);
    }
    return;
  }
  const directory = process.env.BUNNY_BB8_RECOVERY_DIRECTORY;
  if (directory === undefined || !['baseline', 'candidate', 'recovery', 'reupgrade'].includes(phase)) throw new Error('invalid synthetic recovery phase');
  const db = openModuleDatabaseFile(join(directory, 'bb8-link.sqlite'));
  assert.equal(db.prepare('PRAGMA journal_mode').get()?.journal_mode, 'wal');
  assert.equal(db.prepare('PRAGMA synchronous').get()?.synchronous, 2);
  const store = new Receipts(db); store.bind('bb8');
  const enrollment = 'a'.repeat(64);
  if (phase === 'baseline') {
    try {
      db.exec('CREATE TABLE bb8_enrollment (id INTEGER PRIMARY KEY CHECK(id=1), fingerprint TEXT NOT NULL) STRICT');
      db.prepare('INSERT INTO bb8_enrollment VALUES(1,?)').run(enrollment);
      assert.equal(store.count(), 0);
    } finally {db.close();}
    return;
  }
  if (phase === 'candidate') {
    try {
      for (const id of ['consumed', 'completed', 'accepted', 'started']) {
        store.admit({requestId: id, operationId: id, parentRequestId: `parent-${id}`, expectedConfigurationRevision: 0, expectedHelperEpoch: 'prior-helper', expectedConnectionGeneration: 2, operationExpiresAtMs: Date.now() + 60_000, operation: {kind: 'wake'}}, '00-11111111111111111111111111111111-1111111111111111-01');
        if (id === 'started') store.effect(id, 2);
        if (id === 'consumed' || id === 'completed') store.complete(completion(id));
        if (id === 'consumed') store.consume(id);
      }
    } finally {db.close();}
    return;
  }
  let opens = 0;
  const bus = new InProcessBus(), sdk = bus.connect(HELPER_SOURCE);
  const owner = new HelperOwner({id: 'bb8', configurationRevision: 0, database: db, sdk, now: Date.now, scheduler, clockErrorMs: () => 0, adapter: () => {opens++; throw new Error('no native access during recovery');}});
  try {
    await owner.start();
    assert.equal(store.pending().length, 0, phase);
    assert.deepEqual(JSON.parse(String(store.row('completed')?.result)), completion('completed'));
    assert.deepEqual(JSON.parse(String(store.row('consumed')?.result)), completion('consumed'));
    assert.equal(store.row('consumed')?.consumed, 1);
    assert.equal((JSON.parse(String(store.row('accepted')?.result)) as LinkResult).result, 'failed');
    assert.equal((JSON.parse(String(store.row('started')?.result)) as LinkResult).result, 'uncertain');
    assert.equal(store.results().length, 3);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bb8_receipts').get()?.n, 4);
    assert.equal(db.prepare('SELECT fingerprint FROM bb8_enrollment WHERE id=1').get()?.fingerprint, enrollment);
    assert.throws(() => store.bind('other-robot'));
    assert.equal(owner.state.connection, 'disconnected');
    assert.equal(opens, 0, phase);
  } finally {
    await owner.stop(); await sdk.close(); db.close();
  }
});
