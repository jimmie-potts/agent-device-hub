import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {canonical} from '../../hub/dist/install/files.js';
export async function fakeNative(path,args){
 const f=JSON.parse(await readFile(path,'utf8'));f.calls.push(args[0]);
 if(args[0]==='upgrade'){
  f.running=f.receipt.target;
  await writeFile(join(f.root,'receipts',f.receipt.operationId+'.json'),JSON.stringify(f.receipt),{mode:0o600});
 }
 await writeFile(path,JSON.stringify(f),{mode:0o600});
 if(args[0]==='plan')return console.log(JSON.stringify(f.plan));
 if(args[0]==='upgrade')return console.log(JSON.stringify({receipt:f.receipt}));
 if(args[0]!=='status')throw new Error('unexpected-native-command');
 const program=join(f.root,'releases',f.running.sourceRevision);
 console.log(JSON.stringify({installed:{identity:f.running,path:program},service:'active',running:{state:'active',pid:123,start:'12345',executable:f.node,entry:join(program,'dist/cli.js'),build:{sourceRevision:f.running.sourceRevision,version:f.running.version}}}));
}
export function invoke(node,cli,configPath,request,cwd){
 return new Promise((resolve,reject)=>{
  const p=spawn(node,[cli,'--config',configPath],{cwd,stdio:['pipe','pipe','pipe']});const out=[],err=[];
  p.stdout.on('data',x=>out.push(x));p.stderr.on('data',x=>err.push(x));p.on('error',reject);
  p.on('close',code=>resolve({code,stdout:Buffer.concat(out).toString(),stderr:Buffer.concat(err).toString()}));p.stdin.end(JSON.stringify(request));
 });
}
export async function fixture({parent=tmpdir()}={}){
 const dir=await mkdtemp(join(parent,'hub-install-fixture-')),root=join(dir,'native'),sourceRoot=join(dir,'source'),evidenceRoot=join(dir,'evidence'),evidenceDirectory=join(evidenceRoot,'run');
 for(const path of [join(root,'receipts'),join(sourceRoot,'apps/hub/bin'),evidenceDirectory])await mkdir(path,{recursive:true,mode:0o700});
 const tokenFile=join(dir,'token');await writeFile(tokenFile,'a'.repeat(43),{mode:0o600});
 const statePath=join(dir,'fixture.json');const server=createServer(async(req,res)=>{
  if(req.method!=='GET'||req.url!=='/api/hub/v1/health'||req.headers.authorization!=='Bearer '+'a'.repeat(43)){res.writeHead(403);res.end();return;}
  const f=JSON.parse(await readFile(statePath,'utf8'));res.setHeader('content-type','application/json');res.end(JSON.stringify({ownerId:'hub-owner',collector:'running',admission:'open',build:{sourceRevision:f.running.sourceRevision,version:f.running.version}}));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const corpus=JSON.parse(await readFile(new URL('../../../packages/contracts/fixtures/install-receipt-v1.json',import.meta.url),'utf8'));
 const receipt=structuredClone(corpus.cases.find(x=>x.id==='upgrade-success').value);receipt.operationId='op-00000000-0000-4000-8000-000000000002';
 const config={schemaVersion:1,owner:'primary',node:process.execPath,sourceRoot,tokenFile,baselineReceipt:null,installationRoot:root,stateDirectory:join(dir,'state'),evidenceRoot,reserveSeconds:600,capacityBytes:16*1024*1024};
 const plan={bound:{owner:'primary',operation:'upgrade',migration:false,source:{target:receipt.target.sourceRevision,comparison:{status:'complete'},clean:true,removedCommits:[],components:['apps/hub/src/http.ts']},layout:{root,node:config.node},health:{tokenFile,endpoint:'http://127.0.0.1:'+server.address().port},previous:receipt.previous,stateOwner:'hub-owner'}};
 plan.digest=createHash('sha256').update(canonical(plan.bound)).digest('hex');receipt.approval.planSha256=plan.digest;
 await writeFile(statePath,JSON.stringify({root,node:config.node,plan,receipt,running:receipt.previous,calls:[]}),{mode:0o600});
 await writeFile(join(sourceRoot,'apps/hub/bin/hub-install.mjs'),`import {fakeNative} from ${JSON.stringify(import.meta.url)};await fakeNative(${JSON.stringify(statePath)},process.argv.slice(2));`);
 const configPath=join(dir,'config.json');await writeFile(configPath,JSON.stringify(config),{mode:0o600});
 const request={schemaVersion:1,operation:'install',repository:'jimmie-potts/agent-device-hub',issue:1,merge:receipt.target.sourceRevision,owner:config.owner,deadline:Date.now()/1000+1800,evidenceDirectory};
 return {dir,configPath,request,node:process.execPath,read:async()=>JSON.parse(await readFile(statePath,'utf8')),async close(){await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}};
}
