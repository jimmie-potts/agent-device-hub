// The cutover's conversion of the bridge's registry into the Nanoleaf module's section of the runtime's configuration
// (Hub #933, for the installer #935 at #840). Each registered device keeps its ID, kind and address; its token becomes a
// secret the section names, in a file the caller writes in its secrets directory. The shared-input configuration gives
// the qualified agent sources, without its legacy `bindings` (the module refuses them, #26) and without the 1.x feed's
// endpoint and token files, which the runtime's sync replaces. `config.json`'s Codex Desktop metadata paths carry over.
// The tokens never reach the section, a report or an error.
import {join} from 'node:path';
import {isObject} from '../compat.js';
import {configureNanoleaf, type DeviceSection} from '../module/config.js';
import type {Source} from '../shared-input.js';
import {privateAddress} from '../transport.js';
import {MigrationError} from './contracts.js';
import type {InstalledState} from './installed.js';

/** The module's section of the runtime's configuration file, as the conversion gives it, with its secrets' paths. */
export type NanoleafSection = {
  devices: DeviceSection[]; qualifiedSources: Source[]; codexMetadata?: {path: string; titleIndexPath?: string}; secrets: Record<string, string>;
};

/**
 * What the conversion gives the caller: the section, each secret's token by name for the caller to write into the file
 * the section names, and counts for the report. Never print `tokens`.
 */
export type ConvertedNanoleaf = {section: NanoleafSection; tokens: ReadonlyMap<string, string>; counts: {qualifiedSources: number; codexMetadata: number}};

/** The secret a device's token is under, in the section: `wall-token`. */
export const secretName = (device: string): string => `${device}-token`;
/** The file in the secrets directory that holds a device's token: `nanoleaf-wall-token`. */
export const secretFileName = (device: string): string => `nanoleaf-${device}-token`;

/**
 * A token the runtime reads back unchanged from a secret file: printable ASCII without spaces, as the controllers give
 * them. The runtime strips trailing line breaks from a secret, so a token must not end with one.
 */
const TOKEN = /^[\x21-\x7e]{1,1024}$/;

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
 * Converts the bridge's registry, tokens, shared-input configuration and metadata paths into the module's section, with
 * each device's secret in `secretsDir`. Refuses, with `MigrationError`, a device without a private IPv4 address or a
 * token the runtime can read back, a state that never configured shared input (`source-not-configured`), metadata paths
 * that are not absolute or a title index without its catalog, and any section the module's own `configure` refuses
 * (`source-config`).
 */
export function convertNanoleafState(source: InstalledState, secretsDir: string): ConvertedNanoleaf {
  const devices: DeviceSection[] = [];
  const tokens = new Map<string, string>();
  const secrets: Record<string, string> = {};
  for (const device of source.devices) {
    const token = source.token(device);
    if (device.address === null || !isPrivate(device.address) || token === null || !TOKEN.test(token)) throw new MigrationError('source-config');
    const name = secretName(device.id);
    devices.push({id: device.id, kind: device.kind, address: device.address, secret: name});
    tokens.set(name, token);
    secrets[name] = join(secretsDir, secretFileName(device.id));
  }
  const shared = source.sharedConfig;
  if (shared === null) throw new MigrationError('source-not-configured');
  if (!isObject(shared)) throw new MigrationError('source-config');
  const metadata = source.setting('metadata_path');
  const index = source.setting('title_index_path');
  if (metadata === undefined && index !== undefined) throw new MigrationError('source-config');
  const codexMetadata = metadata === undefined ? {} : {codexMetadata: {path: metadata, ...(index === undefined ? {} : {titleIndexPath: index})}};
  // Only the qualified sources: `bindings` and the 1.x feed's settings are left behind.
  const checked = configureNanoleaf({devices, qualifiedSources: shared.qualifiedSources, ...codexMetadata, secrets});
  if ('error' in checked) throw new MigrationError('source-config');
  const {config} = checked;
  const section: NanoleafSection = {
    devices: config.devices, qualifiedSources: config.qualifiedSources, ...(config.codexMetadata === undefined ? {} : {codexMetadata: config.codexMetadata}), secrets,
  };
  return {section, tokens, counts: {qualifiedSources: config.qualifiedSources.length, codexMetadata: config.codexMetadata === undefined ? 0 : 1}};
}
