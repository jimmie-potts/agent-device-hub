import type { DatabaseSync } from 'node:sqlite';
import type { Snapshot } from '@jimmie-potts/wispr-contracts';
type Dictionary=Snapshot['dictionary'];
export const unavailableDictionary=():Dictionary=>({availability:'unavailable',activeEntries:null,activeSnippets:null,localUsage:null,remoteUsage:null,window:'unknown',segment:0});

/** Fixed numeric-only profile. Entry/replacement strings are never selected. */
export function readDictionary(db:DatabaseSync,maxRows=100_000,maxBytes=256*1024*1024,onBytes?:(bytes:number)=>void):Dictionary {
  const unknown=unavailableDictionary();
  const table=db.prepare("SELECT type,sql FROM sqlite_schema WHERE name='Dictionary'").get();
  if(table?.type!=='table'||typeof table.sql!=='string'||/CREATE\s+VIRTUAL/i.test(table.sql))return unknown;
  const types=new Map(db.prepare('PRAGMA table_xinfo(Dictionary)').all().filter(c=>c.hidden===0).map(c=>[String(c.name),String(c.type)]));
  const numeric=(name:string)=>/INT|REAL|FLOA|DOUB|NUM|DEC/i.test(types.get(name)??'');
  if(!numeric('isDeleted'))return unknown;
  const count=db.prepare('SELECT count(*) AS n FROM Dictionary').get()?.n;
  if(typeof count!=='number'||count>maxRows)throw new Error('source-capacity');
  const optional=['isSnippet','frequencyUsed','remoteFrequencyUsed'].filter(numeric);
  const fields=['isDeleted',...optional].map(n=>({name:n,expression:`CASE WHEN typeof("${n}") IN ('integer','real') THEN "${n}" ELSE NULL END`}));
  const bytes=db.prepare(`SELECT coalesce(sum(${fields.map(f=>`coalesce(length(CAST((${f.expression}) AS BLOB)),0)`).join('+')}),0) AS n FROM Dictionary`).get()?.n;
  if(typeof bytes!=='number'||bytes>maxBytes)throw new Error('source-capacity');onBytes?.(bytes);
  const query=db.prepare(`SELECT ${fields.map(f=>`${f.expression} AS "${f.name}"`).join(',')} FROM Dictionary`);query.setReadBigInts(true);
  const result:Dictionary={...unknown,availability:'available',activeEntries:0,activeSnippets:optional.includes('isSnippet')?0:null,localUsage:optional.includes('frequencyUsed')?0:null,remoteUsage:optional.includes('remoteFrequencyUsed')?0:null};
  const countValue=(v:unknown):number|null=>{
    const number=typeof v==='bigint'?Number(v):v;
    return typeof number==='number'&&Number.isSafeInteger(number)&&number>=0?number:null;
  };
  for(const row of query.iterate()){
    const deleted=countValue(row.isDeleted);if(deleted!==0&&deleted!==1)return unknown;if(deleted===1)continue;
    result.activeEntries!++;
    if(result.activeSnippets!==null){const flag=countValue(row.isSnippet);if(flag===0||flag===1)result.activeSnippets+=flag;else result.activeSnippets=null;}
    for(const [field,target] of [['frequencyUsed','localUsage'],['remoteFrequencyUsed','remoteUsage']] as const){
      if(result[target]===null)continue;const value=countValue(row[field]);
      result[target]=value===null||!Number.isSafeInteger(result[target]+value)?null:result[target]+value;
    }
  }
  return result;
}

export function dictionarySnapshot(previous:Dictionary,current:Dictionary,reset=false):Dictionary {
  const decreased=(['localUsage','remoteUsage'] as const).some(key=>previous[key]!==null&&current[key]!==null&&current[key]<previous[key]);
  return {...current,segment:previous.segment+Number(reset||decreased)};
}
