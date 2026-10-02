import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isDeepStrictEqual } from 'node:util';
import { placementOf, projectOf, datasetIdentity, validateDataset, publicationGate } from './runtime/records.mjs';
const exec = promisify(execFile);
const readGh = async args => {
  for(let attempt=1;;attempt++) {
    try {return await exec('gh',args,{maxBuffer:64*1024*1024});}
    catch(error){if(attempt>=3||!/i\/o timeout|connection reset|HTTP 50[234]/.test(error.stderr??''))throw error;
      process.stderr.write(`Transient GitHub read failure; retry ${attempt}/2\n`);}
  }
};
export const REPOSITORIES = ['jimmie-potts/agent-device-hub', 'jimmie-potts/codex-nanoleaf', 'jimmie-potts/divoom-app-upgrade'];
const apiURL = path => `https://api.github.com/${path.split('?')[0]}`;
const stamp = () => new Date().toISOString();
export const unknownProject = () => ({ source: null, public:false,
  evidence:{source:'https://github.com/jimmie-potts',observedAt:null,state:'unknown',complete:false,reason:'Project enrichment unavailable; #540 owns permitted public snapshots',pagination:null}, phases:[], commitments:[] });
export const unknownValues = () => ({ member:null, phase:{state:'unknown',value:null,recorded:null,from:null}, commitment:{state:'unknown',value:null} });
const idOf = raw => {
  const match = raw.html_url?.match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/([1-9]\d*)$/);
  if (!match || Number(match[2]) !== raw.number || raw.pull_request) throw Error('invalid required identity');
  return `${match[1]}#${match[2]}`;
};
const facts = raw => ({ id:idOf(raw), repository:raw.html_url.split('/').slice(3,5).join('/'), number:raw.number,
  nodeId:raw.node_id, url:raw.html_url, title:raw.title, body:raw.body,
  state:raw.state?.toUpperCase(), stateReason:raw.state_reason, createdAt:raw.created_at,
  updatedAt:raw.updated_at, closedAt:raw.closed_at, labels:raw.labels.map(x => typeof x === 'string' ? x : x.name).sort() });
const receipt = (path, count, pages = 1, complete = true, reason = null, observedAt = stamp()) => ({source:apiURL(path),observedAt,
  state:complete?'fresh':'failed',complete,reason,pagination:{pages,itemCount:count,totalCount:null,hasNextPage:!complete}});

const nativeCache=new Map();
export async function ghRequest(path) {
  if(nativeCache.has(path)) return nativeCache.get(path);
  if (path.startsWith('inventory:')) {
    const [owner,name] = path.slice(10).split('/');
    const query = 'query($owner:String!,$name:String!,$cursor:String){repository(owner:$owner,name:$name){issues(states:OPEN,first:100,after:$cursor){nodes{number} totalCount pageInfo{hasNextPage endCursor}}}}';
    const ids=[]; let cursor=null; let total;
    do {
      const args=['api','graphql','-f',`query=${query}`,'-f',`owner=${owner}`,'-f',`name=${name}`];
      if (cursor) args.push('-f',`cursor=${cursor}`);
      const result=JSON.parse((await readGh(args)).stdout);
      if (result.errors) throw Error('inventory GraphQL errors');
      const page=result.data.repository.issues;
      ids.push(...page.nodes.map(x=>x.number)); total=page.totalCount;
      if (page.pageInfo.hasNextPage && (!page.pageInfo.endCursor || page.pageInfo.endCursor===cursor)) throw Error('inventory nonterminal cursor');
      cursor=page.pageInfo.hasNextPage?page.pageInfo.endCursor:null;
    } while(cursor);
    if (ids.length!==total || new Set(ids).size!==ids.length) throw Error('inventory reconciliation count');
    return {data:ids,next:false};
  }
  try {
    const {stdout}=await readGh(['api',path,'--include']);
    const split=stdout.search(/\r?\n\r?\n/);
    if(split<0) throw Error('missing HTTP response headers');
    const headers=stdout.slice(0,split);
    const data=JSON.parse(stdout.slice(split).trim());
    return {data,next:/rel="next"/.test(headers),observedAt:stamp()};
  } catch(error) {
    // A native parent endpoint documents 404 for an issue with no parent. Other 404s stay failures.
    if(path.endsWith('/parent') && /HTTP 404/.test(error.stderr??'')) return {data:null,next:false,observedAt:stamp()};
    throw error;
  }
}


