import { cp,mkdir,mkdtemp,readFile,readdir,rm,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
function run(command,args,cwd,extra={}){const r=spawnSync(command,args,{cwd,encoding:'utf8',timeout:60_000,maxBuffer:8*1024*1024,...extra});if(r.error||r.status!==0)throw new Error(r.error?.message??`${command} failed\n${r.stdout}\n${r.stderr}`);return r.stdout;}
const scratchRoot=join(root,'.local/scratch/wispr-package');await mkdir(scratchRoot,{recursive:true});const scratch=await mkdtemp(join(scratchRoot,'build-'));
const dependencies={};
async function files(path,prefix=''){let out=[];for(const e of (await readdir(join(path,prefix),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const name=prefix?prefix+'/'+e.name:e.name;if(e.isDirectory())out.push(...await files(path,name));else if(e.isFile())out.push(name);else throw Error('Nonregular package entry');}return out;}
try{
 const stage=join(scratch,'package');await mkdir(stage);
 for(const name of ['dist','README.md','package.json'])await cp(join(root,'apps/wispr-collector',name),join(stage,name),{recursive:true});
 await cp(join(root,'apps/wispr-collector/tests'),join(stage,'tests'),{recursive:true});
 const shared=join(stage,'node_modules/@jimmie-potts/wispr-contracts');await mkdir(shared,{recursive:true});
 for(const name of ['dist','package.json','README.md'])await cp(join(root,'packages/wispr-contracts',name),join(shared,name),{recursive:true});
 const seen=new Set();
 async function dependency(name,from){
   if(seen.has(name))return;seen.add(name);
   const require=createRequire(join(from,'package.json')),source=dirname(require.resolve(name+'/package.json')),metadata=JSON.parse(await readFile(join(source,'package.json'),'utf8'));
   dependencies[name]=metadata.version;await cp(source,join(stage,'node_modules',name),{recursive:true,dereference:true,filter:path=>!path.slice(source.length).split(/[\\/]/).includes('node_modules')});
   for(const child of Object.keys(metadata.dependencies??{}))await dependency(child,source);
 }
 await dependency('ajv',root);
 const hashes={};for(const name of await files(stage))hashes[name]=sha256(await readFile(join(stage,name)));
 await writeFile(join(stage,'manifest.json'),JSON.stringify({artifact:'@jimmie-potts/wispr-collector',version:'1.1.4',nodeMajor:24,dependencies,files:hashes},null,2)+'\n');
 const tar=spawnSync('tar',['--sort=name','--mode=u=rwX,go=rX','--mtime=@0','--owner=0','--group=0','--numeric-owner','-cf','-','package'],{cwd:scratch,maxBuffer:32*1024*1024});if(tar.status!==0)throw Error('archive-failed');
 const bytes=gzipSync(tar.stdout,{level:9}),destination=join(root,'artifacts');await mkdir(destination,{recursive:true});
 const archive=join(destination,'wispr-collector-1.1.4.tgz'),checksum=sha256(bytes);await writeFile(archive,bytes);await writeFile(archive+'.sha256',checksum+'  wispr-collector-1.1.4.tgz\n');
 if(process.argv.includes('--test')){
   const consumer=join(scratch,'consumer');await mkdir(consumer);run('tar',['-xzf',archive,'-C',consumer],scratch);
   const extracted=join(consumer,'package'),manifest=JSON.parse(await readFile(join(extracted,'manifest.json'),'utf8'));
   for(const [name,expected] of Object.entries(manifest.files))assert.equal(sha256(await readFile(join(extracted,name))),expected,name);
   const env={...process.env,NODE_PATH:'',NODE_OPTIONS:'',WISPR_TEST_TMPDIR:join(consumer,'fixtures')};
   console.log(run(process.execPath,['tests/package-smoke.mjs'],extracted,{env}).trim());
   const check=run(process.execPath,['--input-type=module','-e','import {emptySnapshot,validateSnapshot} from "@jimmie-potts/wispr-contracts";const s=emptySnapshot({namespace:"11111111-1111-4111-8111-111111111111",generation:"22222222-2222-4222-8222-222222222222",timezone:"UTC",now:"2026-10-02T12:00:00.000Z"});if(!validateSnapshot(s).ok)process.exit(1);console.log("Independent shared contract consumer passed.");'],extracted,{env});console.log(check.trim());
 }
 console.log(JSON.stringify({archive,sha256:checksum,dependencies}));
}finally{await rm(scratch,{recursive:true,force:true});}
