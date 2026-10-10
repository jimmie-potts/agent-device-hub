// Fixed read-only installed endpoints; this observes health, never accepts it.
import {createHash} from 'node:crypto';
import {MODULE_API_VERSION} from '@jimmie-potts/sdk';
import {parseCredentials, tokenMatches} from './credentials.js';
import {readPrivateFile, readRuntimeConfig, type RuntimeConfig} from './state.js';
import type {UpgradeOwner} from './upgrade-owner.js';

type Route = '/api/v2/build' | '/api/runtime/v1/health';
type ExpectedBuild = {revision: string; version: string};
type ObjectValue = Record<string, unknown>;
const maximum = 256 * 1024;
const refused = (): never => { throw new Error('runtime-upgrade-http-refused'); };
const hash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

function object(value: unknown): ObjectValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return refused();
  return value as ObjectValue;
}
function keys(value: ObjectValue, required: string[], optional: string[] = []): void {
  if (required.some(key => !Object.hasOwn(value, key))
    || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) refused();
}
function text(value: unknown, limit = 128): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > limit
    || Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return refused();
  return value;
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return refused();
  return value;
}
function document(bytes: Buffer): unknown {
  if (bytes.length === 0 || bytes.length > maximum) return refused();
  return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
}
function build(bytes: Buffer, expected: ExpectedBuild) {
  const value = object(document(bytes));
  keys(value, ['schema', 'version', 'revision', 'dirty', 'builtAt']);
  const revision = text(value.revision, 40);
  const version = text(value.version);
  const builtAt = text(value.builtAt, 24);
  const instant = Date.parse(builtAt);
  if (value.schema !== 'runtime-build/2.0' || value.dirty !== false || !/^[0-9a-f]{40}$/.test(revision)
    || revision !== expected.revision || version !== expected.version
    || !Number.isFinite(instant) || new Date(instant).toISOString() !== builtAt) return refused();
  return {schema: 'runtime-build/2.0' as const, revision, version, dirty: false as const, builtAt};
}
function health(bytes: Buffer) {
  const value = object(document(bytes));
  keys(value, ['schema', 'status', 'moduleApiVersion', 'startedAtMs', 'uptimeMs', 'memory', 'lagCheck', 'modules']);
  if (value.schema !== 'runtime-health/1.0' || value.moduleApiVersion !== MODULE_API_VERSION
    || (value.status !== 'ok' && value.status !== 'degraded')) return refused();
  const startedAtMs = number(value.startedAtMs);
  number(value.uptimeMs);
  const memory = object(value.memory);
  keys(memory, ['rssBytes', 'heapTotalBytes', 'heapUsedBytes', 'externalBytes']);
  Object.values(memory).forEach(number);
  const lag = object(value.lagCheck);
  const lagStatus = text(lag.status);
  if (lagStatus === 'off') keys(lag, ['status']);
  else {
    keys(lag, ['status', 'limitMs']);
    if ((lagStatus !== 'active' && lagStatus !== 'stopped') || !Number.isSafeInteger(number(lag.limitMs))
      || number(lag.limitMs) < 1 || number(lag.limitMs) > 3600000) return refused();
  }
  if (!Array.isArray(value.modules) || value.modules.length > 32) return refused();
  const modules = value.modules.map((entry: unknown) => {
    const row = object(entry);
    keys(row, ['name', 'apiVersion', 'state', 'healthy', 'syncRestarts'], ['serves', 'reason']);
    const name = text(row.name);
    const apiVersion = text(row.apiVersion);
    const state = text(row.state);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)
      || !['refused', 'starting', 'running', 'stopping', 'stopped', 'failed'].includes(state)
      || typeof row.healthy !== 'boolean' || row.healthy !== (state === 'running')
      || !Number.isSafeInteger(number(row.syncRestarts))) return refused();
    if (Object.hasOwn(row, 'serves')) {
      if (!Array.isArray(row.serves) || row.serves.length > 128) return refused();
      row.serves.forEach((item: unknown) => { text(item, 256); });
    }
    let reasonCode: string | null = null;
    if (Object.hasOwn(row, 'reason')) {
      const reason = object(row.reason);
      keys(reason, ['code', 'detail']);
      reasonCode = text(reason.code);
      if (typeof reason.detail !== 'string' || reason.detail.length > 8192) return refused();
    }
    return {name, apiVersion, state, healthy: row.healthy, reasonCode};
  }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  if (new Set(modules.map(row => row.name)).size !== modules.length || !modules.some(row => row.name === 'core')) return refused();
  const status = modules.every(row => row.healthy) && lagStatus !== 'stopped' ? 'ok' : 'degraded';
  if (value.status !== status) return refused();
  return {schema: 'runtime-health/1.0' as const, status, moduleApiVersion: MODULE_API_VERSION, startedAtMs,
    lagCheck: lagStatus === 'off' ? {status: lagStatus} : {status: lagStatus, limitMs: number(lag.limitMs)}, modules};
}

