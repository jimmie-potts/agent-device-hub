// The simulated Tronbyt server (Hub #23), beside the simulated cloud. It answers the module's calls as server v2.5.1
// answered them on a disposable run: a push names its installation or joins an anonymous queue, `background` defaults to
// false, the list carries the server's own numeric IDs, asking for or deleting an installation by the name a push chose
// works, a missing one answers 404 "App not found" and a missing device "Device not found", both as plain text,
// brightness is stored unchecked, and deleting a pinned installation leaves the pin. Like the simulated cloud, it can stop
// answering, refuse connections, answer the next call with a status of its choice, or lose the next answer.
import type {CloudFetch} from './cloud.js';
import {decodeLossless, picture} from './picture.js';
import {SIMULATED_API_KEY, SIMULATED_DEVICE} from './simulated.js';

/** The origin of the simulated server, which a simulated section names. */
export const TRONBYT_ORIGIN = 'http://tronbyt.local:8000';

type Installation = {serverId: string; picture: string[]; pushes: number; immediate: number; pushedAtMs: number[]};
export type TronbytState = {
  installations: Record<string, Installation>;
  /** Pushes that named no installation, which the server queues for the device. The module must never make one. */
  anonymous: number;
  brightness: number;
  /** The server's own ID of the pinned installation, or null. It can point at one already deleted. */
  pinnedApp: string | null;
  calls: {method: string; path: string; answer: number | 'none' | 'refused-connection'}[];
};
export type SimulatedTronbytOptions = {
  key?: string;
  device?: string;
  origin?: string;
  installations?: readonly string[];
  now?: () => number;
};

const text = (status: number, body: string): Response => new Response(`${body}\n`, {status, headers: {'content-type': 'text/plain; charset=utf-8'}});
const json = (body: unknown): Response => new Response(JSON.stringify(body), {status: 200, headers: {'content-type': 'application/json'}});
const refusedConnection = (): Error => new TypeError('fetch failed', {cause: Object.assign(new Error('connect ECONNREFUSED'), {code: 'ECONNREFUSED'})});
const silence = (signal: AbortSignal): Promise<never> => new Promise((_, reject) => {
  const lost = (): void => { reject(new DOMException('the server did not answer', 'AbortError')); };
  if (signal.aborted) lost();
  else signal.addEventListener('abort', lost, {once: true});
});

/** A simulated Tronbyt server with one device. */
export class SimulatedTronbyt {
  readonly #key: string;
  readonly #device: string;
  readonly #origin: string;
  readonly #now: () => number;
  readonly #installations = new Map<string, Installation>();
  readonly #calls: TronbytState['calls'] = [];
  #nextId = 100;
  #anonymous = 0;
  #brightness = 25;
  #pinned: string | null = null;
  #online = true;
  #refuse = false;
  #loseAnswers = 0;
  readonly #answers: number[] = [];
  readonly #patchAnswers: number[] = [];

  constructor({key = SIMULATED_API_KEY, device = SIMULATED_DEVICE, origin = TRONBYT_ORIGIN, installations = [], now = Date.now}: SimulatedTronbytOptions = {}) {
    this.#key = key;
    this.#device = device;
    this.#origin = origin;
    this.#now = now;
    for (const name of installations) this.#add(name);
  }

