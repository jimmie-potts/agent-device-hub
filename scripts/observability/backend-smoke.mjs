import { basename } from 'node:path';
import { prepareBackendDirectory } from './backend-files.mjs';
import { inspectHost, inspectDocker } from './preflight.mjs';
import { createDockerBackend } from './docker-backend.mjs';
import { allocateBackend } from './backend-allocation.mjs';
import { registerHostRoots } from './host-roots.mjs';
import { withReadyBackend } from './backend-session.mjs';

/** Prerequisite smoke only: no telemetry workload, benchmark, installation or image pull. */
export async function smokeBackend({ directory, stateParent, endpoint, ports, signal }) {
  if (typeof endpoint !== 'string' || !/^unix:\/\/\/[\w./-]+$/.test(endpoint)) throw new Error('Local Docker endpoint required');
  const env = { ...process.env, DOCKER_HOST: endpoint };
  delete env.DOCKER_CONTEXT; delete env.DOCKER_TLS_VERIFY; delete env.DOCKER_CERT_PATH;
  if (!(await inspectDocker(env)).ready) throw new Error('Docker preflight failed');
  const backend = await createDockerBackend({ endpoint, signal }); let monitorBackend;
  try {
    monitorBackend = await createDockerBackend({ endpoint, signal });
    await prepareBackendDirectory(directory, { runId: basename(directory), ports });
    if (!(await inspectHost(directory)).ready) throw new Error('Host preflight failed');
    await registerHostRoots(directory, stateParent);
    await allocateBackend({ directory, backend, signal });
    return await withReadyBackend({ directory, backend, monitorBackend, signal });
  } finally { backend.close(); monitorBackend?.close(); }
}
