import {lstat, readFile, realpath} from 'node:fs/promises';
import {dirname, isAbsolute, parse, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {SdkError} from '@jimmie-potts/sdk';
export type WindowsConfig = {schema: 'bb8-windows/1.0'; robotId: string; model: 'original-bb8'; configurationRevision: number; adapterAddress: string; targetAddress: string; gatewayUrl: string; tokenFile: string; stateDirectory: string; clockErrorMs: number; clockQualifiedUntilMs: number};
const refuse = (): SdkError => new SdkError(errorBody('invalid-request', {detail: 'BB-8 private configuration refused'}));
const MAC = /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i;
const keys = ['schema', 'robotId', 'model', 'configurationRevision', 'adapterAddress', 'targetAddress', 'gatewayUrl', 'tokenFile', 'stateDirectory', 'clockErrorMs', 'clockQualifiedUntilMs'];
export function parseWindowsConfig(document: unknown): WindowsConfig {
  if (typeof document !== 'object' || document === null || Array.isArray(document)) throw refuse();
  const value = document as Record<string, unknown>;
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw refuse();
  const {schema, robotId, model, configurationRevision, adapterAddress, targetAddress, gatewayUrl, tokenFile, stateDirectory, clockErrorMs, clockQualifiedUntilMs} = value;
  if (schema !== 'bb8-windows/1.0' || model !== 'original-bb8' || typeof robotId !== 'string' || robotId.length > 128 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(robotId) || !Number.isSafeInteger(configurationRevision) || Number(configurationRevision) < 0) throw refuse();
  if (typeof adapterAddress !== 'string' || !MAC.test(adapterAddress) || typeof targetAddress !== 'string' || !MAC.test(targetAddress) || adapterAddress.toLowerCase() === targetAddress.toLowerCase()) throw refuse();
  if (typeof gatewayUrl !== 'string' || typeof tokenFile !== 'string' || !isAbsolute(tokenFile) || typeof stateDirectory !== 'string' || !isAbsolute(stateDirectory)) throw refuse();
  let url: URL; try {url = new URL(gatewayUrl);} catch {throw refuse();}
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '' || url.pathname !== '/') throw refuse();
  if (!Number.isFinite(clockErrorMs) || Number(clockErrorMs) < 0 || Number(clockErrorMs) > 1000 || !Number.isSafeInteger(clockQualifiedUntilMs) || Number(clockQualifiedUntilMs) < 0) throw refuse();
  return {schema, robotId, model, configurationRevision: Number(configurationRevision), adapterAddress, targetAddress, gatewayUrl: url.origin, tokenFile, stateDirectory, clockErrorMs: Number(clockErrorMs), clockQualifiedUntilMs: Number(clockQualifiedUntilMs)};
}
/** Enforces owner-only ACLs on Windows, and refuses Git trees, links and non-regular configuration/token files. */
export async function assertPrivate(path: string, directory = false, maxBytes = 65_536): Promise<void> {
  if (process.platform !== 'win32' || !isAbsolute(path)) throw refuse();
  const info = await lstat(path);
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1 || info.size > maxBytes)) throw refuse();
  if ((await realpath(path)).toLowerCase() !== resolve(path).toLowerCase()) throw refuse();
  let parent = directory ? path : dirname(path);
  while (parent !== parse(parent).root) {
    if (await lstat(resolve(parent, '.git')).then(() => true, () => false)) throw refuse();
    parent = dirname(parent);
  }
  const checked = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', fileURLToPath(new URL('../../bin/check-private.ps1', import.meta.url)), '-Path', path], {stdio: 'ignore', timeout: 10_000, windowsHide: true});
  if (checked.error !== undefined || checked.status !== 0) throw refuse();
}
export async function readWindowsConfig(path: string): Promise<WindowsConfig> {
  await assertPrivate(path);
  let parsed: unknown; try {parsed = JSON.parse(await readFile(path, 'utf8'));} catch {throw refuse();}
  return parseWindowsConfig(parsed);
}
