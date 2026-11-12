// Simulated Nanoleaf controllers (Hub #844, #846): the transport tests and disposable runs give the Nanoleaf module, so
// no device is touched. Each simulated controller answers the local API's requests the module makes, as a Lines or an
// NL22 Light Panels controller would: its layout, its saved scenes and selection, its power and brightness, and effect
// writes. Like real devices, simulated ones keep their state across a runtime restart. A test can take one offline, so
// that it never answers, hold its requests until released, lose a write's answer, make it answer one write with an HTTP
// error, delete one of its scenes, or change its power, colour or token as the Nanoleaf app would. A colour write, by
// hue and saturation or colour temperature, selects `*Solid*` (#1614). A device that answers with an
// error status throws the transport's `HttpError`, as the Nanoleaf HTTP client does.
// External control follows each kind's documented version (`stream.ts`): the Lines enter version 2 and take it on port
// 60222, the Panels enter version 1, answer with their streaming port and take one-byte panel IDs. The simulation is
// stricter than a light is known to be, so a wrong version, port, layout or zone fails loudly: it refuses the other
// version's entry and rejects a datagram on another port, of another layout or for a zone it does not light. While
// streaming, each reports the selection its installed light showed: the Lines `*ExtControl*` (#1598), the Panels
// `*Dynamic*` (#1777), which is also what they report for an unsaved dynamic effect. Only the entry starts streaming,
// and any scene, colour or effect chosen afterwards leaves it.
import {isObject} from '../compat.js';
import {ValueError} from '../errors.js';
import {NEIGHBOR} from '../panels.js';
import {STREAM_PORT, STREAM_TRANSITION, streamProtocol, type LightDatagram} from '../stream.js';
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
  endpoint: string; atMs: number; on?: boolean; brightness?: number; hue?: number; sat?: number; ct?: number; select?: string; animType?: string; loop?: boolean;
};
/** How many recent writes a simulated controller keeps. */
export const KEPT_WRITES = 64;
/** The streaming port a simulated Panels controller names in its version 1 answer, as the documentation's example does. */
export const PANELS_STREAM_PORT = 60221;
/** The least time between two datagrams the documentation allows: no faster than 10 Hz. */
export const STREAM_SPACING_MS = 100;

