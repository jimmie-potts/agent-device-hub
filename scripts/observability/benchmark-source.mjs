import {spawnSync} from 'node:child_process';
import {readFile,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../../',import.meta.url));
function command(program,args) {
  const result=spawnSync(program,args,{cwd:root,encoding:'utf8',timeout:5000,maxBuffer:2*1024*1024});
  if(result.error||result.status!==0)throw new Error('Benchmark source prerequisite unavailable');
  return result.stdout.trimEnd();
}
export async function benchmarkSource() {
  if(await realpath(process.cwd())!==await realpath(root)||command('git',['status','--porcelain','--untracked-files=normal'])!=='')
    throw new Error('Benchmark requires a clean owning worktree');
  const sourceRevision=command('git',['rev-parse','HEAD']),sourceTree=command('git',['rev-parse','HEAD^{tree}']);
  const hash=createHash('sha256');
  const files=command('git',['ls-files','-z','scripts/observability']).split('\0').filter(Boolean).sort();
  if(!files.length||files.length>300)throw new Error('Benchmark harness inventory invalid');
  for(const file of files) {
    if(!/^scripts\/observability\/[\w./-]+$/.test(file))throw new Error('Benchmark source path invalid');
    hash.update(file+'\0');hash.update(await readFile(new URL('../../'+file,import.meta.url)));hash.update('\0');
  }
  return {sourceRevision,sourceTree,packageLockSha256:createHash('sha256').update(await readFile(new URL('../../package-lock.json',import.meta.url))).digest('hex'),
    harnessSha256:hash.digest('hex'),nodeVersion:process.versions.node,pythonVersion:command('python3',['--version']).replace(/^Python /,'')};
}
