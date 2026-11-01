import assert from 'node:assert/strict';
import {Readable, Writable} from 'node:stream';
import {runCodexProxy} from '../src/read-receipts/codex-proxy.js';
import {it} from './support.js';

it('native stdin, stdout, stderr and exit code survive unavailable collection and oversized or invalid frames', async () => {
  const bytes = Buffer.concat([Buffer.from('{not-json}\n'), Buffer.alloc(2 * 1024 * 1024, 255), Buffer.from('\n{"private":"synthetic"}\n')]);
  const stdout: Buffer[] = [], stderr: Buffer[] = [];
  const output = new Writable({highWaterMark: 64, write(chunk: Buffer, _encoding, done) {stdout.push(Buffer.from(chunk)); setImmediate(done);}});
  const errors = new Writable({write(chunk: Buffer, _encoding, done) {stderr.push(Buffer.from(chunk)); done();}});
  const result = await runCodexProxy({native: process.execPath, args: ['-e',
    'process.stdin.pipe(process.stdout); process.stdin.on("end", () => { process.stderr.write(Buffer.from([0, 255, 10])); process.exitCode = 23; });'],
    input: Readable.from([bytes.subarray(0, 3), bytes.subarray(3)]), output, errors, producer: '/absent/synthetic-producer.json'});
  assert.deepEqual(result, {code: 23, signal: null});
  assert.deepEqual(Buffer.concat(stdout), bytes);
  assert.deepEqual(Buffer.concat(stderr), Buffer.from([0, 255, 10]));
});

it('non-observed native commands also retain byte streams and terminate without waiting for B.U.N.N.Y.', async () => {
  const stdout: Buffer[] = [], stderr: Buffer[] = [];
  const result = await runCodexProxy({native: process.execPath, args: ['-e', 'process.stdout.write("native-version\\n"); process.stderr.write("native-warning\\n");'],
    input: Readable.from([]), output: new Writable({write(chunk: Buffer, _encoding, done) {stdout.push(Buffer.from(chunk)); done();}}),
    errors: new Writable({write(chunk: Buffer, _encoding, done) {stderr.push(Buffer.from(chunk)); done();}})});
  assert.deepEqual(result, {code: 0, signal: null});
  assert.equal(Buffer.concat(stdout).toString(), 'native-version\n');
  assert.equal(Buffer.concat(stderr).toString(), 'native-warning\n');
});
