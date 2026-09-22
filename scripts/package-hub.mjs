import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cp,mkdir,mkdtemp,readFile,readdir,rm,writeFile,copyFile,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
function run(args,cwd){const result=spawnSync(process.execPath,args,{cwd,encoding:'utf8',maxBuffer:8*1024*1024});if(result.error||result.status!==0)throw new Error(result.error?.message??result.stdout+'\n'+result.stderr);return result.stdout;}
function npm(args,cwd){if(!process.env.npm_execpath)throw new Error('npm-execpath-unavailable');return run([process.env.npm_execpath,...args],cwd);}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function files(directory,prefix=''){const result=[];for(const entry of (await readdir(join(directory,prefix),{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:1)){if(!prefix&&['node_modules','package-lock.json'].includes(entry.name))continue;const name=prefix?prefix+'/'+entry.name:entry.name;if(entry.isDirectory())result.push(...await files(directory,name));else if(entry.isFile())result.push(name);else throw new Error('unexpected-package-entry');}return result;}
const scratch=await mkdtemp(join(tmpdir(),'hub-package-'));
try {
  // Build the exact local dependencies; neither a registry secret nor a sibling checkout is used.
  run([join(root,'scripts/package-contracts.mjs')],root);
  run([join(root,'scripts/package-agent-state.mjs')],root);
  run([join(root,'scripts/package-mcp.mjs')],root);
  const stage=join(scratch,'stage');await mkdir(stage);
  for(const name of ['package.json','src','dist','public','tests','fixtures','bin','README.md','SETUP.md'])await cp(join(root,'apps/hub',name),join(stage,name),{recursive:true});
  const metadata=JSON.parse(await readFile(join(stage,'package.json'),'utf8'));
  const dependencies=Object.keys(metadata.dependencies);
  metadata.bundleDependencies=dependencies;
  metadata.exports={'./setup-consumer':{types:'./dist/setup-consumer.d.ts',import:'./dist/setup-consumer.js'},'./setup':{types:'./dist/setup.d.ts',import:'./dist/setup.js'},'./setup-authority':{types:'./dist/setup-authority.d.ts',import:'./dist/setup-authority.js'},'./monitor-hook':'./bin/monitor-hook.mjs','.':{types:'./dist/server.d.ts',import:'./dist/server.js'},'./migration':{types:'./dist/migration.d.ts',import:'./dist/migration.js'},'./migration-routes':{types:'./dist/migration-routes.d.ts',import:'./dist/migration-routes.js'}};
  const original=JSON.stringify(metadata,null,2)+'\n';await writeFile(join(stage,'package.json'),original);
  // Keep private archives intact: npm cannot resolve their private transitive
  // version pins from a registry. Public packages come from npm ci and its lock.
  for(const [name,archive] of [['agent-state','jimmie-potts-agent-state-1.0.0.tgz'],['device-contracts','jimmie-potts-device-contracts-1.0.0.tgz'],['device-mcp','jimmie-potts-device-mcp-1.0.0.tgz']]){
    const target=join(stage,'node_modules/@jimmie-potts',name);await mkdir(target,{recursive:true});
    const result=spawnSync('tar',['-xzf',join(root,'artifacts',archive),'--strip-components=1','-C',target],{encoding:'utf8'});
    if(result.error||result.status!==0)throw new Error(result.error?.message??result.stderr);
  }
  async function hoistPublic(directory){
    const modules=join(directory,'node_modules');
    let entries;try{entries=await readdir(modules,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return;throw error;}
    for(const entry of entries){
      if(entry.name==='@jimmie-potts'){
        for(const child of await readdir(join(modules,entry.name)))await hoistPublic(join(modules,entry.name,child));
      }else await rm(join(modules,entry.name),{recursive:true,force:true});
    }
  }
  // Private archives may carry independently resolved public dependencies too.
  // Keep their private packages and resolve all public imports from the locked root.
  for(const name of dependencies)await hoistPublic(join(stage,'node_modules',name));
  const lock=JSON.parse(await readFile(join(root,'package-lock.json'),'utf8'));
  const lockedPublic=Object.entries(lock.packages).filter(([path,entry])=>path.startsWith('node_modules/')&&!entry.link&&!entry.dev);
  for(const [path,entry] of lockedPublic){
    const source=join(root,path);
    assert.equal((await lstat(source)).isSymbolicLink(),false,`public package must be installed: ${path}`);
    const installed=JSON.parse(await readFile(join(source,'package.json'),'utf8'));
    assert.equal(installed.version,entry.version,`installed package differs from lock: ${path}`);
    await cp(source,join(stage,path),{recursive:true});
  }
  const hashes={};for(const name of await files(stage))hashes[name]=sha(await readFile(join(stage,name)));
  await writeFile(join(stage,'manifest.json'),JSON.stringify({artifact:metadata.name,version:metadata.version,files:hashes},null,2)+'\n');
  async function pack(folder){await mkdir(folder);const result=JSON.parse(npm(['pack','--ignore-scripts','--json','--pack-destination',folder],stage));return join(folder,result[0].filename);}
  const first=await pack(join(scratch,'first')),second=await pack(join(scratch,'second')),bytes=await readFile(first);
  assert.deepEqual(bytes,await readFile(second),'repeated package bytes');
  // Inspect what npm actually shipped, not merely the staging directory.
  const listing=spawnSync('tar',['-tzf',first],{encoding:'utf8'});
  if(listing.error||listing.status!==0)throw new Error(listing.error?.message??listing.stderr);
  let publicPackages=0;
  for(const path of listing.stdout.split('\n').filter(path=>/\/node_modules\/(?:@[^/]+\/)?[^/]+\/package\.json$/.test(path))){
    const manifest=spawnSync('tar',['-xOf',first,path],{encoding:'utf8'});
    if(manifest.error||manifest.status!==0)throw new Error(manifest.error?.message??manifest.stderr);
    const metadata=JSON.parse(manifest.stdout);
    if(metadata.name.startsWith('@jimmie-potts/'))continue;
    const locked=lock.packages[path.slice('package/'.length,-'/package.json'.length)];
    assert(locked&&!locked.dev&&!locked.link&&locked.version===metadata.version,`archive package differs from lock: ${path} (${metadata.name}@${metadata.version})`);
    publicPackages++;
  }
  assert(publicPackages>0,'public runtime dependency closure');

  const output=join(root,'artifacts',basename(first));await copyFile(first,output);await writeFile(output+'.sha256',sha(bytes)+'  '+basename(output)+'\n');
  if(process.argv.includes('--test')){
    const consumer=join(scratch,'consumer');await mkdir(consumer);await writeFile(join(consumer,'package.json'),'{"name":"isolated-hub-consumer","private":true,"type":"module"}');
    npm(['install','--offline','--cache',join(scratch,'empty-cache'),'--ignore-scripts','--no-audit','--no-fund',output],consumer);
    const installed=join(consumer,'node_modules/@jimmie-potts/hub');
    const manifest=JSON.parse(await readFile(join(installed,'manifest.json'),'utf8'));
    assert.deepEqual(await files(installed),[...Object.keys(manifest.files),'manifest.json'].sort());
    for(const [path,expected] of Object.entries(manifest.files))assert.equal(sha(await readFile(join(installed,path))),expected,path);
    const tests=(await readdir(join(installed,'tests'))).filter(name=>name.endsWith('.test.mjs')).map(name=>join(installed,'tests',name));
    assert.match(run(['--test',...tests],installed),/fail 0/);
    assert.equal(run(['--input-type=module','-e','import {startHub} from "@jimmie-potts/hub"; import {launchOwner} from "@jimmie-potts/hub/migration"; import {stageProducer} from "@jimmie-potts/hub/migration-routes"; if([startHub,launchOwner,stageProducer].some(value=>typeof value!=="function"))process.exit(1);'],consumer),'');
  }
  console.log(JSON.stringify({archive:output,sha256:sha(bytes),reproducible:true,isolatedTests:process.argv.includes('--test')}));
}finally{await rm(scratch,{recursive:true,force:true});}
