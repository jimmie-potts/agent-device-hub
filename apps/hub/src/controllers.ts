import {validate, type Request, type Receipt, type Snapshot} from '@jimmie-potts/device-contracts';
import {HttpError, id, loopbackEndpoint, responseJson, object, exact} from './common.js';

export type ControllerConfig = {id:string; kind:'pixoo'|'nanoleaf'; controllerId:string; deviceId:string; endpoint:string; token:string};

/** One bounded slot per device, with no queue shared by different controllers. */
export class ControllerClient {
  private busy = false;
  private abort?: AbortController;
  private stopped = false;
  private health: 'unknown'|'ready'|'unavailable' = 'unknown';
  readonly config: Readonly<ControllerConfig>;
  constructor(config: ControllerConfig, readonly timeoutMs = 2000) {
    const url = loopbackEndpoint(config.endpoint);
    if (!id(config.id) || !id(config.controllerId) || !id(config.deviceId) || !['pixoo','nanoleaf'].includes(config.kind) ||
        !/^[A-Za-z0-9_-]{43}(?![\s\S])/.test(config.token) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2500 ||
        url.pathname !== '/controller/v1') throw new Error('invalid-controller');
    this.config = Object.freeze({...config});
  }
  status() { return {id:this.config.id,kind:this.config.kind,controllerId:this.config.controllerId,deviceId:this.config.deviceId,health:this.health,pending:this.busy ? 1 : 0}; }
  private async request(path: string, body?: unknown): Promise<unknown> {
    if (this.stopped) throw new HttpError('controller-unavailable',503);
    if (this.busy) throw new HttpError('capacity',429);
    this.busy = true;
    const abort = new AbortController(); this.abort = abort;
    const timer = setTimeout(() => abort.abort(),this.timeoutMs);
    try {
      const response = await fetch(this.config.endpoint + path, {method:body === undefined ? 'GET' : 'POST', redirect:'error',signal:abort.signal,
        headers:{authorization:`Bearer ${this.config.token}`,'content-type':'application/json','x-pixoo-request':'1'},
        ...(body === undefined ? {} : {body:JSON.stringify(body)})});
      const value = await responseJson(response,1024 * 1024);
      if (!response.ok) {
        // A typed receipt can describe an admitted rejection. Preserve its ticket below.
        if (body !== undefined && validate('receipt',value)) return value;
        const mapping: Record<string,number> = {'unauthenticated':401,'forbidden':403,'invalid-request':400,'unknown-device':404,
          'revision-conflict':409,'stale-generation':409,'request-conflict':409,'request-expired':410,'request-order':409,'capacity':429,'unsupported-capability':422};
        if (object(value) && exact(value,['failure']) && object(value.failure) && exact(value.failure,['code']) &&
            typeof value.failure.code === 'string' && mapping[value.failure.code] === response.status) throw new HttpError(value.failure.code,response.status);
        throw new Error('upstream-failure');
      }
      return value;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      this.health = 'unavailable';
      throw new HttpError(body === undefined ? 'controller-unavailable' : 'uncertain-result',503);
    } finally { clearTimeout(timer); this.busy = false; this.abort = undefined; }
  }
  async snapshot(): Promise<Snapshot> {
    const result = await this.request('/snapshot' + (this.config.kind === 'nanoleaf' ? '?deviceId=' + encodeURIComponent(this.config.deviceId) : ''));
    if (!validate('snapshot',result) || (result as Snapshot).identity.controllerId !== this.config.controllerId || (result as Snapshot).identity.deviceId !== this.config.deviceId) {
      this.health = 'unavailable'; throw new HttpError('incompatible-controller',502);
    }
    this.health = 'ready'; return result as Snapshot;
  }
  async command(value: unknown): Promise<Receipt> {
    if (!validate('request',value)) throw new HttpError('invalid-request',400);
    const request = value as Request;
    if (request.controllerId !== this.config.controllerId || request.deviceId !== this.config.deviceId) throw new HttpError('unknown-device',404);
    const result = await this.request('/commands',request);
    const receipt = result as Receipt;
    if (!validate('receipt',result) || receipt.controllerId !== request.controllerId || receipt.deviceId !== request.deviceId ||
        receipt.requestId.epoch !== request.requestId.epoch || receipt.requestId.sequence !== request.requestId.sequence) {
      this.health = 'unavailable'; throw new HttpError('uncertain-result',503);
    }
    this.health = 'ready'; return receipt;
  }
  close() { this.stopped = true; this.abort?.abort(); }
}
