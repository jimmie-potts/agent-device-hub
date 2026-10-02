import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stackSnapshot, stackSummary } from '../stack-measurement.mjs';
const id = 'a'.repeat(64);
const sample = () => ({ stats: { id, cpu_stats: { cpu_usage: { total_usage: 1000000000 } },
  memory_stats: { usage: 100000000, limit: 4294967296 } },
  top: { Titles: ['PID', 'RSS'], Processes: [['12', '1024'], ['13', '2048']] },
  inspect: { Id: id, SizeRw: 4096, State: { Running: true, OOMKilled: false } },
  cpuObservedNs: '10000000000', startedNs: '9999000000', finishedNs: '10002000000' });

test('stack snapshot keeps cgroup CPU separate from summed per-process RSS and writable layer size', () => {
  const s = stackSnapshot(sample(), id);
  assert.equal(s.cpuTotalNs, 1000000000);
  assert.equal(s.rssBytes, 3 * 1024 ** 2);
  assert.equal(s.cgroupMemoryBytes, 100000000);
  assert.equal(s.writableLayerBytes, 4096);
  assert.deepEqual(s.processes, [{ pid: 12, rssBytes: 1024 ** 2 }, { pid: 13, rssBytes: 2 * 1024 ** 2 }]);
  assert.equal(s.sampleDurationNs, '3000000');
});

test('missing, unsafe and foreign metrics cannot masquerade as zero-valued observations', () => {
  for (const change of [s => { delete s.inspect.SizeRw; }, s => { s.stats.id = 'b'.repeat(64); },
    s => { delete s.stats.cpu_stats; }, s => { s.top.Titles = ['PID', 'VSZ']; },
    s => { s.top.Processes = []; }, s => { s.top.Processes.push(['12', '1024']); },
    s => { s.top.Processes[0][1] = '-1'; }, s => { s.top.Processes[0][1] = '9007199254740991'; },
    s => { s.inspect.State.Running = false; }, s => { s.cpuObservedNs = '0'; },
    s => { s.finishedNs = s.startedNs; }, s => { s.stats.memory_stats.limit = 0; }]) {
    const s = sample(); change(s); assert.throws(() => stackSnapshot(s, id));
  }
});

test('CPU uses counter delta and monotonic elapsed time; peak RSS retains every sampled process', () => {
  const first = stackSnapshot(sample(), id), next = sample();
  next.stats.cpu_stats.cpu_usage.total_usage += 500000000;
  next.cpuObservedNs = '11000000000'; next.startedNs = '10999000000'; next.finishedNs = '11002000000';
  next.top.Processes.push(['14', '512']);
  const last = stackSnapshot(next, id);
  const summary = stackSummary([first, last]);
  assert.equal(summary.meanCpuCores, 0.5);
  assert.equal(summary.peakRssBytes, 3584 * 1024);
  assert.equal(summary.maximumGapNs, '1000000000');
  assert.equal(summary.sampleCount, 2);
  assert.throws(() => stackSummary([first]));
  assert.throws(() => stackSummary([last, first]));
  assert.throws(() => stackSummary([first, { ...last, cpuTotalNs: 0 }]));
});
