import { afterEach, describe, expect, it } from 'vitest';
import { createDeviceTransport, sendJson } from '../../packages/device/src/http-transport.js';
import { deviceServer } from '../helpers/http-device-server.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map(close => close())); });

describe('device HTTP transport', () => {
  it('sends the exact JSON command and parses a successful device response', async () => {
    const server = await deviceServer((body, res, req) => {
      expect(req.url).toBe('/post'); expect(req.method).toBe('POST');
      expect(body).toEqual({ Command: 'Channel/GetIndex' });
      res.end('{"error_code":0,"SelectIndex":3}');
    }); cleanup.push(server.close);
    expect(await sendJson('127.0.0.1', server.port, { Command: 'Channel/GetIndex' }, new AbortController().signal))
      .toEqual({ error_code: 0, SelectIndex: 3 });
  });
  it.each(['127.0.0.1', '8.8.8.8', 'localhost', '192.168.1.1:80', 'http://192.168.1.1', '192.168.001.1', '169.254.1.2', '172.32.0.1', '10.1.1.1/path'])('rejects unapproved destination %s', ip => {
    expect(() => createDeviceTransport(ip)).toThrow();
  });
  it.each([
    [302, '{}', 'http-error'], [500, '{}', 'http-error'],
    [200, '{"error_code":5}', 'device-error'], [200, '{}', 'protocol-error'],
    [200, '{"error_code":"0"}', 'protocol-error'], [200, 'not-json', 'protocol-error'],
    [200, '[]', 'protocol-error'], [200, 'x'.repeat(17000), 'protocol-error'],
  ])('rejects status %s and invalid response as %s', async (status, body, code) => {
    const target = await deviceServer((_, res) => { res.end('{"error_code":0}'); }); cleanup.push(target.close);
    const server = await deviceServer((_, res) => { res.statusCode = status as number; res.setHeader('location', 'http://127.0.0.1:' + target.port + '/post'); res.end(body as string); }); cleanup.push(server.close);
    await expect(sendJson('127.0.0.1', server.port, { Command: 'Channel/GetIndex' }, new AbortController().signal)).rejects.toMatchObject({ code });
    expect(target.requests).toHaveLength(0);
  });
  it('aborts a stalled response and closes the local request', async () => {
    const server = await deviceServer(() => {}); cleanup.push(server.close);
    await expect(sendJson('127.0.0.1', server.port, { Command: 'Channel/GetIndex' }, AbortSignal.timeout(30))).rejects.toMatchObject({ code: 'offline' });
  });

});
