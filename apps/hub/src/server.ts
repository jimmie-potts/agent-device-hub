import {readFile} from 'node:fs/promises';
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {createHash, randomUUID, timingSafeEqual} from 'node:crypto';
import {createAgentState, type Consumer, type Identity, type DurableState} from '@jimmie-potts/agent-state';
import {HubStorage, type HubLease} from './storage.js';
import {ControllerClient, type ControllerConfig} from './controllers.js';
import {prepareActivation,type ActivationPlan} from './migration-routes.js';
import {consumeReleasedState,type ReleasedState} from './migration.js';
import {createHubMcp, HOST_SERVICE, type HubMcp} from './mcp.js';
import {HttpError, canonical, exact, id, object} from './common.js';

type Scope = 'read'|'ingest'|'control'|'admin';
export type Credential = {id:string; digest:string; scopes:Scope[]; devices:string[]};
export type HubOptions = {directory:string; ownerId:string; consumers:Consumer[]; credentials:Credential[]; controllers:ControllerConfig[]; port?:number; editorLinks?:Record<string,string>; mcp?:boolean};
type Replay = {body:string; result:Promise<unknown>; pending:boolean; bytes:number};
type Ledger = {epoch:string; sequence:number; results:Map<string,Replay>};

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

export async function startHub(options: HubOptions, migration?:{staged:true;released?:ReleasedState}) {
  if (migration !== undefined && (!object(migration) || migration.staged !== true || Object.keys(migration).some(key=>!['staged','released'].includes(key)))) throw new Error('invalid-migration');
  const imported = migration?.released ? consumeReleasedState(migration.released) : undefined;
  let staged = migration?.staged === true;
  let activationAllowed = imported !== undefined;
  let activating = false;
  if (options.mcp !== undefined && typeof options.mcp !== 'boolean') throw new Error('invalid-configuration');
  let currentCredentials = credentials(options.credentials);
  if (!Array.isArray(options.controllers) || options.controllers.length > 16 || new Set(options.controllers.map(c => c.id)).size !== options.controllers.length ||
      new Set(options.controllers.map(c => c.controllerId + ':' + c.deviceId)).size !== options.controllers.length ||
      (options.port !== undefined && (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535))) throw new Error('invalid-configuration');
  const editorLinks:Record<string,string> = {};
  if (options.editorLinks !== undefined) {
    if (!object(options.editorLinks) || Object.keys(options.editorLinks).length > 16) throw new Error('invalid-editor-links');
    for (const [alias,href] of Object.entries(options.editorLinks)) {
      const link = new URL(href);
      if (!options.controllers.some(c=>c.id===alias) || link.protocol!=='http:' || link.hostname!=='127.0.0.1' || link.username || link.password || link.search || link.hash) throw new Error('invalid-editor-links');
      editorLinks[alias]=link.href;
    }
  }
  const clients = new Map(options.controllers.map(config => [config.id,new ControllerClient(config)]));
  let lease: HubLease | undefined;
  const storage = new HubStorage(options.directory);
  const owner = await createAgentState({ownerId:options.ownerId,consumers:options.consumers,...(imported === undefined ? {} : {importState:imported}),storage:{acquire:async (ownerId,signal) => {
    lease = await storage.acquire(ownerId,signal) as HubLease;
    if (lease.fenced() && !staged) { await lease.release(); throw new Error('owner-quiesced'); }
    if (staged) lease.setFence(true);
    return lease;
  }}}).catch(async error => {
    // Keep a stable operator error without exposing database paths.
    const probe = await storage.acquire(options.ownerId,new AbortController().signal).catch(() => null) as HubLease | null;
    if (probe) { const fenced = probe.fenced(); await probe.release(); if (fenced) throw new Error('owner-quiesced'); }
    throw error;
  });
  const snapshot = () => {const value=owner.snapshot();return staged && value.collector==='running' ? {...value,collector:'quiesced' as const} : value;};
  const ledgers = new Map<string,Ledger>();
  const retained: {ledger:Ledger; key:string; replay:Replay}[] = [];
  let replayBytes = 0;
  let exported: Promise<DurableState> | undefined;
  const streams = new Set<ServerResponse>();
  const streamOwners = new Map<ServerResponse,string>();
  let active = 0, rejected = 0, closing = false;
  let origin = '';
  let mcp: HubMcp | undefined;
  const feedEpoch = randomUUID();let feedSequence = 0, feedSignature = '';
  const feedHistory: {sequence:number; body:string}[] = [];
  const ledger = (principal: string) => {
    let value = ledgers.get(principal);
    if (!value) { value = {epoch:randomUUID(),sequence:0,results:new Map()};ledgers.set(principal,value); }
    return value;
  };
  const ticket = (entry: Ledger) => `${entry.epoch}:${entry.sequence}`;
  const authenticate = (token:string):Credential|null => {
    if (!/^[A-Za-z0-9_-]{43}(?![\s\S])/.test(token)) return null;
    const digest = createHash('sha256').update(token).digest();
    return currentCredentials.find(c => timingSafeEqual(digest,Buffer.from(c.digest,'hex'))) ?? null;
  };
  const authorize = (req: IncomingMessage, scope: Scope, device?: string): Credential => {
    const token = req.headers.authorization;
    const principal = typeof token === 'string' && token.startsWith('Bearer ') ? authenticate(token.slice(7)) : null;
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
    if (input.operation !== 'quiesce' && (!object(input.identity) || !exact(input.identity,['provider','client','hostId','sourceId','sessionId']) ||
        !['codex','claude'].includes(input.identity.provider as string) || !['cli','desktop','code'].includes(input.identity.client as string) ||
        !id(input.identity.hostId) || !id(input.identity.sourceId) || !id(input.identity.sessionId))) throw new HttpError('invalid-input',400);
    if (input.operation === 'label' && input.label !== null && (typeof input.label !== 'string' || input.label.length > 160)) throw new HttpError('invalid-input',400);
    if (input.operation === 'acknowledge' && (!id(input.noticeId) || !options.consumers.some(c => c.id === input.consumerId))) throw new HttpError('invalid-input',400);
    if (input.operation === 'quiesce' && !principal.scopes.includes('admin')) throw new HttpError('forbidden',403);
    if (staged && input.operation !== 'quiesce') throw new HttpError('owner-quiesced',503);
    const entry = ledger(principal.id), fingerprint = canonical(input), old = entry.results.get(input.requestId);
    if (old) { if (old.body !== fingerprint) throw new HttpError('request-conflict',409);return old.result; }
    if (input.requestId !== ticket(entry)) {
      const suffix = input.requestId.slice(entry.epoch.length + 1);
      const future = input.requestId.startsWith(entry.epoch + ':') && /^[0-9]+$/.test(suffix) && Number(suffix) > entry.sequence;
      throw new HttpError(future ? 'request-order' : 'request-expired',future ? 409 : 410);
    }
    if (entry.sequence >= Number.MAX_SAFE_INTEGER) throw new HttpError('capacity',429);
    const bytes = Buffer.byteLength(fingerprint);
    while (retained.length >= 256 || replayBytes + bytes > 262144) {
      const index = retained.findIndex(item => !item.replay.pending);
      if (index < 0) throw new HttpError('capacity',429);
      const [expired] = retained.splice(index,1);expired.ledger.results.delete(expired.key);replayBytes -= expired.replay.bytes;
    }
    entry.sequence++;
    const result = Promise.resolve().then(async () => {
      if (input.operation === 'label') return owner.setLabel(input.identity as Identity,input.label as string | null);
      if (input.operation === 'acknowledge') return owner.acknowledge(input.identity as Identity,input.noticeId as string,input.consumerId as string);
      // Persist before releasing an export, including if export subsequently fails.
      lease!.setFence(true); activationAllowed=false; return exported ??= owner.exportState();
    });
    const replay = {body:fingerprint,result,pending:true,bytes};
    entry.results.set(input.requestId,replay);retained.push({ledger:entry,key:input.requestId,replay});replayBytes += bytes;
    void result.then(() => {replay.pending = false;},() => {replay.pending = false;});
    return result;
  }
  const sessions = (principal:Credential, query='', provider?:string) => {
    const current = snapshot();
    return {apiVersion:'1.0',ownerId:options.ownerId,connection:'current',snapshot:current,admissionRejected:rejected,nextRequestId:ticket(ledger(principal.id)),
      matches:current.sessions.filter(s => (!provider || s.identity.provider === provider) && (s.label ?? s.identity.sessionId).toLowerCase().includes(query.toLowerCase())).map(s=>s.identity)};
  };
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
        if (req.method === 'GET' && !url.search && ['/', '/dashboard.js', '/dashboard.css'].includes(path)) {
          if (req.headers.host !== origin.slice(7) || (req.headers.origin !== undefined && req.headers.origin !== origin) || ![undefined,'none','same-origin'].includes(req.headers['sec-fetch-site'] as string | undefined)) throw new HttpError('forbidden',403);
          const asset = path === '/' ? 'index.html' : path.slice(1);
          const bytes = await readFile(new URL('../public/' + asset,import.meta.url)).catch(()=>null);
          if (!bytes) throw new HttpError('not-found',404);
          res.writeHead(200,{'content-type':asset.endsWith('.html')?'text/html; charset=utf-8':asset.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"});
          res.end(bytes);return;
        }
        if (path === '/mcp') {
          if (!mcp || url.search) throw new HttpError('not-found',404);
          await mcp.handle(req,res);return;
        }
        const route = /^\/api\/controllers\/v1\/([A-Za-z0-9_.-]{1,128})\/(snapshot|commands)$/.exec(path);
        const integrationRoute = /^\/api\/controllers\/v1\/([A-Za-z0-9_.-]{1,128})\/integration\/(snapshot|commands|receipt|cancel)$/.exec(path);
        const scope = path === '/api/hub/v1/authority' && ['read','control','ingest'].includes(url.searchParams.get('scope') ?? '') ? url.searchParams.get('scope') as Scope : req.method === 'GET' ? 'read' : path === '/api/monitor/v1/events' ? 'ingest' : 'control';
        const principal = authorize(req,scope,route?.[1] ?? integrationRoute?.[1]);
        if (req.method === 'GET' && path === '/api/dashboard/v1/context' && !url.search) {
          json(res,200,{apiVersion:'1.0',control:principal.scopes.includes('control'),consumers:options.consumers.map(c=>c.id),components:[...clients.values()].filter(c=>principal.devices.includes(c.config.id)).map(c=>({...c.status(),...(editorLinks[c.config.id]?{editorUrl:editorLinks[c.config.id]}:{})}))});
        } else if (req.method === 'GET' && path === '/api/hub/v1/authority' && [...url.searchParams.keys()].length === 1 && ['read','control','ingest'].includes(url.searchParams.get('scope') ?? '')) {
          authorize(req,url.searchParams.get('scope') as Scope);json(res,200,{ownerId:options.ownerId,scope:url.searchParams.get('scope')});
        } else if (req.method === 'GET' && path === '/api/monitor/v1/sessions') {
          if ([...url.searchParams.keys()].some(k => !['q','provider'].includes(k)) || (url.searchParams.get('q')?.length ?? 0) > 120 ||
              (url.searchParams.has('provider') && !['codex','claude'].includes(url.searchParams.get('provider')!))) throw new HttpError('invalid-input',400);
          json(res,200,sessions(principal,url.searchParams.get('q') ?? '',url.searchParams.get('provider') ?? undefined));
        } else if (req.method === 'GET' && path === '/api/hub/v1/health' && !url.search) {
          const current = snapshot();
          json(res,current.collector === 'running' ? 200 : 503,{apiVersion:'1.0',ownerId:options.ownerId,collector:current.collector,revision:current.revision,devices:[...clients.values()].map(c => c.status())});
        } else if (req.method === 'POST' && path === '/api/monitor/v1/events' && !url.search) {
          if (staged) throw new HttpError('owner-quiesced',503);
          const result = await owner.ingest(await body(req,2048));
          json(res,result.ok ? 200 : result.code === 'invalid-event' ? 400 : result.code === 'capacity' ? 429 : 503,result);
        } else if (req.method === 'POST' && path === '/api/monitor/v1/commands' && !url.search) {
          json(res,200,await command(principal,await body(req,65536)));
        } else if (req.method === 'GET' && path === '/api/monitor/v1/changes' && !url.search) {
          if (streams.size >= 16) throw new HttpError('capacity',429);
          streaming = true;clearTimeout(timer); streams.add(res);streamOwners.set(res,principal.id);
          res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store','x-content-type-options':'nosniff'});
          let lastSequence: number | undefined, blockedAt = 0;
          const publish = () => {
            try { authorize(req,'read'); } catch {res.destroy();return;}
            if (res.writableLength > 0) {if (!blockedAt) blockedAt = Date.now();if (Date.now()-blockedAt > 5000) res.destroy();return;}
            blockedAt = 0;
            const state = snapshot();
            const projection = {apiVersion:'1.0',ownerId:options.ownerId,revision:state.revision,connection:'current',collector:state.collector,lossCount:state.lossCount,admissionRejected:rejected,uncertain:state.sessions.filter(s => s.freshness === 'uncertain').length};
            const fingerprint = JSON.stringify(projection);
            const message = (event:string) => `id: ${feedEpoch}:${feedSequence}\nevent: ${event}\ndata: ${fingerprint}\n\n`;
            if (fingerprint !== feedSignature) {
              feedSignature = fingerprint;feedSequence++;
              feedHistory.push({sequence:feedSequence,body:message('state')});
              if (feedHistory.length > 32) feedHistory.shift();
            }
            const first = feedHistory[0]?.sequence ?? feedSequence;
            if (lastSequence === undefined) {
              const cursor = req.headers['last-event-id'], prefix = feedEpoch + ':';
              const sequence = typeof cursor === 'string' && cursor.startsWith(prefix) ? Number(cursor.slice(prefix.length)) : NaN;
              if (typeof cursor === 'string' && cursor === prefix + sequence && Number.isSafeInteger(sequence) && sequence >= first-1 && sequence <= feedSequence) lastSequence = sequence;
              else {lastSequence = feedSequence;res.write(message('resync'));return;}
            }
            if (lastSequence < first-1) res.write(message('resync'));
            else res.write(feedHistory.filter(event => event.sequence > lastSequence!).map(event => event.body).join('') || ': heartbeat\n\n');
            lastSequence = feedSequence;
          };
          publish();const interval = setInterval(publish,1000);interval.unref();
          res.once('close',() => {clearInterval(interval);streams.delete(res);streamOwners.delete(res);});
        } else if (integrationRoute) {
          const client = clients.get(integrationRoute[1]);if (!client) throw new HttpError('unknown-device',404);
          const operation = integrationRoute[2];
          if (req.method === 'GET' && operation === 'snapshot' && !url.search) json(res,200,await client.integrationSnapshot());
          else if (req.method === 'GET' && operation === 'receipt' && [...url.searchParams.keys()].length === 2 && url.searchParams.has('epoch') && /^[0-9]+$/.test(url.searchParams.get('sequence') ?? ''))
            {const response = await client.integrationReceipt({epoch:url.searchParams.get('epoch'),sequence:Number(url.searchParams.get('sequence'))});json(res,response.status,response.body);}
          else if (req.method === 'POST' && !url.search && operation === 'commands') {const receipt = await client.integrationCommand(await body(req,65536));json(res,receipt.status,receipt.body);}
          else if (req.method === 'POST' && !url.search && operation === 'cancel') {const response = await client.integrationCancel(await body(req,65536));json(res,response.status,response.body);}
          else throw new HttpError('invalid-input',400);
        } else if (route && !url.search && ((req.method === 'GET' && route[2] === 'snapshot') || (req.method === 'POST' && route[2] === 'commands'))) {
          const client = clients.get(route[1]);if (!client) throw new HttpError('unknown-device',404);
          if (route[2] === 'snapshot') json(res,200,await client.snapshot());
          else {const response = await client.command(await body(req,65536));json(res,response.status,response.body);}
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
  try {
    if (options.mcp) mcp = createHubMcp({origin,clients,authenticate,principal:(id,scope,device) => {
      const value=currentCredentials.find(c=>c.id===id);
      if (!value || !value.scopes.includes(scope) || (device !== HOST_SERVICE && !value.devices.includes(device))) throw new HttpError('forbidden',403);
      return value;
    },sessions,command});
  } catch(error) {
    await new Promise<void>(resolve=>server.close(()=>resolve()));await owner.shutdown();throw error;
  }
  let closePromise: Promise<void> | undefined;
  return {
    url:origin,
    staged:() => staged,
    async activate(plan:ActivationPlan) {
      if (!staged || !activationAllowed || activating || closing) throw new Error('activation-unavailable');
      activating=true;activationAllowed=false;
      try {
        await prepareActivation(plan,origin,options.ownerId,options.consumers,snapshot);
        if (closing || exported || owner.snapshot().collector!=='running') throw new Error('activation-unavailable');
        lease!.setFence(false);staged=false;
      } finally {activating=false;}
    },

    replaceCredentials(input:Credential[]) {
      currentCredentials = credentials(input);
      for (const stream of streams) stream.destroy();
      for (const key of ledgers.keys()) if (!currentCredentials.some(c => c.id === key)) ledgers.delete(key);
    },
    close(): Promise<void> {
      return closePromise ??= (async () => {
        closing = true;await mcp?.close();for (const client of clients.values()) client.close();for (const stream of streams) stream.destroy();
        await new Promise<void>((resolve,reject) => {server.close(error => error ? reject(error) : resolve());server.closeAllConnections();});
        await owner.shutdown();
      })();
    }
  };
}
