import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {DEFAULT_LIMITS, DEFAULT_TRANSFORM, SIMULATOR_PROFILE} from '../../src/media/contracts.js';
import {runWorker} from '../../src/media/worker-client.js';
import {gifFixture} from '../helpers/media-fixtures.js';
function deferred(): {promise: Promise<void>; resolve: () => void} {
  let resolve = (): void => { throw new Error('not initialized'); };
  const promise = new Promise<void>(done => { resolve = done; });
  return {promise, resolve: () => { resolve(); }};
}
const fixture = new URL('./fixtures/transfer-worker.js', import.meta.url);
const request = (output: string, input = 'valid') => ({input, output, sourceHash: 'a'.repeat(64), id: 'b'.repeat(64), transform: DEFAULT_TRANSFORM, profile: SIMULATOR_PROFILE, limits: DEFAULT_LIMITS});
async function within(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'pixoo-writer-'));
  try { await run(dir); } finally { await fs.rm(dir, {recursive: true, force: true}); }
}
async function waitFor(file: string): Promise<void> {
  for (let count = 0; count < 500; count++) {
    try { await fs.stat(file); return; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await delay(20);
  }
  throw new Error('owned fixture did not reach its checkpoint');
}
for (const mode of ['early-success', 'bad-header', 'bad-duration', 'bad-pixels', 'extra-header', 'extra-source', 'aggregate-pixels', 'extra-frame', 'duplicate-header', 'missing-frame', 'oversize', 'bad-rgb', 'bad-index', 'duplicate-frame', 'duplicate-final', 'nonzero']) {
  void test(`refuses ${mode} without a completed manifest`, async () => within(async dir => {
    await assert.rejects(runWorker(request(dir, mode), AbortSignal.timeout(3000), fixture), {code: 'decode-failed'});
    await assert.rejects(fs.stat(join(dir, 'manifest.json')), {code: 'ENOENT'});
  }));
}
void test('waits for actual child close before writing the manifest', async () => within(async dir => {
  const pending = runWorker(request(dir, 'delayed-close'), AbortSignal.timeout(3000), fixture);
  await waitFor(join(dir, '0.png'));
  await assert.rejects(fs.stat(join(dir, 'manifest.json')), {code: 'ENOENT'});
  await pending;
  const manifest = JSON.parse(await fs.readFile(join(dir, 'manifest.json'), 'utf8')) as {frames: {rgbHash: string}[]};
  assert.equal(manifest.frames[0]?.rgbHash, createHash('sha256').update(Buffer.alloc(12288, 17)).digest('hex'));
}));
void test('parent write failure keeps the fixed safe error', async () => within(async dir => {
  await fs.writeFile(join(dir, '0.rgb'), 'preserve');
  await assert.rejects(runWorker(request(dir), AbortSignal.timeout(3000), fixture), {code: 'decode-failed'});
  assert.equal(await fs.readFile(join(dir, '0.rgb'), 'utf8'), 'preserve');
  await assert.rejects(fs.stat(join(dir, 'manifest.json')), {code: 'ENOENT'});
}));
void test('abort waits for an outstanding parent write and starts no PNG or manifest', async () => within(async dir => {
  const original = fs.writeFile;
  const entered = deferred(), release = deferred();
  const controller = new AbortController();
  let settled = false;
  fs.writeFile = async (...args: Parameters<typeof fs.writeFile>) => {
    if (args[0] === join(dir, '0.rgb')) { entered.resolve(); await release.promise; }
    await original(...args);
  };
  syncBuiltinESMExports();
  try {
    const pending = runWorker(request(dir), controller.signal, fixture);
    const rejected = assert.rejects(pending, {code: 'cancelled'}).then(() => { settled = true; });
    await entered.promise;
    controller.abort();
    await delay(100);
    assert.equal(settled, false, 'in-flight parent I/O must drain before the caller can remove staging');
    release.resolve();
    await rejected;
    assert.deepEqual(await fs.readdir(dir), ['0.rgb']);
  } finally { release.resolve(); fs.writeFile = original; syncBuiltinESMExports(); }
}));
void test('a real decoder cannot write staging after its owned parent crashes', async () => within(async dir => {
  const out = join(dir, 'state'); await fs.mkdir(out);
  const input = join(dir, 'original');
  const bytes = gifFixture(1, 1, [{width: 1, height: 1, pixels: [1], delay: 4}]);
  await fs.writeFile(input, bytes);
  const gate = join(dir, 'release'), entered = join(dir, 'entered'), exited = join(dir, 'exited');
  const wrapper = join(dir, 'decoder.mjs'), parentEntry = join(dir, 'parent.mjs');
  // Test-only instrumentation is outside state. Pause the production decoder after its real input read, including
  // across IPC loss, so the assertion tests ownership rather than a fast disconnect handler or lucky scheduling.
  await fs.writeFile(wrapper, `import fs from 'node:fs/promises';
import {existsSync,writeFileSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const original=fs.readFile;
process.on('exit',()=>writeFileSync(${JSON.stringify(exited)},'exited'));
fs.readFile=async(...args)=>{const bytes=await original(...args);writeFileSync(${JSON.stringify(entered)},'entered');const end=Date.now()+8000;while(!existsSync(${JSON.stringify(gate)})){if(Date.now()>end)process.exit(2);Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);}return bytes;};
syncBuiltinESMExports();
await import(${JSON.stringify(new URL('../../src/media/worker.js', import.meta.url).href)});
`);
  const req = {...request(out, input), sourceHash: createHash('sha256').update(bytes).digest('hex')};
  await fs.writeFile(parentEntry, `import {runWorker} from ${JSON.stringify(new URL('../../src/media/worker-client.js', import.meta.url).href)};
await runWorker(${JSON.stringify(req)},AbortSignal.timeout(10000),new URL(${JSON.stringify('file://' + wrapper)}));
`);
  const parent = fork(parentEntry, {stdio: 'ignore', execArgv: [], env: {PATH: process.env.PATH}});
  const closed = once(parent, 'close');
  try {
    await waitFor(entered);
    parent.kill('SIGKILL');
    await closed;
    assert.deepEqual(await fs.readdir(out), []);
    await fs.writeFile(gate, 'continue');
    await waitFor(exited);
    assert.deepEqual(await fs.readdir(out), [], 'the surviving production decoder must have no state-writing responsibility');
  } finally {
    if (parent.exitCode === null && parent.signalCode === null) { parent.kill('SIGKILL'); await closed; }
    await fs.writeFile(gate, 'continue');
    await waitFor(exited);
  }
}));
