// Registered devices from the installation configuration (configuration.registered_devices).
// Loading a device's configuration and layout moves with the devices and geometry slice (PORTING.md).
import {join} from 'node:path';
import {DEFAULT, registry} from './devices.js';
import {ValueError} from './errors.js';
import {readJson} from './jsonfile.js';

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
