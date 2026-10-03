import { openSync, writeSync, fsyncSync, closeSync, constants } from 'node:fs';
import { join } from 'node:path';

/** Driver-owned bounded evidence, separate from application measurements.
 * Synchronous writes preserve event order; latency/omission evidence includes
 * any driver delay. A failed journal cannot resume or overwrite its prefix. */
export const createWorkloadJournal=directory=>createJournal(directory,'workload.jsonl',20000,32*1024*1024);
export const createTelemetryJournal=directory=>createJournal(directory,'telemetry.jsonl',75000,96*1024*1024);
/** Query projections are separate rows so a full workload response cannot
 * exceed the per-record bound or erase the retained prefix on interruption. */
export function createQueryJournal(directory) {
  const journal=createJournal(directory,'delivery-queries.jsonl',150000,128*1024*1024);let id=0;
  return {...journal,record(event) {
    const eventId=id++;
    if(event.kind==='query') {
      const {records,...receipt}=event.receipt;
      if(!Array.isArray(records) || records.length>20000)throw new Error('Query evidence invalid');
      journal.record({...event,eventId,receipt,recordCount:records.length});
      records.forEach((value,index)=>journal.record({kind:'query-record',eventId,index,value}));
    } else if(event.kind==='round') {
      const comparisons={};
      for(const signal of ['logs','spans']) {
        const {missing,unexpected,...comparison}=event[signal];
        comparisons[signal]={...comparison,missingCount:missing.length,unexpectedCount:unexpected.length};
      }
      journal.record({...event,eventId,...comparisons});
      for(const signal of ['logs','spans'])for(const kind of ['missing','unexpected']) {
        event[signal][kind].forEach((value,index)=>journal.record({kind:'query-difference',eventId,signal,difference:kind,index,value}));
      }
    } else journal.record({...event,eventId});
    journal.record({kind:'query-event-end',eventId});
  }};
}
function createJournal(directory,name,maximumEvents,maximumBytes) {
  const path=join(directory,name);
  const fd=openSync(path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
  let bytes=0,sequence=0,closed=false,failed=false;
  function sync() {
    if(closed || failed)throw new Error('Workload journal closed or failed');
    try {fsyncSync(fd);}catch(error){failed=true;throw error;}
  }
  try {
    const parent=openSync(directory,constants.O_RDONLY|constants.O_DIRECTORY);
    try {fsyncSync(parent);}finally {closeSync(parent);}
  } catch(error) {closeSync(fd);throw error;}
  return {path,
    record(event) {
      if(closed || failed)throw new Error('Workload journal closed or failed');
      try {
        const line=Buffer.from(JSON.stringify({sequence,event})+'\n');
        if(line.length>65536 || sequence>=maximumEvents || bytes+line.length>maximumBytes)throw new Error('Workload evidence limit');
        let offset=0;
        while(offset<line.length) {
          const written=writeSync(fd,line,offset,line.length-offset);
          if(written<=0)throw new Error('Workload evidence write failed');
          offset+=written;
        }
        bytes+=line.length;sequence++;
        if(sequence%100===0)sync();
      }catch(error){failed=true;throw error;}
    },
    sync,
    counts:()=>({bytes,events:sequence,failed,closed}),
    close() {
      if(closed)return;
      try {fsyncSync(fd);}finally {closed=true;closeSync(fd);}
    },
  };
}