// A complete independent Search inventory is also supported when GraphQL quota is unavailable.
// The Search cap and incomplete_results flag are fatal, never a partial reconciliation.
export async function ghRestRequest(path) {
  if(!path.startsWith('inventory:'))return ghRequest(path);
  const repo=path.slice(10),numbers=[];let total;
  for(let page=1;;page++) {
    const data=JSON.parse((await readGh(['api',`search/issues?q=${encodeURIComponent('repo:'+repo+' is:issue is:open')}&per_page=100&page=${page}`])).stdout);
    if(data.incomplete_results||data.total_count>1000)throw Error('independent inventory search incomplete');
    total=data.total_count;numbers.push(...data.items.map(x=>x.number));
    if(numbers.length>=total)break;
    if(!data.items.length)throw Error('independent inventory truncated');
  }
  if(numbers.length!==total||new Set(numbers).size!==numbers.length)throw Error('independent inventory count');
  return {data:numbers,next:false};
}

const basicFields='repository{isPrivate} number id url title body state stateReason createdAt updatedAt closedAt labels(first:100){nodes{name} pageInfo{hasNextPage}}';
const fromRef=x=>({_stub:true,_public:!x.repository.isPrivate,number:x.number,node_id:x.id,html_url:x.url,labels:[]});
const fromGraph=x=> {
  if(x.labels.pageInfo.hasNextPage)throw Error('incomplete labels');
  return {_public:!x.repository.isPrivate,number:x.number,node_id:x.id,html_url:x.url,title:x.title,body:x.body,state:x.state.toLowerCase(),state_reason:x.stateReason?.toLowerCase()??null,created_at:x.createdAt,updated_at:x.updatedAt,closed_at:x.closedAt,labels:x.labels.nodes};
};
ghRequest.prime=async raws=> {
  // A failed refresh must not leave previous facts or relationships available to
  // the separate-read fallback. Clear each record before starting its new read.
  for(const raw of raws) {
    const base=`repos/${facts(raw).repository}/issues/${raw.number}`;
    for(const suffix of ['', '/parent', '/sub_issues?per_page=100&page=1', '/dependencies/blocked_by?per_page=100&page=1'])nativeCache.delete(base+suffix);
  }
  const query=`query($ids:[ID!]!){nodes(ids:$ids){... on Issue{${basicFields} parent{repository{isPrivate} number id url} subIssues(first:100){nodes{repository{isPrivate} number id url} pageInfo{hasNextPage}} blockedBy(first:100){nodes{repository{isPrivate} number id url} pageInfo{hasNextPage}}}}}`;
  const args=['api','graphql','-f',`query=${query}`,...raws.flatMap(x=>['-f',`ids[]=${x.node_id}`])];
  const result=JSON.parse((await readGh(args)).stdout);
  if(result.errors||result.data.nodes.some(x=>!x))throw Error('required native graph read failed');
  const observedAt=stamp();
  for(const node of result.data.nodes) {
    const raw=fromGraph(node),base=`repos/${facts(raw).repository}/issues/${raw.number}`;
    nativeCache.set(base,{data:raw,next:false,observedAt});
    nativeCache.set(base+'/parent',{data:node.parent?fromRef(node.parent):null,next:false,observedAt});
    for(const [field,suffix] of [['subIssues','sub_issues'],['blockedBy','dependencies/blocked_by']]) {
      const key=base+'/'+suffix+'?per_page=100&page=1';
      if(node[field].pageInfo.hasNextPage)nativeCache.delete(key);
      else nativeCache.set(key,{data:node[field].nodes.map(fromRef),next:false,observedAt});
    }
  }
};

