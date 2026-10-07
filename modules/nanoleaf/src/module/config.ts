// The Nanoleaf module's section of the runtime's configuration file (Hub #919): its devices, the token file each one's
// secret names, the agent sources it shows, and Codex Desktop's metadata files when the owner chose them. `configure`
// checks it synchronously and reads no file; its refusals carry fixed text that repeats nothing from the section.
import {errorBody, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import type {Configured} from '@jimmie-potts/sdk';
import {dumps, isObject} from '../compat.js';
import {DEFAULT, ID, type Kind} from '../devices.js';
import {SOURCE, validIdentity, type Source} from '../shared-input.js';
import {privateAddress} from '../transport.js';

/** The most devices one module may control. */
export const MAX_DEVICES = 8;
/** A routing ID (ADR 0012): lowercase letters and digits with single hyphens, at most 128 characters. */
const ROUTING_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SECRET_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_PATH = 4096;

/** One configured controller. `secret` names the token file in the section's `secrets`. */
export type DeviceSection = {id: string; kind: Kind; address: string; secret: string};
export type NanoleafConfig = {
  /** The Lines first, as `wall`, then any NL22 Light Panels. */
  devices: DeviceSection[];
  /** The agent sources whose sessions the wall shows; others are skipped and counted. */
  qualifiedSources: Source[];
  /** Codex Desktop's local project catalog and title index, read only, when the owner chose them. */
  codexMetadata?: {path: string; titleIndexPath?: string};
};

const refuse = (detail: string): ErrorBody => errorBody('invalid-request', {detail});
const isPath = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith('/') && value.length <= MAX_PATH && !value.includes('\0');
function isPrivate(address: string): boolean {
  try {
    privateAddress(address);
    return true;
  } catch {
    // The address check's own message quotes the address, so the refusal uses fixed text instead.
    return false;
  }
}

/**
 * Checks the module's section: 1 to `MAX_DEVICES` devices with distinct routing IDs and private IPv4 addresses, each
 * naming its token's file among the section's `secrets`; exactly one Lines controller, `wall`, as the port's original
 * device; and 1 to 128 distinct qualified agent sources. Returns the configuration and the device IDs, which the runtime
 * refuses when another module already named one.
 */
export function configureNanoleaf(section: unknown): Configured<NanoleafConfig> | ErrorBody {
  if (!isObject(section)) return refuse('the section must be a JSON object');
  const known = new Set(Object.keys(section).filter(key => key !== 'secrets'));
  for (const key of known) {
    if (!['devices', 'qualifiedSources', 'codexMetadata'].includes(key)) return refuse('the section names a setting the Nanoleaf module does not take');
  }
  const secrets = isObject(section.secrets) ? section.secrets : {};
  const listed = section.devices;
  if (!Array.isArray(listed) || listed.length === 0 || listed.length > MAX_DEVICES) return refuse(`devices must list 1 to ${MAX_DEVICES} controllers`);
  const devices: DeviceSection[] = [];
  for (const entry of listed as unknown[]) {
    if (!isObject(entry) || Object.keys(entry).some(key => !['id', 'kind', 'address', 'secret'].includes(key))) {
      return refuse('each device has only an id, a kind, an address and a secret');
    }
    const {id, kind, address, secret} = entry;
    if (typeof id !== 'string' || id.length > 128 || !ROUTING_ID.test(id) || !ID.test(id)) {
      return refuse('each device id must be lowercase letters and digits with single hyphens, at most 128 characters');
    }
    if (kind !== 'lines' && kind !== 'panels') return refuse('each device kind must be lines or panels');
    if (typeof address !== 'string' || !isPrivate(address)) return refuse('each device address must be a private IPv4 address');
    if (typeof secret !== 'string' || !SECRET_NAME.test(secret) || !Object.hasOwn(secrets, secret)) {
      return refuse('each device must name its token\'s file among the section\'s secrets');
    }
    devices.push({id, kind, address, secret});
  }
  if (new Set(devices.map(device => device.id)).size !== devices.length) return refuse('device ids must be distinct');
  if (new Set(devices.map(device => device.address)).size !== devices.length) return refuse('device addresses must be distinct');
  const lines = devices.filter(device => device.kind === 'lines');
  if (lines.length !== 1 || lines[0]?.id !== DEFAULT) return refuse(`exactly one device must be the Lines, with the id ${DEFAULT}`);
  // The Lines first, as the port's registry lists them.
  devices.sort((a, b) => Number(b.id === DEFAULT) - Number(a.id === DEFAULT));
  const sources = section.qualifiedSources;
  if (!Array.isArray(sources) || sources.length === 0 || sources.length > 128 || sources.some(source => !validIdentity(source, SOURCE))
      || new Set(sources.map(source => dumps(source))).size !== sources.length) {
    return refuse('qualifiedSources must list 1 to 128 distinct agent sources');
  }
  const config: NanoleafConfig = {devices, qualifiedSources: sources as Source[]};
  if (Object.hasOwn(section, 'codexMetadata')) {
    const metadata = section.codexMetadata;
    if (!isObject(metadata) || !isPath(metadata.path) || Object.keys(metadata).some(key => key !== 'path' && key !== 'titleIndexPath')
        || (Object.hasOwn(metadata, 'titleIndexPath') && !isPath(metadata.titleIndexPath))) {
      return refuse('codexMetadata names an absolute path and, optionally, an absolute titleIndexPath');
    }
    config.codexMetadata = {path: metadata.path, ...(isPath(metadata.titleIndexPath) ? {titleIndexPath: metadata.titleIndexPath} : {})};
  }
  return {config, devices: devices.map(device => device.id)};
}

/**
 * The port's `config.json` for this configuration: each device's kind, address and the name of its secret, never the
 * secret itself. The module writes it to its private folder at start, so the port's registry reads find the devices;
 * the tokens stay in memory, read with `secrets.read`.
 */
export function registryFile(config: NanoleafConfig): object {
  return {devices: Object.fromEntries(config.devices.map(device => [device.id, {kind: device.kind, ip: device.address, token_ref: device.secret}]))};
}
