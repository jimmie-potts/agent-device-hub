import http from 'node:http';
import { once } from 'node:events';
import { createMcpHandler } from '@jimmie-potts/device-mcp';
import { CredentialStore, targets, type Config } from './config.js';
import { bindings } from './tools.js';
export async function startHost(config: Config) {
    if (!config.enabled)
        throw new Error('MCP is disabled');
    const store = new CredentialStore(config);
    const { registry, tools } = bindings(config, store);
    let handler: ReturnType<typeof createMcpHandler> | undefined;
    const server = http.createServer({ maxHeaderSize: 16384, requestTimeout: 10000, headersTimeout: 5000, keepAliveTimeout: 1000 }, (req, res) => {
        if (req.url !== '/mcp' || !handler) {
            res.writeHead(404);
            res.end();
            return;
        }
        void handler.handle(req, res).catch(() => { if (!res.headersSent)
            res.writeHead(500); res.end(); });
    });
    server.maxHeadersCount = 32;
    server.maxConnections = 32;
    server.setTimeout(10000, socket => socket.destroy());
    server.listen(config.port, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('Listener unavailable');
    const host = `127.0.0.1:${address.port}`;
    try {
        handler = createMcpHandler({ enabled: true, registry, tools, authenticate: token => store.authenticate(token), allowedHosts: [host], allowedOrigins: [`http://${host}`], limits: { maxDevices: targets(config).length } });
    }
    catch (error) {
        server.close();
        throw error;
    }
    let closing: Promise<void> | undefined;
    return { url: `http://${host}/mcp`, close() { return closing ??= (async () => { const closed = new Promise<void>(resolve => server.close(() => resolve())); await handler!.close(); server.closeAllConnections(); await closed; })(); } };
}
