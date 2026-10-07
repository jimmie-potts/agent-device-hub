// Simulated Nanoleaf controllers (Hub #844, #846): the transport tests and disposable runs give the Nanoleaf module, so
// no device is touched. Each simulated controller answers the local API's requests the module makes, as a Lines or an
// NL22 Light Panels controller would: its layout, its saved scenes and selection, its power and brightness, and effect
// writes. Like real devices, simulated ones keep their state across a runtime restart. A test can take one offline, so
// that it never answers, hold its requests until released, lose a write's answer, make it answer one write with an HTTP
// error, delete one of its scenes, or change its power or token as the Nanoleaf app would. A device that answers with an
// error status throws the transport's `HttpError`, as the Nanoleaf HTTP client does.
import {isObject} from '../compat.js';
import {ValueError} from '../errors.js';
import {NEIGHBOR} from '../panels.js';
import {HttpError, type LightAddress, type LightRequest} from '../transport.js';

/** The synthetic token every simulated controller accepts. It is no credential and must appear in no message, record or proof. */
export const SYNTHETIC_TOKEN = 'tok_SYNTHETIC919';
/** The simulated Lines controller's address: TEST-NET-1, a private address no real device on this network uses. */
export const LINES_ADDRESS = '192.0.2.10';
/** The simulated NL22 Light Panels controller's address. */
export const PANELS_ADDRESS = '192.0.2.11';
/** The scenes every simulated controller has saved, the first one playing at first. */
export const SCENES: readonly string[] = Object.freeze(['Beach Waves', 'Northern Lights']);
/** How many Lines and triangles the simulated layouts have. */
export const SIMULATED_LINES = 6;
export const SIMULATED_TRIANGLES = 4;

export type SimulatedKind = 'lines' | 'panels';
/** What a scenario can make the simulated controllers do. */
export type SimulatedAction = 'online' | 'offline' | 'power-on' | 'power-off' | 'lose-next-answer';

/** One write a simulated controller took, summarized: its endpoint and what it set. */
export type SimulatedWrite = {
  endpoint: string; atMs: number; on?: boolean; brightness?: number; select?: string; animType?: string; loop?: boolean;
};
/** How many recent writes a simulated controller keeps. */
export const KEPT_WRITES = 64;

/** What one simulated controller shows, as plain data a disposable run can report. */
export type SimulatedDevice = {
  kind: SimulatedKind;
  on: boolean;
  brightness: number;
  /** The playing selection: a saved scene's name, `*Dynamic*` after an effect write, or `*Static*`. */
  select: string;
  /** The scenes saved on the controller, which its effect list reports. */
  scenes: string[];
  /** The animation type of the last effect write (`custom` or `static`), or null before one. */
  effect: string | null;
  /** Requests that reached the controller: reads and writes. */
  reads: number;
  writes: number;
  /** The last `KEPT_WRITES` writes, oldest first. */
  recent: SimulatedWrite[];
};
export type SimulatedState = {online: boolean; held: number; devices: Record<string, SimulatedDevice>};

/** A Lines layout as the controller reports it: two light zones per Line, collinear, and the Lines side by side. */
function linesLayout(count: number): object {
  const positionData = Array.from({length: count}, (_, line) => [
    {panelId: 100 + line * 2, x: line * 100, y: 0, o: 0, shapeType: 18},
    {panelId: 101 + line * 2, x: line * 100, y: 20, o: 0, shapeType: 18},
  ]).flat();
  return {layout: {numPanels: positionData.length, sideLength: 0, positionData}, globalOrientation: {value: 0, max: 360, min: 0}};
}

/** An NL22 layout as the controller reports it: a strip of triangles, each touching the next. */
function panelsLayout(count: number): object {
  const positionData = Array.from({length: count}, (_, index) => ({panelId: 200 + index, x: Math.round(index * NEIGHBOR), y: 0, o: index % 2 === 0 ? 0 : 60, shapeType: 0}));
  return {layout: {numPanels: count, sideLength: 150, positionData}, globalOrientation: {value: 0, max: 360, min: 0}};
}

