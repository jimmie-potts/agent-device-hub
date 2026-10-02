import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync,mkdtempSync,writeFileSync,renameSync,rmSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { parseConfig,sourceIdentity } from '../dist/config.js';
const good=()=>({schemaVersion:'1.0',namespace:'11111111-1111-4111-8111-111111111111',ownerDirectory:'C:\\Users\\Synthetic',sourcePath:'C:\\Users\\Synthetic\\Wispr\\flow.sqlite',stateDirectory:'C:\\Users\\Synthetic\\PrivateAnalytics',timezone:'America/New_York',collectionEnabled:true,language:{enabled:false}});
test('explicit owner-selected config has a fixed aggregate boundary',()=>{
  const c=parseConfig(good());assert.equal(c.collectionEnabled,true);assert.equal(c.language.enabled,false);
});
test('config rejects unknown controls, UNC paths, source aliases and content capture',()=>{
  for(const change of [v=>v.token='SYNTHETIC_SECRET',v=>v.sourcePath='\\\\server\\share\\flow.sqlite',v=>v.sourcePath=v.stateDirectory+'\\analytics.sqlite',v=>v.stateDirectory='C:\\Users\\Synthetic\\OneDrive\\Private',v=>v.sourcePath='D:\\OtherOwner\\flow.sqlite',v=>v.language.enabled=true,v=>v.timezone='bad-zone',v=>v.sourcePath='C:\\Users\\Synthetic\\a.sqlite:stream']){
    const value=good();change(value);assert.throws(()=>parseConfig(value),/invalid-config|unsafe-path|language-extension-unavailable/);
  }
});
test('binding identity survives writes but detects file replacement',t=>{
  const root=process.env.WISPR_TEST_TMPDIR??resolve('.local/scratch/wispr-tests');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'identity-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'source.sqlite');writeFileSync(path,'synthetic-one');const first=sourceIdentity(path);
  writeFileSync(path,'synthetic-two');assert.equal(sourceIdentity(path),first);
  renameSync(path,join(dir,'previous.sqlite'));writeFileSync(path,'synthetic-three');assert.notEqual(sourceIdentity(path),first);
});
