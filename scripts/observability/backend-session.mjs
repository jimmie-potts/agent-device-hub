import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { readPreparedBackend } from './backend-files.mjs';
import { readAllocation } from './allocation-readback.mjs';
import { readHostRoots } from './host-roots.mjs';
import { assertOwnedBackend, assertBackendIsolation } from './backend-plan.mjs';
import { assertOwnedNetwork, assertOwnedVolume } from './backend-resources.mjs';
import { createMonitorJournal, readMonitorJournal } from './monitor-journal.mjs';
import { createResourceCallbacks } from './resource-callbacks.mjs';
import { startResourceWatchdog } from './resource-watchdog.mjs';
import { probeBackendHealth } from './backend-health.mjs';
import { inspectHost } from './preflight.mjs';

async function save(directory, name, value) {
  const text = JSON.stringify(value, null, 2) + '\n';
  if (Buffer.byteLength(text) > 16384) throw new Error('Session evidence limit');
  const file = await open(join(directory, name), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
  const parent = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY);
  try { await parent.sync(); } finally { await parent.close(); }
}

/** One session per fresh allocation. Action must honor cancellation and retain its own bounded evidence. */
export async function withReadyBackend({ directory, backend, monitorBackend, action = async () => {},
  signal, readinessTimeoutMs = 120000, actionTimeoutMs = 300000, hostProbe = inspectHost, healthProbe = probeBackendHealth }) {
  if (!monitorBackend || monitorBackend === backend || typeof action !== 'function' ||
    !Number.isInteger(readinessTimeoutMs) || readinessTimeoutMs < 1 || readinessTimeoutMs > 120000 ||
    !Number.isInteger(actionTimeoutMs) || actionTimeoutMs < 1 || actionTimeoutMs > 900000) throw new Error('Session configuration invalid');
  if (signal?.aborted) throw new Error('Session aborted');
  const { plan } = await readPreparedBackend(directory), allocation = await readAllocation(directory);
  if (allocation.status !== 'allocated-stopped') throw new Error('Completed allocation required');
  const { receipt } = allocation, roots = await readHostRoots(directory);
  if ((await hostProbe(directory)).ready !== true) throw new Error('Host capacity unavailable');
  async function verify(running) {
    const options = { timeoutMs: 5000, signal };
    assertOwnedNetwork(await backend.inspect('network', receipt.network.networkId, options), plan, receipt.network, receipt.containerId);
    assertOwnedVolume(await backend.inspect('volume', plan.volumeName, options), plan, receipt.volume);
    const container = await backend.inspect('container', receipt.containerId, options);
    assertOwnedBackend(container, plan, receipt); assertBackendIsolation(container, plan);
    if (container.State?.Running !== running) throw new Error('Backend running state mismatch');
  }
  await verify(false);
  const callbacks = createResourceCallbacks({ plan, receipt, backend: monitorBackend, hostProbe, hostRoots: Object.values(roots.roots) });
  await save(directory, 'startup-intent.json', { version: '1.0', runId: plan.runId, ownerToken: plan.ownerToken,
    action: 'start', containerId: receipt.containerId, imageId: receipt.imageId });
  let journal, watchdog, monitor = null, ready = false, actionComplete = false, failure = 'start-unconfirmed',
    stopConfirmed = false, health = null, monitorSaved = false;
  const control = new AbortController(), activeSignal = signal ? AbortSignal.any([signal, control.signal]) : control.signal;
  try {
    journal = await createMonitorJournal(directory, receipt, 'session');
    await backend.start(receipt.containerId, { timeoutMs: 5000, signal: activeSignal });
    await save(directory, 'startup-returned.json', { containerId: receipt.containerId, returned: true });
    await verify(true);
    watchdog = startResourceWatchdog({ ...callbacks, record: journal.record });
    const monitorEnded = watchdog.done.then(result => { monitor = result; control.abort(); throw new Error('Resource monitor ended'); });
    // Attach immediately: the monitor can stop before any later Promise.race is entered.
    monitorEnded.catch(() => {});
    failure = 'resource-readiness-failed';
    if (!await watchdog.ready) throw new Error('Initial resource sample failed');
    failure = 'readiness-failed';
    const deadline = performance.now() + readinessTimeoutMs;
    while (performance.now() < deadline && !activeSignal.aborted) {
      health = await Promise.race([healthProbe(plan, { signal: activeSignal,
        timeoutMs: Math.max(1, Math.min(2000, Math.floor(deadline - performance.now()))) }), monitorEnded]);
      if (health.ready) break;
      await Promise.race([delay(Math.max(1, Math.min(250, deadline - performance.now())), undefined, { signal: activeSignal }), monitorEnded]);
    }
    if (!health?.ready || activeSignal.aborted) throw new Error('Required services unavailable');
    await verify(true);
    await save(directory, 'startup-ready.json', { containerId: receipt.containerId, health, qualification: 'unexecuted' });
    ready = true; failure = 'action-failed';
    const actionControl = new AbortController(), actionSignal = AbortSignal.any([activeSignal, actionControl.signal]);
    let rejectAbort;
    const aborted = new Promise((_, reject) => { rejectAbort = () => reject(new Error('Action aborted')); });
    actionSignal.addEventListener('abort', rejectAbort, { once: true });
    const timer = setTimeout(() => actionControl.abort(), actionTimeoutMs);
    try {
      if (actionSignal.aborted) throw new Error('Action aborted');
      await Promise.race([Promise.resolve().then(() => action({ plan, receipt, roots, signal: actionSignal })), aborted, monitorEnded]);
      actionComplete = true; failure = null;
    } finally { clearTimeout(timer); actionControl.abort(); actionSignal.removeEventListener('abort', rejectAbort); }
  } catch { /* Static stage identifies the failure; never retain arbitrary exception text. */ }
  finally {
    if (watchdog) monitor = await watchdog.finish();
    if (journal) {
      try {
        if (monitor) { await journal.finish(monitor); await journal.close();
          const saved = await readMonitorJournal(journal.path, plan, receipt);
          monitorSaved = saved.result !== null && saved.result.evidenceSaved;
        }
      } catch { failure = 'monitor-evidence-failed'; }
      finally { await journal.close(); }
    }
    if (monitor?.status === 'failed') {
      failure = 'resource-monitor-failed'; stopConfirmed = monitor.stopConfirmed;
    } else {
      try {
        await save(directory, 'shutdown-intent.json', { containerId: receipt.containerId, action: 'stop' });
        stopConfirmed = (await callbacks.stopOwned({ timeoutMs: 29000 })).confirmed;
      } catch { /* Never retry an ambiguous stop. */ }
    }
    control.abort();
  }
  if (!stopConfirmed) failure = failure ?? 'stop-unconfirmed';
  if (monitor && !monitorSaved) failure = failure ?? 'monitor-evidence-failed';
  const result = { version: '1.0', runId: plan.runId, stage: 'backend-session', qualification: 'unexecuted',
    ready, actionComplete, failure, stopConfirmed, health, monitor, monitorSaved };
  await save(directory, 'startup-result.json', result);
  return result;
}
