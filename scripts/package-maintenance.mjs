import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cp,mkdir,mkdtemp,readFile,rm,writeFile,readdir} from 'node:fs/promises';
import {join,resolve,basename,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const hash=value=>createHash('sha256').update(value).digest('hex');
const run=(command,args,cwd)=>{
 const r=spawnSync(command,args,{cwd,encoding:'utf8',maxBuffer:4*1024*1024});
 if(r.error||r.status!==0)throw new Error(r.stderr||'package command failed');return r.stdout;
};
const scratchRoot=join(root,'.local/scratch/maintenance-package');await mkdir(scratchRoot,{recursive:true});
const scratch=await mkdtemp(join(scratchRoot,'check-'));
try{
 const stage=join(scratch,'stage');await mkdir(stage);
 const contractSchemas={name:'published-contract-schemas',setup(builder){
  builder.onLoad({filter:/packages\/contracts\/dist\/(?:index|install-receipt)\.js$/},async({path})=>{
   let contents=await readFile(path,'utf8');
   const reads=[...contents.matchAll(/JSON\.parse\(readFileSync\(new URL\('(\.\.\/schemas\/[a-z0-9-]+\.schema\.json)', import\.meta\.url\), 'utf8'\)\)/g)];
   assert.equal(reads.length,1,'published contract schema read must remain explicit');
   for(const match of reads)contents=contents.replace(match[0],JSON.stringify(JSON.parse(await readFile(resolve(dirname(path),match[1]),'utf8'))));
   return {contents,loader:'js'};
  });
 }};
 const metas=[];
 for(const name of ['maintenance','tracker-closeout','hub-supervisor-install']){
  const meta=await build({entryPoints:[join(root,'apps/maintenance/bin',name+'.mjs')],bundle:true,platform:'node',target:'node24',format:'esm',outfile:join(stage,name+'.mjs'),metafile:true,legalComments:'none',plugins:[contractSchemas],banner:{js:"import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);"}});
  assert.ok(Object.values(meta.metafile.outputs).every(out=>out.imports.every(i=>i.path.startsWith('node:'))),'all non-built-in dependencies bundled');metas.push(meta);
 }
 await cp(join(root,'apps/maintenance/closeout/recommendation.py'),join(stage,'recommendation.py'));
 await cp(join(root,'apps/maintenance/README.md'),join(stage,'README.md'));
 await writeFile(join(stage,'package.json'),JSON.stringify({name:'@jimmie-potts/bunny-maintenance',version:'0.1.0',private:true,type:'module',bin:{'bunny-maintenance':'maintenance.mjs','bunny-tracker-closeout':'tracker-closeout.mjs','bunny-hub-install':'hub-supervisor-install.mjs'},engines:{node:'>=24 <25'}})+'\n');
 const files={};for(const name of (await readdir(stage)).sort())files[name]=hash(await readFile(join(stage,name)));
 const lock=JSON.parse(await readFile(join(root,'package-lock.json'),'utf8'));
 const dependencies={};
 for(const path of metas.flatMap(meta=>Object.keys(meta.metafile.inputs))){
  const match=path.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//);if(match){const name=match[1],entry=lock.packages['node_modules/'+name];if(entry?.version)dependencies[name]=entry.version;}
 }
 dependencies['@jimmie-potts/bunny-observability']='1.1.0';dependencies['@jimmie-potts/device-contracts']='1.2.0';
 await writeFile(join(stage,'manifest.json'),JSON.stringify({schemaVersion:1,artifact:'@jimmie-potts/bunny-maintenance',version:'0.1.0',node:'24',dependencyClosure:dependencies,files},null,2)+'\n');
 const npm=args=>run(process.execPath,[process.env.npm_execpath,...args],stage);
 const packs=[];for(const name of ['one','two']){const path=join(scratch,name);await mkdir(path);const result=JSON.parse(npm(['pack','--ignore-scripts','--json','--pack-destination',path]));packs.push(join(path,result[0].filename));}
 const bytes=await readFile(packs[0]);assert.deepEqual(bytes,await readFile(packs[1]),'reproducible package');
 const destination=join(root,'artifacts');await mkdir(destination,{recursive:true});const archive=join(destination,basename(packs[0]));await writeFile(archive,bytes);await writeFile(archive+'.sha256',hash(bytes)+'  '+basename(archive)+'\n');
 if(process.argv.includes('--test')){
  const consumer=join(scratch,'consumer');await mkdir(consumer);run('tar',['-xzf',archive,'-C',consumer],root);
  const installed=join(consumer,'package');const manifest=JSON.parse(await readFile(join(installed,'manifest.json'),'utf8'));
  assert.deepEqual((await readdir(installed)).sort(),['manifest.json',...Object.keys(manifest.files)].sort());
  for(const [name,digest] of Object.entries(manifest.files))assert.equal(hash(await readFile(join(installed,name))),digest);
  const invalid=spawnSync(process.execPath,[join(installed,'maintenance.mjs')],{cwd:consumer,input:'{}',encoding:'utf8'});
  assert.equal(invalid.status,0);assert.equal(JSON.parse(invalid.stdout).status,'blocked');
  const {fixture}=await import('../apps/maintenance/tests/fixture.mjs');const f=await fixture({parent:scratch});
  try{
   const response=spawnSync(process.execPath,[join(installed,'maintenance.mjs'),'--config',f.configPath],{cwd:consumer,input:JSON.stringify(f.request),encoding:'utf8'});
   assert.equal(response.status,0);assert.equal(JSON.parse(response.stdout).selections[0].issue,12);assert.equal((await f.read()).creates,1);
  }finally{await f.close();}
  const {closeoutFixture}=await import('../apps/maintenance/tests/closeout-fixture.mjs');
  for(const name of ['agent-device-hub','codex-nanoleaf','divoom-app-upgrade','agent-skills','dotfiles']){
   const tracker=await closeoutFixture({repository:'jimmie-potts/'+name,parent:scratch,helper:join(installed,'recommendation.py')});
   try{
    const response=spawnSync(process.execPath,[join(installed,'tracker-closeout.mjs'),'--config',tracker.configPath],{cwd:consumer,input:JSON.stringify(tracker.request),encoding:'utf8'});
    assert.equal(response.status,0,response.stderr);const result=JSON.parse(response.stdout);assert.equal(result.status,'complete',JSON.stringify(result));assert.equal(result.repository,tracker.request.repository);assert.equal((await tracker.read()).issues[0].state,'closed');
   }finally{await tracker.close();}
  }
  const {fixture:installFixture,invoke}=await import('../apps/maintenance/tests/hub-install-fixture.mjs');const installer=await installFixture({parent:scratch});
  try{
   const response=await invoke(process.execPath,join(installed,'hub-supervisor-install.mjs'),installer.configPath,installer.request,consumer);
   assert.equal(response.code,0,response.stderr);assert.equal(JSON.parse(response.stdout).status,'installed',response.stdout);
  }finally{await installer.close();}
 }
 console.log(JSON.stringify({archive,sha256:hash(bytes),dependencyClosure:dependencies,reproducible:true}));
}finally{await rm(scratch,{recursive:true,force:true});}
