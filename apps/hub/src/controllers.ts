import {commandDiagnosticAttributes,type CommandDiagnostics} from './diagnostics.js';
import {validate, type Request, type Receipt, type RequestV1_1, type ReceiptV1_1, type Snapshot, type SnapshotV1_1} from '@jimmie-potts/device-contracts';
import {HttpError, id, loopbackEndpoint, responseJson, object, exact} from './common.js';
import {pixooCatalogPath,validateCatalogReply,previewReply,type CatalogOperation,type Representation} from './pixoo-catalog.js';
import {validatePixooRequest,validatePixooSnapshot} from './pixoo-integration.js';
import {validateIntegrationSnapshot,validateIntegrationReceipt,validateIntegrationGeometry} from './integration.js';
import {validateRequest as validateIntegrationRequest,ticket as integrationTicket,apiVersion as integrationVersion,type Ticket} from './vendor/nanoleaf-integration.js';
import {validateLightingRequest,validateLightingSnapshot} from './lifx-lighting.js';

export type ControllerKind = 'pixoo'|'nanoleaf'|'tidbyt'|'lifx';
export const CONTROLLER_KINDS: readonly ControllerKind[] = ['pixoo','nanoleaf','tidbyt','lifx'];
export type ControllerConfig = {id:string; kind:ControllerKind; controllerId:string; deviceId:string; endpoint:string; token:string};
/** What the hub has learned about the contract versions a controller serves. `1.0-only` and `1.1` name the controller epoch of the answer. */
export type Negotiation = {verdict:'unknown'} | {verdict:'1.0-only'|'1.1'; epoch:string};

/** The longest a send waits for a controller's busy slot. Reads never wait. */
export const MAX_SLOT_WAIT_MS = 2500;
/** A held controller slot: its calls run inside the hold, and none is accepted after the hold ends. */
export type ControllerSlot = {
  /** The negotiated read: a 1.1 snapshot from a controller that serves it, else the 1.0 snapshot. */
  snapshot(version: '1.1'): Promise<Snapshot|SnapshotV1_1>;
  /** One 1.1 moment request, POSTed once. */
  momentCommand(value: unknown): Promise<{status:number;body:ReceiptV1_1}>;
};

