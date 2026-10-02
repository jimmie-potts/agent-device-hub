import { APPS, CATEGORIES, TOTAL_KEYS, emptyTotals, offsetDate, validDate, type Snapshot, type NumericCell, type Totals, type App, type Category } from './index.js';

export type NumericFilter = { from?: string; to?: string; app?: App; category?: Category };
export function numericReport(snapshot: Snapshot, filter: NumericFilter) {
  if (Object.keys(filter).some(k=>!['from','to','app','category'].includes(k)) ||
      (filter.from!==undefined&&!validDate(filter.from)) || (filter.to!==undefined&&!validDate(filter.to)) ||
      (filter.from!==undefined&&filter.to!==undefined&&filter.from>filter.to) ||
      (filter.app!==undefined&&!APPS.includes(filter.app)) || (filter.category!==undefined&&!CATEGORIES.includes(filter.category))) throw new Error('unsupported-filter');
  const cells=snapshot.numeric.cells.filter(c=>(!filter.from||c.date>=filter.from)&&(!filter.to||c.date<=filter.to)&&(!filter.app||c.app===filter.app)&&(!filter.category||c.category===filter.category));
  const totals=emptyTotals();
  for(const cell of cells)for(const key of TOTAL_KEYS)totals[key]+=cell[key];
  const group=(key:(c:NumericCell)=>string)=>{
    const groups=new Map<string,Totals>();
    for(const cell of cells){const id=key(cell);const value=groups.get(id)??emptyTotals();for(const k of TOTAL_KEYS)value[k]+=cell[k];groups.set(id,value);}
    return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>({key,...value}));
  };
  const daily=group(c=>c.date);
  const active=daily.filter(d=>d.dictations>0).map(d=>d.key);
  let longest=0,run=0,previous:string|undefined;
  for(const date of active){run=previous&&offsetDate(previous,1)===date?run+1:1;longest=Math.max(longest,run);previous=date;}
  return {
    totals,
    speechWordsPerMinute:totals.speechSeconds>0?totals.speechWords*60/totals.speechSeconds:null,
    recordingWordsPerMinute:totals.recordingSeconds>0?totals.recordingWords*60/totals.recordingSeconds:null,
    activeDays:active.length,longestObservedRun:longest,latestObservedRun:run,
    daily,weekly:group(c=>offsetDate(c.date,-((c.weekday+6)%7))),monthly:group(c=>c.date.slice(0,7)),
    hourly:group(c=>String(c.hour).padStart(2,'0')),weekdays:group(c=>String(c.weekday)),
    apps:group(c=>c.app),categories:group(c=>c.category),
    coverage:snapshot.coverage, // Global observation limits remain visible with filtered totals.
  };
}
