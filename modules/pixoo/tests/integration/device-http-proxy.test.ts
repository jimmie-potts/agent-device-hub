import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, expect, it } from 'vitest';
import { deviceServer } from '../helpers/http-device-server.js';

const exec = promisify(execFile);
const transportUrl = new URL('../../packages/device/dist/http-transport.js', import.meta.url).href;
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map(close => close())); });

it.each([
  { enabled: '1', bypass: '', route: 'proxy' },
  { enabled: '0', bypass: '', route: 'direct' },
  { enabled: '1', bypass: '127.0.0.1', route: 'direct' },
])('uses $route with proxy opt-in $enabled and NO_PROXY "$bypass"', async ({ enabled, bypass, route }) => {
  const direct = await deviceServer((_, res) => { res.end('{"error_code":0,"SelectIndex":3}'); });
  cleanup.push(direct.close);
  const connections = new Set<unknown>();
  const proxy = await deviceServer((body, res, req) => {
    expect(req.url).toBe(`http://127.0.0.1:${direct.port}/post`);
    expect(req.method).toBe('POST');
    expect(req.headers.host).toBe(`127.0.0.1:${direct.port}`);
    expect(req.headers.connection).toBe('close');
    expect(body).toEqual({ Command: 'Channel/GetIndex' });
    connections.add(req.socket);
    res.end('{"error_code":0,"SelectIndex":7}');
  });
  cleanup.push(proxy.close);
  const { stdout } = await exec(process.execPath, ['--input-type=module', '-e', `
    import { sendJson } from ${JSON.stringify(transportUrl)};
    const results = [];
    for (let i = 0; i < 2; i++) {
      results.push(await sendJson('127.0.0.1', ${direct.port}, { Command: 'Channel/GetIndex' }, AbortSignal.timeout(2000)));
    }
    console.log(JSON.stringify(results));
  `], {
    timeout: 8000,
    env: {
      ...process.env, NODE_OPTIONS: '', NODE_USE_ENV_PROXY: enabled,
      HTTP_PROXY: `http://127.0.0.1:${proxy.port}`, http_proxy: `http://127.0.0.1:${proxy.port}`,
      NO_PROXY: bypass, no_proxy: bypass,
    },
  });
  expect(JSON.parse(stdout)).toEqual(Array.from({ length: 2 }, () => ({ error_code: 0, SelectIndex: route === 'proxy' ? 7 : 3 })));
  expect(proxy.requests).toHaveLength(route === 'proxy' ? 2 : 0);
  expect(direct.requests).toHaveLength(route === 'direct' ? 2 : 0);
  expect(connections.size).toBe(route === 'proxy' ? 2 : 0);
});
