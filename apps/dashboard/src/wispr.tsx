import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {ApiError,type Api} from './client';
import {appNames,categoryNames,compatibleFilters,corpusNames,periodNames,identity,metrics,number,numericCsv,readWispr,type Corpus,type Numeric,type Selection,type Status,type WisprRead} from './wispr-data';
import type {LanguageTable,LanguageEntry} from '../../../packages/wispr-contracts/src/index';
const HOME:Selection={period:'7d',app:'all',category:'all'};
const reason=(code:string)=>({
 'text-not-shared':'Language collection or sharing is off.', 'not-enabled':'Language collection is off.', 'not-collected':'Language has not been collected.',
 'preset-expired':'This language period has expired. Collect again to refresh it.', 'language-algorithm-unsupported':'This language algorithm is not supported.', 'subgroup-unavailable':'Language is unavailable for this selection.',
 'snapshot-changed':'The source changed during this read. Waiting for a consistent snapshot.', 'wispr-unavailable':'The configured source is unavailable.', 'wispr-disabled':'Collection is disabled.',
 'source-schema':'The Wispr source schema is unsupported.', 'snapshot-unavailable':'The aggregate file is unavailable or invalid.', 'manifest-unavailable':'Collection status is unavailable or invalid.',
 'connection-unavailable':'The Hub could not be reached.', 'unsupported-snapshot':'This source format is unsupported.',
}[code]??'Source unavailable ('+code+').');
function useWispr(api:Api,sourceId:string,selection:Selection,language:boolean,onDenied:()=>void){
 const key=JSON.stringify([sourceId,selection,language]);
 const [state,setState]=useState<{api:Api;key:string;read?:WisprRead;error?:string}>({api,key});
 const denied=useRef(onDenied);denied.current=onDenied;
 useEffect(()=>{
  const stop=new AbortController();let busy=false,retired=false;
  const poll=async()=>{
   if(busy||retired||stop.signal.aborted)return;busy=true;
   try{
    const read=await readWispr(api,sourceId,selection,language,stop.signal,status=>{
     if(stop.signal.aborted)return;
     setState(old=>{
      if(old.key!==key||!old.read)return {api,key};
      if(identity(old.read.status)!==identity(status))return {api,key};
      return status.data.textAllowed&&!status.reason?old:{...old,read:{...old.read,status,language:{}}};
     });
    });
    if(!stop.signal.aborted)setState({api,key,read});
   }catch(e){
    if(stop.signal.aborted)return;
    if(e instanceof ApiError&&(e.status===401||e.status===403)){retired=true;stop.abort();setState({api,key});denied.current();return;}
    const error=e instanceof ApiError?e.code:'unavailable';
    setState(old=>({api,key,error,...(old.key===key&&old.read?{read:{...old.read,language:{}}}:{})}));
   }finally{busy=false;}
  };
  void poll();const timer=setInterval(()=>void poll(),5000);
  return()=>{stop.abort();clearInterval(timer);};
 },[api,key]);
 return state.key===key&&state.api===api?state:{api,key};
}
function Facts({values}:{values:[string,ReactNode][]}){return <dl className="facts">{values.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;}
function Table({caption,columns,rows}:{caption:string;columns:string[];rows:ReactNode[][]}){return <div className="wispr-table"><table><caption>{caption}</caption><thead><tr>{columns.map(c=><th scope="col" key={c}>{c}</th>)}</tr></thead><tbody>{rows.map((row,i)=><tr key={i}>{row.map((v,j)=><td key={j}>{v}</td>)}</tr>)}</tbody></table>{!rows.length&&<p className="hint">No entries for this selection.</p>}</div>;}
function Collection({status,now,error}:{status:Status;now:number;error?:string}){
 const age=status.lastSuccessAt?now-Date.parse(status.lastSuccessAt):null;
 return <p className={error||status.freshness==='stale'?'warning':'hint'}>{error?'Refresh failed. Last-good numeric data. ':status.freshness==='stale'?'Stale collection. ':''}Collected {age===null?'never':age<0?'at a time ahead of this clock':`${number(Math.floor(age/60000))} min ago`} · {status.timezone} · revision {status.revision}{status.reason?' · '+reason(status.reason):''}</p>;
}
/** Sparse dates form separate segments. The table gives every point to keyboard and touch users. */
function Trend({rows,compact=false,from,to}:{rows:{key:string;words:number;dictations:number}[];compact?:boolean;from?:string|null;to?:string|null}){
 const start=from?Date.parse(from):rows.length?Date.parse(rows[0].key):0,end=to?Date.parse(to):rows.length?Date.parse(rows.at(-1)!.key):0,max=Math.max(1,...rows.map(r=>r.words));
 const x=(d:string)=>12+(Date.parse(d)-start)/Math.max(86400000,end-start)*576,y=(n:number)=>90-n/max*78;
 const segments:string[]=[];let previous='';for(const row of rows){const point=`${x(row.key)},${y(row.words)}`;if(previous&&Date.parse(row.key)-Date.parse(previous)===86400000)segments[segments.length-1]+=' '+point;else segments.push(point);previous=row.key;}
 return <div className={compact?'wispr-trend compact':'wispr-trend'}><svg viewBox="0 0 600 104" role="img" aria-label="Captured daily word counts; missing dates are gaps"><title>Captured daily words</title>{segments.map((points,i)=><polyline key={i} points={points}/>)}{rows.map(r=><circle key={r.key} cx={x(r.key)} cy={y(r.words)} r="3"/>)}</svg><details><summary>{compact?'Seven-day values':'Daily values'} ({rows.length} captured dates)</summary><Table caption="Captured daily totals" columns={['Date','Words','Dictations']} rows={rows.map(r=>[r.key,number(r.words),number(r.dictations)])}/></details>{!compact&&<p className="hint">Gaps mean no captured observation. They do not prove zero use.</p>}</div>;
}
function LanguageRanks({table,useful}:{table:LanguageTable;useful:boolean}){
 const list=(caption:string,entries:LanguageEntry[],omitted:number)=><><Table caption={caption} columns={['Term','Occurrences','Dictations']} rows={entries.map(e=>[e.text,number(e.occurrences),number(e.dictations)])}/><p className="hint">{number(omitted)} additional qualifying entries omitted from the top 100.</p></>;
 return <><p className="hint">{!table.words.length&&!table.phrases.length?'Low sample: no terms meet the minimum support for this selection. ':''}English analysis · minimum 3 distinct dictations per term. {table.coverage.eligible} eligible; {table.coverage.missing} missing; {table.coverage.unsupportedLanguage} unsupported-language; {table.coverage.oversized} oversized; {table.coverage.uncertain} uncertain.</p><div className="cards two"><div>{list(useful?'Useful words':'All words',useful?table.usefulWords:table.words,useful?table.omitted.usefulWords:table.omitted.words)}</div><div>{list('Repeated phrases (2–5 words)',table.phrases,table.omitted.phrases)}</div></div></>;
}
function Changes({label,table,unavailable}:{label:string;table?:LanguageTable;unavailable?:string}){
 return <div className="card"><h3>{label}</h3>{table?<><Facts values={[
 ['Observed comparisons',`${number(table.comparedDictations)} / ${number(table.coverage.eligible)} eligible`],['Changed comparisons',`${number(table.changedDictations)} / ${number(table.comparedDictations)} (${table.comparedDictations?number(table.changedDictations*100/table.comparedDictations,1)+'%':'Unavailable'})`],['Token changes',`${number(table.insertions)} added · ${number(table.deletions)} removed · ${number(table.substitutions)} replaced`],['Excluded comparisons',`${number(table.coverage.missing)} missing · ${number(table.coverage.uncertain)} uncertain · ${number(table.coverage.oversized)} oversized`]]}/><p className="hint">Finality unknown. Observed text does not prove what was sent. Changes do not measure accuracy or speaking quality.</p><Table caption={label+' phrases'} columns={['Before','After','Occurrences','Dictations']} rows={table.changes.map(c=>[c.before||'(added)',c.after||'(removed)',number(c.occurrences),number(c.dictations)])}/><p className="hint">Minimum 3 distinct dictations · {number(table.omitted.changes)} additional qualifying pairs omitted · {number(table.coverage.longChanges)} long changes excluded.</p></>:<p className="hint">{reason(unavailable??'text-not-shared')}</p>}</div>;
}
function NumericFacts({data}:{data:Numeric['data']}){const t=data.totals,m=metrics(t);return <><Facts values={[
 ['Words',number(t.words)],['Dictations',number(t.dictations)],['Speaking minutes',number(m.speech,1)],['Recording minutes',number(m.recording,1)],['Weighted speech WPM',number(m.wpm,1)],['Average words / dictation',number(m.length,1)],['Average speech seconds / observed dictation',number(m.duration,1)],['Active captured days',number(data.activeDays)],
 ]}/><p className="hint">Speech coverage: {number(t.speechSamples)} / {number(t.dictations)} dictations ({number(t.speechWords)} words). Recording coverage: {number(t.recordingSamples)} / {number(t.dictations)}. WPM uses only words with speech duration.</p></>;}
function Coverage({read}:{read:WisprRead}){const s=read.status,c=s.coverage,d=read.dictionary;return <details className="card wispr-coverage"><summary>Data & coverage</summary><Facts values={[
 ['Snapshot',`Revision ${s.revision} · ${s.namespace} / ${s.generation}`],['Last successful collection',s.lastSuccessAt??'Never'],['Latest source activity date',s.latestSourceDate??'Unknown'],['Captured dates',`${c.captured.from??'Unknown'} – ${c.captured.to??'Unknown'}`],['Retained source dates',`${c.retained.from??'Unknown'} – ${c.retained.to??'Unknown'}`],['Current / archived rows',`${number(c.sourceRows)} / ${number(c.archivedRows)}`],['Skipped inputs',`${c.excluded.words} word counts · ${c.excluded.timestamp} timestamps · ${c.excluded.beforeCapture} before capture`],['Source statuses',Object.entries(c.statuses).map(([k,v])=>`${k}: ${v}`).join(' · ')],['Collection gaps',number(c.gaps.length)],['Schema / algorithms',`1.0 / numeric-1 · ${read.language.cleaned?.data.algorithmVersion??'language unavailable'} · ${read.language.cleaned?.data.stopwordVersion??'stopwords unavailable'}`],['Text sharing',s.data.textAllowed?'Allowed by collection and Hub opt-ins':'Off or unavailable'],['Retention','Captured analytics remain until explicit clear. Text opt-out clears text derivatives.'],
 ]}/>{read.numeric&&<p className="hint">Numeric input exclusions: {number(read.numeric.data.totals.invalidSpeech)} invalid / {number(read.numeric.data.totals.zeroSpeech)} zero speech durations; {number(read.numeric.data.totals.invalidRecording)} invalid / {number(read.numeric.data.totals.zeroRecording)} zero recording durations; {number(read.numeric.data.totals.invalidCorrections)} invalid correction counters; {number(read.numeric.data.totals.invalidReplacements)} invalid replacement counters.</p>}<Table caption="Recorded collection gaps" columns={['From','To','Reason']} rows={c.gaps.map(g=>[g.from,g.to,g.reason])}/><h3>Dictionary & snippets</h3><p className="hint">Unfiltered counter snapshots. Usage windows are unknown; these values are not attributed to the selected dates or added to dictated words.</p><Facts values={[
 ['Active entries',number(d?.activeEntries)],['Active snippets',number(d?.activeSnippets)],['Local usage',number(d?.localUsage)],['Remote usage',number(d?.remoteUsage)],['Counter segment',number(d?.segment)]
 ]}/></details>;}
export function WisprPage({api,sourceId,selection,onSelection,now,onDenied}:{api:Api;sourceId:string;selection:Selection;onSelection:(s:Selection)=>void;now:number;onDenied:()=>void}){
 const {read,error}=useWispr(api,sourceId,selection,true,onDenied);const [corpus,setCorpus]=useState<Corpus>('cleaned'),[useful,setUseful]=useState(true),[exportError,setExportError]=useState(''),[exporting,setExporting]=useState(false);
 const exportStop=useRef<AbortController|undefined>(undefined);
 useLayoutEffect(()=>{setExportError('');setExporting(false);return()=>exportStop.current?.abort();},[api,sourceId,selection]);
 const download=async(format:'json'|'csv')=>{
  if(exporting)return;setExporting(true);setExportError('');const stop=new AbortController();exportStop.current=stop;
  try{const fresh=await readWispr(api,sourceId,selection,false,stop.signal);if(!fresh.numeric)throw new ApiError('no-captured-data');if(stop.signal.aborted)return;
   const blob=new Blob([format==='json'?JSON.stringify(fresh.numeric,null,2):numericCsv(fresh.numeric)],{type:format==='json'?'application/json':'text/csv'});const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`wispr-${selection.period}.${format}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){if(!stop.signal.aborted){if(e instanceof ApiError&&(e.status===401||e.status===403))onDenied();else setExportError('Numeric export is unavailable. Try again after the source refreshes.');}}finally{if(!stop.signal.aborted)setExporting(false);}
 };
 const choose=(next:Selection)=>{if(compatibleFilters(next.app,next.category))onSelection(next);};
 const data=read?.numeric?.data,t=data?.totals,language=read?.language[corpus]?.data;
 return <section aria-label="Wispr analytics" className="wispr-page"><header className="page"><div><p className="eyebrow">PRIVATE / {sourceId}</p><h1>Wispr</h1><p className="muted">Your captured dictation, with its limits visible.</p></div><div className="wispr-downloads"><button className="secondary" disabled={!data||exporting} onClick={()=>void download('csv')}>Download numeric CSV</button><button className="secondary" disabled={!data||exporting} onClick={()=>void download('json')}>Download numeric JSON</button></div></header>
 <div className="wispr-filters"><label>Period<select aria-label="Period" value={selection.period} onChange={e=>onSelection({...selection,period:e.target.value as Selection['period']})}>{Object.entries(periodNames).map(([v,n])=><option key={v} value={v}>{n}</option>)}</select></label><label>App<select aria-label="App" aria-describedby="wispr-filter-help" value={selection.app} onChange={e=>choose({...selection,app:e.target.value as Selection['app']})}><option value="all">All apps</option>{Object.entries(appNames).map(([v,n])=><option key={v} value={v} disabled={!compatibleFilters(v as Selection['app'],selection.category)}>{n}</option>)}</select></label><label>Category<select aria-label="Category" aria-describedby="wispr-filter-help" value={selection.category} onChange={e=>choose({...selection,category:e.target.value as Selection['category']})}><option value="all">All categories</option>{Object.entries(categoryNames).map(([v,n])=><option key={v} value={v} disabled={!compatibleFilters(selection.app,v as Selection['category'])}>{n}</option>)}</select></label></div>
 <p id="wispr-filter-help" className="hint">Only matching app and category combinations support language aggregates. Choose All apps or All categories to change groups.</p>
 {exportError&&<p role="alert">{exportError}</p>}{error&&<p role="status" className="warning">{reason(error)} Language is hidden until a successful read.</p>}{!read&&!error&&<p role="status">Loading private aggregates…</p>}
 {read&&<><Collection status={read.status} now={now} error={error}/><p className="hint">Selected period: {read.selection.preset.from??'first capture'} – {read.selection.preset.to}. Numeric coverage: {read.selection.query===null?'no captured dates in this period':`${read.selection.from} – ${read.selection.to}`}.{read.selection.partial?' The available capture does not cover the whole preset.':''}{now>=Date.parse(read.selection.preset.validUntil)?' Period is from the last collection; collect again for current dates.':''}</p>
 <div className="card"><h2>Overview</h2>{data?<><NumericFacts data={data}/>{t?.dictations===0&&<p className="hint">No captured dictations match this selection.</p>}<Trend rows={data.daily} from={read.selection.preset.from??read.selection.from} to={read.selection.preset.to}/></>:<p className="hint">{read.status.data.availability==='cleared'?'Analytics have been cleared.':read.status.data.availability==='empty'?'The source has no eligible captured dictations.':'No captured numeric data for this period.'}</p>}</div>
 {data&&<div className="cards two"><div className="card"><h2>Apps</h2><Table caption="Captured usage by app" columns={['App','Words','Dictations','Speech min']} rows={[...data.apps].sort((a,b)=>b.words-a.words||a.key.localeCompare(b.key)).map(r=>[appNames[r.key as keyof typeof appNames]??'Unknown',number(r.words),number(r.dictations),number(metrics(r).speech,1)])}/></div><div className="card"><h2>Categories</h2><Table caption="Captured usage by category" columns={['Category','Words','Dictations','Speech min']} rows={[...data.categories].sort((a,b)=>b.words-a.words||a.key.localeCompare(b.key)).map(r=>[categoryNames[r.key as keyof typeof categoryNames]??'Unknown',number(r.words),number(r.dictations),number(metrics(r).speech,1)])}/></div></div>}
 <div className="card"><h2>Words & phrases</h2><div className="wispr-filters"><label>Text stage<select aria-label="Text stage" value={corpus} onChange={e=>setCorpus(e.target.value as Corpus)}>{Object.entries(corpusNames).map(([v,n])=><option key={v} value={v}>{n}</option>)}</select></label><label>Word list<select aria-label="Word list" value={useful?'useful':'all'} onChange={e=>setUseful(e.target.value==='useful')}><option value="useful">Useful words</option><option value="all">All words</option></select></label></div><p className="hint">Recognized speech is an ASR result, not verified verbatim speech.</p>{language?.availability==='available'&&language.table?<LanguageRanks table={language.table} useful={useful}/>:<p className="hint">{error?'Language hidden until a successful read.':reason(language?.reason??read.status.reason??'text-not-shared')}</p>}</div>
 <h2>Changes</h2><div className="cards two"><Changes label="Flow cleanup" table={read.language.cleaned?.data.table} unavailable={read.language.cleaned?.data.reason}/><Changes label="Observed edits" table={read.language.observed?.data.table} unavailable={read.language.observed?.data.reason}/></div>
 {t&&<div className="card"><h3>Wispr's stored counters</h3><Facts values={[
 ['Words corrected',t.correctionSamples?`${number(t.wordsCorrected)} (${number(t.correctionSamples)} / ${number(t.dictations)} dictations reported)`:'Unavailable'],['Dictionary replacements',t.replacementSamples?`${number(t.dictionaryReplacements)} (${number(t.replacementSamples)} / ${number(t.dictations)} dictations reported)`:'Unavailable']
 ]}/><p className="hint">Source counters are separate from the derived text-change rates above.</p></div>}<Coverage read={read}/></>}
 </section>;
}
export function WisprWidget({api,sourceId,now,onDenied}:{api:Api;sourceId:string;now:number;onDenied:()=>void}){
 const {read,error}=useWispr(api,sourceId,HOME,false,onDenied);const today=read?.status.data.presets.find(p=>p.key==='today');const row=read?.numeric?.data.daily.find(r=>r.key===today?.to);const current=!!today&&now>=Date.parse(today.asOf)&&now<Date.parse(today.validUntil);
 return <article className="widget" data-widget="wispr-summary" data-size="small"><header className="widget-head"><h2>Wispr today</h2><a href={'#/wispr/'+encodeURIComponent(sourceId)}>Open Wispr</a></header>{read?<><Facts values={[
 ['Words',current&&row?number(row.words):'Not observed'],['Speaking minutes',current&&row?number(metrics(row).speech,1):'Unavailable']
 ]}/><Collection status={read.status} now={now} error={error}/>{!current&&<p className="hint">Today's totals need a current collection.</p>}<Trend rows={read.numeric?.data.daily??[]} from={read.selection.preset.from} to={read.selection.preset.to} compact/></>:<p className="hint">{error?reason(error):'Loading captured usage…'}</p>}</article>;
}
