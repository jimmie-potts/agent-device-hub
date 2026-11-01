import {Ajv2020} from 'ajv/dist/2020.js';
import type {Observation} from './contracts.js';
export class BeforeSendError extends Error {}
export type MoveEvent = {uuid: string; type: 'move_started' | 'move_completed' | 'move_cancelled' | 'move_failed'};
export type Observer = {state(value: Observation): void; event(value: MoveEvent): void; lost(mismatch?: boolean): void};
export interface ReachyTransport {
  connect(observer: Observer, signal: AbortSignal): Promise<() => void>;
  move(target: readonly [number, number], signal: AbortSignal, beforeEffect?: () => void): Promise<string>;
  cancel(uuid: string, signal: AbortSignal, beforeEffect?:()=>void): Promise<void>;
}
const ajv = new Ajv2020({strict: false});
const isStatus = ajv.compile<{state: string; simulation_enabled: boolean; mockup_sim_enabled: boolean; no_media: boolean; backend_status: null | {error: unknown;motor_control_mode:string}}>({
  type: 'object', required: ['state', 'simulation_enabled', 'mockup_sim_enabled', 'no_media', 'backend_status'],
  properties: {state: {type: 'string'}, simulation_enabled: {type: 'boolean'}, mockup_sim_enabled: {type: 'boolean'}, no_media: {type: 'boolean'},
    backend_status: {anyOf: [{type: 'null'}, {type: 'object', required: ['error','motor_control_mode'], properties: {error: {},motor_control_mode:{type:'string'}}}]}},
});
const isState = ajv.compile<{antennas_position: [number, number]}>({type: 'object', required: ['antennas_position'],
  properties: {antennas_position: {type: 'array', minItems: 2, maxItems: 2, items: {type: 'number'}}}});
const isMove = ajv.compile<{uuid: string}>({type: 'object', required: ['uuid'], properties: {uuid: {type: 'string', pattern: '^[0-9a-f-]{36}$'}}});
const isEvent = ajv.compile<MoveEvent>({type: 'object', required: ['uuid', 'type'], properties: {uuid: {type: 'string', pattern: '^[0-9a-f-]{36}$'}, type: {enum: ['move_started', 'move_completed', 'move_cancelled', 'move_failed']}}});
function parse(value: unknown): unknown {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 32768) return undefined;
  try {return JSON.parse(value);} catch {return undefined;}
}
export class HttpReachy implements ReachyTransport {
  constructor(readonly endpoint: string) {}
  async #json(path: string, signal: AbortSignal, data?: object): Promise<unknown> {
    const answer = await fetch(this.endpoint + path, {signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]), redirect: 'error',
      ...(data === undefined ? {} : {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(data)})});
    if (!answer.ok || answer.body === null) throw new Error('vendor request refused');
    const reader = answer.body.getReader(), decoder = new TextDecoder(); let text = '', size = 0;
    try {while (true) {const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > 32768) throw new Error('vendor answer too large'); text += decoder.decode(chunk.value,{stream:true});}}
    finally {await reader.cancel();}
    return parse(text+decoder.decode());
  }
  async #identity(signal:AbortSignal):Promise<void> {
    let status:unknown;try{status=await this.#json('/api/daemon/status',signal);}catch{throw new BeforeSendError('simulator identity unavailable');}
    if (!isStatus(status) || status.state !== 'running' || !status.simulation_enabled || status.mockup_sim_enabled || !status.no_media || status.backend_status === null || status.backend_status.error !== null || status.backend_status.motor_control_mode !== 'enabled') {
      throw new BeforeSendError('simulator backend mismatch');
    }
  }
  async connect(observer: Observer, signal: AbortSignal): Promise<() => void> {
    try {await this.#identity(signal);} catch {observer.lost(true);throw new Error('simulator unavailable or mismatched');}
    const sockets: WebSocket[] = []; let closed = false;
    const close = (): void => {if (closed) return; closed = true; signal.removeEventListener('abort', close); for (const socket of sockets) socket.close();};
    const lost = (): void => {if (!closed) {close(); observer.lost();}};
    signal.addEventListener('abort', close, {once: true});
    try {
      for (const [path, receive] of [
        ['/api/move/ws/updates', (value: unknown) => {if (isEvent(value)) observer.event(value);}],
        ['/api/state/ws/full?frequency=10', (value: unknown) => {if (isState(value)) observer.state({antennas: value.antennas_position});}],
      ] satisfies readonly [string, (value: unknown) => void][]) {
        signal.throwIfAborted();
        const socket = new WebSocket(this.endpoint.replace(/^http:/, 'ws:') + path); sockets.push(socket);
        socket.addEventListener('message', event => {if (!closed) receive(parse(event.data));});
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {reject(new Error('vendor stream deadline'));}, 2000);
          const opened = (): void => {clearTimeout(timer); resolve();};
          const failed = (): void => {clearTimeout(timer); reject(new Error('vendor stream unavailable'));};
          socket.addEventListener('open', opened, {once: true}); socket.addEventListener('error', failed, {once: true});
          socket.addEventListener('close', failed, {once: true});
        });
        socket.addEventListener('close', lost, {once: true}); socket.addEventListener('error', lost, {once: true});
      }
      if (signal.aborted) close();
      return close;
    } catch (error) {close(); throw error;}
  }
  async move(target: readonly [number, number], signal: AbortSignal, beforeEffect: () => void = () => {}): Promise<string> {
    await this.#identity(signal); signal.throwIfAborted(); beforeEffect();
    const value = await this.#json('/api/move/goto', signal, {antennas: target, duration: .6});
    if (!isMove(value)) throw new Error('unknown vendor task identity');
    return value.uuid;
  }
  async cancel(uuid: string, signal: AbortSignal, beforeEffect:()=>void=()=>{}): Promise<void> {await this.#identity(signal);signal.throwIfAborted();beforeEffect();const answer=await this.#json('/api/move/stop',signal,{uuid});if(typeof answer!=='object'||answer===null||!('message'in answer)||answer.message!==`Stopped move with UUID: ${uuid}`)throw new Error('unconfirmed task cancellation');}
}
