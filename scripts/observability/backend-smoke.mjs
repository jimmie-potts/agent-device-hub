import { prepareReleasedContract } from './released-contract.mjs';
import { performIngestion } from './ingestion-session.mjs';
import { performRecordedCommands,performCommandFaults } from './recorded-commands.mjs';
import { basename, join } from 'node:path';
import { prepareBackendDirectory } from './backend-files.mjs';
import { inspectHost, inspectDocker } from './preflight.mjs';
import { createDockerBackend } from './docker-backend.mjs';
import { allocateBackend } from './backend-allocation.mjs';
import { registerHostRoots } from './host-roots.mjs';
import { withReadyBackend } from './backend-session.mjs';

/** Fresh synthetic backend only; ingestion mode adds the released fixture. No image pull or live installation. */
async function runBackend({ directory, stateParent, endpoint, ports, signal }, ingestion) {
  if (typeof endpoint !== 'string' || !/^unix:\/\/\/[\w./-]+$/.test(endpoint)) throw new Error('Local Docker endpoint required');
  const env = { ...process.env, DOCKER_HOST: endpoint };
  delete env.DOCKER_CONTEXT; delete env.DOCKER_TLS_VERIFY; delete env.DOCKER_CERT_PATH;
  if (!(await inspectDocker(env)).ready) throw new Error('Docker preflight failed');
  const backend = await createDockerBackend({ endpoint, signal }); let monitorBackend;
  try {
    monitorBackend = await createDockerBackend({ endpoint, signal });
    await prepareBackendDirectory(directory, { runId: basename(directory), ports });
    if (!(await inspectHost(directory)).ready) throw new Error('Host preflight failed');
    const roots = await registerHostRoots(directory, stateParent);
    if (ingestion) await prepareReleasedContract(join(roots.roots.state.path, 'contract'));
    await allocateBackend({ directory, backend, signal });
    return await withReadyBackend({ directory, backend, monitorBackend, signal,
      ...(ingestion ? { action: async ({ plan, signal }) => {
        if(['delivery','command-faults'].includes(ingestion)) {
          const run=ingestion==='delivery'?performRecordedCommands:performCommandFaults;
          const result=await run({directory,plan,signal});
          if(result.failure)throw new Error('Delivery ingestion incomplete');
          return result;
        }
        return performIngestion({ directory, plan, signal });
      } } : {}) });
  } finally { backend.close(); monitorBackend?.close(); }
}

export const smokeBackend = input => runBackend(input, false);
export const qualifyIngestionBackend = input => runBackend(input, true);
export const qualifyDeliveryBackend = input => runBackend(input, 'delivery');
export const qualifyCommandFaults = input => runBackend(input, 'command-faults');
