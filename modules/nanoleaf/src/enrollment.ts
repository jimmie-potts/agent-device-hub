// Enroll NL22 Light Panels beside the original Lines device, change their address, or remove them again (enrollment.py).
// The command line, the hidden credential prompt and the pairing request are not ported (PORTING.md).
import {existsSync, lstatSync, readlinkSync, unlinkSync} from 'node:fs';
import {homedir} from 'node:os';
import {isIPv6} from 'node:net';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as wait} from 'node:timers/promises';
import {isObject, sameValue, type JsonObject} from './compat.js';
import {withState} from './database.js';
import {credential, DEFAULT, DEVICE_TABLES, ID, layoutDevices, lockFile, metaKey, registry, saveDeviceLayout, sceneFile,
  type LayoutEntry, type RegistryEntry} from './devices.js';
import {Partial, ValueError} from './errors.js';
import {readJson, writeJson} from './jsonfile.js';
import {readLayout} from './panels.js';
import {execute, first, transaction} from './sqlite.js';
import {controlState, markDirty} from './store.js';

export const KIND = 'panels';
export const MODEL = 'NL22';
export const REMOVE_WAIT_SECONDS = 10.0;

/** A Nanoleaf controller read: the device address and credential, an HTTP method, an endpoint and an optional body. */
export type LightRequest = (address: {ip: string; token: string}, method: string, endpoint?: string, payload?: unknown) => Promise<unknown>;

// ipaddress.IPv4Address.is_private in Python 3.12.4 and later.
const PRIVATE: readonly (readonly [string, number])[] = [['0.0.0.0', 8], ['10.0.0.0', 8], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.0.170', 31], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['240.0.0.0', 4], ['255.255.255.255', 32]];
const GLOBAL_EXCEPTIONS: readonly (readonly [string, number])[] = [['192.0.0.9', 32], ['192.0.0.10', 32]];

/** Python's IPv4 parser: four decimal octets without leading zeros. */
function ipv4(text: string): number | null {
  const octets = text.split('.');
  if (octets.length !== 4) return null;
  let value = 0;
  for (const octet of octets) {
    if (!/^[0-9]{1,3}$/.test(octet) || (octet !== '0' && octet.startsWith('0')) || Number(octet) > 255) return null;
    value = value * 256 + Number(octet);
  }
  return value;
}

const within = (address: number, [network, prefix]: readonly [string, number]): boolean => {
  const base = ipv4(network) ?? 0;
  const size = 2 ** (32 - prefix);
  return Math.floor(address / size) === Math.floor(base / size);
};

/** A private IPv4 address in its canonical spelling; anything else is refused. */
export function privateAddress(ip: string): string {
  const address = ipv4(ip);
  if (address === null && !isIPv6(ip)) throw new ValueError(`'${ip}' does not appear to be an IPv4 or IPv6 address`);
  if (address === null || !PRIVATE.some(network => within(address, network)) || GLOBAL_EXCEPTIONS.some(network => within(address, network))) {
    throw new ValueError('Use a private IPv4 address for the lights.');
  }
  return ip;
}

/** Python's os.path.realpath(strict=False): resolve every symlink that exists and keep the rest of the path. */
function realpath(path: string): string {
  const rest: (string | null)[] = path.split('/').reverse();
  let parts = rest.length;
  let resolved = path.startsWith('/') ? '/' : process.cwd();
  const seen = new Map<string, string | null>();
  while (parts > 0) {
    const name = rest.pop();
    if (name === null) {
      // A resolved symlink target: remember where its link path led.
      seen.set(rest.pop() ?? '', resolved);
      continue;
    }
    parts -= 1;
    if (name === undefined || name === '' || name === '.') continue;
    if (name === '..') {
      const parent = resolved.slice(0, resolved.lastIndexOf('/'));
      resolved = parent === '' ? '/' : parent;
      continue;
    }
    const next = resolved === '/' ? resolved + name : resolved + '/' + name;
    let target: string;
    try {
      if (!lstatSync(next).isSymbolicLink()) {
        resolved = next;
        continue;
      }
      if (seen.has(next)) {
        // An unresolved entry means a symlink loop; keep the link path as Python does.
        resolved = seen.get(next) ?? next;
        continue;
      }
      target = readlinkSync(next);
    } catch {
      resolved = next;
      continue;
    }
    if (target.startsWith('/')) resolved = '/';
    seen.set(next, null);
    rest.push(next, null);
    const pieces = target.split('/');
    rest.push(...pieces.reverse());
    parts += pieces.length;
  }
  return resolved;
}

/** The resolved state directory; Windows and Windows-mounted drives are refused so the database stays on Linux. */
export function stateDirectory(directory: string): string {
  const expanded = directory === '~' || directory.startsWith('~/') ? homedir() + directory.slice(1) : directory;
  // Resolve symlinks first, as the installer does, so a link cannot reach a Windows drive.
  const resolved = realpath(expanded);
  if (process.platform === 'win32' || /^\/mnt\/[a-zA-Z](?:\/|$)/.test(resolved)) {
    throw new ValueError('Only Linux state outside Windows-mounted drives is supported');
  }
  return resolved;
}

export function deviceId(device: string): string {
  if (device === DEFAULT) throw new ValueError('The Lines id `wall` is reserved.');
  if (!ID.test(device)) throw new ValueError('Invalid device id. Use 1 to 128 letters, digits, dots, underscores or hyphens.');
  return device;
}

const SQLITE_BUSY = 5;
const isBusy = (error: unknown): error is Error => error instanceof Error && 'errcode' in error && error.errcode === SQLITE_BUSY;
/** Seconds a registry operation waits for another to finish, as Python's sqlite3 timeout=5 did. */
export const REGISTRY_WAIT_SECONDS = 5;

/**
 * Take an exclusive SQLite lock on `path` without blocking the event loop: a busy lock is retried every 0.1 seconds
 * until `seconds` pass. Returns the lock, or the last busy error.
 */
async function takeLock(path: string, seconds: number, sleep: (seconds: number) => Promise<void>): Promise<DatabaseSync | Error> {
  const deadline = performance.now() + seconds * 1000;
  for (;;) {
    const lock = new DatabaseSync(path, {timeout: 0});
    try {
      lock.exec('BEGIN EXCLUSIVE');
      return lock;
    } catch (error) {
      lock.close();
      if (!isBusy(error)) throw error;
      if (performance.now() >= deadline) return error;
    }
    await sleep(0.1);
  }
}

// Registry operations in this process, by lock path: each starts after the previous one settles, so they take turns
// instead of finding the lock busy. The SQLite lock still excludes other processes.
const registryTurns = new Map<string, Promise<unknown>>();

function inTurn<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = registryTurns.get(key) ?? Promise.resolve();
  const result = previous.then(task, task);
  const settled = result.then(() => undefined, () => undefined);
  registryTurns.set(key, settled);
  void settled.then(() => {
    if (registryTurns.get(key) === settled) registryTurns.delete(key);
  });
  return result;
}

