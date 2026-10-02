import { openSync, writeSync, fsyncSync, closeSync, constants } from 'node:fs';
import { join } from 'node:path';

/** Driver-owned bounded evidence, separate from application measurements.
 * Synchronous writes preserve event order; latency/omission evidence includes
 * any driver delay. A failed journal cannot resume or overwrite its prefix. */
export function createWorkloadJournal(directory) {
  const path=join(directory,'workload.jsonl');
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
        if(line.length>65536 || sequence>=20000 || bytes+line.length>32*1024*1024)throw new Error('Workload evidence limit');
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
