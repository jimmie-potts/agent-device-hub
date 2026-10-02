const safe = value => Number.isSafeInteger(value) && value >= 0;
const fail = () => { throw new Error('Storage measurement missing or invalid'); };

/** Fixed read-only probe; runtime must qualify these utilities in the pinned image. */
export const STORAGE_PROBE_COMMAND = Object.freeze(['/usr/bin/timeout', '--signal=KILL', '2s', '/bin/sh', '-ec',
  'export LC_ALL=C; /usr/bin/du -s -B1 /data; /usr/bin/du -sb /data; /usr/bin/df -P -B1 /data /']);

/** Non-TTY Docker exec multiplexing. Stderr is an error and is never returned or logged. */
export function decodeStorageExec(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > 65536) fail();
  const chunks = []; let offset = 0, bytes = 0;
  while (offset < buffer.length) {
    if (buffer.length - offset < 8 || buffer[offset] !== 1 ||
      buffer[offset + 1] || buffer[offset + 2] || buffer[offset + 3]) fail();
    const size = buffer.readUInt32BE(offset + 4); offset += 8;
    bytes += size;
    if (bytes > 16384 || size > buffer.length - offset) fail();
    chunks.push(buffer.subarray(offset, offset + size)); offset += size;
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Docker log-driver must be none. hostRunBytes must include owned evidence and synthetic app state. */
export function storageSnapshot({ stdout, writableLayerBytes, hostRunBytes }) {
  if (typeof stdout !== 'string' || Buffer.byteLength(stdout) > 16384 || !safe(writableLayerBytes) || !safe(hostRunBytes)) fail();
  const lines = stdout.trimEnd().split('\n');
  if (lines.length !== 5 || !['Filesystem 1B-blocks Used Available Use% Mounted on',
    'Filesystem 1-blocks Used Available Capacity Mounted on'].includes(lines[2].trim().split(/\s+/).join(' '))) fail();
  const volume = lines.slice(0, 2).map(line => {
    const match = /^([0-9]+)\s+\/data$/.exec(line);
    if (!match) fail();
    const value = Number(match[1]); if (!safe(value)) fail(); return value;
  });
  const available = lines.slice(3).map((line, index) => {
    const cells = line.trim().split(/\s+/);
    if (cells.length !== 6 || cells[5] !== (index === 0 ? '/data' : '/') ||
      !cells.slice(1, 4).every(value => /^[0-9]+$/.test(value)) || !/^[0-9]+%$/.test(cells[4])) fail();
    const [total, used, free] = cells.slice(1, 4).map(Number);
    if (![total, used, free].every(safe) || total === 0 || used > total || free > total || used + free > total) fail();
    return free;
  });
  const runDataBytes = Math.max(...volume) + writableLayerBytes + hostRunBytes;
  if (!safe(runDataBytes)) fail();
  return { source: 'owned-volume-du-and-df', volumeAllocatedBytes: volume[0], volumeApparentBytes: volume[1],
    writableLayerBytes, hostRunBytes, runDataBytes, minimumAvailableBytes: Math.min(...available) };
}
