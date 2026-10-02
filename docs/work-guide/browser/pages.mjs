import { CATALOG, catalogIdentity, resolveView, PREDICATES, route, recentEvidence } from './runtime/views.mjs';
import { isEpic, primaryPage, recentlyDone, eligibility, publicationGate, WORKFLOW, sealDataset } from './runtime/records.mjs';
export const snapshotPolicy = dataset => ({name:'guide-source-snapshot/1',asOf:dataset.asOf,maxAgeMs:86400000});

export function makeView(dataset, kind, record=null) {
  sealDataset(dataset);
  const policy=snapshotPolicy(dataset), components=[];let serial=0;
  const add = data => {const c={id:`c-${++serial}`,...data};components.push(c);return c.id;};
  const card=(issue,primary=false,ready=false) => add({kind:'issue-card',record:issue.id,presentation:'row',primary,...(ready?{reasons:[{code:'ready-candidate',evidence:[]}]}:{})});
  const epicSummary=issue=>add({kind:'epic',record:issue.id,presentation:'summary',children:[]});
  const section=(group,children,record=null)=>children.length?add({kind:'section',group,record,sequence:'none',disclosure:'open',children}):null;
  const active=x=>PREDICATES.active(x), blocked=x=>PREDICATES.blocked(x,{dataset}), later=x=>PREDICATES.later(x);
  const ready=x=>eligibility(dataset,x.id,'ready',policy).allowed;
  const open=dataset.issues.filter(x=>x.state==='OPEN' && dataset.repositories.some(r=>r.name===x.repository && r.scope==='primary'));
  let root=[];
  if(kind==='home') root=[section('epics',dataset.issues.filter(x=>isEpic(x)&&x.placement.state==='root').map(epicSummary)),
    section('current-work',open.filter(active).map(x=>card(x))),
    section('newly-added',[...open].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,12).map(x=>card(x))),
    section('open-defects',open.filter(x=>x.labels.includes('bug')).map(x=>card(x)))];
  else if(kind==='all') {
    // Contract All issues coverage includes retained open reference records, too.
    root=[section('all',dataset.issues.filter(x=>x.state==='OPEN').map(x=>card(x)))];
  } else if(kind==='epic' || kind==='not-in-epic') {
    const target=kind==='epic'?`epic:${record}`:'not-in-epic';
    const members=dataset.issues.filter(x=>x.state==='OPEN'&&x.id!==record&&primaryPage(x)===target);
    const recent=dataset.issues.filter(x=>x.id!==record&&recentlyDone(dataset,x)&&primaryPage(x)===target);
    if(kind==='not-in-epic') root=[section('not-in-epic',members.map(x=>card(x,true))),section('recently-done',recent.map(x=>card(x)))];
    else {
      const groups=new Map(['in-progress','up-next','blocked','later','backlog','sub-epics','recently-done'].map(x=>[x,[]]));
      const parents=new Map();
      for(const issue of members) {
        if(isEpic(issue)){groups.get('sub-epics').push(epicSummary(issue));continue;}
        const group=active(issue)?'in-progress':blocked(issue)?'blocked':later(issue)?'later':ready(issue)?'up-next':'backlog';
        const ancestor=issue.placement.path.at(-1);
        if(ancestor && group==='backlog') {if(!parents.has(ancestor))parents.set(ancestor,[]);parents.get(ancestor).push(card(issue,true));}
        else groups.get(group).push(card(issue,true,group==='up-next'));
        if(blocked(issue)&&group!=='blocked')groups.get('blocked').push(card(issue));
        if(later(issue)&&group!=='later')groups.get('later').push(card(issue));
      }
      recent.forEach(x=>groups.get('recently-done').push(card(x)));
      const children=[...groups].map(([group,items])=>section(group,items));
      parents.forEach((items,parent)=>children.push(section('parent-group',items,parent)));
      root=[add({kind:'epic',record,presentation:'full',children:children.filter(Boolean)})];
    }
  } else if(kind==='issue') {
    root=[add({kind:'task-brief',record}),section('relationships',[
      add({kind:'dependency-list',record,direction:'prerequisites',scope:'direct'}),
      add({kind:'dependency-list',record,direction:'dependents',scope:'direct'})])];
  } else if(kind==='answer') {
    const selected=open.slice(0,3);
    root=[section('matches',selected.map(issue=>add({kind:'issue-card',record:issue.id,presentation:'card',primary:false,reasons:[{code:'ready-candidate',evidence:[]}]})))];
  } else throw Error('unsupported page');
  root=root.filter(Boolean);
  if(!root.length) return null;
  return {schemaVersion:'guide-views/1.0',recordsVersion:dataset.schemaVersion,datasetId:dataset.datasetId,catalogId:catalogIdentity(CATALOG),origin:kind==='answer'?'composed':'ordinary',page:{kind,record},layout:'stack',root,components};
}

export function pageBundle(dataset) {
  sealDataset(dataset);
  const policy=snapshotPolicy(dataset), pages={};
  const insert=(key,kind,record=null)=> {const view=makeView(dataset,kind,record);pages[key]={view,resolved:view?resolveView(view,{dataset,policy}):{page:{kind,record},layout:'stack',nodes:[]}};};
  insert('home','home');insert('all/','all');insert('not-in-epic/','not-in-epic');insert('example','answer');
  for(const issue of dataset.issues.filter(isEpic)) insert(route(issue).epic,'epic',issue.id);
  for(const issue of dataset.issues) insert(`issue:${issue.id}`,'issue',issue.id);
  return {recentHistory:recentEvidence(dataset),datasetId:dataset.datasetId,catalogId:catalogIdentity(CATALOG),recordsVersion:dataset.schemaVersion,viewsVersion:'guide-views/1.0',pages,gaps:publicationGate(dataset).gaps,policy};
}

export function inventoryAudit(dataset) {
  const findings=[];const count={};
  for(const repo of dataset.repositories.filter(x=>x.scope==='primary')) count[repo.name]={open:0,epic:0,standalone:0,unresolved:0};
  for(const issue of dataset.issues) {
    if(issue.state!=='OPEN') continue;
    if(count[issue.repository]) {const item=count[issue.repository];item.open++;item[issue.placement.state==='epic'||issue.placement.state==='root'?'epic':issue.placement.state]++;}
    const add=(field,reason,action)=>findings.push({id:issue.id,url:issue.url,field,reason,action});
    for(const [key,section] of Object.entries(issue.story)) if(section.state!=='present') add(`story.${key}`,section.reason,`Issue owner: review the ${key} section; browsing remains available`);
    if(issue.placement.state==='unresolved') add('placement',issue.placement.reason,'Issue owner: reconcile the native parent chain');
    const statuses=issue.labels.filter(x=>WORKFLOW.includes(x));
    if(statuses.length!==1) add('workflow','Missing or conflicting status','Issue owner: select exactly one workflow label');
    if(!issue.planning.some(x=>x.kind==='execution'&&x.state==='current')) add('execution',issue.planning.some(x=>x.kind==='execution')?'Recommendation unusable':'Recommendation missing','Issue owner: reassess; briefs use generic commands');
  }
  return {asOf:dataset.asOf,datasetId:dataset.datasetId,count,placements:dataset.issues.filter(x=>x.state==='OPEN'&&count[x.repository]).map(x=>({id:x.id,primaryPage:primaryPage(x)})),epicCount:dataset.issues.filter(isEpic).length,findings,gaps:publicationGate(dataset).gaps};
}
