// The writer lease per bulb (Hub #928): one holder per bulb across processes and within one, and a refusal that says
// why. A lease another process holds keeps the module off that bulb until that process ends; a second take in the same
// process never weakens the first lease against other processes; a lease folder that is not private and a lease file
// that cannot be opened are refused with their own reasons.
import assert from 'node:assert/strict';
import {spawn, type ChildProcess} from 'node:child_process';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {chmod, mkdir, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {afterEach} from 'node:test';
import {fileURLToPath} from 'node:url';
import {PACKET} from '../src/index.js';
import {acquireLease} from '../src/lease.js';
import {command, it, PENDANT, synced, World} from './support.js';

const HOLDER = fileURLToPath(new URL('./fixtures/hold-lease.js', import.meta.url));
const ONE = {bulbs: [PENDANT]};
const worlds: World[] = [];
const children: ChildProcess[] = [];
async function open(options: Parameters<typeof World.open>[0] = {}): Promise<World> {
  const world = await World.open(options);
  worlds.push(world);
  return world;
}
afterEach(async () => {
  for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  for (const world of worlds.splice(0)) {
    assert.deepEqual(world.invalid, [], 'every message followed profile 2.0');
    assert.deepEqual(world.errors, [], 'no handler of the module failed');
    assert.deepEqual(world.hosted.flatMap(harness => harness.failures), [], 'no timer of the module failed');
    await world.close();
  }
});

const leases = (world: World): string => join(world.dir, 'lifx', 'leases');
/** Starts a process that takes the lease of the bulb at `address` under `folder`, and resolves with it and what it wrote. */
async function holder(folder: string, address: string): Promise<{child: ChildProcess; answer: string}> {
  const child = spawn(process.execPath, [HOLDER, folder, address], {stdio: ['ignore', 'pipe', 'inherit']});
  children.push(child);
  let text = '';
  child.stdout?.setEncoding('utf8');
  for await (const chunk of child.stdout ?? []) {
    text += String(chunk);
    if (text.includes('\n')) break;
  }
  return {child, answer: text.trim()};
}
const refusalOf = (result: Awaited<ReturnType<World['send']>>): unknown =>
  result.status === 'rejected' ? {code: result.error.error.code, detail: result.error.error.detail} : result.status;

it('a lease another process holds keeps the module off that bulb, and the next start takes it once that process ends', async () => {
  const world = await open({section: ONE});
  await world.harness.stop();
  const {child, answer} = await holder(leases(world), PENDANT.address);
  assert.equal(answer, 'held', 'the other process took the lease');
  const before = world.packets(PENDANT.address);
  await world.start();
  await world.clock.advance(60_000);
  assert.equal((await synced(world, PENDANT.id))?.availability, 'unavailable');
  assert.deepEqual(refusalOf(await world.send(command.power(PENDANT.id, false))), {code: 'unavailable', detail: 'another writer holds the bulb'});
  assert.equal(world.packets(PENDANT.address), before, 'the module never reached the bulb');
  assert.deepEqual(world.logs('operation.failed').filter(entry => entry.fields['bunny.operation'] === 'startup').map(entry => entry.fields['bunny.reason']), ['busy']);
  child.kill('SIGKILL');
  await once(child, 'exit');
  await world.restart();
  await world.clock.advance(1);
  assert.equal(world.device(PENDANT.id)?.availability, 'available', 'the lease was free once the holder ended');
  assert.equal((await world.send(command.power(PENDANT.id, false))).status, 'accepted');
});

it('a second take of a held lease in the same process is refused and leaves the first holding against other processes', async () => {
  const world = await open({section: ONE});
  await world.clock.advance(1);
  const again = acquireLease(leases(world), PENDANT.address);
  assert.deepEqual(again.status === 'refused' && again.reason, 'busy');
  const {answer} = await holder(leases(world), PENDANT.address);
  assert.equal(answer, 'busy', 'another process still cannot take it');
});

it('a lease folder others can open is refused as not private, and the bulb is unavailable', async () => {
  const world = await open({section: ONE});
  await world.harness.stop();
  await chmod(leases(world), 0o750);
  await world.start();
  await world.clock.advance(60_000);
  assert.equal((await synced(world, PENDANT.id))?.availability, 'unavailable');
  assert.deepEqual(refusalOf(await world.send(command.power(PENDANT.id, false))), {code: 'unavailable', detail: 'the bulb\'s lease is not private'});
  assert.deepEqual(world.logs('operation.failed').filter(entry => entry.fields['bunny.operation'] === 'startup').map(entry => entry.fields['bunny.reason']), ['unauthorized']);
  const direct = acquireLease(leases(world), '192.0.2.99');
  assert.deepEqual(direct.status === 'refused' && direct.reason, 'not-private');
});

it('a lease file that cannot be opened is refused as such, and the bulb is unavailable', async () => {
  const world = await open({section: ONE});
  await world.harness.stop();
  const file = join(leases(world), `${createHash('sha256').update(`lifx:${PENDANT.address}`).digest('hex')}.sqlite`);
  await rm(file, {force: true});
  await mkdir(file, {mode: 0o700});
  await world.start();
  await world.clock.advance(60_000);
  assert.equal((await synced(world, PENDANT.id))?.availability, 'unavailable');
  assert.deepEqual(refusalOf(await world.send(command.power(PENDANT.id, false))), {code: 'unavailable', detail: 'the module could not open the bulb\'s lease'});
  assert.deepEqual(world.logs('operation.failed').filter(entry => entry.fields['bunny.operation'] === 'startup').map(entry => entry.fields['bunny.reason']), ['unavailable']);
  assert.equal(world.packets(PENDANT.address, PACKET.setPower), 0);
});
