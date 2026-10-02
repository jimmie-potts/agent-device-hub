import {spawnSync} from 'node:child_process';
import {realpathSync} from 'node:fs';

/** Package provenance only: runtime identity never consults a checkout. */
export function sourceRevision(root){
 try{
  const git=args=>{
   const result=spawnSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:1024*1024});
   if(result.error||result.status!==0)throw new Error('unknown-source');
   return result.stdout.trim();
  };
  if(realpathSync(git(['rev-parse','--show-toplevel']))!==realpathSync(root))return 'unknown';
  const head=git(['rev-parse','--verify','HEAD^{commit}']);
  if(!/^[0-9a-f]{40}(?![\s\S])/.test(head)||git(['status','--porcelain=v1','--untracked-files=all']))return 'unknown';
  return head;
 }catch{return 'unknown';}
}
