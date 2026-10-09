// Adapted from apps/dashboard/src/wispr-data.ts at fd0bec36 (Hub #927).
import type {FrontendApi} from '@jimmie-potts/sdk/frontend';
export class WisprReadError extends Error {
 readonly code: string;
 constructor(code: string) { super(code); this.code=code; }
}
import type {Snapshot,LanguageTable,Preset,PresetWindow,App,Category,Totals} from '@jimmie-potts/wispr-contracts';
import type {numericReport} from '@jimmie-potts/wispr-contracts';
export type Selection={period:Preset;app:App|'all';category:Category|'all'};
export type Envelope<T>={schema:'wispr-analytics/2.0';sourceId:string;namespace:string;generation:string;revision:number;timezone:string;generatedAt:string;lastSuccessAt:string|null;latestSourceDate:string|null;freshness:'fresh'|'stale';ageMs:number|null;reason:string|null;coverage:Snapshot['coverage'];data:T};
export type Status=Envelope<{availability:Snapshot['health'];textAllowed:boolean;presets:PresetWindow[]}>;
export type Numeric=Envelope<ReturnType<typeof numericReport>&{dictionary:Snapshot['dictionary']&{filtered:false}}>;
export type Language=Envelope<{availability:'available'|'disabled'|'unavailable';reason?:string;algorithmVersion?:string;stopwordVersion?:string;preset:PresetWindow;table?:LanguageTable}>;
export type Corpus='raw'|'cleaned'|'observed';
export type WisprRead={status:Status;numeric?:Numeric|undefined;dictionary?:Numeric['data']['dictionary']|undefined;language:Partial<Record<Corpus,Language>>;selection:ReturnType<typeof numericSelection>};
export const initialSelection:Selection={period:'7d',app:'all',category:'all'};
/** Only filter choices survive page unmounts within this browser session; no analytics are retained here. */
export function rememberSelection(selection:Selection):void { Object.assign(initialSelection,selection); }
export const appNames:Record<App,string>={chatgpt:'ChatGPT',claude:'Claude',outlook:'Outlook',gmail:'Gmail',slack:'Slack',teams:'Teams',discord:'Discord',word:'Word',notion:'Notion','google-docs':'Google Docs',other:'Unknown / other'};
export const categoryNames:Record<Category,string>={'ai-prompts':'AI prompts',email:'Email',messaging:'Messaging',documents:'Documents','other-unknown':'Other / unknown'};
// categoryVersion 1; kept browser-only so the AJV contract validator is not bundled.
const appCategories:Record<App,Category>={chatgpt:'ai-prompts',claude:'ai-prompts',outlook:'email',gmail:'email',slack:'messaging',teams:'messaging',discord:'messaging',word:'documents',notion:'documents','google-docs':'documents',other:'other-unknown'};
export const compatibleFilters=(app:Selection['app'],category:Selection['category'])=>app==='all'||category==='all'||appCategories[app]===category;
export const periodNames:Record<Preset,string>={today:'Today','7d':'7 days','30d':'30 days',all:'All captured'};
export const corpusNames:Record<Corpus,string>={raw:'Recognized speech',cleaned:'Flow output',observed:'Observed text'};
export const identity=(v:Envelope<unknown>)=>JSON.stringify([v.sourceId,v.namespace,v.generation,v.revision]);
export function numericSelection(status:Status,selection:Selection){
 const preset=status.data.presets.find(p=>p.key===selection.period);
 if(preset&&(typeof preset.to!=='string'||(preset.from!==null&&typeof preset.from!=='string')||!Number.isFinite(Date.parse(preset.asOf))||!Number.isFinite(Date.parse(preset.validUntil))))throw new WisprReadError('unsupported-preset');
 if(!preset)throw new WisprReadError('unsupported-preset');
 const bounds=status.coverage.captured;
 const from=bounds.from===null?null:preset.from===null?bounds.from:preset.from>bounds.from?preset.from:bounds.from;
 const to=bounds.to===null?null:preset.to<bounds.to?preset.to:bounds.to;
 const query=new URLSearchParams();
 if(from!==null&&to!==null&&from<=to){query.set('from',from);query.set('to',to);if(selection.app!=='all')query.set('app',selection.app);if(selection.category!=='all')query.set('category',selection.category);}
 return {preset,from,to,partial:(preset.from!==null&&from!==preset.from)||to!==preset.to,query:from!==null&&to!==null&&from<=to?query.toString():null};
}
function check<T>(input: unknown,sourceId:string|undefined):Envelope<T>{
 if(typeof input!=='object'||input===null||Array.isArray(input))throw new WisprReadError('unsupported-snapshot');
 const value=input as Envelope<T>;
 if(value.schema!=='wispr-analytics/2.0'||typeof value.sourceId!=='string'||value.sourceId===''||(sourceId!==undefined&&value.sourceId!==sourceId)||typeof value.namespace!=='string'||value.namespace===''||typeof value.generation!=='string'||value.generation===''||!Number.isSafeInteger(value.revision)||typeof value.coverage?.captured!=='object'||value.coverage.captured===null||typeof value.data!=='object'||value.data===null)throw new WisprReadError('unsupported-snapshot');
 return value;
}
/** All reads are one selected snapshot. The final status retires text even when opt-out did not increment its revision. */
export async function readWispr(api:Pick<FrontendApi,'read'>,sourceId:string|undefined,selection:Selection,withLanguage:boolean,signal:AbortSignal,onStatus?:(status:Status)=>void):Promise<WisprRead>{
 const active=()=>{if(signal.aborted)throw new WisprReadError('request-cancelled');};active();
 const status=check(await api.read('/modules/wispr/content/status'),sourceId) as Status;active();
 if(!Array.isArray(status.data.presets)||typeof status.data.textAllowed!=='boolean')throw new WisprReadError('unsupported-snapshot');
 const configuredSource=status.sourceId;onStatus?.(status);
 const selected=numericSelection(status,selection),language:Partial<Record<Corpus,Language>>={};
 const numeric=selected.query===null?undefined:check(await api.read('/modules/wispr/content/export?format=json&'+selected.query),configuredSource) as Numeric|undefined;
 if(numeric&&identity(numeric)!==identity(status))throw new WisprReadError('snapshot-changed');active();
 let dictionary=numeric?.data.dictionary;
 if(!numeric){const summary=check<{dictionary:Numeric['data']['dictionary']}>(await api.read('/modules/wispr/content/summary'),configuredSource);active();if(identity(summary)!==identity(status))throw new WisprReadError('snapshot-changed');dictionary=summary.data.dictionary;}
 if(withLanguage&&status.data.textAllowed){
  await Promise.all((['raw','cleaned','observed'] as Corpus[]).map(async corpus=>{
   const query=new URLSearchParams({period:selection.period,corpus});if(selection.app!=='all')query.set('app',selection.app);if(selection.category!=='all')query.set('category',selection.category);
   const result=check(await api.read('/modules/wispr/content/language?'+query.toString()),configuredSource) as Language;
   active();if(identity(result)!==identity(status))throw new WisprReadError('snapshot-changed');language[corpus]=result;
  }));
 }
 const latest=check(await api.read('/modules/wispr/content/status'),configuredSource) as Status;active();
 if(!Array.isArray(latest.data.presets)||typeof latest.data.textAllowed!=='boolean')throw new WisprReadError('unsupported-snapshot');onStatus?.(latest);
 if(identity(latest)!==identity(status))throw new WisprReadError('snapshot-changed');
 const {data:statusData,...envelope}=latest;
 return {status:latest,numeric:numeric?{...numeric,...envelope}:undefined,dictionary,selection:selected,language:statusData.textAllowed&&latest.reason===null?language:{}};
}
export function numericCsv(value:unknown):string{
 const lines=['"field","value"'];const quote=(s:string)=>'"'+(/^[\s]*[=+\-@\t\r]/.test(s)?"'":'')+s.replaceAll('"','""')+'"';
 const walk=(v:unknown,path:string)=>{if(v!==null&&typeof v==='object')for(const [k,child] of Object.entries(v))walk(child,path!==''?path+'.'+k:k);else lines.push(quote(path)+','+quote(typeof v==='string'||typeof v==='number'||typeof v==='boolean'?String(v):''));};walk(value,'');return lines.join('\r\n')+'\r\n';
}
export const number=(n:number|null|undefined,digits=0)=>n===null||n===undefined||!Number.isFinite(n)?'Unavailable':n.toLocaleString(undefined,{maximumFractionDigits:digits});
export function metrics(t:Totals){return {speech:t.speechSamples>0?t.speechSeconds/60:null,recording:t.recordingSamples>0?t.recordingSeconds/60:null,wpm:t.speechSeconds>0?t.speechWords*60/t.speechSeconds:null,length:t.dictations>0?t.words/t.dictations:null,duration:t.speechSamples>0?t.speechSeconds/t.speechSamples:null};}

/** Registry codes stay visible; no transport exception text is rendered. */
export function errorCode(error: unknown): string {
 if(error instanceof WisprReadError)return error.code;
 if(typeof error==='object'&&error!==null&&'body' in error){
  const body=error.body;
  if(typeof body==='object'&&body!==null&&'error' in body){
   const refusal=body.error;
   if(typeof refusal==='object'&&refusal!==null&&'code' in refusal&&typeof refusal.code==='string')return refusal.code;
  }
 }
 return 'unavailable';
}
