import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cp,mkdir,mkdtemp,readFile,readdir,rm,writeFile,copyFile,lstat} from 'node:fs/promises';
import {join,resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sourceRevision} from './hub-build-identity.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const initialRevision=sourceRevision(root);
function run(args,cwd){const result=spawnSync(process.execPath,args,{cwd,encoding:'utf8',maxBuffer:8*1024*1024});if(result.error||result.status!==0)throw new Error(result.error?.message??result.stdout+'\n'+result.stderr);return result.stdout;}
function npm(args,cwd){if(!process.env.npm_execpath)throw new Error('npm-execpath-unavailable');return run([process.env.npm_execpath,...args],cwd);}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
// Previously published private dependencies retain their original archive bytes.
const released={
 'device-contracts':{version:'1.2.0',sha256:'f05b326b88833086abf1af596569448e409645486e7bef482f74e9a6998ced7e',manifest:'d4358ab7257537fdca5787770b0c2591b4e49639ca7fa553e4187bcbb89b6faa'},
 'device-mcp':{version:'1.0.1',sha256:'e6cd65600d02128f5c996e6e4940654d1a9a67b312f7d27148a2137d766a7e32',manifest:'949ef80fd0a440e1816bc2dc250f63c5f40ff6369f251519cad1e3408d036a3e'}
};
async function files(directory,prefix=''){const result=[];for(const entry of (await readdir(join(directory,prefix),{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:1)){if(!prefix&&['node_modules','package-lock.json'].includes(entry.name))continue;const name=prefix?prefix+'/'+entry.name:entry.name;if(entry.isDirectory())result.push(...await files(directory,name));else if(entry.isFile())result.push(name);else throw new Error('unexpected-package-entry');}return result;}
// Lock paths that the root manifest and the workspaces outside modules/ need at run time.
// Staged device modules under modules/ are not part of the Hub package (Hub #25).
function runtimeClosure(lock){
 const packages=lock.packages,seen=new Set();
 // Node's lookup: the package's own node_modules, then each enclosing one, then the root's.
 const resolveFrom=(from,name)=>{for(let base=from;;){const candidate=(base?`${base}/`:'')+`node_modules/${name}`;if(packages[candidate])return candidate;if(!base)return undefined;const index=base.lastIndexOf('/node_modules/');base=index<0?'':base.slice(0,index);}};
 const visit=path=>{
  if(seen.has(path))return;seen.add(path);
  const entry=packages[path];
  if(entry.link)return visit(entry.resolved);
  for(const field of ['dependencies','optionalDependencies','peerDependencies'])for(const name of Object.keys(entry[field]??{})){const found=resolveFrom(path,name);if(found)visit(found);}
 };
 visit('');
 for(const workspace of packages[''].workspaces??[])if(!workspace.startsWith('modules/'))visit(workspace);
 return seen;
}
// Keep the installed consumer outside every checkout so workspace resolution
// cannot hide a missing bundled dependency.
const commonResult=spawnSync('git',['rev-parse','--git-common-dir'],{cwd:root,encoding:'utf8'});
if(commonResult.error||commonResult.status!==0)throw new Error('git-common-directory-unavailable');
const common=resolve(root,commonResult.stdout.trim());
const scratchRoot=join(dirname(dirname(common)),'.local/scratch/package-hub');await mkdir(scratchRoot,{recursive:true});
const scratch=await mkdtemp(join(scratchRoot,'hub-'));
try {
  // Build the new state/lifecycle and observability artifacts; existing releases stay pinned below.
  run([join(root,'scripts/package-agent-state.mjs')],root);
  run([join(root,'scripts/package-observability.mjs')],root);
  const stage=join(scratch,'stage');await mkdir(stage);
  for(const name of ['package.json','src','dist','public','tests','fixtures','bin','README.md','SETUP.md'])await cp(join(root,'apps/hub',name),join(stage,name),{recursive:true});
  const metadata=JSON.parse(await readFile(join(stage,'package.json'),'utf8'));
  // Workspace contracts may advance before the Hub adopts their published archive.
  // The standalone package must describe the trusted bytes actually bundled below.
  for(const [name,pin] of Object.entries(released))metadata.dependencies[`@jimmie-potts/${name}`]=pin.version;
  const dependencies=Object.keys(metadata.dependencies);
  metadata.bundleDependencies=dependencies;
  metadata.exports={'./diagnostics':{types:'./dist/diagnostics.d.ts',import:'./dist/diagnostics.js'},'./setup-consumer':{types:'./dist/setup-consumer.d.ts',import:'./dist/setup-consumer.js'},'./setup':{types:'./dist/setup.d.ts',import:'./dist/setup.js'},'./setup-authority':{types:'./dist/setup-authority.d.ts',import:'./dist/setup-authority.js'},'./monitor-hook':'./bin/monitor-hook.mjs','.':{types:'./dist/server.d.ts',import:'./dist/server.js'},'./migration':{types:'./dist/migration.d.ts',import:'./dist/migration.js'},'./migration-routes':{types:'./dist/migration-routes.d.ts',import:'./dist/migration-routes.js'}};
  const original=JSON.stringify(metadata,null,2)+'\n';await writeFile(join(stage,'package.json'),original);
  // Keep private archives intact: npm cannot resolve their private transitive
  // version pins from a registry. Public packages come from npm ci and its lock.
  for(const [name,archive] of [['agent-state','jimmie-potts-agent-state-3.6.0.tgz'],['agent-lifecycle-contracts','jimmie-potts-agent-lifecycle-contracts-1.2.0.tgz'],['device-contracts','jimmie-potts-device-contracts-1.2.0.tgz'],['device-mcp','jimmie-potts-device-mcp-1.0.1.tgz'],['bunny-observability','jimmie-potts-bunny-observability-1.4.0.tgz']]){
    const pin=released[name],source=join(root,pin?'vendor':'artifacts',archive);
    if(pin){assert.equal(metadata.dependencies[`@jimmie-potts/${name}`],pin.version);assert.equal(sha(await readFile(source)),pin.sha256,`published archive: ${name}`);}
    const target=join(stage,'node_modules/@jimmie-potts',name);await mkdir(target,{recursive:true});
    const result=spawnSync('tar',['-xzf',source,'--strip-components=1','-C',target],{encoding:'utf8'});
    if(result.error||result.status!==0)throw new Error(result.error?.message??result.stderr);
    if(released[name])assert.equal(sha(await readFile(join(target,'manifest.json'))),released[name].manifest,`published manifest: ${name}`);
  }
  // Bundle the same workspace validator used by the collector; the runtime closure is locked below.
  const wisprTarget=join(stage,'node_modules/@jimmie-potts/wispr-contracts');await mkdir(wisprTarget,{recursive:true});
  for(const name of ['package.json','dist','README.md'])await cp(join(root,'packages/wispr-contracts',name),join(wisprTarget,name),{recursive:true});
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
  const hubClosure=runtimeClosure(lock);
  const lockedPublic=Object.entries(lock.packages).filter(([path,entry])=>path.startsWith('node_modules/')&&!entry.link&&!entry.dev&&hubClosure.has(path));
  for(const [path,entry] of lockedPublic){
    const source=join(root,path);
    // npm skips optional packages built for another OS or CPU (for example koffi's
    // per-platform binaries); those are not part of this closure. Any other locked
    // package, optional or not, must be installed.
    const otherPlatform=list=>Array.isArray(list)&&list.length>0&&!list.some(value=>value===process.platform||value===process.arch)&&!list.every(value=>value.startsWith('!'));
    const foreign=entry.optional&&(otherPlatform(entry.os)||otherPlatform(entry.cpu));
    let status;try{status=await lstat(source);}catch(error){if(error.code==='ENOENT'&&foreign)continue;throw error;}
    assert.equal(status.isSymbolicLink(),false,`public package must be installed: ${path}`);
    const installed=JSON.parse(await readFile(join(source,'package.json'),'utf8'));
    assert.equal(installed.version,entry.version,`installed package differs from lock: ${path}`);
    await cp(source,join(stage,path),{recursive:true});
  }
  const hashes={};for(const name of await files(stage))hashes[name]=sha(await readFile(join(stage,name)));
  const revision=sourceRevision(root)===initialRevision?initialRevision:'unknown';
  await writeFile(join(stage,'manifest.json'),JSON.stringify({artifact:metadata.name,version:metadata.version,sourceRevision:revision,files:hashes},null,2)+'\n');
  async function pack(folder){await mkdir(folder);const result=JSON.parse(npm(['pack','--ignore-scripts','--json','--pack-destination',folder],stage));return join(folder,result[0].filename);}
  // Record the dependency bytes npm actually ships, including public packages.
  // The trusted archive digest covers the same complete closure at staging time.
  const inventoryArchive=await pack(join(scratch,'inventory'));
  const unpacked=join(scratch,'inventory-content');await mkdir(unpacked);
  const unpack=spawnSync('tar',['-xzf',inventoryArchive,'--strip-components=1','-C',unpacked],{encoding:'utf8'});
  if(unpack.error||unpack.status!==0)throw new Error(unpack.error?.message??unpack.stderr);
  const dependencyFiles={};for(const name of await files(unpacked,'node_modules'))dependencyFiles[name]=sha(await readFile(join(unpacked,name)));
  await writeFile(join(stage,'manifest.json'),JSON.stringify({artifact:metadata.name,version:metadata.version,sourceRevision:revision,files:hashes,dependencyFiles},null,2)+'\n');
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
    assert.match(run(['--test',join(root,'scripts/hub-build-identity.test.mjs')],root),/fail 0/);
    const consumer=join(scratch,'consumer');await mkdir(consumer);await writeFile(join(consumer,'package.json'),'{"name":"isolated-hub-consumer","private":true,"type":"module"}');
    // Production staging extracts the archive directly. Disable npm-generated bin
    // links so this comparison checks exactly the shipped dependency closure.
    npm(['install','--offline','--cache',join(scratch,'empty-cache'),'--ignore-scripts','--bin-links=false','--no-audit','--no-fund',output],consumer);
    const installed=join(consumer,'node_modules/@jimmie-potts/hub');
    const manifest=JSON.parse(await readFile(join(installed,'manifest.json'),'utf8'));
    assert.equal(manifest.sourceRevision,revision,'packaged source identity');
    assert.deepEqual(await files(installed),[...Object.keys(manifest.files),'manifest.json'].sort());
    for(const [path,expected] of Object.entries(manifest.files))assert.equal(sha(await readFile(join(installed,path))),expected,path);
    assert.deepEqual((await files(installed,'node_modules')).sort(),Object.keys(manifest.dependencyFiles).sort());
    for(const [path,expected] of Object.entries(manifest.dependencyFiles))assert.equal(sha(await readFile(join(installed,path))),expected,path);
    const tests=(await readdir(join(installed,'tests'))).filter(name=>name.endsWith('.test.mjs')).map(name=>join(installed,'tests',name));
    assert.match(run(['--test',...tests],installed),/fail 0/);
    assert.equal(run(['--input-type=module','-e','import {createCommandDiagnostics} from "@jimmie-potts/hub/diagnostics"; import {startHub} from "@jimmie-potts/hub"; import {launchOwner} from "@jimmie-potts/hub/migration"; import {stageProducer} from "@jimmie-potts/hub/migration-routes"; if([createCommandDiagnostics,startHub,launchOwner,stageProducer].some(value=>typeof value!=="function"))process.exit(1);'],consumer),'');
  }
  console.log(JSON.stringify({archive:output,sha256:sha(bytes),sourceRevision:revision,reproducible:true,isolatedTests:process.argv.includes('--test')}));
}finally{await rm(scratch,{recursive:true,force:true});}
