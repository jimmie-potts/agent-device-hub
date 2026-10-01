import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const directory=await mkdtemp(join(tmpdir(),'pixoo-timing-'));
try{
 await build({entryPoints:['apps/dashboard/src/pixoo-media.tsx'],bundle:true,platform:'node',format:'esm',outfile:join(directory,'preview.mjs')});
 const {frameAt}=await import(join(directory,'preview.mjs'));
 test('preview frame clock follows effective delays, repeats without accumulating callback drift and supports stills',()=>{
  const frames=Array.from({length:20},(_,index)=>({index,delayMs:index%2?150:50}));
  assert.equal(frameAt(frames,0),0);assert.equal(frameAt(frames,49),0);assert.equal(frameAt(frames,50),1);assert.equal(frameAt(frames,199),1);assert.equal(frameAt(frames,200),2);assert.equal(frameAt(frames,1999),19);assert.equal(frameAt(frames,2000),0);assert.equal(frameAt(frames,1002050),1);
  assert.equal(frameAt([{index:0,delayMs:null}],9999),0);
 });
}finally{await rm(directory,{recursive:true,force:true});}
