// Owning-source acceptance for Hub #218 and #241. No installed state or physical writer.
// RETIREMENT_PATH selects the provider/client path (default codex/desktop); run it once per supported path.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createAgentState,MemoryStorage} from '../packages/agent-state/dist/index.js';
const [pixoo,nanoleaf,output]=process.argv.slice(2);
for(const path of [pixoo,nanoleaf,output])assert.equal(resolve(path),path,'use absolute source/output paths');
const pin=JSON.parse(await readFile(new URL('../apps/hub/fixtures/pixoo-source.json',import.meta.url)));
for(const [path,hash] of Object.entries(pin.sourceFiles))assert.equal(createHash('sha256').update(await readFile(join(pixoo,path))).digest('hex'),hash,path);
const nanoPin=JSON.parse(await readFile(new URL('../apps/hub/fixtures/retirement-nanoleaf-source.json',import.meta.url)));
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:nanoleaf,encoding:'utf8'}).trim(),nanoPin.revision);
execFileSync('git',['diff','--exit-code','HEAD','--'],{cwd:nanoleaf,stdio:'pipe'});
const {DashboardPager}=await import(pathToFileURL(join(pixoo,'apps/server/dist/agent-dashboard.js')));
const pager=new DashboardPager('pixoo');let clock=1000;
const owner=await createAgentState({storage:new MemoryStorage(),ownerId:'owner',consumers:[{id:'nanoleaf',clearOnNewTurn:true},{id:'pixoo',clearOnNewTurn:false}],clock:()=>clock});
const [provider,client]=(process.env.RETIREMENT_PATH??'codex/desktop').split('/');
assert.ok(['codex/desktop','codex/cli','claude/code'].includes(`${provider}/${client}`),'RETIREMENT_PATH names a supported provider/client path');
const source={provider,client,hostId:'host',sourceId:'source'};
const identity=sessionId=>({...source,sessionId});
const event=(sessionId,kind,turn='old',parent={status:'top-level'})=>({apiVersion:'1.0',identity:identity(sessionId),turn:{status:'known',id:turn},parent,event:{kind},observedAtMs:++clock,ordering:{status:'unknown'}});
const envelope=(snapshot,connection='current')=>({apiVersion:'1.0',ownerId:'owner',connection,snapshot,admissionRejected:0,nextRequestId:'fixture-request'});
try{
 await owner.ingest(event('parent','turn.started'));
 await owner.setLabel(identity('parent'),'Old task label');
 await owner.ingest(event('child','session.started','child-turn',{status:'known',identity:identity('parent')}));
 const initial=owner.snapshot('1.1'),oldView=envelope(owner.snapshot());
 assert.equal(pager.layout(oldView,clock).rows.length,1);
 assert.equal(pager.layout(oldView,clock).rows[0].activeChildren,1);
 await owner.ingest(event('parent','runtime.ended'));
 const removed=owner.snapshot('1.1');
 assert.equal(removed.revision,initial.revision+1);
 const empty=pager.layout(envelope(owner.snapshot()),clock);
 assert.equal(empty.rows.length,0);assert.equal(empty.total,0);assert.equal(empty.connection,'current');
 const lost=pager.layout({...oldView,connection:'stale'},clock);
 assert.equal(lost.rows.length,1);assert.equal(lost.rows[0].uncertain,true);
 assert.equal(pager.layout(envelope(owner.snapshot()),clock).rows.length,0,'current empty reconnect clears retained rows');
 await owner.ingest(event('parent','turn.started','new'));
 const fresh=owner.snapshot('1.1');
 assert.ok(fresh.sessions[0].generation>initial.sessions[0].generation);
 assert.equal(pager.layout(envelope(owner.snapshot()),clock).rows[0].label,'parent');
 assert.equal(new DashboardPager('pixoo').layout(envelope(owner.snapshot()),clock).rows[0].label,'parent');
 const corpus=JSON.parse(await readFile(new URL('../packages/agent-state/fixtures/snapshots-v1.json',import.meta.url)));
 const packet={source,initial:envelope(initial),removed:envelope(removed),fresh:envelope(fresh),corpus};
 const nano=JSON.parse(execFileSync('python3',['-B',new URL('./session-retirement-nanoleaf.py',import.meta.url).pathname,nanoleaf],{input:JSON.stringify(packet),encoding:'utf8',timeout:30000,maxBuffer:1024*1024}));
 const report={hubRevision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),pixooRevision:pin.revision,nanoleafRevision:nanoPin.revision,path:`${provider}/${client}`,
  status:'passed',physical:false,installedClients:false,pixoo:{retirement:true,emptyReconnect:true,unavailableRetained:true,freshDefaults:true},nanoleaf:nano};
 await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await owner.shutdown();}
