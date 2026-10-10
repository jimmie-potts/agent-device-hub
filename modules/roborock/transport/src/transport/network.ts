// Protocol adaptation provenance and MIT notice: ../../PROTOCOL.md and ../../UPSTREAM-LICENSE.txt.
import {createHash, randomBytes} from 'node:crypto';
import {Socket} from 'node:net';
import {Duplex, Transform, type TransformCallback} from 'node:stream';
import {connect as connectTls, type TLSSocket} from 'node:tls';
import {TextDecoder} from 'node:util';
import debug from 'debug';
import * as mqtt from 'mqtt';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {SdkError} from '@jimmie-potts/sdk';
import {decodeControl, decodeMap, decodeV1, encodeControl, encodeV1, MAX_FRAME_BYTES, TcpFrames, wrapTcp} from './codec.js';
import {ConnectionFailure} from './failure.js';
import {validateConfig, validateSession, type Config, type Session} from './private.js';
import type {WireRequest, WireResult} from './reader.js';
import {encodeRpc} from './rpc.js';
export const MAX_MQTT_BYTES = 1024 * 1024;
export const MAX_JSON_BYTES = 64 * 1024;
const MAX_MQTT_PACKETS = 64;
type LocalDependencies = {connect?: () => Socket};
type MqttDependencies = {connect?: typeof mqtt.connect; tlsConnect?: typeof connectTls};
const sensitiveNamespaces = ['mqtt-packet:parser', 'mqtt-packet:writeToStream', 'mqttjs', 'mqttjs:client', 'mqttjs:tls', 'mqttjs:tcp', 'mqttjs:ws', 'mqttjs:socks'];
const connectionCodes = new Set(['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN', 'ERR_STREAM_DESTROYED']);
function malformed(): SdkError { return new SdkError(errorBody('unavailable', {detail: 'The vendor observation could not be validated.'})); }
function unsupported(): SdkError { return new SdkError(errorBody('unsupported-capability', {detail: 'The vendor payload exceeds the supported transport capability.'})); }
function unauthenticated(): SdkError { return new SdkError(errorBody('unauthenticated', {detail: 'The vendor refused the configured session.'})); }
function cancelled(): SdkError { return new SdkError(errorBody('cancelled', {detail: 'The vendor read was cancelled.'})); }
function codeOf(error: unknown): unknown { return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined; }
function safeFailure(error: unknown): SdkError {
  if (error instanceof SdkError) return error;
  const code = codeOf(error);
  if (code === 4 || code === 5 || code === 0x86 || code === 0x87) return unauthenticated();
  if (typeof code === 'string' && connectionCodes.has(code)) return new ConnectionFailure();
  return malformed();
}
/** Inspect debug's retained state. Consumer qualification proves the dependency shares this instance. */
function requireQuietDiagnostics(): void {
  if (sensitiveNamespaces.some(namespace => debug.enabled(namespace))) throw new SdkError(errorBody('forbidden', {detail: 'The vendor transport requires disabled payload diagnostics.'}));
}
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function json(text: string): unknown {
  if (Buffer.byteLength(text) > MAX_JSON_BYTES) throw unsupported();
  try { const value: unknown = JSON.parse(text); return value; } catch { throw malformed(); }
}
function response(payload: Buffer, id: number): unknown {
  if (payload.byteLength > MAX_JSON_BYTES) throw unsupported();
  let parsed: unknown;
  try { parsed = json(new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(payload)); } catch (error) {throw safeFailure(error);}
  if (!object(parsed)) throw malformed();
  let inner: unknown = parsed;
  if (Object.hasOwn(parsed, 'dps')) {
    const dps = parsed.dps; if (!object(dps)) throw malformed();
    if (Object.hasOwn(dps, '102')) inner = dps['102'];
    else if (Object.hasOwn(dps, '101')) inner = dps['101'];
    else if (Object.hasOwn(dps, 'id')) inner = dps;
    else throw malformed();
  }
  if (typeof inner === 'string') inner = json(inner);
  if (!object(inner) || !Object.hasOwn(inner, 'id') || inner.id !== id || !Object.hasOwn(inner, 'result') || (Object.hasOwn(inner, 'error') && inner.error !== null)) throw malformed();
  return inner.result;
}
function mapAcknowledgment(value: unknown): boolean { return value === 'ok' || (Array.isArray(value) && value.length === 1 && value[0] === 'ok'); }
function snapshot(request: WireRequest, route: 'local' | 'mqtt', endpoint?: string): WireRequest {
  const security = endpoint === undefined ? undefined : {endpoint, nonce: request.nonce};
  const payload = encodeRpc(request.method, route, request.params, request.id, request.seconds, security);
  encodeV1(payload, '0000000000000000', {seq: request.seq, random: 0, seconds: request.seconds, protocol: route === 'local' ? 4 : 101});
  return {...request, params: [...request.params], nonce: route === 'mqtt' ? Buffer.from(request.nonce) : new Uint8Array(0)};
}
function md5(value: string): Buffer { return createHash('md5').update(value).digest(); }
/** Holds at most five header bytes. No header reaches MQTT parsing until the advertised packet fits. */
export class MqttPacketGuard extends Transform {
  readonly #header = Buffer.alloc(5);
  #headerBytes = 0; #length = 0; #multiplier = 1; #remaining = 0; #packets = 0;
  constructor() { super({readableHighWaterMark: 16384, writableHighWaterMark: 16384}); }
  override _transform(chunk: unknown, _encoding: BufferEncoding, callback: TransformCallback): void {
    try {
      requireQuietDiagnostics();
      if (!Buffer.isBuffer(chunk)) throw malformed();
      if (chunk.byteLength > MAX_MQTT_BYTES) throw unsupported();
      let offset = 0;
      while (offset < chunk.byteLength) {
        if (this.#remaining > 0) { const count = Math.min(this.#remaining, chunk.byteLength - offset); this.push(chunk.subarray(offset, offset + count)); offset += count; this.#remaining -= count; continue; }
        const byte = chunk[offset]; if (byte === undefined) throw malformed(); offset++;
        if (this.#headerBytes === 0) { this.#header[0] = byte; this.#headerBytes = 1; this.#length = 0; this.#multiplier = 1; continue; }
        if (this.#headerBytes >= this.#header.byteLength) throw malformed();
        this.#header[this.#headerBytes++] = byte; this.#length += (byte & 0x7f) * this.#multiplier;
        if ((byte & 0x80) !== 0) {if (this.#headerBytes === 5) throw malformed(); this.#multiplier *= 128; continue;}
        if (this.#headerBytes > 2 && byte === 0) throw malformed();
        if (this.#headerBytes + this.#length > MAX_MQTT_BYTES || ++this.#packets > MAX_MQTT_PACKETS) throw unsupported();
        this.push(Buffer.from(this.#header.subarray(0, this.#headerBytes))); this.#remaining = this.#length; this.#headerBytes = 0;
      }
      callback();
    } catch (error) {callback(safeFailure(error));}
  }
  override _flush(callback: TransformCallback): void {callback(this.#headerBytes === 0 && this.#remaining === 0 ? undefined : malformed());}
}
/** QoS 1 must not enter MQTT's offline store after a disconnect. */
class ConnectedStore extends mqtt.Store {
  constructor(readonly available: () => boolean) {super({clean: true});}
  override put(packet: Parameters<mqtt.Store['put']>[0], callback: Parameters<mqtt.Store['put']>[1]): this {
    if (!this.available()) {callback(new ConnectionFailure()); return this;}
    return super.put(packet, callback);
  }
}
export async function localRead(config: Config, session: Session, request: WireRequest, signal: AbortSignal, dependencies: LocalDependencies = {}): Promise<WireResult> {
  let target: Config; let credentials: Session; let read: WireRequest; let random: number;
  try {if (signal.aborted) throw cancelled(); target = validateConfig(config); credentials = validateSession(session, target); read = snapshot(request, 'local'); random = randomBytes(4).readUInt32BE(0);} catch (error) {throw safeFailure(error);}
  return new Promise<WireResult>((resolve, reject) => {
    let socket: Socket | undefined; let finished = false; let connected = false; let acknowledged = false; let delivering = false;
    const frames = new TcpFrames();
    function finish(error?: SdkError, result?: WireResult): void {
      if (finished) return; finished = true; signal.removeEventListener('abort', onAbort);
      const current = socket;
      if (current !== undefined) {
        current.off('connect', onConnect); current.off('data', onData); current.off('end', onLost); current.off('close', onLost);
        current.once('close', () => {current.off('error', onError);}); current.destroy(); if (current.closed) current.off('error', onError);
      }
      if (error !== undefined) reject(error); else if (result !== undefined) resolve(result); else reject(malformed());
    }
    function onAbort(): void {finish(cancelled());}
    function onError(error: unknown): void {if (!finished) finish(safeFailure(error));}
    function onLost(): void {if (!finished) finish(new ConnectionFailure());}
    function write(bytes: Buffer, complete?: () => void): void {
      const current = socket;
      if (finished || signal.aborted) {if (!finished) finish(cancelled()); return;}
      if (current === undefined || current.destroyed || !current.writable || !connected) {finish(new ConnectionFailure()); return;}
      current.write(bytes, error => {if (finished) return; if (signal.aborted) {finish(cancelled()); return;} if (error !== undefined && error !== null) {finish(safeFailure(error)); return;} complete?.();});
    }
    function onConnect(): void {
      if (finished) return; if (signal.aborted) {finish(cancelled()); return;} if (connected) {finish(malformed()); return;} connected = true;
      try {write(encodeControl(0, 0, random, 10));} catch (error) {finish(safeFailure(error));}
    }
    function onData(chunk: Buffer): void {
      if (finished || delivering) return; if (signal.aborted) {finish(cancelled()); return;}
      try {
        for (const frame of frames.push(chunk)) {
          if (finished || delivering) break;
          if (frame.byteLength === 17 || frame.byteLength === 21) {
            const control = decodeControl(frame);
            if (control.protocol === 1) {
              if (!connected || acknowledged) throw malformed(); if (control.returnCode !== 0) throw unauthenticated(); acknowledged = true;
              const payload = encodeRpc(read.method, 'local', read.params, read.id, read.seconds);
              write(wrapTcp(encodeV1(payload, credentials.localKey, {seq: read.seq, random, seconds: read.seconds, protocol: 4})));
            } else if (!acknowledged) throw malformed();
            continue;
          }
          if (!acknowledged) throw malformed();
          const decoded = decodeV1(frame, credentials.localKey);
          if (decoded.protocol !== 4 && decoded.protocol !== 102) throw unsupported();
          const value = response(decoded.payload, read.id);
          if (typeof value !== 'object' || value === null) throw malformed();
          const result: WireResult = {kind: 'json', value};
          if (decoded.protocol === 4) {delivering = true; write(encodeControl(5, decoded.seq, 0), () => {finish(undefined, result);});}
          else finish(undefined, result);
        }
      } catch (error) {finish(safeFailure(error));}
    }
    try {
      if (signal.aborted) {finish(cancelled()); return;}
      socket = dependencies.connect === undefined ? new Socket() : dependencies.connect();
      socket.on('error', onError); socket.on('close', onLost); socket.on('end', onLost); socket.on('data', onData); socket.on('connect', onConnect); signal.addEventListener('abort', onAbort, {once: true});
      if (signal.aborted) {finish(cancelled()); return;}
      if (dependencies.connect === undefined) socket.connect({host: target.address, port: 58867});
      else if (!socket.connecting && socket.readyState === 'open') onConnect();
    } catch (error) {finish(safeFailure(error));}
  });
}
export async function mqttRead(config: Config, session: Session, request: WireRequest, signal: AbortSignal, dependencies: MqttDependencies = {}): Promise<WireResult> {
  let target: Config; let credentials: Session; let read: WireRequest; let broker: URL; let username: string; let password: string; let endpoint: string; let random: number;
  try {
    if (signal.aborted) throw cancelled(); requireQuietDiagnostics(); target = validateConfig(config); credentials = validateSession(session, target); broker = new URL(target.broker);
    username = md5(`${credentials.rriot.u}:${credentials.rriot.k}`).toString('hex').slice(2, 10);
    password = md5(`${credentials.rriot.s}:${credentials.rriot.k}`).toString('hex').slice(16);
    endpoint = md5(credentials.rriot.k).subarray(8, 14).toString('base64'); read = snapshot(request, 'mqtt', endpoint); random = randomBytes(4).readUInt32BE(0);
  } catch (error) {throw safeFailure(error);}
  const inbound = `rr/m/o/${credentials.rriot.u}/${username}/${target.deviceId}`; const outbound = `rr/m/i/${credentials.rriot.u}/${username}/${target.deviceId}`;
  return new Promise<WireResult>((resolve, reject) => {
    let client: mqtt.MqttClient | undefined; let socket: TLSSocket | undefined; let guard: MqttPacketGuard | undefined; let stream: Duplex | undefined;
    let finished = false; let subscribed = false; let published = false;
    function removeClientListeners(): void {const current = client; if (current === undefined) return; current.off('connect', onConnect); current.off('message', onMessage); current.off('close', onLost); current.off('offline', onLost); current.off('disconnect', onLost); current.off('error', onError);}
    function finish(error?: SdkError, result?: WireResult): void {
      if (finished) return; finished = true; signal.removeEventListener('abort', onAbort);
      const current = client;
      if (current !== undefined) {
        current.off('connect', onConnect); current.off('message', onMessage); current.off('close', onLost); current.off('offline', onLost); current.off('disconnect', onLost);
        try {current.end(true, removeClientListeners);} catch {current.once('close', removeClientListeners);}
      }
      stream?.destroy(); guard?.destroy(); socket?.destroy();
      if (error !== undefined) reject(error); else if (result !== undefined) resolve(result); else reject(malformed());
    }
    function onAbort(): void {finish(cancelled());}
    function onError(error: unknown): void {if (!finished) finish(safeFailure(error));}
    function onLost(): void {if (!finished) finish(new ConnectionFailure());}
    function active(): boolean {if (finished) return false; if (signal.aborted) {finish(cancelled()); return false;} return true;}
    function buildStream(): Duplex {
      if (!active()) throw cancelled(); requireQuietDiagnostics();
      const tls = dependencies.tlsConnect ?? connectTls;
      const nextSocket = tls({host: broker.hostname, port: Number(broker.port), servername: broker.hostname, rejectUnauthorized: true}); socket = nextSocket;
      nextSocket.on('error', onError); nextSocket.on('close', onLost); nextSocket.once('close', () => {nextSocket.off('error', onError); nextSocket.off('close', onLost);});
      const nextGuard = new MqttPacketGuard(); guard = nextGuard; nextGuard.on('error', onError); nextGuard.once('close', () => {nextGuard.off('error', onError);});
      const nextStream = Duplex.from({readable: nextSocket.pipe(nextGuard), writable: nextSocket}); stream = nextStream;
      nextStream.on('error', onError); nextStream.once('close', () => {nextStream.off('error', onError);}); return nextStream;
    }
    function onConnect(): void {
      if (!active()) return; const current = client;
      if (current === undefined || !current.connected) {finish(new ConnectionFailure()); return;} if (subscribed) {finish(malformed()); return;} subscribed = true;
      try {
        requireQuietDiagnostics();
        current.subscribe(inbound, {qos: 1}, (error, grants) => {
          if (!active()) return; if (error !== null) {finish(safeFailure(error)); return;}
          const grant = grants?.[0];
          if (grants?.length !== 1 || grant === undefined || grant.topic !== inbound || (grant.qos !== 0 && grant.qos !== 1)) {finish(unauthenticated()); return;}
          if (!current.connected) {finish(new ConnectionFailure()); return;}
          try {
            requireQuietDiagnostics(); if (published) throw malformed();
            const payload = encodeRpc(read.method, 'mqtt', read.params, read.id, read.seconds, {endpoint, nonce: read.nonce});
            const frame = encodeV1(payload, credentials.localKey, {seq: read.seq, random, seconds: read.seconds, protocol: 101});
            if (!active()) return; if (!current.connected) throw new ConnectionFailure(); published = true;
            current.publish(outbound, frame, {qos: 1, retain: false, dup: false}, publishError => {if (!active()) return; if (publishError !== undefined && publishError !== null) finish(safeFailure(publishError));});
          } catch (publishError) {finish(safeFailure(publishError));}
        });
      } catch (error) {finish(safeFailure(error));}
    }
    function onMessage(topic: string, payload: Buffer): void {
      if (!active()) return;
      try {
        requireQuietDiagnostics(); if (payload.byteLength > MAX_MQTT_BYTES) throw unsupported(); if (topic !== inbound) return; if (!published || payload.byteLength === 0) throw malformed();
        let offset = 0;
        while (offset < payload.byteLength && !finished) {
          const available = payload.byteLength - offset; if (available < 23) throw malformed();
          const length = 19 + payload.readUInt16BE(offset + 17) + 4;
          if (length > MAX_FRAME_BYTES) throw unsupported(); if (length > available) throw malformed();
          const decoded = decodeV1(payload.subarray(offset, offset + length), credentials.localKey); offset += length;
          if (decoded.protocol === 102) {if (!mapAcknowledgment(response(decoded.payload, read.id))) throw malformed();}
          else if (decoded.protocol === 301) finish(undefined, {kind: 'map', bytes: decodeMap(decoded.payload, read.nonce, read.id)});
          else throw unsupported();
        }
      } catch (error) {finish(safeFailure(error));}
    }
    try {
      if (!active()) return; requireQuietDiagnostics();
      const options: mqtt.IClientOptions = {
        protocol: 'mqtts', protocolVersion: 4, host: broker.hostname, port: Number(broker.port), servername: broker.hostname, rejectUnauthorized: true,
        clientId: username, username, password, manualConnect: true, clean: true, keepalive: 30, connectTimeout: 30000, reconnectPeriod: 0,
        reconnectOnConnackError: false, resubscribe: false, queueQoSZero: false, outgoingStore: new ConnectedStore(() => !finished && client !== undefined && client.connected), log: () => {},
      };
      client = dependencies.connect === undefined ? new mqtt.MqttClient(buildStream, options) : dependencies.connect(target.broker, options);
      client.on('error', onError); client.on('close', onLost); client.on('offline', onLost); client.on('disconnect', onLost); client.on('message', onMessage); client.on('connect', onConnect); signal.addEventListener('abort', onAbort, {once: true});
      if (!active()) return; requireQuietDiagnostics(); if (client.connected) onConnect(); else client.connect();
    } catch (error) {finish(safeFailure(error));}
  });
}
