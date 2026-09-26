import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { JsonResponseTransport } from './transport.js';
import { CallToolRequestSchema, ListToolsRequestSchema, McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { validate, type Ticket } from '@jimmie-potts/device-contracts';
import type { MachinePrincipal, GatewayLimits, McpHandlerOptions, McpHandler } from './types.js';
import { authorizedTools, boundedJson, gatewayFailure, invokeDeviceTool, isRegisteredTool, validPrincipal } from './tools.js';

export const MCP_PROTOCOL_VERSIONS = Object.freeze(['2025-11-25', '2025-06-18']);
export const DEFAULT_GATEWAY_LIMITS: Readonly<GatewayLimits> = Object.freeze({ maxBodyBytes: 65536, maxResponseBytes: 1048576,
  maxInFlight: 32, maxSessions: 16, maxDevices: 64, authenticationTimeoutMs: 1000, requestTimeoutMs: 10000, sessionIdleMs: 300000 });
class HttpFailure extends Error { constructor(readonly status: number) { super('MCP request rejected'); } }
function reject(res: ServerResponse, status: number): void {
  if (res.writableEnded || res.destroyed) return;
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Connection: 'close',
    ...(status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {}), ...(status === 405 ? { Allow: 'POST, DELETE' } : {}) });
  res.end(JSON.stringify({ error: 'MCP request rejected' }));
}
function requestIdentity(value: unknown): Ticket | string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const args = value as Record<string, unknown>;
  return validate('ticket', args.requestId) ? args.requestId as Ticket
    : typeof args.request_id === 'string' && args.request_id.length <= 128 ? args.request_id : undefined;
}
function singleHeader(req: IncomingMessage, name: string, required = false): string | undefined {
  const values: string[] = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2) if (req.rawHeaders[i].toLowerCase() === name) values.push(req.rawHeaders[i + 1]);
  if (values.length > 1 || (required && values.length !== 1)) throw new HttpFailure(name === 'authorization' ? 401 : 403);
  return values[0];
}
function authority(value: string): string {
  if (!value || /[\s/@?#\\]/.test(value)) throw new Error('Invalid authority');
  const parsed = new URL(`http://${value}`);
  if (parsed.pathname !== '/' || parsed.username || parsed.password || parsed.host.toLowerCase() !== value.toLowerCase()) throw new Error('Invalid authority');
  return value.toLowerCase();
}
function origin(value: string): string {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== value || parsed.username || parsed.password) throw new Error('Invalid origin');
  return value;
}
function body(req: IncomingMessage, limits: GatewayLimits): Promise<unknown> {
  return new Promise((resolve, rejectBody) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => finish(new HttpFailure(408)), limits.requestTimeoutMs);
    const cleanup = () => { clearTimeout(timer); req.off('data', onData); req.off('end', onEnd); req.off('error', onError); req.off('aborted', onAborted); };
    const finish = (error?: Error, value?: unknown) => { cleanup(); if (error) { req.pause(); rejectBody(error); } else resolve(value); };
    const onData = (chunk: Buffer) => { size += chunk.length; if (size > limits.maxBodyBytes) finish(new HttpFailure(429)); else chunks.push(chunk); };
    const onEnd = () => { try { finish(undefined, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); } catch { finish(new HttpFailure(400)); } };
    const onError = () => finish(new HttpFailure(400));
    const onAborted = () => finish(new HttpFailure(400));
    req.on('data', onData); req.once('end', onEnd); req.once('error', onError); req.once('aborted', onAborted);
  });
}
async function deadline<T>(work: Promise<T>, milliseconds: number, expired: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>(resolve => { timer = setTimeout(() => resolve(expired()), milliseconds); });
  try { return await Promise.race([work, timeout]); } finally { clearTimeout(timer!); }
}

