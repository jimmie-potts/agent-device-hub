import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CloudQualification, type CloudGrant, type QualificationProvider} from '../src/coding/cloud-qualification.js';

const candidate = {operationId: 'op', destination: 'cloud-fixture', repository: 'sample', revision: 'a'.repeat(40), harness: 'codex'} as const;
const grant = {...candidate, computeMs: 30_000, storageBytes: 1_000_000, chargeMicros: 0, expiresAtMs: 60_000};
const scope = {...candidate, endpointId: 'endpoint', selectionId: 'selection'};
function fixture(failure?: 'lost-launch' | 'unbounded' | 'unknown-writer' | 'dirty-storage' | 'lost-cleanup' | 'over-budget' | 'wrong-workspace' | 'unowned-launch') {
  let launches = 0, teardowns = 0, now = 1;
  const provider: QualificationProvider = {
    accepts: approved => approved.harness === 'codex' && approved.repository === 'sample' && approved.chargeMicros === 0,
    launch: approved => {
      launches += 1;
      if (failure === 'lost-launch') return Promise.reject(new Error('workspace may already exist'));
      const {computeMs, storageBytes, chargeMicros, expiresAtMs} = approved;
      return Promise.resolve({...scope, operationId: failure === 'unowned-launch' ? 'unowned-op' : scope.operationId,
        workspaceId: 'workspace',
        enforced: {computeMs, storageBytes, chargeMicros, expiresAtMs: expiresAtMs + (failure === 'unbounded' ? 1 : 0)}});
    },
    teardown: (workspaceId, operationId) => {
      teardowns += 1;
      if (failure === 'lost-cleanup') return Promise.reject(new Error('cleanup outcome unknown'));
      return Promise.resolve({workspaceId: failure === 'wrong-workspace' ? 'other' : workspaceId, operationId,
        workspaceRemoved: failure !== 'dirty-storage', writerStopped: failure !== 'unknown-writer', chargeMicros: failure === 'over-budget' ? 1 : 0});
    },
  };
  return {qualification: new CloudQualification(provider, () => now), provider, advance: (to: number) => {now = to;},
    effects: () => ({launches, teardowns})};
}

void test('missing or incompatible cloud scope and exhausted allowance cause zero provider starts', async () => {
  const {qualification, effects} = fixture();
  const refused: Array<CloudGrant | undefined> = [undefined, {...grant, operationId: 'other'}, {...grant, revision: 'b'.repeat(40)},
    {...grant, storageBytes: 0}, {...grant, computeMs: Infinity}, {...grant, expiresAtMs: 1}, {...grant, chargeMicros: 1}];
  for (const approval of refused) assert.equal(await qualification.launch(candidate, approval), false);
  const unsupported = {...candidate, harness: 'claude-code' as const};
  assert.equal(await qualification.launch(unsupported, {...grant, ...unsupported}), false);
  assert.deepEqual(effects(), {launches: 0, teardowns: 0});
});

void test('verified zero-cost workspace authorizes only the exact current connection and settles after exact teardown', async () => {
  const {qualification, effects, advance} = fixture();
  const starting = qualification.launch(candidate, grant);
  assert.equal(qualification.allows(scope, 1), false);
  assert.equal(await qualification.launch(candidate, grant), false);
  assert.equal(await starting, true);
  assert.equal(qualification.allows(scope, 1), true);
  assert.equal(qualification.allows({...scope, selectionId: 'reconnected'}, 1), false);
  assert.equal(qualification.allows({...scope, harness: 'claude-code'}, 1), false);
  assert.equal(qualification.allows({...scope, operationId: 'next-job'}, 1), false);
  advance(grant.expiresAtMs);
  assert.equal(qualification.allows(scope, grant.expiresAtMs), false);
  const cleanup = qualification.cleanup();
  assert.equal(qualification.allows(scope, 1), false);
  assert.equal(await cleanup, true);
  assert.deepEqual(qualification.receipt, {state: 'closed', operationId: 'op', workspaceId: 'workspace',
    approvedChargeMicros: 0, enforcedChargeMicros: 0, chargedMicros: 0, teardownConfirmed: true});
  assert.equal(await qualification.launch(candidate, grant), false);
  assert.deepEqual(effects(), {launches: 1, teardowns: 1});
});

void test('unverified launch and failed or uncertain cleanup hold the workspace without a replacement start', async () => {
  for (const failure of ['lost-launch', 'unowned-launch', 'unknown-writer', 'dirty-storage', 'lost-cleanup', 'over-budget', 'wrong-workspace'] as const) {
    const {qualification, effects} = fixture(failure);
    const owned = failure !== 'lost-launch' && failure !== 'unowned-launch';
    assert.equal(await qualification.launch(candidate, grant), owned, failure);
    assert.equal(await qualification.cleanup(), false, failure);
    assert.deepEqual(qualification.receipt, {state: 'held', operationId: 'op', workspaceId: owned ? 'workspace' : null,
      approvedChargeMicros: 0, enforcedChargeMicros: owned ? 0 : null,
      chargedMicros: failure === 'over-budget' ? 1 : null, teardownConfirmed: failure === 'over-budget'}, failure);
    assert.equal(qualification.allows(scope, 1), false, failure);
    assert.equal(await qualification.launch(candidate, grant), false, failure);
    assert.equal(await qualification.cleanup(), false, failure);
    assert.deepEqual(effects(), {launches: 1, teardowns: owned ? 1 : 0}, failure);
  }
});

void test('positively owned workspace with an over-limit deadline never routes and can be cleaned up once', async () => {
  const {qualification, effects} = fixture('unbounded');
  assert.equal(await qualification.launch(candidate, grant), false);
  assert.equal(qualification.receipt.state, 'closed');
  assert.equal(qualification.receipt.workspaceId, 'workspace');
  assert.equal(qualification.allows(scope, 1), false);
  assert.equal(qualification.receipt.teardownConfirmed, true);
  assert.equal(qualification.receipt.chargedMicros, 0);
  assert.equal(await qualification.launch(candidate, grant), false);
  assert.equal(await qualification.cleanup(), false);
  assert.deepEqual(effects(), {launches: 1, teardowns: 1});
});

void test('a lost launch holds the same provider claim across qualification instances', async () => {
  const {provider, qualification, effects} = fixture('lost-launch');
  const other = new CloudQualification(provider, () => 1);
  const original = qualification.launch(candidate, grant);
  assert.equal(await other.launch(candidate, grant), false);
  assert.equal(await original, false);
  assert.equal(qualification.receipt.state, 'held');
  assert.equal(await other.launch(candidate, grant), false);
  assert.deepEqual(effects(), {launches: 1, teardowns: 0});
});
