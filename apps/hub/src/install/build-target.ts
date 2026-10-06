import {spawnSync} from 'node:child_process';
import {openSync,closeSync} from 'node:fs';
import {mkdtemp,readFile,open,rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {inspectSource} from './source.js';
import {extractArchive,readRegular,sha256,type ReleaseIdentity} from './files.js';
import {ownedDirectory,stageRelease,syncDirectory,writeDurable} from './stage.js';

function git(repository:string,args:string[]):string{
 const result=spawnSync('git',args,{cwd:repository,encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
 if(result.error||result.status!==0)throw new Error('install-build-source-failed');return result.stdout.trim();
}
/** Build only the approved clean merged SHA; all expensive work finishes before service stop. */
export async function buildTarget(repository:string,root:string,target:string):Promise<{path:string;identity:ReleaseIdentity}>{
 const source=inspectSource(repository,target,null);if(source.target!==target)throw new Error('install-target-changed');
 if(process.versions.node.split('.')[0]!=='24')throw new Error('install-node-24-required');
 const remote=git(repository,['remote','get-url','origin']);
 if(!/^(https:\/\/github\.com\/|git@github\.com:)jimmie-potts\/agent-device-hub(?:\.git)?$/.test(remote))throw new Error('untrusted-hub-source');
 const ignored=spawnSync('git',['check-ignore','-q','.local/probe'],{cwd:repository});if(ignored.status!==0)throw new Error('install-build-scratch-not-ignored');
 const scratchRoot=join(repository,'.local/scratch/hub-install');await ownedDirectory(scratchRoot);
 const scratch=await mkdtemp(join(scratchRoot,'build-')),checkout=join(scratch,'source');
 const shortTmp=join(homedir(),'.cache/agent-device-hub','hi-'+randomUUID().slice(0,8));await ownedDirectory(shortTmp);
 const id='build-'+randomUUID();await ownedDirectory(join(root,'builds'));const log=join(root,'builds',id+'.log');
 const descriptor=openSync(log,'wx',0o600);let added=false,removed=false;
 try{
  git(repository,['worktree','add','--detach',checkout,target]);added=true;
  for(const args of [['ci'],['run','build'],['run','test:hub:package:built']]){
   const result=spawnSync('npm',args,{cwd:checkout,env:{...process.env,TMPDIR:shortTmp},stdio:['ignore',descriptor,descriptor],timeout:30*60*1000});
   if(result.error||result.status!==0)throw new Error('install-target-build-failed');
  }
  if(git(checkout,['rev-parse','HEAD'])!==target||git(checkout,['status','--porcelain=v1','--untracked-files=normal']))throw new Error('install-built-source-changed');
  const metadata=JSON.parse(await readFile(join(checkout,'apps/hub/package.json'),'utf8')) as {version:string};
  if(!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(metadata.version))throw new Error('invalid-install-version');
  const bytes=await readRegular(join(checkout,'artifacts',`jimmie-potts-hub-${metadata.version}.tgz`)),archiveSha256=sha256(bytes);
  // Inspect the trusted local producer's output with the same strict extractor used for installation.
  const extraction=join(scratch,'archive');await extractArchive(bytes,extraction,archiveSha256);
  const manifest=await readRegular(join(extraction,'manifest.json')),value=JSON.parse(manifest.toString()) as {sourceRevision:string;version:string};
  if(value.sourceRevision!==target||value.version!==metadata.version)throw new Error('install-built-source-changed');
  const identity:ReleaseIdentity={kind:'release',sourceRevision:target,version:metadata.version,archiveSha256,manifestSha256:sha256(manifest)};
  const staged=await stageRelease(root,bytes,identity);
  await ownedDirectory(join(root,'archives'));const archive=join(root,'archives',target+'.tgz');
  try{const file=await open(archive,'wx',0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}await syncDirectory(join(root,'archives'));}
  catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;if(sha256(await readRegular(archive))!==archiveSha256)throw new Error('conflicting-install-release');}
  await writeDurable(join(root,'builds',id+'.json'),{sourceRepository:'https://github.com/jimmie-potts/agent-device-hub',source,identity,log,checks:['npm ci','npm run build','npm run test:hub:package:built']});
  return staged;
 }finally{
  closeSync(descriptor);
  if(added){try{git(repository,['worktree','remove',checkout]);removed=true;}catch{/* Retain an unexpectedly dirty checkout for inspection; never force-remove it. */}}
  else removed=true;
  if(removed)await rm(scratch,{recursive:true,force:true});
  await rm(shortTmp,{recursive:true,force:true});
 }
}
