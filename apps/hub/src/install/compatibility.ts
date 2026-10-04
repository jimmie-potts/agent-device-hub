import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {canonical,sha256,readRegular,inventory} from './files.js';

const ownProgram=fileURLToPath(new URL('../..',import.meta.url));
const records=['owner','source','revision','labels','notices','acknowledgments','attention','retirements','ordering','journal','rules','settings','interrupt-set','automation-log','budgets','consumed-events','fence','metadata','parents'];
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
// Hub #794 durable surface: the files that encode, decode or accept stored bytes, plus the
// stored-state and frozen lifecycle schemas they apply. HubStorage re-validates each complete
// commit with validateExport, so content modules outside the surface cannot widen the format.
// Unclassified package files count as durable. The #794 OpenSpec design explains each entry.
const hubStores=['storage.js','automation-store.js','automation.js','common.js'];
// These open SQLite without writing monitor state: the installer's read-only capture and the migration lease.
const hubOtherSqlite=['install/state.js','migration-routes.js'];
const sqliteImport=/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["']node:sqlite["']/;
type Surface={required:string[];content:string[];outbound:(name:string)=>boolean};
const surfaces:Record<'agent-state'|'agent-lifecycle-contracts',Surface>={
 'agent-state':{required:['dist/validation.js','dist/memory-storage.js','schemas/durable-v2.1.schema.json'],
  content:['index.js','reducer.js','retirement.js','types.js','providers.js','metadata.js','subscriptions.js','children.js'],
  outbound:name=>/^snapshot-v\d+(?:\.\d+)*\.schema\.json$/.test(name)},
 'agent-lifecycle-contracts':{required:['schemas/lifecycle-v1.schema.json','schemas/lifecycle-v1.1.schema.json'],
  content:['index.js'],
  outbound:name=>/^lifecycle-v\d+(?:\.\d+)*\.schema\.json$/.test(name)&&!['lifecycle-v1.schema.json','lifecycle-v1.1.schema.json'].includes(name)}
};
// Node never loads declarations or source maps.
const executed=(path:string)=>!/\.d\.ts$|\.map$/.test(path);
async function hubSurface(program:string):Promise<Record<string,unknown>>{
 const files:Record<string,unknown>={};
 for(const name of hubStores)files[name]=sha256(await readRegular(join(program,'dist',name)));
 for(const {mode:_,...entry} of (await inventory(join(program,'dist'))).entries){
  if(entry.kind==='link')files[entry.path]=entry;
  if(entry.kind!=='file'||!entry.path.endsWith('.js')||hubStores.includes(entry.path)||hubOtherSqlite.includes(entry.path))continue;
  const bytes=await readRegular(join(program,'dist',entry.path));
  if(sqliteImport.test(bytes.toString()))files[entry.path]=sha256(bytes);
 }
 return files;
}
async function packageSurface(root:string,surface:Surface):Promise<Record<string,unknown>>{
 const files:Record<string,unknown>={};
 for(const scope of ['dist','schemas'] as const){
  // JS is loaded by Node, so private 0600 installation files and 0644 checkout
  // files have the same durable behavior. Provenance inventories still bind modes.
  for(const {mode:_,...entry} of (await inventory(join(root,scope))).entries){
   const durable=entry.kind==='link'||entry.kind==='file'&&(scope==='dist'?executed(entry.path)&&!surface.content.includes(entry.path):!surface.outbound(entry.path));
   if(durable)files[scope+'/'+entry.path]=entry;
  }
 }
 for(const path of surface.required)if(!(path in files))throw new Error('durable-file-missing');
 return files;
}
/** Releases qualify only when the installer, previous release and target share this exact durable surface. */
export async function durableFingerprint(program:string):Promise<string>{
 const surface:Record<string,unknown>={hub:await hubSurface(program)};
 for(const [name,rule] of Object.entries(surfaces))surface[name]=await packageSurface(dirname(dirname(await dependencyEntrypoint(program,name))),rule);
 return sha256(canonical(surface));
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
