import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {createHash, randomUUID, timingSafeEqual} from 'node:crypto';
import {createAgentState, type Consumer, type Identity} from '@jimmie-potts/agent-state';
import {HubStorage, type HubLease} from './storage.js';
import {ControllerClient, type ControllerConfig} from './controllers.js';
import {HttpError, canonical, exact, id, object} from './common.js';

type Scope = 'read'|'ingest'|'control'|'admin';
export type Credential = {id:string; digest:string; scopes:Scope[]; devices:string[]};
export type HubOptions = {directory:string; ownerId:string; consumers:Consumer[]; credentials:Credential[]; controllers:ControllerConfig[]; port?:number};
type Ledger = {epoch:string; sequence:number; results:Map<string,{body:string; result:Promise<unknown>}>};

function credentials(input: Credential[]): Credential[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 32 || new Set(input.map(c => c.id)).size !== input.length ||
      new Set(input.map(c => c.digest)).size !== input.length || input.some(c => !id(c.id) || !/^[a-f0-9]{64}(?![\s\S])/.test(c.digest) ||
        !Array.isArray(c.scopes) || c.scopes.length > 4 || c.scopes.some(s => !['read','ingest','control','admin'].includes(s)) ||
        !Array.isArray(c.devices) || c.devices.length > 16 || c.devices.some(d => !id(d)))) throw new Error('invalid-credentials');
  return structuredClone(input);
}
function json(res: ServerResponse, status: number, value: unknown) {
  if (res.destroyed) return;
  res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(JSON.stringify(value));
}
async function body(req: IncomingMessage, maximum: number): Promise<unknown> {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json' || req.headers['content-encoding']) throw new HttpError('invalid-input',400);
  if (Number(req.headers['content-length'] ?? 0) > maximum) throw new HttpError('capacity',413);
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length; if (size > maximum) throw new HttpError('capacity',413); chunks.push(chunk);
  }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))); }
  catch { throw new HttpError('invalid-input',400); }
  const pending: [unknown,number][] = [[value,0]]; let nodes = 0;
  while (pending.length) {
    const [item,depth] = pending.pop()!;
    if (++nodes > 10000 || depth > 20) throw new HttpError('invalid-input',400);
    if (item && typeof item === 'object') for (const child of Object.values(item)) pending.push([child,depth+1]);
  }
  return value;
}

