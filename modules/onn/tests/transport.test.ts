import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chmod, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {createServer, type Socket} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test, type TestContext} from 'node:test';
import {AdbTransport, type OnnAction} from '../src/transport.js';
import type {OnnConfig} from '../src/configuration.js';
const frame = (value: string): Buffer => Buffer.concat([Buffer.from(Buffer.byteLength(value).toString(16).padStart(4, '0')), Buffer.from(value)]);
const packet = (id: number, body: string | Buffer): Buffer => {
  const payload = typeof body === 'string' ? Buffer.from(body) : body, head = Buffer.alloc(5);
  head[0] = id; head.writeUInt32LE(payload.length, 1); return Buffer.concat([head, payload]);
};
type Mode = 'okay' | 'version-refused' | 'version-silent' | 'selection-refused' | 'shell-silent' | 'partial-ack' | 'missing-exit' | 'nonzero' | 'lifetime' | 'oversize';
async function fake(context: TestContext, mode: Mode): Promise<{transport: AdbTransport; requests: string[]; config: OnnConfig}> {
  const dir = await mkdtemp(join(tmpdir(), 'onn-protocol-')); await chmod(dir, 0o700);
  const executable = join(dir, 'adb'), adbSocket = join(dir, 's'), key = join(dir, 'adbkey');
  await writeFile(executable, 'synthetic qualified host', {mode: 0o700}); await writeFile(key, 'synthetic key', {mode: 0o600});
  const config: OnnConfig = {id: 'onn', configurationRevision: 1, adbSocket, serial: '192.0.2.10:12345', hostExecutable: executable,
    hostExecutableSha256: createHash('sha256').update('synthetic qualified host').digest('hex'), hostVersion: '37.0.1', hostKeyDirectory: dir};
  const requests: string[] = [], sockets = new Set<Socket>(), timers = new Set<NodeJS.Timeout>();
  const later = (callback: () => void, ms: number): void => {const timer = setTimeout(() => {timers.delete(timer); callback();}, ms); timers.add(timer);};
  const server = createServer(socket => {
    sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket));
    let buffered = Buffer.alloc(0);
    socket.on('data', chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 4) {
        const length = Number.parseInt(buffered.subarray(0, 4).toString(), 16);
        if (!Number.isFinite(length) || buffered.length < 4 + length) return;
        const request = buffered.subarray(4, 4 + length).toString(); buffered = buffered.subarray(4 + length); requests.push(request);
        if (request === 'host:version') {
          const answer = (): void => {if (!socket.destroyed) socket.end(Buffer.concat([Buffer.from('OKAY'), frame('0029')]));};
          if (mode === 'version-refused') socket.end(Buffer.concat([Buffer.from('FAIL'), frame('synthetic refusal')]));
          else if (mode === 'version-silent') { /* bounded by the caller */ }
          else if (mode === 'lifetime') later(answer, 100);
          else answer();
        } else if (request === `host:tport:serial:${config.serial}`) {
          if (mode === 'selection-refused') socket.end(Buffer.concat([Buffer.from('FAIL'), frame('synthetic offline')]));
          else {
            const id = Buffer.alloc(8); id.writeBigUInt64LE(7n);
            const answer = (): void => {if (!socket.destroyed) socket.write(Buffer.concat([Buffer.from('OKAY'), id]));};
            if (mode === 'lifetime') later(answer, 100); else answer();
          }
        } else if (request.startsWith('shell,v2,raw:')) {
          if (mode === 'shell-silent') socket.write('OKAY');
          else if (mode === 'partial-ack') socket.end('OK');
          else if (mode === 'missing-exit') socket.end(Buffer.concat([Buffer.from('OKAY'), packet(1, '')]));
          else {
            const stdout = request.includes('resolve-activity') ? 'com.stremio.one/com.stremio.tv.MainActivity\n'
              : request.includes('am start') ? 'Status: ok\nActivity: com.stremio.one/com.stremio.tv.MainActivity\n'
              : request.includes('dumpsys') ? 'com.google.android.youtube.tv\n' : mode === 'oversize' ? 'x'.repeat(16_385) : '';
            socket.end(Buffer.concat([Buffer.from('OKAY'), packet(1, stdout), packet(2, ''), packet(3, Buffer.from([mode === 'nonzero' ? 1 : 0]))]));
          }
        } else socket.destroy();
      }
    });
  });
  await new Promise<void>((resolve, reject) => {server.once('error', reject); server.listen(adbSocket, resolve);}); await chmod(adbSocket, 0o600);
  context.after(async () => {
    for (const timer of timers) clearTimeout(timer);
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve())); await rm(dir, {recursive: true, force: true});
  });
  return {transport: new AdbTransport(config), requests, config};
}
void test('a final guard refusal sends no effect service after ADB preparation', {timeout: 3000}, async context => {
  const {transport, requests} = await fake(context, 'okay');
  const result = await transport.execute({kind: 'key', key: 'right'}, AbortSignal.timeout(1000), () => 'revision-conflict');
  assert.deepEqual(result, {result: 'failed', evidence: 'none', code: 'revision-conflict', connection: 'unknown'});
  assert.equal(requests.some(value => value.includes('input keyevent')), false);
});

