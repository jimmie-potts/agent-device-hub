// Shared DOM components. Inputs are validated records and resolved view configuration.
// No GitHub fetching, body parsing, model calls or arbitrary HTML enter this module.
const el=(tag,text,className)=>{const x=document.createElement(tag);if(text!==undefined)x.textContent=text;if(className)x.className=className;return x;};
const append=(parent,...children)=>{parent.append(...children);return parent;};
export const routeFor = issue => {
  const parts=id=>id.replace('#','/');
  const page=issue.placement.state==='epic'?`epics/${parts(issue.placement.epic)}/`:issue.placement.state==='root'?`epics/${parts(issue.id)}/`:'not-in-epic/';
  return {page,epic:issue.labels.includes('epic')?`epics/${parts(issue.id)}/`:null,issue:`${page}#${parts(issue.id)}`};
};
const link=(text,page,ctx,issue=null)=>{const a=el('a',text);a.href=ctx.href(page,issue);return a;};
const source=issue=>{const a=el('a','GitHub');a.href=`https://github.com/${issue.repository}/issues/${issue.number}`;a.rel='noopener';return a;};
const stateText=issue=>issue.state==='CLOSED'?`Closed · ${issue.stateReason??'reason unknown'}`:issue.labels.filter(x=>x.startsWith('status:')).join(', ')||'Workflow unknown';
const truth=value=>value===null?'unknown':String(value);

export function issueCard(record,node,ctx) {
  const box=el('article',undefined,`issue ${node.presentation??'row'}`);box.dataset.record=record.id;
  const heading=el('h3');heading.append(link(record.title,routeFor(record).page,ctx,record.id));
  const identity=el('p',`${record.id} · ${stateText(record)}`,'identity');
  const info=el('p',`No open blocker: ${truth(node.prerequisites?.noOpenBlocker??null)} · Required outcomes accepted: ${truth(node.prerequisites?.outcomesAccepted??null)}`,'evidence');
  const plan=el('p',`Phase: ${node.phase?.value??node.phase?.state??'unknown'} · Commitment: ${node.commitment?.value??node.commitment?.state??'unknown'}`,'evidence');
  append(box,heading,identity,info,plan);
  if(record.placement.state==='unresolved') box.append(el('p',`Placement unresolved: ${record.placement.reason}`,'gap'));
  for(const reason of node.reasons??[]) box.append(el('p',reason.code==='ready-candidate'?(reason.state==='supported'?'Ready by evidence at the snapshot time':'Readiness withheld: '+reason.withheld.map(x=>x.code).join(', ')):reason.code,'evidence'));
  if(record.placement.path.length){const path=el('p',undefined,'evidence');path.append('Native grouping path: ');for(const id of record.placement.path){const group=ctx.records.get(id);path.append(group?link(group.title,routeFor(group).page,ctx,id):el('span',id+' · unavailable'),' / ');}box.append(path);}
  const actions=el('div',undefined,'actions');actions.append(link('Task brief',routeFor(record).page,ctx,record.id),source(record));
  if(record.labels.includes('epic')) actions.append(link('Open epic',routeFor(record).epic,ctx));
  box.append(actions);return box;
}

export function dependencyList(record,node,ctx) {
  const box=el('section',undefined,'dependencies');box.append(el('h3',node.heading));
  box.append(el('p',node.complete?'Complete at snapshot time':'Partial or unknown dependency evidence','evidence'));
  if(node.ids===null)box.append(el('p','Unknown; no empty-list claim'));
  else if(!node.ids.length)box.append(el('p','None recorded'));
  else {const list=el('ul');for(const id of node.ids){const item=el('li'),issue=ctx.records.get(id);item.append(issue?link(issue.title+' · '+id,routeFor(issue).page,ctx,id):el('span',id+' · unavailable'));list.append(item);}box.append(list);}
  for(const reason of node.reasons??[])box.append(el('p',reason.code,'gap'));
  return box;
}

