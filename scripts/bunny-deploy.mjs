#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {docker,selected,privateHostDirectory} from './bunny.mjs';
import {operationRoot,reconcileOperation,privateJson} from './bunny-operations.mjs';
import {refusalMessage} from './operator-refusal.mjs';
import {hostedArtifact} from './deployment/hosted-artifact.mjs';
export {hostedArtifact} from './deployment/hosted-artifact.mjs';
import {deployBatch,readRequest} from './deployment/batch.mjs';
export async function main(argv) {
  process.umask(0o077);
  const {values,positionals}=parseArgs({args:argv,allowPositionals:true,strict:true,options:{request:{type:'string'},compatibility:{type:'string'}}});
  if(positionals.length!==1||!['deploy','reconcile'].includes(positionals[0])||!values.request)throw Error('deployment-refused');
  const request=await readRequest(resolve(values.request));
  await privateHostDirectory(dirname(request.compose));
  const root=operationRoot();
  if(positionals[0]==='reconcile')return reconcileOperation({root,project:request.project},async pending=>{
    if(pending!==undefined&&(pending.project!==request.project||pending.id!==request.id))throw Error('deployment-refused');
    const info=await selected(request,docker);
    if(info===undefined)return {status:'not-created',pendingPhase:pending?.phase};
    if(![request.containerId,pending?.replacementContainer].includes(info.Id)
      &&!(pending?.phase==='creating-replacement'&&info.Image===pending.targetImage))throw Error('deployment-refused');
    return {id:info.Id,image:info.Image,status:info.State.Status,pid:info.State.Pid};
  });
  const compatibility=values.compatibility===undefined?undefined:await privateJson(resolve(values.compatibility));
  return deployBatch(request,{root,run:docker,compatibility,qualification:r=>hostedArtifact(r,root)});
}
if(process.argv[1]!==undefined&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{process.stdout.write(JSON.stringify(await main(process.argv.slice(2)))+'\n');}
  catch(error){process.stderr.write(refusalMessage(error));process.exitCode=1;}
}