  readonly fetch: CloudFetch = async (url, init) => {
    const path = url.startsWith(this.#origin) ? url.slice(this.#origin.length) : url;
    const call: TronbytState['calls'][number] = {method: init.method, path, answer: 'none'};
    this.#calls.push(call);
    if (this.#refuse) {
      call.answer = 'refused-connection';
      throw refusedConnection();
    }
    if (!this.#online) return await silence(init.signal);
    const response = this.#reply(path, init);
    call.answer = response.status;
    if (this.#loseAnswers > 0) {
      this.#loseAnswers -= 1;
      call.answer = 'none';
      return await silence(init.signal);
    }
    return response;
  };

  offline(): void { this.#online = false; }
  online(): void { this.#online = true; this.#refuse = false; }
  refuseConnections(): void { this.#refuse = true; }
  answerNext(status: number): void { this.#answers.push(status); }
  /** The next PATCH is answered with this status, whatever calls come before it. */
  answerNextPatch(status: number): void { this.#patchAnswers.push(status); }
  loseNextAnswer(): void { this.#loseAnswers += 1; }

  state(): TronbytState {
    const installations: TronbytState['installations'] = {};
    for (const [name, entry] of this.#installations) installations[name] = {...entry, picture: [...entry.picture], pushedAtMs: [...entry.pushedAtMs]};
    return {installations, anonymous: this.#anonymous, brightness: this.#brightness, pinnedApp: this.#pinned, calls: this.#calls.map(call => ({...call}))};
  }

  #add(name: string): Installation {
    const entry: Installation = {serverId: String(this.#nextId++), picture: [], pushes: 0, immediate: 0, pushedAtMs: []};
    this.#installations.set(name, entry);
    return entry;
  }

  #payload(entry: Installation): object {
    return {id: entry.serverId, appID: 'pushed', enabled: true, pinned: this.#pinned === entry.serverId, pushed: true};
  }

  #reply(path: string, init: Parameters<CloudFetch>[1]): Response {
    if (init.headers.authorization !== `Bearer ${this.#key}`) return text(401, 'Unauthorized');
    const status = (init.method === 'PATCH' ? this.#patchAnswers.shift() : undefined) ?? this.#answers.shift();
    if (status !== undefined) return text(status, 'Simulated');
    const match = /^\/v0\/devices\/([^/]+)(?:\/(push|installations)(?:\/([^/]+))?)?$/.exec(path);
    if (match === null) return text(404, 'Not Found');
    const [, device = '', section, name] = match;
    if (decodeURIComponent(device) !== this.#device) return text(404, 'Device not found');
    if (section === undefined && init.method === 'PATCH') return this.#patchDevice(init.body);
    if (section === 'push' && init.method === 'POST') return this.#push(init.body);
    if (section === 'installations' && name === undefined && init.method === 'GET') return json({installations: [...this.#installations.values()].map(entry => this.#payload(entry))});
    if (section === 'installations' && name !== undefined) {
      const entry = this.#installations.get(name);
      if (entry === undefined) return text(404, 'App not found');
      if (init.method === 'GET') return json(this.#payload(entry));
      if (init.method === 'DELETE') {
        this.#installations.delete(name);
        return text(200, 'App deleted.');
      }
      if (init.method === 'PATCH') {
        if ((JSON.parse(init.body ?? '{}') as {pinned?: boolean}).pinned === true) this.#pinned = entry.serverId;
        return json(this.#payload(entry));
      }
    }
    return text(405, 'Method Not Allowed');
  }

  #patchDevice(body: string | undefined): Response {
    const update = JSON.parse(body ?? '{}') as {brightness?: number; pinnedApp?: string};
    if (update.brightness !== undefined) this.#brightness = update.brightness;
    if (update.pinnedApp !== undefined) this.#pinned = update.pinnedApp === '' ? null : update.pinnedApp;
    return json({id: this.#device, brightness: this.#brightness, pinnedApp: this.#pinned});
  }

  #push(body: string | undefined): Response {
    const request = JSON.parse(body ?? '{}') as {image?: string; installationID?: string; background?: boolean};
    if (typeof request.image !== 'string') return text(400, 'Invalid Base64 Image');
    if (request.installationID === undefined || request.installationID === '') {
      this.#anonymous += 1;
      return text(200, 'WebP received.');
    }
    const decoded = decodeLossless(new Uint8Array(Buffer.from(request.image, 'base64')));
    if (decoded === undefined) return text(400, 'Invalid image');
    const entry = this.#installations.get(request.installationID) ?? this.#add(request.installationID);
    entry.picture = picture(decoded.rgb, decoded.width, decoded.height);
    entry.pushes += 1;
    if (request.background !== true) entry.immediate += 1;
    entry.pushedAtMs.push(this.#now());
    return text(200, 'WebP received.');
  }
}
