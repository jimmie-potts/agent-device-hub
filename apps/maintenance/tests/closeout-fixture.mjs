import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {acceptanceInstructions,closeoutPolicy} from '../closeout/policies.mjs';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {fixture as intakeFixture} from './fixture.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
export async function closeoutFixture(options={}){
 const repository=options.repository??'jimmie-potts/agent-device-hub',policy=closeoutPolicy(repository);
 const issue={number:1,title:'Synthetic defect',state:'open',body:'Source and installed acceptance are required.',labels:[{name:'status:in-progress'}],assignees:[]};
 const related={number:19,title:'Dependent source work',state:'open',body:'## Acceptance\nDeliver the dependent source work.',labels:[],assignees:[]};
 if(options.related)issue.blocking=[{number:19,url:`https://github.com/${repository}/issues/19`,state:'OPEN',stateReason:null}];
 const f=await intakeFixture({...options,issues:options.related?[issue,related]:[issue]});await f.change({repository});
 const root=new URL('../../../',import.meta.url).pathname;
 const directory=join(f.directory,'closeout'),stateDirectory=join(f.directory,'closeout-state');await mkdir(directory,{mode:0o700});await mkdir(stateDirectory,{mode:0o700});
 const corpus=JSON.parse(await readFile(join(root,'packages/contracts/fixtures/install-receipt-v1.json'),'utf8'));
 const bytes=JSON.stringify({...corpus.cases.find(x=>x.id==='upgrade-success').value,runtime:policy.runtime??'hub'}),receipt=join(directory,'installation.json');await writeFile(receipt,bytes,{mode:0o600});
 const planning={timeoutSeconds:3,codex:f.config.tools.codex,python:await realpath('/usr/bin/python3'),checkout:f.config.checkout,owningCheckout:f.config.checkout,planWork:f.config.planWork,recommendationPolicy:f.config.planWork,recommendations:join(root,'docs/work-guide/work/recommendations.py'),helper:options.helper??join(root,'apps/maintenance/closeout/recommendation.py'),model:'gpt-6-astra',policyRevision:'a'.repeat(40),files:{}};
 for(const key of ['codex','python','planWork','recommendationPolicy','recommendations','helper'])planning.files[planning[key]]=hash(await readFile(planning[key]));
  planning.files[join(root,'docs/work-guide/work/story_sections.py')]=hash(await readFile(join(root,'docs/work-guide/work/story_sections.py')));
 const config={schemaVersion:1,repository,gh:f.config.tools.gh,installationId:'primary',capacityBytes:16*1024*1024,stateDirectory,planning},configPath=join(f.directory,'closeout-config.json');
 const request={schemaVersion:1,operation:'closeout',repository:config.repository,issue:1,pr:2,merge:'b'.repeat(40),acceptedSourceOnly:null,installationReceipt:{path:receipt,sha256:hash(bytes)},requirementsBodySha256:hash(issue.body),requiredAcceptance:['source','installed'],deadline:Date.now()/1000+30,evidenceDirectory:directory};
 if(!policy.runtime)await saveProof({config,input:request},pythonJSON(toolProof({config,input:request})));
 await pinAcceptance(config);await writeFile(configPath,JSON.stringify(config),{mode:0o600});
 return {...f,config,configPath,request};
}

export const pythonJSON=value=>{
 const r=spawnSync('/usr/bin/python3',['-I','-c','import json,sys; print(json.dumps(json.load(sys.stdin),sort_keys=True,separators=(",",":")))'],{input:JSON.stringify(value),encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);return r.stdout.trim();
};
export async function saveProof(f,proof){
 const bytes=typeof proof==='string'?proof:JSON.stringify(proof);await writeFile(f.input.installationReceipt.path,bytes,{mode:0o600});
 f.input.installationReceipt.sha256=hash(bytes);
}
export function toolProof(f){
 const skills=f.input.repository.endsWith('/agent-skills'),checkout='/synthetic/catalog';
 const files=[{path:skills?'skills/example/SKILL.md':'scripts/example.py',mode:'100644',size:12,sha256:'a'.repeat(64)}];
 const link={path:'/synthetic/.dotfiles',target:checkout,device:1,inode:2};
 const links=['codex','claude'].map(agent=>({agent,skill:'example',path:`/synthetic/${agent}/skills/example`,target:checkout+'/skills/example',device:1,inode:2}));
 const preservedDirty=[{path:'notes/example.txt',status:'??',content:{text:'Synthetic snowman ☃'},index:[]}];
 const plan={schemaVersion:1,repository:f.input.repository,issue:f.input.issue,owner:'primary',checkout,previousRevision:'a'.repeat(40),targetRevision:f.input.merge,remoteMain:f.input.merge,commits:[f.input.merge],files,preservedDirty,configSha256:'c'.repeat(64),deadline:f.input.deadline,...(skills?{links,requiredSkills:['example']}:{link})};
 const readback={kind:'installed-files',revision:f.input.merge,files,preservedDirtySha256:hash(pythonJSON(preservedDirty)),...(skills?{links,managerStatus:{codex:{sha256:'d'.repeat(64),status:'correct'},claude:{sha256:'e'.repeat(64),status:'correct'}}}:{linkTarget:checkout})};
 f.config.planning??={python:'/usr/bin/python3'};
 f.config.installedFiles={configSha256:plan.configSha256,checkout,allowedPaths:files.map(x=>x.path),protectedPaths:[],...(skills?{requiredSkills:['example'],links:links.map(({agent,skill,path})=>({agent,skill,path}))}:{link:link.path})};
 return {schemaVersion:'installed-files/1.0',repository:f.input.repository,issue:f.input.issue,owner:'primary',outcome:'succeeded',targetRevision:f.input.merge,plan,planSha256:hash(pythonJSON(plan)),readback,verifiedAt:Date.now()/1000};
}

export async function pinAcceptance(config){
 const p=config.planning;p.owningCheckout??=p.checkout;
 for(const path of acceptanceInstructions(config)){
  await mkdir(dirname(path),{recursive:true});await writeFile(path,'Synthetic owning acceptance instructions. Preserve client and physical acceptance.\n');
  p.files[path]=hash(await readFile(path));
 }
}
