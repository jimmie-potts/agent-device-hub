import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFile,cp,mkdir,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const NAME='@jimmie-potts/agent-state',VERSION='2.0.0';
const LIFECYCLE='@jimmie-potts/agent-lifecycle-contracts',LIFECYCLE_VERSION='1.0.0';
const LIFECYCLE_SHA='669c8e3d8b2bac5255ea613eae96134c324515b4e7a767887e86fa59b87fef85';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const compare=(a,b)=>a<b?-1:a>b?1:0;
function run(command,args,cwd){
  const result=spawnSync(command,args,{cwd,encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},maxBuffer:8*1024*1024});
  if(result.error||result.status!==0)throw new Error(result.error?.message??`${command} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
function npm(args,cwd){
  if(!process.env.npm_execpath)throw new Error('npm-execpath-unavailable');
  return run(process.execPath,[process.env.npm_execpath,...args],cwd);
}
async function files(directory,prefix=''){
  const result=[];
  for(const entry of (await readdir(join(directory,prefix),{withFileTypes:true})).sort((a,b)=>compare(a.name,b.name))){
    if(!prefix&&['node_modules','package-lock.json'].includes(entry.name))continue;
    const name=prefix?`${prefix}/${entry.name}`:entry.name;
    if(entry.isDirectory())result.push(...await files(directory,name));
    else if(entry.isFile())result.push(name);
    else throw new Error(`unexpected-package-entry:${name}`);
  }
  return result;
}
async function verify(directory,artifact,version=VERSION){
  const manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));
  assert.equal(manifest.artifact,artifact);assert.equal(manifest.version,version);
  assert.deepEqual(await files(directory),[...Object.keys(manifest.files),'manifest.json'].sort(compare));
  for(const [name,expected] of Object.entries(manifest.files))assert.equal(sha256(await readFile(join(directory,name))),expected,`integrity:${name}`);
  return manifest;
}
async function pack(stage,destination){
  await mkdir(destination);
  const report=JSON.parse(npm(['pack','--ignore-scripts','--json','--pack-destination',destination],stage));
  assert.equal(report.length,1);return join(destination,report[0].filename);
}
const scratch=await mkdtemp(join(tmpdir(),'hub-agent-state-package-'));
try{
  const stage=join(scratch,'stage');await mkdir(stage);
  for(const name of ['package.json','src','dist','schemas','fixtures','python','tests','bin','README.md','examples'])
    await cp(join(root,'packages/agent-state',name),join(stage,name),{recursive:true,filter:path=>!path.split(/[\\/]/u).includes('__pycache__')&&!path.endsWith('.pyc')});
  await cp(join(root,'requirements-contracts.txt'),join(stage,'requirements-contracts.txt'));
  const metadata=JSON.parse(await readFile(join(stage,'package.json'),'utf8'));
  assert.equal(metadata.name,NAME);assert.equal(metadata.version,VERSION);
  assert.equal(metadata.dependencies[LIFECYCLE],LIFECYCLE_VERSION);assert.equal(metadata.dependencies.ajv,'8.20.0');
  metadata.bundleDependencies=[LIFECYCLE];
  const packageBytes=JSON.stringify(metadata,null,2)+'\n';
  await writeFile(join(stage,'package.json'),packageBytes);
  const dependency=join(root,'scripts/performance/vendor/jimmie-potts-agent-lifecycle-contracts-1.0.0.tgz');
  assert.equal(sha256(await readFile(dependency)),LIFECYCLE_SHA,'pinned lifecycle archive');
  npm(['install','--ignore-scripts','--no-audit','--no-fund',dependency],stage);
  await writeFile(join(stage,'package.json'),packageBytes);
  await rm(join(stage,'package-lock.json'),{force:true});
  const stagedLifecycle=join(stage,'node_modules/@jimmie-potts/agent-lifecycle-contracts');
  const lifecycleManifest=await verify(stagedLifecycle,LIFECYCLE,LIFECYCLE_VERSION);
  const lifecycleManifestSha256=sha256(await readFile(join(stagedLifecycle,'manifest.json')));
  const hashes={};for(const name of await files(stage))hashes[name]=sha256(await readFile(join(stage,name)));
  await writeFile(join(stage,'manifest.json'),JSON.stringify({artifact:NAME,version:VERSION,apiVersion:'1.0',formatVersion:'1.0',schemaDraft:'2020-12',fixtureFormat:1,
    lifecycleVersion:LIFECYCLE_VERSION,lifecycleSha256:LIFECYCLE_SHA,lifecycleManifestSha256,lifecycleFixtureFormat:lifecycleManifest.fixtureFormat,files:hashes},null,2)+'\n');
  const first=await pack(stage,join(scratch,'first')),second=await pack(stage,join(scratch,'second'));
  const bytes=await readFile(first);assert.deepEqual(bytes,await readFile(second),'repeated archive bytes');
  const checksum=sha256(bytes),destination=join(root,'artifacts');await mkdir(destination,{recursive:true});
  const archive=join(destination,basename(first));await copyFile(first,archive);
  await writeFile(`${archive}.sha256`,`${checksum}  ${basename(archive)}\n`);
  if(process.argv.includes('--test')){
    const consumer=join(scratch,'consumer');await mkdir(consumer);
    await writeFile(join(consumer,'package.json'),JSON.stringify({name:'isolated-agent-state-consumer',private:true,type:'module'}));
    npm(['install','--ignore-scripts','--no-audit','--no-fund',archive],consumer);
    const installed=join(consumer,'node_modules/@jimmie-potts/agent-state');
    const manifest=await verify(installed,NAME);
    assert.equal(manifest.lifecycleSha256,LIFECYCLE_SHA);assert.equal(manifest.lifecycleManifestSha256,lifecycleManifestSha256);
    const lifecycle=join(installed,'node_modules/@jimmie-potts/agent-lifecycle-contracts');
    assert.deepEqual(await verify(lifecycle,LIFECYCLE,LIFECYCLE_VERSION),lifecycleManifest);
    const nodeTests=(await readdir(join(installed,'tests'))).filter(name=>name.endsWith('.test.mjs')).sort(compare).map(name=>join(installed,'tests',name));
    assert.ok(nodeTests.length);assert.match(run(process.execPath,['--test',...nodeTests],consumer),/fail 0/u);
    assert.equal(run(process.execPath,['--input-type=module','-e',
      'import {VERSION,FORMAT_VERSION,validateSnapshot} from "@jimmie-potts/agent-state"; import {normalizeHook} from "@jimmie-potts/agent-state/providers"; if(VERSION!=="2.0.0"||FORMAT_VERSION!=="1.0"||validateSnapshot({}).ok||typeof normalizeHook!=="function")process.exit(1);'],consumer),'');
    run(process.execPath,[join(root,'node_modules/typescript/bin/tsc'),'--noEmit','--strict','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext',join(installed,'examples/embed.ts')],consumer);
    const python=process.platform==='win32'?'python':'python3';
    const code='import sys, unittest; sys.path.insert(0,sys.argv[1]); suite=unittest.defaultTestLoader.discover(sys.argv[2],pattern="test_*.py"); result=unittest.TextTestRunner().run(suite); sys.exit(not result.wasSuccessful())';
    run(python,['-c',code,join(installed,'python'),join(installed,'tests')],consumer);
    console.log('Isolated imports, declarations, manifests, Node/process tests, Python fixtures and repeated archive bytes passed.');
  }
  console.log(JSON.stringify({archive,sha256:checksum,version:VERSION,lifecycleSha256:LIFECYCLE_SHA,reproducible:true}));
}finally{await rm(scratch,{recursive:true,force:true});}