/** Mount before body parsing on an explicitly enabled, locally bound owning server. Never calls listen(). */
export function createMcpHandler(options: McpHandlerOptions): McpHandler {
  const limits = Object.freeze({ ...DEFAULT_GATEWAY_LIMITS, ...options.limits });
  for (const [key, value] of Object.entries(limits)) {
    if (!Object.hasOwn(DEFAULT_GATEWAY_LIMITS, key) || !Number.isSafeInteger(value) || value <= 0 || value > 1073741824) throw new Error('Invalid gateway limit');
  }
  if (limits.maxBodyBytes > 65536 || limits.maxDevices > 64 || options.registry.size > limits.maxDevices || limits.maxResponseBytes < 1024) throw new Error('Invalid gateway bounds');
  const hosts = new Set(options.allowedHosts.map(authority));
  const origins = new Set(options.allowedOrigins.map(origin));
  if (options.enabled && (!hosts.size || typeof options.authenticate !== 'function')) throw new Error('Enabled MCP needs authentication and explicit hosts');
  const tools = new Map(options.tools.map(tool => [tool.name, tool]));
  if (tools.size !== options.tools.length || tools.size > 256 || options.tools.some(tool => !isRegisteredTool(options.registry, tool))) throw new Error('Invalid registered tools');
  const list = [...tools.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (Buffer.byteLength(JSON.stringify({ tools: list })) > limits.maxResponseBytes) throw new Error('Tool catalog exceeds response limit');
  type Session = { server: Server; transport: JsonResponseTransport; principalId: string; version: string;
    ready: boolean; requests: Set<string>; calls: Set<string>; timer?: ReturnType<typeof setTimeout> };
  const sessions = new Map<string, Session>();
  let closed = false, httpActive = 0, verifications = 0, operations = 0;
  async function remove(id: string): Promise<void> {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id); clearTimeout(session.timer);
    await session.server.close();
  }
  function touch(id: string, session: Session): void {
    clearTimeout(session.timer);
    session.timer = setTimeout(() => { void remove(id).catch(() => {}); }, limits.sessionIdleMs);
    session.timer.unref();
  }
  async function initialize(principal: MachinePrincipal, version: string): Promise<Session> {
    if (sessions.size >= limits.maxSessions) throw new HttpFailure(429);
    const id = randomUUID();
    const server = new Server({ name: 'agent-device-mcp', version: '1.0.1' }, { capabilities: { tools: { listChanged: false } },
      instructions: 'Use configured device tools. Read current identity and revisions before a write. Never automatically retry an ambiguous write with a new identity. A queued or sent result is not optical verification or agent task success.' });
    const transport = new JsonResponseTransport(id, limits.maxResponseBytes);
    const session: Session = { server, transport, principalId: principal.id, version, ready: false, requests: new Set(), calls: new Set() };
    sessions.set(id, session);
    server.oninitialized = () => { session.ready = true; };
    server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
      if (request.params?.cursor !== undefined) throw new McpError(ErrorCode.InvalidParams, 'Pagination is not supported');
      const principal = extra.authInfo?.extra?.principal;
      return { tools: validPrincipal(principal) ? authorizedTools(options.registry, list, principal) : [] };
    });
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const principal = extra.authInfo?.extra?.principal;
      if (!validPrincipal(principal)) return gatewayFailure('unauthenticated');
      const tool = tools.get(request.params.name);
      if (!tool) throw new McpError(ErrorCode.InvalidParams, 'Unknown tool');
      if (request.params.task !== undefined) throw new McpError(ErrorCode.InvalidParams, 'Task execution is not supported');
      if (operations >= limits.maxInFlight) return gatewayFailure('capacity');
      operations++;
      const rpcId = `${typeof extra.requestId}:${extra.requestId}`;
      session.calls.add(rpcId);
      try {
        let dispatched = false;
        const work = invokeDeviceTool(options.registry, tool, request.params.arguments ?? {}, principal,
          { signal: extra.signal, maxResponseBytes: limits.maxResponseBytes / 2, onDispatch: () => { dispatched = true; } }).finally(() => { operations--; });
        const args = request.params.arguments ?? {};
        const requestId = requestIdentity(args);
        const result = await deadline(work, limits.requestTimeoutMs, () => gatewayFailure(dispatched && tool.annotations?.readOnlyHint !== true ? 'uncertain-result' : 'transport-failure',
          dispatched && tool.annotations?.readOnlyHint !== true ? 'possible' : 'none', requestId));
        if (Buffer.byteLength(JSON.stringify({ jsonrpc: '2.0', id: extra.requestId, result })) > limits.maxResponseBytes) return gatewayFailure('capacity',
          dispatched && tool.annotations?.readOnlyHint !== true ? 'possible' : 'none', requestId);
        return result;
      } finally { session.calls.delete(rpcId); }
    });
    try { await server.connect(transport); touch(id, session); return session; }
    catch (error) { await remove(id); throw error; }
  }
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (closed || !options.enabled) { reject(res, 404); return; }
    if (httpActive >= limits.maxInFlight) { reject(res, 429); return; }
    httpActive++;
    let newSession: Session | undefined;
    try {
      let host: string, suppliedOrigin: string | undefined;
      try { host = authority(singleHeader(req, 'host', true)!); suppliedOrigin = singleHeader(req, 'origin');
        if (suppliedOrigin !== undefined) suppliedOrigin = origin(suppliedOrigin); } catch { throw new HttpFailure(403); }
      if (!hosts.has(host) || (suppliedOrigin !== undefined && !origins.has(suppliedOrigin))) throw new HttpFailure(403);
      const site = singleHeader(req, 'sec-fetch-site');
      if (site === 'cross-site' || (site !== undefined && !['none', 'same-origin', 'same-site'].includes(site))
          || (options.allowFetchMetadata && !options.allowFetchMetadata(req.headers))) throw new HttpFailure(403);
      const authorization = singleHeader(req, 'authorization', true)!;
      const match = /^Bearer ([A-Za-z0-9\-._~+/]+=*)$/i.exec(authorization);
      if (!match || match[1].length > 4096) throw new HttpFailure(401);
      if (verifications >= limits.maxInFlight) throw new HttpFailure(429);
      verifications++;
      const abort = new AbortController();
      const verification = Promise.resolve().then(() => options.authenticate(match[1], abort.signal)).catch(() => null).finally(() => { verifications--; });
      const principal = await deadline(verification, limits.authenticationTimeoutMs, () => { abort.abort(); return null; });
      if (!validPrincipal(principal)) throw new HttpFailure(401);
      if (closed) throw new HttpFailure(503);
      const sessionId = singleHeader(req, 'mcp-session-id');
      let session = sessionId === undefined ? undefined : sessions.get(sessionId);
      if (sessionId !== undefined && !session) throw new HttpFailure(404);
      if (session && session.principalId !== principal.id) throw new HttpFailure(403);
      if (!['POST', 'DELETE'].includes(req.method ?? '')) throw new HttpFailure(405);
      if (req.method === 'DELETE') {
        if (!session || !sessionId) throw new HttpFailure(400);
        if (singleHeader(req, 'mcp-protocol-version') !== session.version) throw new HttpFailure(400);
        await remove(sessionId); res.writeHead(200, { 'Cache-Control': 'no-store' }); res.end(); return;
      }
      if (req.readableEnded || req.readableEncoding) throw new HttpFailure(400);
      const type = singleHeader(req, 'content-type', true);
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(type ?? '')) throw new HttpFailure(415);
      const accept = singleHeader(req, 'accept', true)!;
      if (!accept.includes('application/json') || !accept.includes('text/event-stream')) throw new HttpFailure(406);
      const contentLength = singleHeader(req, 'content-length');
      if (contentLength !== undefined && (!/^\d+$/.test(contentLength) || Number(contentLength) > limits.maxBodyBytes)) throw new HttpFailure(429);
      const parsed = await body(req, limits) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !boundedJson(parsed, limits.maxBodyBytes * 6)
          || parsed.jsonrpc !== '2.0' || typeof parsed.method !== 'string') throw new HttpFailure(400);
      if (closed) throw new HttpFailure(503);
      if (parsed.id !== undefined && (!['number', 'string'].includes(typeof parsed.id)
          || (typeof parsed.id === 'number' && !Number.isSafeInteger(parsed.id)))) throw new HttpFailure(400);
      // Measure the same identity returned by the handler, including both serialized copies.
      const params = parsed.params as { arguments?: unknown } | undefined;
      const identity = parsed.method === 'tools/call' ? requestIdentity(params?.arguments) : undefined;
      if (parsed.id !== undefined && Buffer.byteLength(JSON.stringify({ jsonrpc: '2.0', id: parsed.id,
        result: gatewayFailure('uncertain-result', 'possible', identity ?? 'x'.repeat(128)) })) > limits.maxResponseBytes) throw new HttpFailure(429);
      const version = singleHeader(req, 'mcp-protocol-version');
      if (parsed.method === 'initialize') {
        const params = parsed.params as { protocolVersion?: string } | undefined;
        if (session || !params || !MCP_PROTOCOL_VERSIONS.includes(params.protocolVersion ?? '')
            || (version !== undefined && version !== params.protocolVersion)) throw new HttpFailure(400);
        session = newSession = await initialize(principal, params.protocolVersion!);
      } else {
        if (!session || !sessionId || sessions.get(sessionId) !== session) throw new HttpFailure(sessionId ? 404 : 400);
        if (version !== session.version) throw new HttpFailure(400);
        if (!session.ready && parsed.method !== 'notifications/initialized') throw new HttpFailure(400);
      }
      touch(session.transport.sessionId ?? [...sessions].find(([, candidate]) => candidate === session)![0], session);
      const request = req as IncomingMessage & { auth?: AuthInfo };
      request.auth = { token: '', clientId: principal.id, scopes: [...principal.credential.scopes], extra: { principal: structuredClone(principal) } };
      res.setHeader('Cache-Control', 'no-store');
      const rpcId = parsed.id === undefined ? undefined : `${typeof parsed.id}:${parsed.id}`;
      if (rpcId !== undefined && ((session.requests.has(rpcId) || session.calls.has(rpcId)) || !['number', 'string'].includes(typeof parsed.id)
          || (typeof parsed.id === 'number' && !Number.isSafeInteger(parsed.id)))) throw new HttpFailure(400);
      if (rpcId !== undefined) session.requests.add(rpcId);
      try { await session.transport.handleRequest(request, res, parsed); }
      finally { if (rpcId !== undefined) session.requests.delete(rpcId); }
      if (newSession && !newSession.transport.sessionId) {
        const entry = [...sessions].find(([, candidate]) => candidate === newSession);
        if (entry) await remove(entry[0]);
      }
    } catch (error) {
      if (newSession && !newSession.transport.sessionId) {
        const entry = [...sessions].find(([, candidate]) => candidate === newSession);
        if (entry) await remove(entry[0]);
      }
      reject(res, error instanceof HttpFailure ? error.status : 500);
    } finally { httpActive--; }
  }
  return Object.freeze({ handle, async close() { closed = true; await Promise.all([...sessions.keys()].map(remove)); } });
}
