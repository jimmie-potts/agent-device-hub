// Inventory only: live databases and their sidecars are never opened here.
import {createHash} from 'node:crypto';
import type {Stats} from 'node:fs';
import {lstat, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {checkStateDirectory, readPrivateFile, readRuntimeConfig} from './state.js';

const durable = ['core', 'playback', 'nanoleaf', 'pixoo', 'tidbyt', 'lifx'];
const configuredNames = [...durable, 'codex-desktop', 'wispr'];
const rootNames = ['modules', 'bunny-launch.sock', 'spans.ndjson', 'spans.previous.ndjson'];
const refused = (): never => { throw new Error('runtime-upgrade-inputs-refused'); };
const hash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

function privateEntry(info: Stats): boolean {
  return info.uid === process.getuid?.() && !info.isSymbolicLink() && (info.mode & 0o077) === 0
    && (info.isDirectory() || (info.isFile() && info.nlink === 1));
}

async function directory(path: string): Promise<void> {
  await checkStateDirectory(path);
  const info = await lstat(path);
  if (!info.isDirectory() || !privateEntry(info)) return refused();
}

export async function inspectUpgradeState(state: string, configFile: string): Promise<{
  configSha256: string; configured: string[]; durableOwners: string[];
}> {
  try {
    const bytes = await readPrivateFile(configFile, 1024 * 1024);
    const config = await readRuntimeConfig(configFile);
    if (!bytes.equals(await readPrivateFile(configFile, 1024 * 1024))) return refused();
    const configured = Object.keys(config.modules).sort();
    if (configured.some(name => !configuredNames.includes(name))) return refused();
    await directory(state);
    const names = await readdir(state);
    if (names.length > rootNames.length || names.some(name => !rootNames.includes(name)) || !names.includes('modules')) return refused();
    for (const name of names.filter(name => name !== 'modules')) {
      const info = await lstat(join(state, name));
      if (name === 'bunny-launch.sock') {
        if (!info.isSocket() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) return refused();
      } else if (!info.isFile() || !privateEntry(info)) return refused();
    }
    const modules = join(state, 'modules');
    await directory(modules);
    const entries = await readdir(modules);
    if (entries.length > 128 || !entries.includes('core.sqlite')) return refused();
    const retained = new Set<string>();
    for (const name of entries) {
      const match = /^(core|playback|nanoleaf|pixoo|tidbyt|lifx)(?:\.sqlite(?:-wal|-shm|-journal)?|\.sqlite-owner)?$/.exec(name);
      if (match === null || match[1] === undefined) return refused();
      const owner = match[1];
      // Only the core uses the separate lease database in the current runtime.
      if (name.endsWith('-owner') && owner !== 'core') return refused();
      const info = await lstat(join(modules, name));
      if (!privateEntry(info) || (name === owner ? !info.isDirectory() : !info.isFile())) return refused();
      retained.add(owner);
    }
    return {configSha256: hash(bytes), configured,
      durableOwners: [...new Set(['core', ...configured.filter(name => durable.includes(name)), ...retained])].sort()};
  } catch {
    return refused();
  }
}

/** The bin supplies the shared receipt validator; JSON never supplies it. */
export async function inspectUpgradeReceipts(path: string, installationId: string,
  validate: (value: unknown) => boolean): Promise<{name: string; sha256: string}[]> {
  try {
    await directory(path);
    const names = (await readdir(path)).sort();
    if (names.length > 4096) return refused();
    const settled = new Set(['succeeded', 'refused', 'failed-before-switch', 'failed-rolled-back']);
    const result: {name: string; sha256: string}[] = [];
    for (const name of names) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\.json$/.test(name)) return refused();
      const bytes = await readPrivateFile(join(path, name), 256 * 1024);
      const value: unknown = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
      if (!validate(value) || value === null || typeof value !== 'object' || Array.isArray(value)) return refused();
      const receipt = value as Record<string, unknown>;
      if (receipt.installationId !== installationId || receipt.runtime !== 'hub' || typeof receipt.operationId !== 'string'
        || receipt.operationId + '.json' !== name || typeof receipt.outcome !== 'string'
        || !settled.has(receipt.outcome)) return refused();
      result.push({name, sha256: hash(bytes)});
    }
    if (!isDeepStrictEqual(names, (await readdir(path)).sort())) return refused();
    for (const entry of result) {
      if (hash(await readPrivateFile(join(path, entry.name), 256 * 1024)) !== entry.sha256) return refused();
    }
    if (!isDeepStrictEqual(names, (await readdir(path)).sort())) return refused();
    return result;
  } catch {
    return refused();
  }
}