export function taskBrief(record,node,ctx) {
  const box=el('section',undefined,'brief');box.append(el('h2',record.title),el('p',record.id+' · '+stateText(record)),source(record));
  const recommendation=ctx.bundle.briefs?.[record.id];
  const current=node.useRecommendation&&recommendation?.state==='recommended';
  box.append(el('p',current?recommendation.label:`Generic commands · Recommendation ${recommendation?.state??node.recommendation?.state??'missing'}`,'evidence'));
  if(current)box.append(el('p',recommendation.answer));
  for(const [name,section] of Object.entries(record.story)) {
    const detail=el('details');detail.append(el('summary',section.heading??name));detail.append(el('pre',section.text??`Unavailable: ${section.reason}`));box.append(detail);
  }
  for(const command of node.commands) {
    const group=el('section',undefined,'command'),name=command[0].toUpperCase()+command.slice(1);group.append(el('h3',name));
    const text=command==='implement'?`Use the deliver-work skill to deliver ${record.url}.`:command==='plan'?`Plan ${record.url}. Keep planning read-only unless I authorize changes.`:command==='review'?`Review the implementation and acceptance evidence for ${record.url}.`:`Explain ${record.url}, its scope, prerequisites and current acceptance evidence.`;
    const guidance=current?`\nExecution guidance: ${recommendation.answer}\n${recommendation.why??''}`:'';
    const area=el('textarea');area.readOnly=true;area.value=text+guidance;area.setAttribute('aria-label',`${name} command`);area.rows=3;
    const button=el('button',`Copy ${name}`),notice=el('span');notice.setAttribute('role','status');
    button.onclick=async()=>{try{await navigator.clipboard.writeText(area.value);notice.textContent='Copied';}catch{area.focus();area.select();notice.textContent='Clipboard unavailable. Select and copy the command below.';}};
    append(group,button,notice,area);box.append(group);
  }
  return box;
}

function matches(record,ctx) {
  const {q='',repo='',status='',kind=''}=ctx.filters;
  return (!q||[record.title,record.id,record.body??''].join(' ').toLowerCase().includes(q.toLowerCase()))
    &&(!repo||record.repository===repo)&&(!status||record.labels.includes(status))&&(!kind||record.labels.includes(kind));
}

