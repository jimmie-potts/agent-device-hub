import { afterEach, expect, it } from 'vitest';
import { HttpDeviceAdapter, SPIKE_PROFILE } from '../../packages/device/src/http-adapter.js';
import { sendJson } from '../../packages/device/src/http-transport.js';
import { deviceServer } from '../helpers/http-device-server.js';
import { rgbFrame } from '../helpers/rgb-fixtures.js';
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map(close => close())); });

it('sends one ID query and ordered complete frames before a queued control', async () => {
  const server = await deviceServer((body, res) => {
    res.end(JSON.stringify(body.Command === 'Draw/GetHttpGifId' ? { error_code: 0, PicId: 7 } : { error_code: 0 }));
  }); cleanup.push(server.close);
  const device = new HttpDeviceAdapter({ ip: '192.168.1.2', profile: SPIKE_PROFILE }, (body, signal) => sendJson('127.0.0.1', server.port, body, signal));
  const frames = [rgbFrame(1, 500), rgbFrame(2, 500)];
  const original = frames.map(frame => Buffer.from(frame.rgb).toString('base64'));
  const upload = device.uploadAnimation({ frames }, { generation: 0 });
  frames[0]!.rgb.fill(255);
  const control = device.setBrightness(40, { generation: 0 });
  expect((await upload).ok).toBe(true); expect((await control).ok).toBe(true);
  expect(server.requests).toEqual([
    { Command: 'Draw/GetHttpGifId' },
    ...original.map((PicData, PicOffset) => ({ Command: 'Draw/SendHttpGif', PicNum: 2, PicWidth: 64, PicOffset, PicID: 7, PicSpeed: 500, PicData })),
    { Command: 'Channel/SetBrightness', Brightness: 40 },
  ]);
});

it.each(['cancelled', 'timeout', 'stale-generation'] as const)('stops in-flight upload on %s without sending later frames', async code => {
  let seen!: () => void;
  const received = new Promise<void>(resolve => { seen = resolve; });
  const server = await deviceServer((body, res) => {
    if (body.Command === 'Draw/GetHttpGifId') res.end('{"error_code":0,"PicId":9}');
    else if (body.Command === 'Draw/SendHttpGif') seen();
    else res.end('{"error_code":0}');
  }); cleanup.push(server.close);
  const device = new HttpDeviceAdapter({ ip: '192.168.1.2', profile: SPIKE_PROFILE }, (body, signal) => sendJson('127.0.0.1', server.port, body, signal));
  const abort = new AbortController();
  const upload = device.uploadAnimation({ frames: [rgbFrame(1, 500), rgbFrame(2, 500)] },
    { generation: 0, signal: abort.signal, timeoutMs: code === 'timeout' ? 150 : 5000 });
  await received;
  if (code === 'cancelled') abort.abort();
  if (code === 'stale-generation') device.invalidateGeneration();
  const control = device.setScreen(false, { generation: device.generation });
  expect(await upload).toMatchObject({ ok: false, code, priorEffects: 'possible' });
  expect((await control).ok).toBe(true);
  expect(server.requests.map(body => body.Command)).toEqual(['Draw/GetHttpGifId', 'Draw/SendHttpGif', 'Channel/OnOffScreen']);
});

it('retains the writer until an aborted transport has actually settled', async () => {
  let rejectRequest!: (error: Error) => void;
  let abortSeen!: () => void;
  const aborted = new Promise<void>(resolve => { abortSeen = resolve; });
  const commands: unknown[] = [];
  const device = new HttpDeviceAdapter({ ip: '192.168.1.2', profile: SPIKE_PROFILE }, async (body, signal) => {
    commands.push(body.Command);
    if (body.Command === 'Channel/GetIndex') {
      return await new Promise<Record<string, unknown>>((_, reject) => {
        rejectRequest = reject; signal.addEventListener('abort', abortSeen, { once: true });
      });
    }
    return { error_code: 0 };
  });
  const abort = new AbortController();
  const pending = device.probe({ generation: 0, signal: abort.signal });
  const queued = device.setScreen(true, { generation: 0 });
  abort.abort(); await aborted;
  expect(commands).toEqual(['Channel/GetIndex']);
  rejectRequest(new Error('closed'));
  expect(await pending).toMatchObject({ ok: false, code: 'cancelled', priorEffects: 'none' });
  expect((await queued).ok).toBe(true);
  expect(commands).toEqual(['Channel/GetIndex', 'Channel/OnOffScreen']);
});

