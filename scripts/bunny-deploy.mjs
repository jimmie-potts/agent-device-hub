#!/usr/bin/env node
import {execFile} from 'node:child_process';
import {promisify,parseArgs} from 'node:util';
import {mkdir,readFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {docker,selected,privateHostDirectory} from './bunny.mjs';
import {operationRoot,reconcileOperation,privateJson} from './bunny-operations.mjs';
import {attestMaintenanceHelper} from './deployment/maintenance-helper.mjs';
import {deployBatch,readRequest} from './deployment/batch.mjs';
const execute=promisify(execFile);
export async function hostedArtifact(request,root,run=docker) {
  const {REPOSITORY,WORKFLOW_PATH,qualificationArtifactNames,validateHostedQualification,validateQualification}=await import('./release/qualification.mjs');
  const api=async path=>JSON.parse((await execute('gh',['api',path,'--paginate','--slurp'],{encoding:'utf8',maxBuffer:16*1024*1024})).stdout);
  const base=`repos/${REPOSITORY}/actions/runs/${request.runId}`;
  const [runs,jobPages,artifactPages]=await Promise.all([api(`${base}/attempts/${request.runAttempt}`),api(`${base}/attempts/${request.runAttempt}/jobs?per_page=100`),api(`${base}/artifacts?per_page=100`)]);
  if(runs.length!==1||runs[0].repository?.full_name!==REPOSITORY||runs[0].path!==WORKFLOW_PATH||runs[0].head_sha!==request.candidate
    ||runs[0].run_attempt!==request.runAttempt||runs[0].status!=='completed'||runs[0].conclusion!=='success')throw Error('qualification-refused');
  const names=qualificationArtifactNames(request.candidate,request.runId,request.runAttempt);
  await mkdir(root,{recursive:true,mode:0o700});await privateHostDirectory(root);
  const destination=join(root,request.id+'.artifacts');
  await mkdir(destination,{mode:0o700});await privateHostDirectory(destination);
  const download=async name=>execute('gh',['run','download',String(request.runId),'--repo',REPOSITORY,'--name',name,'--dir',destination],{encoding:'utf8',maxBuffer:1024*1024});
  await download(names.evidence);
  const receipt=JSON.parse(await readFile(join(destination,'qualification.json'),'utf8'));
  const expected={repository:REPOSITORY,candidate:request.candidate};
  const hosted={run:runs[0],jobs:jobPages.flatMap(page=>page.jobs),artifacts:artifactPages.flatMap(page=>page.artifacts)};
  validateHostedQualification(receipt,hosted,expected);
  if(receipt.runId!==request.runId||receipt.runAttempt!==request.runAttempt)throw Error('qualification-refused');
  await download(names.image);
  const archive=join(destination,'production-image.tar.gz');
  const digest=createHash('sha256');for await(const chunk of createReadStream(archive))digest.update(chunk);
  validateQualification(receipt,{...expected,archiveSha256:digest.digest('hex')});
  await run(['load','--input',archive]);attestMaintenanceHelper(receipt,hosted,request);return receipt;
}
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
  catch{process.stderr.write('B.U.N.N.Y. deployment did not complete. Preserve latest state and the private operation record; inspect before an explicit reconciliation.\n');process.exitCode=1;}
}