/** Internal test seam; JSON and CLI never supply this reader. */
export interface UpgradeHttpReader {
  privateFile(path: string, limit: number): Promise<Buffer>;
  config(path: string): Promise<RuntimeConfig>;
  get(port: number, path: Route, token?: string): Promise<Buffer>;
}

async function installedGet(port: number, path: Route, token?: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, 3000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'GET', redirect: 'error', signal: controller.signal,
      headers: token === undefined ? {} : {Authorization: `Bearer ${token}`},
    });
    const length = response.headers.get('content-length');
    if (response.status !== 200 || response.body === null
      || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')
      || (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum))) {
      await response.body?.cancel();
      return refused();
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let complete = false;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) { complete = true; break; }
        total += next.value.length;
        if (total > maximum) return refused();
        chunks.push(next.value);
      }
      return Buffer.concat(chunks);
    } finally {
      if (!complete) await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  } finally { clearTimeout(timer); }
}

export function createUpgradeHttpObserver(reader: UpgradeHttpReader) {
  return async (owner: UpgradeOwner, tokenFile: string, expected: ExpectedBuild, recheckOwnerAndListener: () => Promise<void>) => {
    try {
      const port = owner.options.port;
      const configFile = owner.options.config;
      if (!Number.isSafeInteger(port) || port < 1 || port > 65535 || configFile === undefined
        || !owner.options.edge || owner.options.simulate || !/^[0-9a-f]{40}$/.test(expected.revision)) return refused();
      const configBytes = await reader.privateFile(configFile, 1024 * 1024);
      const config = await reader.config(configFile);
      if (config.edge === undefined || !configBytes.equals(await reader.privateFile(configFile, 1024 * 1024))) return refused();
      const credentialsFile = config.edge.credentials;
      const credentialBytes = await reader.privateFile(credentialsFile, 65536);
      const credentials = parseCredentials(document(credentialBytes));
      const tokenBytes = await reader.privateFile(tokenFile, 65536);
      const token = new TextDecoder('utf-8', {fatal: true}).decode(tokenBytes).replace(/\r?\n$/, '');
      if (token.length === 0 || token.length > 8192 || Array.from(token).some(character => character.charCodeAt(0) < 33 || character.charCodeAt(0) > 126)
        || !credentials.some(row => row.scopes.includes('read') && tokenMatches(token, row.digest))) return refused();
      const unchanged = async (): Promise<void> => {
        if (!configBytes.equals(await reader.privateFile(configFile, 1024 * 1024))
          || !credentialBytes.equals(await reader.privateFile(credentialsFile, 65536))
          || !tokenBytes.equals(await reader.privateFile(tokenFile, 65536))) refused();
      };
      await recheckOwnerAndListener();
      const observedBuild = build(await reader.get(port, '/api/v2/build', token), expected);
      await recheckOwnerAndListener();
      await unchanged();
      await recheckOwnerAndListener();
      const observedHealth = health(await reader.get(port, '/api/runtime/v1/health'));
      await recheckOwnerAndListener();
      await unchanged();
      return {build: observedBuild, health: observedHealth, configSha256: hash(configBytes), credentialsSha256: hash(credentialBytes)};
    } catch { return refused(); }
  };
}

export const observeInstalledUpgradeHttp = createUpgradeHttpObserver({
  privateFile: readPrivateFile, config: readRuntimeConfig, get: installedGet,
});
