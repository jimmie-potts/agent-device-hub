import {Connection} from '@2colors/esphome-native-api';
import {channels, object, type SensorConfig} from './configuration.js';
import type {ScalarReport} from './projection.js';

export class NativeFault extends Error {
  constructor(readonly code: 'unavailable' | 'forbidden' | 'unsupported-capability' | 'invalid-message') { super(code); }
}
export type NativeSession = {open(signal: AbortSignal): Promise<void>; close(): void};
export type NativeCallbacks = {report(report: ScalarReport): void; disconnected(code: NativeFault['code']): void};
export type NativeFactory = (sensor: SensorConfig, secrets: {key?: string; password?: string}, callbacks: NativeCallbacks) => NativeSession;

type FrameHelper = {buildMessage(type: number, bytes: Uint8Array): {toObject(): Record<string, unknown>}; on(event: string, listener: (...args: unknown[]) => void): unknown;
  socket: {on(event: string, listener: (...args: unknown[]) => void): unknown}};
/** Pinned 1.3.7's switch schema predates missing_state field 4. Read that single varint before jspb discards it. */
export function switchMissing(bytes: Uint8Array): boolean {
  let offset = 0;
  const varint = (): number => {
    let result = 0, shift = 0;
    for (let count = 0; count < 10 && offset < bytes.length; count++) {
      const byte = bytes[offset++] as number;
      result += (byte & 127) * 2 ** shift;
      if (byte < 128) return result;
      shift += 7;
    }
    throw new NativeFault('invalid-message');
  };
  while (offset < bytes.length) {
    const tag = varint(), field = Math.floor(tag / 8), wire = tag % 8;
    if (wire === 0) { const value = varint(); if (field === 4 && value !== 0) return true; }
    else if (wire === 1) offset += 8;
    else if (wire === 2) { const length = varint(); offset += length; }
    else if (wire === 5) offset += 4;
    else throw new NativeFault('invalid-message');
    if (offset > bytes.length) throw new NativeFault('invalid-message');
  }
  return false;
}
const swallow = (): void => {};
export const nativeFactory: NativeFactory = (sensor, secrets, callbacks) => {
  if (sensor.security.mode === 'noise' && (secrets.key === undefined || !/^[A-Za-z0-9+/]{43}=$/.test(secrets.key) || Buffer.from(secrets.key, 'base64').length !== 32)) throw new NativeFault('forbidden');
  const connection = new Connection({host: sensor.address, port: sensor.port, reconnect: false, clientInfo: 'bunny-presence-pro',
    ...(sensor.security.mode === 'noise' ? {encryptionKey: secrets.key as string} : {}), ...(secrets.password === undefined ? {} : {password: secrets.password})});
  const helper = (connection as unknown as {frameHelper: FrameHelper}).frameHelper;
  const build = helper.buildMessage.bind(helper);
  helper.buildMessage = (type, bytes) => {
    const message = build(type, bytes);
    if (type === 26 && switchMissing(bytes)) {
      const toObject = message.toObject.bind(message);
      message.toObject = () => ({...toObject(), missingState: true});
    }
    return message;
  };
  let closed = false, ready = false, passwordRefused = false, pendingReject: ((error: NativeFault) => void) | undefined;
  const fail = (code: NativeFault['code']): void => {
    if (closed) return;
    pendingReject?.(new NativeFault(code));
    if (ready) callbacks.disconnected(code);
  };
  connection.on('message.AuthenticationResponse', (response: unknown) => { passwordRefused = object(response) && response.invalidPassword === true; });
  // The client exposes no typed Noise-error code. Unknown transport/protocol/key failures stay unavailable;
  // only the explicit decoded password refusal proves authentication failure here. Raw error text is never read.
  connection.on('error', () => { fail(passwordRefused ? 'forbidden' : 'unavailable'); });
  connection.on('disconnected', () => { fail('unavailable'); });
  return {
    open: signal => new Promise<void>((resolve, reject) => {
      pendingReject = reject;
      const abort = (): void => { reject(new NativeFault('unavailable')); };
      signal.addEventListener('abort', abort, {once: true});
      const finish = (): void => { signal.removeEventListener('abort', abort); pendingReject = undefined; };
      connection.on('authorized', () => {
        void (async () => {
          const info = await connection.deviceInfoService();
          if (closed || signal.aborted) return;
          if (info.macAddress.replaceAll(':', '').toLowerCase() !== sensor.mac) throw new NativeFault('forbidden');
          const entities = await connection.listEntitiesService();
          if (closed || signal.aborted) return;
          for (const channel of channels(sensor)) {
            const matches = entities.filter(entry => entry.component === channel.type && entry.entity.key === channel.binding.key
              && (channel.binding.objectId === undefined || 'objectId' in entry.entity && entry.entity.objectId === channel.binding.objectId));
            if (matches.length !== 1) throw new NativeFault('unsupported-capability');
          }
          for (const type of new Set(channels(sensor).map(channel => channel.type))) connection.on(`message.${type}StateResponse`, (value: unknown) => {
            if (closed || !ready || !object(value) || typeof value.key !== 'number') return;
            if (!channels(sensor).some(channel => channel.type === type && channel.binding.key === value.key)) return;
            callbacks.report({key: value.key, value: value.state, missing: value.missingState === true});
          });
          ready = true;
          // All listeners are installed before subscribing: initial cached reports may arrive immediately.
          (connection as unknown as {subscribeStatesService(): void}).subscribeStatesService();
          finish(); resolve();
        })().catch((error: unknown) => { finish(); reject(error instanceof NativeFault ? error : new NativeFault('unavailable')); });
      });
      if (signal.aborted) { finish(); reject(new NativeFault('unavailable')); return; }
      connection.connect();
    }),
    close: () => {
      if (closed) return;
      closed = true; ready = false;
      pendingReject?.(new NativeFault('unavailable')); pendingReject = undefined;
      connection.disconnect();
      // 1.3.7 removes listeners while its bounded request promises/Noise initializer can still reject later.
      connection.on('error', swallow); helper.on('error', swallow); helper.socket.on('error', swallow);
    },
  };
};