export async function startHub(options: HubOptions) {
  let currentCredentials = credentials(options.credentials);
  if (!Array.isArray(options.controllers) || options.controllers.length > 16 || new Set(options.controllers.map(c => c.id)).size !== options.controllers.length ||
      new Set(options.controllers.map(c => c.controllerId + ':' + c.deviceId)).size !== options.controllers.length ||
      (options.port !== undefined && (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535))) throw new Error('invalid-configuration');
  const clients = new Map(options.controllers.map(config => [config.id,new ControllerClient(config)]));
  let lease: HubLease | undefined;
  const storage = new HubStorage(options.directory);
  const owner = await createAgentState({ownerId:options.ownerId,consumers:options.consumers,storage:{acquire:async (ownerId,signal) => {
    lease = await storage.acquire(ownerId,signal) as HubLease;
    if (lease.fenced()) { await lease.release(); throw new Error('owner-quiesced'); }
    return lease;
  }}}).catch(async error => {
    // Keep a stable operator error without exposing database paths.
    const probe = await storage.acquire(options.ownerId,new AbortController().signal).catch(() => null) as HubLease | null;
    if (probe) { const fenced = probe.fenced(); await probe.release(); if (fenced) throw new Error('owner-quiesced'); }
    throw error;
  });
  const ledgers = new Map<string,Ledger>();
  const streams = new Set<ServerResponse>();
  const streamOwners = new Map<ServerResponse,string>();
  let active = 0, rejected = 0, closing = false;
  let origin = '';
  const ledger = (principal: string) => {
    let value = ledgers.get(principal);
    if (!value) { value = {epoch:randomUUID(),sequence:0,results:new Map()};ledgers.set(principal,value); }
    return value;
  };
  const ticket = (entry: Ledger) => `${entry.epoch}:${entry.sequence}`;
  const authorize = (req: IncomingMessage, scope: Scope, device?: string): Credential => {
    const token = req.headers.authorization;
    if (typeof token !== 'string' || !/^Bearer [A-Za-z0-9_-]{43}(?![\s\S])/.test(token)) throw new HttpError('unauthenticated',401);
    const digest = createHash('sha256').update(token.slice(7)).digest();
    const principal = currentCredentials.find(c => timingSafeEqual(digest,Buffer.from(c.digest,'hex')));
    if (!principal) throw new HttpError('unauthenticated',401);
    if (req.headers.host !== origin.slice(7) || (req.headers.origin !== undefined && req.headers.origin !== origin) ||
        ![undefined,'none','same-origin'].includes(req.headers['sec-fetch-site'] as string | undefined) ||
        !principal.scopes.includes(scope) || (device !== undefined && !principal.devices.includes(device))) throw new HttpError('forbidden',403);
    if (req.method !== 'GET' && req.headers['x-pixoo-request'] !== '1') throw new HttpError('forbidden',403);
    return principal;
  };
  async function command(principal: Credential, input: unknown) {
    if (!object(input) || typeof input.requestId !== 'string' || input.requestId.length > 100) throw new HttpError('invalid-input',400);
    const keys = input.operation === 'label' ? ['operation','requestId','identity','label'] : input.operation === 'acknowledge' ? ['operation','requestId','identity','noticeId','consumerId'] : ['operation','requestId'];
    if (!exact(input,keys) || !['label','acknowledge','quiesce'].includes(input.operation as string)) throw new HttpError('invalid-input',400);
    if (input.operation === 'quiesce' && !principal.scopes.includes('admin')) throw new HttpError('forbidden',403);
    const entry = ledger(principal.id), fingerprint = canonical(input), old = entry.results.get(input.requestId);
    if (old) { if (old.body !== fingerprint) throw new HttpError('request-conflict',409);return old.result; }
    if (input.requestId !== ticket(entry)) {
      const suffix = input.requestId.slice(entry.epoch.length + 1);
      const future = input.requestId.startsWith(entry.epoch + ':') && /^[0-9]+$/.test(suffix) && Number(suffix) > entry.sequence;
      throw new HttpError(future ? 'request-order' : 'request-expired',future ? 409 : 410);
    }
    if (entry.sequence >= Number.MAX_SAFE_INTEGER) throw new HttpError('capacity',429);
    entry.sequence++;
    const result = Promise.resolve().then(async () => {
      if (input.operation === 'label') return owner.setLabel(input.identity as Identity,input.label as string | null);
      if (input.operation === 'acknowledge') return owner.acknowledge(input.identity as Identity,input.noticeId as string,input.consumerId as string);
      // Persist before releasing an export, including if export subsequently fails.
      lease!.setFence(true); return owner.exportState();
    });
    entry.results.set(input.requestId,{body:fingerprint,result});
    if (entry.results.size > 256) entry.results.delete(entry.results.keys().next().value!);
    return result;
  }
  const server = createServer({maxHeaderSize:8192,requestTimeout:3000,headersTimeout:3000},(req,res) => {
    void (async () => {
      if (closing || active >= 32) { rejected = Math.min(Number.MAX_SAFE_INTEGER,rejected+1);json(res,503,{error:{code:'capacity'}});return; }
      active++;
      const timer = setTimeout(() => res.destroy(),3000);
      let streaming = false;
      try {
        if (!req.url?.startsWith('/') || req.url.startsWith('//')) throw new HttpError('invalid-input',400);
        const url = new URL(req.url,origin), path = url.pathname;
        if (url.origin !== origin) throw new HttpError('invalid-input',400);
        const route = /^\/api\/controllers\/v1\/([A-Za-z0-9_.-]{1,128})\/(snapshot|commands)$/.exec(path);
        const scope = req.method === 'GET' ? 'read' : path === '/api/monitor/v1/events' ? 'ingest' : 'control';
        const principal = authorize(req,scope,route?.[1]);
        if (req.method === 'GET' && path === '/api/monitor/v1/sessions') {
          const snapshot = owner.snapshot();
          const view: Record<string,unknown> = {apiVersion:'1.0',ownerId:options.ownerId,connection:'current',snapshot,admissionRejected:rejected,nextRequestId:ticket(ledger(principal.id))};
          if (url.search) {
            if ([...url.searchParams.keys()].some(k => !['q','provider'].includes(k)) || (url.searchParams.get('q')?.length ?? 0) > 160 ||
                (url.searchParams.has('provider') && !['codex','claude'].includes(url.searchParams.get('provider')!))) throw new HttpError('invalid-input',400);
            const query = (url.searchParams.get('q') ?? '').toLowerCase(),provider = url.searchParams.get('provider');
            view.matching = snapshot.sessions.filter(s => (!provider || s.identity.provider === provider) && (s.label ?? s.identity.sessionId).toLowerCase().includes(query)).map(s => s.identity);
          }
          json(res,200,view);
        } else if (req.method === 'GET' && path === '/api/hub/v1/health' && !url.search) {
          const snapshot = owner.snapshot();
          json(res,snapshot.collector === 'running' ? 200 : 503,{apiVersion:'1.0',ownerId:options.ownerId,collector:snapshot.collector,revision:snapshot.revision,devices:[...clients.values()].map(c => c.status())});
        } else if (req.method === 'POST' && path === '/api/monitor/v1/events' && !url.search) {
          const result = await owner.ingest(await body(req,2048));
          json(res,result.ok ? 200 : result.code === 'invalid-event' ? 400 : result.code === 'capacity' ? 429 : 503,result);
        } else if (req.method === 'POST' && path === '/api/monitor/v1/commands' && !url.search) {
          json(res,200,await command(principal,await body(req,65536)));
        } else if (req.method === 'GET' && path === '/api/monitor/v1/changes' && !url.search) {
          if (streams.size >= 16) throw new HttpError('capacity',429);
          streaming = true;clearTimeout(timer); streams.add(res);streamOwners.set(res,principal.id);
          res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store','x-content-type-options':'nosniff'});
          let last = -1, blockedAt = 0;
          const publish = () => {
            try { authorize(req,'read'); } catch {res.destroy();return;}
            if (res.writableLength > 0) {if (!blockedAt) blockedAt = Date.now();if (Date.now()-blockedAt > 5000) res.destroy();return;}
            blockedAt = 0;
            const state = owner.snapshot();
            if (state.revision !== last) {
              const kind = last < 0 ? 'resync' : 'state';last = state.revision;
              res.write(`id: ${last}\nevent: ${kind}\ndata: ${JSON.stringify({ownerId:options.ownerId,revision:last,connection:'current',collector:state.collector,lossCount:state.lossCount})}\n\n`);
            } else res.write(': heartbeat\n\n');
          };
          publish();const interval = setInterval(publish,1000);interval.unref();
          res.once('close',() => {clearInterval(interval);streams.delete(res);streamOwners.delete(res);});
        } else if (route && !url.search && ((req.method === 'GET' && route[2] === 'snapshot') || (req.method === 'POST' && route[2] === 'commands'))) {
          const client = clients.get(route[1]);if (!client) throw new HttpError('unknown-device',404);
          json(res,200,route[2] === 'snapshot' ? await client.snapshot() : await client.command(await body(req,65536)));
        } else throw new HttpError('not-found',404);
      } catch (error) {
        const safe = error instanceof HttpError ? error : new HttpError('unavailable',503);
        if (!res.headersSent) json(res,safe.status,{error:{code:safe.code}});else res.destroy();
      } finally {active--;if (!streaming) {res.once('close',() => clearTimeout(timer));res.once('finish',() => clearTimeout(timer));}}
    })().catch(() => res.destroy());
  });
  server.maxConnections = 64;
  server.keepAliveTimeout = 1000;
  try {
    await new Promise<void>((resolve,reject) => {server.once('error',reject);server.listen(options.port ?? 0,'127.0.0.1',() => {server.off('error',reject);resolve();});});
  } catch (error) { await owner.shutdown();throw error; }
  origin = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  let closePromise: Promise<void> | undefined;
  return {
    url:origin,
    replaceCredentials(input:Credential[]) {
      currentCredentials = credentials(input);
      for (const stream of streams) stream.destroy();
      for (const key of ledgers.keys()) if (!currentCredentials.some(c => c.id === key)) ledgers.delete(key);
    },
    close(): Promise<void> {
      return closePromise ??= (async () => {
        closing = true;for (const client of clients.values()) client.close();for (const stream of streams) stream.destroy();
        await new Promise<void>((resolve,reject) => {server.close(error => error ? reject(error) : resolve());server.closeAllConnections();});
        await owner.shutdown();
      })();
    }
  };
}
