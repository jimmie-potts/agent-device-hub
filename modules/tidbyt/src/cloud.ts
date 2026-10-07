// The Tidbyt cloud connection (Hub #930). Copied from controllers/tidbyt/src/connection.ts at main 627e3fe3 and
// converted to the strict profile. The cloud's identity, the API key and the installations live here, never in the
// renderer. Each result is classified once and never retried. Changes from the copy:
// - The module's fetch is its transport, so a test or a disposable run passes the simulated cloud's (`SimulatedCloud`).
// - A deadline is the caller's signal, on the runtime's scheduler; `timeoutMs` stays only as an optional backstop.
// - An uncertain result says whether the cloud answered: a server error is an answer, a lost answer is not. The module
//   reports the device `unavailable` only when the cloud does not answer (ADR 0012, "Failure isolation").
// - A failed write had no effect, so the result no longer repeats `priorEffects: 'none'`.

/** A refused connection setting. Its message is fixed text and never repeats a value. */
export class CloudConfigurationError extends Error {
  readonly code = 'invalid-configuration';

  constructor() {
    super('the Tidbyt cloud connection refused its configuration');
    this.name = 'CloudConfigurationError';
  }
}

/** What the module's transport does: one HTTPS request to the cloud, as `fetch` makes it. */
export type CloudFetch = (url: string, init: {
  method: 'GET' | 'POST' | 'DELETE'; redirect: 'error'; signal: AbortSignal; headers: Record<string, string>; body?: string;
}) => Promise<Response>;

export type CloudFailure = 'unauthenticated' | 'forbidden' | 'unknown-device' | 'invalid-request' | 'transport-failure';
/** How a push or a removal ended. A failed one had no effect: the cloud refused it, or nothing left this host. */
export type WriteResult =
  | {outcome: 'sent'}
  | {outcome: 'failed'; failure: CloudFailure}
  | {outcome: 'failed'; failure: 'capacity'; retryAfterMs: number}
  /** The write may have taken effect. `answered` is true when the cloud answered with a server error, false when no answer came. */
  | {outcome: 'uncertain'; answered: boolean};
/** An installation listing. A failed one says whether the cloud answered. */
export type ListResult = {ok: true; present: boolean} | {ok: false; failure: CloudFailure | 'capacity'; answered: boolean};

export type CloudConfig = {
  /** The cloud's device ID from the Tidbyt app. Private destination configuration, never a message's identity. */
  deviceId: string;
  apiKey: string;
  /** The status tile's installation. */
  installationId: string;
  /** Further installations this connection may write, such as the now-playing tile. At most four. */
  additionalInstallationIds?: readonly string[];
  fetch: CloudFetch;
  /** A backstop deadline for each request, in addition to the caller's signal. */
  timeoutMs?: number;
  /** The wall clock, used only to read an HTTP-date `Retry-After`. */
  now?: () => number;
};

export const API = 'https://api.tidbyt.com/v0';
/** An installation ID: letters and digits only, as the cloud takes them. */
export const INSTALLATION_ID = /^[A-Za-z0-9]{1,64}$/;
export const CLOUD_DEVICE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const API_KEY = /^[\x21-\x7e]{1,4096}$/;
const MAX_BODY = 64 * 1024;
export const MAX_ADDITIONAL_INSTALLATIONS = 4;
const DEFAULT_RETRY_MS = 60_000;
const MAX_RETRY_MS = 15 * 60_000;
/** A write for an installation this connection does not list; nothing is sent. */
const REFUSED: WriteResult = Object.freeze({outcome: 'failed', failure: 'invalid-request'});
// Failures raised before any request bytes can have left this host.
const PRE_SEND: ReadonlySet<string> = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EAI_NONAME', 'UND_ERR_CONNECT_TIMEOUT']);

async function boundedText(response: Response, limit: number): Promise<string | undefined> {
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
  } catch {
    return undefined;
  }
  return Buffer.concat(chunks).toString('utf8');
}

function retryAfterMs(header: string | null, now: number): number {
  let ms = DEFAULT_RETRY_MS;
  const value = header?.trim() ?? '';
  if (/^\d+$/.test(value)) ms = Number(value) * 1000;
  else if (value !== '' && Number.isFinite(Date.parse(value))) ms = Date.parse(value) - now;
  return Math.min(MAX_RETRY_MS, Math.max(1000, ms));
}

/** The cloud answers a request that carries no usable identity with this 500 body. */
function missingIdentity(body: string | undefined): boolean {
  try {
    const value: unknown = JSON.parse(body ?? '');
    const message = typeof value === 'object' && value !== null && 'message' in value ? value.message : undefined;
    return typeof message === 'string' && /doesn't have a UID/.test(message);
  } catch {
    return false;
  }
}

async function classify(response: Response): Promise<CloudFailure | 'capacity' | 'uncertain'> {
  const status = response.status;
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'unknown-device';
  if (status === 429) return 'capacity';
  if (status === 400 || status === 413 || status === 422) return 'invalid-request';
  if (status === 500 && missingIdentity(await boundedText(response, 4096))) return 'unauthenticated';
  return 'uncertain';
}

async function rejection(response: Response): Promise<CloudFailure | 'capacity' | 'uncertain'> {
  const failure = await classify(response);
  // Release the connection; only the 500 identity check reads the body.
  await response.body?.cancel().catch(() => undefined);
  return failure;
}

