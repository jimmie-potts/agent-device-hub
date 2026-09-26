import { validate } from '@jimmie-potts/device-contracts';
import { LifxController, type BulbConfig } from '@jimmie-potts/lifx-controller';
import { hubOrigin, hubToken, HUB_ID, HubStatusFeed } from '@jimmie-potts/agent-status';
import { loadRunnerConfig, privateText, type RunnerConfig } from '@jimmie-potts/tidbyt-controller/runner';

/** The Tidbyt runner's fixed device ID; every other configured device ID must differ from it. */
export const TIDBYT_DEVICE_ID = 'tidbyt';
export type Scope = 'read' | 'control';
export type Credential = { id: string; digest: string; scopes: Scope[]; devices: string[] };
/** Per-bulb painting caps for the automatic status publisher. Meaningless for an unqualified
 * bulb, which never paints regardless of these values. */
export type LifxBulbStatusConfig = { brightnessCapPercent?: number; quietCapPercent?: number };
export type LifxBulbConfig = BulbConfig & { status?: LifxBulbStatusConfig };
/** The hub feed the LIFX status publisher reads, resolved to a live token at load time. */
export type LifxStatusFeedConfig = { hubUrl: string; ownerId: string; token: string };
export type LifxConfig = {
  controllerId: string;
  sourceId: string;
  bulbs: LifxBulbConfig[];
  timeoutMs?: number;
  retries?: number;
  maxPending?: number;
  /** Present only when at least one bulb should paint automatic agent status. */
  status?: LifxStatusFeedConfig;
};
export type HostConfig = { port: number; credentials: Credential[]; tidbyt?: RunnerConfig; lifx?: LifxConfig };

const fail = (): never => { throw new Error('invalid-host-config'); };
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keysAre = (value: Record<string, unknown>, required: string[], optional: string[] = []) =>
  required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const integer = (value: unknown, minimum: number, maximum: number): value is number =>
  Number.isInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
const unique = (values: unknown[]) => new Set(values).size === values.length;

function lifxBulbStatusConfig(value: unknown): LifxBulbStatusConfig {
  if (!plain(value) || !keysAre(value, [], ['brightnessCapPercent', 'quietCapPercent'])
      || (value.brightnessCapPercent !== undefined && !integer(value.brightnessCapPercent, 1, 100))
      || (value.quietCapPercent !== undefined && !integer(value.quietCapPercent, 1, 100))) return fail();
  return structuredClone(value) as LifxBulbStatusConfig;
}

/** Validates the feed shape without a network call, mirroring `loadRunnerConfig`'s status feed check. */
function lifxStatusFeedConfig(value: unknown): LifxStatusFeedConfig {
  if (!plain(value) || !keysAre(value, ['hubUrl', 'ownerId', 'tokenFile'])) return fail();
  const hubUrl = hubOrigin(value.hubUrl);
  const token = hubToken(privateText(value.tokenFile).trim());
  if (typeof value.ownerId !== 'string' || !HUB_ID.test(value.ownerId)) return fail();
  const ownerId = value.ownerId;
  new HubStatusFeed({ hubUrl, ownerId, token });
  return { hubUrl, ownerId, token };
}

function lifxConfig(value: unknown): LifxConfig {
  if (!plain(value) || !keysAre(value, ['controllerId', 'sourceId', 'bulbs'], ['timeoutMs', 'retries', 'maxPending', 'status'])
      || !Array.isArray(value.bulbs) || value.bulbs.length < 1 || value.bulbs.length > 32) return fail();
  const bulbs = (value.bulbs as unknown[]).map(bulb => {
    if (!plain(bulb) || !keysAre(bulb, ['deviceId', 'address'], ['vendor', 'product', 'firmwareMajor', 'firmwareMinor', 'status'])
        || typeof bulb.address !== 'string'
        || ['vendor', 'product', 'firmwareMajor', 'firmwareMinor'].some(key => bulb[key] !== undefined && !integer(bulb[key], 0, 0xffffffff))) return fail();
    const status = bulb.status === undefined ? undefined : lifxBulbStatusConfig(bulb.status);
    return { ...structuredClone(bulb), ...(status ? { status } : {}) } as LifxBulbConfig;
  });
  const status = value.status === undefined ? undefined : lifxStatusFeedConfig(value.status);
  const config = structuredClone(value) as LifxConfig;
  config.bulbs = bulbs;
  if (status) config.status = status; else delete config.status;
  // The controller owns the remaining checks: IDs, unicast IPv4 addresses, duplicates and bounds.
  // Construction opens no socket; this probe never sends.
  try { new LifxController({ ...config, bulbs: bulbs.map(({ status: _status, ...rest }) => rest), transportFactory: () => ({ exchange: fail, close() {} }) }).close(); } catch { return fail(); }
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
