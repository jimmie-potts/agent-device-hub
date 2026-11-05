// The simulated Tronbyt server (Hub #23), beside the simulated cloud. It answers the module's calls as server v2.5.1
// answered them on a disposable run: a push names its installation or joins an anonymous queue, `background` defaults to
// false, the list carries the server's own numeric IDs, asking for or deleting an installation by the name a push chose
// works, a missing one answers 404 "App not found" and a missing device "Device not found", both as plain text,
// brightness is stored unchecked, deleting a pinned installation leaves the pin, and unpinning an installation clears only
// its own pin. The loop serving a connected device keeps its own copy of the installations, as server v2.5.2's does: a
// delete, a PATCH, an interrupting push or showing one of them reloads it, so a background push that creates an installation
// while it has none to show does not (Hub #1411). Like the simulated cloud, it can stop answering, refuse connections,
// answer the next call with a status of its choice, or lose the next answer.
import type {CloudFetch} from './cloud.js';
import {createHash} from 'node:crypto';
import {decodeLossless, picture} from './picture.js';
import {SIMULATED_API_KEY, SIMULATED_DEVICE} from './simulated.js';

/** The origin of the simulated server, which a simulated section names. */
export const TRONBYT_ORIGIN = 'http://tronbyt.local:8000';

type Animation = {frames: string[][]; delaysMs: number[]; byteLength: number; sha256: string};
type Installation = {serverId: string; picture: string[]; animation?: Animation; pushes: number; immediate: number; pushedAtMs: number[]};
export type TronbytState = {
  installations: Record<string, Installation>;
  /** Pushes that named no installation, which the server queues for the device. The module must never make one. */
  anonymous: number;
  brightness: number;
  /** How many writes set the brightness, apart from the pin's. */
  brightnessWrites: number;
  /** How many writes pinned an installation, apart from the empty ones that only reload the list. */
  pinWrites: number;
  /** The server's own ID of the pinned installation, or null. It can point at one already deleted. */
  pinnedApp: string | null;
  /** The installations the loop serving a connected device would rotate through; empty is the server's setup screen. */
  served: string[];
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
  #brightnessWrites = 0;
  #pinWrites = 0;
  #pinned: string | null = null;
  #served: string[] = [];
  #online = true;
  #refuse = false;
  #loseAnswers = 0;
  readonly #answers: number[] = [];
  readonly #patchAnswers: number[] = [];
  readonly #reloadAnswers: number[] = [];

  constructor({key = SIMULATED_API_KEY, device = SIMULATED_DEVICE, origin = TRONBYT_ORIGIN, installations = [], now = Date.now}: SimulatedTronbytOptions = {}) {
    this.#key = key;
    this.#device = device;
    this.#origin = origin;
    this.#now = now;
    for (const name of installations) this.#add(name);
    this.#reload();
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
    const response = await this.#reply(path, init);
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
  /** The next empty PATCH of an installation, which only reloads the list, is answered with this status. */
  answerNextReload(status: number): void { this.#reloadAnswers.push(status); }
  loseNextAnswer(): void { this.#loseAnswers += 1; }
  /** Pins an installation as a person does on the server's own page. */
  pinByHand(name: string): void { this.#pinned = this.#installations.get(name)?.serverId ?? null; }

  state(): TronbytState {
    const installations: TronbytState['installations'] = {};
    for (const [name, entry] of this.#installations) installations[name] = {...entry, picture: [...entry.picture], pushedAtMs: [...entry.pushedAtMs],
      ...(entry.animation === undefined ? {} : {animation: {...entry.animation, frames: entry.animation.frames.map(frame => [...frame]), delaysMs: [...entry.animation.delaysMs]}})};
    return {installations, anonymous: this.#anonymous, brightness: this.#brightness, brightnessWrites: this.#brightnessWrites, pinWrites: this.#pinWrites, pinnedApp: this.#pinned, served: [...this.#served], calls: this.#calls.map(call => ({...call}))};
  }

  /** What a loop serving a connected device learns from every write but a background push into an empty list. */
  #reload(): void {
    this.#served = [...this.#installations.keys()];
  }

  #add(name: string): Installation {
    const entry: Installation = {serverId: String(this.#nextId++), picture: [], pushes: 0, immediate: 0, pushedAtMs: []};
    this.#installations.set(name, entry);
    return entry;
  }

  #payload(entry: Installation): object {
    return {id: entry.serverId, appID: 'pushed', enabled: true, pinned: this.#pinned === entry.serverId, pushed: true};
  }

  async #reply(path: string, init: Parameters<CloudFetch>[1]): Promise<Response> {
    if (init.headers.authorization !== `Bearer ${this.#key}`) return text(401, 'Unauthorized');
    const reloading = init.method === 'PATCH' && path.includes('/installations/') && init.body === '{}';
    const status = (reloading ? this.#reloadAnswers.shift() : undefined) ?? (init.method === 'PATCH' ? this.#patchAnswers.shift() : undefined) ?? this.#answers.shift();
    if (status !== undefined) return text(status, 'Simulated');
    const match = /^\/v0\/devices\/([^/]+)(?:\/(push|installations)(?:\/([^/]+))?)?$/.exec(path);
    if (match === null) return text(404, 'Not Found');
    const [, device = '', section, name] = match;
    if (decodeURIComponent(device) !== this.#device) return text(404, 'Device not found');
    if (section === undefined && init.method === 'PATCH') return this.#patchDevice(init.body);
    if (section === undefined && init.method === 'GET') return json({id: this.#device, brightness: this.#brightness, pinnedApp: this.#pinned});
    if (section === 'push' && init.method === 'POST') return this.#push(init.body);
    if (section === 'installations' && name === undefined && init.method === 'GET') return json({installations: [...this.#installations.values()].map(entry => this.#payload(entry))});
    if (section === 'installations' && name !== undefined) {
      const entry = this.#installations.get(name);
      if (entry === undefined) return text(404, 'App not found');
      if (init.method === 'GET') return json(this.#payload(entry));
      if (init.method === 'DELETE') {
        this.#installations.delete(name);
        this.#reload();
        return text(200, 'App deleted.');
      }
      if (init.method === 'PATCH') {
        const {pinned} = JSON.parse(init.body ?? '{}') as {pinned?: boolean};
        if (pinned === true) {
          this.#pinned = entry.serverId;
          this.#pinWrites += 1;
        } else if (pinned === false && this.#pinned === entry.serverId) {
          this.#pinned = null;
        }
        this.#reload();
        return json(this.#payload(entry));
      }
    }
    return text(405, 'Method Not Allowed');
  }

  #patchDevice(body: string | undefined): Response {
    const update = JSON.parse(body ?? '{}') as {brightness?: number; pinnedApp?: string};
    if (update.brightness !== undefined) {
      this.#brightness = update.brightness;
      this.#brightnessWrites += 1;
    }
    if (update.pinnedApp !== undefined) this.#pinned = update.pinnedApp === '' ? null : update.pinnedApp;
    this.#reload();
    return json({id: this.#device, brightness: this.#brightness, pinnedApp: this.#pinned});
  }

  async #push(body: string | undefined): Promise<Response> {
    const request = JSON.parse(body ?? '{}') as {image?: string; installationID?: string; background?: boolean};
    if (typeof request.image !== 'string') return text(400, 'Invalid Base64 Image');
    if (request.installationID === undefined || request.installationID === '') {
      this.#anonymous += 1;
      return text(200, 'WebP received.');
    }
    const bytes = Buffer.from(request.image, 'base64');
    const decoded = decodeLossless(bytes);
    const animation = decoded === undefined ? await animatedPicture(bytes) : undefined;
    if (decoded === undefined && animation === undefined) return text(400, 'Invalid image');
    const entry = this.#installations.get(request.installationID) ?? this.#add(request.installationID);
    // A loop showing an installation reloads its copy at the device's next acknowledgment.
    if (this.#served.length > 0) this.#reload();
    entry.picture = decoded === undefined ? animation?.frames[0] ?? [] : picture(decoded.rgb, decoded.width, decoded.height);
    if (animation === undefined) delete entry.animation;
    else entry.animation = animation;
    entry.pushes += 1;
    if (request.background !== true) {
      entry.immediate += 1;
      this.#reload();
    }
    entry.pushedAtMs.push(this.#now());
    return text(200, 'WebP received.');
  }
}

/**
 * The #681 native art envelope: at most 160 KiB, 20 full 64×32 frames and 16 seconds, with 100–800 ms delays.
 * Framing is checked before native decoding; these are synthetic readback bounds, not a physical playback claim.
 */
function animationDelays(bytes: Buffer): number[] | undefined {
  if (bytes.length < 44 || bytes.length > 163_840 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.readUInt32LE(4) !== bytes.length - 8 || bytes.toString('ascii', 8, 12) !== 'WEBP') return;
  let at = 12, extended = false, animation = false;
  const delays: number[] = [];
  while (at + 8 <= bytes.length) {
    const kind = bytes.toString('ascii', at, at + 4), size = bytes.readUInt32LE(at + 4), start = at + 8;
    if (size > bytes.length - start || ((size & 1) !== 0 && bytes[start + size] !== 0)) return;
    if (kind === 'VP8X') {
      if (at !== 12 || size !== 10 || bytes[start] !== 2 || bytes.readUIntLE(start + 4, 3) !== 63 || bytes.readUIntLE(start + 7, 3) !== 31) return;
      if (bytes.subarray(start + 1, start + 4).some(value => value !== 0)) return;
      extended = true;
    } else if (kind === 'ANIM') {
      if (!extended || animation || delays.length !== 0 || size !== 6) return;
      animation = true;
    } else if (kind === 'ANMF') {
      if (!animation || delays.length === 20 || size < 24) return;
      const width = bytes.readUIntLE(start + 6, 3) + 1, height = bytes.readUIntLE(start + 9, 3) + 1;
      const delay = bytes.readUIntLE(start + 12, 3);
      if (bytes.readUIntLE(start, 3) !== 0 || bytes.readUIntLE(start + 3, 3) !== 0 || width !== 64 || height !== 32 || (bytes[start + 15] ?? 255) > 3 || delay < 100 || delay > 800) return;
      let frameAt = start + 16, image = false;
      while (frameAt + 8 <= start + size) {
        const frameKind = bytes.toString('ascii', frameAt, frameAt + 4), frameSize = bytes.readUInt32LE(frameAt + 4);
        if (image || (frameKind !== 'VP8L' && frameKind !== 'VP8 ') || frameSize > start + size - frameAt - 8) return;
        if ((frameSize & 1) !== 0 && bytes[frameAt + 8 + frameSize] !== 0) return;
        image = true;
        frameAt += 8 + frameSize + (frameSize & 1);
      }
      if (!image || frameAt !== start + size) return;
      delays.push(delay);
    } else return;
    at = start + size + (size & 1);
  }
  return at === bytes.length && delays.length > 0 && delays.reduce((sum, delay) => sum + delay, 0) <= 16_000 ? delays : undefined;
}

/** Independent libwebp decoding makes the simulated display's readback inspectable beyond the encoder's own parser. */
async function animatedPicture(bytes: Buffer): Promise<Animation | undefined> {
  const delaysMs = animationDelays(bytes);
  if (delaysMs === undefined) return;
  try {
    const {default: sharp} = await import('sharp');
    const decoded = sharp(bytes, {animated: true, limitInputPixels: 64 * 32 * 20, failOn: 'warning'});
    const metadata = await decoded.metadata();
    if (metadata.format !== 'webp' || metadata.width !== 64 || (metadata.pageHeight ?? metadata.height) !== 32 || metadata.pages !== delaysMs.length || JSON.stringify(metadata.delay) !== JSON.stringify(delaysMs)) return;
    const {data, info} = await decoded.flatten({background: '#000000'}).removeAlpha().raw().toBuffer({resolveWithObject: true});
    if (info.width !== 64 || info.height !== 32 * delaysMs.length || info.channels !== 3 || data.length !== 6144 * delaysMs.length) return;
    return {frames: delaysMs.map((_, frame) => picture(data.subarray(frame * 6144, (frame + 1) * 6144))), delaysMs, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')};
  } catch {return;}
}
