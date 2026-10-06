import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export async function deviceServer(reply: (body: Record<string, unknown>, res: ServerResponse, req: IncomingMessage) => void) {
  const requests: Record<string, unknown>[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += String(chunk); });
    req.on('end', () => {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      requests.push(parsed); reply(parsed, res, req);
    });
  });
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  return { port: (server.address() as AddressInfo).port, requests,
    close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
