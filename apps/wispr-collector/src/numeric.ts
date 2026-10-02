import { createHash } from 'node:crypto';
import { appCategory, emptySnapshot, emptyTotals, localDate, safeApp, TOTAL_KEYS, validDate, validateSnapshot, type App, type NumericCell, type Snapshot, type Totals } from '@jimmie-potts/wispr-contracts';
import type { SourceRow } from './reader-types.js';

type Status = 'formatted' | 'raw' | 'empty' | 'dismissed' | 'unknown';
export type Contribution = {
  id: string; fingerprint: string; algorithmVersion: 'numeric-1';
  sourceTime: number | null; sourceOffset: string | null; status: Status; app: App;
  exclusion: 'status' | 'words' | 'timestamp' | 'before-capture' | null;
  archived: boolean; totals: Totals;
};

export function sourceTimestamp(input: string | null): { time: number; offset: string } | null {
  if (!input) return null;
  const match=/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))? ?(Z|[+-]\d{2}:\d{2})$/.exec(input);
  if (!match || !validDate(match[1]) || +match[2]>23 || +match[3]>59 || +match[4]>59) return null;
  const offset=match[6]==='Z'?'+00:00':match[6];
  if (+offset.slice(1,3)>23 || +offset.slice(4,6)>59) return null;
  const value=`${match[1]}T${match[2]}:${match[3]}:${match[4]}.${(match[5]??'').padEnd(3,'0')}${offset}`;
  const time=Date.parse(value);
  return Number.isFinite(time)?{time,offset}:null;
}

/** Retains only allowlisted numeric metadata; original strings are never copied. */
export function contribution(row: SourceRow, captureAfter: number | null = null): Contribution {
  const stamp=sourceTimestamp(row.timestamp);
  const status:Status=['formatted','raw','empty','dismissed'].includes(row.status??'')?row.status as Status:'unknown';
  const totals=emptyTotals();
  const exclusion: Contribution['exclusion']=stamp&&captureAfter!==null&&stamp.time<=captureAfter?'before-capture':status!=='formatted'?'status':
    row.numWords===null||!Number.isSafeInteger(row.numWords)||row.numWords<=0?'words':!stamp?'timestamp':null;
  if(exclusion===null){
    totals.dictations=1;totals.words=row.numWords!;
    for(const [field,prefix] of [['duration','recording'],['speechDuration','speech']] as const){
      const value=row[field];
      const title=prefix==='recording'?'Recording':'Speech';
      if(row.invalid.includes(field)||(value!==null&&(!Number.isFinite(value)||value<0)))totals[`invalid${title}`]=1;
      else if(value===0)totals[`zero${title}`]=1;
      else if(value!==null){totals[`${prefix}Seconds`]=value;totals[`${prefix}Words`]=row.numWords!;totals[`${prefix}Samples`]=1;}
    }
    for(const [field,sum,samples,invalid] of [
      ['numWordsCorrected','wordsCorrected','correctionSamples','invalidCorrections'],
      ['numDictionaryReplacements','dictionaryReplacements','replacementSamples','invalidReplacements'],
    ] as const){
      const value=row[field];
      if(row.invalid.includes(field)||(value!==null&&(!Number.isSafeInteger(value)||value<0)))totals[invalid]=1;
      else if(value!==null){totals[sum]=value;totals[samples]=1;}
    }
  }
  const data={algorithmVersion:'numeric-1' as const,sourceTime:stamp?.time??null,sourceOffset:stamp?.offset??null,status,app:safeApp(row.appName),exclusion,totals};
  return {id:row.id,...data,archived:false,fingerprint:createHash('sha256').update(JSON.stringify(data)).digest('hex')};
}

export function aggregate(contributions: Iterable<Contribution>, options: {
  namespace: string; generation: string; revision: number; now: string; timezone: string;
  gaps?: Snapshot['coverage']['gaps'];
}): Snapshot {
  const snapshot=emptySnapshot(options);
  snapshot.revision=options.revision;snapshot.lastSuccessAt=options.now;
  snapshot.coverage.gaps=options.gaps??[];
  const groups=new Map<string,NumericCell>();
  const hourFormatter=new Intl.DateTimeFormat('en-GB',{timeZone:options.timezone,hour:'2-digit',hourCycle:'h23'});
  const addDate=(which:'captured'|'retained',date:string)=>{
    const bounds=snapshot.coverage[which];
    bounds.from=bounds.from===null||date<bounds.from?date:bounds.from;
    bounds.to=bounds.to===null||date>bounds.to?date:bounds.to;
  };
  for(const c of contributions){
    if(c.algorithmVersion!=='numeric-1')throw new Error('unsupported-numeric-version');
    if(c.archived)snapshot.coverage.archivedRows++;else snapshot.coverage.sourceRows++;
    snapshot.coverage.statuses[c.status]++;
    if(c.exclusion==='before-capture')snapshot.coverage.excluded.beforeCapture++;
    if(c.exclusion==='words')snapshot.coverage.excluded.words++;
    if(c.exclusion==='timestamp')snapshot.coverage.excluded.timestamp++;
    if(c.exclusion!==null||c.sourceTime===null)continue;
    const date=localDate(c.sourceTime,options.timezone);
    const hour=Number(hourFormatter.format(new Date(c.sourceTime)));
    addDate('captured',date);if(!c.archived)addDate('retained',date);
    snapshot.latestSourceDate=snapshot.latestSourceDate===null||date>snapshot.latestSourceDate?date:snapshot.latestSourceDate;
    const key=JSON.stringify([date,hour,c.app,c.archived]);
    const cell=groups.get(key)??{date,hour,weekday:new Date(date).getUTCDay(),app:c.app,category:appCategory(c.app),archived:c.archived,...emptyTotals()};
    for(const k of TOTAL_KEYS){cell[k]+=c.totals[k];snapshot.numeric.totals[k]+=c.totals[k];}
    groups.set(key,cell);
  }
  snapshot.health=snapshot.coverage.sourceRows===0?'empty':'ok';
  snapshot.numeric.cells=[...groups.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.hour-b.hour||a.app.localeCompare(b.app)||Number(a.archived)-Number(b.archived));
  if(!validateSnapshot(snapshot).ok)throw new Error('aggregate-capacity-or-invalid');
  return snapshot;
}
