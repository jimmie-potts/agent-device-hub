// The Tronbyt server connection (Hub #23): the same three tile calls as the cloud, and the display controls the cloud
// withholds, against the `/v0` API. Each difference from the cloud below was read from server v2.5.2's source and
// exercised on a disposable v2.5.1 server; `README.md` holds the compatibility record.
// - `background` defaults to false here, where the cloud's tiles always send true: a push names it every time.
// - A push always names its installation. The server queues an anonymous push until a device takes it, for up to a day,
//   so one sent while the device is away would show an expired frame later; a named one replaces its own file.
// - The installation list answers the server's own IDs, never the ID a push chose, so presence is read by asking for the
//   installation by name.
// - Removing an installation that is gone answers 404 "App not found", where a missing device answers "Device not found".
// - Brightness is stored as sent, unchecked, so the module scales its percent itself. See `BRIGHTNESS_CEILING`.
// Observation stays a transmission: the server knows what it served, never what the panel shows.
import {Outcome} from '@jimmie-potts/sdk';
import {
  CLOUD_DEVICE_ID, CloudConfigurationError, INSTALLATION_ID, MAX_ADDITIONAL_INSTALLATIONS, boundedText, retryAfterMs, sentNothing,
  type CloudFailure, type CloudFetch, type ListResult, type TidbytConnection, type WriteResult,
} from './cloud.js';

/**
 * The stored brightness a 100 percent request sends: the top of the server's own scale for the Tidbyt Gen 1, whose
 * panel the server never drives above this from its own settings page. The server would store anything, 101 and -1
 * included, and hand it to the firmware.
 */
export const BRIGHTNESS_CEILING = 50;
const API_KEY = /^[\x21-\x7e]{1,4096}$/;
/** The server's fixed answer for an installation it does not have. */
const NO_INSTALLATION = /^App not found\s*$/;
const REFUSED: WriteResult = Object.freeze({outcome: Outcome.failed, failure: 'invalid-request'});
const PRIVATE_NAME = /^(?:[a-z0-9-]+|.+\.(?:local|internal|lan|home\.arpa))$/;

function privateAddress(host: string): boolean {
  if (host === '[::1]') return true;
  const parts = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host)?.slice(1).map(Number);
  if (parts === undefined) return !host.includes(':') && !/^\d+(\.\d+)*$/.test(host) && PRIVATE_NAME.test(host);
  const [a = 0, b = 0] = parts;
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/**
 * The server's origin, or undefined when it is refused: no credentials, path, query or fragment, and plain http only on
 * a loopback, private or single-label host, since every request carries the bearer key.
 */
export function privateServerUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  if (url.username !== '' || url.password !== '' || url.pathname !== '/' || url.search !== '' || url.hash !== '') return undefined;
  if (url.protocol === 'http:' && !privateAddress(url.hostname)) return undefined;
  return url.origin;
}

export type TronbytConfig = {
  /** The server's origin. Private destination configuration, never a message's identity. */
  url: string;
  /** The server's device ID. */
  deviceId: string;
  apiKey: string;
  /** The status tile's installation. */
  installationId: string;
  /** Further installations this connection may write, such as the now-playing tile. */
  additionalInstallationIds?: readonly string[];
  fetch: CloudFetch;
  /** The wall clock, used only to read an HTTP-date `Retry-After`. */
  now?: () => number;
};

type Failure = CloudFailure | 'capacity' | 'no-installation' | 'uncertain';

/** One result for one answer: never retried. The server's error bodies are plain text, and only the 404's is read. */
async function classify(response: Response): Promise<Failure> {
  const {status} = response;
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return NO_INSTALLATION.test(await boundedText(response, 4096) ?? '') ? 'no-installation' : 'unknown-device';
  if (status === 429) return 'capacity';
  if (status === 400 || status === 413 || status === 422) return 'invalid-request';
  return 'uncertain';
}

/** One device on one Tronbyt server, and the installations this connection may write. */
export class TronbytConnection implements TidbytConnection {
  readonly #origin: string;
  readonly #deviceId: string;
  readonly #apiKey: string;
  readonly #installationId: string;
  readonly #additional: readonly string[];
  readonly #fetch: CloudFetch;
  readonly #now: () => number;

  constructor(config: TronbytConfig) {
    const origin = privateServerUrl(config.url);
    const additional: unknown = config.additionalInstallationIds ?? [];
    if (origin === undefined || !Array.isArray(additional) || additional.length > MAX_ADDITIONAL_INSTALLATIONS ||
      additional.some(id => typeof id !== 'string' || !INSTALLATION_ID.test(id) || id === config.installationId) ||
      new Set(additional).size !== additional.length ||
      typeof config.deviceId !== 'string' || !CLOUD_DEVICE_ID.test(config.deviceId) ||
      typeof config.apiKey !== 'string' || !API_KEY.test(config.apiKey) ||
      typeof config.installationId !== 'string' || !INSTALLATION_ID.test(config.installationId) ||
      [config.installationId, ...additional as string[]].some(id => /^\d+$/.test(id))) {
      throw new CloudConfigurationError();
    }
    this.#origin = origin;
    this.#deviceId = config.deviceId;
    this.#apiKey = config.apiKey;
    this.#installationId = config.installationId;
    this.#additional = Object.freeze([...additional as string[]]);
    this.#fetch = config.fetch;
    this.#now = config.now ?? Date.now;
  }

