import type {Identity, SessionSnapshot} from '@jimmie-potts/agent-state';
import type {MonitorFilter} from '@pixoo/core';
import type {MonitorView} from './sources.js';

export type DashboardFilter = MonitorFilter;
export type DashboardRow = {
 identity:Identity; label:string; shortLabel:string; title?:SessionSnapshot['title']; project?:string; activity:SessionSnapshot['activity'];
 attention:'approval'|'input'|'question'|'none'; uncertain:boolean;
 activeChildren:number; childrenUncertain:boolean; noticeIds:string[];
 observedAtMs:number; lastEvidenceAtMs:number; freshness:SessionSnapshot['freshness']; unavailable:SessionSnapshot['unavailable'];
};
export type DashboardLayout = {
 version:1; ownerId:string; revision:number|null; asOfMs:number|null;
 connection:MonitorView['connection']; collector:NonNullable<MonitorView['snapshot']>['collector']|'unknown';
 total:number; matched:number; attentionTotal:number; page:number; pages:number;
 rows:DashboardRow[];
};
const key=(identity:Identity)=>JSON.stringify([identity.provider,identity.client,identity.hostId,identity.sourceId,identity.sessionId]);
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
// Display characters in an identifier, drawn as two lines of ten. A layout change may alter the width, not the rule.
export const IDENTIFIER_WIDTH=20;
const MARKER='…',PAGE_SIZE=1;
const displayChars=(value:string)=>Array.from(value.normalize('NFD').replace(/\p{M}/gu,'').toUpperCase()).map(char=>/^[A-Z0-9 ._+!?/-]$/.test(char)?char:'?');
/** A chosen label: whole when it fits, otherwise its first and last characters around the marker. */
export function shortLabel(label:string,width=IDENTIFIER_WIDTH):string {
 const chars=displayChars(label);
 if(chars.length<=width)return chars.join('');
 const head=Math.ceil((width-1)/2),tail=width-1-head;
 return [...chars.slice(0,head),MARKER,...chars.slice(chars.length-tail)].join('');
}
/** An unlabeled session's ID: whole when it fits, otherwise the marker and its end, which differs between time-ordered IDs. */
export function shortSessionId(sessionId:string):string {
 const chars=displayChars(sessionId);
 return chars.length<=IDENTIFIER_WIDTH?chars.join(''):[MARKER,...chars.slice(chars.length-IDENTIFIER_WIDTH+1)].join('');
}
function attention(session:SessionSnapshot):DashboardRow['attention'] {
 for(const kind of ['approval','input','question'] as const)if(session.attention.some(item=>item.kind===kind))return kind;
 return 'none';
}
function notices(session:SessionSnapshot,consumer:string):string[]{return session.notices.filter(n=>!n.acknowledgedBy.includes(consumer)).map(n=>n.id);}
function rank(session:SessionSnapshot,consumer:string):number {
 const kind=attention(session);return kind==='approval'||kind==='input'?0:kind==='question'?1:notices(session,consumer).length?2:3;
}
/** Routine ordering/read limits stay in metadata without dimming an otherwise known session. */
function warnsForUnavailable(evidence:SessionSnapshot['unavailable'][number]):boolean {
 return !((evidence.dimension==='ordering'||evidence.dimension==='read')&&
  (evidence.reason==='missing'||evidence.reason==='unsupported'||evidence.reason==='inaccessible'));
}
export class DashboardPager {
 private page=0;
 private membership='';
 private deadline=0;
 private lastNow=0;
 constructor(private readonly consumer='pixoo'){}
 layout(view:MonitorView,nowMs:number,filter:DashboardFilter={}):DashboardLayout {
  if(!Number.isFinite(nowMs)||nowMs<0)throw new Error('invalid-dashboard-clock');
  const now=Math.max(this.lastNow,nowMs);this.lastNow=now;
  const all=view.snapshot?.sessions??[];
  const top=all.filter(s=>s.parent.status!=='known'||s.unavailable.some(u=>u.dimension==='parent'&&u.reason==='ambiguous'));
  const ordered=top.filter(s=>(!filter.projectId||s.projectId===filter.projectId)&&(!filter.session||key(s.identity)===key(filter.session))&&(!filter.provider||s.identity.provider===filter.provider)&&(!filter.q||[s.label,s.title?.value,s.project,s.identity.sessionId].some(value=>value?.toLowerCase().includes(filter.q!.toLowerCase()))))
   .sort((a,b)=>rank(a,this.consumer)-rank(b,this.consumer)||compare(key(a.identity),key(b.identity)));
  const pages=Math.max(1,Math.ceil(ordered.length/PAGE_SIZE));
  const membership=JSON.stringify([view.ownerId,filter,ordered.map(s=>key(s.identity))]);
  if(membership!==this.membership){this.membership=membership;this.page=Math.min(this.page,pages-1);this.deadline=now+10000;}
  else if(now>=this.deadline){const steps=Math.floor((now-this.deadline)/10000)+1;this.page=(this.page+steps)%pages;this.deadline+=steps*10000;}
  const unknownChildren=all.some(s=>s.parent.status==='unknown'||s.unavailable.some(u=>u.dimension==='parent'));
  return {version:1,ownerId:view.ownerId,revision:view.snapshot?.revision??null,asOfMs:view.snapshot?.asOfMs??null,connection:view.connection,collector:view.snapshot?.collector??'unknown',
   total:top.length,matched:ordered.length,attentionTotal:top.filter(s=>attention(s)!=='none').length,page:this.page,pages,
   rows:ordered.slice(this.page*PAGE_SIZE,this.page*PAGE_SIZE+PAGE_SIZE).map(s=>({identity:{...s.identity},label:s.label??s.title?.value??s.identity.sessionId,shortLabel:s.label===undefined&&s.title===undefined?shortSessionId(s.identity.sessionId):shortLabel((s.label??s.title?.value)!),...(s.title?{title:{...s.title}}:{}),...(s.project?{project:s.project}:{}),activity:s.activity,attention:attention(s),
    uncertain:view.connection!=='current'||s.freshness==='uncertain'||s.unavailable.some(warnsForUnavailable)||s.activity==='unknown'||s.parent.status==='unknown'||s.turn.status==='unknown',
    activeChildren:s.children.active,childrenUncertain:unknownChildren||s.children.uncertain>0||view.connection!=='current',noticeIds:notices(s,this.consumer),observedAtMs:s.observedAtMs,lastEvidenceAtMs:s.lastEvidenceAtMs,freshness:s.freshness,unavailable:structuredClone(s.unavailable)}))};
 }
}
