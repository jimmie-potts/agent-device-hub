// The simulated Tidbyt cloud (Hub #930, #846): the transport tests and disposable runs give the Tidbyt module, so no
// request reaches the real cloud. It answers the three calls the module makes, as the push qualification (#16) recorded
// them: a background push, an installation's removal and the installation list, with the cloud's status codes, so the
// module's own classification runs on its answers. It accepts only its API key and its device, and shows what each
// installation was last sent as text rows (`picture`). Like the real cloud, it keeps its installations when the
// runtime restarts. A test or a run can make it stop answering, refuse connections, or answer the next call with a
// status of its choice.
import {API, type CloudFetch} from './cloud.js';
import {decodeLossless, picture} from './picture.js';

/**
 * The key the simulated cloud accepts by default: the synthetic token the runtime's tests and disposable runs write to
 * every secret file (`tok_SYNTHETIC919`). It is no credential.
 */
export const SIMULATED_API_KEY = 'tok_SYNTHETIC919';
/** The cloud device ID of the simulated Tidbyt, which the module's simulated section names. */
export const SIMULATED_DEVICE = 'simulated-tidbyt';

/** What one installation shows: the frame it was last sent, as text rows, and every push it accepted. */
export type ShownInstallation = {picture: string[]; pushes: number; pushedAtMs: number[]};
/** One call the cloud heard: what it was, for which installation, and how it answered. */
export type CloudCall = {method: 'GET' | 'POST' | 'DELETE'; installation?: string; atMs: number; answer: number | 'none' | 'refused-connection'};
/** What the simulated cloud shows, as plain data. */
export type CloudState = {
  online: boolean;
  installations: Record<string, ShownInstallation>;
  calls: CloudCall[];
  /** Calls refused for a wrong key. */
  refusedKeys: number;
};
export type SimulatedCloudOptions = {
  /** Whether it answers at first. Defaults to true. */
  online?: boolean;
  key?: string;
  device?: string;
  /** Installations already in the rotation, as a leftover tile would be. */
  installations?: readonly string[];
  /** The clock it stamps calls with. Defaults to `Date.now`. */
  now?: () => number;
};

type Route = {path: 'push' | 'installations' | 'installation' | 'other'; device: string; installation?: string};
/** How many calls the simulated cloud remembers, the latest last. */
export const REMEMBERED_CALLS = 512;

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json', ...headers}});
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A call that never answers: it rejects once `signal` aborts, as a lost request would. */
const silence = (signal: AbortSignal): Promise<never> => new Promise((_, reject) => {
  const lost = (): void => { reject(new DOMException('the cloud did not answer', 'AbortError')); };
  if (signal.aborted) lost();
  else signal.addEventListener('abort', lost, {once: true});
});

/** A connection refused before anything was sent, as undici reports it. */
const refusedConnection = (): Error => new TypeError('fetch failed', {cause: Object.assign(new Error('connect ECONNREFUSED'), {code: 'ECONNREFUSED'})});

/** The simulated Tidbyt cloud for one device. */
export class SimulatedCloud {
  readonly #key: string;
  readonly #device: string;
  readonly #now: () => number;
  readonly #installations = new Map<string, ShownInstallation>();
  readonly #calls: CloudCall[] = [];
  #online: boolean;
  #refuseConnections = false;
  /** Answers that replace the cloud's own: each next call takes the first, and `always` stands for every call after them. */
  readonly #answers: {status: number; retryAfter?: string}[] = [];
  #always: {status: number; retryAfter?: string} | undefined;
  #refusedKeys = 0;

  constructor({online = true, key = SIMULATED_API_KEY, device = SIMULATED_DEVICE, installations = [], now = Date.now}: SimulatedCloudOptions = {}) {
    this.#online = online;
    this.#key = key;
    this.#device = device;
    this.#now = now;
    for (const id of installations) this.#installations.set(id, {picture: [], pushes: 0, pushedAtMs: []});
  }

  /** The module's transport: one request, answered as the cloud would. */
  readonly fetch: CloudFetch = (url, init) => this.#answer(url, init);

  /** The cloud stops answering, as one that is unreachable: every call waits until its deadline. */
  offline(): void {
    this.#online = false;
  }

  online(): void {
    this.#online = true;
    this.#refuseConnections = false;
  }

