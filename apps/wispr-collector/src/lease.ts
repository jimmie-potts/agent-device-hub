import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

/** Kernel-backed SQLite locks release on process death; no PID file or stale-lock stealing. */
export function acquireLease(directory: string, filename: 'lease.sqlite' | 'worker-lease.sqlite' = 'lease.sqlite'): { release(): void } {
  let db:DatabaseSync|undefined;
  try{
    db=new DatabaseSync(join(directory,filename),{timeout:0,allowExtension:false});
    db.exec('PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE');
  }catch{db?.close();throw new Error('collector-busy');}
  let released=false;
  return {release(){if(released)return;released=true;try{db!.exec('ROLLBACK');}finally{db!.close();}}};
}
