// Copied from apps/hub/src/wispr-query.ts at bf11587c1a2c575c0da155725a386a209836eed9 (Hub #927); adapted for module lifetime.
import {APPS,CATEGORIES,TOTAL_KEYS,emptyTotals,numericReport,validDate,type App,type Category,type NumericFilter,type Snapshot,type Totals} from '@jimmie-potts/wispr-contracts';
import {readerRefusal} from './content.js';
import {WisprError} from './common.js';
import type {WisprConfig} from './configuration.js';
import type {WisprResponse} from './wispr.js';
const numericKeys=['from','to','app','category'];
const languageKeys=['period','app','category','corpus'];
const fail=(code='unsupported-filter',status=400):never=>{throw new WisprError(code,status);};
export function wisprResponse(status:number,value:unknown):WisprResponse {
  const body=JSON.stringify(value);
  return Buffer.byteLength(body)>1048576?{status:413,body:JSON.stringify(readerRefusal('wispr-response-capacity'))}:{status,body};
}
function selection(snapshot:Snapshot,p:URLSearchParams):NumericFilter {
  const from=p.get('from')??undefined,to=p.get('to')??undefined,app=p.get('app')??undefined,category=p.get('category')??undefined;
  if((app!==undefined&&!APPS.includes(app as App))||(category!==undefined&&!CATEGORIES.includes(category as Category))||(from!==undefined&&!validDate(from))||(to!==undefined&&!validDate(to))||(from!==undefined&&to!==undefined&&from>to))fail();
  const bounds=snapshot.coverage.captured;
  if([from,to].some(date=>date!==undefined&&(bounds.from===null||bounds.to===null||date<bounds.from||date>bounds.to)))fail('range-outside-coverage');
  return {...(from!==undefined?{from}:{}),...(to!==undefined?{to}:{}),...(app!==undefined?{app:app as App}:{}),...(category!==undefined?{category:category as Category}:{})};
}
function language(snapshot:Snapshot,p:URLSearchParams,now:number,allowed:boolean){
  const period=p.get('period')??'today',corpus=p.get('corpus')??'cleaned',app=p.get('app')??'all',category=p.get('category')??'all';
  if(!['today','7d','30d','all'].includes(period)||!['raw','cleaned','observed'].includes(corpus)||(app!=='all'&&!APPS.includes(app as App))||(category!=='all'&&!CATEGORIES.includes(category as Category)))fail();
  const preset=snapshot.presets.find(x=>x.key===period);
  if(preset===undefined)return fail();
  if(!allowed)return {availability:'disabled',reason:'text-not-shared',preset};
  if(now>=Date.parse(preset.validUntil)||now<Date.parse(preset.asOf))return {availability:'unavailable',reason:'preset-expired',preset};
  if(snapshot.language.availability!=='available')return {availability:'unavailable',reason:snapshot.language.reason,preset};
  if(snapshot.language.algorithmVersion!=='english-1'||snapshot.language.stopwordVersion!=='english-stop-1')return {availability:'unavailable',reason:'language-algorithm-unsupported',preset};
  const tables=snapshot.language.tables.filter(t=>t.preset===period&&t.app===app&&t.category===category&&t.corpus===(corpus==='cleaned'?'formatted':corpus));
  if(tables.length!==1)return {availability:'unavailable',reason:'subgroup-unavailable',preset};
  return {availability:'available',algorithmVersion:snapshot.language.algorithmVersion,stopwordVersion:snapshot.language.stopwordVersion,preset,table:tables[0]};
}
function rows<T>(value:T[]):T[]{if(value.length>10000)fail('wispr-row-capacity',413);return value;}
function csv(value:unknown):string {
  const lines=['"field","value"'];
  const quote=(value:string)=>'"'+(/^[\s]*[=+\-@\t\r]/.test(value)?"'":'')+value.replaceAll('"','""')+'"';
  const walk=(v:unknown,path:string)=>{
    if(v!==null&&typeof v==='object')for(const [key,child] of Object.entries(v))walk(child,path!==''?path+'.'+key:key);
    else lines.push(quote(path)+','+quote(v===null?'':typeof v==='string'||typeof v==='number'||typeof v==='boolean'?String(v):''));
  };
  walk(value,'');return lines.join('\r\n')+'\r\n';
}
export function projectWispr(snapshot:Snapshot,config:WisprConfig,route:string,query:string,now:number,problem:string|null,textAllowed:boolean):WisprResponse {
  if(!['status','summary','series','heatmap','apps','language','export'].includes(route))fail('not-found',404);
  const p=new URLSearchParams(query);
  const allowed=route==='status'?[]:route==='language'?languageKeys:route==='series'?[...numericKeys,'bucket']:route==='export'?[...numericKeys,'format','includeText','period','corpus']:numericKeys;
  if([...p.keys()].some(k=>!allowed.includes(k)||p.getAll(k).length!==1))fail();
  const includeText=p.get('includeText')==='true';
  if(route==='export'&&((p.has('includeText')&&!['true','false'].includes(p.get('includeText')??''))||!['csv','json'].includes(p.get('format')??'json')||(!includeText&&(p.has('period')||p.has('corpus')))||(includeText&&(p.has('from')||p.has('to')))))fail();
  if(includeText&&!textAllowed)fail('text-not-shared',403);
  const filter=selection(snapshot,p);
  let selectedLanguage:ReturnType<typeof language>|undefined;
  if(route==='language'||includeText){
    selectedLanguage=language(snapshot,p,now,textAllowed);
    if(includeText){
      const preset=selectedLanguage.preset;
      const from=preset.from??snapshot.coverage.captured.from; if(from!==null)filter.from=from;filter.to=preset.to;
    }
  }
  const ageMs=snapshot.lastSuccessAt===null?null:now-Date.parse(snapshot.lastSuccessAt);
  const freshness=problem!==null||ageMs===null||ageMs<0||ageMs>config.freshnessMs?'stale':'fresh';
  const envelope={apiVersion:'1.0',sourceId:config.sourceId,namespace:snapshot.namespace,generation:snapshot.generation,revision:snapshot.revision,timezone:snapshot.timezone,generatedAt:snapshot.generatedAt,lastSuccessAt:snapshot.lastSuccessAt,latestSourceDate:snapshot.latestSourceDate,freshness,ageMs:ageMs===null?null:Math.max(0,ageMs),reason:problem,coverage:snapshot.coverage};
  if(route==='status')return wisprResponse(200,{...envelope,data:{availability:snapshot.health,textAllowed,presets:snapshot.presets,bounds:{inputBytes:16777216,responseBytes:1048576,numericRows:10000}}});
  if(route==='language')return wisprResponse(200,{...envelope,data:selectedLanguage});
  const report=numericReport(snapshot,filter);
  let data:unknown;
  if(route==='summary')data={totals:report.totals,speechWordsPerMinute:report.speechWordsPerMinute,recordingWordsPerMinute:report.recordingWordsPerMinute,activeDays:report.activeDays,longestObservedRun:report.longestObservedRun,latestObservedRun:report.latestObservedRun,dictionary:{...snapshot.dictionary,filtered:false}};
  else if(route==='series'){
    const bucket=p.get('bucket')??'day';if(!['day','week','month'].includes(bucket))fail();
    data={bucket,rows:rows(bucket==='day'?report.daily:bucket==='week'?report.weekly:report.monthly)};
  }else if(route==='apps')data={rows:rows(report.apps),categories:report.categories};
  else if(route==='heatmap'){
    const groups=new Map<string,Totals>();
    for(const c of snapshot.numeric.cells){
      if((filter.from!==undefined&&c.date<filter.from)||(filter.to!==undefined&&c.date>filter.to)||(filter.app!==undefined&&c.app!==filter.app)||(filter.category!==undefined&&c.category!==filter.category))continue;
      const key=c.weekday+':'+c.hour,total=groups.get(key)??emptyTotals();for(const k of TOTAL_KEYS)total[k]+=c[k];groups.set(key,total);
    }
    data={rows:rows([...groups].sort(([a],[b])=>a.localeCompare(b)).map(([key,total])=>({weekday:Number(key.split(':')[0]),hour:Number(key.split(':')[1]),...total})))};
  }else data={...report,daily:rows(report.daily),dictionary:{...snapshot.dictionary,filtered:false},...(includeText?{language:selectedLanguage}:{})};
  const value={...envelope,filters:filter,data};
  if(route==='export'&&p.get('format')==='csv'){
    const body=csv(value);if(Buffer.byteLength(body)>1048576)fail('wispr-response-capacity',413);return {status:200,body,csv:true};
  }
  return wisprResponse(200,value);
}
