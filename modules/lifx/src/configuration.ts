// The LIFX module's section of the runtime's configuration file (Hub #919, #928). It holds what the old local controller
// host read from its `lifx` block: each bulb's routing ID, its unicast IPv4 address and its model evidence, the bulb's
// status caps when it shows agent status, and the queue bounds. The cutover's installer (#935) writes it with
// `convertLegacyConfiguration`. No refusal repeats a value from the section, because health shows it.
import {errorBody, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import type {Configured} from '@jimmie-potts/sdk';
import {unicastAddress} from './protocol.js';

/** A bulb's native modes, as the device record lists them: today's Work, Quiet and Free in kebab-case. */
export const NATIVE_MODES = ['work', 'quiet', 'free'] as const;
export type NativeMode = (typeof NATIVE_MODES)[number];

/** How bright the bulb paints agent status: in Work, and for the one thing Quiet paints, attention. Integer percents. */
export type StatusCaps = {brightnessCapPercent: number; quietCapPercent: number};

export type LifxBulbConfig = {
  /** The bulb's routing ID: lowercase letters and digits with single hyphens, unique across modules. */
  id: string;
  /** Its unicast IPv4 address. It never appears in a message, a log record or health. */
  address: string;
  /** The model evidence. Only LIFX A19 vendor 1, product 27 on firmware 2.90 is qualified; any other bulb gets no controls. */
  vendor?: number;
  product?: number;
  firmwareMajor?: number;
  firmwareMinor?: number;
  /** Present when the bulb shows automatic agent status, as the old host's per-bulb `status` block was. */
  status?: StatusCaps;
  /**
   * The mode a qualified bulb starts in when the module's own database holds none yet. The cutover's conversion fills
   * it from the old host's mode files, so each bulb keeps its mode. Defaults to `free`.
   */
  initialMode?: NativeMode;
};

export type LifxConfig = {
  bulbs: LifxBulbConfig[];
  /** How long one attempt waits for a bulb's answer, 10 to 5000 ms. */
  timeoutMs: number;
  /** How many more attempts a packet gets, 0 to 3. */
  retries: number;
  /** How many jobs one bulb's queue holds, 1 to 32. */
  maxPending: number;
};

const ROUTING_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SECTION_KEYS = new Set(['bulbs', 'timeoutMs', 'retries', 'maxPending', 'secrets']);
const BULB_KEYS = new Set(['id', 'address', 'vendor', 'product', 'firmwareMajor', 'firmwareMinor', 'status', 'initialMode']);
const STATUS_KEYS = new Set(['brightnessCapPercent', 'quietCapPercent']);
const EVIDENCE = ['vendor', 'product', 'firmwareMajor', 'firmwareMinor'] as const;

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null && !Array.isArray(value);
const integer = (value: unknown, low: number, high: number): value is number => Number.isInteger(value) && Number(value) >= low && Number(value) <= high;
const onlyKeys = (value: Readonly<Record<string, unknown>>, keys: ReadonlySet<string>): boolean => Object.keys(value).every(key => keys.has(key));
const refuse = (detail: string): ErrorBody => errorBody('invalid-request', {detail});
const isMode = (value: unknown): value is NativeMode => NATIVE_MODES.some(mode => mode === value);

/** Whether the model evidence names the one qualified bulb, LIFX A19 vendor 1, product 27, firmware 2.90 (#17). */
export const qualified = (bulb: Pick<LifxBulbConfig, (typeof EVIDENCE)[number]>): boolean =>
  bulb.vendor === 1 && bulb.product === 27 && bulb.firmwareMajor === 2 && bulb.firmwareMinor === 90;

/** Whether `id` is a routing ID the runtime and the device family accept. */
export const routingId = (id: unknown): id is string => typeof id === 'string' && id.length <= 128 && ROUTING_ID.test(id);

function statusOf(value: unknown): StatusCaps | ErrorBody {
  if (!isObject(value) || !onlyKeys(value, STATUS_KEYS)) return refuse('a bulb\'s status takes only brightnessCapPercent and quietCapPercent');
  const {brightnessCapPercent = 50, quietCapPercent = 20} = value;
  if (!integer(brightnessCapPercent, 1, 100) || !integer(quietCapPercent, 1, 100)) return refuse('a bulb\'s status caps must be integers from 1 to 100');
  return {brightnessCapPercent, quietCapPercent};
}

function bulbOf(value: unknown): LifxBulbConfig | ErrorBody {
  if (!isObject(value) || !onlyKeys(value, BULB_KEYS)) {
    return refuse('each bulb takes only id, address, vendor, product, firmwareMajor, firmwareMinor, status and initialMode');
  }
  const {id, address, status, initialMode} = value;
  if (!routingId(id)) return refuse('each bulb\'s id must be lowercase letters and digits with single hyphens, at most 128 characters');
  if (typeof address !== 'string' || !unicastAddress(address)) return refuse('each bulb\'s address must be a unicast IPv4 address');
  const bulb: LifxBulbConfig = {id, address};
  for (const key of EVIDENCE) {
    const evidence = value[key];
    if (evidence === undefined) continue;
    if (!integer(evidence, 0, 0xffffffff)) return refuse('a bulb\'s model evidence must be non-negative integers');
    bulb[key] = evidence;
  }
  if (status !== undefined) {
    const caps = statusOf(status);
    if ('error' in caps) return caps;
    bulb.status = caps;
  }
  if (initialMode !== undefined) {
    if (!isMode(initialMode)) return refuse('a bulb\'s initialMode must be work, quiet or free');
    bulb.initialMode = initialMode;
  }
  return bulb;
}

/**
 * The module's `configure`: 1 to 32 bulbs with distinct IDs and addresses, and the optional `timeoutMs` (10 to 5000,
 * default 500), `retries` (0 to 3, default 1) and `maxPending` (1 to 32, default 8). The module reads no secret; a
 * `secrets` member the installer writes is ignored. The bulbs' IDs are the devices the module controls.
 */
export function configureLifx(section: unknown): Configured<LifxConfig> | ErrorBody {
  if (!isObject(section) || !onlyKeys(section, SECTION_KEYS)) return refuse('the section takes only bulbs, timeoutMs, retries, maxPending and secrets');
  const {bulbs, timeoutMs = 500, retries = 1, maxPending = 8} = section;
  if (!integer(timeoutMs, 10, 5000)) return refuse('timeoutMs must be an integer from 10 to 5000');
  if (!integer(retries, 0, 3)) return refuse('retries must be an integer from 0 to 3');
  if (!integer(maxPending, 1, 32)) return refuse('maxPending must be an integer from 1 to 32');
  if (!Array.isArray(bulbs) || bulbs.length === 0 || bulbs.length > 32) return refuse('bulbs must list 1 to 32 bulbs');
  const listed: LifxBulbConfig[] = [];
  for (const value of bulbs as unknown[]) {
    const bulb = bulbOf(value);
    if ('error' in bulb) return bulb;
    if (listed.some(other => other.id === bulb.id || other.address === bulb.address)) return refuse('each bulb needs its own id and address');
    listed.push(bulb);
  }
  return {config: {bulbs: listed, timeoutMs, retries, maxPending}, devices: listed.map(bulb => bulb.id)};
}
