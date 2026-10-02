import {spawnSync} from 'node:child_process';
import {fullRevision} from './files.js';
import type {Source} from './plan.js';

function git(repository:string,args:string[]):string{
 const result=spawnSync('git',['--no-optional-locks',...args],{cwd:repository,encoding:'utf8',timeout:15000,maxBuffer:16*1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'}});
 if(result.error||result.status!==0)throw new Error('install-source-unavailable');
 return result.stdout.trim();
}
export function remoteMain(repository:string):string|null{
 try{const value=git(repository,['ls-remote','--exit-code','origin','refs/heads/main']).split(/\s/)[0];return fullRevision(value)?value:null;}catch{return null;}
}
export function inspectSource(repository:string,request:string,previous:string|null):Source{
 if(git(repository,['status','--porcelain=v1','--untracked-files=normal']))throw new Error('dirty-install-source');
 if(!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/.test(request))throw new Error('invalid-install-target');
 const mergedMain=remoteMain(repository);if(!mergedMain)throw new Error('install-remote-unknown');
 const head=git(repository,['rev-parse','--verify','HEAD^{commit}']);
 const target=request==='main'||request==='origin/main'?mergedMain:git(repository,['rev-parse','--verify',request+'^{commit}']);
 if(!fullRevision(head)||!fullRevision(target))throw new Error('unmerged-install-source');
 try{git(repository,['merge-base','--is-ancestor',target,mergedMain]);git(repository,['merge-base','--is-ancestor',head,mergedMain]);}catch{throw new Error('unmerged-install-source');}
 let comparison:Source['comparison']={status:'unknown',reason:'legacy-source-unknown'},commits:Source['commits']=[],removedCommits:Source['commits']=[],components:string[]=[];
 if(previous&&fullRevision(previous)){
  try{
   git(repository,['cat-file','-e',previous+'^{commit}']);
   const history=(range:string)=>{const rows=git(repository,['log','--reverse','--format=%H%x00%s',range,'--']);
   return rows?rows.split('\n').map(row=>{const [sha,...rest]=row.split('\0'),subject=rest.join('\0');if(!fullRevision(sha))throw new Error('invalid-source-history');return {sha,subject,pullRequests:[...subject.matchAll(/\(#([1-9][0-9]*)\)/g)].map(match=>Number(match[1]))};}):[];};
   commits=history(previous+'..'+target);removedCommits=history(target+'..'+previous);
   components=git(repository,['diff','--name-only',previous,target,'--']).split('\n').filter(Boolean);
   comparison={status:'complete'};
  }catch{comparison={status:'unknown',reason:'source-comparison-unavailable'};commits=[];removedCommits=[];components=[];}
 }
 return {repository,head,target,mergedMain,clean:true,comparison,commits,removedCommits,components};
}