/** What one simulated controller shows, as plain data a disposable run can report. */
export type SimulatedDevice = {
  kind: SimulatedKind;
  on: boolean;
  brightness: number;
  /**
   * The playing selection: a saved scene's name, `*Solid*` after a colour, `*Dynamic*` after an effect, `*Static*` after
   * a static one, and while streaming `*ExtControl*` on the Lines or `*Dynamic*` on the Panels.
   */
  select: string;
  /** The last colour written, and the colour mode `/state` reports: `hs` or `ct` after a colour write, `effect` otherwise. */
  hue: number; sat: number; ct: number; colorMode: 'hs' | 'ct' | 'effect';
  /** The scenes saved on the controller, which its effect list reports. */
  scenes: string[];
  /** The animation type of the last effect write (`custom`, `static` or `extControl`), or null before one. */
  effect: string | null;
  /** Datagrams applied while streaming, and datagrams ignored because the controller was not streaming (#1598). */
  streamed: number;
  ignored: number;
  /** The zone colors of the last applied datagram, by zone ID, or null before one. */
  frame: Record<string, [number, number, number]> | null;
  /** The last `KEPT_WRITES` datagrams, oldest first: when each arrived and whether it was applied. */
  streams: {atMs: number; applied: boolean}[];
  /** The external-control version entered and the port it streams on, or null while not streaming. */
  streaming: {version: 'v1' | 'v2'; port: number} | null;
  /** Applied datagrams that arrived less than `STREAM_SPACING_MS` after the previous applied one, on the simulation's clock. */
  tooSoon: number;
  /** When a scene was last chosen or the power switched as the Nanoleaf app would, or null before that. */
  manualAtMs: number | null;
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
    // Connector housings at the two ends of the same unchanged zone pair (Hub #934).
    {panelId: 1000 + line * 2, x: line * 100, y: -10, o: 0, shapeType: 20},
    {panelId: 1001 + line * 2, x: line * 100, y: 30, o: 0, shapeType: 20},
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
    const device: SimulatedDevice = {kind, on: true, brightness: 50, select: SCENES[0] ?? '', hue: 0, sat: 0, ct: 4000, colorMode: 'effect', scenes: [...SCENES],
      effect: null, streamed: 0, ignored: 0, frame: null, streams: [], streaming: null, tooSoon: 0, manualAtMs: null, reads: 0, writes: 0, recent: []};
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

  /**
   * The module's datagram transport. As a light does, the controller applies a datagram only while streaming and ignores
   * it otherwise. Nothing answers a datagram, so one sent to an offline or absent controller is simply lost. A streaming
   * controller rejects one sent to another port, of another version's layout, or addressing a zone it does not light.
   * An applied datagram changes only the zones it addresses: the documentation says a frame need not hold every panel.
   */
  readonly datagram: LightDatagram = (address, packet): Promise<void> => {
    const device = this.#devices.get(address.ip);
    if (!this.#online || device === undefined) return Promise.resolve();
    const atMs = this.#now();
    const kept = (applied: boolean): void => {
      device.streams.push({atMs, applied});
      if (device.streams.length > KEPT_WRITES) device.streams.shift();
    };
    // Every choice that leaves streaming clears it, so it alone says whether the light applies a datagram: on the Panels
    // the selection cannot, since an unsaved dynamic effect reports the same `*Dynamic*`.
    const streaming = device.streaming;
    if (streaming === null) {
      device.ignored += 1;
      kept(false);
      return Promise.resolve();
    }
    if (address.port !== streaming.port) return Promise.reject(new ValueError('No stream listens on this port.'));
    const colors = decode(Buffer.from(packet.buffer, packet.byteOffset, packet.byteLength), streaming.version);
    const zones = lightZones(device.kind);
    if (colors === undefined || colors.some(([id]) => !zones.has(id))) return Promise.reject(new ValueError('A malformed streaming datagram.'));
    const previous = device.streams.filter(entry => entry.applied).at(-1);
    if (previous !== undefined && atMs - previous.atMs < STREAM_SPACING_MS) device.tooSoon += 1;
    device.streamed += 1;
    device.frame = {...device.frame, ...Object.fromEntries(colors.map(([id, color]) => [String(id), color]))};
    kept(true);
    return Promise.resolve();
  };

  /** Chooses a saved scene on a controller as the Nanoleaf app would, which also leaves streaming. */
  chooseScene(address: string, name: string): void {
    const device = this.#devices.get(address);
    if (device !== undefined && device.scenes.includes(name)) {
      device.select = name;
      device.colorMode = 'effect';
      device.streaming = null;
      device.manualAtMs = this.#now();
    }
  }

  /** Picks a plain colour on a controller as the Nanoleaf app would: `*Solid*`, which also leaves streaming. */
  chooseColor(address: string, color: {hue: number; sat: number} | {ct: number}): void {
    const device = this.#devices.get(address);
    if (device === undefined) return;
    if ('ct' in color) {
      device.ct = color.ct;
      device.colorMode = 'ct';
    } else {
      device.hue = color.hue;
      device.sat = color.sat;
      device.colorMode = 'hs';
    }
    device.select = '*Solid*';
    device.streaming = null;
    device.manualAtMs = this.#now();
  }

  /**
   * Shows an unsaved effect on a controller as the Nanoleaf app would: a static one reports `*Static*` and a dynamic one
   * `*Dynamic*`, the documentation's reserved names. Either leaves streaming; on the Panels a dynamic one reads as it did.
   */
  chooseEffect(address: string, effect: 'static' | 'dynamic'): void {
    const device = this.#devices.get(address);
    if (device === undefined) return;
    device.select = effect === 'static' ? '*Static*' : '*Dynamic*';
    device.colorMode = 'effect';
    device.streaming = null;
    device.manualAtMs = this.#now();
  }

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
    if (device === undefined) return;
    device.on = on;
    device.manualAtMs = this.#now();
  }

  state(): SimulatedState {
    return {online: this.#online, held: this.#held.length,
      devices: Object.fromEntries([...this.#devices].map(([address, device]) => [address, {...device, recent: device.recent.map(write => ({...write})), streams: device.streams.map(entry => ({...entry})),
        streaming: device.streaming === null ? null : {...device.streaming},
        frame: device.frame === null ? null : Object.fromEntries(Object.entries(device.frame).map(([id, color]) => [id, [...color] as [number, number, number]]))}]))};
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
        case '/effects/select': return device.select;
        case '/state': return {on: {value: device.on}, brightness: {value: device.brightness, max: 100, min: 0}, hue: {value: device.hue, max: 360, min: 0},
          sat: {value: device.sat, max: 100, min: 0}, ct: {value: device.ct, max: 6500, min: 1200}, colorMode: device.colorMode};
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
      const number = (field: unknown): number | undefined => isObject(field) && typeof field.value === 'number' ? field.value : undefined;
      const hue = number(payload.hue), sat = number(payload.sat), ct = number(payload.ct);
      if (isObject(on) && typeof on.value === 'boolean') device.on = on.value;
      if (isObject(brightness) && typeof brightness.value === 'number') device.brightness = brightness.value;
      // A colour leaves any scene, effect or streaming for a plain colour.
      if (hue !== undefined) device.hue = hue;
      if (sat !== undefined) device.sat = sat;
      if (ct !== undefined) device.ct = ct;
      if (hue !== undefined || sat !== undefined || ct !== undefined) {
        device.colorMode = ct !== undefined ? 'ct' : 'hs';
        device.select = '*Solid*';
        device.streaming = null;
      }
      return record({...(isObject(on) && typeof on.value === 'boolean' ? {on: on.value} : {}),
        ...(isObject(brightness) && typeof brightness.value === 'number' ? {brightness: brightness.value} : {}),
        ...(hue === undefined ? {} : {hue}), ...(sat === undefined ? {} : {sat}), ...(ct === undefined ? {} : {ct})});
    }
    if (endpoint === '/effects') {
      const {select, write} = payload;
      if (typeof select === 'string') {
        if (!device.scenes.includes(select)) throw new HttpError(404);
        device.select = select;
        device.colorMode = 'effect';
        device.streaming = null;
        return record({select});
      }
      if (isObject(write) && typeof write.animType === 'string') {
        const streaming = write.animType === 'extControl' ? entered(device.kind, write) : null;
        device.select = streaming !== null ? streamProtocol(device.kind).streaming : write.animType === 'static' ? '*Static*' : '*Dynamic*';
        device.colorMode = 'effect';
        device.effect = write.animType;
        device.streaming = streaming;
        record({animType: write.animType, ...(typeof write.loop === 'boolean' ? {loop: write.loop} : {})});
        // A version 1 light answers the entry with where to stream; a version 2 light answers with no body.
        return streaming?.version === 'v1' ? {streamControlIpAddr: address.ip, streamControlPort: streaming.port, streamControlProtocol: 'udp'} : null;
      }
    }
    throw new ValueError('The simulated controller takes no such write.');
  }
}