/** Hold the registry's exclusive lock on `path` while `body` runs; a busy lock fails after REGISTRY_WAIT_SECONDS. */
function exclusive<T>(path: string, body: () => Promise<T>): Promise<T> {
  return inTurn(path, async () => {
    const lock = await takeLock(path, REGISTRY_WAIT_SECONDS, pause);
    if (lock instanceof Error) throw lock;
    try {
      return await body();
    } finally {
      if (lock.isTransaction) lock.exec('ROLLBACK');
      lock.close();
    }
  });
}

/** Hold the device's worker lock, so no instance for it runs; null if one is still running after `seconds`. */
export async function workerLock(directory: string, device: string, seconds = 0, sleep: (seconds: number) => Promise<void> = pause): Promise<DatabaseSync | null> {
  const lock = await takeLock(join(directory, lockFile(device)), seconds, sleep);
  return lock instanceof Error ? null : lock;
}

async function pause(seconds: number): Promise<void> {
  await wait(seconds * 1000);
}

function readConfig(directory: string): JsonObject {
  const config = readJson(join(directory, 'config.json'));
  registry(config); // A malformed registry is refused, never repaired.
  return config as JsonObject;
}

/** Refuse a malformed layout file before anything is written, since a rerun could not repair it. */
function checkLayout(directory: string): void {
  const path = join(directory, 'layout.json');
  try {
    if (existsSync(path)) layoutDevices(readJson(path));
  } catch (error) {
    if (!(error instanceof ValueError)) throw error;
    throw new ValueError(`The saved layout.json is invalid (${error.message.replace(/\.+$/, '')}). Repair it before enrolling or removing a device.`);
  }
}

/** Delete a device's rows, meta keys, layout entry and saved scene; shared tasks stay. */
function purge(directory: string, device: string): void {
  withState(directory, db => transaction(db, () => {
    for (const table of DEVICE_TABLES) execute(db, 'DELETE FROM ' + table + ' WHERE device=?', device);
    const suffix = '@' + device;
    execute(db, 'DELETE FROM meta WHERE substr(key, -?) = ?', suffix.length, suffix);
  }));
  saveDeviceLayout(join(directory, 'layout.json'), device, null, writeJson);
  const scene = join(directory, sceneFile(device));
  if (existsSync(scene)) unlinkSync(scene);
}

