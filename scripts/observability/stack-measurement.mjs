const safe = value => Number.isSafeInteger(value) && value >= 0;
const ns = value => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value)) throw new Error('Stack monotonic timestamp invalid');
  return BigInt(value);
};
const fail = () => { throw new Error('Stack measurement missing or invalid'); };

/** Process RSS is from ps RSS (KiB); cgroup memory usage is a separate hard-limit observation. */
export function stackSnapshot({ stats, top, inspect, cpuObservedNs, startedNs, finishedNs }, containerId) {
  const start = ns(startedNs), cpuTime = ns(cpuObservedNs), end = ns(finishedNs);
  if (!/^[a-f0-9]{64}$/.test(containerId ?? '') || stats?.id !== containerId || inspect?.Id !== containerId ||
    inspect.State?.Running !== true || typeof inspect.State.OOMKilled !== 'boolean' ||
    !safe(inspect.SizeRw) || !safe(stats.cpu_stats?.cpu_usage?.total_usage) ||
    !safe(stats.memory_stats?.usage) || stats.memory_stats?.limit !== 4294967296 ||
    start > cpuTime || cpuTime > end || end <= start ||
    !Array.isArray(top?.Titles) || top.Titles.join(',') !== 'PID,RSS' ||
    !Array.isArray(top.Processes) || top.Processes.length < 1 || top.Processes.length > 4096) fail();
  const seen = new Set(); let rssBytes = 0;
  const processes = top.Processes.map(row => {
    if (!Array.isArray(row) || row.length !== 2 || row.some(value => typeof value !== 'string' || !/^[0-9]+$/.test(value))) fail();
    const pid = Number(row[0]), bytes = Number(row[1]) * 1024;
    if (!Number.isSafeInteger(pid) || pid <= 0 || seen.has(pid) || !safe(bytes)) fail();
    seen.add(pid); rssBytes += bytes;
    if (!safe(rssBytes)) fail();
    return { pid, rssBytes: bytes };
  });
  return { source: 'docker-engine-v1.47-process-rss', containerId, startedNs, cpuObservedNs, finishedNs,
    sampleDurationNs: String(end - start), cpuTotalNs: stats.cpu_stats.cpu_usage.total_usage,
    rssBytes, processes, cgroupMemoryBytes: stats.memory_stats.usage, cgroupMemoryLimitBytes: stats.memory_stats.limit,
    writableLayerBytes: inspect.SizeRw, oomKilled: inspect.State.OOMKilled };
}

/** Summarize raw samples only; scheduler coverage and benchmark-boundary checks remain separate gates. */
export function stackSummary(samples) {
  if (!Array.isArray(samples) || samples.length < 2 || samples.length > 10000) fail();
  let previous = null, peakRssBytes = 0, peakCgroupMemoryBytes = 0, peakWritableLayerBytes = 0;
  let maximumGap = 0n, maximumDuration = 0n;
  for (const sample of samples) {
    const time = ns(sample.cpuObservedNs), start = ns(sample.startedNs), end = ns(sample.finishedNs);
    if (sample.source !== 'docker-engine-v1.47-process-rss' || sample.containerId !== samples[0].containerId ||
      !safe(sample.cpuTotalNs) || !safe(sample.rssBytes) || !safe(sample.cgroupMemoryBytes) ||
      !safe(sample.writableLayerBytes) || typeof sample.oomKilled !== 'boolean' ||
      start > time || time > end || end <= start) fail();
    if (previous) {
      const gap = time - ns(previous.cpuObservedNs);
      if (gap <= 0n || sample.cpuTotalNs < previous.cpuTotalNs) fail();
      if (gap > maximumGap) maximumGap = gap;
    }
    if (end - start > maximumDuration) maximumDuration = end - start;
    peakRssBytes = Math.max(peakRssBytes, sample.rssBytes);
    peakCgroupMemoryBytes = Math.max(peakCgroupMemoryBytes, sample.cgroupMemoryBytes);
    peakWritableLayerBytes = Math.max(peakWritableLayerBytes, sample.writableLayerBytes);
    previous = sample;
  }
  const first = samples[0], last = samples.at(-1), elapsed = ns(last.cpuObservedNs) - ns(first.cpuObservedNs);
  if (elapsed > BigInt(Number.MAX_SAFE_INTEGER)) fail();
  return { sampleCount: samples.length, meanCpuCores: (last.cpuTotalNs - first.cpuTotalNs) / Number(elapsed),
    peakRssBytes, peakCgroupMemoryBytes, peakWritableLayerBytes,
    maximumGapNs: String(maximumGap), maximumSampleDurationNs: String(maximumDuration),
    oomObserved: samples.some(sample => sample.oomKilled) };
}
