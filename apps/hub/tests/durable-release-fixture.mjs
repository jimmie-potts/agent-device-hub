// Disposable runnable copies of this Hub program for durable-compatibility tests.
// A copy owns its Hub dist and both durable packages, so a test can edit one
// release; the remaining runtime dependencies the probe loads are linked.
import {mkdtemp,mkdir,cp,symlink,rm,readFile,writeFile,appendFile,realpath} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {dependencyEntrypoint} from '../dist/install/compatibility.js';

export const program=fileURLToPath(new URL('..',import.meta.url));
async function packageRoot(from,name){
 const require=createRequire(join(from,'package.json'));
 for(const directory of require.resolve.paths(name)??[]){
  try{return await realpath(join(directory,name));}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 throw new Error('missing fixture dependency '+name);
}
export async function copyRelease(){
 const root=await mkdtemp(join(tmpdir(),'hi-release-')),scope=join(root,'node_modules/@jimmie-potts');
 await cp(join(program,'package.json'),join(root,'package.json'));
 await cp(join(program,'dist'),join(root,'dist'),{recursive:true});
 await mkdir(scope,{recursive:true});
 const packages={},sources={};
 for(const name of ['agent-state','agent-lifecycle-contracts']){
  const source=dirname(dirname(await dependencyEntrypoint(program,name))),destination=join(scope,name);
  await mkdir(destination);await cp(join(source,'package.json'),join(destination,'package.json'));
  for(const part of ['dist','schemas'])await cp(join(source,part),join(destination,part),{recursive:true});
  packages[name]=destination;sources[name]=source;
 }
 await symlink(await packageRoot(sources['agent-state'],'ajv'),join(root,'node_modules/ajv'));
 await symlink(await packageRoot(program,'@jimmie-potts/device-contracts'),join(scope,'device-contracts'));
 const path=(where,file)=>({hub:join(root,'dist'),state:packages['agent-state'],lifecycle:packages['agent-lifecycle-contracts']})[where]+'/'+file;
 return {
  root,path,
  append:(where,file,text='\n')=>appendFile(path(where,file),text),
  write:(where,file,text)=>writeFile(path(where,file),text),
  remove:(where,file)=>rm(path(where,file),{recursive:true}),
  replace:async(where,file,from,to)=>{
   const before=await readFile(path(where,file),'utf8');
   if(!before.includes(from))throw new Error('fixture anchor missing in '+file);
   await writeFile(path(where,file),before.replace(from,to));
  },
  dispose:()=>rm(root,{recursive:true,force:true})
 };
}
