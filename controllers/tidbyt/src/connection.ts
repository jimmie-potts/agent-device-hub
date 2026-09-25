/**
 * Tidbyt cloud connection. Backend identity, credentials and capabilities live here,
 * never in the renderer. Results are classified once and never retried.
 */
export class TidbytConfigurationError extends Error {
  constructor(readonly code: 'invalid-configuration' | 'credentials-unreadable' | 'credentials-permissions' | 'credentials-invalid') {
    super(`Tidbyt configuration rejected: ${code}`);
    this.name = 'TidbytConfigurationError';
  }
}

export type ConnectionCapabilities = {
  backend: 'tidbyt-cloud';
  backgroundPush: { supported: true };
  foregroundPush: { supported: false };
  installationRead: { supported: true };
  installationRemove: { supported: true };
};

export type PushFailure = 'unauthenticated' | 'forbidden' | 'unknown-device' | 'invalid-request' | 'transport-failure';
export type PushOutcome =
  | { outcome: 'sent' }
  | { outcome: 'failed'; failure: PushFailure; priorEffects: 'none' }
  | { outcome: 'failed'; failure: 'capacity'; priorEffects: 'none'; retryAfterMs: number }
  | { outcome: 'uncertain' };
export type InstallationRead = { ok: true; present: boolean } | { ok: false; failure: PushFailure | 'capacity' };

/**
 * Every write path goes through this interface; a later Tronbyt connection implements it too.
 * `installation` names one of `additionalInstallations`; omitted, the default installation is used.
 */
export interface DisplayConnection {
  readonly capabilities: ConnectionCapabilities;
  /** Operator-configured installations besides the default one. */
  readonly additionalInstallations?: readonly string[];
  push(webp: Uint8Array, signal: AbortSignal, installation?: string): Promise<PushOutcome>;
  readInstallation(signal: AbortSignal, installation?: string): Promise<InstallationRead>;
  /** Delete the default or named installation, classified like a push. */
  remove(signal: AbortSignal, installation?: string): Promise<PushOutcome>;
}

export type TidbytCloudConfig = {
  /** Cloud device ID from the Tidbyt app. Private destination configuration, never a contract identity. */
  deviceId: string;
  apiKey: string;
  installationId: string;
  /** Further installations this connection may write, such as a now-playing tile. At most four. */
  additionalInstallationIds?: readonly string[];
  timeoutMs?: number;
  fetch?: typeof fetch;
  /** Wall clock used only to interpret an HTTP-date Retry-After. */
  now?: () => number;
};

const API = 'https://api.tidbyt.com/v0';
export const INSTALLATION_ID = /^[A-Za-z0-9]{1,64}$/;
const CLOUD_DEVICE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const API_KEY = /^[\x21-\x7e]{1,4096}$/;
const MAX_BODY = 64 * 1024;
export const MAX_ADDITIONAL_INSTALLATIONS = 4;
const DEFAULT_RETRY_MS = 60_000;
const MAX_RETRY_MS = 15 * 60_000;
/** A write for an installation this connection does not list; nothing is sent. */
const REFUSED: PushOutcome = Object.freeze({ outcome: 'failed', failure: 'invalid-request', priorEffects: 'none' }) as PushOutcome;
// Failures raised before any request bytes can have left this host.
const PRE_SEND = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EAI_NONAME', 'UND_ERR_CONNECT_TIMEOUT']);

const CAPABILITIES: ConnectionCapabilities = Object.freeze({
  backend: 'tidbyt-cloud',
  backgroundPush: Object.freeze({ supported: true }),
  foregroundPush: Object.freeze({ supported: false }),
  installationRead: Object.freeze({ supported: true }),
  installationRemove: Object.freeze({ supported: true }),
}) as ConnectionCapabilities;

type Response = globalThis.Response;

async function boundedText(response: Response, limit: number): Promise<string | undefined> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); return undefined; }
      chunks.push(value);
    }
  } catch {
    return undefined;
  }
  return Buffer.concat(chunks).toString('utf8');
}

function retryAfterMs(header: string | null, now: number): number {
  let ms = DEFAULT_RETRY_MS;
  if (header && /^\d+$/.test(header.trim())) ms = Number(header.trim()) * 1000;
  else if (header && Number.isFinite(Date.parse(header))) ms = Date.parse(header) - now;
  return Math.min(MAX_RETRY_MS, Math.max(1000, ms));
}

/** The cloud answers a request that carries no usable identity with this 500 body. */
function missingIdentity(body: string | undefined): boolean {
  try {
    const value = JSON.parse(body ?? '');
    return typeof value?.message === 'string' && /doesn't have a UID/.test(value.message);
  } catch {
    return false;
  }
}

async function rejection(response: Response): Promise<PushFailure | 'capacity' | 'uncertain'> {
  const failure = await classify(response);
  // Release the connection; only the 500 identity check reads the body.
  await response.body?.cancel().catch(() => undefined);
  return failure;
}

