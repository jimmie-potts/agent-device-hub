import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import {createConnection, type Socket} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
import {test} from 'node:test';
import {NativeClients, type NativeTerminalPlan} from '../src/worker/native-clients.js';

const allowed = (): boolean => true;

void test('two terminal waiters receive only their exact attempt and hold separate writer authority', async t => {
  const state = await mkdtemp(join(tmpdir(), 'native-terminal-'));
  const path = join(state, 'worker.sock');
  const terminal = new NativeClients(path);
  const sockets: Socket[] = [];
  t.after(async () => {for (const socket of sockets) socket.destroy(); terminal.stop(); await rm(state, {recursive: true, force: true});});
  await terminal.start();
  const reports: string[] = [];
  const offer = (operationId: string, session: string) => terminal.offer(operationId, session, ['terminal', 'claude-desktop'],
    () => Promise.resolve({executable: '/fixture/harness', cwd: `/fixture/${operationId}`, args: ['resume', session], env: {}}),
    state => {reports.push(`${operationId}:${state}`); return Promise.resolve();});
  await offer('attempt-one', 'session-one');
  await offer('attempt-two', 'session-two');
  await offer('attempt-alias', 'session-one');
  assert.equal('error' in await terminal.open('attempt-alias', allowed), true, 'an aliased native session is refused');
  assert.equal('error' in await terminal.open('attempt-one', allowed), true, 'an unwaited attempt is refused');

  const wait = async (operationId: string) => {
    const socket = createConnection(path);
    sockets.push(socket);
    const reader = createInterface({input: socket})[Symbol.asyncIterator]();
    await once(socket, 'connect');
    socket.write(operationId + '\n');
    assert.equal((await reader.next()).value, 'waiting');
    const plan = async (): Promise<NativeTerminalPlan> => JSON.parse((await reader.next()).value ?? assert.fail('launch plan')) as NativeTerminalPlan;
    return {socket, plan};
  };
  const first = await wait('attempt-one'), second = await wait('attempt-two');
  assert.equal('error' in await terminal.open('attempt-two', allowed), false);
  assert.deepEqual(await second.plan(), {executable: '/fixture/harness', cwd: '/fixture/attempt-two', args: ['resume', 'session-two'], env: {}});
  assert.equal('error' in await terminal.open('attempt-two', allowed), true);
  assert.equal(terminal.writerMayBePresent('attempt-two'), true);
  assert.equal(terminal.writerMayBePresent('attempt-one'), false);
  assert.equal('error' in await terminal.open('attempt-one', allowed), false);
  assert.deepEqual((await first.plan()).args, ['resume', 'session-one']);

  const closed = once(second.socket, 'close');
  second.socket.write('closed\n');
  await closed;
  assert.ok(reports.includes('attempt-two:terminal-closed'));
  assert.equal(terminal.writerMayBePresent('attempt-two'), true);
  assert.equal('error' in await terminal.open('attempt-two', allowed), true);
  assert.equal('error' in await terminal.openDesktop('attempt-two', allowed), true);
  first.socket.destroy();
  await waitForObservation(() => reports.includes('attempt-one:uncertain'));
  assert.equal(terminal.writerMayBePresent('attempt-one'), true);
  assert.equal('error' in await terminal.open('attempt-one', allowed), true);
});

async function waitForObservation(check: () => boolean): Promise<void> {
  for (let attempts = 0; attempts < 50 && !check(); attempts += 1) await new Promise(resolve => setImmediate(resolve));
  assert.ok(check());
}

void test('an exact Desktop launch is one-way and refuses another client on the same attempt', async t => {
  const state = await mkdtemp(join(tmpdir(), 'native-desktop-'));
  const plan = {executable: '/fixture/claude', cwd: '/fixture/worktree', args: ['--desktop', '--resume', 'exact-id'], env: {}};
  const launched: NativeTerminalPlan[] = [], reports: string[] = [];
  const native = new NativeClients(join(state, 'worker.sock'), value => {launched.push(value); return Promise.resolve(true);});
  t.after(async () => {native.stop(); await rm(state, {recursive: true, force: true});});
  await native.start();
  await native.offer('attempt', 'claude:exact-id', ['terminal', 'claude-desktop'], () => Promise.resolve(plan),
    value => {reports.push(value); return Promise.resolve();});
  assert.equal('error' in await native.openDesktop('attempt', () => false), true);
  assert.equal(launched.length, 0);
  assert.equal('error' in await native.openDesktop('attempt', allowed), false);
  assert.deepEqual(launched, [plan]);
  assert.deepEqual(reports, ['available', 'desktop']);
  assert.equal(native.writerMayBePresent('attempt'), true);
  assert.equal('error' in await native.open('attempt', allowed), true);
  assert.equal('error' in await native.openDesktop('attempt', allowed), true);
  native.clear();
  assert.equal(native.writerMayBePresent('attempt'), true, 'losing the endpoint cannot release Desktop');
});

void test('a Desktop receipt naming a different session leaves write authority uncertain', async t => {
  const state = await mkdtemp(join(tmpdir(), 'native-desktop-'));
  const native = new NativeClients(join(state, 'worker.sock'));
  t.after(async () => {native.stop(); await rm(state, {recursive: true, force: true});});
  await native.start();
  const reports: string[] = [];
  await native.offer('target', 'claude:requested-id', ['claude-desktop'], () => Promise.resolve({
    executable: process.execPath, cwd: state, args: ['-e', 'console.log("Opening session other-id in Claude Desktop")', 'requested-id'], env: {},
  }), value => {reports.push(value); return Promise.resolve();});
  assert.equal('error' in await native.openDesktop('target', allowed), false);
  assert.deepEqual(reports, ['available', 'uncertain']);
  assert.equal(native.writerMayBePresent('target'), true);
  assert.equal('error' in await native.openDesktop('target', allowed), true);
});