/** The existing entry for a repeat, or null; refuses anything that would redirect an identity. */
export function checkTarget(config: unknown, device: string, ip: string): RegistryEntry | null {
  const devices = registry(config);
  const existing = devices.get(device) ?? null;
  if (existing !== null && (existing.kind !== KIND || existing.ip !== ip)) {
    throw new ValueError(`Device \`${device}\` is registered at another address or as another kind. `
      + 'Move registered Panels with device-address, or remove the device first; enrollment never redirects an identity.');
  }
  const key = existing === null ? 'token@' + device : existing.token_ref;
  for (const [other, entry] of devices) {
    if (other === device) continue;
    if (entry.ip === ip) throw new ValueError(`Device \`${other}\` already uses that address.`);
    if (entry.token_ref === key) throw new ValueError(`Device \`${device}\` shares a credential key with \`${other}\`. Remove it first.`);
  }
  return existing;
}

/** Refuse a conflicting target before a credential is requested from the operator or device. */
export async function check(directory: string, device: string, ip: string): Promise<void> {
  const state = stateDirectory(directory);
  await exclusive(join(state, 'registry-lock.sqlite'), () => {
    checkTarget(readConfig(state), deviceId(device), privateAddress(ip));
    return Promise.resolve();
  });
}

export interface Enrollment {
  ip: string;
  token: string;
  device?: string;
  request: LightRequest;
}

export interface Enrolled {
  device: string;
  triangles: number;
  repeat: boolean;
  firmware: unknown;
}

/** Verify an NL22 device and register it in Free; nothing is written unless every check passes. */
export async function enroll(directory: string, options: Enrollment): Promise<Enrolled> {
  const state = stateDirectory(directory);
  const device = deviceId(options.device ?? KIND);
  const ip = privateAddress(options.ip);
  const token = options.token;
  if (!/^[A-Za-z0-9]+$/.test(token)) throw new ValueError('The device credential must contain only ASCII letters and numbers.');
  return exclusive(join(state, 'registry-lock.sqlite'), async () => {
    const config = readConfig(state);
    const existing = checkTarget(config, device, ip);
    const info = await options.request({ip, token}, 'GET');
    if (!isObject(info) || info.model !== MODEL) throw new ValueError('The device at that address is not NL22 Light Panels.');
    const layout = readLayout(info.panelLayout);
    const tokenRef = 'token@' + device;
    if (existing !== null) {
      // A repeat replaces only the credential; layout, mode and reservations stay.
      config[existing.token_ref] = token;
      writeJson(join(state, 'config.json'), config);
    } else {
      checkLayout(state);
      const lock = await workerLock(state, device);
      if (lock === null) throw new ValueError(`A worker for \`${device}\` is still running. Retry in a moment.`);
      try {
        try {
          purge(state, device);
          // No revision keys: revision and applied both read 0, so nothing is pending.
          withState(state, db => transaction(db, () => execute(db, 'INSERT INTO meta VALUES (?, ?)', metaKey('mode', device), 'free'), 'BEGIN'));
          saveDeviceLayout(join(state, 'layout.json'), device, layout, writeJson);
        } finally {
          lock.close();
        }
        // Python's config.setdefault('devices', {}): a present but non-object registry fails as a partial change.
        const registered = Object.hasOwn(config, 'devices') ? config.devices : {};
        if (!isObject(registered)) throw new TypeError('The device registry is not an object.');
        config.devices = registered;
        registered[device] = {kind: KIND, ip, token_ref: tokenRef};
        config[tokenRef] = token;
        // The registry is written last, so an earlier failure leaves only unread state for an unregistered id.
        writeJson(join(state, 'config.json'), config);
      } catch (error) {
        throw new Partial(error);
      }
    }
    return {device, triangles: layout.elements.length, repeat: existing !== null, firmware: info.firmwareVersion ?? null};
  });
}

export interface AddressChanged {
  device: string;
  ip: string;
  triangles: number;
}

