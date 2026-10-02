import { mkdir, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { readPreparedBackend } from './backend-files.mjs';
import { inspectHost } from './preflight.mjs';
import { assertPinnedImage } from './backend-create.mjs';
import { assertOwnedBackend, assertBackendIsolation } from './backend-plan.mjs';
import { networkReceipt, volumeReceipt, assertOwnedNetwork, assertOwnedVolume } from './backend-resources.mjs';

async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function save(directory, name, value) {
  const text = JSON.stringify(value, null, 2) + '\n';
  if (Buffer.byteLength(text) > 16384) throw new Error('Allocation receipt limit exceeded');
  const handle = await open(join(directory, name + '.json'),
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
  await syncDirectory(directory);
}

/**
 * Allocate once, without starting the stack. Failures retain resources and every
 * completed record; a new call cannot repeat an interrupted creation attempt.
 * The caller owns recovery/readback and must not adopt resources by name alone.
 */
export async function allocateBackend({ directory, backend, signal, hostProbe = inspectHost }) {
  const { plan } = await readPreparedBackend(directory);
  async function checkPlan() {
    if (!isDeepStrictEqual((await readPreparedBackend(directory)).plan, plan)) throw new Error('Backend plan changed during allocation');
  }
  const evidence = join(directory, 'allocation');
  await mkdir(evidence, { mode: 0o700 });
  await syncDirectory(directory);
  function options() {
    if (signal?.aborted) throw new Error('Backend allocation aborted');
    return { signal, timeoutMs: 5000 };
  }
  options();
  const host = await hostProbe(directory);
  if (host?.ready !== true) throw new Error('Backend host capacity unavailable');
  const image = assertPinnedImage(await backend.inspectImage(options()), plan);
  await save(evidence, 'preflight', { version: '1.0', runId: plan.runId, ownerToken: plan.ownerToken,
    hostReady: true, availableMemoryBytes: host.availableMemoryBytes ?? null,
    availableDiskBytes: host.availableDiskBytes ?? null, ...image });
  for (const kind of ['network', 'volume', 'container']) {
    if (await backend.inspectPlanned(kind, plan, options()) !== null) throw new Error('Backend resource already exists');
  }
  const receipt = { version: '1.0', runId: plan.runId, ownerToken: plan.ownerToken,
    stage: 'allocated-stopped', qualification: 'unexecuted', ...image };
  for (const kind of ['network', 'volume', 'container']) {
    // Refresh source files and name absence immediately before recording the effect.
    await checkPlan();
    if (kind === 'container') {
      assertOwnedNetwork(await backend.inspect('network', receipt.network.networkId, options()), plan, receipt.network);
      assertOwnedVolume(await backend.inspect('volume', plan.volumeName, options()), plan, receipt.volume);
    }
    if (await backend.inspectPlanned(kind, plan, options()) !== null) throw new Error('Backend resource appeared before creation');
    await save(evidence, `${kind}-intent`, { action: 'create', kind, name: plan[kind + 'Name'],
      runId: plan.runId, ownerToken: plan.ownerToken });
    const result = await backend.create(kind, plan, options());
    const validId = kind === 'volume' ? result?.id === plan.volumeName
      : typeof result?.id === 'string' && /^[a-f0-9]{64}$/.test(result.id);
    if (!validId || !Number.isSafeInteger(result.warningCount) || result.warningCount < 0) {
      throw new Error('Backend creation response invalid; readback required');
    }
    await save(evidence, `${kind}-returned`, { id: result.id, warningCount: result.warningCount });
    if (result.warningCount !== 0) throw new Error('Backend creation warning; review required');
    const inspect = await backend.inspect(kind, result.id, options());
    if (kind === 'network') {
      receipt.network = networkReceipt(inspect, plan);
      if (receipt.network.networkId !== result.id) throw new Error('Backend network creation ID mismatch');
      await save(evidence, 'network-verified', receipt.network);
    } else if (kind === 'volume') {
      receipt.volume = volumeReceipt(inspect, plan);
      await save(evidence, 'volume-verified', receipt.volume);
    } else {
      receipt.containerId = result.id;
      assertOwnedBackend(inspect, plan, receipt);
      assertBackendIsolation(inspect, plan);
      if (inspect.State?.Running !== false) throw new Error('Backend unexpectedly running');
      await save(evidence, 'container-verified', { containerId: result.id, imageId: image.imageId, running: false });
    }
  }
  // Do not rely on the earlier checks after allocating dependent resources.
  assertOwnedNetwork(await backend.inspect('network', receipt.network.networkId, options()), plan, receipt.network, receipt.containerId);
  assertOwnedVolume(await backend.inspect('volume', plan.volumeName, options()), plan, receipt.volume);
  const container = await backend.inspect('container', receipt.containerId, options());
  assertOwnedBackend(container, plan, receipt); assertBackendIsolation(container, plan);
  if (container.State?.Running !== false) throw new Error('Backend unexpectedly running');
  await checkPlan();
  options();
  await save(evidence, 'receipt', receipt);
  return receipt;
}