/**
 * Whether a failed fetch sent nothing: undici reports a refused connection or a failed lookup as its cause's `code`. Only
 * that code is read, to choose the result; the error's text is never read or kept.
 */
function sentNothing(failure: unknown): boolean {
  const cause = typeof failure === 'object' && failure !== null && 'cause' in failure ? failure.cause : undefined;
  const code = typeof cause === 'object' && cause !== null && 'code' in cause ? cause.code : undefined;
  return typeof code === 'string' && PRE_SEND.has(code);
}

/** Background pushes, removals and listings for one cloud device and its configured installations. */
export class TidbytCloudConnection {
  readonly #deviceId: string;
  readonly #apiKey: string;
  readonly #installationId: string;
  readonly additionalInstallations: readonly string[];
  readonly #timeoutMs: number | undefined;
  readonly #fetch: CloudFetch;
  readonly #now: () => number;

  constructor(config: CloudConfig) {
    const {timeoutMs} = config;
    const additional: unknown = config.additionalInstallationIds ?? [];
    if (!Array.isArray(additional) || additional.length > MAX_ADDITIONAL_INSTALLATIONS ||
      additional.some(id => typeof id !== 'string' || !INSTALLATION_ID.test(id) || id === config.installationId) ||
      new Set(additional).size !== additional.length ||
      typeof config.deviceId !== 'string' || !CLOUD_DEVICE_ID.test(config.deviceId) ||
      typeof config.apiKey !== 'string' || !API_KEY.test(config.apiKey) ||
      typeof config.installationId !== 'string' || !INSTALLATION_ID.test(config.installationId) ||
      (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000))) {
      throw new CloudConfigurationError();
    }
    this.#deviceId = config.deviceId;
    this.#apiKey = config.apiKey;
    this.#installationId = config.installationId;
    this.additionalInstallations = Object.freeze([...additional as string[]]);
    this.#timeoutMs = timeoutMs;
    this.#fetch = config.fetch;
    this.#now = config.now ?? Date.now;
  }

  #request(path: string, signal: AbortSignal, method: 'GET' | 'POST' | 'DELETE', body?: string): Promise<Response> {
    return this.#fetch(`${API}/devices/${encodeURIComponent(this.#deviceId)}${path}`, {
      method, redirect: 'error',
      signal: this.#timeoutMs === undefined ? signal : AbortSignal.any([signal, AbortSignal.timeout(this.#timeoutMs)]),
      headers: {authorization: `Bearer ${this.#apiKey}`, ...(body === undefined ? {} : {'content-type': 'application/json'})},
      ...(body === undefined ? {} : {body}),
    });
  }

  /** The installation to target, or undefined when `installation` is not one this connection may write. */
  #target(installation: string | undefined): string | undefined {
    if (installation === undefined) return this.#installationId;
    return this.additionalInstallations.includes(installation) ? installation : undefined;
  }

  /** Pushes `webp` to the default or the named installation, in the background rotation. */
  async push(webp: Uint8Array, signal: AbortSignal, installation?: string): Promise<WriteResult> {
    const target = this.#target(installation);
    if (target === undefined) return REFUSED;
    const body = JSON.stringify({deviceID: this.#deviceId, image: Buffer.from(webp).toString('base64'), installationID: target, background: true});
    return this.#write(() => this.#request('/push', signal, 'POST', body));
  }

  /** Deletes the default or the named installation, classified like a push. */
  async remove(signal: AbortSignal, installation?: string): Promise<WriteResult> {
    const target = this.#target(installation);
    if (target === undefined) return REFUSED;
    return this.#write(() => this.#request(`/installations/${target}`, signal, 'DELETE'));
  }

  /** Sends one write and classifies it once. */
  async #write(send: () => Promise<Response>): Promise<WriteResult> {
    let response: Response;
    try {
      response = await send();
    } catch (error) {
      return sentNothing(error) ? {outcome: 'failed', failure: 'transport-failure'} : {outcome: 'uncertain', answered: false};
    }
    if (response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return {outcome: 'sent'};
    }
    const failure = await rejection(response);
    if (failure === 'uncertain') return {outcome: 'uncertain', answered: true};
    if (failure === 'capacity') return {outcome: 'failed', failure, retryAfterMs: retryAfterMs(response.headers.get('retry-after'), this.#now())};
    return {outcome: 'failed', failure};
  }

  /** Reads the installation list, and says whether the default or the named installation is in it. It changes nothing. */
  async list(signal: AbortSignal, installation?: string): Promise<ListResult> {
    const target = this.#target(installation);
    if (target === undefined) return {ok: false, failure: 'invalid-request', answered: false};
    let response: Response;
    try {
      response = await this.#request('/installations', signal, 'GET');
    } catch {
      return {ok: false, failure: 'transport-failure', answered: false};
    }
    if (!response.ok) {
      const failure = await rejection(response);
      return {ok: false, failure: failure === 'uncertain' ? 'transport-failure' : failure, answered: true};
    }
    try {
      const value: unknown = JSON.parse(await boundedText(response, MAX_BODY) ?? '');
      const installations = typeof value === 'object' && value !== null && 'installations' in value ? value.installations : undefined;
      if (!Array.isArray(installations)) return {ok: false, failure: 'transport-failure', answered: true};
      return {ok: true, present: installations.some((entry: unknown) => typeof entry === 'object' && entry !== null && 'id' in entry && entry.id === target)};
    } catch {
      return {ok: false, failure: 'transport-failure', answered: true};
    }
  }
}