  /** Connections are refused before anything is sent, as when the host has no route to the cloud. */
  refuseConnections(): void {
    this.#refuseConnections = true;
  }

  /** The next call is answered with this status, and `Retry-After` when given, and then the cloud answers as before. Calls queue. */
  answerNext(status: number, retryAfter?: string): void {
    this.#answers.push({status, ...(retryAfter === undefined ? {} : {retryAfter})});
  }

  /** Every call is answered with this status until it is cleared with undefined, as a cloud that keeps refusing. */
  answerAlways(status: number | undefined): void {
    this.#always = status === undefined ? undefined : {status};
  }

  state(): CloudState {
    const installations: Record<string, ShownInstallation> = {};
    for (const [id, shown] of this.#installations) installations[id] = {picture: [...shown.picture], pushes: shown.pushes, pushedAtMs: [...shown.pushedAtMs]};
    return {online: this.#online, installations, calls: this.#calls.map(call => ({...call})), refusedKeys: this.#refusedKeys};
  }

  async #answer(url: string, init: Parameters<CloudFetch>[1]): Promise<Response> {
    const route = this.#route(url, init.method);
    const call: CloudCall = {method: init.method, ...(route.installation === undefined ? {} : {installation: route.installation}), atMs: this.#now(), answer: 'none'};
    this.#calls.push(call);
    if (this.#calls.length > REMEMBERED_CALLS) this.#calls.splice(0, this.#calls.length - REMEMBERED_CALLS);
    if (this.#refuseConnections) {
      call.answer = 'refused-connection';
      throw refusedConnection();
    }
    if (!this.#online) return await silence(init.signal);
    const response = this.#reply(route, init);
    call.answer = response.status;
    return response;
  }

  #route(url: string, method: string): Route {
    const prefix = `${API}/devices/`;
    if (!url.startsWith(prefix)) return {path: 'other', device: ''};
    const [device = '', ...rest] = url.slice(prefix.length).split('/').map(part => decodeURIComponent(part));
    if (method === 'POST' && rest.length === 1 && rest[0] === 'push') return {path: 'push', device};
    if (method === 'GET' && rest.length === 1 && rest[0] === 'installations') return {path: 'installations', device};
    const [segment, installation] = rest;
    if (method === 'DELETE' && rest.length === 2 && segment === 'installations' && installation !== undefined) return {path: 'installation', device, installation};
    return {path: 'other', device};
  }

  #reply(route: Route, init: Parameters<CloudFetch>[1]): Response {
    if (init.headers.authorization !== `Bearer ${this.#key}`) {
      this.#refusedKeys += 1;
      return json(401, {code: 16, message: 'request unauthenticated'});
    }
    const next = this.#answers.shift() ?? this.#always;
    if (next !== undefined) return json(next.status, {}, next.retryAfter === undefined ? {} : {'retry-after': next.retryAfter});
    if (route.device !== this.#device) return json(404, {message: 'device not found'});
    switch (route.path) {
      case 'push':
        return this.#push(init.body);
      case 'installations':
        return json(200, {installations: [...this.#installations.keys()].map(id => ({id, appID: ''}))});
      case 'installation':
        // Removing an installation that is already gone changes nothing, and the simulated cloud answers it like any other.
        if (route.installation !== undefined) this.#installations.delete(route.installation);
        return json(200, {});
      case 'other':
        return json(404, {message: 'not found'});
    }
  }

  #push(body: string | undefined): Response {
    let request: unknown;
    try {
      request = JSON.parse(body ?? '');
    } catch {
      return json(400, {message: 'invalid body'});
    }
    if (!isObject(request) || request.deviceID !== this.#device || typeof request.image !== 'string' || typeof request.installationID !== 'string' ||
      request.background !== true) {
      return json(400, {message: 'invalid push'});
    }
    const decoded = decodeLossless(new Uint8Array(Buffer.from(request.image, 'base64')));
    if (decoded === undefined) return json(400, {message: 'invalid image'});
    const shown = this.#installations.get(request.installationID) ?? {picture: [], pushes: 0, pushedAtMs: []};
    shown.picture = picture(decoded.rgb, decoded.width, decoded.height);
    shown.pushes += 1;
    shown.pushedAtMs.push(this.#now());
    this.#installations.set(request.installationID, shown);
    return json(200, {});
  }
}
