import {cp,mkdir,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
function run(command,args,cwd){
 const result=spawnSync(command,args,{cwd,encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 if(result.error||result.status!==0)throw new Error(result.error?.message??`${command} failed\n${result.stdout}\n${result.stderr}`);
 return result.stdout;
}
function npm(args,cwd){return run(process.execPath,[process.env.npm_execpath,...args],cwd);}
async function files(directory,prefix=''){
 const result=[];
 for(const entry of (await readdir(join(directory,prefix),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
  const path=prefix?`${prefix}/${entry.name}`:entry.name;
  if(entry.isDirectory())result.push(...await files(directory,path));
  else if(entry.isFile())result.push(path);
  else throw new Error(`Unexpected package entry: ${path}`);
 }
 return result;
}
const scratch=await mkdtemp(join(tmpdir(),'hub-lifecycle-package-'));
try{
 const stage=join(scratch,'stage');await mkdir(stage);
 for(const name of ['package.json','src','dist','schemas','fixtures','python','tests'])
  await cp(join(root,'packages/lifecycle-contracts',name),join(stage,name),{recursive:true,filter:path=>!path.includes('__pycache__')&&!path.endsWith('.pyc')});
 await cp(join(root,'docs/agent-lifecycle-contract.md'),join(stage,'README.md'));
 await cp(join(root,'requirements-contracts.txt'),join(stage,'requirements-contracts.txt'));
 await cp(join(root,'docs/provider-qualification.md'),join(stage,'provider-qualification.md'));
 const hashes={};for(const name of await files(stage))hashes[name]=sha256(await readFile(join(stage,name)));
 await writeFile(join(stage,'manifest.json'),JSON.stringify({artifact:'@jimmie-potts/agent-lifecycle-contracts',version:'1.0.0',apiVersion:'1.0',schemaDraft:'2020-12',fixtureFormat:1,files:hashes},null,2)+'\n');
 const destination=join(root,'artifacts');await mkdir(destination,{recursive:true});
 const packed=JSON.parse(npm(['pack','--ignore-scripts','--json','--pack-destination',destination],stage))[0];
 const archive=join(destination,packed.filename),checksum=sha256(await readFile(archive));
 await writeFile(`${archive}.sha256`,`${checksum}  ${packed.filename}\n`);
 if(process.argv.includes('--test')){
  const consumer=join(scratch,'consumer');await mkdir(consumer);
  await writeFile(join(consumer,'package.json'),JSON.stringify({name:'isolated-lifecycle-consumer',private:true,type:'module'}));
  assert.equal(sha256(await readFile(archive)),checksum);
  npm(['install','--ignore-scripts','--no-audit','--no-fund',archive],consumer);
  const installed=join(consumer,'node_modules/@jimmie-potts/agent-lifecycle-contracts');
  const manifest=JSON.parse(await readFile(join(installed,'manifest.json'),'utf8'));
  for(const [name,expected] of Object.entries(manifest.files))assert.equal(sha256(await readFile(join(installed,name))),expected,`Package integrity: ${name}`);
  const nodeTests=(await readdir(join(installed,'tests'))).filter(name=>name.endsWith('.test.mjs')).sort().map(name=>join(installed,'tests',name));
  const nodeOutput=run(process.execPath,['--test',...nodeTests],consumer);
  assert.match(nodeOutput,/fail 0/);
  const python=process.platform==='win32'?'python':'python3';
  const pythonCode='import sys, unittest; sys.path.insert(0,sys.argv[1]); suite=unittest.defaultTestLoader.discover(sys.argv[2],pattern="test_*.py"); result=unittest.TextTestRunner().run(suite); sys.exit(not result.wasSuccessful())';
  run(python,['-c',pythonCode,join(installed,'python'),join(installed,'tests')],consumer);
  const imported=run(process.execPath,['--input-type=module','-e','import {ARTIFACT_VERSION,validateEvent} from "@jimmie-potts/agent-lifecycle-contracts"; if(ARTIFACT_VERSION!=="1.0.0"||validateEvent({}).ok)process.exit(1);'],consumer);
  assert.equal(imported,'');
  console.log('Isolated TypeScript and Python package imports, hashes and full conformance corpus passed.');
 }
 console.log(JSON.stringify({archive,sha256:checksum,version:'1.0.0'}));
}finally{await rm(scratch,{recursive:true,force:true});}
