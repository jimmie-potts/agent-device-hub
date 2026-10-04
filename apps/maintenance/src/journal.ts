import { createHash } from 'node:crypto';
import { parseRecord, MAX_RECORD_BYTES } from '@jimmie-potts/bunny-observability';

export type Finding = {
  fingerprint:string; service:string; scope:string; event:string;
  operation:string; outcome:string; reason:string; count:number;
};
export type JournalOptions = {
  units:string[]; services:string[]; since:number; until:number; maxRows:number; maxBytes:number;
};
export type Extract = {
  accepted:Array<{unit:string; cursor:string; journalTime:string; message:string}>;
  findings:Finding[];
  coverage:{status:'partial'|'unavailable'; rows:number; bytes:number; rejected:number; capped:boolean; reason:string};
};

// The byte ceiling applies before concatenating or parsing a journal line.
// Journald may have rotated history: a successful query never proves completeness.
export async function collectJournal(chunks:AsyncIterable<Uint8Array>, options:JournalOptions):Promise<Extract> {
  const {units,services,since,until,maxRows,maxBytes}=options;
  if(!units.length || !services.length || !Number.isSafeInteger(since) || !Number.isSafeInteger(until) || since>=until ||
    !Number.isSafeInteger(maxRows) || maxRows<1 || maxRows>100000 || !Number.isSafeInteger(maxBytes) || maxBytes<1 || maxBytes>64*1024*1024)
    throw new Error('invalid-query-bounds');
  const out:Extract={accepted:[],findings:[],coverage:{status:'unavailable',rows:0,bytes:0,rejected:0,capped:false,reason:'no-accepted-records'}};
  const groups=new Map<string,Finding>();
  let pending=Buffer.alloc(0), oversized=false, stop=false;
  const consume=(line:Buffer)=>{
    if(++out.coverage.rows>maxRows){out.coverage.capped=true;stop=true;return;}
    try {
      const raw=JSON.parse(line.toString('utf8'));
      if(!raw || typeof raw!=='object' || !units.includes(raw._SYSTEMD_USER_UNIT) ||
        typeof raw.__REALTIME_TIMESTAMP!=='string' || !/^\d{1,17}$/.test(raw.__REALTIME_TIMESTAMP) ||
        typeof raw.__CURSOR!=='string' || raw.__CURSOR.length>1024 || typeof raw.MESSAGE!=='string' ||
        Buffer.byteLength(raw.MESSAGE)>MAX_RECORD_BYTES)throw new Error();
      const time=Number(BigInt(raw.__REALTIME_TIMESTAMP)/1000n);
      if(time<since || time>=until)throw new Error();
      const parsed=parseRecord(raw.MESSAGE);
      if(!parsed.ok || !services.includes(parsed.value.resource['service.name']))throw new Error();
      const r=parsed.value;
      out.accepted.push({unit:raw._SYSTEMD_USER_UNIT,cursor:raw.__CURSOR,journalTime:raw.__REALTIME_TIMESTAMP,message:raw.MESSAGE});
      if(r.severity_number<17 && !['operation.failed','process.failed','telemetry.dropped'].includes(r.event_name))return;
      // Only catalog enums cross into the finding. IDs, versions, traces and
      // arbitrary source fields remain in the retained private record.
      const dimensions={service:r.resource['service.name'],scope:r.scope.name,event:r.event_name,
        operation:String(r.attributes['bunny.operation']??'maintenance'),
        outcome:String(r.attributes['bunny.outcome']??'uncertain'),reason:String(r.attributes['bunny.reason']??'none')};
      const fingerprint=createHash('sha256').update(JSON.stringify(dimensions)).digest('hex');
      const group=groups.get(fingerprint);
      if(group)group.count++;else groups.set(fingerprint,{fingerprint,...dimensions,count:1});
    } catch {out.coverage.rejected++;}
  };
  for await(const chunk of chunks){
    if(stop)break;
    const room=maxBytes-out.coverage.bytes;
    const data=Buffer.from(chunk.subarray(0,Math.max(0,room)));
    out.coverage.bytes+=data.length;
    if(chunk.length>room)out.coverage.capped=true;
    let start=0;
    for(let i=0;i<data.length;i++){
      if(data[i]!==10)continue;
      const piece=data.subarray(start,i);start=i+1;
      if(!oversized && pending.length+piece.length<=64*1024)consume(Buffer.concat([pending,piece]));
      else {
        out.coverage.rejected++;
        if(++out.coverage.rows>maxRows){out.coverage.capped=true;stop=true;}
      }
      pending=Buffer.alloc(0);oversized=false;
      if(stop)break;
    }
    if(!stop){
      const tail=data.subarray(start);
      if(pending.length+tail.length>64*1024){pending=Buffer.alloc(0);oversized=true;}
      else if(!oversized)pending=Buffer.concat([pending,tail]);
    }
    if(out.coverage.capped)break;
  }
  if(pending.length || oversized)out.coverage.rejected++;
  out.findings=[...groups.values()].sort((a,b)=>b.count-a.count || a.fingerprint.localeCompare(b.fingerprint));
  if(out.accepted.length){out.coverage.status='partial';out.coverage.reason=out.coverage.capped?'query-capped':'journal-history-not-proven-complete';}
  return out;
}