for (const action of [{kind: 'key', key: 'right'}, {kind: 'text', text: 'bunny test'}, {kind: 'app', app: 'stremio'}] satisfies OnnAction[]) {
  void test(`${action.kind}: the exact serial receives one qualified effect through the private protocol`, {timeout: 3000}, async context => {
    const {transport, requests} = await fake(context, 'okay');
    assert.deepEqual(await transport.execute(action, AbortSignal.timeout(1000)), {result: 'succeeded', evidence: 'transmitted', connection: 'available'});
    assert.equal(requests.filter(value => /shell,v2,raw:(input|am start)/.test(value)).length, 1);
    assert.ok(requests.every(value => value === 'host:version' || value.startsWith('host:tport:serial:192.0.2.10:12345') || value.startsWith('shell,v2,raw:')));
  });
}
for (const mode of ['version-refused', 'version-silent', 'selection-refused', 'lifetime'] as const) void test(`${mode}: whole deadline or dependency refusal writes no effect`, {timeout: 3000}, async context => {
  const {transport, requests} = await fake(context, mode);
  assert.deepEqual(await transport.execute({kind: 'key', key: 'right'}, AbortSignal.timeout(150)), {result: 'failed', evidence: 'none', code: 'unavailable', connection: 'unavailable'});
  assert.equal(requests.filter(value => value.startsWith('shell,')).length, 0);
});
for (const mode of ['shell-silent', 'partial-ack', 'missing-exit', 'nonzero', 'oversize'] as const) void test(`${mode}: a possible effect remains uncertain and is never repeated`, {timeout: 3000}, async context => {
  const {transport, requests} = await fake(context, mode);
  const result = await transport.execute({kind: 'key', key: 'right'}, AbortSignal.timeout(150));
  assert.equal(result.result, 'uncertain'); assert.equal(result.code, 'uncertain-result');
  assert.equal(result.connection, mode === 'nonzero' ? 'available' : 'unavailable');
  assert.equal(requests.filter(value => value.startsWith('shell,')).length, 1);
});
void test('a launcher refusal after Android answers is not a device outage and sends no launch', {timeout: 3000}, async context => {
  const {transport, requests} = await fake(context, 'nonzero');
  assert.deepEqual(await transport.execute({kind: 'app', app: 'stremio'}, AbortSignal.timeout(1000)), {result: 'failed', evidence: 'none', code: 'not-found', connection: 'available'});
  assert.equal(requests.some(value => value.includes('am start')), false);
});
void test('unsafe dependencies refuse before socket access; read-only foreground state contains only a neutral app', {timeout: 3000}, async context => {
  const {transport, requests, config} = await fake(context, 'okay');
  assert.deepEqual(await transport.read(AbortSignal.timeout(1000)), {app: 'youtube'});
  assert.ok(requests.every(value => !value.includes('input ') && !value.includes('am start')));
  const count = requests.length; await chmod(config.adbSocket, 0o666);
  assert.deepEqual(await transport.execute({kind: 'key', key: 'right'}, AbortSignal.timeout(1000)), {result: 'failed', evidence: 'none', code: 'unavailable', connection: 'unavailable'});
  assert.equal(requests.length, count);
});