async function classify(response: Response): Promise<PushFailure | 'capacity' | 'uncertain'> {
  const status = response.status;
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'unknown-device';
  if (status === 429) return 'capacity';
  if (status === 400 || status === 413 || status === 422) return 'invalid-request';
  if (status === 500 && missingIdentity(await boundedText(response, 4096))) return 'unauthenticated';
  return 'uncertain';
}

function networkFailure(error: unknown): 'transport-failure' | 'uncertain' {
  const cause = (error as { cause?: { code?: unknown } } | undefined)?.cause;
  return typeof cause?.code === 'string' && PRE_SEND.has(cause.code) ? 'transport-failure' : 'uncertain';
}

export class TidbytCloudConnection implements DisplayConnection {
  readonly capabilities = CAPABILITIES;
  readonly #deviceId: string;
  readonly #apiKey: string;
  readonly #installationId: string;
  readonly additionalInstallations: readonly string[];
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;

  constructor(config: TidbytCloudConfig) {
    const timeoutMs = config.timeoutMs ?? 10_000;
    const additional = config.additionalInstallationIds ?? [];
    if (!Array.isArray(additional) || additional.length > MAX_ADDITIONAL_INSTALLATIONS
        || additional.some(id => typeof id !== 'string' || !INSTALLATION_ID.test(id) || id === config.installationId)
        || new Set(additional).size !== additional.length
        || typeof config.deviceId !== 'string' || !CLOUD_DEVICE_ID.test(config.deviceId)
        || typeof config.apiKey !== 'string' || !API_KEY.test(config.apiKey)
        || typeof config.installationId !== 'string' || !INSTALLATION_ID.test(config.installationId)
        || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
      throw new TidbytConfigurationError('invalid-configuration');
    }
    this.#deviceId = config.deviceId;
    this.#apiKey = config.apiKey;
    this.#installationId = config.installationId;
    this.additionalInstallations = Object.freeze([...additional]);
    this.#timeoutMs = timeoutMs;
    this.#fetch = config.fetch ?? globalThis.fetch;
    this.#now = config.now ?? Date.now;
  }

  #request(path: string, signal: AbortSignal, body?: string, method = body === undefined ? 'GET' : 'POST'): Promise<Response> {
    return this.#fetch(`${API}/devices/${encodeURIComponent(this.#deviceId)}${path}`, {
      method,
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(this.#timeoutMs)]),
      headers: { authorization: `Bearer ${this.#apiKey}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body }),
    });
  }

  /** The installation to target, or undefined when `installation` is not one this connection may write. */
  #target(installation: string | undefined): string | undefined {
    if (installation === undefined) return this.#installationId;
    return this.additionalInstallations.includes(installation) ? installation : undefined;
  }

  async push(webp: Uint8Array, signal: AbortSignal, installation?: string): Promise<PushOutcome> {
    const target = this.#target(installation);
    if (target === undefined) return REFUSED;
    const body = JSON.stringify({
      deviceID: this.#deviceId, image: Buffer.from(webp).toString('base64'),
      installationID: target, background: true,
    });
    return this.#write(() => this.#request('/push', signal, body));
  }

  async remove(signal: AbortSignal, installation?: string): Promise<PushOutcome> {
    const target = this.#target(installation);
    if (target === undefined) return REFUSED;
    return this.#write(() => this.#request(`/installations/${target}`, signal, undefined, 'DELETE'));
  }

  /** Send one write and classify it once. */
  async #write(send: () => Promise<Response>): Promise<PushOutcome> {
    let response: Response;
    try {
      response = await send();
    } catch (error) {
      const failure = networkFailure(error);
      return failure === 'uncertain' ? { outcome: 'uncertain' } : { outcome: 'failed', failure, priorEffects: 'none' };
    }
    if (response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { outcome: 'sent' };
    }
    const failure = await rejection(response);
    if (failure === 'uncertain') return { outcome: 'uncertain' };
    if (failure === 'capacity') {
      return { outcome: 'failed', failure, priorEffects: 'none', retryAfterMs: retryAfterMs(response.headers.get('retry-after'), this.#now()) };
    }
    return { outcome: 'failed', failure, priorEffects: 'none' };
  }

  async readInstallation(signal: AbortSignal, installation?: string): Promise<InstallationRead> {
    const target = this.#target(installation);
    if (target === undefined) return { ok: false, failure: 'invalid-request' };
    try {
      const response = await this.#request('/installations', signal);
      if (!response.ok) {
        const failure = await rejection(response);
        return { ok: false, failure: failure === 'uncertain' ? 'transport-failure' : failure };
      }
      const value = JSON.parse(await boundedText(response, MAX_BODY) ?? '');
      if (!Array.isArray(value?.installations)) return { ok: false, failure: 'transport-failure' };
      return { ok: true, present: value.installations.some((i: unknown) => (i as { id?: unknown })?.id === target) };
    } catch {
      return { ok: false, failure: 'transport-failure' };
    }
  }
}