/** Move a registered Panels device to a verified new address; its identity and saved state stay. */
export async function changeAddress(directory: string, device: string, ip: string, request: LightRequest): Promise<AddressChanged> {
  const state = stateDirectory(directory);
  if (device === DEFAULT) throw new ValueError('device-address moves Light Panels only; it does not move the Lines device `wall`.');
  const id = deviceId(device);
  const address = privateAddress(ip);
  return exclusive(join(state, 'registry-lock.sqlite'), async () => {
    const config = readConfig(state);
    checkLayout(state);
    const devices = registry(config);
    const entry = devices.get(id);
    if (entry === undefined) throw new ValueError('Unknown device.');
    if (entry.kind !== KIND) throw new ValueError(`Device \`${id}\` is not Light Panels.`);
    if (entry.ip === address) throw new ValueError(`Device \`${id}\` is already registered at that address.`);
    for (const [other, registered] of devices) {
      if (other !== id && registered.ip === address) throw new ValueError(`Device \`${other}\` already uses that address.`);
    }
    const layoutPath = join(state, 'layout.json');
    const saved: LayoutEntry | undefined = layoutDevices(existsSync(layoutPath) ? readJson(layoutPath) : {}).get(id);
    if (saved === undefined || saved.kind !== KIND) throw new ValueError(`Device \`${id}\` has no saved layout. Remove it and enroll it again.`);
    const token = credential(config, entry);
    if (token === null || token === '') throw new ValueError(`Device \`${id}\` has no stored credential. Remove it and enroll it again.`);
    // One read with the stored credential; no light write reaches the device.
    const info = await request({ip: address, token}, 'GET');
    if (!isObject(info) || info.model !== MODEL) throw new ValueError('The device at that address is not NL22 Light Panels.');
    const reported = readLayout(info.panelLayout);
    // The same physical set: equal triangles, positions and neighbors, not just an equal count.
    if (!sameValue(reported.elements, saved.elements) || !sameValue(reported.panel_geometry, saved.panel_geometry ?? null)) {
      throw new ValueError('The triangles at that address do not match the saved layout. '
        + 'Check the address, or remove the device and enroll it again.');
    }
    // Only the registry changes; a running worker reads the address again on its next pass.
    const entries = config.devices;
    const target = isObject(entries) ? entries[id] : undefined;
    if (!isObject(target)) throw new TypeError('The device registry entry is missing.');
    target.ip = address;
    writeJson(join(state, 'config.json'), config);
    return {device: id, ip: address, triangles: saved.elements.length};
  });
}

export interface Removal {
  /** Remove an unreachable device whose Free handoff cannot finish. */
  force?: boolean;
  /** Seconds to wait for a running worker to stop. */
  wait?: number;
  sleep?: (seconds: number) => Promise<void>;
}

/** Unregister a device, stop its worker and delete what it owned; Lines and shared tasks stay. */
export async function remove(directory: string, device: string, options: Removal = {}): Promise<{device: string; cleaned: boolean}> {
  const state = stateDirectory(directory);
  const id = deviceId(device);
  return exclusive(join(state, 'registry-lock.sqlite'), async () => {
    const config = readConfig(state);
    checkLayout(state);
    const registered = config.devices;
    const entry = isObject(registered) && Object.hasOwn(registered, id) ? registered[id] : undefined;
    if (isObject(entry) && isObject(registered)) {
      const control = withState(state, db => controlState(db, id));
      if (options.force !== true && control.mode !== 'free') {
        throw new ValueError(`Hand the device back first: run \`mode free --device ${id}\`, wait until status shows nothing pending, then remove it.`);
      }
      if (options.force !== true && control.revision !== control.applied) {
        throw new ValueError('Free has not been applied yet. Wait until status shows nothing pending, or add --force if the device is unreachable.');
      }
      Reflect.deleteProperty(registered, id);
      const tokenRef = entry.token_ref;
      if (tokenRef !== 'token' && Object.values(registered).every(other => !isObject(other) || other.token_ref !== tokenRef)) {
        if (typeof tokenRef === 'string') Reflect.deleteProperty(config, tokenRef);
      }
      writeJson(join(state, 'config.json'), config);
    } else if (!leftovers(state, id)) {
      throw new ValueError('Unknown device.');
    }
    try {
      if (entry !== undefined) {
        // A waiting instance wakes, sees the device is gone and exits.
        withState(state, db => transaction(db, () => markDirty(db), 'BEGIN'));
      }
      const lock = await workerLock(state, id, options.wait ?? REMOVE_WAIT_SECONDS, options.sleep);
      if (lock === null) return {device: id, cleaned: false};
      try {
        purge(state, id);
      } finally {
        lock.close();
      }
    } catch (error) {
      throw new Partial(error);
    }
    return {device: id, cleaned: true};
  });
}

/** Whether anything a device owned is still saved: its scene, layout entry, meta keys or device rows. */
function leftovers(directory: string, device: string): boolean {
  if (existsSync(join(directory, sceneFile(device)))) return true;
  const layout = join(directory, 'layout.json');
  if (existsSync(layout) && layoutDevices(readJson(layout)).has(device)) return true;
  const suffix = '@' + device;
  return withState(directory, db => first(db, 'SELECT 1 FROM meta WHERE substr(key, -?) = ?', suffix.length, suffix) !== undefined
    || DEVICE_TABLES.some(table => first(db, 'SELECT 1 FROM ' + table + ' WHERE device=? LIMIT 1', device) !== undefined));
}
