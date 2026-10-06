// Installation configuration: registered devices, their saved or discovered geometry, and Line pairing (configuration.py).
// The state directory's location is the installation's, so `data_dir` is not ported (PORTING.md).
import {join} from 'node:path';
import {DEFAULT, registry, type DeviceProjection} from './devices.js';
import {ValueError} from './errors.js';
import {readJson} from './jsonfile.js';
import type {LightRequest} from './transport.js';

/** One device's configuration: config.json with the device's layout, identity, address and credential. */
export interface LoadedConfig extends DeviceProjection {
  device: string;
  ip?: string;
  token?: string;
  [key: string]: unknown;
}

const notPorted = (): never => {
  throw new Error('Not ported yet (Hub #26, slice 2).');
};

/** Pair the two collinear light zones of each NL59 Line, excluding connectors, in the installed orientation's order. */
export function pairLines(_panelLayout: unknown): number[][] {
  return notPorted();
}

/**
 * Configuration and layout for one registered device; the original Lines device by default.
 *
 * A saved layout needs no device request. A missing or incomplete one is read from the device through `request` and
 * saved before use.
 */
export function loadConfig(_directory: string, _device: string = DEFAULT, _request?: LightRequest): Promise<LoadedConfig> {
  return Promise.resolve(notPorted());
}

/** Registered device ids, the original Lines device first; an unreadable configuration means Lines only. */
export function registeredDevices(directory: string): string[] {
  let devices: Map<string, unknown>;
  try {
    devices = registry(readJson(join(directory, 'config.json'), true));
  } catch (error) {
    if (error instanceof ValueError || (error instanceof Error && 'code' in error)) return [DEFAULT];
    throw error;
  }
  return [DEFAULT, ...[...devices.keys()].filter(device => device !== DEFAULT)];
}

/** Point a running pass at its device's registered address and credential; keep them if unreadable. */
export function followRegistry(_directory: string, _config: {ip?: string; token?: string}, _device: string): void {
  notPorted();
}
