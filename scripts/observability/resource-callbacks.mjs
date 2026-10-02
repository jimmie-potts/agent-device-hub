import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { backendCreateRequests } from './backend-create.mjs';
import { assertOwnedBackend } from './backend-plan.mjs';
import { assertOwnedNetwork, assertOwnedVolume } from './backend-resources.mjs';
import { measureHostRunFiles } from './host-storage.mjs';
import { inspectHost } from './preflight.mjs';

const measured = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const minimum = values => values.every(value => measured(value) !== null) ? Math.min(...values) : null;
function budget(options, fallback) {
  const started = performance.now(), timeoutMs = options?.timeoutMs ?? fallback, signal = options?.signal;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new Error('Resource callback deadline invalid');
  return () => {
    if (signal?.aborted) throw new Error('Resource callback aborted');
    const remaining = Math.floor(timeoutMs - (performance.now() - started));
    if (remaining < 1) throw new Error('Resource callback deadline exceeded');
    return { signal, timeoutMs: remaining };
  };
}

/** Inputs must come from allocation/root readback. Does not establish ownership of supplied host roots. */
export function createResourceCallbacks({ plan: inputPlan, receipt: inputReceipt, backend, hostRoots: inputRoots, hostProbe = inspectHost }) {
  const plan = structuredClone(inputPlan), receipt = structuredClone(inputReceipt), hostRoots = structuredClone(inputRoots);
  backendCreateRequests(plan);
  if (!Array.isArray(hostRoots) || !hostRoots.some(root => root.path === dirname(plan.configDirectory))) {
    throw new Error('Backend host run root missing');
  }
  return {
    async sample(options = {}) {
      const remaining = budget(options, 5000);
      assertOwnedNetwork(await backend.inspect('network', receipt.network?.networkId, remaining()), plan, receipt.network, receipt.containerId);
      assertOwnedVolume(await backend.inspect('volume', plan.volumeName, remaining()), plan, receipt.volume);
      const time = remaining();
      const files = await measureHostRunFiles(hostRoots, { ...time, timeoutMs: Math.min(1000, time.timeoutMs) });
      remaining();
      const hosts = await Promise.all(hostRoots.map(root => hostProbe(root.path)));
      const stack = await backend.sampleStack(plan, receipt, remaining());
      const storage = await backend.sampleStorage(plan, receipt, { ...remaining(), hostRunBytes: files.hostRunBytes });
      remaining();
      return { runDataBytes: measured(storage.runDataBytes), cgroupMemoryBytes: measured(stack.cgroupMemoryBytes),
        hostAvailableMemoryBytes: minimum(hosts.map(host => host?.availableMemoryBytes)),
        minimumAvailableBytes: minimum([storage.minimumAvailableBytes, ...hosts.map(host => host?.availableDiskBytes)]),
        oomKilled: typeof storage.oomKilled === 'boolean' ? storage.oomKilled : null };
    },
    async stopOwned(options = {}) {
      const remaining = budget(options, 29000);
      let container = await backend.inspect('container', receipt.containerId, remaining());
      if (container === null) return { confirmed: true, state: 'absent' };
      assertOwnedBackend(container, plan, receipt);
      if (typeof container.State?.Running !== 'boolean') throw new Error('Backend running state unavailable');
      if (container.State.Running) await backend.stop(receipt.containerId, remaining());
      container = await backend.inspect('container', receipt.containerId, remaining());
      if (container === null) return { confirmed: true, state: 'absent' };
      assertOwnedBackend(container, plan, receipt);
      if (typeof container.State?.Running !== 'boolean') throw new Error('Backend running state unavailable');
      return { confirmed: container.State.Running === false, state: container.State.Running ? 'running' : 'stopped' };
    },
  };
}
