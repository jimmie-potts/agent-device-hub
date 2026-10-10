import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ModuleContext } from '@jimmie-potts/sdk';
import { LazyTransport } from '../src/transport.js';
const target = { schemaVersion: 1, deviceId: 'synthetic-robot', address: '127.0.0.1', broker: 'mqtts://mqtt-us.roborock.com:8883', region: 'us' };
const session = { schemaVersion: 1, deviceId: target.deviceId, model: 'roborock.vacuum.a97', protocol: '1.0', localKey: '0123456789abcdef', rriot: { u: 'synthetic-user', s: 'synthetic-auth-secret', k: 'synthetic-auth-key' }, broker: target.broker };
const context = (read: (name: string) => Promise<string>): ModuleContext => ({ secrets: { read }, clock: { now: () => 1700000000000 }, scheduler: { after: () => () => { } }, log: { debug: () => { }, info: () => { }, warn: () => { }, error: () => { } }, trace: undefined } as unknown as ModuleContext);
void test('construction loads nothing; explicit identity loads private JSON without contacting any socket', async () => {
    const names: string[] = [];
    const t = new LazyTransport(context(name => { names.push(name); return Promise.resolve(JSON.stringify(name === 'target' ? target : session)); }));
    assert.deepEqual(names, []);
    assert.equal(await t.identity(), 'synthetic-robot');
    assert.deepEqual(names, ['target', 'session']);
    t.stop();
    const r = await t.readStatus();
    assert.equal(r.ok, false);
    if (!r.ok)
        assert.equal(r.error.error.code, 'cancelled');
    assert.deepEqual(names, ['target', 'session']);
});
void test('invalid secret values yield fixed registry errors without leaking originals', async () => {
    const t = new LazyTransport(context(() => Promise.resolve('{synthetic-account-secret-invalid-json')));
    const r = await t.readStatus();
    assert.equal(r.ok, false);
    if (!r.ok)
        assert.equal(r.error.error.code, 'invalid-request');
    assert.equal(JSON.stringify(r).includes('synthetic-account-secret'), false);
    t.stop();
});
void test('stop fences an unfinished secret load before transport construction', async () => {
    let finish: (s: string) => void = () => { };
    const t = new LazyTransport(context(() => new Promise<string>(r => { finish = r; })));
    const reading = t.readStatus();
    await Promise.resolve();
    t.stop();
    finish(JSON.stringify(target));
    // The second named secret may still be read, but no connection can be constructed after stop.
    await Promise.resolve();
    finish(JSON.stringify(session));
    const result = await reading;
    assert.equal(result.ok, false);
    if (!result.ok)
        assert.equal(result.error.error.code, 'cancelled');
});
