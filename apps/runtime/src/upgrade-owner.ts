// Read-only observations of the one established runtime owner. No service
// controls, runtime launch, device access or process discovery occur here.
import {execFile} from 'node:child_process';
import {lstat, readlink} from 'node:fs/promises';
import {isAbsolute, resolve} from 'node:path';
import {isDeepStrictEqual, promisify} from 'node:util';
import {parseArguments, type ProcessOptions} from './process.js';

const service = 'bunny-runtime.service';
const properties = ['LoadState', 'ActiveState', 'SubState', 'MainPID', 'ExecMainStartTimestampMonotonic',
  'FragmentPath', 'DropInPaths', 'ControlGroup'];
const run = promisify(execFile);
const refused = (): never => { throw new Error('runtime-upgrade-owner-refused'); };
const absolute = (value: string): boolean => isAbsolute(value) && resolve(value) === value && value.length <= 4096
  && !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);

/** Internal test seam. The installed CLI always uses the fixed production reader. */
export interface UpgradeOwnerReader {
  show(): Promise<string>;
  owner(pid: number): Promise<number>;
  read(pid: number, name: 'stat' | 'cmdline'): Promise<Buffer>;
  link(pid: number, name: 'exe' | 'cwd'): Promise<string>;
}

type BoundedReader = (path: string, maximum: number) => Promise<Buffer>;

// The bin wires the existing pure install-file reader here. Its path is owned
// by the bin, so compiling this source into dist does not relocate that import.
const production = (readRegular: BoundedReader): UpgradeOwnerReader => ({
  show: async () => (await run('/usr/bin/systemctl', ['--user', '--no-pager', 'show', service,
    ...properties.map(name => `--property=${name}`)], {
    encoding: 'utf8', timeout: 3000, maxBuffer: 64 * 1024, shell: false,
    env: {...process.env, SYSTEMD_PAGER: 'cat'},
  })).stdout,
  owner: async pid => {
    const info = await lstat(`/proc/${pid}`);
    if (!info.isDirectory()) return refused();
    return info.uid;
  },
  read: (pid, name) => readRegular(`/proc/${pid}/${name}`, name === 'stat' ? 8192 : 64 * 1024),
  link: (pid, name) => readlink(`/proc/${pid}/${name}`),
});

function readService(text: string): {
  pid: number; startMonotonic: string; units: string[]; controlGroup: string;
} {
  if (Buffer.byteLength(text) > 64 * 1024) return refused();
  const fields: Record<string, string> = {};
  for (const line of text.trimEnd().split('\n')) {
    const at = line.indexOf('=');
    const key = line.slice(0, at);
    if (at < 1 || !properties.includes(key) || Object.hasOwn(fields, key)) return refused();
    fields[key] = line.slice(at + 1);
  }
  if (!isDeepStrictEqual(Object.keys(fields).sort(), [...properties].sort())
    || fields.LoadState !== 'loaded' || fields.ActiveState !== 'active' || fields.SubState !== 'running'
    || !/^[1-9]\d*$/.test(fields.MainPID ?? '') || !/^[1-9]\d*$/.test(fields.ExecMainStartTimestampMonotonic ?? '')
    || !absolute(fields.FragmentPath ?? '') || !absolute(fields.ControlGroup ?? '')) return refused();
  const pid = Number(fields.MainPID);
  if (!Number.isSafeInteger(pid) || pid > 2147483647) return refused();
  const fragment = fields.FragmentPath ?? '';
  const startMonotonic = fields.ExecMainStartTimestampMonotonic ?? '';
  const controlGroup = fields.ControlGroup ?? '';
  const dropIns = fields.DropInPaths === '' ? [] : (fields.DropInPaths ?? '').split(' ');
  if (dropIns.length > 16 || !dropIns.every(absolute)) return refused();
  const units = [fragment, ...dropIns].sort();
  if (new Set(units).size !== units.length) return refused();
  return {pid, startMonotonic, units, controlGroup};
}

async function readProcess(reader: UpgradeOwnerReader, pid: number): Promise<{
  startTicks: string; argv: string[]; executable: string; cwd: string;
}> {
  const uid = process.getuid?.();
  if (uid === undefined || await reader.owner(pid) !== uid) return refused();
  const statBytes = await reader.read(pid, 'stat');
  if (statBytes.length > 8192) return refused();
  const stat = new TextDecoder('utf-8', {fatal: true}).decode(statBytes);
  const at = stat.lastIndexOf(')');
  if (!stat.startsWith(`${pid} (`) || at < 0 || stat[at + 1] !== ' ') return refused();
  const fields = stat.slice(at + 2).trim().split(/\s+/);
  const startTicks = fields[19]; // /proc stat field 22; fields[0] is field 3.
  if (startTicks === undefined || !/^[1-9]\d*$/.test(startTicks)) return refused();
  const bytes = await reader.read(pid, 'cmdline');
  if (bytes.length === 0 || bytes.length > 64 * 1024 || bytes.at(-1) !== 0) return refused();
  const argv = new TextDecoder('utf-8', {fatal: true}).decode(bytes).slice(0, -1).split('\0');
  if (argv.length < 2 || argv.length > 32 || argv.some(value => value.length === 0)) return refused();
  const executable = await reader.link(pid, 'exe');
  const cwd = await reader.link(pid, 'cwd');
  if (!absolute(executable) || !absolute(cwd)) return refused();
  return {startTicks, argv, executable, cwd};
}

export type UpgradeOwner = {
  service: string; pid: number; startMonotonic: string; startTicks: string; units: string[]; controlGroup: string;
  executable: string; cwd: string; entry: string; argv: string[]; options: ProcessOptions;
};

export function createUpgradeOwnerObserver(reader: UpgradeOwnerReader): () => Promise<UpgradeOwner> {
  return async () => {
    try {
      const before = readService(await reader.show());
      const processBefore = await readProcess(reader, before.pid);
      const options = parseArguments(processBefore.argv.slice(2));
      const script = processBefore.argv[1];
      if (script === undefined) return refused();
      const entry = resolve(processBefore.cwd, script);
      if (!absolute(entry)) return refused();
      const after = readService(await reader.show());
      if (!isDeepStrictEqual(before, after) || !isDeepStrictEqual(processBefore, await readProcess(reader, after.pid))) return refused();
      return {service, ...before, ...processBefore, entry, options};
    } catch {
      // No argv, private path, systemctl output or underlying exception escapes.
      return refused();
    }
  };
}

export const createInstalledUpgradeOwnerObserver = (readRegular: BoundedReader): (() => Promise<UpgradeOwner>) =>
  createUpgradeOwnerObserver(production(readRegular));
