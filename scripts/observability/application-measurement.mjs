import { open, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const invalid = () => { throw new Error('Application measurement missing or invalid'); };
const integer = text => {
  if (typeof text !== 'string' || !/^(0|[1-9][0-9]*)$/.test(text)) invalid();
  const value = Number(text); if (!Number.isSafeInteger(value)) invalid(); return value;
};
const nanoseconds = text => {
  if (typeof text !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(text)) invalid();
  return BigInt(text);
};
let ticksPerSecond;
function clockTicks() {
  if (ticksPerSecond === undefined) {
    ticksPerSecond = integer(execFileSync('/usr/bin/getconf', ['CLK_TCK'], { encoding: 'utf8', timeout: 1000, maxBuffer: 128 }).trim());
    if (ticksPerSecond < 1) invalid();
  }
  return ticksPerSecond;
}

/** Linux stat field offsets follow proc_pid_stat(5); comm is never retained. */
export function parseProcessStat(text) {
  if (typeof text !== 'string' || text.length > 8192) invalid();
  const match = /^([1-9][0-9]*) \([\s\S]*\) (.*)\n?$/.exec(text);
  if (!match) invalid();
  const fields = match[2].trim().split(/\s+/);
  if (fields.length < 50 || !['R','S','D','I'].includes(fields[0])) invalid();
  return { pid: integer(match[1]), parentPid: integer(fields[1]), groupPid: integer(fields[2]),
    startTicks: String(integer(fields[19])), userTicks: integer(fields[11]), systemTicks: integer(fields[12]),
    childTicks: integer(fields[13]) + integer(fields[14]), threads: integer(fields[17]) };
}
async function smallRead(path, signal) {
  if (signal?.aborted) invalid();
  const file = await open(path, 'r');
  try {
    const bytes = Buffer.alloc(8193); const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 8192 || signal?.aborted) invalid();
    return bytes.subarray(0, bytesRead).toString('utf8');
  } finally { await file.close(); }
}

/** Caller owns this detached child. Hub, fake controller and telemetry execute
 * inside this one process; native/JS threads are already included in its totals.
 * Any child process makes this fixed inventory unqualified, never silently omitted. */
export async function applicationSnapshot(identity, { signal } = {}) {
  if (process.platform !== 'linux' || !Number.isSafeInteger(identity?.pid) || identity.pid < 1 ||
    !Number.isSafeInteger(identity.parentPid) || identity.parentPid < 1 || signal?.aborted) invalid();
  const hz = clockTicks(), startedNs = String(process.hrtime.bigint()), base = `/proc/${identity.pid}`;
  const before = parseProcessStat(await smallRead(base + '/stat', signal));
  function check(value) {
    if (value.pid !== identity.pid || value.parentPid !== identity.parentPid || value.groupPid !== identity.pid ||
      (identity.startTicks !== undefined && value.startTicks !== identity.startTicks) || value.childTicks !== 0 ||
      value.threads < 1 || value.threads > 128) invalid();
  }
  check(before);
  const tids = await readdir(base + '/task');
  if (!tids.length || tids.length > 128 || tids.some(id => !/^[1-9][0-9]*$/.test(id))) invalid();
  for (const tid of tids) {
    // proc_tid_children is not a general process-tree census. This fixed workload
    // must never fork; nonempty or unreadable observations invalidate it.
    if ((await smallRead(base + '/task/' + tid + '/children', signal)).trim() !== '') invalid();
  }
  const memory = await smallRead(base + '/smaps_rollup', signal);
  const rss = /^Rss:\s+([0-9]+) kB$/m.exec(memory);
  if (!rss) invalid();
  const rssBytes = integer(rss[1]) * 1024;
  if (!Number.isSafeInteger(rssBytes)) invalid();
  const after = parseProcessStat(await smallRead(base + '/stat', signal)); check(after);
  if (after.startTicks !== before.startTicks || after.userTicks < before.userTicks || after.systemTicks < before.systemTicks) invalid();
  const finishedNs = String(process.hrtime.bigint());
  return { source: 'linux-proc-stat-smaps-rollup', pid: after.pid, parentPid: after.parentPid,
    startTicks: after.startTicks, ticksPerSecond: hz, userTicks: after.userTicks, systemTicks: after.systemTicks,
    processCount: 1, threads: after.threads, rssBytes, startedNs, finishedNs, cpuObservedNs: finishedNs };
}

/** Sampling coverage is retained separately; a valid summary alone is no pass. */
export function applicationSummary(samples) {
  if (!Array.isArray(samples) || samples.length < 2 || samples.length > 10000) invalid();
  const first = samples[0]; let previous, peakRssBytes = 0, maximumGapNs = 0n;
  for (const sample of samples) {
    if (sample.source !== 'linux-proc-stat-smaps-rollup' || sample.processCount !== 1 ||
      sample.pid !== first.pid || sample.parentPid !== first.parentPid || sample.startTicks !== first.startTicks || sample.ticksPerSecond !== first.ticksPerSecond ||
      !Number.isSafeInteger(sample.ticksPerSecond) || sample.ticksPerSecond < 1 ||
      ![sample.rssBytes,sample.userTicks,sample.systemTicks].every(n => Number.isSafeInteger(n) && n >= 0)) invalid();
    const observed = nanoseconds(sample.cpuObservedNs), start = nanoseconds(sample.startedNs), end = nanoseconds(sample.finishedNs);
    if (start > observed || observed > end) invalid();
    if (previous) {
      const gap = observed - BigInt(previous.cpuObservedNs);
      if (gap <= 0n || sample.userTicks < previous.userTicks || sample.systemTicks < previous.systemTicks) invalid();
      if (gap > maximumGapNs) maximumGapNs = gap;
    }
    peakRssBytes = Math.max(peakRssBytes, sample.rssBytes); previous = sample;
  }
  const last = samples.at(-1), elapsed = nanoseconds(last.cpuObservedNs) - nanoseconds(first.cpuObservedNs);
  if (elapsed <= 0n || elapsed > BigInt(Number.MAX_SAFE_INTEGER)) invalid();
  const elapsedSeconds = Number(elapsed) / 1e9;
  return { sampleCount: samples.length, meanCpuCores: ((last.userTicks - first.userTicks) + (last.systemTicks - first.systemTicks)) / first.ticksPerSecond / elapsedSeconds,
    peakRssBytes, maximumGapNs: String(maximumGapNs), processCount: 1 };
}
