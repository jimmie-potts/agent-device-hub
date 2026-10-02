import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {canonical,sha256,readRegular,inventory} from './files.js';

const ownProgram=fileURLToPath(new URL('../..',import.meta.url));
const records=['owner','source','revision','labels','notices','acknowledgments','attention','retirements','ordering','journal','rules','settings','interrupt-set','automation-log','budgets','consumed-events','fence'];
export async function dependencyEntrypoint(program:string,name:string):Promise<string>{
 if(!['agent-state','agent-lifecycle-contracts'].includes(name))throw new Error('unknown-probe-dependency');
 const require=createRequire(join(program,'package.json')),qualified='@jimmie-potts/'+name;
 for(const directory of require.resolve.paths(qualified)??[]){
  try{
   const root=await realpath(join(directory,qualified));
   const metadata=JSON.parse((await readRegular(join(root,'package.json'))).toString()) as {name:string;exports:Record<string,{import:string}>};
   if(metadata.name!==qualified||metadata.exports['.']?.import!=='./dist/index.js')throw new Error('unknown-probe-dependency');
   return join(root,'dist/index.js');
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}
 }
 throw new Error('missing-probe-dependency');
}
/** This first qualification permits only the updater's exact known durable implementations. */
export async function durableFingerprint(program:string):Promise<string>{
 const files:Record<string,string>={};
 for(const name of ['storage.js','automation-store.js','automation.js'])files[name]=sha256(await readRegular(join(program,'dist',name)));
 for(const name of ['agent-state','agent-lifecycle-contracts']){
  const directory=dirname(await dependencyEntrypoint(program,name));
  files[name]=(await inventory(directory)).sha256;
 }
 return sha256(canonical(files));
}
type Qualification={status:'unknown';reason:string;probe:null}|{status:'compatible';fingerprint:string;probe:{agentState:true;automation:true;repeatedEffects:0;records:string[]};evidenceSha256:string};
export async function qualifyCompatibility(previous:string,target:string):Promise<Qualification>{
 let expected:string;
 try{
  expected=await durableFingerprint(ownProgram);
  if(await durableFingerprint(previous)!==expected||await durableFingerprint(target)!==expected)return {status:'unknown',reason:'durable-implementation-unqualified',probe:null};
 }catch{return {status:'unknown',reason:'durable-implementation-unavailable',probe:null};}
 const scratch=await mkdtemp(join(tmpdir(),'hi-compat-'));
 try{
  const evidence:unknown[]=[];
  for(const [program,mode] of [[target,'write'],[previous,'reopen']]){
   const result=spawnSync(process.execPath,[join(ownProgram,'bin/install-compatibility-probe.mjs'),program,scratch,mode],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
   if(result.error||result.status!==0)return {status:'unknown',reason:'durable-reopen-probe-failed',probe:null};
   const value=JSON.parse(result.stdout) as {ok?:boolean;mode?:string;calls?:number};
   if(value.ok!==true||value.mode!==mode||value.calls!==(mode==='write'?1:0))return {status:'unknown',reason:'durable-reopen-probe-failed',probe:null};
   evidence.push(value);
  }
  return {status:'compatible',fingerprint:expected,probe:{agentState:true,automation:true,repeatedEffects:0,records},evidenceSha256:sha256(canonical({fingerprint:expected,evidence,records}))};
 }finally{await rm(scratch,{recursive:true,force:true});}
}