export function renderView(dataset,resolved,container,ctx) {
  // Later Hub/Ask consumers use this same entry after validating/resolving their bounded view.
  const records=new Map(dataset.issues.map(x=>[x.id,x]));ctx={...ctx,records};
  const nodes=new Map(resolved.nodes.map(x=>[x.id,x]));const children=new Map();
  for(const node of resolved.nodes){if(!children.has(node.parent))children.set(node.parent,[]);children.get(node.parent).push(node);}
  const render=node=> {
    const record=node.record?records.get(node.record):null;
    if(node.kind==='issue-card')return issueCard(record,node,ctx);
    if(node.kind==='task-brief')return taskBrief(record,node,ctx);
    if(node.kind==='dependency-list')return dependencyList(record,node,ctx);
    if(node.kind==='epic') {
      const box=el('section',undefined,'epic');box.dataset.record=record.id;
      const heading=el(node.presentation==='full'?'h2':'h3');heading.append(link(record.title,routeFor(record).epic,ctx));
      append(box,heading,el('p',record.story.outcome.text??'Outcome not recorded'),el('p',`${node.counts.open} open · ${node.counts.active} active · ${node.counts.blocked} blocked · ${node.counts.ready} eligible at snapshot`,'evidence'));
      if(node.presentation==='full')for(const child of children.get(node.id)??[])box.append(render(child));
      else box.append(link('Open epic',routeFor(record).epic,ctx));
      return box;
    }
    if(node.kind==='board') {
      const box=el('section',undefined,'board');for(const column of node.columns){const group=el('section');group.append(el('h3',column.name));column.children.forEach(id=>group.append(render(nodes.get(id))));box.append(group);}return box;
    }
    if(node.kind!=='section')throw Error('unsupported component');
    const box=el('section',undefined,'group');box.dataset.group=node.id;
    const heading=node.record?`${records.get(node.record)?.title??node.record} · ${node.heading}`:node.heading;
    box.append(el('h2',heading));if(node.sequence)box.append(el('p',node.sequence));
    if(node.window)box.append(el('p',`UTC ${node.window.start} through ${node.window.end} · ${node.complete?'complete':'partial history'}`,'evidence'));
    const all=children.get(node.id)??[];
    const filtered=all.filter(x=>!x.record||matches(records.get(x.record),ctx));
    box.append(el('p',`${filtered.length} matching · ${all.length} total`,'total'));
    const list=el('div',undefined,'list');let shown=0;
    const more=el('button','Show more');more.className='more';
    const expand=()=>{for(const item of filtered.slice(shown,shown+12))list.append(render(item));shown+=12;more.hidden=shown>=filtered.length;};
    more.onclick=expand;
    const renderAll=()=>{list.replaceChildren();filtered.forEach(x=>list.append(render(x)));};
    ctx.printHandlers?.push({before:renderAll,after:()=>{list.replaceChildren();shown=0;expand();}});
    expand();append(box,list,more);return box;
  };
  container.replaceChildren();for(const root of children.get(null)??[])container.append(render(root));
  const expected=resolved.page.kind==='home'?['Epics','Current work','Newly added','Open defects']:resolved.page.kind==='epic'?['In progress','Up next','Blocked','Later','Recently done']:resolved.page.kind==='not-in-epic'?['Recently done']:[];
  for(const heading of expected)if(!resolved.nodes.some(x=>x.heading===heading)) {
    const box=el('section',undefined,'group');box.append(el('h2',heading),el('p',heading==='Epics'?'0 epics. No collected issue carries the explicit epic label. Native parents remain grouping records.':'0 issues in this section.'));
    if(heading==='Recently done')box.append(el('p',dataset.repositories.some(x=>x.scope==='primary'&&!x.recentClosures.complete)?'Partial history; the empty display does not establish no completions.':'Complete seven-day history at '+dataset.asOf,'evidence'));
    container.append(box);
  }
  if(!resolved.nodes.length&&!expected.length)container.append(el('p','No issues in this view.'));
}

