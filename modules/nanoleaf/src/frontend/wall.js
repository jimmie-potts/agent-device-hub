// Retained imperative wall controller from codex-nanoleaf; provenance and adaptations in README.md.
import {Prism} from './prism.js';
import {PrismAdapters} from './prism-adapters.js';
import {PrismLabels} from './prism-labels.js';
import {markup} from './markup.js';

export function mountWall(host, ports) {
  host.innerHTML = markup;
  for (const dot of host.querySelectorAll('[data-palette-role]')) dot.style.background='var(--wall-'+dot.dataset.paletteRole+')';
  let disposed=false, editable=false;
  const listeners=[], timers=new Set(), frames=new Set(), inhibited=new Map();
  function listen(target,type,handler,options){target.addEventListener(type,handler,options);listeners.push(()=>target.removeEventListener(type,handler,options))}
  function later(callback,delay){const id=setTimeout(()=>{timers.delete(id);if(!disposed)callback()},delay);timers.add(id);return id}
  function frame(callback){const id=requestAnimationFrame(time=>{frames.delete(id);if(!disposed)callback(time)});frames.add(id);return id}
  function restoreControls(){for(const [node,disabled] of inhibited)node.disabled=disabled;inhibited.clear()}
  function restrictControls(){if(editable)return;for(const node of host.querySelectorAll('#work,#quiet,#free,#classic,#project,#coverage,#assignProject,#swap,#locate,#rotate,#flipX,#flipY,#resetColors,#projectList input,#colorRows button,#colorRows input,[data-evict-task]')){if(!inhibited.has(node))inhibited.set(node,node.disabled);node.disabled=true}}
const $=id=>host.querySelector('#'+CSS.escape(id)), svgNS='http://www.w3.org/2000/svg';
let state=null, selected=new Set(), projectFingerprint='', taskFingerprint='', taskFocus=null, wallFingerprint='', detailFingerprint='';
let showSavedProjects=false;
let showAllTasks=false;
// The React host supplies the selected configured device; actions always keep its explicit ID.
let device='', deviceList=[], deviceOptions='';
function kindOf(){return state?.kind||'lines'}
// Lines keep their product name; a Light Panels element is a triangle.
function noun(){return kindOf()==='panels'?'Triangle':'Line'}
function nounLower(){return kindOf()==='panels'?'triangle':'Line'}
function nounPlural(){return kindOf()==='panels'?'triangles':'Lines'}
function drawDevices(){
  const key=JSON.stringify([deviceList,device]);if(key===deviceOptions)return;deviceOptions=key;
  const select=$('device'),fallback=deviceList.find(d=>d.default)?.id||'',current=deviceList.find(d=>d.id===(device||fallback));
  select.replaceChildren(...deviceList.map(d=>{const option=el('option',d.name);option.value=d.id;return option}));
  if(!current&&device){const option=el('option',device);option.value=device;option.disabled=true;select.prepend(option)}
  select.value=current?current.id:device;
  $('deviceControl').hidden=deviceList.length<2&&!!current;
}
function switchDevice(id){if(deviceList.some(item=>item.id===id))ports.selectDevice(id)}
function resetWallViews(){
  wallFingerprint=projectFingerprint=taskFingerprint=detailFingerprint=lastReadout='';
  if(prism){prism.destroy();prism=null;prismGeometryKey='';$('wallHost').innerHTML='<svg id="wall" role="group" aria-label="Nanoleaf wall map"></svg>'}
}
const statusColors={working:'var(--wall-working)',question:'var(--wall-question)',blocked:'var(--wall-blocked)',unread:'var(--wall-unread)',idle:'var(--wall-base)',base:'var(--wall-base)'};
const modeNotes={work:['Work · indicators on','Task indicators pulse on the wall at 30% brightness. The map’s inward light flow follows task status.'],quiet:['Quiet · steady at 10%','Steady task colors without pulses or outward waves.'],free:['Free · lights released','The lights follow the Nanoleaf app. The map shows saved task assignments.']};
const showAllNumbersKey='wall.numbers.showAll';
let showAllNumbers=false;
try{showAllNumbers=localStorage.getItem(showAllNumbersKey)==='1'}catch{}
function syncNumberControl(){const button=$('showNumbers');button.setAttribute('aria-pressed',String(showAllNumbers));button.textContent=showAllNumbers?'Hide idle numbers':'Show all numbers';prism?.showAllNumbers(showAllNumbers)}
function el(tag,text,cls){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node}
function message(text,error=false){$('notice').textContent=text;$('notice').style.display=text?'block':'none';$('notice').classList.toggle('error',error)}
function action(path,payload){if(!editable||!state)return;endAssembly();ports.action(path,payload)}
function projectName(id){return state.projects.find(p=>p.id===id)?.name||'No project'}
function choose(id,multi=false){if(!lineById(id))return;if(!multi)selected.clear();if(multi&&selected.has(id))selected.delete(id);else selected.add(id);taskFocus=null;const owners=state.lines.filter(l=>selected.has(l.id)).map(l=>l.project||'');if(owners.length&&owners.every(p=>p===owners[0]))$('assignProject').value=owners[0];drawWall();inspect();drawTasks();highlightAssociations()}
function selectOptions(select,sharedLabel){const fingerprint=JSON.stringify([sharedLabel,state.projects.map(p=>[p.id,p.name])]);if(select.dataset.options===fingerprint)return;select.dataset.options=fingerprint;const value=select.value;select.replaceChildren();let opt=el('option',sharedLabel);opt.value='';select.append(opt);for(const p of state.projects){opt=el('option',p.name);opt.value=p.id;select.append(opt)}select.value=value}
function lineById(id){return state.lines.find(line=>line.id===id)}
function lineTask(line){return state.tasks.find(task=>task.id===line.task)}
function lineDescription(line){
  const parts=[],task=lineTask(line);
  if(state.settings.style==='project')parts.push(line.project?'Reserved: '+projectName(line.project):'Shared pool');
  if(task)parts.push(projectName(task.project),task.title,...(task.statusEvidence==='uncertain'?['Status evidence is uncertain']:[]));else parts.push('Unused');
  return parts.join(' · ');
}
function lineBadge(line,kind,label,showShared=false){
  const shared=showShared&&!line.project, task=lineTask(line);
  const badge=el('button',line.number+(shared?' · Shared':''),'line-badge '+kind);
  badge.type='button';badge.dataset.lineId=line.id;badge.dataset.lineNumber=line.number;
  const description=`${noun()} ${line.number} · ${label}${shared?' · Shared':''}${task?' · '+projectName(task.project)+' · '+task.title:''}`;
  badge.setAttribute('aria-label',description);badge.title=description;
  badge.onclick=e=>{e.stopPropagation();choose(line.id,e.ctrlKey||e.metaKey||e.shiftKey)};
  return badge;
}
function replaceKeepingFocus(root,...nodes){
  const key=root.contains(document.activeElement)?document.activeElement.dataset.focusKey:null;
  root.replaceChildren(...nodes);
  if(key)[...root.querySelectorAll('[data-focus-key]')].find(node=>node.dataset.focusKey===key)?.focus({preventScroll:true});
}
function lineGroup(label,kind,lines,showShared=false){
  const group=el('div',undefined,'line-group'),badges=el('div',undefined,'line-badges');
  group.dataset.lineGroup=kind;group.append(el('span',label,'label line-group-label'));
  badges.append(...(lines.length?lines.map(line=>lineBadge(line,kind,label,showShared)):[el('span','None','small')]));
  group.append(badges);return group;
}
function drawProjects(){drawProjectsContent();restrictControls()}
function drawProjectsContent(){
  const focusedProject=document.activeElement.closest?.('#projectList [data-project]')?.dataset.project;
  const fingerprint=JSON.stringify([showSavedProjects,focusedProject,state.projects,state.settings.style,state.lines.map(l=>[l.id,l.number,l.project,l.task]),state.tasks.map(t=>[t.id,t.project,t.title,t.status,t.line])]);
  if(fingerprint===projectFingerprint)return;
  projectFingerprint=fingerprint;const list=$('projectList'),rows=[];
  const existing=new Map([...list.querySelectorAll('.project[data-project]')].map(row=>[row.dataset.project,row]));
  const counts=new Map(state.projects.map(p=>[p.id,{total:0,active:0,unread:0,waiting:0}]));
  for(const task of state.tasks){
    const count=counts.get(task.project);if(!count)continue;
    count.total++;if(['working','blocked','question'].includes(task.status))count.active++;
    if(task.status==='unread')count.unread++;
    if(task.line==null)count.waiting++;
  }
  const current=new Set([...counts].filter(([,count])=>count.total).map(([id])=>id));
  const projects=state.projects.filter(p=>showSavedProjects||current.has(p.id)||p.id===focusedProject).sort((a,b)=>{
    const x=counts.get(a.id),y=counts.get(b.id);
    return Number(current.has(b.id))-Number(current.has(a.id))||y.active-x.active||y.unread-x.unread||a.name.localeCompare(b.name)||a.id.localeCompare(b.id);
  });
  $('showSavedProjects').textContent=(showSavedProjects?'Hide':'Show')+' saved projects ('+state.projects.length+')';
  $('showSavedProjects').setAttribute('aria-expanded',String(showSavedProjects));
  for(const p of projects){
    let row=existing.get(p.id);
    if(!row){row=el('div',undefined,'project');row.dataset.project=p.id;const color=el('input');color.type='color';row.append(color,el('div'))}
    const [color,info]=row.children,content=el('div');
    if(document.activeElement!==color)color.value=p.color;
    color.setAttribute('aria-label',p.name+' color');color.dataset.focusKey=JSON.stringify(['color',p.id]);
    color.onchange=()=>action('/api/project',{id:p.id,color:color.value});
    color.onblur=()=>{projectFingerprint=''};
    const count=counts.get(p.id);
    content.append(el('div',p.name,'project-name'),el('div',`${count.total} task${count.total===1?'':'s'}${count.waiting?' · '+count.waiting+' waiting':''}`,'project-stats'));
    if(state.settings.style==='project')content.append(lineGroup('Reserved','reserved',state.lines.filter(l=>l.project===p.id)));
    content.append(lineGroup('In use','in-use',state.lines.filter(l=>lineTask(l)?.project===p.id),state.settings.style==='project'));
    for(const badge of content.querySelectorAll('.line-badge'))badge.dataset.focusKey=JSON.stringify(['project',p.id,badge.closest('.line-group').dataset.lineGroup,badge.dataset.lineId]);
    const hadBadgeFocus=info.contains(document.activeElement);
    replaceKeepingFocus(info,...content.childNodes);
    if(hadBadgeFocus&&!info.contains(document.activeElement))color.focus({preventScroll:true});
    rows.push(row);
  }
  if(!state.projects.some(p=>current.has(p.id)))rows.unshift(el('div','No current project is known. Saved projects are available above.','empty'));
  if(state.settings.style==='project'){
    let row=list.querySelector('.shared-pool');
    if(!row){row=el('div',undefined,'project shared-pool');const mark=el('span','◇','shared-mark');mark.setAttribute('aria-hidden','true');row.append(mark,el('div'))}
    const info=row.lastElementChild,content=el('div'),name=el('div','Shared pool','project-name');
    name.title='Shared Lines are available for overflow. Reserved Lines stay with their project.';content.append(name);
    const shared=state.lines.filter(l=>!l.project);
    content.append(lineGroup('In use','in-use',shared.filter(l=>lineTask(l))),lineGroup('Available','available',shared.filter(l=>!lineTask(l))));
    for(const badge of content.querySelectorAll('.line-badge'))badge.dataset.focusKey=JSON.stringify(['shared',badge.dataset.lineId]);
    replaceKeepingFocus(info,...content.childNodes);rows.push(row);
  }
  // Keep existing rows attached so an open native color picker survives polling.
  const focused=list.contains(document.activeElement)?document.activeElement:null;
  const pinned=focused?.closest('.project');
  let next=null;
  for(const row of [...rows].reverse()){
    if(row!==pinned&&row.nextSibling!==next)list.insertBefore(row,next);
    else if(!row.isConnected)list.insertBefore(row,next);
    next=row;
  }
  for(const row of [...list.children])if(!rows.includes(row))row.remove();
  if(focused?.isConnected&&document.activeElement!==focused)focused.focus({preventScroll:true});
  selectOptions($('assignProject'),'Shared pool');
}
$('showSavedProjects').onclick=()=>{showSavedProjects=!showSavedProjects;drawProjects();highlightAssociations()};
$('projectList').addEventListener('focusout',()=>{projectFingerprint=''});
/* Junctions: clusters of Line ends that nearly touch. The hub is the most connected one, nearest the others on ties. */
function findJunctions(ends){
  const clusters=[];
  for(const point of ends.flat()){
    const near=clusters.find(c=>Math.hypot(c.x-point[0],c.y-point[1])<=40);
    if(near){near.points.push(point);near.x=near.points.reduce((s,p)=>s+p[0],0)/near.points.length;near.y=near.points.reduce((s,p)=>s+p[1],0)/near.points.length}
    else clusters.push({x:point[0],y:point[1],points:[point]});
  }
  return clusters.filter(c=>c.points.length>=2).map(c=>({x:c.x,y:c.y,degree:c.points.length}));
}
function centralJunction(junctions,center){
  if(!junctions.length)return null;
  const spread=j=>junctions.reduce((s,o)=>s+Math.hypot(o.x-j.x,o.y-j.y),0);
  return [...junctions].sort((a,b)=>b.degree-a.degree||spread(a)-spread(b)||Math.hypot(a.x-center[0],a.y-center[1])-Math.hypot(b.x-center[0],b.y-center[1]))[0];
}
function hexPath(x,y,r){return Array.from({length:6},(_,i)=>{const a=Math.PI/6+i*Math.PI/3;return(i?'L':'M')+(x+r*Math.cos(a)).toFixed(2)+' '+(y+r*Math.sin(a)).toFixed(2)}).join(' ')+' Z'}
function transform(point){let[x,y]=point;const a=state.settings.rotation*Math.PI/180;return[(x*Math.cos(a)-y*Math.sin(a))*(state.settings.flip_x?-1:1),(x*Math.sin(a)+y*Math.cos(a))*(state.settings.flip_y?-1:1)]}
function drawStandardWall(){
  if(assembly.active||assembly.hold)return; // the wall waits for the assembly; the rest of the page keeps updating
  const fingerprint=JSON.stringify([state.lines,state.tasks.map(t=>[t.id,t.status,t.statusEvidence,t.project,t.title]),state.projects.map(p=>[p.id,p.name,p.color]),state.settings,state.pending,[...selected]]);
  if(fingerprint===wallFingerprint)return;wallFingerprint=fingerprint;
  const root=$('wall'),focused=root.contains(document.activeElement)?document.activeElement.dataset.line:null;
  root.replaceChildren();if(!state.lines.length)return;
  const all=state.lines.flatMap(l=>l.points.map(transform)),xs=all.map(p=>p[0]),ys=all.map(p=>p[1]);
  const minX=Math.min(...xs)-55,minY=Math.min(...ys)-55,maxX=Math.max(...xs)+55,maxY=Math.max(...ys)+55;
  root.setAttribute('viewBox',`${minX} ${minY} ${maxX-minX} ${maxY-minY}`);
  const numbers=document.createElementNS(svgNS,'g');numbers.setAttribute('aria-hidden','true');numbers.setAttribute('class','numbers');
  const center=[(minX+maxX)/2,(minY+maxY)/2];
  const junctions=findJunctions(state.lines.map(l=>[transform(l.points[0]),transform(l.points[2])]));
  const hub=centralJunction(junctions,center)||{x:center[0],y:center[1]};
  for(const line of state.lines){
    const points=line.points.map(transform),task=lineTask(line);
    const colors=[statusColors[task?.status]||statusColors.base,statusColors[task?.status]||statusColors.base];
    if(state.settings.style==='project'){const owner=state.projects.find(p=>p.id===(task?.project||line.project));colors[line.signature]=owner?.color||statusColors.base}
    const group=document.createElementNS(svgNS,'g');
    group.setAttribute('class','wall-line'+(selected.has(line.id)?' selected':'')+(state.pending?.lines?.[line.id]?' pending':''));
    group.setAttribute('tabindex','0');group.setAttribute('role','button');
    group.setAttribute('aria-label',`Line ${line.number} · ${lineDescription(line)}`);group.dataset.line=line.id;if(task)group.dataset.status=task.status;
    const title=document.createElementNS(svgNS,'title');title.textContent=`Line ${line.number} · ${lineDescription(line)}`;group.append(title);
    function segment(a,b,cls,color){
      const node=document.createElementNS(svgNS,'line');node.setAttribute('x1',a[0]);node.setAttribute('y1',a[1]);node.setAttribute('x2',b[0]);node.setAttribute('y2',b[1]);node.setAttribute('class',cls);
      if(color){node.style.stroke=color;node.style.color=color}
      group.append(node);
    }
    const hit=document.createElementNS(svgNS,'rect'),dx=points[2][0]-points[0][0],dy=points[2][1]-points[0][1];
    hit.setAttribute('class','hit');hit.setAttribute('x',-22);hit.setAttribute('y',-22);
    hit.setAttribute('width',Math.hypot(dx,dy)+44);hit.setAttribute('height',44);hit.setAttribute('rx',22);
    hit.setAttribute('transform',`translate(${points[0][0]} ${points[0][1]}) rotate(${Math.atan2(dy,dx)*180/Math.PI})`);
    group.append(hit);segment(points[0],points[2],'outline');
    segment(points[0],points[1],'glow',colors[0]);segment(points[1],points[2],'glow',colors[1]);
    segment(points[0],points[1],'zone',colors[0]);segment(points[1],points[2],'zone',colors[1]);
    segment(points[0],points[2],'sheen');
    group.onclick=e=>choose(line.id,e.ctrlKey||e.metaKey||e.shiftKey);
    group.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(line.id,e.ctrlKey||e.metaKey||e.shiftKey)}};
    root.append(group);if(focused===line.id)group.focus({preventScroll:true});
    // The number tag sits beside the Line on the side facing away from the wall's center,
    // so labels on converging Lines diverge instead of stacking.
    const len=Math.hypot(dx,dy)||1;let nx=-dy/len,ny=dx/len;
    const outward=nx*(points[1][0]-center[0])+ny*(points[1][1]-center[1]);
    if(outward<0||(outward===0&&ny>0)){nx=-nx;ny=-ny}
    const tag=document.createElementNS(svgNS,'g');tag.setAttribute('class','number-tag');
    tag.dataset.mx=points[1][0];tag.dataset.my=points[1][1];tag.dataset.nx=nx;tag.dataset.ny=ny;
    const bg=document.createElementNS(svgNS,'rect');bg.setAttribute('class','number-bg');
    const label=document.createElementNS(svgNS,'text');label.setAttribute('class','number');label.dataset.lineId=line.id;label.textContent=line.number;
    tag.append(bg,label);
    tag.onclick=e=>{choose(line.id,e.ctrlKey||e.metaKey||e.shiftKey);[...root.querySelectorAll('.wall-line')].find(node=>node.dataset.line===line.id)?.focus({preventScroll:true})};
    numbers.append(tag);
  }
  // Connector nodes at every junction except the hub, which the orb occupies.
  const connectors=document.createElementNS(svgNS,'g');connectors.setAttribute('class','connectors');connectors.setAttribute('aria-hidden','true');
  for(const j of junctions){
    if(Math.hypot(j.x-hub.x,j.y-hub.y)<1)continue;
    const node=document.createElementNS(svgNS,'g');node.setAttribute('class','connector');node.dataset.x=j.x;node.dataset.y=j.y;node.style.transformOrigin=`${j.x}px ${j.y}px`;
    const hex=document.createElementNS(svgNS,'path');hex.setAttribute('class','connector-hex');hex.setAttribute('d',hexPath(j.x,j.y,19));
    const ring=document.createElementNS(svgNS,'circle');ring.setAttribute('class','connector-ring');ring.setAttribute('cx',j.x);ring.setAttribute('cy',j.y);ring.setAttribute('r',7.5);
    node.append(hex,ring);connectors.append(node);
  }
  root.append(connectors);
  // A decorative orb marks the hub. It is not a device and shows no status.
  const orbGroup=document.createElementNS(svgNS,'g');orbGroup.setAttribute('class','orb-group');orbGroup.setAttribute('aria-hidden','true');orbGroup.style.transformOrigin=`${hub.x}px ${hub.y}px`;
  for(const [cls,r] of [['orb-halo',30],['orb',12],['orb-ring',16]]){const c=document.createElementNS(svgNS,'circle');c.setAttribute('class',cls);c.setAttribute('cx',hub.x);c.setAttribute('cy',hub.y);c.setAttribute('r',r);orbGroup.append(c)}
  root.append(orbGroup);
  // Number clicks must win over every Line's transparent hit stroke.
  root.append(numbers);sizeLineNumbers();anchorPulses();
}
// Light Panels: one plain triangle per element from the cached geometry, static status colours, numbers in the reader's order.
function drawTriangleWall(){
  if(prism){prism.destroy();prism=null;prismGeometryKey='';$('wallHost').innerHTML='<svg id="wall" role="group" aria-label="Nanoleaf wall map"></svg>'}
  prismError='';prismLabelError='';$('numbersOption').hidden=true;
  const fingerprint=JSON.stringify([state.lines,state.tasks.map(t=>[t.id,t.status,t.statusEvidence,t.project,t.title]),state.projects.map(p=>[p.id,p.name,p.color]),state.settings,state.pending,[...selected]]);
  if(fingerprint===wallFingerprint)return;wallFingerprint=fingerprint;
  const root=$('wall'),focused=root.contains(document.activeElement)?document.activeElement.dataset.line:null;
  root.replaceChildren();if(!state.lines.length)return;
  const all=state.lines.flatMap(l=>l.points.map(transform)),xs=all.map(p=>p[0]),ys=all.map(p=>p[1]);
  const minX=Math.min(...xs)-30,minY=Math.min(...ys)-30,maxX=Math.max(...xs)+30,maxY=Math.max(...ys)+30;
  root.setAttribute('viewBox',`${minX} ${minY} ${maxX-minX} ${maxY-minY}`);
  for(const line of state.lines){
    const points=line.points.map(transform),task=lineTask(line);
    const cx=points.reduce((sum,p)=>sum+p[0],0)/3,cy=points.reduce((sum,p)=>sum+p[1],0)/3;
    // A small inset leaves the seam between neighbouring panels visible.
    const inset=points.map(([x,y])=>[cx+(x-cx)*.93,cy+(y-cy)*.93].map(v=>v.toFixed(2)).join(',')).join(' ');
    const color=statusColors[task?.status]||statusColors.base;
    const owner=state.settings.style==='project'&&line.project?state.projects.find(p=>p.id===line.project):null;
    const group=document.createElementNS(svgNS,'g');
    group.setAttribute('class','wall-line wall-triangle'+(selected.has(line.id)?' selected':'')+(state.pending?.lines?.[line.id]?' pending':'')+(owner?' reserved':''));
    group.setAttribute('tabindex','0');group.setAttribute('role','button');group.dataset.line=line.id;if(task)group.dataset.status=task.status;
    group.style.color=color;if(owner)group.style.setProperty('--tri-project',owner.color);
    const label=`${noun()} ${line.number} · ${lineDescription(line)}`;
    group.setAttribute('aria-label',label);const title=document.createElementNS(svgNS,'title');title.textContent=label;group.append(title);
    const face=document.createElementNS(svgNS,'polygon');face.setAttribute('class','tri-face');face.setAttribute('points',inset);face.style.fill=color;
    const edge=document.createElementNS(svgNS,'polygon');edge.setAttribute('class','tri-edge');edge.setAttribute('points',inset);
    const number=document.createElementNS(svgNS,'text');number.setAttribute('class','tri-number');number.setAttribute('x',cx);number.setAttribute('y',cy);number.textContent=line.number;
    group.append(face,edge,number);
    group.onclick=e=>choose(line.id,e.ctrlKey||e.metaKey||e.shiftKey);
    group.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(line.id,e.ctrlKey||e.metaKey||e.shiftKey)}};
    root.append(group);if(focused===line.id)group.focus({preventScroll:true});
  }
  sizeTriangleNumbers();
}
function sizeTriangleNumbers(){
  const scale=$('wall').getScreenCTM()?.a;if(!scale)return;
  const px=Math.max(11,parseFloat(getComputedStyle(host).getPropertyValue('--number-size'))||12);
  for(const text of $('wall').querySelectorAll('.tri-number'))text.style.fontSize=px/scale+'px';
}
// Persistent Prism wall. The app owns colors, identity, commands and selection.
let prism=null, prismGeometryKey='', prismError='', prismLabelError='';
function zoneColors(line){
  const task=lineTask(line),style=getComputedStyle(host);
  const status=task?.status||'base',base=style.getPropertyValue('--wall-'+status).trim();
  const colors=[base,base];
  if(state.settings.style==='project'){
    const owner=state.projects.find(p=>p.id===(task?.project||line.project));
    colors[line.signature]=owner?.color||style.getPropertyValue('--wall-base').trim();
  }
  return colors;
}
function drawWall(){
  if(kindOf()==='panels')return drawTriangleWall();
  if(!Prism||!PrismAdapters||!state?.lines.length){
    prismError=state?.lines.length&&(!Prism||!PrismAdapters)?'Prism artwork unavailable. Showing standard Lines. Repair the app installation to restore the crystal artwork.':'';
    $('numbersOption').hidden=true;
    if(prism){prism.destroy();prism=null;prismGeometryKey='';$('wallHost').innerHTML='<svg id="wall" role="group" aria-label="Nanoleaf wall map"></svg>'}
    return drawStandardWall();
  }
  let layout;
  try{layout=PrismAdapters.fromState(state,zoneColors);Prism.validate(layout);prismError=''}
  catch{prismError='Connector layout unavailable. '+(prism?'Keeping the last valid wall.':'Showing standard Lines.');if(!prism){$('numbersOption').hidden=true;return drawStandardWall()}}
  $('numbersOption').hidden=false;
  if(layout){
    const key=JSON.stringify([layout.nodes,layout.lines.map(({colors,...line})=>line)]);
    if(!prism){
      prism=new Prism.Renderer($('wallHost'),layout,{animate:false,onSelect(event,line){choose(line.id,event.ctrlKey||event.metaKey||event.shiftKey);prism.parts.control[line.index]?.focus({preventScroll:true})},onFrame(snapshot){assembly.active=snapshot.playing;$('wall')?.classList.toggle('assembling',snapshot.playing)}});
      prism.svg.id='wall';prism.svg.setAttribute('aria-label','Nanoleaf wall map');prism.showAllNumbers(showAllNumbers);prismGeometryKey=key;
    }else if(key!==prismGeometryKey){
      prism.setLayout(layout);prism.svg.id='wall';prism.svg.setAttribute('aria-label','Nanoleaf wall map');prismGeometryKey=key;
    }
  }
  const available=new Set(prism.layout.lines.map(line=>line.id));
  for(const line of state.lines)if(available.has(line.id))prism.setColors(line.id,zoneColors(line));
  prism.setMode(state.mode);
  prism.setActivity(state.lines.filter(line=>available.has(line.id)&&lineTask(line)&&lineTask(line).status!=='idle').map(line=>line.id));
  prism.setSelection([...selected].filter(id=>available.has(id)));
  prism.setPending(Object.keys(state.pending?.lines||{}).filter(id=>available.has(id)));
  prism.setLineMetadata(Object.fromEntries(state.lines.filter(line=>available.has(line.id)).map(line=>[line.id,{ariaLabel:`Line ${line.number} · ${lineDescription(line)}`,status:lineTask(line)?.status||null}])));
  prism.showAllNumbers(showAllNumbers);
  sizeLineNumbers();
}
let prismNumberLayoutKey='';
function sizePrismNumbers(){
  if(!PrismLabels){
    prismLabelError='Number labels are unavailable. Line controls remain available. Repair the app installation to restore the labels.';
    $('showNumbers').disabled=true;$('showNumbers').title=prismLabelError;
    for(const tag of Object.values(prism.parts.label)){tag.dataset.labelLayout='unsolved'}
    return;
  }
  $('showNumbers').disabled=false;$('showNumbers').title='Show every physical Line number on this browser only';
  const matrix=prism.svg.getScreenCTM();if(!matrix)return;
  const scale=Math.hypot(matrix.a,matrix.b);if(!scale)return;
  const pixels=Math.max(11,parseFloat(getComputedStyle(host).getPropertyValue('--number-size'))||12),size=pixels/scale,canvas=prism.host.getBoundingClientRect();
  if(!(canvas.width>0&&canvas.height>0))return;
  const labels=prism.layout.lines.map(line=>{
    const tag=prism.parts.label[line.index],mark=tag.querySelector('[data-part="luminous-numeral"]');
    mark.style.fontSize=size+'px';
    for(const text of tag.querySelectorAll('text')){text.style.fontSize=size+'px';text.textContent=line.number}
    const box=tag.querySelector('.number').getBBox(),width=Math.max(24,box.width*scale+8),height=Math.max(24,box.height*scale+8);
    let hit=tag.querySelector('.number-hit');
    if(!hit){hit=document.createElementNS(svgNS,'rect');hit.setAttribute('class','number-hit');hit.setAttribute('aria-hidden','true');tag.insertBefore(hit,tag.firstChild)}
    hit.setAttribute('x',-width/scale/2);hit.setAttribute('y',-height/scale/2);hit.setAttribute('width',width/scale);hit.setAttribute('height',height/scale);hit.setAttribute('rx',Math.min(width,height)/scale/4);
    return {line,tag,width,height};
  });
  const key=JSON.stringify([prism.p,prismGeometryKey,[matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f],canvas.left,canvas.top,canvas.width,canvas.height,pixels,labels.map(item=>[item.line.id,item.width,item.height])]);
  if(key===prismNumberLayoutKey)return;prismNumberLayoutKey=key;
  const point=source=>{const value=new DOMPoint(source.x,source.y).matrixTransform(matrix);return {x:value.x,y:value.y}};
  const geometry={scale,canvas:{left:canvas.left,top:canvas.top,width:canvas.width,height:canvas.height},nodes:prism.layout.nodes.map(node=>({id:node.id,...point(node)})),lines:labels.map(({line,width,height})=>{
    const node=prism.layout.nodes[line.a],angle=line.angle*Math.PI/180,start={x:node.x+Math.cos(angle)*line.da,y:node.y+Math.sin(angle)*line.da},end={x:start.x+Math.cos(angle)*line.tubeLength,y:start.y+Math.sin(angle)*line.tubeLength};
    return {id:line.id,number:line.number,start:point(start),end:point(end),width,height,fontSizePx:pixels};
  })};
  const result=PrismLabels.placeLabels(geometry),byId=new Map(result.placements.map(placement=>[placement.id,placement])),inverse=matrix.inverse();
  prism.labelTransforms.clear();
  for(const {line,tag,width,height} of labels){
    const placement=byId.get(line.id);tag.dataset.labelLayout=placement?'placed':'unsolved';tag.dataset.labelWidthPx=width;tag.dataset.labelHeightPx=height;
    if(placement){const local=new DOMPoint(placement.x,placement.y).matrixTransform(inverse);prism.labelTransforms.set(line.id,`translate(${local.x} ${local.y})`)}
  }
  prism.positionLabels();
  prism.updateInteraction();
  prismLabelError=result.ok?'':`Line numbers could not be placed safely: ${result.unsolved.map(line=>line.number).join(', ')}. The Line controls remain available.`;
}
/* Opening assembly: the structure unfolds outward from the orb. Presentation only; it never writes. */
const assembly={active:false,hold:false,animations:[],key:'',seen:false};
const assemblyPrefs={opening:'wall.assembly.opening',entry:'wall.assembly.entry'};
function assemblyPref(name){try{return localStorage.getItem(assemblyPrefs[name])!=='0'}catch{return true}}
function setAssemblyPref(name,on){try{if(on)localStorage.removeItem(assemblyPrefs[name]);else localStorage.setItem(assemblyPrefs[name],'0')}catch{}}
function geometryKey(){return JSON.stringify([state.connector_layout,state.lines.map(l=>[l.id,l.points]),state.settings.rotation,state.settings.flip_x,state.settings.flip_y])}
function reducedMotion(){return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches}
function playAssembly(reason){
  if(disposed||assembly.active||!state?.lines.length||kindOf()!=='lines')return false;
  if(!['opening','entry','replay'].includes(reason))return false;
  if(reason==='opening'&&!assemblyPref('opening'))return false;
  if(reason==='entry'&&!assemblyPref('entry'))return false;
  if(reducedMotion())return false;
  if(prism){assembly.key=geometryKey();prism.replay();return prism.playing}
  assembly.hold=false;wallFingerprint='';drawWall();
  const root=$('wall'),orb=root.querySelector('.orb'),cx=+orb.getAttribute('cx'),cy=+orb.getAttribute('cy');
  // Connect Lines whose ends nearly touch, then walk outward from each section's Line nearest the orb.
  const lines=state.lines.map(l=>({id:l.id,ends:[transform(l.points[0]),transform(l.points[2])]}));
  const gap=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  const adjacent=new Map(lines.map(l=>[l.id,[]]));
  for(const a of lines)for(const b of lines)if(a!==b&&a.ends.some(e=>b.ends.some(f=>gap(e,f)<=40)))adjacent.get(a.id).push(b);
  const depth=new Map(),hinge=new Map(),seen=new Set();
  const toOrb=l=>Math.min(...l.ends.map(e=>gap(e,[cx,cy])));
  // Every Line that meets the hub unfolds first, together; each unconnected section starts from its own nearest Line.
  const hubLines=lines.filter(l=>toOrb(l)<=40);
  const starts=hubLines.length?[hubLines,...[...lines].sort((a,b)=>toOrb(a)-toOrb(b)).map(l=>[l])]:[...lines].sort((a,b)=>toOrb(a)-toOrb(b)).map(l=>[l]);
  for(const roots of starts){
    const fresh=roots.filter(l=>!seen.has(l.id));if(!fresh.length)continue;
    const queue=fresh.map(l=>{seen.add(l.id);return [l,0,[[cx,cy]]]});
    while(queue.length){
      const [line,d,from]=queue.shift();depth.set(line.id,d);
      const h=line.ends.reduce((best,e)=>Math.min(...from.map(f=>gap(e,f)))<Math.min(...from.map(f=>gap(best,f)))?e:best);
      hinge.set(line.id,h);
      for(const next of adjacent.get(line.id))if(!seen.has(next.id)){seen.add(next.id);queue.push([next,d+1,line.ends])}
    }
  }
  const maxDepth=Math.max(0,...depth.values()),duration=520,step=Math.min(450,Math.max(120,(2000-250-duration-320)/Math.max(1,maxDepth))),total=250+maxDepth*step+duration+320;
  const animations=[];
  const orbGroup=root.querySelector('.orb-group');
  animations.push(orbGroup.animate([{opacity:0,transform:'scale(.3)'},{opacity:1,transform:'scale(1.25)',offset:.7},{opacity:1,transform:'scale(1)'}],{duration:340,fill:'both',id:'assembly'}));
  const settleAt=new Map();
  for(const line of lines){
    const group=root.querySelector(`[data-line="${line.id}"]`),h=hinge.get(line.id),d=depth.get(line.id),far=line.ends[0]===h?line.ends[1]:line.ends[0];
    // Fold the Line back toward the orb around its hinge, then swing it out to its true angle.
    const toFar=Math.atan2(far[1]-h[1],far[0]-h[0]),toOrbAngle=Math.atan2(cy-h[1],cx-h[0]);
    let fold=(toOrbAngle-toFar)*180/Math.PI;fold=((fold+540)%360)-180;if(Math.abs(fold)<25)fold=fold<0?-70:70;fold*=.85;
    const delay=250+d*step;
    group.style.transformOrigin=`${h[0]}px ${h[1]}px`;
    animations.push(group.animate([{transform:`rotate(${fold}deg)`,opacity:0},{transform:`rotate(${fold*.45}deg)`,opacity:1,offset:.3},{transform:'rotate(0deg)',opacity:1}],{duration,delay,easing:'cubic-bezier(.2,.8,.3,1.05)',fill:'both',id:'assembly'}));
    for(const end of line.ends)settleAt.set(end,delay+duration);
  }
  // Each connector lights, with a brief flare, when the first Line meeting it settles.
  for(const node of root.querySelectorAll('.connector')){
    const x=+node.dataset.x,y=+node.dataset.y;
    let settle=Infinity;for(const [end,at] of settleAt)if(gap(end,[x,y])<=40)settle=Math.min(settle,at);
    if(!isFinite(settle))settle=250;
    animations.push(node.animate([{opacity:0,transform:'scale(.4)'},{opacity:1,transform:'scale(1.35)',offset:.45},{opacity:1,transform:'scale(1)'}],{duration:380,delay:Math.max(0,settle-140),fill:'both',id:'assembly'}));
  }
  animations.push(root.querySelector('.numbers').animate([{opacity:0},{opacity:0,offset:Math.max(0,1-320/total)},{opacity:1}],{duration:total,fill:'both',id:'assembly'}));
  assembly.active=true;assembly.animations=animations;assembly.key=geometryKey();root.classList.add('assembling');
  Promise.all(animations.map(a=>a.finished.catch(()=>{}))).then(()=>{if(!disposed&&assembly.active&&assembly.animations===animations)endAssembly()});
  return true;
}
function endAssembly(afterPointer=false){
  if(disposed)return;
  if(prism){prism.finish('interaction');assembly.active=false;return}
  if(!assembly.active)return;
  for(const a of assembly.animations){try{a.finish()}catch{}a.cancel()}
  assembly.active=false;assembly.animations=[];
  const root=$('wall');root.classList.remove('assembling');
  for(const group of root.querySelectorAll('.wall-line'))group.style.transformOrigin='';
  const redraw=()=>{assembly.hold=false;if(!assembly.active){wallFingerprint='';drawWall();anchorPulses()}};
  if(!afterPointer)return redraw();
  // The finished nodes are already in place. Hold the redraw until the press's click has landed,
  // so the click reaches the node it pressed; a release that never comes is covered by a distant safety timer.
  assembly.hold=true;
  // Release on the pointer's own release (the click that follows runs before the queued redraw); a distant timer only guards a release that never arrives.
  const release=()=>{for(const type of ['click','pointerup','pointercancel'])host.removeEventListener(type,release,true);clearTimeout(timer);later(redraw,0)};
  const timer=later(release,5000);for(const type of ['click','pointerup','pointercancel'])listen(host,type,release,true);
}
function anchorPulses(){
  if(disposed||prism)return;
  // Every pulse shares the document timeline's phase, so rebuilds and mode changes never restart it.
  for(const animation of $('wall').getAnimations({subtree:true}))
    if((animation.animationName==='nanoleaf-pulse'||animation.animationName==='nanoleaf-pulseCore')&&animation.startTime!==0)animation.startTime=0;
}
function sizeLineNumbers(){
  if(kindOf()==='panels')return sizeTriangleNumbers();
  if(prism)return sizePrismNumbers();
  const scale=$('wall').getScreenCTM()?.a;if(!scale)return;
  const px=parseFloat(getComputedStyle(host).getPropertyValue('--number-size'))||12;
  const size=px/scale,h=size*1.55;
  for(const tag of $('wall').querySelectorAll('.number-tag')){
    const label=tag.querySelector('.number'),bg=tag.querySelector('.number-bg');
    label.style.fontSize=size+'px';
    const w=label.getComputedTextLength()+12/scale;
    // The pill is axis-aligned, so on a diagonal Line its nearer end cap sits closer than its half-height.
    const off=Math.max(18/scale,12+h/2+Math.abs(+tag.dataset.nx)*(w/2-h/2)+3/scale);
    const x=+tag.dataset.mx+tag.dataset.nx*off,y=+tag.dataset.my+tag.dataset.ny*off;
    label.setAttribute('x',x);label.setAttribute('y',y);
    bg.setAttribute('x',x-w/2);bg.setAttribute('y',y-h/2);bg.setAttribute('width',w);bg.setAttribute('height',h);bg.setAttribute('rx',h/2);
    bg.style.strokeWidth=1/scale+'px';
  }
}
function elapsed(start){if(!start)return 'Start time unavailable';let s=Math.max(0,Math.floor(Date.now()/1000-start));return s>=3600?`${Math.floor(s/3600)}h ${Math.floor(s%3600/60)}m`:s>=60?`${Math.floor(s/60)}m ${s%60}s`:`${s}s`}
function statusBadge(status,evidence){const badge=el('span',status+(evidence==='uncertain'?' · uncertain':''),'badge');badge.dataset.status=status;return badge}
function taskRow(t){
  const row=el('div',undefined,'task'),title=el('button',t.title,'task-title');row.dataset.task=t.id;title.type='button';title.dataset.focusKey=JSON.stringify([t.id,'title']);
  title.title=t.title;
  const dot=el('span',undefined,'dot');dot.dataset.status=t.status;
  const placement=el('div',undefined,'task-placement'),line=lineById(t.line);
  if(line){const badge=lineBadge(line,'in-use','Current task placement');badge.textContent=noun()+' '+line.number;badge.dataset.focusKey=JSON.stringify([t.id,'line']);placement.append(badge)}
  else placement.append(el('span','Waiting for a '+nounLower(),'small'));
  const meta=el('div',undefined,'task-meta');meta.append(statusBadge(t.status,t.statusEvidence),el('span',projectName(t.project)));
  row.append(dot,title,placement,meta);
  row.onclick=()=>{selected=new Set(lineById(t.line)?[t.line]:[]);taskFocus=t.id;drawWall();inspect();drawTasks();highlightAssociations()};
  return row;
}
function drawTasks(){
  const list=$('taskList'),focused=list.contains(document.activeElement)?document.activeElement:null,focusedId=focused?.closest('.task')?.dataset.task;
  const scroll=$('inspector').scrollTop;
  const selectedIds=selectedTaskIds(),filter=showAllTasks?$('taskFilter').value:'all',query=showAllTasks?$('taskSearch').value.trim().toLocaleLowerCase():'';
  const fingerprint=JSON.stringify([showAllTasks,[...selectedIds],focusedId,filter,query,state.tasks,state.lines.map(l=>[l.id,l.number,l.task]),state.projects.map(p=>[p.id,p.name])]);
  if(fingerprint===taskFingerprint)return;taskFingerprint=fingerprint;
  const inspector=$('inspector'),card=$('taskCard'),context=$('contextCard');
  // Keep compact tasks above the context card; the full list keeps the card near the controls.
  if(showAllTasks&&inspector.firstElementChild===card)inspector.insertBefore(context,card);
  else if(!showAllTasks&&inspector.firstElementChild!==card)inspector.append(context);
  list.dataset.compact=String(!showAllTasks);
  const priority=t=>({blocked:0,question:1,working:2,unread:3}[t.status]??4);
  const ordered=[...state.tasks].sort((a,b)=>priority(a)-priority(b)||a.id.localeCompare(b.id));
  const matches=ordered.filter(t=>(filter==='all'||(filter==='waiting'?!lineById(t.line):t.status===filter))&&(!query||[t.title,t.id,projectName(t.project)].join(' ').toLocaleLowerCase().includes(query)));
  const limit=state.lines.length,visible=showAllTasks?[...matches]:matches.slice(0,limit),retained=state.tasks.find(t=>t.id===focusedId);
  const outsideFilter=retained&&!matches.includes(retained);
  // A poll may change priority or filter membership while a keyboard user is on a row.
  if(retained&&(showAllTasks||limit>0)&&!visible.includes(retained)){if(!showAllTasks&&visible.length===limit)visible.pop();visible.push(retained);visible.sort((a,b)=>priority(a)-priority(b)||a.id.localeCompare(b.id))}
  const statuses=['blocked','question','working','unread',...(state.tasks.some(t=>t.status==='idle')?['idle']:[])];
  $('taskStatusCounts').textContent=statuses.map(status=>state.tasks.filter(t=>t.status===status).length+' '+status).join(' · ');
  $('waiting').textContent=state.tasks.filter(t=>!lineById(t.line)).length+' waiting for a '+nounLower();
  // The Tasks heading carries the total; this line says how many of them are on screen.
  $('taskSummary').textContent=(filter!=='all'||query?`${matches.length} match filter · `:'')+`${visible.length} shown`+(outsideFilter?' · 1 focused task outside filter':'');
  $('showAllTasks').textContent=showAllTasks?'Show fewer tasks':'Show all tasks';
  $('showAllTasks').setAttribute('aria-expanded',String(showAllTasks));
  $('taskFilters').hidden=!showAllTasks;
  const outside=[...selectedIds].filter(id=>!visible.some(t=>t.id===id)).length;
  $('showSelectedTasks').hidden=!outside;$('taskSelectionNote').hidden=!outside;
  $('taskSelectionNote').textContent=outside?`${outside} selected task${outside===1?'':'s'} outside this view.`:'';
  const existing=new Map([...list.querySelectorAll('.task')].map(row=>[row.dataset.task,row]));
  const rows=visible.map(t=>{
    const key=JSON.stringify([t,lineById(t.line)?.number,projectName(t.project)]);
    let row=existing.get(t.id);
    if(!row)row=taskRow(t);
    else if(row.dataset.fingerprint!==key){const fresh=taskRow(t);replaceKeepingFocus(row,...fresh.childNodes);row.onclick=fresh.onclick}
    row.dataset.fingerprint=key;return row;
  });
  if(!rows.length)rows.push(el('p',state.tasks.length?(!showAllTasks&&!limit?'No Lines available. Use Show all tasks to inspect retained tasks.':'No tasks match this filter.'):'No tracked tasks.','empty'));
  // Move siblings around the focused row instead of detaching it during a reorder.
  const pinned=focusedId?existing.get(focusedId):null;let next=null;
  for(const row of [...rows].reverse()){if(row!==pinned&&row.nextSibling!==next||!row.isConnected)list.insertBefore(row,next);next=row}
  for(const row of [...list.children])if(!rows.includes(row))row.remove();
  if(focused&&!focused.isConnected){
    const row=rows.find(row=>row.dataset.task===focusedId);
    const target=[...(row?.querySelectorAll('[data-focus-key]')||[])].find(node=>node.dataset.focusKey===focused.dataset.focusKey)||row?.querySelector('.task-title')||$('tasksTitle');
    target.focus({preventScroll:true});
  }
  restrictControls();
  $('inspector').scrollTop=scroll;
}
function selectedTaskIds(){const ids=new Set(state.lines.filter(l=>selected.has(l.id)).map(l=>l.task).filter(id=>state.tasks.some(t=>t.id===id)));if(taskFocus&&state.tasks.some(t=>t.id===taskFocus))ids.add(taskFocus);return ids}
$('showAllTasks').onclick=()=>{showAllTasks=!showAllTasks;drawTasks();highlightAssociations()};
$('taskFilter').onchange=$('taskSearch').oninput=()=>{drawTasks();highlightAssociations()};
$('taskList').addEventListener('focusout',()=>{taskFingerprint=''});
$('showSelectedTasks').onclick=()=>{showAllTasks=true;$('taskFilter').value='all';$('taskSearch').value='';drawTasks();highlightAssociations();$('taskList').querySelector('.task.selected .task-title')?.focus()};
function highlightAssociations(){
  const chosen=state.lines.filter(l=>selected.has(l.id)),taskIds=new Set(chosen.map(l=>l.task).filter(Boolean));
  if(taskFocus)taskIds.add(taskFocus);
  const projectIds=new Set(state.tasks.filter(t=>taskIds.has(t.id)).map(t=>t.project).filter(Boolean));
  if(state.settings.style==='project')for(const line of chosen)if(line.project)projectIds.add(line.project);
  for(const row of host.querySelectorAll('#projectList .project'))row.classList.toggle('selected',row.classList.contains('shared-pool')?chosen.some(l=>!l.project):projectIds.has(row.dataset.project));
  for(const row of host.querySelectorAll('.task'))row.classList.toggle('selected',taskIds.has(row.dataset.task));
  for(const badge of host.querySelectorAll('.line-badge')){const active=selected.has(badge.dataset.lineId);badge.classList.toggle('selected',active);badge.setAttribute('aria-pressed',String(active))}
  for(const line of host.querySelectorAll('.wall-line'))line.setAttribute('aria-pressed',String(selected.has(line.dataset.line)));
}
function inspect(){inspectContent();restrictControls()}
function inspectContent(){
  // One context card: the Line or Lines, then the task once, then the actions that act in this layout and mode.
  const chosen=state.lines.filter(l=>selected.has(l.id)).sort((a,b)=>a.number-b.number),project=state.settings.style==='project';
  const task=state.tasks.find(t=>t.id===(taskFocus||(chosen.length===1?chosen[0].task:null))),waiting=!chosen.length&&!!task&&!lineById(task.line);
  const kind=kindOf();
  $('selectionTitle').textContent=chosen.length===1?noun()+' '+chosen[0].number:chosen.length?(kind==='panels'?'Triangles ':'Lines ')+chosen.map(l=>l.number).join(', '):waiting?'Waiting for a '+nounLower():'Select a '+nounLower();
  // The hint never repeats the task: it counts several Lines, or says how to select when nothing is chosen.
  const hint=chosen.length>1?chosen.length+(kind==='panels'?' triangles selected.':' physical Lines selected.'):chosen.length||waiting?'':'Click a '+nounLower()+' on the wall or a numbered badge to see its task. Ctrl/⌘ or Shift selects several.';
  $('selectionHint').textContent=hint;$('selectionHint').hidden=!hint;
  $('selectionBody').hidden=!chosen.length;
  // Halves are a Lines feature; a triangle is one zone.
  $('swap').hidden=!project||kind!=='lines';
  // Reserved for shows the selected Lines' reservation and applies on change; it resyncs from polled state unless it is being edited.
  const reservation=$('reservation'),owners=new Set(chosen.map(l=>l.project||''));
  reservation.hidden=!(project&&chosen.length);
  if(!reservation.hidden){
    const select=$('assignProject');selectOptions(select,'Shared pool');
    select.title=kind==='panels'?'Only this project\'s tasks use the triangle, and its outline shows the project colour. Shared pool lets any task use it.':'Only this project\'s tasks use the Line, and it shows the project colour on one half. Shared pool lets any task use it.';
    let mixed=select.querySelector('option[value="mixed"]');
    if(owners.size>1){if(!mixed){mixed=el('option','Several reservations');mixed.value='mixed';mixed.disabled=true;select.prepend(mixed)}}
    else if(mixed)mixed.remove();
    if(document.activeElement!==select)select.value=owners.size>1?'mixed':[...owners][0];
  }
  $('locate').textContent=chosen.length===1?'Locate '+noun()+' '+chosen[0].number:'Locate';
  $('locate').disabled=chosen.length!==1||state.mode==='free';
  $('locateHint').hidden=state.mode!=='free';$('locateHint').textContent=state.mode==='free'?'Switch to Work or Quiet to locate a '+nounLower()+'.':'';
  const detail=$('taskDetail');
  const refocusEvict=task&&document.activeElement?.dataset.evictTask===task.id;
  const fingerprint=JSON.stringify([chosen.length,project,kind,task&&[task.id,task.title,task.status,task.statusEvidence,task.project,task.manual,task.started,task.codexUrl,task.evictionToken],state.projects.map(p=>[p.id,p.name])]);
  if(fingerprint===detailFingerprint){
    // Keep the elapsed time in step without rebuilding the card.
    const clock=detail.querySelector('[data-elapsed]');if(clock&&task)clock.textContent=elapsed(task.started);
    return;
  }
  detailFingerprint=fingerprint;
  if(detail.contains(document.activeElement))$('tasksTitle').focus({preventScroll:true});
  detail.replaceChildren();
  if(!task){if(chosen.length)detail.append(el('p',chosen.length>1?'Select one '+nounLower()+' to inspect its task.':'No task on this '+nounLower()+'.','small'));return}
  const head=el('div',undefined,'detail-head');head.append(el('h3',task.title),statusBadge(task.status,task.statusEvidence));detail.append(head);
  for(const [key,value]of[['Project',projectName(task.project)],['Elapsed',elapsed(task.started)]]){const row=el('div',undefined,'kv'),node=el('span',value);if(key==='Elapsed')node.dataset.elapsed='';row.append(el('span',key),node);detail.append(row)}
  if(typeof task.codexUrl==='string'&&/^codex:\/\/threads\/[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/.test(task.codexUrl)){const link=el('a','Open in Codex','codex-link');link.href=task.codexUrl;detail.append(link)}
  if(task.evictionToken){
    const evict=el('button','Evict task','field');evict.type='button';evict.dataset.evictTask=task.id;
    evict.onclick=()=>action('/api/evict',{id:task.id,evictionToken:task.evictionToken});
    detail.append(evict,el('p','Clears this device only. New work can appear again.','small'));
    if(refocusEvict)evict.focus({preventScroll:true});
  }
}
function pendingText(){
  if(state.pending===true)return 'Wall edit pending.';
  const p=state.pending,parts=[];
  if(p.settings?.style)parts.push(p.settings.style+' layout');
  for(const [id,edit] of Object.entries(p.lines||{})){
    const line=lineById(id);let text=line?noun()+' '+line.number:noun()+' unavailable';
    if(Object.hasOwn(edit,'project'))text+=' → '+(edit.project?projectName(edit.project):'Shared pool');
    if(Object.hasOwn(edit,'signature'))text+=' · half swap';
    parts.push(text);
  }
  for(const [id,project] of Object.entries(p.tasks||{})){
    const task=state.tasks.find(t=>t.id===id),line=lineById(task?.line);
    const source=line?`${noun()} ${line.number} · ${task.title}`:task?`${task.title} (${task.line?noun()+' unavailable':'Waiting for a '+nounLower()})`:'Unavailable task';
    parts.push(source+' → '+(project?projectName(project):'Use Codex assignment'));
  }
  return 'After this comet: '+parts.join(' · ');
}
function render(){
  restoreControls();
  const scroll=$('inspector').scrollTop,pageX=window.scrollX,pageY=window.scrollY;
  selected=new Set([...selected].filter(id=>lineById(id)));
  if(taskFocus){const task=state.tasks.find(t=>t.id===taskFocus);if(!task){taskFocus=null;selected.clear()}else selected=new Set(lineById(task.line)?[task.line]:[])}
  if(host.dataset.mode!==state.mode)host.dataset.mode=state.mode;
  if(host.dataset.style!==state.settings.style)host.dataset.style=state.settings.style;
  if(host.dataset.kind!==kindOf())host.dataset.kind=kindOf();
  deviceList=Array.isArray(state.devices)?state.devices:deviceList;drawDevices();
  $('taskFilter').querySelector('option[value="waiting"]').textContent='Waiting for a '+nounLower();
  for(const id of ['classic','project']){const on=id===state.settings.style;$(id).classList.toggle('active',on);$(id).setAttribute('aria-pressed',String(on))}
  for(const id of ['work','free','quiet']){const on=id===state.mode;$(id).classList.toggle('active',on);$(id).setAttribute('aria-pressed',String(on))}
  $('coverage').value=state.settings.coverage;$('coverageOption').hidden=state.settings.style!=='project'||kindOf()!=='lines';
  // Assembly is the Lines' Prism sequence; the triangle view has none to replay.
  $('assemblyOption').hidden=kindOf()!=='lines';
  $('flipX').setAttribute('aria-pressed',String(!!state.settings.flip_x));$('flipY').setAttribute('aria-pressed',String(!!state.settings.flip_y));
  $('lineCount').textContent=state.lines.length+' '+nounPlural();$('taskCount').textContent=state.tasks.length;
  if(assembly.active&&geometryKey()!==assembly.key)endAssembly();
  drawColors();drawProjects();drawWall();inspect();drawTasks();highlightAssociations();anchorPulses();
  if(!assembly.seen&&state.lines.length&&kindOf()==='lines'){assembly.seen=true;playAssembly('opening')}
  const busy=state.pending?pendingText():state.mode_pending?'Mode change pending.':'';if($('busy').textContent!==busy)$('busy').textContent=busy;
  $('connection').textContent=state.current?'Live':'Stale';$('connection').classList.toggle('offline',!state.current);
  readout();
  message(state.error||state.geometry_error||prismError||prismLabelError||'',!!(state.error||state.geometry_error||prismError||prismLabelError));
  restrictControls();
  $('inspector').scrollTop=scroll;if(window.scrollX!==pageX||window.scrollY!==pageY)window.scrollTo(pageX,pageY);
}
// Task-light palette. The server owns the saved colors; the map shows them and edits them through /api/settings.
// Each role lists its suggested swatches, default first.
const paletteRoles=[
  ['base','Base','Unused Lines and read or interrupted tasks',[['#0a1866','Dim blue'],['#193cff','Blue'],['#4d3f2a','Dim warm white'],['#000000','Off']]],
  ['working','Working','Tasks that are working',[['#00ff00','Green']]],
  ['question','Question','Tasks with a question that keep working',[['#ffff00','Yellow'],['#ffb000','Amber']]],
  ['blocked','Blocked','Tasks waiting for input or approval',[['#ff0000','Red']]],
  ['unread','Unread','Finished tasks waiting for review',[['#9b30ff','Violet'],['#ff00c0','Magenta'],['#00e5ff','Cyan'],['#ffe0b0','Warm white']]]];
const paletteDefaults=Object.fromEntries(paletteRoles.map(([role,,,swatches])=>[role,swatches[0][0]]));
const hexRgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
const linear=c=>(c/=255)<=.04045?c/12.92:((c+.055)/1.055)**2.4;
const luminance=hex=>{const [r,g,b]=hexRgb(hex).map(linear);return .2126*r+.7152*g+.0722*b};
// Status text mixes the chosen color toward white until it reaches 4.5:1 against the page.
function readableColor(hex){
  const page=luminance(getComputedStyle(host).getPropertyValue('--bg').trim()||'#05070d'),rgb=hexRgb(hex);
  for(let step=0;step<=20;step++){
    const mixed='#'+rgb.map(c=>Math.round(c+(255-c)*step/20).toString(16).padStart(2,'0')).join('');
    if((luminance(mixed)+.05)/(page+.05)>=4.5)return mixed;
  }
  return '#ffffff';
}
function labColor(hex){
  const [r,g,b]=hexRgb(hex).map(linear),f=t=>t>216/24389?Math.cbrt(t):(24389/27*t+16)/116;
  const x=f((r*.4124+g*.3576+b*.1805)/.95047),y=f(r*.2126+g*.7152+b*.0722),z=f((r*.0193+g*.1192+b*.9505)/1.08883);
  return [116*y-16,500*(x-y),200*(y-z)];
}
// Two roles closer than a CIE76 difference of 20 are hard to tell apart on the lights.
function similarRoles(palette){
  const pairs=[];
  paletteRoles.forEach(([a,labelA],i)=>paletteRoles.slice(i+1).forEach(([b,labelB])=>{
    const [p,q]=[labColor(palette[a]),labColor(palette[b])];
    if(Math.hypot(p[0]-q[0],p[1]-q[1],p[2]-q[2])<20)pairs.push(labelA+' and '+labelB);
  }));
  return pairs;
}
function setPaletteColor(role,hex){if(state?.palette?.[role]!==hex.toLowerCase())action('/api/settings',{palette:{[role]:hex.toLowerCase()}})}
function buildColors(){
  const rows=$('colorRows');
  for(const [role,label,description,swatches] of paletteRoles){
    const row=el('div',undefined,'color-row'),name=el('span',label,'role'),group=el('div',undefined,'swatches');
    row.dataset.role=role;name.id='colorRole-'+role;name.title=description;
    group.setAttribute('role','group');group.setAttribute('aria-labelledby',name.id);
    swatches.forEach(([hex,swatchName],i)=>{
      const button=el('button',undefined,'swatch');button.type='button';button.dataset.color=hex;button.style.setProperty('--chip',hex);
      button.setAttribute('aria-label',swatchName+(i?'':' (default)'));button.title=label+': '+swatchName+(i?'':' (default)');
      button.setAttribute('aria-pressed','false');button.onclick=()=>setPaletteColor(role,hex);group.append(button);
    });
    const wheel=el('label',undefined,'custom-color'),custom=el('input');wheel.title=label+': custom color';
    custom.type='color';custom.setAttribute('aria-label',label+' custom color');
    custom.onchange=()=>setPaletteColor(role,custom.value);custom.onblur=()=>{lastPalette=''};
    wheel.append(custom);group.append(wheel);row.append(name,group);rows.append(row);
  }
  $('resetColors').onclick=()=>action('/api/settings',{palette:'default'});
}
let lastPalette='';
function drawColors(){
  const palette={...paletteDefaults,...state.palette},key=JSON.stringify(palette);
  if(key===lastPalette)return;lastPalette=key;
  const root=host.style;
  for(const [role] of paletteRoles)root.setProperty('--wall-'+role,palette[role]);
  root.setProperty('--wall-idle',palette.base);
  // Default colors keep the stylesheet's hand-tuned text tones; chosen ones are lifted until readable.
  for(const [chip,role] of [['working','working'],['question','question'],['blocked','blocked'],['unread','unread'],['idle','base']]){
    if(palette[role]===paletteDefaults[role])root.removeProperty('--chip-'+chip);else root.setProperty('--chip-'+chip,readableColor(palette[role]));
  }
  $('colorStrip').replaceChildren(...paletteRoles.map(([role])=>{const chip=el('i');chip.style.setProperty('--chip',palette[role]);return chip}));
  for(const row of $('colorRows').children){
    const role=row.dataset.role,buttons=[...row.querySelectorAll('.swatch')],custom=row.querySelector('input[type="color"]');
    let matched=false;
    for(const button of buttons){const on=button.dataset.color===palette[role];matched||=on;button.setAttribute('aria-pressed',String(on))}
    if(document.activeElement!==custom)custom.value=palette[role];
    custom.parentNode.classList.toggle('chosen',!matched);custom.parentNode.style.setProperty('--chip',palette[role]);
  }
  const similar=similarRoles(palette),warning=$('colorWarning');
  warning.hidden=!similar.length;
  warning.textContent=similar.length?similar.join('; ')+' look alike and may be hard to tell apart on the lights.':'';
  $('resetColors').disabled=paletteRoles.every(([role])=>palette[role]===paletteDefaults[role]);
}
let lastReadout='';
function readout(){
  // Live status only, not a mirror of the controller: the mode note, a pending flag and the alerts.
  // The Line and task totals live at their headings.
  const count=status=>state.tasks.filter(t=>t.status===status).length;
  const [note,detail]=modeNotes[state.mode]||['',''],resting=state.mode!=='free'&&!state.tasks.length;
  const parts=[[resting?note.split(' · ')[0]+' · scene playing':note,'mode',resting?'No active indicators. Your remembered scene plays on the wall.':detail]];
  if(state.pending)parts.push(['pending edit','pending']);else if(state.mode_pending)parts.push(['mode change pending','pending']);
  const alerts=['blocked','question'].filter(status=>count(status)).map(status=>[count(status)+' '+status,status]);
  parts.push(...(alerts.length?alerts:[['no alerts']]));
  const key=JSON.stringify(parts);if(key===lastReadout)return;lastReadout=key;
  const node=$('readout');node.replaceChildren();
  parts.forEach(([text,kind,title],i)=>{
    if(i)node.append(' · ');
    if(!kind)return node.append(text);
    const part=el('b',text);
    if(kind==='mode'){part.id='wallNote';part.className='mode-note';part.title=title}
    else if(kind==='pending')part.className='pending';
    else part.dataset.alert=kind;
    node.append(part);
  });
}
$('device').onchange=()=>switchDevice($('device').value);
for(const id of ['classic','project'])$(id).onclick=()=>action('/api/settings',{style:id});for(const mode of ['work','free','quiet'])$(mode).onclick=()=>action('/api/mode',{mode});$('coverage').onchange=()=>action('/api/settings',{coverage:$('coverage').value});$('assignProject').onchange=()=>{const value=$('assignProject').value;if(value==='mixed')return;action('/api/assign',{lines:Object.fromEntries([...selected].map(id=>[id,{project:value||null}]))})};$('swap').onclick=()=>action('/api/assign',{lines:Object.fromEntries(state.lines.filter(l=>selected.has(l.id)).map(l=>[l.id,{signature:1-l.signature}]))});$('locate').onclick=()=>{const id=[...selected][0],group=$('wall').querySelector(`[data-line="${id}"]`);if(group){group.classList.remove('locating');void group.getBBox();group.classList.add('locating');later(()=>group.classList.remove('locating'),1000)}action('/api/locate',{line:id})};$('rotate').onclick=()=>action('/api/settings',{rotation:(state.settings.rotation+90)%360});$('flipX').onclick=()=>action('/api/settings',{flip_x:1-state.settings.flip_x});$('flipY').onclick=()=>action('/api/settings',{flip_y:1-state.settings.flip_y});const observer=new ResizeObserver(()=>{if(state)sizeLineNumbers()});observer.observe($('wallHost'));
buildColors();
$('showNumbers').onclick=()=>{showAllNumbers=!showAllNumbers;try{showAllNumbers?localStorage.setItem(showAllNumbersKey,'1'):localStorage.removeItem(showAllNumbersKey)}catch{}syncNumberControl()};
syncNumberControl();
listen(window.matchMedia('(prefers-reduced-motion: reduce)'),'change',()=>frame(anchorPulses));
// Assembly controls. Any other interaction completes a running assembly before its own action.
$('replay').onclick=()=>playAssembly('replay');
for(const [id,name] of [['assemblyOnOpen','opening'],['assemblyOnEntry','entry']]){$(id).checked=assemblyPref(name);$(id).onchange=()=>setAssemblyPref(name,$(id).checked)}
for(const type of ['pointerdown','keydown'])listen(host,type,e=>{if(assembly.active&&!e.target.closest?.('#wallOptions'))endAssembly(type==='pointerdown')},true);
// Clearing: Escape (after closing an open Options menu) or a click on empty wall canvas; focus returns to the wall heading.
function clearSelection(){selected.clear();taskFocus=null;$('wallTitle').focus({preventScroll:true});drawWall();inspect();drawTasks();highlightAssociations()}
$('wallHost').addEventListener('click',e=>{if(e.target.closest?.('.wall-line,.number-tag,.number-hit,[data-hit]'))return;if(selected.size||taskFocus)clearSelection()});
// The Options menu closes on Escape, returning focus to its control, or on a press elsewhere.
const optionsMenu=$('wallOptions');
listen(host,'pointerdown',e=>{if(optionsMenu.open&&!e.target.closest?.('#wallOptions'))optionsMenu.open=false},true);
listen(host,'keydown',e=>{
  if(e.key!=='Escape')return;
  if(optionsMenu.open){const inside=optionsMenu.contains(document.activeElement);optionsMenu.open=false;if(inside)optionsMenu.querySelector('summary').focus();return}
  if(e.target.closest?.('#taskFilters'))return;
  if(selected.size||taskFocus)clearSelection();
});

listen(window,'pagehide',()=>prism?.pause());
listen(window,'pageshow',()=>prism?.resume());
// Elapsed labels are a local presentation clock, not another state poll.
later(function tick(){if(state)inspect();later(tick,1000)},1000);

  return {
    update(view, allowed){
      if(disposed)return;
      editable=allowed;
      if(state?.id!==view.id){endAssembly();selected.clear();taskFocus=null;resetWallViews();assembly.seen=false}
      state=view;device=view.id;deviceList=view.devices;render();
    },
    dispose(){
      if(disposed)return;disposed=true;
      const animations=assembly.animations;assembly.active=false;assembly.hold=false;assembly.animations=[];
      for(const animation of animations)animation.cancel();
      observer.disconnect();for(const off of listeners)off();
      for(const id of timers)clearTimeout(id);for(const id of frames)cancelAnimationFrame(id);
      prism?.destroy();host.replaceChildren();
    }
  };
}