/**
 * The external control a write of `kind` enters: the Lines version 2 with logical panels, the Panels version 1 (or an
 * omitted version, which the documentation reads as version 1) without them. Any other entry is refused with HTTP 400
 * before it changes anything, so a wrong version fails loudly.
 */
function entered(kind: SimulatedKind, write: Record<string, unknown>): {version: 'v1' | 'v2'; port: number} {
  const version = write.extControlVersion ?? 'v1';
  if (kind === 'lines' && version === 'v2' && write.logicalPanelsEnabled === true) return {version: 'v2', port: STREAM_PORT};
  if (kind === 'panels' && version === 'v1' && write.logicalPanelsEnabled === undefined) return {version: 'v1', port: PANELS_STREAM_PORT};
  throw new HttpError(400);
}

/** The zone IDs a simulated layout lights: two per Line, one per triangle. Connectors light nothing. */
function lightZones(kind: SimulatedKind): ReadonlySet<number> {
  return new Set(kind === 'lines' ? Array.from({length: 2 * SIMULATED_LINES}, (_, index) => 100 + index)
    : Array.from({length: SIMULATED_TRIANGLES}, (_, index) => 200 + index));
}

/**
 * A datagram's zone colors in its version's layout (`stream.ts`), or undefined when it is malformed for that version:
 * version 1 has a one-byte count and seven bytes per panel with a frame count of 1, version 2 a two-byte count and
 * eight bytes per zone. Stricter than a light: a white byte other than 0 or a transition other than the module's 1
 * (100 ms) is also refused, so an encoder that moves a byte fails here rather than only in the encoder test.
 */
function decode(view: Buffer, version: 'v1' | 'v2'): [number, [number, number, number]][] | undefined {
  const v1 = version === 'v1';
  const header = v1 ? 1 : 2, width = v1 ? 7 : 8;
  if (view.length < header) return undefined;
  const count = v1 ? view.readUInt8(0) : view.readUInt16BE(0);
  if (view.length !== header + width * count) return undefined;
  const colors: [number, [number, number, number]][] = [];
  for (let index = 0; index < count; index += 1) {
    const at = header + width * index;
    if (v1 && view.readUInt8(at + 1) !== 1) return undefined;
    const transition = v1 ? view.readUInt8(at + 6) : view.readUInt16BE(at + 6);
    if (view.readUInt8(at + 5) !== 0 || transition !== STREAM_TRANSITION) return undefined;
    colors.push([v1 ? view.readUInt8(at) : view.readUInt16BE(at), [view.readUInt8(at + 2), view.readUInt8(at + 3), view.readUInt8(at + 4)]]);
  }
  return colors;
}