export function start(dataset,bundle,manifest,releaseBase) {
  if(dataset.datasetId!==manifest.datasetId||bundle.datasetId!==manifest.datasetId||bundle.catalogId!==manifest.catalogId)throw Error('mixed-release');
  const main=document.getElementById('content'),nav=document.getElementById('navigation');
  const filters=document.getElementById('filters'),fresh=document.getElementById('freshness');
  const printHandlers=[];const params=()=>new URL(location.href).searchParams;
  const href=(page,issue=null)=>{const url=new URL(location.href);url.searchParams.set('page',page);url.hash=issue?issue.replace('#','/'):'';return url.pathname+url.search+url.hash;};
  nav.append(link('Home','home',{href}),link('All issues','all/',{href}),link('Not in an epic','not-in-epic/',{href}),link('Composed example','example',{href}));
  for(const issue of dataset.issues.filter(x=>x.labels.includes('epic')))nav.append(link(issue.title,routeFor(issue).epic,{href}));
  const toggle=document.getElementById('nav-toggle');toggle.onclick=()=>{nav.classList.toggle('expanded');toggle.setAttribute('aria-expanded',String(nav.classList.contains('expanded')));};
  const search=el('input');search.type='search';search.setAttribute('aria-label','Search issues');search.placeholder='Search issues';
  const select=(label,options)=>{const x=el('select');x.setAttribute('aria-label',label);x.append(new Option(label,''));options.forEach(v=>x.append(new Option(v,v)));return x;};
  const repo=select('Repository',dataset.repositories.filter(x=>x.scope==='primary').map(x=>x.name));
  const status=select('Workflow',['status:backlog','status:ready','status:in-progress','status:review']);
  const kind=select('Kind',['epic','bug','idea']);filters.append(search,repo,status,kind);
  fresh.textContent=`Source snapshot: ${dataset.asOf}. Readiness is evaluated against this snapshot; check GitHub before starting work. ${dataset.issues.filter(x=>x.state==='OPEN'&&dataset.repositories.some(r=>r.name===x.repository&&r.scope==='primary')).length} unique open primary issues.`;
  for(const gap of bundle.gaps){const line=el('p',`${gap.code}: ${gap.source}`,'gap');document.getElementById('gaps').append(line);}
  const readFilters=()=>({q:params().get('q')??'',repo:params().get('repo')??'',status:params().get('status')??'',kind:params().get('kind')??''});
  function draw(focus=false) {
    const p=params(),key=p.get('page')??'home',issue=/^#[\w.-]+\/[\w.-]+\/[1-9]\d*$/.test(location.hash)?location.hash.slice(1).replace(/\/([1-9]\d*)$/,'#$1'):null;
    const page=bundle.pages[issue?`issue:${issue}`:key];
    printHandlers.length=0;
    if(!page){main.replaceChildren(el('p','This record or page is unavailable in the pinned release.'));return;}
    const f=readFilters();search.value=f.q;repo.value=f.repo;status.value=f.status;kind.value=f.kind;
    document.getElementById('page-title').textContent=issue?'Task brief':key==='home'?'Work Guide':key==='example'?'Composed example':key.startsWith('epics/')?'Epic':key==='all/'?'All issues':'Not in an epic';
    renderView(dataset,page.resolved,main,{bundle,filters:f,href,printHandlers});
    nav.querySelectorAll('a').forEach(a=>{if(new URL(a.href).searchParams.get('page')===key)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
    if(focus){document.getElementById('page-title').focus();scrollTo(0,0);}
  }
  document.addEventListener('click',event=>{const a=event.target.closest('a');if(!a||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||event.button!==0)return;const url=new URL(a.href);if(url.origin!==location.origin||url.pathname!==location.pathname||url.hash==='#page-title')return;event.preventDefault();history.pushState(null,'',url);nav.classList.remove('expanded');toggle.setAttribute('aria-expanded','false');draw(true);});
  window.addEventListener('popstate',()=>draw(true));
  const update=()=>{const url=new URL(location.href);if(search.value){url.searchParams.set('page','all/');url.hash='';}for(const [key,value] of Object.entries({q:search.value,repo:repo.value,status:status.value,kind:kind.value})){if(value)url.searchParams.set(key,value);else url.searchParams.delete(key);}history.replaceState(null,'',url);draw();};
  search.oninput=update;repo.onchange=update;status.onchange=update;kind.onchange=update;
  const theme=document.getElementById('theme');let saved;try{saved=localStorage.getItem('guide-theme');}catch{}
  document.documentElement.dataset.theme=saved??(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
  theme.onclick=()=>{const value=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=value;try{localStorage.setItem('guide-theme',value);}catch{}};
  document.getElementById('print').onclick=()=>print();window.addEventListener('beforeprint',()=>printHandlers.forEach(x=>x.before()));window.addEventListener('afterprint',()=>printHandlers.forEach(x=>x.after()));
  async function checkUpdate(){const notice=document.getElementById('update');try{const response=await fetch(new URL('../../current.json',releaseBase),{cache:'no-store'});if(!response.ok)throw Error('unavailable');const current=await response.json();if(current.releaseId!==manifest.releaseId){notice.hidden=false;notice.textContent='A newer release is available. This page retains its validated snapshot. Reload to update.';}}catch{notice.hidden=false;notice.textContent='Update check unavailable. This page retains its validated snapshot.';}}
  document.getElementById('check-update').onclick=checkUpdate;
  draw();checkUpdate();
  document.documentElement.dataset.release=manifest.releaseId;
  window.guide={releaseId:manifest.releaseId,datasetId:dataset.datasetId,renderView};
}
