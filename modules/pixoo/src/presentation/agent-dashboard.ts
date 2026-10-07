import type {Identity} from '@jimmie-potts/event-contracts/v2/families';
import type {MonitorFilter} from '../core/index.js';
import type {Collector, MonitorSession, MonitorView} from './sources.js';

export type DashboardFilter = MonitorFilter;
export type DashboardRow = {
 identity:Identity; label:string; shortLabel:string; title?:MonitorSession['title']; project?:string; activity:MonitorSession['activity'];
 attention:'approval'|'input'|'question'|'none'; uncertain:boolean;
 activeChildren:number; childrenUncertain:boolean; noticeIds:string[];
 observedAtMs:number; lastEvidenceAtMs:number; freshness:MonitorSession['freshness']; unavailable:MonitorSession['unavailable'];
};
export type DashboardLayout = {
 version:1; revision:number|null;
 connection:MonitorView['connection']; collector:Collector|'unknown';
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
function attention(session:MonitorSession):DashboardRow['attention'] {
 for(const kind of ['approval','input','question'] as const)if(session.attention.some(item=>item.kind===kind))return kind;
 return 'none';
}
function notices(session:MonitorSession,consumer:string):string[]{return session.notices.filter(n=>!n.acknowledgedBy.includes(consumer)).map(n=>n.id);}
function rank(session:MonitorSession,consumer:string):number {
 const kind=attention(session);return kind==='approval'||kind==='input'?0:kind==='question'?1:notices(session,consumer).length>0?2:3;
}
/** Routine ordering/read limits stay in metadata without dimming an otherwise known session. */
function warnsForUnavailable(evidence:MonitorSession['unavailable'][number]):boolean {
 return !((evidence.dimension==='ordering'||evidence.dimension==='read')&&
  (evidence.reason==='missing'||evidence.reason==='unsupported'||evidence.reason==='inaccessible'));
}
/** Whether a session passes the filter: each criterion that is set must match. An empty search text matches everything. */
function matches(session:MonitorSession,filter:DashboardFilter):boolean {
 const {projectId,provider,q}=filter;
 if(projectId!==undefined&&projectId!==''&&session.projectId!==projectId)return false;
 if(filter.session!==undefined&&key(session.identity)!==key(filter.session))return false;
 if(provider!==undefined&&session.identity.provider!==provider)return false;
 if(q===undefined||q==='')return true;
 const needle=q.toLowerCase();
 return [session.label,session.title?.value,session.project,session.identity.sessionId].some(value=>value?.toLowerCase().includes(needle)===true);
}
/** The row's label: the label, then the title, then the session ID; and its short form, with distinct ID tails when unnamed. */
function labels(session:MonitorSession):{label:string;shortLabel:string} {
 const named=session.label??session.title?.value;
 return named===undefined?{label:session.identity.sessionId,shortLabel:shortSessionId(session.identity.sessionId)}:{label:named,shortLabel:shortLabel(named)};
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
  const ordered=top.filter(s=>matches(s,filter)).sort((a,b)=>{const ranked=rank(a,this.consumer)-rank(b,this.consumer);return ranked!==0?ranked:compare(key(a.identity),key(b.identity));});
  const pages=Math.max(1,Math.ceil(ordered.length/PAGE_SIZE));
  const membership=JSON.stringify([filter,ordered.map(s=>key(s.identity))]);
  if(membership!==this.membership){this.membership=membership;this.page=Math.min(this.page,pages-1);this.deadline=now+10000;}
  else if(now>=this.deadline){const steps=Math.floor((now-this.deadline)/10000)+1;this.page=(this.page+steps)%pages;this.deadline+=steps*10000;}
  const unknownChildren=all.some(s=>s.parent.status==='unknown'||s.unavailable.some(u=>u.dimension==='parent'));
  return {version:1,revision:view.snapshot?.revision??null,connection:view.connection,collector:view.snapshot?.collector??'unknown',
   total:top.length,matched:ordered.length,attentionTotal:top.filter(s=>attention(s)!=='none').length,page:this.page,pages,
   rows:ordered.slice(this.page*PAGE_SIZE,this.page*PAGE_SIZE+PAGE_SIZE).map(s=>({identity:{...s.identity},...labels(s),...(s.title===undefined?{}:{title:{...s.title}}),...(s.project===undefined||s.project===''?{}:{project:s.project}),activity:s.activity,attention:attention(s),
    uncertain:view.connection!=='current'||s.freshness==='uncertain'||s.unavailable.some(warnsForUnavailable)||s.activity==='unknown'||s.parent.status==='unknown'||s.turn.status==='unknown',
    activeChildren:s.children.active,childrenUncertain:unknownChildren||s.children.uncertain>0||view.connection!=='current',noticeIds:notices(s,this.consumer),observedAtMs:s.observedAtMs,lastEvidenceAtMs:s.lastEvidenceAtMs,freshness:s.freshness,unavailable:structuredClone(s.unavailable)}))};
 }
}
