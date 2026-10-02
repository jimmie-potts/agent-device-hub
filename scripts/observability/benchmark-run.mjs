import {basename,join} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {prepareBackendDirectory} from './backend-files.mjs';
import {inspectHost,inspectDocker} from './preflight.mjs';
import {createDockerBackend} from './docker-backend.mjs';
import {registerHostRoots} from './host-roots.mjs';
import {prepareReleasedContract} from './released-contract.mjs';
import {allocateBackend} from './backend-allocation.mjs';
import {withReadyBackend} from './backend-session.mjs';
import {performBenchmarkWorkload} from './benchmark-workload.mjs';
import {cleanupBenchmark} from './benchmark-cleanup.mjs';

/** A fresh backend and application for each mode prevent cross-run state reuse.
 * A failed or partial allocation is retained for explicit authoritative readback. */
export async function runBenchmark({directory,stateParent,endpoint,ports,condition,enabled,signal}) {
  if(typeof endpoint!=='string'||!/^unix:\/\/\/[\w./-]+$/.test(endpoint))throw new Error('Local Docker endpoint required');
  const env={...process.env,DOCKER_HOST:endpoint};delete env.DOCKER_CONTEXT;delete env.DOCKER_TLS_VERIFY;delete env.DOCKER_CERT_PATH;
  if(!(await inspectDocker(env)).ready)throw new Error('Docker preflight failed');
  let backend,monitorBackend,sampleBackend,session,result,cleanup,allocated=false,preparationFailure=null;
  try {
    backend=await createDockerBackend({endpoint,signal});monitorBackend=await createDockerBackend({endpoint,signal});
    sampleBackend=await createDockerBackend({endpoint,signal});
    await prepareBackendDirectory(directory,{runId:basename(directory),ports});
    const host=await inspectHost(directory);
    await writeFile(join(directory,'host-preflight.json'),JSON.stringify(host,null,2)+'\n',{flag:'wx',mode:0o600});
    if(!host.ready)throw new Error('Host capacity unavailable');
    const roots=await registerHostRoots(directory,stateParent);
    await prepareReleasedContract(join(roots.roots.state.path,'contract'));
    await allocateBackend({directory,backend,signal});allocated=true;
    session=await withReadyBackend({directory,backend,monitorBackend,signal,action:async({plan,receipt,signal})=>{
      result=await performBenchmarkWorkload({directory,plan,receipt,backend,sampleBackend,enabled,condition,signal});
      // Preserve numerical/fault evidence and finish normal cleanup even when the
      // workload is incomplete. Pair evaluation retains the failed result.
    }});
  }catch{preparationFailure='benchmark-lifecycle-incomplete';}
  finally {
    if(allocated)try{cleanup=await cleanupBenchmark({directory,backend,teardownStartedNs:session?.teardownStartedNs});}
      catch{preparationFailure='benchmark-cleanup-incomplete';}
    backend?.close();monitorBackend?.close();sampleBackend?.close();
  }
  const summary={...(result??{enabled,condition,complete:false}),backendComplete:session?.failure===null&&session?.actionComplete===true&&session?.monitorSaved===true,
    cleanupComplete:cleanup?.complete===true&&cleanup?.syntheticStateRemoved===true,teardownMs:cleanup?.teardownMs??null,
    preparationFailure};
  await writeFile(join(directory,'benchmark-run.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx',mode:0o600});
  return summary;
}
