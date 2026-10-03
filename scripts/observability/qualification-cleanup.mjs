import {open,readdir,rm,writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {readPreparedBackend} from './backend-files.mjs';
import {readAllocation} from './allocation-readback.mjs';
import {readHostRoots} from './host-roots.mjs';
import {assertOwnedBackend} from './backend-plan.mjs';
import {cleanupBackend} from './backend-cleanup.mjs';
import {createCleanupJournal,readCleanupJournal} from './cleanup-journal.mjs';
import {isDeepStrictEqual} from 'node:util';

/** Verify recorded application absence before removing this run's synthetic
 * state. Unknown children/resources leave cleanup incomplete, never forced. */
export async function cleanupQualification({directory,backend,teardownStartedNs}) {
  const {plan}=await readPreparedBackend(directory),{receipt,status}=await readAllocation(directory);
  if(status!=='allocated-stopped')throw new Error('Qualification allocation incomplete; retain resources for readback');
  const container=await backend.inspect('container',receipt.containerId,{timeoutMs:5000});
  if(container!==null){assertOwnedBackend(container,plan,receipt);
    if(container.State?.Running!==false)throw new Error('Backend stop unconfirmed; no repeated stop');}
  const roots=await readHostRoots(directory);let file;
  try {
    file=await open(directory+'/workload.jsonl',constants.O_RDONLY|constants.O_NOFOLLOW);
    const info=await file.stat();if(!info.isFile()||info.size>32*1024*1024)throw new Error('Workload ownership evidence invalid');
    const text=await file.readFile('utf8');
    const lines=text.length?text.trimEnd().split('\n'):[];if(lines.length>20000)throw new Error('Workload ownership evidence invalid');
    for(const line of lines) {
      const event=JSON.parse(line).event;
      if(event.kind==='application-start') {
        if(!Number.isInteger(event.identity?.pid)||event.identity.pid<=1)throw new Error('Application ownership invalid');
        let absent=false;try{process.kill(event.identity.pid,0);}catch(error){absent=error.code==='ESRCH';}
        if(!absent)throw new Error('Application absence unconfirmed');
      }
    }
  }catch(error){if(error.code!=='ENOENT')throw error;}
  finally{await file?.close();}
  const journal=await createCleanupJournal(directory,receipt,'qualification');
  let cleaned;
  try {
    cleaned=await cleanupBackend({plan,receipt,backend,record:journal.record,evidenceSaved:true});
    await journal.close();await readCleanupJournal(journal.path,plan,receipt);
  }finally{await journal.close();}
  const teardownMs=typeof teardownStartedNs==='string'&&/^[0-9]+$/.test(teardownStartedNs)?
    Number(process.hrtime.bigint()-BigInt(teardownStartedNs))/1e6:null;
  if(!isDeepStrictEqual(await readHostRoots(directory),roots))throw new Error('Synthetic state ownership changed');
  const state=roots.roots.state.path;
  if(!(await readdir(state)).every(name=>['observability-owner.json','contract','hub','hub-cf-d','hub-cf-e','hub-faults-disabled','hub-faults-enabled'].includes(name)))throw new Error('Synthetic state contains unknown resources');
  await rm(state,{recursive:true,force:false});
  let absent=false;try{await readdir(state);}catch(error){absent=error.code==='ENOENT';}
  if(!absent)throw new Error('Synthetic state removal unconfirmed');
  const result={...cleaned,teardownMs,syntheticStateRemoved:true,evidenceRetained:true};
  await writeFile(directory+'/cleanup-result.json',JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  return result;
}
