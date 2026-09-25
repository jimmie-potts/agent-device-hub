import { validate } from '@jimmie-potts/device-contracts';
import { LifxController, type BulbConfig } from '@jimmie-potts/lifx-controller';
import { loadRunnerConfig, privateText, type RunnerConfig } from '@jimmie-potts/tidbyt-controller/runner';

/** The Tidbyt runner's fixed device ID; every other configured device ID must differ from it. */
export const TIDBYT_DEVICE_ID = 'tidbyt';
export type Scope = 'read' | 'control';
export type Credential = { id: string; digest: string; scopes: Scope[]; devices: string[] };
export type LifxConfig = {
  controllerId: string;
  sourceId: string;
  bulbs: BulbConfig[];
  timeoutMs?: number;
  retries?: number;
  maxPending?: number;
};
export type HostConfig = { port: number; credentials: Credential[]; tidbyt?: RunnerConfig; lifx?: LifxConfig };

const fail = (): never => { throw new Error('invalid-host-config'); };
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keysAre = (value: Record<string, unknown>, required: string[], optional: string[] = []) =>
  required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const integer = (value: unknown, minimum: number, maximum: number): value is number =>
  Number.isInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
const unique = (values: unknown[]) => new Set(values).size === values.length;

function lifxConfig(value: unknown): LifxConfig {
  if (!plain(value) || !keysAre(value, ['controllerId', 'sourceId', 'bulbs'], ['timeoutMs', 'retries', 'maxPending'])
      || !Array.isArray(value.bulbs) || value.bulbs.length < 1 || value.bulbs.length > 32) return fail();
  const bulbs = (value.bulbs as unknown[]).map(bulb => {
    if (!plain(bulb) || !keysAre(bulb, ['deviceId', 'address'], ['vendor', 'product', 'firmwareMajor', 'firmwareMinor'])
        || typeof bulb.address !== 'string'
        || ['vendor', 'product', 'firmwareMajor', 'firmwareMinor'].some(key => bulb[key] !== undefined && !integer(bulb[key], 0, 0xffffffff))) return fail();
    return structuredClone(bulb) as BulbConfig;
  });
  const config = structuredClone(value) as LifxConfig;
  config.bulbs = bulbs;
  // The controller owns the remaining checks: IDs, unicast IPv4 addresses, duplicates and bounds.
  // Construction opens no socket; this probe never sends.
  try { new LifxController({ ...config, transportFactory: () => ({ exchange: fail, close() {} }) }).close(); } catch { return fail(); }
  return config;
}

function credentialsConfig(value: unknown, devices: string[]): Credential[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) return fail();
  const credentials = value.map(credential => {
    if (!plain(credential) || !keysAre(credential, ['id', 'digest', 'scopes', 'devices']) || !validate('id', credential.id)
        || typeof credential.digest !== 'string' || !/^[a-f0-9]{64}$/.test(credential.digest)
        || !Array.isArray(credential.scopes) || credential.scopes.length < 1 || !unique(credential.scopes)
        || credential.scopes.some(scope => scope !== 'read' && scope !== 'control')
        || !Array.isArray(credential.devices) || credential.devices.length < 1 || !unique(credential.devices)
        || credential.devices.some(device => typeof device !== 'string' || !devices.includes(device))) return fail();
    return structuredClone(credential) as Credential;
  });
  if (!unique(credentials.map(c => c.id)) || !unique(credentials.map(c => c.digest))) return fail();
  return credentials;
}

/**
 * Load the host's private configuration: an absolute, owner-only file outside any Git checkout.
 * `tidbyt.runnerConfig` names the existing Tidbyt runner JSON, loaded with the runner's own rules.
 * Every failure is the same generic error, so no file contents or paths escape.
 */
export function loadHostConfig(path: string): HostConfig {
  try {
    const value: unknown = JSON.parse(privateText(path));
    if (!plain(value) || !keysAre(value, ['port', 'credentials'], ['tidbyt', 'lifx']) || !integer(value.port, 0, 65535)
        || (value.tidbyt === undefined && value.lifx === undefined)) return fail();
    let tidbyt: RunnerConfig | undefined;
    if (value.tidbyt !== undefined) {
      if (!plain(value.tidbyt) || !keysAre(value.tidbyt, ['runnerConfig'])) return fail();
      tidbyt = loadRunnerConfig(value.tidbyt.runnerConfig as string);
    }
    const lifx = value.lifx === undefined ? undefined : lifxConfig(value.lifx);
    const devices = [...(tidbyt ? [TIDBYT_DEVICE_ID] : []), ...(lifx?.bulbs.map(b => b.deviceId) ?? [])];
    if (!unique(devices)) return fail();
    return { port: value.port as number, credentials: credentialsConfig(value.credentials, devices), ...(tidbyt ? { tidbyt } : {}), ...(lifx ? { lifx } : {}) };
  } catch { return fail(); }
}