type Held = {resolve: () => void};

/**
 * Simulated Nanoleaf controllers by address, which `request` answers as the module's light transport. A request with
 * another token is refused with HTTP 401, as a real controller refuses it; one to an address without a controller never
 * reaches one.
 */
export class SimulatedNanoleaf {
  readonly #devices = new Map<string, SimulatedDevice>();
  #token: string;
  readonly #held: Held[] = [];
  #online: boolean;
  #holding = false;
  /** Writes to these endpoints are applied, but their answers are lost, once each. */
  readonly #lost: string[] = [];
  /** Writes to these endpoints are answered with an HTTP error status and not applied, once each. */
  readonly #refusals: {endpoint: string; status: number}[] = [];

  readonly #now: () => number;
  readonly #anyAddress: boolean;

  /**
   * `devices` places a controller of each kind at each address. With `anyAddress`, an address without one gets a Lines
   * controller when it is first asked, so the runtime's `--simulate` build answers whatever addresses its configuration
   * names, the simulated Panels address excepted, where a Light Panels controller answers.
   */
  constructor({online = true, token = SYNTHETIC_TOKEN, devices = {[LINES_ADDRESS]: 'lines'}, now = () => Date.now(), anyAddress = false}: {
    online?: boolean; token?: string; devices?: Readonly<Record<string, SimulatedKind>>; now?: () => number; anyAddress?: boolean;
  } = {}) {
    this.#online = online;
    this.#token = token;
    this.#now = now;
    this.#anyAddress = anyAddress;
    for (const [address, kind] of Object.entries(devices)) {
      this.#add(address, kind);
    }
  }

