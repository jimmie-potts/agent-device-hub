// The Tidbyt module's section of the runtime's configuration file (Hub #919, #930), and the conversion of the old
// runner's configuration into it, which the cutover's installer (#935) runs. The cloud's device ID stays in the private
// configuration file and the API key in a private secret file: no refusal, message, record or health entry repeats
// either.
import {errorBody, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import type {Configured} from '@jimmie-potts/sdk';
import {CLOUD_DEVICE_ID, INSTALLATION_ID} from './cloud.js';

/** The secret the section names for the cloud's API key, as `secrets.token`, like every module token (#919). */
export const API_KEY_SECRET = 'token';
/** The status tile's installation when the section names none, as the runner's credentials file defaulted it. */
export const DEFAULT_STATUS_INSTALLATION = 'agentdevicehub';
/** The now-playing tile's installation when the section names none, as the runner defaulted it. */
export const DEFAULT_NOW_PLAYING_INSTALLATION = 'nowplaying';
/** The device ID the old local controller host gave the Tidbyt, and the one the conversion keeps. */
export const DEFAULT_DEVICE_ID = 'tidbyt';

/**
 * The module's configuration: the device record's routing ID, the cloud's device ID, the status tile's installation, and,
 * when the now-playing tile is wanted, the playback record it follows and its own installation.
 */
export type TidbytConfig = {
  readonly id: string;
  readonly cloudDeviceId: string;
  readonly statusInstallation: string;
  readonly nowPlaying?: {readonly playback: string; readonly installation: string};
};
/** The section as the installer writes it, without the `secrets` member that names the API key's file. */
export type TidbytSection = {
  id: string; cloudDeviceId: string; statusInstallation: string; nowPlaying?: {playback: string; installation: string};
};

const ROUTING_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ROUTING_ID = 128;
const SECTION_KEYS: readonly string[] = ['id', 'cloudDeviceId', 'statusInstallation', 'nowPlaying', 'secrets'];
const refuse = (detail: string): ErrorBody => errorBody('invalid-request', {detail});
const isObject = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null && !Array.isArray(value);
const routingId = (value: unknown): value is string => typeof value === 'string' && value.length <= MAX_ROUTING_ID && ROUTING_ID.test(value);
const installationId = (value: unknown): value is string => typeof value === 'string' && INSTALLATION_ID.test(value);
const only = (value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean => Object.keys(value).every(key => keys.includes(key));

/**
 * The module's `configure`: `{id, cloudDeviceId, statusInstallation?, nowPlaying?, secrets}`.
 * - `id` is the device record's routing ID, which the module names as its one device, so the runtime refuses another
 *   module that names it.
 * - `cloudDeviceId` is the device ID from the Tidbyt app: 1 to 128 letters, digits, underscores or hyphens.
 * - `statusInstallation` is the status tile's installation, letters and digits only, `agentdevicehub` by default.
 * - `nowPlaying`, when present, is `{playback, installation?}`: the routing ID of the `playback` record to show, and the
 *   tile's own installation, `nowplaying` by default, which must differ from the status tile's.
 * - `secrets.token` names the API key's file. `configure` sees only its name and path, never the key.
 */
export function configureTidbyt(section: unknown): Configured<TidbytConfig> | ErrorBody {
  if (!isObject(section) || !only(section, SECTION_KEYS)) return refuse('the tidbyt section has only id, cloudDeviceId, statusInstallation, nowPlaying and secrets');
  const {id, cloudDeviceId, secrets} = section;
  if (!routingId(id)) return refuse('id must be lowercase letters and digits with single hyphens, at most 128 characters');
  if (typeof cloudDeviceId !== 'string' || !CLOUD_DEVICE_ID.test(cloudDeviceId)) {
    return refuse('cloudDeviceId must be 1 to 128 letters, digits, underscores or hyphens');
  }
  const statusInstallation = section.statusInstallation ?? DEFAULT_STATUS_INSTALLATION;
  if (!installationId(statusInstallation)) return refuse('statusInstallation must be 1 to 64 letters and digits');
  let nowPlaying: TidbytConfig['nowPlaying'];
  if (section.nowPlaying !== undefined) {
    const block = section.nowPlaying;
    if (!isObject(block) || !only(block, ['playback', 'installation']) || !routingId(block.playback)) {
      return refuse('nowPlaying must be {playback, installation?}, with the playback record\'s routing ID');
    }
    const installation = block.installation ?? DEFAULT_NOW_PLAYING_INSTALLATION;
    if (!installationId(installation) || installation === statusInstallation) {
      return refuse('nowPlaying.installation must be 1 to 64 letters and digits, and differ from statusInstallation');
    }
    nowPlaying = {playback: block.playback, installation};
  }
  if (!isObject(secrets) || !Object.hasOwn(secrets, API_KEY_SECRET)) return refuse('the section must name the API key\'s file as secrets.token');
  return {config: {id, cloudDeviceId, statusInstallation, ...(nowPlaying === undefined ? {} : {nowPlaying})}, devices: [id]};
}

/** The runner's credentials file: `TIDBYT_DEVICE_ID`, `TIDBYT_API_KEY` and an optional `TIDBYT_INSTALLATION_ID`. */
export type RunnerCredentials = {deviceId: string; apiKey: string; installationId: string};
const KEYS = {TIDBYT_DEVICE_ID: 'deviceId', TIDBYT_API_KEY: 'apiKey', TIDBYT_INSTALLATION_ID: 'installationId'} as const;
const isKey = (key: string): key is keyof typeof KEYS => Object.hasOwn(KEYS, key);

/**
 * The runner's credentials, from the text of its private `KEY=VALUE` file, or undefined when the runner would refuse
 * it. Copied from `parseTidbytCredentials` in controllers/tidbyt/src/credentials.ts at main 627e3fe3, which threw
 * instead. Nothing here reads a file or repeats a value.
 */
export function parseRunnerCredentials(text: string): RunnerCredentials | undefined {
  const values: Partial<Record<'deviceId' | 'apiKey' | 'installationId', string>> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    const key = line.slice(0, at).trim();
    if (at < 1 || !isKey(key)) return undefined;
    const field = KEYS[key];
    if (values[field] !== undefined) return undefined;
    values[field] = line.slice(at + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  const {deviceId, apiKey, installationId: installation = DEFAULT_STATUS_INSTALLATION} = values;
  if (deviceId === undefined || deviceId === '' || apiKey === undefined || apiKey === '' || !INSTALLATION_ID.test(installation)) return undefined;
  return {deviceId, apiKey, installationId: installation};
}

/** The 1.x playback source ID as a routing ID, by the playback module's rule (`routingIdOf`, #929). */
export function playbackIdOf(sourceId: string): string {
  const converted = sourceId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return converted === '' ? 'playback' : converted;
}

/**
 * What the conversion gives the installer: the module's section, the API key for the installer to write into a private
 * secret file that the section's `secrets.token` names, and the runner's playback source ID when it had to be renamed.
 * Never print `apiKey`.
 */
export type ConvertedTidbyt = {section: TidbytSection; apiKey: string; renamedFrom?: string};

const RUNNER_KEYS: readonly string[] = ['hubUrl', 'ownerId', 'tokenFile', 'credentialsFile', 'nowPlaying'];
const RUNNER_REQUIRED: readonly string[] = ['hubUrl', 'ownerId', 'tokenFile', 'credentialsFile'];
const HUB_ID = /^[A-Za-z0-9_.-]{1,128}$/;

/**
 * Converts the old runner's configuration, the parsed `tidbyt-status.json`, and the text of the credentials file it names
 * into the module's section, as the cutover's installer (#935) writes it. It keeps the cloud's device ID and both
 * installation IDs, so the tiles already in the rotation are the ones the module writes and none is left behind. The
 * runner's Hub URL, owner and Hub token files have no part in the module, which follows the core and the playback module
 * on the runtime's bus. Its publishing state starts fresh (owner decision 10, 2026-10-06). The now-playing source becomes
 * the playback record's routing ID by the playback module's rule, and `renamedFrom` names a renamed one. A runner
 * configuration or credentials file the runner would refuse is refused with fixed text.
 */
export function convertTidbytRunner(runner: unknown, credentials: string): ConvertedTidbyt | ErrorBody {
  if (!isObject(runner) || !only(runner, RUNNER_KEYS) || !RUNNER_REQUIRED.every(key => Object.hasOwn(runner, key))) {
    return refuse('the runner configuration must be {hubUrl, ownerId, tokenFile, credentialsFile, nowPlaying?}');
  }
  const parsed = parseRunnerCredentials(credentials);
  if (parsed === undefined || !CLOUD_DEVICE_ID.test(parsed.deviceId)) return refuse('the runner\'s credentials file does not hold a device ID and an API key the runner takes');
  const section: TidbytSection = {id: DEFAULT_DEVICE_ID, cloudDeviceId: parsed.deviceId, statusInstallation: parsed.installationId};
  let renamedFrom: string | undefined;
  if (runner.nowPlaying !== undefined) {
    const block = runner.nowPlaying;
    if (!isObject(block) || !only(block, ['tokenFile', 'sourceId', 'installationId']) || !Object.hasOwn(block, 'tokenFile') ||
      typeof block.sourceId !== 'string' || !HUB_ID.test(block.sourceId)) {
      return refuse('the runner\'s nowPlaying block must be {tokenFile, sourceId, installationId?}');
    }
    const installation = block.installationId ?? DEFAULT_NOW_PLAYING_INSTALLATION;
    if (!installationId(installation) || installation === parsed.installationId) {
      return refuse('the runner\'s now-playing installation must be letters and digits, and differ from the status installation');
    }
    const playback = playbackIdOf(block.sourceId);
    if (playback !== block.sourceId) renamedFrom = block.sourceId;
    section.nowPlaying = {playback, installation};
  }
  return {section, apiKey: parsed.apiKey, ...(renamedFrom === undefined ? {} : {renamedFrom})};
}
