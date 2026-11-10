// The two reviewed standalone entries. Fixed owning commands are policy, never PR input.
import {createHash} from 'node:crypto';
export const OWNER_NOTICE_TITLE='Standalone command';
export const OWNERS=Object.freeze({
 wemo:Object.freeze({path:'modules/wemo/tests/module.test.ts',compiled:'modules/wemo/dist/tests/module.test.js',
  scripts:Object.freeze({'test:wemo:built':'node --test modules/wemo/dist/tests/*.test.js'})}),
 'microduck-browser':Object.freeze({path:'apps/runtime/dashboard/tests/microduck.browser.ts',
  scripts:Object.freeze({'test:runtime-dashboard:smoke':'node apps/runtime/dashboard/tests/smoke.ts',
   'test:microduck:browser':'node apps/runtime/dashboard/tests/microduck.browser.ts'}),
  marker:'MicroDuck browser passed: finite gestures, local Stop, exact held recovery, status-only MCP, passive reload and keyboard/narrow.'}),
});
export const ownerHash=id=>createHash('sha256').update(JSON.stringify(OWNERS[id]?.scripts)).digest('hex');
const ordinaryMarkdown=path=>path.endsWith('.md')&&!/(?:^|\/)(?:AGENTS|CLAUDE)\.md$/.test(path)
 &&!['docs/sdlc.md','docs/development.md','docs/architecture.md','docs/project-maintenance.md'].includes(path)
 &&!['openspec/','packages/','scripts/','tests/','.github/','docs/decisions/'].some(prefix=>path.startsWith(prefix))
 &&!/(?:^|\/)[^/]*contract[^/]*\.md$/i.test(path);
/** null preserves the existing conservative route; an empty owner list never qualifies. */
export function standaloneOwners(paths,changes,{requireModes=true}={}) {
 if(!Array.isArray(changes)||!changes.length||changes.length!==paths.length||new Set(paths).size!==paths.length)return null;
 const names=new Set(),selected=new Set();
 for(const file of changes){
  if(!file||typeof file.filename!=='string'||names.has(file.filename)||!paths.includes(file.filename)
   ||file.status!=='modified'||file.previous_filename!==undefined)return null;
  names.add(file.filename);
  if(requireModes&&(file.beforeMode!=='100644'||file.mode!=='100644'))return null;
  const owner=Object.keys(OWNERS).find(id=>OWNERS[id].path===file.filename);
  if(owner)selected.add(owner);else if(!ordinaryMarkdown(file.filename))return null;
 }
 return selected.size?Object.keys(OWNERS).filter(id=>selected.has(id)):null;
}
/** Exact tree metadata is optional evidence. Missing/truncated/non-regular input cannot narrow selection. */
export function withFileModes(changes,before,after){
 const unverified=changes.map(({beforeMode:_before,mode:_after,...file})=>file);
 if(!Array.isArray(before?.tree)||!Array.isArray(after?.tree)||before.truncated!==false||after.truncated!==false)return unverified;
 const mode=(tree,path)=>{const entries=tree.filter(row=>row.path===path);return entries.length===1&&entries[0].type==='blob'?entries[0].mode:null;};
 return unverified.map(file=>({...file,beforeMode:mode(before.tree,file.filename),mode:mode(after.tree,file.filename)}));
}
const positive=n=>Number.isSafeInteger(n)&&n>0;
const zero=n=>n===0;
/** Only bounded declared metadata, not raw test output, is published in the native completion notice. */
export function readCommandEvidence(message,{owner,head,runId,attempt}={}){
 if(typeof message!=='string'||message.length>4096)return null;
 let value;try{value=JSON.parse(message);}catch{return null;}
 const closed=(object,names)=>object&&typeof object==='object'&&!Array.isArray(object)&&Object.keys(object).length===names.length&&names.every(key=>Object.hasOwn(object,key));
 const fields=['schema','owner','head','runId','attempt','commandHash','result',...(owner==='wemo'?['coverage']:['completion','smoke'])];
 if(!closed(value,fields))return null;
 if(!value||value.schema!=='standalone-command/1'||value.owner!==owner||!Object.hasOwn(OWNERS,owner)
  ||value.head!==head||!/^[a-f0-9]{40}$/.test(value.head??'')||value.runId!==runId||!positive(value.runId)
  ||value.attempt!==attempt||!positive(value.attempt)||value.commandHash!==ownerHash(owner)||value.result!=='success')return null;
 if(owner==='wemo'){
  const c=value.coverage;
  if(!closed(c,['file','tests','passed','changedTests','failed','cancelled','skipped'])||c.file!==OWNERS.wemo.compiled||!positive(c.tests)||!positive(c.changedTests)||c.changedTests>c.tests
   ||c.passed!==c.tests||!zero(c.failed)||!zero(c.cancelled)||!zero(c.skipped))return null;
 }else if(value.completion!=='microduck-full-journey'||value.smoke!=='success')return null;
 return value;
}
