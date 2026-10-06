import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRecord} from '../../../packages/observability/dist/index.js';
const digest=v=>createHash('sha256').update(v).digest('hex');
const source='export function storage() { throw new Error("synthetic defect"); }\n';
export async function fixture(options={}){
 const directory=await mkdtemp(join(options.parent??tmpdir(),'maintenance-fixture-'));
 const state=join(directory,'state'),checkout=join(directory,'checkout'),evidence=join(directory,'evidence');
 await Promise.all([mkdir(state,{mode:0o700}),mkdir(checkout),mkdir(evidence,{mode:0o700})]);
 const revision='a'.repeat(40),now=Date.now();
 const record=createRecord({timestamp:new Date(now-1000).toISOString(),severity_text:'ERROR',event_name:'operation.failed',resource:{'service.namespace':'bunny','service.name':'hub','service.version':'1.0.0','service.instance.id':'00000000-0000-4000-8000-000000000001','deployment.environment.name':'test'},scope:{name:'bunny.storage',version:'1.0.0'},attributes:{'bunny.provenance':'source','bunny.operation':'storage','bunny.outcome':'failed','bunny.reason':'sink-error','bunny.device.id':'private-device'}}).value;
 const row=JSON.stringify({_SYSTEMD_USER_UNIT:'hub.service',__REALTIME_TIMESTAMP:String((now-1000)*1000),__CURSOR:'private-cursor',MESSAGE:JSON.stringify(record)})+'\n';
 const fixtureState=join(directory,'fixture.json');
 await writeFile(fixtureState,JSON.stringify({mode:options.mode??'success',issues:options.issues??[],creates:0,calls:[],revision,row,source,sourceDigest:digest(source)}),{mode:0o600});
 const tools={};const files={};
 for(const tool of ['journalctl','codex','gh','git']){
  const path=join(directory,tool);
  const text=`#!${process.execPath}\nimport {fake} from ${JSON.stringify(new URL('./fake.mjs',import.meta.url).href)};\nawait fake(${JSON.stringify(tool)},${JSON.stringify(fixtureState)});\n`;
  await writeFile(path,text,{mode:0o700});tools[tool]=path;files[path]=digest(text);
 }
 const skill=join(directory,'SKILL.md');await writeFile(skill,'Synthetic installed plan-work fixture.');files[skill]=digest(await readFile(skill));
 const config={schemaVersion:1,repository:'jimmie-potts/agent-device-hub',authority:'hub-maintenance',checkout,stateRoot:state,tools,planWork:skill,files,model:'gpt-6-astra',units:['hub.service'],limits:{windowSeconds:86400,querySeconds:2,planningSeconds:3,maxRows:100,maxBytes:100000,maxFindings:3,maxPages:3,capacityBytes:16*1024*1024}};
 const configPath=join(directory,'config.json');await writeFile(configPath,JSON.stringify(config),{mode:0o600});
 const request={schemaVersion:1,operation:'intake',runId:'fixture-run',deadline:Math.floor(Date.now()/1000)+300,authority:'hub-maintenance',evidenceDirectory:evidence};
 return {directory,config,configPath,request,fixtureState,cli:resolve(fileURLToPath(new URL('../bin/maintenance.mjs',import.meta.url))),async read(){return JSON.parse(await readFile(fixtureState,'utf8'));},async change(changes){await writeFile(fixtureState,JSON.stringify({...await this.read(),...changes}));},async close(){await rm(directory,{recursive:true,force:true});}};
}
// A host test can create this fixture without a test import side effect.
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const value=await fixture({parent:process.argv[2]});
 console.log(JSON.stringify({directory:value.directory,configPath:value.configPath,fixtureState:value.fixtureState,cli:value.cli,node:process.execPath,authority:value.config.authority,repository:value.config.repository}));
}
