import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync,readFileSync,rmSync,existsSync } from 'node:fs';
import { join } from 'node:path';
import { atomicJson } from '../dist/publication.js';
assert.equal(process.platform,'win32');const root=process.env.WISPR_TEST_TMPDIR;assert.ok(root);
const directory=mkdtempSync(join(root,'locked-output-')),path=join(directory,'aggregate.json'),ready=join(directory,'ready');
const code=String.raw`$ErrorActionPreference='Stop';$stream=[System.IO.File]::Open($env:BUNNY_WISPR_LOCK,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::Read);try{[System.IO.File]::WriteAllText($env:BUNNY_WISPR_READY,'ready');Start-Sleep -Seconds 30}finally{$stream.Dispose()}`;
let child;
try{
 atomicJson(path,{revision:1});child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],{stdio:'ignore',windowsHide:true,env:{...process.env,BUNNY_WISPR_LOCK:path,BUNNY_WISPR_READY:ready}});
 const closed=new Promise(resolve=>child.once('close',resolve));const end=Date.now()+8000;
 while(!existsSync(ready)){if(Date.now()>end)throw Error('fixture-timeout');await new Promise(r=>setTimeout(r,20));}
 assert.throws(()=>atomicJson(path,{revision:2}),/publication-failed/);assert.equal(JSON.parse(readFileSync(path)).revision,1);
 child.kill();await closed;child=undefined;atomicJson(path,{revision:2});assert.equal(JSON.parse(readFileSync(path)).revision,2);
 console.log(JSON.stringify({result:'passed',scope:'native locked atomic destination',lastGoodPreserved:true,retryReplaced:true}));
}finally{if(child){const closed=new Promise(resolve=>child.once('close',resolve));child.kill();await closed;}rmSync(directory,{recursive:true,force:true});}
