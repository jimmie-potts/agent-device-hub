// The configured fixture module (Hub #919): a sign, the stand-in for a device module that needs settings, a secret and
// private files, as Tidbyt, Nanoleaf and Pixoo do. `configureSign` checks its section of the runtime's configuration
// file. Its start reads its token, keeps its layout in its private folder, serves its signs' availability, as its own
// family and as the signs' `device/2.0` records (Hub #918, #967), and returns without reaching a sign (policy A). It
// reaches each sign afterwards, on the runtime's scheduler with a deadline, to show the greeting it rendered in a
// worker thread: a sign that never answers is `unavailable` and is tried again with capped backoff, and one that shows
// the greeting is `available`. A render that fails is reported
// against the sign and tried again, never a module failure. It passes the module test kit, policy A's check included.
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {errorBody, type ErrorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import {SdkError, type BunnyModule, type Configured, type StateDraft} from '@jimmie-potts/sdk';
import type {ConformanceSpec} from '@jimmie-potts/sdk/testing';
import {DEVICE_FAMILY, deviceRecord, deviceSchemas, deviceState} from './device.js';

const BASE = 'https://bunny.invalid/events/';
export const SIGN_SCHEMA = `${BASE}sign/2.0`;
const block = (name: string): object => ({$ref: `${BASE}blocks/2.0#/$defs/${name}`});

/** The sign's payload schema, by `dataschema`, for validators and the kit. */
export const signSchemas: Readonly<Record<string, object>> = {
  [SIGN_SCHEMA]: {
    type: 'object', additionalProperties: false, required: ['id', 'revision', 'availability'],
    properties: {id: block('id'), revision: block('revision'), availability: {enum: ['unknown', 'available', 'unavailable']}},
  },
};

/**
 * The synthetic token that the sign's secret file holds in tests and disposable runs, and that the simulated signs
 * accept. It is no credential. It must never reach a message, a log record, health, an error body or proof.
 */
export const SYNTHETIC_TOKEN = 'tok_SYNTHETIC919';
/** How long the sign waits for a sign to answer before it reports it `unavailable`. */
export const REACH_MS = 1000;
/** The first wait before a sign that did not answer is tried again; each later wait doubles, up to `MAX_RETRY_MS`. */
const FIRST_RETRY_MS = 500;
const MAX_RETRY_MS = 4000;
/** How long the render worker may take. */
const RENDER_MS = 60_000;
const RENDER_WORKER = new URL('./render-worker.js', import.meta.url);

export type SignConfig = {greeting: string; signs: {id: string; address: string}[]};
export type Availability = 'unknown' | 'available' | 'unavailable';
export type Sign = {id: string; revision: number; availability: Availability};
/** What the simulated signs show, as plain data: whether they answer, each address's frame, and every attempt. */
export type SignDeviceState = {online: boolean; shown: Record<string, string>; attempts: number; refused: number};

/** How the sign module reaches its signs. A real transport would speak the device's protocol. */
export interface SignTransport {
  /**
   * Shows `frame` on the sign at `address`, authorized by `token`, and resolves once it shows it. Rejects when the sign
   * refuses the token. While the sign is offline it never answers, until `signal` aborts the call.
   */
  show(address: string, token: string, frame: string, signal: AbortSignal): Promise<void>;
}

/**
 * Simulated signs, the transport tests and runs give the sign module. They start offline, as a sign that is switched
 * off, and accept only the synthetic token. Like real signs, they keep what they show when the runtime restarts.
 */
export class SimulatedSigns implements SignTransport {
  readonly #token: string;
  readonly #shown = new Map<string, string>();
  #online: boolean;
  #attempts = 0;
  #refused = 0;

  constructor({online = false, token = SYNTHETIC_TOKEN}: {online?: boolean; token?: string} = {}) {
    this.#online = online;
    this.#token = token;
  }

  show(address: string, token: string, frame: string, signal: AbortSignal): Promise<void> {
    this.#attempts += 1;
    if (!this.#online) {
      return new Promise((_, reject) => {
        const silent = (): void => { reject(new Error('the sign did not answer')); };
        if (signal.aborted) silent();
        else signal.addEventListener('abort', silent, {once: true});
      });
    }
    if (token !== this.#token) {
      this.#refused += 1;
      return Promise.reject(new Error('the sign refused the token'));
    }
    this.#shown.set(address, frame);
    return Promise.resolve();
  }

  online(): void {
    this.#online = true;
  }

  offline(): void {
    this.#online = false;
  }

  state(): SignDeviceState {
    return {online: this.#online, shown: Object.fromEntries(this.#shown), attempts: this.#attempts, refused: this.#refused};
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;

/**
 * The sign's `configure`: a greeting of 1 to 32 characters, 1 to 8 signs each with an `id` and an `address`, and the
 * token's file as `secrets.token`. The runtime then checks that each sign's ID is a routing ID no other module names.
 */
export function configureSign(section: unknown): Configured<SignConfig> | ErrorBody {
  const {greeting, signs, secrets} = isObject(section) ? section : {};
  if (!text(greeting, 32)) return errorBody('invalid-request', {detail: 'greeting must be 1 to 32 characters'});
  if (!Array.isArray(signs) || signs.length === 0 || signs.length > 8) return errorBody('invalid-request', {detail: 'signs must list 1 to 8 signs'});
  const listed: SignConfig['signs'] = [];
  for (const sign of signs as unknown[]) {
    const {id, address} = isObject(sign) ? sign : {};
    if (!text(id, 128) || !text(address, 253)) return errorBody('invalid-request', {detail: 'each sign needs an id and an address'});
    listed.push({id, address});
  }
  if (!isObject(secrets) || !Object.hasOwn(secrets, 'token')) return errorBody('invalid-request', {detail: 'the section must name the token\'s file as secrets.token'});
  return {config: {greeting, signs: listed}, devices: listed.map(sign => sign.id)};
}

/**
 * The preview the sign's page shows by reference (Hub #835): a 1-pixel PNG, the fixture's stand-in for a rendered frame.
 * The page names it `content/preview.png`, and the gateway serves it from the sign's `content`.
 */
export const PREVIEW_PNG = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==', 'base64',
));
const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);

/**
 * `renderWorker` replaces the render worker's file, so a test can make every render fail. Module API 1.2 (Hub #835): the
 * sign contributes a page that shows its preview by reference, that content, a read tool with each sign's availability,
 * and its settings, which show what `configureSign` accepted and never its token.
 */
export function createSignModule({transport, renderWorker = RENDER_WORKER}: {transport: SignTransport; renderWorker?: URL}): BunnyModule<SignConfig> {
  /** What the contributions read: the signs while the module runs, and the greeting it shows. */
  let held: {greeting: string; signs: readonly Sign[]} | undefined;
  return {
    manifest: {
      name: 'sign', apiVersion: '1.2', configure: configureSign,
      pages: [{id: 'preview', title: 'Sign preview', render: () => {
        const greeting = held?.greeting ?? '';
        const rows = (held?.signs ?? []).map(sign => `<li>${escapeHtml(sign.id)}: ${sign.availability}</li>`).join('');
        return `<h1>${escapeHtml(greeting)}</h1><img src="content/preview.png" alt="the sign's preview" width="64" height="64"><ul>${rows}</ul>`;
      }}],
      content: ref => ref === 'preview.png' ? {type: 'image/png', bytes: PREVIEW_PNG} : undefined,
      tools: [{
        name: 'status', description: 'Read each sign\'s availability: whether it answered the last time the module reached it.',
        input: {type: 'object', additionalProperties: false, properties: {}},
        output: {
          type: 'object', additionalProperties: false, required: ['signs'],
          properties: {signs: {type: 'array', items: {type: 'object', additionalProperties: false, required: ['id', 'availability'],
            properties: {id: {type: 'string'}, availability: {enum: ['unknown', 'available', 'unavailable']}}}}},
        },
        read: () => held === undefined ? errorBody('unavailable', {detail: 'the sign has not started'})
          : {signs: held.signs.map(({id, availability}) => ({id, availability}))},
      }],
      settings: {
        schema: {type: 'object', properties: {greeting: {type: 'string'}, signs: {type: 'array', items: {type: 'object', properties: {id: {type: 'string'}, address: {type: 'string'}}}}}},
        show: config => ({greeting: config.greeting, signs: config.signs.map(({id, address}) => ({id, address}))}),
      },
    },
    async start({sdk, config, secrets, files, scheduler, workers, signal, log}) {
      // The runtime starts a module with `configure` only with what `configure` accepted.
      if (config === undefined) throw new Error('the sign started without its configuration');
      // Local resources only: the token's file, the private folder and the bus.
      const token = await secrets.read('token');
      await writeFile(join(files(), 'layout.json'), JSON.stringify({greeting: config.greeting, signs: config.signs.map(sign => sign.id)}), {mode: 0o600});
      const signs: {address: string; sign: Sign}[] = config.signs.map(({id, address}) => ({address, sign: {id, revision: 0, availability: 'unknown'}}));
      held = {greeting: config.greeting, signs: signs.map(({sign}) => sign)};
      const state = (sign: Sign): StateDraft<Sign> => ({type: 'org.bunny.sign.updated', subject: sign.id, dataschema: SIGN_SCHEMA, data: {...sign}});
      const device = (sign: Sign): StateDraft => deviceState(deviceRecord(sign.id, sign.revision, 'sign', sign.availability));
      await sdk.serveSync(['sign', DEVICE_FAMILY], ({data: {families}}) => ({
        revision: Math.max(0, ...signs.map(({sign}) => sign.revision)),
        states: [...families.includes('sign') ? signs.map(({sign}) => state(sign)) : [], ...families.includes(DEVICE_FAMILY) ? signs.map(({sign}) => device(sign)) : []],
      }));

      let frame: Promise<string> | undefined;
      const render = (): Promise<string> => frame ??= workers.call<string>(renderWorker, {greeting: config.greeting}, {timeoutMs: RENDER_MS});
      /** Whether the last render failed, so a run of failures is logged once. */
      let renderFailing = false;
      const again = (address: string, sign: Sign, attempt: number): void => {
        scheduler.after(Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** attempt), () => reach(address, sign, attempt + 1));
      };
      const reach = async (address: string, sign: Sign, attempt: number): Promise<void> => {
        let shown: string;
        try {
          shown = await render();
          renderFailing = false;
        } catch (error) {
          frame = undefined;
          if (signal.aborted) return;
          // A failed render, even one past its deadline, is no evidence about the sign: its availability stays as it was.
          // It is an outcome of this attempt, reported against the sign once per run of failures, and tried again
          // (policy A), never a module failure.
          if (!renderFailing) {
            renderFailing = true;
            const code = error instanceof SdkError ? error.body.error.code : 'internal';
            log.warn('operation.failed', {'bunny.device.id': sign.id, 'bunny.operation': 'media', 'bunny.code': code});
          }
          again(address, sign, attempt);
          return;
        }
        const deadline = new AbortController();
        const cancel = scheduler.after(REACH_MS, () => { deadline.abort(); });
        const stopping = (): void => { deadline.abort(); };
        signal.addEventListener('abort', stopping, {once: true});
        let reached: boolean;
        try {
          await transport.show(address, token, shown, deadline.signal);
          reached = true;
        } catch {
          // The device's error or timeout is device state, never a module failure (policy A).
          reached = false;
        } finally {
          cancel();
          signal.removeEventListener('abort', stopping);
        }
        if (signal.aborted) return;
        const availability: Availability = reached ? 'available' : 'unavailable';
        if (availability !== sign.availability) {
          sign.availability = availability;
          sign.revision += 1;
          await sdk.publish(`bunny.state.sign.${sign.id}`, {kind: 'state', ...state(sign)});
          await sdk.publish(`bunny.state.${DEVICE_FAMILY}.${sign.id}`, {kind: 'state', ...device(sign)});
          // One record per change, not per attempt.
          if (reached) log.info('operation.completed', {'bunny.device.id': sign.id, 'bunny.operation': 'status', 'bunny.outcome': 'succeeded'});
          else log.warn('operation.failed', {'bunny.device.id': sign.id, 'bunny.operation': 'status', 'bunny.reason': 'unavailable'});
        }
        if (!reached) again(address, sign, attempt);
      };
      for (const {address, sign} of signs) scheduler.after(0, () => reach(address, sign, 0));
    },
    stop: () => { held = undefined; },
  };
}

/** The sign's section of the configuration file, without the `secrets` member that names its token's file. */
export const SIGN_SECTION = {greeting: 'hello', signs: [{id: 'sign-1', address: '192.0.2.10'}]} as const;

/** Whether a message is the sign's state reporting a sign `unavailable`. */
export const reportsUnavailable = (message: Message): boolean =>
  message.dataschema === SIGN_SCHEMA && (message.data as Partial<Sign>).availability === 'unavailable';

/** The kit's description of the sign: online signs for the checks, and offline ones for policy A's. */
export const signSpec = (): ConformanceSpec => ({
  create: () => createSignModule({transport: new SimulatedSigns({online: true})}),
  schemas: {...deviceSchemas, ...signSchemas},
  serves: ['sign', DEVICE_FAMILY],
  config: {...SIGN_SECTION, secrets: {token: '/nowhere/sign-token'}},
  secrets: {token: SYNTHETIC_TOKEN},
  offline: {create: () => createSignModule({transport: new SimulatedSigns()}), unavailable: reportsUnavailable},
});
