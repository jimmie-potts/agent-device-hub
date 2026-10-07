// The Pixoo module's section of the runtime's configuration file (Hub #843, module API 1.1). `configurePixoo` checks it
// before start, reading no file and reaching no device. `convertPixooSettings` turns the separate Pixoo service's
// settings files into that section; the cutover's installer (#935) runs it.
import {errorBody, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import type {Configured} from '@jimmie-potts/sdk';
import {nowPlayingSetting, presentationConfiguration, type NowPlayingSetting, type PresentationConfiguration} from '../core/index.js';
import {validateHostedFileConfig, type HostedFileConfig} from '../device/index.js';
import {DEVICE_PROFILES, SIMULATOR_PROFILE, type MediaProfile} from '../media/index.js';

/** The profile that uses the hosted-GIF listener: the device fetches each animation from it. */
export const HOSTED_PROFILE = 'pixoo64-hosted-2026-10-01';
/** The device ID the separate Pixoo service gave the Hub, which the conversion keeps by default. */
export const DEFAULT_DEVICE_ID = 'pixoo-local';

/**
 * The section for the simulated Pixoo, the factory's `simulatedSection`: tests and disposable runs of the shipped list give
 * it to the simulated build. Its address is private, as the section needs, and outside the home network's range, so the
 * real build given this section by mistake would reach no device there. The module reads no secret, so it names none.
 */
export const SIMULATED_SECTION = Object.freeze({config: Object.freeze({device: Object.freeze({id: 'pixoo-1', address: '10.0.0.64', profile: 'pixoo64-gif-2026-10-01'})})});

export type PixooConfig = {
  device: {id: string; label?: string; address: string; profile: Readonly<MediaProfile>; model?: string; firmware?: string};
  /** The hosted-GIF listener's bind address, port and the origin the device fetches from. */
  hostedGif?: HostedFileConfig;
  /** The presentation and Now Playing settings to begin with, before the module has saved its own. */
  presentation?: PresentationConfiguration;
  nowPlaying?: NowPlayingSetting;
  /** The `playback/2.0` record Now Playing follows; by default the playback owner's first. */
  playback?: string;
};

const ROUTING_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max &&
  Array.from(value).every(character => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127);
const refuse = (detail: string): ErrorBody => errorBody('invalid-request', {detail});
const PRIVATE = (address: string): boolean => {
  const parts = address.split('.');
  if (parts.length !== 4 || !parts.every(part => /^(0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255)) return false;
  const [a = Number.NaN, b = Number.NaN] = parts.map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};

/** The profiles a transport accepts: the observed device profiles, and the simulator's for a simulated transport. */
export const profilesFor = (simulated: boolean): readonly Readonly<MediaProfile>[] => simulated ? [SIMULATOR_PROFILE, ...DEVICE_PROFILES] : DEVICE_PROFILES;

/**
 * Checks the module's section. `device` names the Pixoo's routing ID, its private IPv4 address and an observed profile
 * (or, for a simulated transport, the simulator's); the hosted profile also needs `hostedGif`. `presentation` and
 * `nowPlaying` are the settings to begin with, and `playback` the playback record Now Playing follows. The Pixoo's local
 * API takes no token, so the module reads no secret its section may name. A refusal names the field, never its value.
 */
export function configurePixoo(section: unknown, {simulated}: {simulated: boolean}): Configured<PixooConfig> | ErrorBody {
  // The runtime checks the `secrets` member itself; the Pixoo's local API takes no token, so the module reads none.
  const {device, hostedGif, presentation, nowPlaying, playback, secrets: _secrets, ...rest} = isObject(section) ? section : {};
  if (!isObject(section) || Object.keys(rest).length > 0) return refuse('the section has device, hostedGif, presentation, nowPlaying, playback and secrets only');
  if (!isObject(device)) return refuse('the section needs a device');
  const {id, label, address, profile, model, firmware, ...extra} = device;
  if (Object.keys(extra).length > 0) return refuse('device has id, label, address, profile, model and firmware only');
  if (typeof id !== 'string' || id.length > 128 || !ROUTING_ID.test(id)) return refuse('device.id must be lowercase letters and digits with single hyphens');
  if (label !== undefined && !text(label, 80)) return refuse('device.label must be 1 to 80 characters');
  if (typeof address !== 'string' || !PRIVATE(address)) return refuse('device.address must be a private IPv4 address');
  const chosen = profilesFor(simulated).find(candidate => candidate.name === profile);
  if (chosen === undefined) return refuse(simulated ? 'device.profile must be a known profile' : 'device.profile must be an observed device profile');
  if (model !== undefined && !text(model, 120)) return refuse('device.model must be 1 to 120 characters');
  if (firmware !== undefined && !text(firmware, 120)) return refuse('device.firmware must be 1 to 120 characters');
  let hosted: HostedFileConfig | undefined;
  if (hostedGif !== undefined) {
    const {bind, port, origin, ...others} = isObject(hostedGif) ? hostedGif : {extra: true};
    if (Object.keys(others).length > 0 || typeof bind !== 'string' || typeof port !== 'number' || typeof origin !== 'string') {
      return refuse('hostedGif needs bind, port and origin only');
    }
    try {
      hosted = validateHostedFileConfig({bind, port, origin});
    } catch {
      return refuse('hostedGif must bind a private or local address and name an http origin');
    }
  }
  if (chosen.name === HOSTED_PROFILE && hosted === undefined && !simulated) return refuse('the hosted profile needs hostedGif');
  const shown = presentation === undefined ? undefined : presentationConfiguration.safeParse(presentation);
  if (shown?.success === false) return refuse('presentation must be a version 1 presentation configuration');
  const media = nowPlaying === undefined ? undefined : nowPlayingSetting.safeParse(nowPlaying);
  if (media?.success === false) return refuse('nowPlaying must be a version 1 Now Playing setting');
  if (playback !== undefined && (typeof playback !== 'string' || playback.length > 128 || !ROUTING_ID.test(playback))) {
    return refuse('playback must be a playback record ID');
  }
  const config: PixooConfig = {
    device: {
      id, address, profile: chosen,
      ...(label === undefined ? {} : {label}), ...(model === undefined ? {} : {model}), ...(firmware === undefined ? {} : {firmware}),
    },
    ...(hosted === undefined ? {} : {hostedGif: hosted}),
    ...(shown?.success === true ? {presentation: shown.data} : {}),
    ...(media?.success === true ? {nowPlaying: media.data} : {}),
    ...(typeof playback === 'string' ? {playback} : {}),
  };
  return {config, devices: [id]};
}

/** The separate Pixoo service's settings, as its files hold them, parsed but not checked. */
export type PixooSettingsFiles = {
  /** `device.json`: `{version: 1, configuration: {ip, model?, firmware?, profile}}`. */
  device: unknown;
  /** `hosted-gif.json`, when the service had one: `{bind, port, origin}`. */
  hostedGif?: unknown;
  /** `agent-monitor/presentation.json` and `agent-monitor/now-playing.json`, when the service had them. */
  presentation?: unknown;
  nowPlaying?: unknown;
};

/**
 * Turns the separate Pixoo service's settings into the module's section of the runtime's configuration file, for the
 * installer (#935). The device keeps the Hub's ID `pixoo-local` unless `id` names another. A device file that is not a
 * version 1 configuration, or settings the module would refuse, give a refusal instead, with fixed text. The section
 * holds no secret and no path.
 */
export function convertPixooSettings(files: PixooSettingsFiles, {id = DEFAULT_DEVICE_ID, label}: {id?: string; label?: string} = {}): Record<string, unknown> | ErrorBody {
  const stored = isObject(files.device) ? files.device : {};
  if (stored.version !== 1 || !isObject(stored.configuration)) return refuse('device.json must be a version 1 device configuration');
  const {ip, profile, model, firmware} = stored.configuration;
  const section: Record<string, unknown> = {
    device: {
      id, address: ip, profile,
      ...(label === undefined ? {} : {label}), ...(model === undefined ? {} : {model}), ...(firmware === undefined ? {} : {firmware}),
    },
    ...(files.hostedGif === undefined ? {} : {hostedGif: files.hostedGif}),
    ...(files.presentation === undefined ? {} : {presentation: files.presentation}),
    ...(files.nowPlaying === undefined ? {} : {nowPlaying: files.nowPlaying}),
  };
  const checked = configurePixoo(section, {simulated: false});
  return 'error' in checked ? checked : section;
}
