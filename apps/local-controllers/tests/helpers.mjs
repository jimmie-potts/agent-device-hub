import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { createAgentState, MemoryStorage } from '@jimmie-potts/agent-state';

export const TOKENS = { hub: 'h'.repeat(43), reader: 'r'.repeat(43), tidbytOnly: 't'.repeat(43) };
export const digest = token => createHash('sha256').update(token).digest('hex');
export const QUALIFIED = { vendor: 1, product: 27, firmwareMajor: 2, firmwareMinor: 90 };
export const bulb = (deviceId, address) => ({ deviceId, address, ...QUALIFIED });

/** A LightState payload: hue, saturation, brightness, kelvin, then power. */
export function lightState(on = true) {
  const b = Buffer.alloc(52);
  [12000, 32000, 50000, 3500].forEach((v, i) => b.writeUInt16LE(v, i * 2));
  b.writeUInt16LE(on ? 65535 : 0, 10);
  return b;
}

/**
 * Fake LIFX transports: every exchange is logged per bulb. `hang` never answers until aborted, `fail` rejects at once,
 * `failFor` rejects for the listed bulbs only, and `power` is the power each read reports.
 */
export function fakeLifx() {
  const log = [];
  const mode = { hang: false, fail: false, failFor: new Set(), power: true };
  const transportFactory = bulb => ({
    exchange(type, _payload, _expected, signal) {
      log.push([bulb.deviceId, type]);
      if (mode.hang) return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
      if (mode.fail || mode.failFor.has(bulb.deviceId)) return Promise.reject(new Error('unreachable'));
      return Promise.resolve(type === 101 ? lightState(mode.power) : Buffer.alloc(0));
    },
    close() {},
  });
  return { log, mode, transportFactory };
}

/** A fake Tidbyt cloud connection that counts every write and listing. */
export function fakeTidbyt() {
  const calls = [];
  const connection = {
    capabilities: { backend: 'tidbyt-cloud', backgroundPush: { supported: true }, foregroundPush: { supported: false }, installationRead: { supported: true }, installationRemove: { supported: true } },
    async push() { calls.push('push'); return { outcome: 'sent' }; },
    async remove() { calls.push('remove'); return { outcome: 'sent' }; },
    async readInstallation() { calls.push('read'); return { ok: true, present: false }; },
  };
  return { calls, connection };
}

/** A loopback hub serving a healthy idle shared owner, so the Tidbyt publisher has nothing to write. */
export async function fakeHub(t) {
  const owner = await createAgentState({ storage: new MemoryStorage(), ownerId: 'owner', consumers: [] });
  const server = createServer((_req, res) => res.end(JSON.stringify({ apiVersion: '1.0', ownerId: 'owner', connection: 'current', snapshot: owner.snapshot() })));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); server.close(); await owner.shutdown(); });
  return `http://127.0.0.1:${server.address().port}`;
}

/** Private configuration files in a fresh directory outside any checkout. */
export function privateFiles(t, hubUrl = 'http://127.0.0.1:9') {
  const dir = mkdtempSync(join(tmpdir(), 'local-controllers-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const write = (name, value) => { const path = join(dir, name); writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value), { mode: 0o600 }); return path; };
  const runnerConfig = write('tidbyt-status.json', {
    hubUrl, ownerId: 'owner',
    tokenFile: write('hub-read-token', 'k'.repeat(43)),
    credentialsFile: write('tidbyt.env', 'TIDBYT_DEVICE_ID=device\nTIDBYT_API_KEY=private-key-sentinel\n'),
  });
  const host = {
    port: 0,
    credentials: [
      { id: 'bunny-hub', digest: digest(TOKENS.hub), scopes: ['read', 'control'], devices: ['tidbyt', 'desk', 'shelf'] },
      { id: 'reader', digest: digest(TOKENS.reader), scopes: ['read'], devices: ['tidbyt', 'desk', 'shelf'] },
      { id: 'tidbyt-only', digest: digest(TOKENS.tidbytOnly), scopes: ['read', 'control'], devices: ['tidbyt'] },
    ],
    tidbyt: { runnerConfig },
    lifx: { controllerId: 'lifx', sourceId: 'lifx-lan', bulbs: [bulb('desk', '192.0.2.10'), bulb('shelf', '192.0.2.11')], timeoutMs: 50, retries: 0 },
  };
  return { dir, write, runnerConfig, host, locks: join(dir, 'locks') };
}

/** LightSetColor (102) and DeviceSetPower (21) change a bulb; LightGet (101) only reads it. */
export const writes = log => log.filter(([, type]) => type !== 101);
export const reads = (log, deviceId) => log.filter(([id, type]) => type === 101 && (deviceId === undefined || id === deviceId));
export async function until(condition, ms = 3000) {
  const deadline = Date.now() + ms;
  while (!condition()) { if (Date.now() > deadline) throw new Error('condition-timeout'); await new Promise(r => setTimeout(r, 5)); }
}
export const settle = () => new Promise(r => setTimeout(r, 60));
