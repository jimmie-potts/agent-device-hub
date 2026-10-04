import test from 'node:test';
import assert from 'node:assert/strict';
import {open,writeFile,symlink,mkdir,link,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {fingerprints,loadConfig} from '../dist/config.js';
import {readRegular} from '../dist/storage.js';
import {checkPlanner} from '../closeout/assessment.mjs';
import {closeoutFixture} from './closeout-fixture.mjs';
import {largeTrustedFile} from './fingerprint-fixture.mjs';

for(const consumer of ['intake','closeout']){
 test(`${consumer} accepts a native-sized trusted file with bounded private reads unchanged`,async()=>{
  const f=await closeoutFixture();
  try{
   const large=await largeTrustedFile(f.directory);
   f.config.planning.files[large.path]=large.sha256;
   if(consumer==='intake')await fingerprints({files:{[large.path]:large.sha256}});
   else await checkPlanner(f.config);
   await assert.rejects(readRegular(large.path,128*1024*1024),/unsafe-file/);
   if(consumer==='intake'){
    const config=join(f.directory,'oversized-config.json');await writeFile(config,' '.repeat(128*1024+1),{mode:0o600});
    await assert.rejects(loadConfig(config),/unsafe-file/);
   }
  }finally{await f.close();}
 });
 test(`${consumer} rejects oversized, mismatched and nonregular fingerprints`,async()=>{
  const f=await closeoutFixture();
  try{
   const path=join(f.directory,'trusted'),digest=createHash('sha256').update('trusted').digest('hex');
   f.config.planning.files[path]=digest;
   const verify=()=>consumer==='intake'?fingerprints({files:{[path]:digest}}):checkPlanner(f.config);
   await writeFile(path,'changed');
   await assert.rejects(verify(),consumer==='intake'?/trusted-file-drift/:/closeout-file-drift/);
   const file=await open(path,'w');try{await file.truncate(512*1024*1024+1);}finally{await file.close();}
   await assert.rejects(verify(),/unsafe-file/);
   const target=join(f.directory,'trusted-target');await writeFile(target,'trusted');
   await unlink(path);await symlink(target,path);
   await assert.rejects(verify(),/unsafe-file/);
   await unlink(path);await mkdir(path);await assert.rejects(verify(),/unsafe-file/);
   delete f.config.planning.files[path];
   const hardlink=join(f.directory,'hardlink');await link(f.config.planning.planWork,hardlink);
   f.config.planning.files[hardlink]=digest;
   if(consumer==='intake')await assert.rejects(fingerprints({files:{[hardlink]:digest}}),/unsafe-file/);
   else await assert.rejects(checkPlanner(f.config),/unsafe-file/);
  }finally{await f.close();}
 });
}
