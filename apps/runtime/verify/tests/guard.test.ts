// Hub #920: the network guard of a verification run's runtime. Loaded through NODE_OPTIONS, it refuses every outbound
// TCP connection and UDP datagram before anything leaves: through net, http, https and fetch, from the main thread, a
// worker thread and a child Node process. Each refusal is written to the run's report file. Without the guard, the same
// probe reaches the test's own listeners, which shows the probe can tell the difference.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import dgram from 'node:dgram';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import type {AddressInfo} from 'node:net';
import {join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {GUARD, guardEnvironment} from '../environment.js';
import {HOME_REPORT} from '../home.js';
import {base} from './support.js';

const PROBE = fileURLToPath(new URL('./probe.js', import.meta.url));
type Report = {main: Record<string, string>; worker: Record<string, string>; child: string};

/** A TCP listener and a UDP socket of the test's own, counting what reaches them. */
async function listeners(): Promise<{tcp: number; udp: number; reached: () => number; close: () => void}> {
  let reached = 0;
  const server = createServer(socket => { reached += 1; socket.destroy(); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const socket = dgram.createSocket('udp4');
  socket.on('message', () => { reached += 1; });
  socket.bind(0, '127.0.0.1');
  await once(socket, 'listening');
  return {
    tcp: (server.address() as AddressInfo).port, udp: socket.address().port, reached: () => reached,
    close: () => { server.close(); socket.close(); },
  };
}

async function probe(env: NodeJS.ProcessEnv, tcp: number, udp: number): Promise<Report> {
  const child = spawn(process.execPath, [PROBE, String(tcp), String(udp)], {env, stdio: ['ignore', 'pipe', 'inherit']});
  let text = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { text += chunk; });
  await once(child, 'close');
  return JSON.parse(text) as Report;
}

void test('the guard refuses every outbound connection and datagram, from every thread and child process, and reports each', {timeout: 60_000}, async context => {
  const at = await base(context);
  const ears = await listeners();
  context.after(() => { ears.close(); });
  const reportFile = join(at, 'guard-report.jsonl');
  const guarded = await probe({...process.env, ...guardEnvironment(reportFile)}, ears.tcp, ears.udp);
  const kinds = ['net', 'http.request', 'http.get', 'https.request', 'fetch', 'dgram.send', 'dgram.connect'];
  assert.deepEqual(guarded.main, Object.fromEntries(kinds.map(kind => [kind, 'blocked'])), 'the main thread reaches nothing');
  assert.deepEqual(guarded.worker, Object.fromEntries(kinds.map(kind => [kind, 'blocked'])), 'a worker thread reaches nothing');
  assert.equal(guarded.child, 'blocked', 'a child Node process reaches nothing');
  assert.equal(ears.reached(), 0, 'no connection or datagram arrived');
  const attempts = (await readFile(reportFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as {protocol: string; port: number});
  assert.equal(attempts.filter(attempt => attempt.protocol === 'tcp' && attempt.port === ears.tcp).length, 11, 'five TCP ways each in the main thread and the worker, and the child');
  assert.equal(attempts.filter(attempt => attempt.protocol === 'udp' && attempt.port === ears.udp).length, 4, 'two UDP ways each in the main thread and the worker');
  assert.ok(GUARD.startsWith('file://'));

  // The control: without the guard, the probe reaches the test's listeners.
  const open = await probe(process.env, ears.tcp, ears.udp);
  assert.equal(open.main.net, 'connected');
  assert.equal(open.main['http.get'], 'connected');
  assert.equal(open.main['dgram.send'], 'sent');
  assert.ok(ears.reached() > 0);
});

// This child has only synthetic environment values, and no runtime or supervisor is started.
void test('the preloaded guard reports only the directly forked child HOME through IPC', async context => {
  const at = await base(context);
  const home = join(at, 'synthetic-home');
  const child = spawn(process.execPath, ['--input-type=module', '-e', 'process.disconnect();'], {
    env: {HOME: home, SYNTHETIC_UNRELATED: 'tok_SYNTHETIC1015_not_reported', ...guardEnvironment(join(at, 'guard-report.jsonl'))},
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  context.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  assert.ok(child.stdout !== null && child.stderr !== null);
  const messages: unknown[] = [];
  let output = '';
  child.on('message', message => { messages.push(message); });
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
  await once(child, 'close');
  assert.deepEqual(messages, [{type: HOME_REPORT, home}]);
  assert.equal(output, '', 'HOME and the unrelated synthetic value never enter stdout or stderr');
});

void test('a HOME report meeting a closed IPC channel stops silently, whether send throws or calls back', async context => {
  const at = await base(context);
  for (const mode of ['throw', 'callback']) {
    const script = `
      process.send = (_message, callback) => {
        const error = new Error('tok_SYNTHETIC1015_send_failure');
        ${mode === 'throw' ? 'throw error;' : 'callback(error); return false;'}
      };
      await import(${JSON.stringify(GUARD)});
      setTimeout(() => process.exit(3), 1000);
    `;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      env: {HOME: join(at, 'synthetic-home')}, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    context.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
    assert.ok(child.stdout !== null && child.stderr !== null);
    let output = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
    const [, signal] = await once(child, 'close');
    assert.equal(signal, 'SIGTERM', mode);
    assert.equal(output, '', `${mode}: the failure never reaches stdout or stderr`);
  }
});