  #request(path: string, signal: AbortSignal, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', body?: object): Promise<Response> {
    return this.#fetch(`${this.#origin}/v0/devices/${encodeURIComponent(this.#deviceId)}${path}`, {
      method, redirect: 'error', signal,
      headers: {authorization: `Bearer ${this.#apiKey}`, ...(body === undefined ? {} : {'content-type': 'application/json'})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
  }

  #target(installation: string | undefined): string | undefined {
    if (installation === undefined) return this.#installationId;
    return this.#additional.includes(installation) ? installation : undefined;
  }

  async push(webp: Uint8Array, signal: AbortSignal, installation?: string, immediate = false): Promise<WriteResult> {
    const target = this.#target(installation);
    if (target === undefined) return REFUSED;
    const pushed = await this.#write(() => this.#request('/push', signal, 'POST', {image: Buffer.from(webp).toString('base64'), installationID: target, background: !immediate}));
    // The server's loop for a connected device keeps its own copy of the installations, and refreshes it after showing one.
    // With none to show, a background push that creates one leaves the setup screen up, so the tile never appears (Hub
    // #1411). An empty PATCH of the installation refreshes it and changes nothing; an interrupting push refreshes it itself.
    // It is part of this write: a tile the panel may never show is not sent, whatever became of the frame.
    if (immediate || pushed.outcome !== 'sent') return pushed;
    return await this.#write(() => this.#request(`/installations/${target}`, signal, 'PATCH', {}));
  }

  /** Deletes the installation. One already gone counts as removed, as the cloud answers it. */
  async remove(signal: AbortSignal, installation?: string): Promise<WriteResult> {
    const target = this.#target(installation);
    if (target === undefined) return REFUSED;
    return await this.#write(() => this.#request(`/installations/${target}`, signal, 'DELETE'), {outcome: 'sent'});
  }

  /** Asks for the installation by name, since the list carries only the server's own IDs. It changes nothing. */
  async list(signal: AbortSignal, installation?: string): Promise<ListResult> {
    const target = this.#target(installation);
    if (target === undefined) return {ok: false, failure: 'invalid-request', answered: false};
    let response: Response;
    try {
      response = await this.#request(`/installations/${target}`, signal, 'GET');
    } catch {
      return {ok: false, failure: 'transport-failure', answered: false};
    }
    if (response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return {ok: true, present: true};
    }
    const failure = await classify(response);
    await response.body?.cancel().catch(() => undefined);
    if (failure === 'no-installation') return {ok: true, present: false};
    return {ok: false, failure: failure === 'uncertain' ? 'transport-failure' : failure, answered: true};
  }

  /** Sets the device's brightness: 0 to 100 percent of `BRIGHTNESS_CEILING`. */
  async setBrightness(percent: number, signal: AbortSignal): Promise<WriteResult> {
    return await this.#write(() => this.#request('', signal, 'PATCH', {brightness: Math.round((percent * BRIGHTNESS_CEILING) / 100)}));
  }

  /** Pins the installation, so the display shows only it. One that is gone cannot be pinned. */
  async pin(signal: AbortSignal, installation?: string): Promise<WriteResult> {
    const target = this.#target(installation);
    if (target === undefined) return REFUSED;
    return await this.#write(() => this.#request(`/installations/${target}`, signal, 'PATCH', {pinned: true}));
  }

  /** Clears the device's pin. Deleting a pinned installation leaves it set on the server, so the module clears it itself. */
  async unpin(signal: AbortSignal): Promise<WriteResult> {
    return await this.#write(() => this.#request('', signal, 'PATCH', {pinnedApp: ''}));
  }

  /** Sends one write and classifies it once. `gone` is the result when the server has no such installation. */
  async #write(send: () => Promise<Response>, gone: WriteResult = REFUSED): Promise<WriteResult> {
    let response: Response;
    try {
      response = await send();
    } catch (error) {
      return sentNothing(error) ? {outcome: Outcome.failed, failure: 'transport-failure'} : {outcome: Outcome.uncertain, answered: false};
    }
    if (response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return {outcome: 'sent'};
    }
    const failure = await classify(response);
    await response.body?.cancel().catch(() => undefined);
    if (failure === 'no-installation') return gone;
    if (failure === 'uncertain') return {outcome: Outcome.uncertain, answered: true};
    if (failure === 'capacity') return {outcome: Outcome.failed, failure, retryAfterMs: retryAfterMs(response.headers.get('retry-after'), this.#now())};
    return {outcome: Outcome.failed, failure};
  }
}
