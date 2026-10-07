import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {scratchRoot} from './scratch-root.mjs';
import {build} from 'esbuild';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const name='@jimmie-potts/bunny-observability',version='1.4.0';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
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
 const found=[];
 for(const entry of (await readdir(join(directory,prefix),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
  if(!prefix&&['node_modules','package-lock.json'].includes(entry.name))continue;
  const path=prefix?`${prefix}/${entry.name}`:entry.name;
  if(entry.isDirectory())found.push(...await files(directory,path));
  else if(entry.isFile())found.push(path);
  else throw new Error(`unexpected-entry:${path}`);
 }
 return found.sort();
}
async function verify(directory){
 const manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));
 assert.equal(manifest.artifact,name);assert.equal(manifest.version,version);
 assert.deepEqual(await files(directory),[...Object.keys(manifest.files),'manifest.json'].sort());
 for(const [path,digest] of Object.entries(manifest.files))assert.equal(hash(await readFile(join(directory,path))),digest,`integrity:${path}`);
 return manifest;
}
// Consumer lives outside every checkout; use disk-backed .local storage in the
// parent workspace, including when this command runs from a Git worktree.
const scratchBase=scratchRoot(root,'package-observability');await mkdir(scratchBase,{recursive:true});
const scratch=await mkdtemp(join(scratchBase,'observability-'));
try{
 const stage=join(scratch,'stage');await mkdir(stage);
 for(const item of ['package.json','src','dist','fixtures','python','tests','runtime','requirements-host.txt','README.md'])
  await cp(join(root,'packages/observability',item),join(stage,item),{recursive:true,filter:path=>!path.includes('__pycache__')&&!path.endsWith('.pyc')});
 await cp(join(root,'docs/observability-contract.md'),join(stage,'CONTRACT.md'));
 await cp(join(root,'requirements-contracts.txt'),join(stage,'requirements-contracts.txt'));
 const metadata=JSON.parse(await readFile(join(stage,'package.json'),'utf8'));
 assert.equal(metadata.name,name);assert.equal(metadata.version,version);
 assert.equal(metadata.dependencies.pino,'10.3.1');assert.equal(metadata.dependencies.ajv,'8.20.0');
 const hashes={};for(const path of await files(stage))hashes[path]=hash(await readFile(join(stage,path)));
 await writeFile(join(stage,'manifest.json'),JSON.stringify({artifact:name,version,schemaVersions:['1.0','1.1','1.2','1.3','1.4'],semanticConventions:'1.44.0',fixtureFormat:1,files:hashes},null,2)+'\n');
 async function pack(label){
  const destination=join(scratch,label);await mkdir(destination);
  const report=JSON.parse(npm(['pack','--ignore-scripts','--json','--pack-destination',destination],stage));
  assert.equal(report.length,1);return join(destination,report[0].filename);
 }
 const first=await pack('first'),second=await pack('second');
 const bytes=await readFile(first);assert.deepEqual(bytes,await readFile(second),'reproducible archive');
 const digest=hash(bytes),destination=join(root,'artifacts');await mkdir(destination,{recursive:true});
 const archive=join(destination,basename(first));await writeFile(archive,bytes);
 await writeFile(`${archive}.sha256`,`${digest}  ${basename(archive)}\n`);
 if(process.argv.includes('--test')){
  const consumer=join(scratch,'consumer');await mkdir(consumer);
  await writeFile(join(consumer,'package.json'),JSON.stringify({name:'isolated-observability-consumer',private:true,type:'module'}));
  assert.equal(hash(await readFile(archive)),digest,'receipt before install');
  npm(['install','--ignore-scripts','--no-audit','--no-fund',archive],consumer);
  const installed=join(consumer,'node_modules/@jimmie-potts/bunny-observability');
  const manifest=await verify(installed);
  assert.deepEqual(manifest.schemaVersions,['1.0','1.1','1.2','1.3','1.4']);
  const tests=(await readdir(join(installed,'tests'))).filter(file=>file.endsWith('.test.mjs')).sort().map(file=>join(installed,'tests',file));
  assert.match(run(process.execPath,['--test',...tests],consumer),/fail 0/u);
  run(process.env.PYTHON??'python3',['-m','unittest','discover','-s',join(installed,'tests'),'-p','test_*.py'],consumer);
  run(process.execPath,[join(installed,'tests/query.mjs')],consumer);
  assert.equal(run(process.execPath,['--input-type=module','-e',
   'import {noop,validateRecord} from "@jimmie-potts/bunny-observability"; import {DiagnosticContext} from "@jimmie-potts/bunny-observability/node"; if(noop.emit({})||validateRecord({}).ok||new DiagnosticContext().current()!==undefined)process.exit(1);'],consumer),'');
  const browser=await build({entryPoints:[join(installed,'dist/index.js')],bundle:true,platform:'browser',format:'esm',write:false});
  assert.equal(browser.errors.length,0);
  await writeFile(join(consumer,'types.ts'), 'import {createRecord, type DiagnosticRecord} from "@jimmie-potts/bunny-observability"; import {createHostDiagnostics} from "@jimmie-potts/bunny-observability/host"; void createHostDiagnostics({enabled:false}); const result=createRecord({}); if(result.ok){const record:DiagnosticRecord=result.value; console.log(record.event_name); }\n');
  run(process.execPath,[join(root,'node_modules/typescript/bin/tsc'),'--noEmit','--strict','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext',join(consumer,'types.ts')],consumer);
  // Demonstrate the consumer detects a changed file, not merely matching copies.
  const fixture=join(installed,'fixtures/records.json');await writeFile(fixture,'{}\n');
  await assert.rejects(verify(installed),/integrity:fixtures\/records.json/);
  console.log('Archive reproducibility, checksum/manifest, external Node/Python/query, browser bundle and corruption detection passed.');
 }
 console.log(JSON.stringify({archive,sha256:digest,manifestSha256:hash(await readFile(join(stage,'manifest.json'))),version,reproducible:true}));
}finally{await rm(scratch,{recursive:true,force:true});}
