import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import {command, it, PENDANT, withWriteFailure, World} from './support.js';

it('classifies a wrapped ENOSPC at command admission as capacity and sends nothing', async context => {
  let injected: Error | undefined;
  const world = await World.open({wrapDatabase: database => withWriteFailure(database, () => {
    const failure = injected;
    injected = undefined;
    return failure;
  })});
  context.after(() => closeChecked(world));
  await world.clock.advance(1);
  const packets = world.network.state().packets.length;
  injected = new Error('module transaction failed', {cause: Object.assign(new Error('filesystem is full'), {code: 'ENOSPC'})});

  const refused = await world.send(command.power(PENDANT.id, false), {requestId: 'req-wrapped-full'});
  assert.equal(refused.status === 'rejected' && refused.error.error.code, 'capacity');
  await world.clock.advance(1);
  assert.equal(world.network.state().packets.length, packets, 'the bulb heard nothing before the intent committed');
  assert.equal(world.outcomes('req-wrapped-full').length, 0, 'a refused command has no outcome');
  assert.equal(world.logs('operation.failed').filter(entry => entry.fields['bunny.operation'] === 'storage').length, 1, 'one storage failure is logged');
});

async function closeChecked(world: World): Promise<void> {
  try {
    assert.deepEqual(world.invalid, [], 'every message followed profile 2.0');
    assert.deepEqual(world.errors, [], 'no handler of the module failed');
    assert.deepEqual(world.hosted.flatMap(harness => harness.failures), [], 'no timer of the module failed, and its stop finished');
  } finally {
    await world.close();
  }
}

it('closes its owned world even when a cleanup assertion fails', async () => {
  const world = await World.open();
  world.invalid.push('synthetic invalid message');
  try {
    await assert.rejects(closeChecked(world), {name: 'AssertionError'});
    await assert.rejects(access(world.dir), {code: 'ENOENT'});
  } finally {
    await world.close();
  }
});
