// Pack @jimmie-potts/app-verify as a versioned archive with a hash manifest.
// `--test` installs the archive into an isolated consumer that supplies its own
// Playwright (a peer), verifies every file hash and runs the packaged suite
// against real transient user units.
import {cp,mkdir,mkdtemp,readFile,readdir,rm,symlink,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const packageDir=join(root,'packages/app-verify');
const {name,version}=JSON.parse(await readFile(join(packageDir,'package.json'),'utf8'));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
function run(command,args,cwd,env=process.env){
 const result=spawnSync(command,args,{cwd,encoding:'utf8',env,maxBuffer:64*1024*1024});
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
if(!process.env.npm_execpath)throw new Error('Run through npm: npm run package:app-verify or npm run test:app-verify:package');
const scratchRoot=join(root,'.local/scratch/package-archives');await mkdir(scratchRoot,{recursive:true});
const scratch=await mkdtemp(join(scratchRoot,'app-verify-'));
try{
 const stage=join(scratch,'stage');await mkdir(stage);
 for(const entry of ['package.json','README.md','src','dist','examples','tests'])await cp(join(packageDir,entry),join(stage,entry),{recursive:true});
 await cp(join(root,'docs/app-verification.md'),join(stage,'app-verification.md'));
 await cp(join(root,'docs/decisions/0009-app-verification-runs.md'),join(stage,'adr-0009-app-verification-runs.md'));
 const hashes={};for(const file of await files(stage))hashes[file]=sha256(await readFile(join(stage,file)));
 await writeFile(join(stage,'manifest.json'),JSON.stringify({artifact:name,version,receiptVersion:'app-verification/1',node:'>=22',peer:{playwright:'>=1.50.0 (optional, consumer-provided)'},files:hashes},null,2)+'\n');
 const destination=join(root,'artifacts');await mkdir(destination,{recursive:true});
 const packed=JSON.parse(npm(['pack','--ignore-scripts','--json','--pack-destination',destination],stage))[0];
 const archive=join(destination,packed.filename),checksum=sha256(await readFile(archive));
 await writeFile(`${archive}.sha256`,`${checksum}  ${packed.filename}\n`);
 if(process.argv.includes('--test')){
  const consumer=join(scratch,'consumer');await mkdir(consumer);
  await writeFile(join(consumer,'package.json'),JSON.stringify({name:'isolated-app-verify-consumer',private:true,type:'module'}));
  assert.equal(sha256(await readFile(archive)),checksum);
  npm(['install','--ignore-scripts','--no-audit','--no-fund','--offline',archive],consumer);
  // The consumer supplies Playwright itself, as Nanoleaf and Pixoo do; the archive bundles none.
  for(const peer of ['playwright','playwright-core'])await symlink(join(root,'node_modules',peer),join(consumer,'node_modules',peer));
  const installed=join(consumer,'node_modules/@jimmie-potts/app-verify');
  const manifest=JSON.parse(await readFile(join(installed,'manifest.json'),'utf8'));
  for(const [file,expected] of Object.entries(manifest.files))assert.equal(sha256(await readFile(join(installed,file))),expected,`Package integrity: ${file}`);
  assert.deepEqual(await readdir(join(installed,'node_modules')).catch(()=>[]),[],'the archive installs no dependency of its own');
  assert.deepEqual((await readdir(join(consumer,'node_modules'))).sort(),['.package-lock.json','@jimmie-potts','playwright','playwright-core']);
  const imported=run(process.execPath,['--input-type=module','-e','import {VERSION,RECEIPT_VERSION,runCli,definePlugin,validateReceipt} from "@jimmie-potts/app-verify"; if(VERSION!=="'+version+'"||RECEIPT_VERSION!=="app-verification/1"||typeof runCli!=="function"||typeof definePlugin!=="function"||validateReceipt({}).ok)process.exit(1);'],consumer);
  assert.equal(imported,'');
  const tests=(await readdir(join(installed,'tests'))).filter(file=>file.endsWith('.test.mjs')).sort().map(file=>join(installed,'tests',file));
  const suite=spawnSync(process.execPath,['--test','--test-concurrency=1','--test-reporter=spec',...tests],{cwd:consumer,encoding:'utf8',maxBuffer:64*1024*1024});
  if(suite.status!==0)throw new Error(`packaged suite failed\n${suite.stdout}\n${suite.stderr}`);
  assert.match(suite.stdout,/ℹ fail 0/);
  const skipped=/ℹ skipped (\d+)/.exec(suite.stdout)?.[1];
  // A skip is never silent: the suite names its reason, and it is repeated here.
  for(const line of (suite.stdout+suite.stderr).split('\n'))if(line.startsWith('SKIP '))console.log(line);
  console.log(`Isolated consumer: archive hashes verified, imports resolved, packaged suite passed (${/ℹ pass (\d+)/.exec(suite.stdout)?.[1]} passed, ${skipped ?? 'unknown'} skipped).`);
 }
 console.log(JSON.stringify({archive,sha256:checksum,version}));
}finally{await rm(scratch,{recursive:true,force:true});}
