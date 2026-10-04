import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {fixture as intakeFixture} from './fixture.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
export async function closeoutFixture(options={}){
 const issue={number:1,title:'Synthetic defect',state:'open',body:'Source and installed acceptance are required.',labels:[{name:'status:in-progress'}],assignees:[]};
 const related={number:19,title:'Dependent source work',state:'open',body:'## Acceptance\nDeliver the dependent source work.',labels:[],assignees:[]};
 if(options.related)issue.blocking=[{number:19,url:'https://github.com/jimmie-potts/agent-device-hub/issues/19',state:'OPEN',stateReason:null}];
 const f=await intakeFixture({...options,issues:options.related?[issue,related]:[issue]});
 const root=new URL('../../../',import.meta.url).pathname;
 const directory=join(f.directory,'closeout'),stateDirectory=join(f.directory,'closeout-state');await mkdir(directory,{mode:0o700});await mkdir(stateDirectory,{mode:0o700});
 const corpus=JSON.parse(await readFile(join(root,'packages/contracts/fixtures/install-receipt-v1.json'),'utf8'));
 const bytes=JSON.stringify(corpus.cases.find(x=>x.id==='upgrade-success').value),receipt=join(directory,'installation.json');await writeFile(receipt,bytes,{mode:0o600});
 const planning={timeoutSeconds:3,codex:f.config.tools.codex,python:await realpath('/usr/bin/python3'),checkout:f.config.checkout,planWork:f.config.planWork,recommendationPolicy:f.config.planWork,recommendations:join(root,'docs/work-guide/work/recommendations.py'),helper:options.helper??join(root,'apps/maintenance/closeout/recommendation.py'),model:'gpt-6-astra',policyRevision:'a'.repeat(40),files:{}};
 for(const key of ['codex','python','planWork','recommendationPolicy','recommendations','helper'])planning.files[planning[key]]=hash(await readFile(planning[key]));
  planning.files[join(root,'docs/work-guide/work/story_sections.py')]=hash(await readFile(join(root,'docs/work-guide/work/story_sections.py')));
 const config={schemaVersion:1,repository:f.config.repository,gh:f.config.tools.gh,installationId:'primary',capacityBytes:16*1024*1024,stateDirectory,planning},configPath=join(f.directory,'closeout-config.json');await writeFile(configPath,JSON.stringify(config),{mode:0o600});
 const request={schemaVersion:1,operation:'closeout',repository:config.repository,issue:1,pr:2,merge:'b'.repeat(40),acceptedSourceOnly:null,installationReceipt:{path:receipt,sha256:hash(bytes)},requirementsBodySha256:hash(issue.body),requiredAcceptance:['source','installed'],deadline:Date.now()/1000+30,evidenceDirectory:directory};
 return {...f,config,configPath,request};
}
