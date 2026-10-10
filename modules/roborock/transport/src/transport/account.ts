// Selected v4 flow adapted from the pinned MIT source; see ../../PROTOCOL.md.
import {createHash, createHmac, randomBytes} from 'node:crypto';
import {TextDecoder} from 'node:util';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {SdkError} from '@jimmie-potts/sdk';
import {validateConfig, validateSession, type Config, type Region, type Session} from './private.js';
export type SetupInput = {email: string; readCode: (signal: AbortSignal) => Promise<string>};
export type SetupDependencies = {fetch?: typeof globalThis.fetch; now?: () => number; random?: typeof randomBytes};
const HTTP_TIMEOUT_MS = 10000;
const SETUP_TIMEOUT_MS = 5 * 60000;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_STREAM_READS = 4096;
const REGIONS: Record<Region, {base: string; country: string; countryCode: string}> = {
  eu: {base: 'https://euiot.roborock.com', country: 'DE', countryCode: '49'}, us: {base: 'https://usiot.roborock.com', country: 'US', countryCode: '1'},
  cn: {base: 'https://cniot.roborock.com', country: 'CN', countryCode: '86'}, asia: {base: 'https://api.roborock.com', country: 'SG', countryCode: '65'},
};
type Code = 'invalid-request' | 'unauthenticated' | 'unsupported-capability' | 'unavailable' | 'cancelled';
const DETAILS: Record<Code, string> = {
  'invalid-request': 'The account setup input or endpoint is unsafe or invalid.', unauthenticated: 'The account service refused authentication.',
  'unsupported-capability': 'The account data or selected device is outside the supported transport capability.', unavailable: 'The account setup did not produce a usable response.', cancelled: 'The account setup was cancelled.',
};
class AccountFailure extends Error {constructor(readonly code: Code) {super('The account setup operation was refused.');}}
function fail(code: Code): never {throw new AccountFailure(code);}
function publicFailure(error: unknown): SdkError {
  let code: Code = 'unavailable';
  if (error instanceof AccountFailure) code = error.code;
  else if (error instanceof SdkError) {const candidate = error.body.error.code; if (candidate === 'invalid-request' || candidate === 'unsupported-capability') code = candidate;}
  return new SdkError(errorBody(code, {detail: DETAILS[code]}));
}
function abortFailure(signal: AbortSignal): AccountFailure {const reason: unknown = signal.reason; return reason instanceof AccountFailure ? new AccountFailure(reason.code) : new AccountFailure('cancelled');}
/** Fence completion even when a synthetic dependency ignores cancellation. */
function guarded<T>(signal: AbortSignal, action: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aborted = (): void => {signal.removeEventListener('abort', aborted); reject(abortFailure(signal));};
    signal.addEventListener('abort', aborted, {once: true}); if (signal.aborted) {aborted(); return;}
    let pending: Promise<T>;
    try {pending = action();} catch (error) {signal.removeEventListener('abort', aborted); reject(error); return;}
    void Promise.resolve(pending).then(value => {signal.removeEventListener('abort', aborted); if (signal.aborted) reject(abortFailure(signal)); else resolve(value);}, (error: unknown) => {signal.removeEventListener('abort', aborted); reject(signal.aborted ? abortFailure(signal) : error);});
  });
}
function object(value: unknown): Record<string, unknown> {if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('unavailable'); return value as Record<string, unknown>;}
function printable(value: unknown, maximum: number): string {if (typeof value !== 'string' || value.length < 1 || value.length > maximum || /[^\x20-\x7e]/.test(value)) fail('unavailable'); return value;}
function plainHeader(value: unknown, maximum: number): string {const result = printable(value, maximum); if (result.trim() !== result) fail('unavailable'); return result;}
function topicSegment(value: unknown): string {if (typeof value !== 'string' || value.length < 1 || value.length > 128 || /[^A-Za-z0-9_-]/.test(value)) fail('unavailable'); return value;}
function emailAddress(value: unknown): string {
  if (typeof value !== 'string' || value.length > 254 || /[^\x21-\x7e]/.test(value)) fail('invalid-request');
  const parts = value.split('@'); const local = parts[0]; const domain = parts[1];
  if (parts.length !== 2 || local === undefined || domain === undefined || local.length < 1 || local.length > 64 || /[^A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]/.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..') || !domain.includes('.') || domain.length > 253 || domain.split('.').some(label => label.length < 1 || label.length > 63 || /[^A-Za-z0-9-]/.test(label) || label.startsWith('-') || label.endsWith('-'))) fail('invalid-request');
  return value;
}
function emailCode(value: unknown): string {if (typeof value !== 'string' || value.length !== 6 || /[^0-9]/.test(value)) fail('invalid-request'); return value;}
function nonce(random: typeof randomBytes, size: number, length: number): string {
  const bytes = random(size); if (!Buffer.isBuffer(bytes) || bytes.length !== size) fail('unavailable');
  const result = bytes.toString('base64').slice(0, length).replace(/\+/g, 'X').replace(/\//g, 'Y');
  if (result.length !== length || /[^A-Za-z0-9]/.test(result)) fail('unavailable'); return result;
}
function apiBase(value: unknown): string {
  if (typeof value !== 'string' || value.length > 512 || /[^\x21-\x7e]/.test(value) || !/^https:\/\/[A-Za-z0-9.-]+(?::443)?\/?$/.test(value)) fail('invalid-request');
  const url = new URL(value); const host = url.hostname.toLowerCase();
  const labels = host.length <= 253 && host.split('.').every(label => label.length >= 1 && label.length <= 63 && !/[^a-z0-9-]/.test(label) && !label.startsWith('-') && !label.endsWith('-'));
  if (!labels || (host !== 'roborock.com' && !host.endsWith('.roborock.com')) || url.protocol !== 'https:' || (url.port !== '' && url.port !== '443') || url.username !== '' || url.password !== '' || (url.pathname !== '' && url.pathname !== '/') || url.search !== '' || url.hash !== '') fail('invalid-request');
  return url.origin;
}
function requestUrl(base: string, path: string): URL {
  const url = new URL(path, `${apiBase(base)}/`);
  const ordinary = ['/api/v4/email/code/send', '/api/v4/auth/email/login/code', '/api/v1/getHomeDetail'].includes(url.pathname);
  const home = /^\/v3\/user\/homes\/[1-9][0-9]{0,15}$/.test(url.pathname); const sign = url.pathname === '/api/v3/key/sign';
  if ((!ordinary && !home && !sign) || url.hash !== '') fail('invalid-request');
  if (sign) {const pairs = [...url.searchParams.entries()]; const pair = pairs[0]; if (pairs.length !== 1 || pair === undefined || pair[0] !== 's' || pair[1].length !== 16 || /[^A-Za-z0-9]/.test(pair[1])) fail('invalid-request');}
  else if (url.search !== '') fail('invalid-request');
  return url;
}
function discard(response: Response): void {try {if (response.body !== null && !response.body.locked) void response.body.cancel().catch(() => {});} catch {}}
async function limitedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (declared !== null) {if (declared.length < 1 || declared.length > 16 || /[^0-9]/.test(declared)) fail('unavailable'); const length = Number(declared); if (!Number.isSafeInteger(length)) fail('unavailable'); if (length > MAX_JSON_BYTES) fail('unsupported-capability');}
  if (response.body === null) fail('unavailable');
  const buffer = new Uint8Array(MAX_JSON_BYTES); const reader = response.body.getReader(); let offset = 0; let calls = 0; let complete = false;
  try {
    for (;;) {
      if (++calls > MAX_STREAM_READS) fail('unsupported-capability');
      const chunk = await guarded(signal, () => reader.read());
      if (chunk.done) {complete = true; break;}
      if (!(chunk.value instanceof Uint8Array)) fail('unavailable');
      if (chunk.value.byteLength > MAX_JSON_BYTES - offset) fail('unsupported-capability');
      buffer.set(chunk.value, offset); offset += chunk.value.byteLength;
    }
    if (signal.aborted) throw abortFailure(signal);
    const text = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(buffer.subarray(0, offset)); const value: unknown = JSON.parse(text); return value;
  } finally {if (!complete) {try {void reader.cancel().catch(() => {});} catch {}} try {reader.releaseLock();} catch {}}
}
function accepted(value: unknown): Record<string, unknown> {const envelope = object(value); if (typeof envelope.code !== 'number') fail('unavailable'); if (envelope.code !== 200) fail('unauthenticated'); return envelope;}
function list(value: unknown, optional = false): unknown[] {if (value === undefined && optional) return []; if (!Array.isArray(value)) fail('unavailable'); return value;}
export async function setupSession(config: Config, input: SetupInput, dependencies: SetupDependencies = {}, signal?: AbortSignal): Promise<Session> {
  const owner = new AbortController(); let overallTimer: ReturnType<typeof setTimeout> | undefined; let setupSignal: AbortSignal | undefined;
  try {
    const target = validateConfig(config);
    if (typeof input !== 'object' || input === null || typeof input.readCode !== 'function' || typeof dependencies !== 'object' || dependencies === null || (signal !== undefined && !(signal instanceof AbortSignal))) fail('invalid-request');
    const email = emailAddress(input.email); const readCode = input.readCode; const fetcher = dependencies.fetch ?? globalThis.fetch; const random = dependencies.random ?? randomBytes; const now = dependencies.now ?? Date.now;
    if (typeof fetcher !== 'function' || typeof random !== 'function' || typeof now !== 'function') fail('invalid-request');
    const sources = [owner.signal]; if (signal !== undefined) sources.push(signal); setupSignal = AbortSignal.any(sources); const activeSignal = setupSignal;
    if (activeSignal.aborted) throw abortFailure(activeSignal);
    overallTimer = setTimeout(() => owner.abort(new AccountFailure('unavailable')), SETUP_TIMEOUT_MS);
    const region = REGIONS[target.region]; const loginBase = apiBase(region.base); const clientId = nonce(random, 12, 16);
    const loginHeaders: Record<string, string> = {header_clientid: createHash('md5').update(email).update(clientId).digest('base64'), header_appversion: '4.57.02', header_clientlang: 'de', header_phonemodel: 'Pixel 9 Pro XL', header_phonesystem: 'Android'};
    const request = async (url: URL, method: 'GET' | 'POST', headers: Record<string, string>, body?: string): Promise<unknown> => {
      if (activeSignal.aborted) throw abortFailure(activeSignal); if (body !== undefined && Buffer.byteLength(body) > MAX_JSON_BYTES) fail('invalid-request');
      const deadline = new AbortController(); const combined = AbortSignal.any([activeSignal, deadline.signal]); const timer = setTimeout(() => deadline.abort(new AccountFailure('unavailable')), HTTP_TIMEOUT_MS);
      let response: Response | undefined;
      try {
        response = await guarded(combined, () => fetcher(url.href, {method, headers: {Accept: 'application/json', ...headers, ...(body === undefined ? {} : {'Content-Type': 'application/x-www-form-urlencoded'})}, ...(body === undefined ? {} : {body}), redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: combined}));
        if (response.redirected || (response.status >= 300 && response.status < 400) || (response.url !== '' && new URL(response.url).href !== url.href)) fail('invalid-request');
        if (!response.ok) fail(response.status >= 400 && response.status < 500 ? 'unauthenticated' : 'unavailable');
        return await limitedJson(response, combined);
      } finally {clearTimeout(timer); deadline.abort(new AccountFailure('cancelled')); if (response !== undefined) discard(response);}
    };
    accepted(await request(requestUrl(loginBase, '/api/v4/email/code/send'), 'POST', loginHeaders, new URLSearchParams({type: 'login', email, platform: ''}).toString()));
    const code = emailCode(await guarded(activeSignal, () => readCode(activeSignal)));
    const signNonce = nonce(random, 12, 16);
    const signed = accepted(await request(requestUrl(loginBase, `/api/v3/key/sign?s=${signNonce}`), 'POST', loginHeaders));
    const signKey = plainHeader(object(signed.data).k, 4096);
    const loggedIn = accepted(await request(requestUrl(loginBase, '/api/v4/auth/email/login/code'), 'POST', {...loginHeaders, 'x-mercy-k': signKey, 'x-mercy-ks': signNonce}, new URLSearchParams({country: region.country, countryCode: region.countryCode, email, code, majorVersion: '14', minorVersion: '0'}).toString()));
    const data = object(loggedIn.data); const token = plainHeader(data.token, 4096); const rawRriot = object(data.rriot);
    const u = topicSegment(rawRriot.u); const s = printable(rawRriot.s, 256); const k = printable(rawRriot.k, 256); const h = printable(rawRriot.h, 4096);
    if (/["\\]/.test(s)) fail('unavailable');
    const routes = object(rawRriot.r); const realBase = apiBase(routes.a); const returnedBroker = validateConfig({...target, broker: routes.m}).broker;
    if (returnedBroker !== target.broker) fail('invalid-request');
    const homeDetail = accepted(await request(requestUrl(loginBase, '/api/v1/getHomeDetail'), 'GET', {...loginHeaders, Authorization: token}));
    const homeId = object(homeDetail.data).rrHomeId; if (typeof homeId !== 'number' || !Number.isSafeInteger(homeId) || homeId <= 0) fail('unavailable');
    const homeUrl = requestUrl(realBase, `/v3/user/homes/${homeId}`); const milliseconds = now();
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) fail('unavailable'); const timestamp = Math.floor(milliseconds / 1000); if (timestamp > 0xffffffff) fail('unavailable');
    const hawkNonce = nonce(random, 6, 6); const pathHash = createHash('md5').update(homeUrl.pathname).digest('hex');
    const mac = createHmac('sha256', h).update([u, s, hawkNonce, timestamp, pathHash, '', ''].join(':')).digest('base64');
    const authorization = `Hawk id="${u}", s="${s}", ts="${timestamp}", nonce="${hawkNonce}", mac="${mac}"`;
    const homeEnvelope = object(await request(homeUrl, 'GET', {'x-iotsdk-version': '1.0.1', 'x-app-name': 'com.roborock.smart', 'x-app-version-code': '100834', 'x-app-version-name': '4.57.02', 'x-uid': u, 'User-Agent': 'UA=RRSDKAndroid/1.0.1', Authorization: authorization}));
    if (homeEnvelope.success !== true) fail('unauthenticated'); const home = object(homeEnvelope.result);
    if (home.id !== undefined && home.id !== homeId) fail('unavailable');
    const selected = [...list(home.devices), ...list(home.receivedDevices, true)].map(object).filter(device => device.duid === target.deviceId); const device = selected[0];
    if (selected.length !== 1 || device === undefined) fail('invalid-request');
    const productId = topicSegment(device.productId); const products = list(home.products).map(object).filter(product => product.id === productId); const product = products[0];
    if (products.length !== 1 || product === undefined) fail('unavailable');
    if (typeof product.model !== 'string' || typeof device.pv !== 'string') fail('unavailable');
    if (product.model !== 'roborock.vacuum.a97' || device.pv !== '1.0') fail('unsupported-capability');
    if (activeSignal.aborted) throw abortFailure(activeSignal);
    return validateSession({schemaVersion: 1, deviceId: target.deviceId, model: product.model, protocol: device.pv, localKey: device.localKey, rriot: {u, s, k}, broker: returnedBroker}, target);
  } catch (error) {throw publicFailure(setupSignal?.aborted === true ? abortFailure(setupSignal) : error);} finally {if (overallTimer !== undefined) clearTimeout(overallTimer); owner.abort(new AccountFailure('cancelled'));}
}
