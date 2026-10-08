import assert from 'node:assert/strict';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {SdkError} from '@jimmie-potts/sdk';
import {SECOND, STATUS_ONLY, asking, host, records, shown, test, until, withWriteFailure, working, type Hosted} from './support.js';

const STATUS = 'agentdevicehub';
const pushes = (hosted: Hosted): number => shown(hosted, STATUS).pushes;
const core = (hosted: Hosted) => {
  if (hosted.core === undefined) throw new Error('no core');
  return hosted.core;
};

test('classifies a wrapped ENOSPC from tile persistence as storage capacity', async context => {
  let injected: Error | undefined;
  const hosted = await host(context, {
    sessions: [working()], section: STATUS_ONLY,
    wrapDatabase: database => withWriteFailure(database, () => {
      const failure = injected;
      injected = undefined;
      return failure;
    }),
  });
  await until(() => pushes(hosted) === 1, 'the first push');
  injected = new Error('tile persistence failed', {cause: Object.assign(new Error('filesystem is full'), {code: 'ENOSPC'})});

  await core(hosted).set(asking());
  await hosted.advance(15 * SECOND, SECOND);
  await until(() => pushes(hosted) === 2, 'the changed status push');
  assert.ok(records(hosted, 'operation.failed').includes('warn storage capacity'), 'the SDK full-disk classification is logged at WARN');
  assert.ok(records(hosted, 'operation.completed').some(entry => entry.includes('storage')), 'the following record commit recovers storage');
  assert.deepEqual(hosted.problems(), []);
});

test('keeps the explicit SdkError code when tile persistence fails', async context => {
  let injected: Error | undefined;
  const hosted = await host(context, {
    sessions: [working()], section: STATUS_ONLY,
    wrapDatabase: database => withWriteFailure(database, () => {
      const failure = injected;
      injected = undefined;
      return failure;
    }),
  });
  await until(() => pushes(hosted) === 1, 'the first push');
  injected = new SdkError(errorBody('forbidden', {detail: 'synthetic storage refusal'}), {cause: Object.assign(new Error('filesystem is full'), {code: 'ENOSPC'})});

  await core(hosted).set(asking());
  await hosted.advance(15 * SECOND, SECOND);
  await until(() => pushes(hosted) === 2, 'the changed status push');
  assert.ok(records(hosted, 'operation.failed').includes('warn storage forbidden'), 'SdkError keeps its explicit registry code');
  assert.deepEqual(hosted.problems(), []);
});
