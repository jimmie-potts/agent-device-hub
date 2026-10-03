import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const input=async()=>{let s='';for await(const chunk of process.stdin)s+=chunk;return s;};
export async function fake(tool,path){
 const f=JSON.parse(await readFile(path,'utf8')),args=process.argv.slice(2);f.calls.push({tool,args});
 const save=()=>writeFile(path,JSON.stringify(f));
 await save();
 if(tool==='journalctl'){
  if(f.mode==='query-unavailable')process.exit(1);
  process.stdout.write(f.row);if(f.mode==='partial-query')process.exitCode=1;return;
 }
 if(tool==='git'){
  const command=args[0];
  if(command==='remote')console.log('https://github.com/jimmie-potts/agent-device-hub');
  else if(command==='rev-parse')console.log(f.revision);
  else if(command==='ls-tree')console.log('100644 blob '+f.revision+'\t'+args.at(-1));
  else if(command==='show')process.stdout.write(f.source);
  else if(command!=='fetch')throw new Error('unexpected fake git operation');
  return;
 }
 if(tool==='codex'){
  f.apiKeyOffered=Boolean(process.env.OPENAI_API_KEY||process.env.AZURE_OPENAI_API_KEY);await save();
  if(args[0]==='login'){console.error('Logged in using ChatGPT');return;}
  const prompt=await input();f.prompt=prompt;
  const value=JSON.parse(prompt.slice(prompt.lastIndexOf('\n')+1));
  if(value.selected){
   const hash=text=>createHash('sha256').update(text).digest('hex');
   const result={status:'complete',selected:{url:value.selected.url,bodySha256:hash(value.selected.body),allAcceptanceReviewed:true,requiredAcceptance:f.mode==='closeout-physical'?['source','installed','physical']:['source','installed'],acceptedSourceOnly:null,satisfied:true},affected:value.related.map(item=>({url:item.url,bodySha256:hash(item.body),changedMeaning:false,hold:'unchanged',recommendation:{action:'unchanged',session:'One-shot',surface:'Backend',codex:'gpt-6.1-sol',claude:'opus',effort:'high',codexReviewer:'gpt-6-astra',claudeReviewer:'opus',cheaperClaude:'none',missing:'none'},criteria:[{line:1,kind:'physical',status:'pending',owner:item.url,nextAction:'complete-physical-acceptance',evidenceUrl:null,observationDate:null}]}))};
   if(f.mode==='closeout-advice')for(const item of result.affected){item.recommendation.action='refresh';item.criteria[0].line=2;}
   await writeFile(args[args.indexOf('--output-last-message')+1],JSON.stringify(result),{mode:0o600});await save();
   console.log(JSON.stringify({type:'thread.started'}));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:100,output_tokens:50}}));return;
  }
  let proposal={schemaVersion:1,fingerprint:value.finding.fingerprint,sourceRevision:value.sourceRevision,status:'supported',kind:'bug',existingIssue:f.existingIssue??null,references:['defect','regression','north-star','architecture','reuse'].map(role=>({role,path:['north-star','architecture'].includes(role)?'docs/architecture.md':role==='regression'?'apps/hub/tests/storage.test.mjs':'apps/hub/src/storage.ts',sha256:f.sourceDigest,start:1,end:1})),dependencies:[],assessment:{complexity:'medium',uncertainty:'low',impact:'medium'},explanation:'Synthetic verified diagnosis. Private detail must not enter public body.'};
  if(f.mode==='performance'){proposal.kind='performance';proposal.status='deferred';}
  if(f.mode==='speculative'){proposal.kind='improvement';proposal.status='deferred';}
  if(f.mode==='expected'){proposal.kind='expected';proposal.status='deferred';}
  if(f.mode==='missing-source')proposal.references=[];
  if(f.mode==='bad-source')proposal.references[0].sha256='b'.repeat(64);
  if(f.mode==='adversarial'){proposal.command='rm -rf /';proposal.explanation='private-device private-cursor';}
  if(f.mode==='stale-source')f.revision='b'.repeat(40);
  const out=args[args.indexOf('--output-last-message')+1];
  await writeFile(out,JSON.stringify(proposal),{mode:0o600});await save();
  console.log(JSON.stringify({type:'thread.started'}));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:100,cached_input_tokens:0,output_tokens:50}}));return;
 }
 if(tool==='gh'){
  const endpoint=args.find(x=>x.startsWith('repos/')),method=args.includes('--method')?args[args.indexOf('--method')+1]:args.includes('-X')?args[args.indexOf('-X')+1]:'GET';
  if(args.includes('graphql')){
   const query=JSON.parse(await input()).query,number=Number(query.match(/issue\(number:(\d+)\)/)?.[1]),issue=f.issues.find(i=>i.number===number);
   if(!issue)process.exit(1);
   const list=nodes=>({nodes,pageInfo:{hasNextPage:false}});
   const value={...issue,id:'issue-'+number,url:'https://github.com/jimmie-potts/agent-device-hub/issues/'+number,state:issue.state.toUpperCase(),stateReason:issue.state==='closed'?'COMPLETED':null,updatedAt:'2026-10-03T00:00:00Z',labels:list(issue.labels),assignees:list([]),parent:null,blockedBy:list(issue.blockedBy??[]),blocking:list(issue.blocking??[]),subIssues:list([]),projectItems:list([])};
   console.log(JSON.stringify({data:{repository:{issue:value},node:{fields:list([{id:'PVTSSF_lAHOAu24Wc4Bkz2NzhjjEkM',name:'Status',options:[{id:'done',name:'Done'}]}])}}}));return;
  }
  if(endpoint.includes('/pulls/'))return console.log(JSON.stringify({merged:true,merge_commit_sha:'b'.repeat(40)}));
  if(endpoint.includes('/comments')){
   if(method==='POST'){const payload=JSON.parse(await input());(f.comments??=[]).push({id:1,body:payload.body});await save();return console.log('{}');}
   return console.log(JSON.stringify(f.comments??[]));
  }
  if(method==='PATCH'){const payload=JSON.parse(await input()),number=Number(endpoint.split('/').at(-1)),issue=f.issues.find(i=>i.number===number);if(!issue)process.exit(1);Object.assign(issue,payload);if(payload.labels)issue.labels=payload.labels.map(name=>({name}));await save();return console.log(JSON.stringify(issue));}

  if(endpoint.endsWith('git/ref/heads/main'))return console.log(JSON.stringify({object:{sha:f.revision}}));
  if(endpoint.includes('issues?')){
   if(f.mode==='lookup-unavailable')process.exit(1);
   const page=Number(new URL('https://fixture/'+endpoint).searchParams.get('page'));
   console.log(JSON.stringify(f.issues.slice((page-1)*100,page*100)));return;
  }
  if(method==='POST'){
   const payload=JSON.parse(await input());
   const issue={number:12,state:'open',title:payload.title,body:payload.body,labels:payload.labels.map(name=>({name})),assignees:[]};f.issues.push(issue);f.creates++;await save();
   if(f.mode==='lost-response')process.exit(1);
   console.log(JSON.stringify(issue));return;
  }
  const number=Number(endpoint.split('/').at(-1));const issue=f.issues.find(i=>i.number===number);
  if(!issue)process.exit(1);console.log(JSON.stringify(issue));return;
 }
 throw new Error('unexpected fake tool');
}