ghRestRequest.checkPublic=ghRequest.checkPublic=async repo=> {
  const result=JSON.parse((await readGh(['api',`repos/${repo}`])).stdout);
  if(result.private!==false)throw Error('private source repository');
};
export async function collect({request=ghRequest, project=unknownProject()}={}) {
  if(request===ghRequest||request===ghRestRequest)nativeCache.clear();
  if(request.checkPublic)for(const repo of REPOSITORIES)await request.checkPublic(repo);
  const rawById=new Map(), relations=new Map(), factReceipts=new Map(), repositories=[],unavailable=new Set(),publicRepos=new Set(REPOSITORIES);
  const pages=async (path, optional=false) => {
    const items=[];let page=1, observedAt;
    try {
      for(;;page++) {
        const result=await request(`${path}${path.includes('?')?'&':'?'}per_page=100&page=${page}`);
        observedAt=result.observedAt??stamp();
        if(!Array.isArray(result.data)) throw Error('invalid collection page');
        items.push(...result.data.filter(x=>!x.pull_request));
        if(!result.next) break;
        if(page>=1000) throw Error('nonterminal pagination');
      }
      if(new Set(items.map(idOf)).size!==items.length) throw Error('duplicate paginated identity');
      return {items,evidence:receipt(path,items.length,page,true,null,observedAt)};
    } catch(error) {
      if(!optional) throw Error(`required inventory/relationship failed ${path}: ${error.message}`);
      return {items,evidence:receipt(path,items.length,page,false,`Partial collection: ${error.message}`)};
    }
  };
  const accept = raw => {
    const id=idOf(raw);
    if(unavailable.has(id))return id;
    const previous=rawById.get(id);
    if(previous && !previous._stub && !raw._stub && !isDeepStrictEqual(facts(previous),facts(raw))) throw Error(`source changed during collection ${id}`);
    if(raw._public===false){if(REPOSITORIES.includes(facts(raw).repository))throw Error('private primary repository');return id;}
    if(raw._stub&&previous&&!previous._stub)return id;
    rawById.set(id,raw);return id;
  };
  const start=new Date(Date.now()-7*86400000).toISOString();
  for(const repo of REPOSITORIES) {
    const opened=await pages(`repos/${repo}/issues?state=open`);
    const independent=(await request(`inventory:${repo}`)).data;
    if(JSON.stringify([...independent].sort((a,b)=>a-b))!==JSON.stringify(opened.items.map(x=>x.number).sort((a,b)=>a-b))) throw Error(`inventory reconciliation failed ${repo}`);
    opened.items.forEach(accept);
    const closed=await pages(`repos/${repo}/issues?state=closed&since=${start}`,true);
    closed.items.filter(x=>x.closed_at && Date.parse(x.closed_at)>=Date.parse(start)).forEach(accept);
    repositories.push({name:repo,scope:'primary',inventory:opened.evidence,recentClosures:closed.evidence});
  }
  const outside=id=>!REPOSITORIES.includes(facts(rawById.get(id)).repository);
  const discardReference=id=>{unavailable.add(id);rawById.delete(id);relations.delete(id);factReceipts.delete(id);};
  const readFacts=async(id,path)=>{try{return await request(path);}catch(error){if(!outside(id))throw error;discardReference(id);return null;}};
  const prime=async batch=>{
    if(!request.prime)return;
    const primary=batch.filter(id=>rawById.has(id)&&!outside(id));
    if(primary.length)await request.prime(primary.map(id=>rawById.get(id)));
    for(const id of batch.filter(id=>rawById.has(id)&&outside(id))) {
      // Priming combines facts and native relationships. On failure, read them
      // separately: unavailable outside facts may be a gap, but a failed native
      // ancestry read remains fatal. Production priming clears old cache entries.
      try{await request.prime([rawById.get(id)]);}catch{/* Separate reads below establish which evidence failed. */}
    }
  };
  const seen=new Set();
  // Read each retained record's relationships and close the reference graph, including older records.
  while([...rawById.keys()].some(id=>!seen.has(id))) {
    const batch=[...rawById.keys()].filter(id=>!seen.has(id)).slice(0,request.prime?20:6);
    if(request.checkPublic)for(const id of batch){const repo=facts(rawById.get(id)).repository;if(!publicRepos.has(repo)){try{await request.checkPublic(repo);publicRepos.add(repo);}catch(error){if(REPOSITORIES.includes(repo))throw error;unavailable.add(id);rawById.delete(id);}}}
    await prime(batch);
    await Promise.all(batch.filter(id=>rawById.has(id)).map(async id=> {
      seen.add(id); const raw=rawById.get(id); const base=`repos/${facts(raw).repository}/issues/${raw.number}`;
      const response=(raw._stub||request.prime)?await readFacts(id,base):{data:raw};
      if(!response)return;const current=response.data;accept(current);
      const parent=await request(`${base}/parent`);
      const isOpen=current.state==='open';
      const omitted=path=>({items:[],evidence:{source:apiURL(path),observedAt:null,state:'unknown',complete:false,reason:'Closed reference; collection not needed for ancestry or active prerequisites',pagination:null}});
      const children=isOpen?await pages(`${base}/sub_issues`):omitted(`${base}/sub_issues`);
      const blockers=isOpen?await pages(`${base}/dependencies/blocked_by`):omitted(`${base}/dependencies/blocked_by`);
      const parentItems=parent.data?[parent.data]:[];
      const relation={parent:{ids:parentItems.map(idOf),evidence:receipt(`${base}/parent`,parentItems.length,1,true,null,parent.observedAt??stamp())},
        children:{ids:isOpen?children.items.map(idOf):null,evidence:children.evidence}, blockedBy:{ids:isOpen?blockers.items.map(idOf):null,evidence:blockers.evidence}};
      relations.set(id,relation);
      [...parentItems,...children.items,...blockers.items].forEach(accept);
    }));
  }
  // Re-read facts and native relationships, then reconcile inventory again; no spliced attempts.
  const idsToCheck=[...rawById.keys()];
  for(let offset=0;offset<idsToCheck.length;offset+=(request.prime?20:6)) {
    const batch=idsToCheck.slice(offset,offset+(request.prime?20:6));
    await prime(batch);
    await Promise.all(batch.filter(id=>rawById.has(id)).map(async id=> {
    const raw=rawById.get(id), base=`repos/${facts(raw).repository}/issues/${raw.number}`;
    const observed=await readFacts(id,base);if(!observed)return;accept(observed.data);
    factReceipts.set(id,receipt(base,1,1,true,null,observed.observedAt??stamp()));
    const parentRead=await request(`${base}/parent`),parent=parentRead.data;
    const children=raw.state==='open'?await pages(`${base}/sub_issues`):null, blockers=raw.state==='open'?await pages(`${base}/dependencies/blocked_by`):null;
    const final=[parent?[idOf(parent)]:[],children?children.items.map(idOf):null,blockers?blockers.items.map(idOf):null].map(x=>x?.sort()??null);
    const prior=relations.get(id);
    if(!isDeepStrictEqual(final,[prior.parent.ids,prior.children.ids,prior.blockedBy.ids].map(x=>x?[...x].sort():null))) throw Error(`relationships changed ${id}`);
    prior.parent.evidence=receipt(`${base}/parent`,parent?1:0,1,true,null,parentRead.observedAt??stamp());
    if(children)prior.children.evidence=children.evidence;
    if(blockers)prior.blockedBy.evidence=blockers.evidence;
    }));
  }
  for(const repo of repositories) {
    const ids=(await request(`inventory:${repo.name}`)).data;
    if(!isDeepStrictEqual([...ids].sort((a,b)=>a-b),[...rawById.values()].filter(x=>facts(x).repository===repo.name&&x.state==='open').map(x=>x.number).sort((a,b)=>a-b))) throw Error(`inventory changed ${repo.name}`);
  }
  for(const relation of relations.values())for(const field of Object.values(relation)){if(field.ids?.some(id=>!rawById.has(id))){field.evidence.complete=false;field.evidence.reason='External reference unavailable or private';}}
  const issues=[...rawById.values()].map(raw=>({...facts(raw),facts:factReceipts.get(idOf(raw)),...relations.get(idOf(raw)),story:{},planning:[],publicFields:[],placement:null,project:unknownValues()}));
  const metadata=await parseMetadata(issues);
  issues.forEach((issue,index)=>Object.assign(issue,{story:metadata[index].story,planning:metadata[index].planning}));
  const external=[...new Set(issues.map(x=>x.repository).filter(x=>!REPOSITORIES.includes(x)))];
  for(const name of external) repositories.push({name,scope:'reference',inventory:receipt(`repos/${name}/issues`,issues.filter(x=>x.repository===name).length),recentClosures:receipt(`repos/${name}/issues`,0,1,false,'Reference repository; not a history inventory')});
  const dataset={schemaVersion:'guide-records/2.0',datasetId:'sha256:'+'0'.repeat(64),asOf:stamp(),repositories,issues,publicationPolicy:null,project};
  for(const repo of repositories) repo.recentClosures.pagination.itemCount=issues.filter(x=>x.repository===repo.name&&x.state==='CLOSED'&&x.closedAt&&Date.parse(x.closedAt)>=Date.parse(dataset.asOf)-7*86400000&&Date.parse(x.closedAt)<=Date.parse(dataset.asOf)).length;
  for(const issue of issues) issue.placement=placementOf(dataset,issue);
  for(const issue of issues) issue.project=projectOf(dataset,issue);
  dataset.datasetId=datasetIdentity(dataset);validateDataset(dataset);
  const gate=publicationGate(dataset);
  if(!gate.publishable) throw Error(`publication blocked: ${JSON.stringify(gate)}`);
  return dataset;
}

export async function parseMetadata(issues) {
  const {spawn}=await import('node:child_process');
  return new Promise((resolve,reject)=> {
    const child=spawn('python3',[new URL('./parse.py',import.meta.url).pathname],{stdio:['pipe','pipe','pipe']});
    let output='',errors='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>errors+=x);
    child.on('error',reject);child.on('close',code=> { if(code) reject(Error(errors)); else {try{resolve(JSON.parse(output));}catch(error){reject(error);}} });
    child.stdin.end(JSON.stringify(issues));
  });
}
