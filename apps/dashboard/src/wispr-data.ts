import {ApiError,type Api} from './client';
import type {Snapshot,LanguageTable,Preset,PresetWindow,App,Category,Totals} from '../../../packages/wispr-contracts/src/index';
import type {numericReport} from '../../../packages/wispr-contracts/src/query';
export type Selection={period:Preset;app:App|'all';category:Category|'all'};
export type Envelope<T>={apiVersion:'1.0';sourceId:string;namespace:string;generation:string;revision:number;timezone:string;generatedAt:string;lastSuccessAt:string|null;latestSourceDate:string|null;freshness:'fresh'|'stale';ageMs:number|null;reason:string|null;coverage:Snapshot['coverage'];data:T};
export type Status=Envelope<{availability:Snapshot['health'];textAllowed:boolean;presets:PresetWindow[]}>;
export type Numeric=Envelope<ReturnType<typeof numericReport>&{dictionary:Snapshot['dictionary']&{filtered:false}}>;
export type Language=Envelope<{availability:'available'|'disabled'|'unavailable';reason?:string;algorithmVersion?:string;stopwordVersion?:string;preset:PresetWindow;table?:LanguageTable}>;
export type Corpus='raw'|'cleaned'|'observed';
export type WisprRead={status:Status;numeric?:Numeric;dictionary?:Numeric['data']['dictionary'];language:Partial<Record<Corpus,Language>>;selection:ReturnType<typeof numericSelection>};
export const initialSelection:Selection={period:'7d',app:'all',category:'all'};
export const appNames:Record<App,string>={chatgpt:'ChatGPT',claude:'Claude',outlook:'Outlook',gmail:'Gmail',slack:'Slack',teams:'Teams',discord:'Discord',word:'Word',notion:'Notion','google-docs':'Google Docs',other:'Unknown / other'};
export const categoryNames:Record<Category,string>={'ai-prompts':'AI prompts',email:'Email',messaging:'Messaging',documents:'Documents','other-unknown':'Other / unknown'};
export const periodNames:Record<Preset,string>={today:'Today','7d':'7 days','30d':'30 days',all:'All captured'};
export const corpusNames:Record<Corpus,string>={raw:'Recognized speech',cleaned:'Flow output',observed:'Observed text'};
export const identity=(v:Envelope<unknown>)=>JSON.stringify([v.sourceId,v.namespace,v.generation,v.revision]);
export function numericSelection(status:Status,selection:Selection){
 const preset=status.data.presets.find(p=>p.key===selection.period);
 if(!preset)throw new ApiError('unsupported-preset');
 const bounds=status.coverage.captured;
 const from=bounds.from===null?null:preset.from===null?bounds.from:preset.from>bounds.from?preset.from:bounds.from;
 const to=bounds.to===null?null:preset.to<bounds.to?preset.to:bounds.to;
 const query=new URLSearchParams();
 if(from&&to&&from<=to){query.set('from',from);query.set('to',to);if(selection.app!=='all')query.set('app',selection.app);if(selection.category!=='all')query.set('category',selection.category);}
 return {preset,from,to,partial:(preset.from!==null&&from!==preset.from)||to!==preset.to,query:from&&to&&from<=to?query.toString():null};
}
function check<T>(value:Envelope<T>,sourceId:string):Envelope<T>{
 if(!value||value.apiVersion!=='1.0'||value.sourceId!==sourceId||!value.namespace||!value.generation||!Number.isSafeInteger(value.revision)||!value.coverage||!value.data)throw new ApiError('unsupported-snapshot');
 return value;
}
/** All reads are one selected snapshot. The final status retires text even when opt-out did not increment its revision. */
export async function readWispr(api:Pick<Api,'request'>,sourceId:string,selection:Selection,withLanguage:boolean,signal:AbortSignal,onStatus?:(status:Status)=>void):Promise<WisprRead>{
 const active=()=>{if(signal.aborted)throw new ApiError('request-cancelled');};active();
 const status=check(await api.request<Status>('/api/wispr/v1/status',undefined,signal),sourceId) as Status;active();onStatus?.(status);
 const selected=numericSelection(status,selection),language:Partial<Record<Corpus,Language>>={};
 const numeric=selected.query===null?undefined:check(await api.request<Numeric>('/api/wispr/v1/export?format=json&'+selected.query,undefined,signal),sourceId) as Numeric|undefined;
 if(numeric&&identity(numeric)!==identity(status))throw new ApiError('snapshot-changed');active();
 let dictionary=numeric?.data.dictionary;
 if(!numeric){const summary=check(await api.request<Envelope<{dictionary:Numeric['data']['dictionary']}>>('/api/wispr/v1/summary',undefined,signal),sourceId);active();if(identity(summary)!==identity(status))throw new ApiError('snapshot-changed');dictionary=summary.data.dictionary;}
 if(withLanguage&&status.data.textAllowed){
  await Promise.all((['raw','cleaned','observed'] as Corpus[]).map(async corpus=>{
   const query=new URLSearchParams({period:selection.period,corpus});if(selection.app!=='all')query.set('app',selection.app);if(selection.category!=='all')query.set('category',selection.category);
   const result=check(await api.request<Language>('/api/wispr/v1/language?'+query,undefined,signal),sourceId) as Language;
   active();if(identity(result)!==identity(status))throw new ApiError('snapshot-changed');language[corpus]=result;
  }));
 }
 const latest=check(await api.request<Status>('/api/wispr/v1/status',undefined,signal),sourceId) as Status;active();onStatus?.(latest);
 if(identity(latest)!==identity(status))throw new ApiError('snapshot-changed');
 const {data:statusData,...envelope}=latest;
 return {status:latest,numeric:numeric?{...numeric,...envelope}:undefined,dictionary,selection:selected,language:statusData.textAllowed&&!latest.reason?language:{}};
}
export function numericCsv(value:unknown):string{
 const lines=['"field","value"'];const quote=(s:string)=>'"'+(/^[\s]*[=+\-@\t\r]/.test(s)?"'":'')+s.replaceAll('"','""')+'"';
 const walk=(v:unknown,path:string)=>{if(v!==null&&typeof v==='object')for(const [k,child] of Object.entries(v))walk(child,path?path+'.'+k:k);else lines.push(quote(path)+','+quote(v===null?'':String(v)));};walk(value,'');return lines.join('\r\n')+'\r\n';
}
export const number=(n:number|null|undefined,digits=0)=>n===null||n===undefined||!Number.isFinite(n)?'Unavailable':n.toLocaleString(undefined,{maximumFractionDigits:digits});
export function metrics(t:Totals){return {speech:t.speechSamples?t.speechSeconds/60:null,recording:t.recordingSamples?t.recordingSeconds/60:null,wpm:t.speechSeconds>0?t.speechWords*60/t.speechSeconds:null,length:t.dictations?t.words/t.dictations:null,duration:t.speechSamples?t.speechSeconds/t.speechSamples:null};}
