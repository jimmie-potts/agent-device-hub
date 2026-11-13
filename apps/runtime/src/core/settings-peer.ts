import {RETRYABLE, errorBody, isErrorCode, type ErrorCode} from '@jimmie-potts/event-contracts/v2/errors';
import {SdkError, connectRemote, readBoundedJson, statusOf, type Scheduler, type TraceContext, type RemoteParticipant, type ModuleContext} from '@jimmie-potts/sdk';
import {ordinaryReaderSource} from '../credentials.js';
import {RuntimeError} from '../state.js';
import {decodeSettingsPage, decodeSettingsSnapshot, settingsObject, settingsOrigin, SETTINGS_ANSWER_BYTES,
  type SettingsPage, type SettingsSnapshot} from './settings-contract.js';

export type SettingsPeerConfig = {origin: string; source: string; tokenFile: string; expectedOrigin?: string};
export type SettingsReadRequest = {after: string; through?: string};
export type SettingsPeer = {
  connect(signal: AbortSignal, lost: () => void): Promise<Pick<RemoteParticipant, 'close' | 'subscribe'>>;
  snapshot(signal: AbortSignal, trace: TraceContext): Promise<SettingsSnapshot>;
  page(read: SettingsReadRequest, signal: AbortSignal, trace: TraceContext): Promise<SettingsPage>;
};

const READ_MS = 30_000;

export function settingsPeerConfig(section: unknown, standby: boolean): SettingsPeerConfig | undefined {
  if (!settingsObject(section) || !Object.hasOwn(section, 'peer')) return undefined;
  const bad = (): never => { throw new RuntimeError('config-invalid', 'the core settings peer configuration is invalid'); };
  const {peer} = section;
  if (!standby || !settingsObject(peer)) return bad();
  const {origin, source, tokenFile, expectedOrigin} = peer;
  if (Object.keys(peer).some(key => !['origin', 'source', 'tokenFile', 'expectedOrigin'].includes(key))
    || typeof origin !== 'string' || origin.length > 512 || !/^https:\/\/[^/?#@\\\s]+\/?$/.test(origin)
    || !ordinaryReaderSource(source) || typeof tokenFile !== 'string' || !tokenFile.startsWith('/')
    || tokenFile.length > 4096 || tokenFile.includes('\0') || (expectedOrigin !== undefined && !settingsOrigin(expectedOrigin))) return bad();
  let url: URL;
  try { url = new URL(origin); } catch { return bad(); }
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.username !== '' || url.password !== '') return bad();
  return {origin: url.origin, source, tokenFile, ...(expectedOrigin === undefined ? {} : {expectedOrigin})};
}

export const settingsFailure = (code: ErrorCode): SdkError => new SdkError(errorBody(code));

/** Only this typed page refusal establishes that a replacement read is necessary. */
export class SettingsContinuityError extends SdkError {
  constructor() { super(errorBody('revision-conflict')); }
}

export function createSettingsPeer(config: SettingsPeerConfig, token: string, scheduler: Scheduler, tracing?: ModuleContext['trace']): SettingsPeer {
  async function read<T>(query: URLSearchParams, signal: AbortSignal, trace: TraceContext, decode: (value: unknown) => T | undefined): Promise<T> {
    const span = tracing?.start('bunny.feed.read', {
      parent: trace, kind: 'client', attributes: {'http.route': '/api/v2/history', 'http.request.method': 'GET'},
    });
    const deadline = new AbortController();
    const cancel = scheduler.after(READ_MS, () => { deadline.abort(); });
    const attempt = AbortSignal.any([signal, deadline.signal]);
    try {
      attempt.throwIfAborted();
      const response = await fetch(`${config.origin}/api/v2/history?${query}`, {
        method: 'GET', redirect: 'error', credentials: 'omit', signal: attempt,
        headers: {authorization: `Bearer ${token}`, traceparent: (span?.context ?? trace).traceparent},
      });
      const value = await readBoundedJson(response, SETTINGS_ANSWER_BYTES, attempt);
      if (response.status !== 200) {
        const error = settingsObject(value) ? value.error : undefined;
        const code = settingsObject(error) ? error.code : undefined;
        if (!isErrorCode(code) || !settingsObject(error) || error.retryable !== RETRYABLE[code] || response.status !== statusOf(code)) throw settingsFailure('invalid-message');
        if (code === 'revision-conflict' && query.get('settings') === 'page') throw new SettingsContinuityError();
        throw settingsFailure(code);
      }
      const decoded = decode(value);
      if (decoded === undefined) throw settingsFailure('invalid-message');
      return decoded;
    } catch (error) {
      span?.end('error');
      if (signal.aborted) throw settingsFailure('cancelled');
      if (deadline.signal.aborted) throw settingsFailure('unavailable');
      throw error instanceof SdkError ? error : settingsFailure('unavailable');
    } finally {
      span?.end();
      cancel();
    }
  }

  return {
    connect: async (signal, onLost) => {
      const client = await connectRemote({url: config.origin, token, source: config.source, scheduler, liveness: scheduler,
        lifetime: {signal, onLost}, onError: () => {}});
      return {subscribe: client.subscribe.bind(client), close: () => client.close()};
    },
    snapshot: (signal, trace) => read(new URLSearchParams({settings: 'snapshot'}), signal, trace, decodeSettingsSnapshot),
    page: ({after, through}, signal, trace) => read(new URLSearchParams({settings: 'page', after, ...(through === undefined ? {} : {through})}), signal, trace, decodeSettingsPage),
  };
}