  #add(address: string, kind: SimulatedKind): SimulatedDevice {
    const device: SimulatedDevice = {kind, on: true, brightness: 50, select: SCENES[0] ?? '', scenes: [...SCENES], effect: null, reads: 0, writes: 0, recent: []};
    this.#devices.set(address, device);
    return device;
  }

  /** The module's light transport. An offline controller never answers: the module's own deadline ends the request. */
  readonly request: LightRequest = (address: LightAddress, method: string, endpoint = '', payload: unknown = null): Promise<unknown> => {
    if (!this.#online) return new Promise<never>(() => {});
    const lost = method !== 'GET' ? this.#lost.indexOf(endpoint) : -1;
    if (lost >= 0) {
      // The write reaches the controller, and its answer never comes back.
      this.#lost.splice(lost, 1);
      return Promise.resolve().then(() => this.#answer(address, method, endpoint, payload)).then(() => new Promise<never>(() => {}));
    }
    const answer = (): unknown => this.#answer(address, method, endpoint, payload);
    if (!this.#holding) return Promise.resolve().then(answer);
    return new Promise<void>(resolve => { this.#held.push({resolve}); }).then(answer);
  };

  online(): void {
    this.#online = true;
  }

  offline(): void {
    this.#online = false;
  }

  /** Holds every request from now on until `release`, as a controller that is slow to answer. */
  hold(): void {
    this.#holding = true;
  }

  /** Answers every held request, in order, and answers later ones at once. */
  release(): void {
    this.#holding = false;
    for (const held of this.#held.splice(0)) held.resolve();
  }

  /** The next write to `endpoint` reaches the controller, which applies it, but its answer is lost. */
  loseNextAnswer(endpoint: string): void {
    this.#lost.push(endpoint);
  }

  /** The next write to `endpoint` is answered with the HTTP error `status`, as a controller that refuses it, and not applied. */
  refuseNext(endpoint: string, status: number): void {
    this.#refusals.push({endpoint, status});
  }

  /** Deletes a saved scene from a controller, as the Nanoleaf app would; a later selection of it is refused with 404. */
  removeScene(address: string, name: string): void {
    const device = this.#devices.get(address);
    if (device !== undefined) device.scenes = device.scenes.filter(scene => scene !== name);
  }

  /** The controllers accept only `token` from now on, as after the owner paired the module again; others get 401. */
  setToken(token: string): void {
    this.#token = token;
  }

  /**
   * What a scenario makes the simulated controllers do: answer or not, switch the Lines as the Nanoleaf app would, or
   * lose the answer to the next power or brightness write.
   */
  act(action: SimulatedAction): void {
    switch (action) {
      case 'online': this.online(); return;
      case 'offline': this.offline(); return;
      case 'power-on': this.setPower(LINES_ADDRESS, true); return;
      case 'power-off': this.setPower(LINES_ADDRESS, false); return;
      case 'lose-next-answer': this.loseNextAnswer('/state'); return;
    }
  }

  /** Switches a controller on or off as the Nanoleaf app or its power button would. */
  setPower(address: string, on: boolean): void {
    const device = this.#devices.get(address);
    if (device !== undefined) device.on = on;
  }

  state(): SimulatedState {
    return {online: this.#online, held: this.#held.length,
      devices: Object.fromEntries([...this.#devices].map(([address, device]) => [address, {...device, recent: device.recent.map(write => ({...write}))}]))};
  }

  #answer(address: LightAddress, method: string, endpoint: string, payload: unknown): unknown {
    const device = this.#devices.get(address.ip) ?? (this.#anyAddress ? this.#add(address.ip, address.ip === PANELS_ADDRESS ? 'panels' : 'lines') : undefined);
    if (device === undefined) throw Object.assign(new Error('No simulated controller answers at this address.'), {code: 'EHOSTUNREACH'});
    if (address.token !== this.#token) throw new HttpError(401);
    if (method === 'GET') {
      device.reads += 1;
      switch (endpoint) {
        case '': return {name: 'Simulated', panelLayout: device.kind === 'lines' ? linesLayout(SIMULATED_LINES) : panelsLayout(SIMULATED_TRIANGLES)};
        case '/effects': return {select: device.select, effectsList: [...device.scenes]};
        case '/state': return {on: {value: device.on}, brightness: {value: device.brightness, max: 100, min: 0}};
        default: throw new HttpError(404);
      }
    }
    const refusal = this.#refusals.findIndex(entry => entry.endpoint === endpoint);
    if (refusal >= 0) throw new HttpError(this.#refusals.splice(refusal, 1)[0]?.status ?? 400);
    if (method !== 'PUT' || !isObject(payload)) throw new HttpError(400);
    device.writes += 1;
    const record = (write: Omit<SimulatedWrite, 'endpoint' | 'atMs'>): null => {
      device.recent.push({endpoint, atMs: this.#now(), ...write});
      if (device.recent.length > KEPT_WRITES) device.recent.shift();
      return null;
    };
    if (endpoint === '/state') {
      const {on, brightness} = payload;
      if (isObject(on) && typeof on.value === 'boolean') device.on = on.value;
      if (isObject(brightness) && typeof brightness.value === 'number') device.brightness = brightness.value;
      return record({...(isObject(on) && typeof on.value === 'boolean' ? {on: on.value} : {}),
        ...(isObject(brightness) && typeof brightness.value === 'number' ? {brightness: brightness.value} : {})});
    }
    if (endpoint === '/effects') {
      const {select, write} = payload;
      if (typeof select === 'string') {
        if (!device.scenes.includes(select)) throw new HttpError(404);
        device.select = select;
        return record({select});
      }
      if (isObject(write) && typeof write.animType === 'string') {
        device.select = write.animType === 'static' ? '*Static*' : '*Dynamic*';
        device.effect = write.animType;
        return record({animType: write.animType, ...(typeof write.loop === 'boolean' ? {loop: write.loop} : {})});
      }
    }
    throw new ValueError('The simulated controller takes no such write.');
  }
}
