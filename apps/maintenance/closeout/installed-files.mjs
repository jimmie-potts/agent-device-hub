import {isAbsolute,resolve,dirname,join} from 'node:path';
import {runProcess} from '../dist/process.js';

const require=(ok,reason)=>{if(!ok)throw new Error(reason);};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const revision=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const absolute=v=>typeof v==='string'&&isAbsolute(v)&&resolve(v)===v&&!v.includes('\0');
const relative=v=>typeof v==='string'&&/^[A-Za-z0-9_-][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$/.test(v);
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
const equal=(a,b)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
const below=(path,parent)=>path===parent||path.startsWith(parent+'/');
const skill=v=>typeof v==='string'&&/^[a-z0-9][a-z0-9-]{0,99}$/.test(v);
const paths=v=>Array.isArray(v)&&v.length<=1000&&v.every(relative)&&new Set(v).size===v.length;
const link=v=>absolute(v.path)&&typeof v.target==='string'&&v.target.length>0&&!v.target.includes('\0')&&integer(v.device)&&integer(v.inode);
const DIGESTS=`import hashlib,json,sys
r=json.load(sys.stdin)
def digest(v): return hashlib.sha256(json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()).hexdigest()
print(json.dumps({'plan':digest(r['plan']),'preservedDirty':digest(r['plan']['preservedDirty'])}))
`;

export async function validateInstalledFiles(bytes,receipt,input,config){
 const skills=input.repository==='jimmie-potts/agent-skills',trusted=config.installedFiles;
 const settings=['configSha256','checkout','allowedPaths','protectedPaths',...(skills?['requiredSkills','links']:['link'])];
 require(exact(trusted,settings)&&digest(trusted.configSha256)&&absolute(trusted.checkout)&&paths(trusted.allowedPaths)&&trusted.allowedPaths.length>0&&paths(trusted.protectedPaths),'installed-files-policy-invalid');
 require(exact(receipt,['schemaVersion','repository','issue','owner','outcome','targetRevision','plan','planSha256','readback','verifiedAt'])&&
  receipt.schemaVersion==='installed-files/1.0'&&receipt.repository===input.repository&&receipt.issue===input.issue&&receipt.owner===config.installationId&&
  receipt.outcome==='succeeded'&&receipt.targetRevision===input.merge&&digest(receipt.planSha256)&&Number.isFinite(receipt.verifiedAt)&&receipt.verifiedAt>0&&receipt.verifiedAt<=Date.now()/1000+5,'installed-files-identity-mismatch');
 const plan=receipt.plan,readback=receipt.readback;
 require(exact(plan,['schemaVersion','repository','issue','owner','checkout','previousRevision','targetRevision','remoteMain','commits','files','preservedDirty','configSha256','deadline',...(skills?['links','requiredSkills']:['link'])])&&
  plan.schemaVersion===1&&plan.repository===input.repository&&plan.issue===input.issue&&plan.owner===config.installationId&&plan.checkout===trusted.checkout&&
  plan.targetRevision===input.merge&&revision(plan.previousRevision)&&plan.previousRevision!==plan.targetRevision&&revision(plan.remoteMain)&&
  Array.isArray(plan.commits)&&plan.commits.length>0&&plan.commits.length<=1000&&plan.commits.every(revision)&&new Set(plan.commits).size===plan.commits.length&&plan.commits.at(-1)===input.merge&&
  plan.configSha256===trusted.configSha256&&Number.isFinite(plan.deadline)&&plan.deadline>0,'installed-files-plan-invalid');
 const fixedProtected=skills?['deliver-work','review-work','code-review','plan-work','tdd','writing-for-agents','unslop'].map(name=>'skills/'+name):['AGENTS.md','README.md','docs/nightly-queue.md','scripts/dotfiles_install.py'];
 require(Array.isArray(plan.files)&&plan.files.length>0&&plan.files.length<=1000&&new Set(plan.files.map(x=>x.path)).size===plan.files.length,'installed-files-inventory-invalid');
 for(const file of plan.files){
  require(exact(file,['path','sha256','size','mode'])&&relative(file.path)&&digest(file.sha256)&&integer(file.size)&&file.size<=8*1024*1024&&['100644','100755'].includes(file.mode),'installed-files-inventory-invalid');
  require(trusted.allowedPaths.includes(file.path)&&![...fixedProtected,...trusted.protectedPaths].some(path=>below(file.path,path))&&
   (skills?['tests','docs'].includes(file.path.split('/')[0])||file.path.startsWith('skills/')&&skill(file.path.split('/')[1])&&file.path.split('/').length>=3:['scripts','tests','docs'].includes(file.path.split('/')[0])&&!file.path.startsWith('scripts/nightly_')),'installed-files-path-not-authorized');
 }
 require(Array.isArray(plan.preservedDirty)&&plan.preservedDirty.length<=1000&&plan.preservedDirty.every(x=>exact(x,['path','status','content','index'])&&
  typeof x.path==='string'&&!isAbsolute(x.path)&&!x.path.split('/').some(p=>p==='..'||p==='.'||p==='')&&!x.path.includes('\0')&&
  typeof x.status==='string'&&x.status.length===2&&x.content&&typeof x.content==='object'&&!Array.isArray(x.content)&&Array.isArray(x.index)&&x.index.every(y=>typeof y==='string')&&
  !plan.files.some(file=>file.path===x.path)),'installed-files-preservation-invalid');
 require(exact(readback,['kind','revision','files','preservedDirtySha256',...(skills?['links','managerStatus']:['linkTarget'])])&&readback.kind==='installed-files'&&readback.revision===input.merge&&equal(readback.files,plan.files)&&digest(readback.preservedDirtySha256),'installed-files-readback-invalid');
 if(skills){
  require(Array.isArray(trusted.requiredSkills)&&trusted.requiredSkills.length>0&&trusted.requiredSkills.length<=1000&&trusted.requiredSkills.every(skill)&&new Set(trusted.requiredSkills).size===trusted.requiredSkills.length&&equal(plan.requiredSkills,trusted.requiredSkills),'installed-skills-requirements-mismatch');
  require(Array.isArray(trusted.links)&&trusted.links.length>0&&trusted.links.length<=2000&&trusted.links.every(x=>exact(x,['agent','skill','path'])&&['codex','claude'].includes(x.agent)&&skill(x.skill)&&absolute(x.path)),'installed-skills-link-policy-invalid');
  require(Array.isArray(plan.links)&&plan.links.length===trusted.links.length&&new Set(plan.links.map(x=>x.path)).size===plan.links.length&&new Set(plan.links.map(x=>`${x.agent}/${x.skill}`)).size===plan.links.length&&plan.links.every((x,i)=>exact(x,['agent','skill','path','target','device','inode'])&&link(x)&&
   x.agent===trusted.links[i].agent&&x.skill===trusted.links[i].skill&&x.path===trusted.links[i].path&&resolve(dirname(x.path),x.target)===join(plan.checkout,'skills',x.skill))&&equal(readback.links,plan.links),'installed-skills-links-invalid');
  require(trusted.requiredSkills.every(name=>plan.links.some(x=>x.skill===name))&&plan.files.filter(file=>file.path.startsWith('skills/')).every(file=>plan.links.some(x=>x.skill===file.path.split('/')[1])),'installed-skills-loading-proof-missing');
  require(exact(readback.managerStatus,['codex','claude'])&&Object.values(readback.managerStatus).every(x=>exact(x,['sha256','status'])&&digest(x.sha256)&&x.status==='correct'),'installed-skills-manager-unverified');
 }else{
  require(absolute(trusted.link)&&exact(plan.link,['path','target','device','inode'])&&link(plan.link)&&plan.link.path===trusted.link&&
   resolve(dirname(plan.link.path),plan.link.target)===plan.checkout&&readback.linkTarget===plan.checkout,'installed-files-link-mismatch');
 }
 require(absolute(config.planning?.python),'installed-files-digest-tool-missing');
 const result=await runProcess(config.planning.python,['-I','-c',DIGESTS],{deadline:input.deadline*1000,maxBytes:8192,input:bytes.toString()});
 const hashes=JSON.parse(result.stdout);
 require(hashes.plan===receipt.planSha256&&hashes.preservedDirty===readback.preservedDirtySha256,'installed-files-digest-mismatch');
 return true;
}