/** One bounded slot per device, with no queue shared by different controllers. Only sends wait for it, in arrival order and for a bounded time. */
export class ControllerClient {
  private busy = false;
  /** Sends waiting for the slot. A release hands the slot straight to the oldest, so a read never slips in between. */
  private waiters: {grant(): void; fail(error: HttpError): void}[] = [];
  private abort?: AbortController;
  private stopped = false;
  private health: 'unknown'|'ready'|'unavailable' = 'unknown';
  /** In memory only: a new client, and so a hub start, holds none and probes on its first 1.1 read. */
  private served?: {version:'1.0'|'1.1'; epoch:string};
  readonly config: Readonly<ControllerConfig>;
  constructor(config: ControllerConfig, readonly timeoutMs = 2000, private readonly diagnostics?:CommandDiagnostics) {
    const url = loopbackEndpoint(config.endpoint);
    if (!id(config.id) || !id(config.controllerId) || !id(config.deviceId) || !CONTROLLER_KINDS.includes(config.kind) ||
        !/^[A-Za-z0-9_-]{43}(?![\s\S])/.test(config.token) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2500 ||
        url.pathname !== '/controller/v1') throw new Error('invalid-controller');
    this.config = Object.freeze({...config});
  }
  status() { return {id:this.config.id,kind:this.config.kind,controllerId:this.config.controllerId,deviceId:this.config.deviceId,health:this.health,pending:this.busy ? 1 : 0}; }
  /** `integration` selects the device's integration API; `lighting` selects the LIFX `lifx-light` profile route. */
  /** `optional` marks a read route an older owner may lack: its 404 means unsupported, not unavailable. */
  private request(path: string, body?: unknown, integration: boolean|'lighting' = false, optional = false): Promise<{status:number;value:unknown}> {
    return this.exclusive(() => this.send(path,body,integration,optional));
  }
  /**
   * Holds the controller's one slot for `run`, which may make several calls, so no other caller interleaves.
   * With `waitMs` 0, as every read uses, a busy slot is an immediate `capacity`. A send may wait up to `waitMs`.
   */
  private async exclusive<T>(run: () => Promise<T>, waitMs = 0): Promise<T> {
    if (this.stopped) throw new HttpError('controller-unavailable',503);
    if (!this.busy) this.busy = true;
    else if (waitMs <= 0) throw new HttpError('capacity',429);
    else await new Promise<void>((resolve,reject) => {
      const waiter = {grant: () => { clearTimeout(timer); resolve(); }, fail: (error: HttpError) => { clearTimeout(timer); reject(error); }};
      const timer = setTimeout(() => { this.waiters.splice(this.waiters.indexOf(waiter),1); reject(new HttpError('capacity',429)); },waitMs);
      this.waiters.push(waiter);
    });
    try { return await run(); } finally { this.release(); }
  }
  private release() {
    const next = this.waiters.shift();
    if (next) next.grant(); else this.busy = false;
  }
  /**
   * Holds this controller's one slot for `use`, waiting at most `waitMs` (up to MAX_SLOT_WAIT_MS) for a busy slot.
   * Only sends call this; a wait that expires is `capacity` with nothing sent to the controller.
   */
  hold<T>(waitMs: number, use: (slot: ControllerSlot) => Promise<T>): Promise<T> {
    if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > MAX_SLOT_WAIT_MS) throw new Error('invalid-slot-wait');
    return this.exclusive(async () => {
      let held = true;
      const within = <R>(call: () => Promise<R>): Promise<R> => held ? call() : Promise.reject(new Error('slot-released'));
      try {
        return await use({snapshot: () => within(() => this.negotiatedRead()),
          momentCommand: value => within(async () => this.postMoment(this.momentRequest(value)))});
      } finally { held = false; }
    },waitMs);
  }
  /** One bounded call inside a held slot. */
  private async send(path: string, body?: unknown, integration: boolean|'lighting' = false, optional = false): Promise<{status:number;value:unknown}> {
    if (this.stopped) throw new HttpError('controller-unavailable',503);
    const abort = new AbortController(); this.abort = abort;
    const timer = setTimeout(() => abort.abort(),this.timeoutMs);
    try {
      const endpoint = integration ? this.config.endpoint.replace(/\/controller\/v1$/,integration === 'lighting' ? '/controller/lifx-light/v1' : this.config.kind === 'pixoo' ? '/controller/pixoo-integration/v1' : '/controller/integration/v1') : this.config.endpoint;
      const response = await fetch(endpoint + path, {method:body === undefined ? 'GET' : 'POST', redirect:'error',signal:abort.signal,
        headers:{authorization:`Bearer ${this.config.token}`,'content-type':'application/json','x-pixoo-request':'1',...this.diagnostics?.headers()},
        ...(body === undefined ? {} : {body:JSON.stringify(body)})});
      const value = await responseJson(response,1024 * 1024);
      if (!response.ok) {
        // A typed receipt can describe an admitted rejection. Preserve its ticket below.
        if (body !== undefined && (integration === true ? validateIntegrationReceipt(value) : validate('receipt',value) || validate('receiptV1_1',value))) return {status:response.status,value};
        if (integration && this.config.kind === 'pixoo' && object(value) && object(value.error)) {
          const codes:Record<string,number> = {'unauthenticated':401,'forbidden':403,'invalid-input':400,'unknown-device':404,'revision-conflict':409,'stale-generation':409,'request-conflict':409,'request-expired':410,'request-order':409,'capacity':429,'monitor-unavailable':503};
          if (typeof value.error.code === 'string' && codes[value.error.code] === response.status) throw new HttpError(value.error.code,response.status);
        }
        if (optional && response.status === 404 && object(value) && exact(value,['failure']) && object(value.failure) && exact(value.failure,['code']) &&
            value.failure.code === 'invalid-request') throw new HttpError('unsupported-capability',422);
        const mapping: Record<string,number> = {'unauthenticated':401,'forbidden':403,'invalid-request':400,'unknown-device':404,
          'revision-conflict':409,'stale-generation':409,'request-conflict':409,'request-expired':410,'request-order':409,'capacity':429,'unsupported-capability':422};
        if (object(value) && exact(value,['failure']) && object(value.failure) && exact(value.failure,['code']) &&
            typeof value.failure.code === 'string' && mapping[value.failure.code] === response.status) throw new HttpError(value.failure.code,response.status);
        throw new Error('upstream-failure');
      }
      return {status:response.status,value};
    } catch (error) {
      if (error instanceof HttpError) throw error;
      this.health = 'unavailable';
      throw new HttpError(body === undefined ? 'controller-unavailable' : 'uncertain-result',503);
    } finally { clearTimeout(timer); this.abort = undefined; }
  }
  /** The contract versions this controller has answered with, for reporting and for the sender that needs a 1.1 read. */
  negotiation(): Negotiation {
    return this.served ? {verdict:this.served.version === '1.0' ? '1.0-only' : '1.1',epoch:this.served.epoch} : {verdict:'unknown'};
  }
  /** One snapshot read inside a held slot. A 1.1 read sends `apiVersion=1.1`; the answer is checked against the schema of the version it declares. */
  private async readSnapshot(version: '1.0'|'1.1'): Promise<Snapshot|SnapshotV1_1> {
    // Multi-device owners take the configured device ID; Pixoo serves one device.
    const query = [...(this.config.kind !== 'pixoo' ? ['deviceId=' + encodeURIComponent(this.config.deviceId)] : []),...(version === '1.1' ? ['apiVersion=1.1'] : [])];
    const {value:result} = await this.send('/snapshot' + (query.length ? '?' + query.join('&') : ''));
    const definition = version === '1.1' && object(result) && result.apiVersion === '1.1' ? 'snapshotV1_1' : 'snapshot';
    if (!validate(definition,result) || (result as Snapshot).identity.controllerId !== this.config.controllerId || (result as Snapshot).identity.deviceId !== this.config.deviceId) {
      this.health = 'unavailable'; throw new HttpError('incompatible-controller',502);
    }
    this.health = 'ready'; return result as Snapshot|SnapshotV1_1;
  }
  /**
   * Reads at 1.1 where the controller serves it, else at 1.0 (contract 1.1, "Moments"). Only an `invalid-request` refusal of the versioned
   * read makes a controller `1.0-only`, for the epoch of the unversioned answer. Later reads in that epoch send no version parameter;
   * a different epoch probes again. Timeouts, 5xx answers and malformed answers never create, change or clear a verdict.
   * The caller holds the slot, so the probe and its fallback read are one turn.
   */
  private async negotiatedRead(): Promise<Snapshot|SnapshotV1_1> {
    let plain: Snapshot|undefined;
    if (this.served?.version === '1.0') {
      plain = await this.readSnapshot('1.0') as Snapshot;
      if (plain.identity.controllerEpoch === this.served.epoch) return plain;
    }
    let answer: Snapshot|SnapshotV1_1;
    try { answer = await this.readSnapshot('1.1'); }
    catch (error) {
      if (!(error instanceof HttpError) || error.code !== 'invalid-request' || error.status !== 400) throw error;
      plain ??= await this.readSnapshot('1.0') as Snapshot;
      this.served = {version:'1.0',epoch:plain.identity.controllerEpoch};
      return plain;
    }
    this.served = {version:answer.apiVersion === '1.1' ? '1.1' : '1.0',epoch:answer.identity.controllerEpoch};
    return answer;
  }
  /** The 1.0 shape by default, with no version parameter sent. `snapshot('1.1')` returns the 1.1 snapshot from a controller that serves it, else the 1.0 snapshot. */
  async snapshot(): Promise<Snapshot>;
  async snapshot(version: '1.1'): Promise<Snapshot|SnapshotV1_1>;
  async snapshot(version: '1.0'|'1.1' = '1.0'): Promise<Snapshot|SnapshotV1_1> {
    return this.exclusive(() => version === '1.1' ? this.negotiatedRead() : this.readSnapshot('1.0'));
  }
  async command(value: unknown): Promise<{status:number;body:Receipt}> {
    if (!validate('request',value)) throw new HttpError('invalid-request',400);
    const request = value as Request;
    if (request.controllerId !== this.config.controllerId || request.deviceId !== this.config.deviceId) throw new HttpError('unknown-device',404);
    const execute = async () => {
      const response = await this.request('/commands',request);const result = response.value;
      const receipt = result as Receipt;
      if (!validate('receipt',result) || receipt.controllerId !== request.controllerId || receipt.deviceId !== request.deviceId ||
          receipt.requestId.epoch !== request.requestId.epoch || receipt.requestId.sequence !== request.requestId.sequence) {
        this.health = 'unavailable'; throw new HttpError('uncertain-result',503);
      }
      this.health = 'ready'; return {status:response.status,body:receipt};
    };
    if (!this.diagnostics) return execute();
    const observed = {pixoo:'pixoo',nanoleaf:'nanoleaf-controller',tidbyt:'local-controllers',lifx:'local-controllers'}[this.config.kind];
    return this.diagnostics.run('bunny.controller',{...commandDiagnosticAttributes(this.config,request),'bunny.observed.service':observed},execute);
  }
  /** A 1.1 `moment` request for this controller's device, checked before it takes the slot. */
  private momentRequest(value: unknown): RequestV1_1 {
    if (!validate('requestV1_1',value)) throw new HttpError('invalid-request',400);
    const request = value as RequestV1_1;
    if (request.command.kind !== 'moment') throw new HttpError('invalid-request',400);
    if (request.controllerId !== this.config.controllerId || request.deviceId !== this.config.deviceId) throw new HttpError('unknown-device',404);
    return request;
  }
  /** POSTs once inside a held slot. Only a `receiptV1_1` for the same device and ticket answers it; anything else is `uncertain-result`. */
  private async postMoment(request: RequestV1_1): Promise<{status:number;body:ReceiptV1_1}> {
    const response = await this.send('/commands',request);const receipt = response.value as ReceiptV1_1;
    if (!validate('receiptV1_1',receipt) || receipt.controllerId !== request.controllerId || receipt.deviceId !== request.deviceId ||
        receipt.requestId.epoch !== request.requestId.epoch || receipt.requestId.sequence !== request.requestId.sequence) {
      this.health = 'unavailable'; throw new HttpError('uncertain-result',503);
    }
    this.health = 'ready'; return {status:response.status,body:receipt};
  }
  /** Contract 1.1 `moment` command, taking the slot without waiting. The 1.0 `command()` path is separate and unchanged. */
  async momentCommand(value: unknown): Promise<{status:number;body:ReceiptV1_1}> {
    const request = this.momentRequest(value);
    return this.exclusive(() => this.postMoment(request));
  }
  private requireIntegration() {
    if (this.config.kind !== 'nanoleaf') throw new HttpError('unsupported-capability',422);
  }
  async integrationSnapshot(): Promise<unknown> {
    if (this.config.kind !== 'pixoo') this.requireIntegration();
    if (this.config.kind === 'pixoo') {
      let value:unknown;
      try { value=(await this.request('/snapshot?apiVersion=pixoo-integration%2F1.1',undefined,true)).value; }
      catch(error) { if (!(error instanceof HttpError) || !['invalid-input','invalid-request'].includes(error.code) || error.status!==400) throw error; value=(await this.request('/snapshot',undefined,true)).value; }
      if (!validatePixooSnapshot(value,true) || !object(value) || !object(value.identity) || value.identity.controllerId !== this.config.controllerId || value.identity.deviceId !== this.config.deviceId) {this.health='unavailable';throw new HttpError('incompatible-controller',502);}
      this.health='ready';return value;
    }
    const {value} = await this.request('/snapshot?deviceId=' + encodeURIComponent(this.config.deviceId),undefined,true);
    if (!validateIntegrationSnapshot(value) || !object(value) || !object(value.identity) || value.identity.deviceId !== this.config.deviceId || value.identity.controllerId !== this.config.controllerId) {
      this.health = 'unavailable';throw new HttpError('incompatible-controller',502);
    }
    this.health = 'ready';return value;
  }
  /** Pixoo-only typed catalog reads share the existing slot; no tickets or commands. */
  async pixooCatalog(operation:CatalogOperation,etag?:string):Promise<Representation> {
    if(this.config.kind!=='pixoo')throw new HttpError('unsupported-capability',422);
    const path=pixooCatalogPath(operation);
    return this.exclusive(async()=>{
      const abort=new AbortController();this.abort=abort;const timer=setTimeout(()=>abort.abort(),this.timeoutMs);
      try {
        const response=await fetch(this.config.endpoint.replace(/\/controller\/v1$/,'/controller/pixoo-integration/v1')+path,{redirect:'error',signal:abort.signal,headers:{authorization:`Bearer ${this.config.token}`,...(etag?{'if-none-match':etag}:{})}});
        if(!response.ok&&response.status!==304){
          const body=await responseJson(response,65536);
          const codes:Record<string,number>={'not-found':404,'invalid-request':400,'timeout':504,'cancelled':409,'invalid-input':400,'unauthenticated':401,'forbidden':403,'capacity':429,'unsupported-capability':422,'catalog-corrupt':503,'storage-error':503};
          if(object(body)&&object(body.error)&&typeof body.error.code==='string'&&codes[body.error.code]===response.status)throw new HttpError(body.error.code,response.status);
          throw new HttpError('controller-unavailable',503);
        }
        if(operation.kind==='preview'||operation.kind==='frame'||operation.kind==='manifest')return await previewReply(response,operation,etag);
        const value=await responseJson(response,1024*1024);
        if(!validateCatalogReply(value,operation))throw new HttpError('incompatible-controller',502);
        return {status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:Buffer.from(JSON.stringify(value))};
      }catch(error){if(error instanceof HttpError)throw error;throw new HttpError('controller-unavailable',503);}
      finally{clearTimeout(timer);this.abort=undefined;}
    });
  }
  /** Nanoleaf's saved element geometry for this device; a read that never changes the owner. */
  async integrationGeometry(): Promise<unknown> {
    this.requireIntegration();
    const {value} = await this.request('/geometry?deviceId=' + encodeURIComponent(this.config.deviceId),undefined,true,true);
    if (!validateIntegrationGeometry(value) || !object(value) || !object(value.identity) || value.identity.deviceId !== this.config.deviceId || value.identity.controllerId !== this.config.controllerId) {
      this.health = 'unavailable';throw new HttpError('incompatible-controller',502);
    }
    this.health = 'ready';return value;
  }
  private checkIntegrationReceipt(response:{status:number;value:unknown}, ticket:Ticket):{status:number;body:unknown} {
    const value = response.value;
    if (!validateIntegrationReceipt(value) || !object(value) || !object(value.requestId) || value.requestId.epoch !== ticket.epoch || value.requestId.sequence !== ticket.sequence) {
      this.health = 'unavailable';throw new HttpError('uncertain-result',503);
    }
    this.health = 'ready';return {status:response.status,body:value};
  }
  async integrationCommand(value:unknown):Promise<{status:number;body:unknown}> {
    if (this.config.kind !== 'pixoo') this.requireIntegration();
    if (this.config.kind === 'pixoo') {
      if (!validatePixooRequest(value)) throw new HttpError('invalid-request',400);
      if (value.controllerId !== this.config.controllerId || value.deviceId !== this.config.deviceId) throw new HttpError('unknown-device',404);
      const response=await this.request('/commands',value,true);
      if (!validatePixooSnapshot(response.value) || !object(response.value) || response.value.serverId !== String(value.requestId).split(':')[0]) {this.health='unavailable';throw new HttpError('uncertain-result',503);}
      this.health='ready';return {status:response.status,body:response.value};
    }
    if (!validateIntegrationRequest(value)) throw new HttpError('invalid-request',400);
    if (value.controllerId !== this.config.controllerId || value.deviceId !== this.config.deviceId) throw new HttpError('unknown-device',404);
    return this.checkIntegrationReceipt(await this.request('/commands',value,true),value.requestId);
  }
  async integrationReceipt(ticket:unknown):Promise<{status:number;body:unknown}> {
    this.requireIntegration();if (!integrationTicket(ticket)) throw new HttpError('invalid-request',400);
    return this.checkIntegrationReceipt(await this.request(`/receipt?deviceId=${encodeURIComponent(this.config.deviceId)}&epoch=${ticket.epoch}&sequence=${ticket.sequence}`,undefined,true),ticket);
  }
  async integrationCancel(value:unknown):Promise<{status:number;body:unknown}> {
    this.requireIntegration();
    if (!object(value) || !exact(value,['apiVersion','deviceId','requestId']) || value.apiVersion !== integrationVersion || value.deviceId !== this.config.deviceId || !integrationTicket(value.requestId)) throw new HttpError('invalid-request',400);
    return this.checkIntegrationReceipt(await this.request('/cancel',value,true),value.requestId);
  }
  private requireLighting() {
    if (this.config.kind !== 'lifx') throw new HttpError('unsupported-capability',422);
  }
  /** The LIFX owner's `lifx-light` snapshot: its controller v1 snapshot for this device plus the lighting section. */
  async lightingSnapshot(): Promise<unknown> {
    this.requireLighting();
    const {value} = await this.request('/snapshot?deviceId=' + encodeURIComponent(this.config.deviceId),undefined,'lighting');
    if (!validateLightingSnapshot(value) || !object(value) || !object(value.controller) || !object(value.controller.identity) ||
        value.controller.identity.controllerId !== this.config.controllerId || value.controller.identity.deviceId !== this.config.deviceId) {
      this.health = 'unavailable';throw new HttpError('incompatible-controller',502);
    }
    this.health = 'ready';return value;
  }
  /** One `lifx-light` color or temperature request; the owner answers a controller v1 receipt from the same queue. */
  async lightingCommand(value:unknown):Promise<{status:number;body:Receipt}> {
    this.requireLighting();
    if (!validateLightingRequest(value)) throw new HttpError('invalid-request',400);
    if (value.controllerId !== this.config.controllerId || value.deviceId !== this.config.deviceId) throw new HttpError('unknown-device',404);
    const response = await this.request('/commands',value,'lighting');const receipt = response.value as Receipt;
    if (!validate('receipt',receipt) || receipt.controllerId !== value.controllerId || receipt.deviceId !== value.deviceId ||
        receipt.requestId.epoch !== value.requestId.epoch || receipt.requestId.sequence !== value.requestId.sequence) {
      this.health = 'unavailable'; throw new HttpError('uncertain-result',503);
    }
    this.health = 'ready'; return {status:response.status,body:receipt};
  }
  close() {
    this.stopped = true; this.abort?.abort();
    for (const waiter of this.waiters.splice(0)) waiter.fail(new HttpError('controller-unavailable',503));
  }
}
