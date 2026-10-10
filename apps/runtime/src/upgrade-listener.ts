// Read only the already observed owner's TCP namespace and socket descriptors.
import {lstat, readdir, readlink} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';

export interface UpgradeListenerReader {
  owner(pid: number): Promise<number>;
  tcp(pid: number, version: 'tcp' | 'tcp6'): Promise<Buffer>;
  sockets(pid: number): Promise<string[]>;
}
type Binding = {port: number; inode: string; uid: number};
const refused = (): never => { throw new Error('runtime-upgrade-listener-refused'); };

function listeners(bytes: Buffer, port: number, version: 'tcp' | 'tcp6'): {address: string; inode: string; uid: number}[] {
  if (bytes.length > 1024 * 1024) return refused();
  const lines = new TextDecoder('utf-8', {fatal: true}).decode(bytes).trim().split('\n');
  if (lines.length > 16384 || lines[0]?.includes('local_address') !== true || lines[0]?.includes('inode') !== true) return refused();
  const result: {address: string; inode: string; uid: number}[] = [];
  for (const line of lines.slice(1)) {
    const fields = line.trim().split(/\s+/);
    const local = fields[1]?.split(':');
    const address = local?.[0];
    const hexPort = local?.[1];
    if (fields.length < 10 || local?.length !== 2 || address === undefined
      || !(version === 'tcp' ? /^[0-9A-F]{8}$/ : /^[0-9A-F]{32}$/).test(address)
      || hexPort === undefined || !/^[0-9A-F]{4}$/.test(hexPort) || !/^[0-9A-F]{2}$/.test(fields[3] ?? '')) return refused();
    if (fields[3] !== '0A' || Number.parseInt(hexPort, 16) !== port) continue;
    const inode = fields[9];
    const uid = fields[7];
    if (inode === undefined || !/^[1-9]\d*$/.test(inode) || uid === undefined || !/^\d+$/.test(uid)
      || !Number.isSafeInteger(Number(uid))) return refused();
    result.push({address, inode, uid: Number(uid)});
  }
  return result;
}

async function binding(reader: UpgradeListenerReader, pid: number, port: number): Promise<Binding> {
  const uid = process.getuid?.();
  if (uid === undefined || await reader.owner(pid) !== uid) return refused();
  const rows = [...listeners(await reader.tcp(pid, 'tcp'), port, 'tcp'),
    ...listeners(await reader.tcp(pid, 'tcp6'), port, 'tcp6')];
  const socket = rows[0];
  if (rows.length !== 1 || socket === undefined || socket.address !== '0100007F' || socket.uid !== uid) return refused();
  const descriptors = await reader.sockets(pid);
  if (descriptors.length > 4096 || !descriptors.includes(`socket:[${socket.inode}]`)) return refused();
  return {port, inode: socket.inode, uid};
}

/** Internal seam only; the bin always supplies the fixed installed reader. */
export function createUpgradeListenerObserver(reader: UpgradeListenerReader): (pid: number, port: number) => Promise<Binding> {
  return async (pid, port) => {
    try {
      if (!Number.isSafeInteger(pid) || pid < 1 || pid > 2147483647 || !Number.isSafeInteger(port) || port < 1 || port > 65535) return refused();
      const before = await binding(reader, pid, port);
      if (!isDeepStrictEqual(before, await binding(reader, pid, port))) return refused();
      return before;
    } catch {
      return refused();
    }
  };
}

export function createInstalledUpgradeListenerObserver(readRegular: (path: string, maximum: number) => Promise<Buffer>):
  (pid: number, port: number) => Promise<Binding> {
  return createUpgradeListenerObserver({
    owner: async pid => {
      const info = await lstat(`/proc/${pid}`);
      if (!info.isDirectory()) return refused();
      return info.uid;
    },
    tcp: (pid, version) => readRegular(`/proc/${pid}/net/${version}`, 1024 * 1024),
    sockets: async pid => {
      const directory = `/proc/${pid}/fd`;
      const names = await readdir(directory);
      if (names.length > 4096 || names.some(name => !/^\d+$/.test(name))) return refused();
      const links: string[] = [];
      for (const name of names) {
        try { links.push(await readlink(`${directory}/${name}`)); }
        catch (error) {
          // An unrelated descriptor can close while the listener remains open.
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
        }
      }
      return links;
    },
  });
}
