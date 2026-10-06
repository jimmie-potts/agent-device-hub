import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { listenLoopback } from './loopback.js';

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
  const port = await listenLoopback(server);
  return { port, requests,
    close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
