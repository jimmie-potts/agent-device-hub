// How the in-memory scenario harness learns that real work is in flight (Hub #1685): each kind of work the scenario
// catalog starts outside this thread counts from its start until it ends, the long-lived handles and this thread's own
// scheduling never count, and a turn pauses in real time only while something does.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomFill, randomFillSync, randomUUID, webcrypto} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {PAUSE_MS, realWork, settle} from './scenarios/real-work.js';
import {flush, it, stateDir} from './support.js';

const work = realWork();

/** Sharp, as the art, Pixoo and Tidbyt modules load it: an addon whose encoding runs on the thread pool. */
type Sharp = (options: {create: {width: number; height: number; channels: 3; background: {r: number; g: number; b: number}}}) => {png: () => {toBuffer: () => Promise<Buffer>}};
const sharp = createRequire(import.meta.resolve('@jimmie-potts/art'))('sharp') as Sharp;

/** Waits until nothing is in flight, such as what an earlier test left ending, and fails if that takes long. */
async function quiet(): Promise<void> {
  for (let turn = 0; turn < 1000 && work.busy(); turn += 1) await new Promise(resolve => { setTimeout(resolve, 1); });
  assert.deepEqual([...work.kinds()], [], 'real work was still in flight before the test');
}

/** What is in flight while `start` runs, read before its work can end, and after that work has ended. */
async function during(start: () => Promise<unknown>): Promise<{while: string[]; after: string[]}> {
  await quiet();
  const running = start();
  const kinds = [...work.kinds().keys()];
  assert.equal(work.busy(), kinds.length > 0, 'busy and the kinds in flight disagree');
  await running;
  await flush();
  assert.equal(work.busy(), work.kinds().size > 0, 'busy and the kinds in flight disagree');
  return {while: kinds, after: [...work.kinds().keys()]};
}

it('nothing counts while only a listener, an idle connection, a real timer and a promise are open', async context => {
  await quiet();
  const server = createServer((_request, response) => { response.end('ok'); });
  server.keepAliveTimeout = 60_000;
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  context.after(() => new Promise<void>(resolve => {
    server.closeAllConnections();
    server.close(() => { resolve(); });
  }));
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  // A kept-alive connection stays open and idle once its exchange is over.
  assert.equal(await (await fetch(`http://127.0.0.1:${String(address.port)}/`)).text(), 'ok');
  const timer = setTimeout(() => {}, 60_000);
  context.after(() => { clearTimeout(timer); });
  void new Promise(() => {});
  for (let turn = 0; turn < 10; turn += 1) await flush();
  assert.deepEqual([...work.kinds()], []);
  assert.equal(work.busy(), false);
});

it('a file read and a file write count until they end', async context => {
  const file = join(await stateDir(context), 'file');
  const written = await during(() => writeFile(file, 'bytes'));
  assert.ok(written.while.includes('FSREQPROMISE'), `in flight: ${written.while.join(', ')}`);
  assert.deepEqual(written.after, []);
  const read = await during(() => readFile(file));
  assert.ok(read.while.includes('FSREQPROMISE'), `in flight: ${read.while.join(', ')}`);
  assert.deepEqual(read.after, []);
});

it('image encoding on the thread pool counts until it ends', async () => {
  const encoded = await during(() => sharp({create: {width: 64, height: 64, channels: 3, background: {r: 1, g: 2, b: 3}}}).png().toBuffer());
  assert.ok(encoded.while.includes('generic'), `in flight: ${encoded.while.join(', ')}`);
  assert.deepEqual(encoded.after, []);
});

it('a child process counts until it exits', async () => {
  let running = true;
  const child = await during(() => new Promise<void>((resolve, reject) => {
    const process_ = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 200)'], {stdio: 'ignore'});
    process_.once('error', reject);
    process_.once('exit', () => { running = false; });
    process_.once('close', () => { resolve(); });
  }));
  assert.equal(running, false);
  assert.ok(child.while.includes('PROCESSWRAP'), `in flight: ${child.while.join(', ')}`);
  assert.deepEqual(child.after, []);
});

it('a child process that is still running keeps counting, in real time', async () => {
  await quiet();
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 300)'], {stdio: 'ignore'});
  const closed = new Promise<void>(resolve => { child.once('close', () => { resolve(); }); });
  await new Promise(resolve => { setTimeout(resolve, 100); });
  assert.equal(child.exitCode, null);
  assert.equal(work.kinds().get('PROCESSWRAP'), 1);
  assert.equal(work.busy(), true);
  await closed;
  await flush();
  assert.equal(work.busy(), false);
});

it('asynchronous cryptography counts until it calls back, and synchronous cryptography never does', async () => {
  await quiet();
  randomUUID();
  randomFillSync(Buffer.alloc(16));
  assert.deepEqual([...work.kinds()], []);
  const filled = await during(() => new Promise<void>((resolve, reject) => {
    randomFill(Buffer.alloc(16), error => { if (error === null) resolve(); else reject(error); });
  }));
  assert.deepEqual(filled.while, ['RANDOMBYTESREQUEST']);
  assert.deepEqual(filled.after, []);
  const digest = await during(() => webcrypto.subtle.digest('SHA-256', new Uint8Array(16)));
  assert.deepEqual(digest.while, ['HASHREQUEST']);
  assert.deepEqual(digest.after, []);
});

it('a turn pauses in real time only while real work is in flight', async () => {
  const pauses: number[] = [];
  const sleep = (ms: number): Promise<void> => {
    pauses.push(ms);
    return new Promise(resolve => { setTimeout(resolve, ms); });
  };
  let busy = false;
  for (let turn = 0; turn < 6; turn += 1) {
    busy = turn % 2 === 1;
    await settle(() => busy, sleep);
  }
  assert.deepEqual(pauses, [PAUSE_MS, PAUSE_MS, PAUSE_MS]);
});

it('a turn reads whether work is in flight after the event loop has run, so work started by a ready callback counts', async () => {
  const pauses: number[] = [];
  let started = false;
  setImmediate(() => { started = true; });
  await settle(() => started, ms => {
    pauses.push(ms);
    return Promise.resolve();
  });
  assert.deepEqual(pauses, [PAUSE_MS]);
});