it.each(['cancelled', 'timeout', 'stale-generation'] as const)('settles queued %s without starting its request', async code => {
  let release!: (value: Record<string, unknown>) => void;
  const commands: unknown[] = [];
  const device = new HttpDeviceAdapter({ ip: '192.168.1.2', profile: SPIKE_PROFILE }, async body => {
    commands.push(body.Command);
    return await new Promise<Record<string, unknown>>(resolve => { release = resolve; });
  });
  const active = device.setScreen(true, { generation: 0 });
  const abort = new AbortController();
  const queued = device.setBrightness(30, { generation: 0, signal: abort.signal, timeoutMs: code === 'timeout' ? 10 : 5000 });
  if (code === 'cancelled') abort.abort();
  if (code === 'stale-generation') device.invalidateGeneration();
  expect(await queued).toMatchObject({ ok: false, code, priorEffects: 'none', timing: { startedAtMs: null } });
  expect(commands).toEqual(['Channel/OnOffScreen']);
  release({ error_code: 0 }); await active;
});

it.each([
  { frames: [] }, { frames: [rgbFrame(1, 500), rgbFrame(2, 600)] },
  { frames: [rgbFrame(1, 500), rgbFrame(2, 500), rgbFrame(3, 500)] },
  { frames: [rgbFrame(1, 99)] }, { frames: [rgbFrame(1, 1001)] },
])('rejects animation outside the provisional profile without transport: %j', async animation => {
  const calls: unknown[] = [];
  const device = new HttpDeviceAdapter({ ip: '192.168.1.2', profile: SPIKE_PROFILE }, async body => { calls.push(body); return { error_code: 0 }; });
  expect(await device.uploadAnimation(animation, { generation: 0 })).toMatchObject({ ok: false, code: 'invalid-input', priorEffects: 'none' });
  expect(calls).toEqual([]);
});

it('reads only known probe fields, without inventing model/firmware or leaking extra fields', async () => {
  const commands: unknown[] = [];
  const device = new HttpDeviceAdapter({ ip: '192.168.1.2', profile: SPIKE_PROFILE }, async body => {
    commands.push(body.Command);
    return body.Command === 'Channel/GetIndex' ? { error_code: 0, SelectIndex: 3 } : { error_code: 0, Brightness: 50, LightSwitch: 1, secret: 'private device data' };
  });
  const result = await device.probe({ generation: 0 });
  expect(result).toMatchObject({ ok: true, value: { mode: 'device', available: true, connected: true, channel: 3, brightness: 50, screenOn: true } });
  expect(JSON.stringify(result)).not.toContain('private device data');
  expect(commands).toEqual(['Channel/GetIndex', 'Channel/GetAllConf']);
});

it('rejects a malformed animation ID and never resets or uploads automatically', async () => {
  const server = await deviceServer((_, res) => { res.end('{"error_code":0,"PicId":"9"}'); }); cleanup.push(server.close);
  const device = new HttpDeviceAdapter({ ip: '192.168.1.2', profile: SPIKE_PROFILE }, (body, signal) => sendJson('127.0.0.1', server.port, body, signal));
  expect(await device.uploadAnimation({ frames: [rgbFrame(1, 500)] }, { generation: 0 })).toMatchObject({ ok: false, code: 'protocol-error', priorEffects: 'none' });
  expect(server.requests).toEqual([{ Command: 'Draw/GetHttpGifId' }]);
});
