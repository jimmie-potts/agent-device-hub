import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {InProcessBus} from '@jimmie-potts/sdk';
import type {CompletedOutcome} from '@jimmie-potts/event-contracts/v2/devices';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {createBb8Module} from '../src/module.js';
import {SimulatedLink} from '../src/simulated.js';
import {Bb8Store} from '../src/store.js';
import type {RobotState} from '../src/contracts.js';

void test('latest on-disk BB8 state and outcomes survive recovery and re-upgrade without execution', async t => {
  const phase = process.env.BUNNY_BB8_RECOVERY_PHASE;
  if (phase === undefined) {
    const directory = await mkdtemp(join(tmpdir(), 'bb8-upgrade-recovery-'));
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
  const bus = new InProcessBus(), transport = new SimulatedLink();
  let executions = 0;
  transport.execute = () => {executions++; throw new Error('recovery must never execute a saved operation');};
  const host = new ModuleHarness(createBb8Module({transport}), {bus, stateDir: directory, section: {id: 'bb8', configurationRevision: 0}});
  t.after(() => host.stop());
  await host.start();
  const database = host.moduleDatabase(); assert.ok(database);
  assert.equal(database.prepare('PRAGMA journal_mode').get()?.journal_mode, 'wal');
  assert.equal(database.prepare('PRAGMA synchronous').get()?.synchronous, 2);
  const store = new Bb8Store(database), original = store.state(); assert.ok(original);
  if (phase === 'baseline') {
    assert.equal(original.desiredLed.status, 'unknown');
    assert.equal(store.pending().length, 0);
    assert.equal(executions, 0);
    return;
  }
  const desiredLed: RobotState['desiredLed'] = {status: 'known', value: {target: 'main', rgb: [17, 9, 4]}};
  const power: RobotState['power'] = {status: 'known', value: {recordVersion: 1, category: 1, voltageHundredths: 402, rechargeCount: 3, secondsAwakeSinceRecharge: 11, observedAtMs: 1234}};
  const completed = {requestId: 'completed', result: 'succeeded', evidence: 'transmitted'};
  if (phase === 'candidate') {
    store.setState({...original, desiredLed, power});
    for (const id of ['completed', 'accepted', 'started']) {
      store.accept({source: 'bunny/parts/operator', request_id: id, digest: id, family: 'bb8-led-set', operation_id: `operation-${id}`, helper_epoch: 'prior-helper', generation: 2, deadline: Date.now() + 60_000, traceparent: '00-11111111111111111111111111111111-1111111111111111-01'});
    }
    store.complete('operation-completed', completed);
    store.started('operation-started');
    assert.equal(executions, 0);
    return;
  }
  const until = Date.now() + 5000;
  while (store.pending().length > 0 && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(store.pending().length, 0, phase);
  assert.deepEqual(store.state()?.desiredLed, desiredLed, phase);
  assert.deepEqual(store.state()?.power, power, 'a restart cannot freshen the power observation');
  assert.equal(store.state()?.physicalLed.status, 'unknown');
  assert.equal(store.state()?.held?.requestId, 'started');
  assert.deepEqual(JSON.parse(String(store.row('bunny/parts/operator', 'completed')?.outcome)), completed);
  assert.equal((JSON.parse(String(store.row('bunny/parts/operator', 'accepted')?.outcome)) as CompletedOutcome).result, 'failed');
  assert.equal((JSON.parse(String(store.row('bunny/parts/operator', 'started')?.outcome)) as CompletedOutcome).result, 'uncertain');
  const saved = database.prepare("SELECT id,message FROM bunny_outbox WHERE kind='outcome' ORDER BY id").all() as {id: string; message: string}[];
  assert.equal(saved.length, 2, 'completion delivery remains pending until core acknowledgment');
  const expected = join(directory, 'synthetic-outcomes.json');
  if (phase === 'recovery') await writeFile(expected, JSON.stringify(saved), {mode: 0o600});
  else assert.equal(JSON.stringify(saved), await readFile(expected, 'utf8'), 're-upgrade preserves the exact durable outcome IDs and messages, not new effects');
  assert.equal(executions, 0, phase);
  assert.deepEqual(host.failures, []);
});
