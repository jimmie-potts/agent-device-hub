import { performance } from 'node:perf_hooks';
import { assertOwnedBackend } from './backend-plan.mjs';
import { assertOwnedNetwork, assertOwnedVolume } from './backend-resources.mjs';

/**
 * Adapter inspect returns null ONLY for confirmed absence, never for command failure.
 * Adapter effects must honor AbortSignal and never retry. record must durably append
 * before resolving. Receipts come from verified run files, not user-supplied names.
 */
export async function cleanupBackend({ plan, receipt, backend, record, evidenceSaved, timeoutMs = 30000 }) {
  if (evidenceSaved !== true || typeof record !== 'function' || !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 || timeoutMs > plan.limits.teardownMs || !receipt?.network || !receipt?.volume) {
    throw new Error('Backend cleanup prerequisites missing');
  }
  const started = performance.now(), controller = new AbortController();
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('Backend cleanup deadline exceeded; pending effect requires readback'));
      controller.abort();
    }, timeoutMs);
  });
  const within = action => {
    if (controller.signal.aborted || performance.now() - started >= timeoutMs) {
      throw new Error('Backend cleanup deadline exceeded; pending effect requires readback');
    }
    return Promise.race([Promise.resolve().then(action), expired]);
  };
  const options = () => ({ signal: controller.signal, timeoutMs: Math.max(1, Math.floor(timeoutMs - (performance.now() - started))) });
  const ids = { container: receipt.containerId, network: receipt.network.networkId, volume: plan.volumeName };
  async function inspect(kind, attached = false) {
    const value = await within(() => backend.inspect(kind, ids[kind], options()));
    if (value === null) return null;
    if (kind === 'container') assertOwnedBackend(value, plan, receipt);
    else if (kind === 'network') assertOwnedNetwork(value, plan, receipt.network, attached ? receipt.containerId : undefined);
    else assertOwnedVolume(value, plan, receipt.volume);
    return value;
  }
  async function effect(action, kind) {
    await within(() => record({ phase: 'intent', action, kind, id: ids[kind] }));
    await within(() => action === 'stop' ? backend.stop(ids[kind], options()) : backend.remove(kind, ids[kind], options()));
    await within(() => record({ phase: 'returned', action, kind, id: ids[kind] }));
  }
  try {
    // Validate the whole retained resource set before the first mutation.
    await inspect('container');
    await inspect('network', true);
    await inspect('volume');
    const container = await inspect('container');
    if (container) {
      if (typeof container.State?.Running !== 'boolean') throw new Error('Backend running state unavailable');
      if (container.State.Running) await effect('stop', 'container');
      const stopped = await inspect('container');
      if (stopped) {
        if (stopped.State?.Running !== false) throw new Error('Backend did not stop');
        await effect('remove', 'container');
      }
      if (await inspect('container')) throw new Error('Backend container removal not verified');
    }
    for (const kind of ['network', 'volume']) {
      if (await inspect(kind)) await effect('remove', kind);
      if (await inspect(kind)) throw new Error(`Backend ${kind} removal not verified`);
    }
    const result = { phase: 'complete', complete: true, elapsedMs: performance.now() - started };
    await within(() => record(result));
    return result;
  } finally { clearTimeout(timer); controller.abort(); }
}
