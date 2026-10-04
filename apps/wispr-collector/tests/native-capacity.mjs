import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,rmSync,readFileSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { supervise } from '../dist/supervisor.js';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {diverseText} from './diverse-language.mjs';
import {qualifyLanguageResources} from './language-resources.mjs';
assert.equal(process.platform,'win32');assert.equal(Number(process.versions.node.split('.')[0]),24);
const root=process.env.WISPR_TEST_TMPDIR;assert.ok(root);const directory=mkdtempSync(join(root,'native-capacity-'));
try{
 const sourcePath=join(directory,'source.sqlite'),stateDirectory=join(directory,'state');mkdirSync(stateDirectory);
 const db=new DatabaseSync(sourcePath);db.exec('CREATE TABLE History(id TEXT,timestamp TEXT,status TEXT,numWords INTEGER,duration REAL,speechDuration REAL);BEGIN');
 const insert=db.prepare('INSERT INTO History VALUES(?,?,?,?,?,?)');for(let i=0;i<100000;i++)insert.run(String(i),'2026-10-01T12:00:00Z','formatted',10,5,3);db.exec('COMMIT');db.close();
 const config={schemaVersion:'1.0',namespace:'11111111-1111-4111-8111-111111111111',ownerDirectory:directory,stateDirectory,sourcePath,timezone:'UTC',collectionEnabled:true,language:{enabled:false}};
 const run=()=>supervise({directory:stateDirectory,entry:new URL('../dist/run-worker.js',import.meta.url),payload:{config,operation:{command:'collect'}}});
 const start=performance.now();await run();const elapsedMs=Math.round(performance.now()-start),snapshot=JSON.parse(readFileSync(join(stateDirectory,'aggregate.json')));
 assert.equal(snapshot.numeric.totals.dictations,100000);assert.equal(snapshot.numeric.totals.words,1000000);
 const extra=new DatabaseSync(sourcePath);extra.prepare('INSERT INTO History VALUES(?,?,?,?,?,?)').run('overflow','2026-10-01T12:00:00Z','formatted',10,5,3);extra.close();
 await assert.rejects(run(),/source-capacity/);assert.deepEqual(JSON.parse(readFileSync(join(stateDirectory,'aggregate.json'))),snapshot);
 console.log(JSON.stringify({result:'passed',scope:'native synthetic 100000-row bound',rows:100000,elapsedMs,overflowRejected:true,lastGoodPreserved:true}));
}finally{rmSync(directory,{recursive:true,force:true});}
console.log(JSON.stringify(qualifyLanguageResources(root)));

const rankedDirectory=mkdtempSync(join(root,'native-ranking-partitions-'));
const acl=String.raw`$ErrorActionPreference='Stop';$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User;$acl=New-Object System.Security.AccessControl.DirectorySecurity;$acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false);foreach($id in @($sid.Value,'S-1-5-18','S-1-5-32-544')){$rule=New-Object System.Security.AccessControl.FileSystemAccessRule((New-Object System.Security.Principal.SecurityIdentifier($id)),'FullControl','ContainerInherit,ObjectInherit','None','Allow');$acl.AddAccessRule($rule)};Set-Acl -LiteralPath $env:BUNNY_WISPR_FIXTURE -AclObject $acl`;
try{
 const secure=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',acl],{encoding:'utf8',timeout:8000,windowsHide:true,env:{...process.env,BUNNY_WISPR_FIXTURE:rankedDirectory}});assert.equal(secure.status,0,secure.stderr);
 const sourcePath=join(rankedDirectory,'source.sqlite'),stateDirectory=join(rankedDirectory,'state'),configPath=join(rankedDirectory,'config.json');
 const db=new DatabaseSync(sourcePath);
 db.exec('CREATE TABLE History(id TEXT,timestamp TEXT,status TEXT,numWords INTEGER,appName TEXT,asrText TEXT,formattedText TEXT,detectedLanguage TEXT)');
 const insert=db.prepare('INSERT INTO History VALUES(?,?,?,?,?,?,?,?)');
 for(let i=0;i<42;i++){const text=diverseText(900,Math.floor(i/3)*900);insert.run(String(i),'2026-10-02T10:00:00Z','formatted',900,'Slack',text,text,'en');}db.close();
 const sourceHash=()=>createHash('sha256').update(readFileSync(sourcePath)).digest('hex');const before=sourceHash();
 writeFileSync(configPath,JSON.stringify({schemaVersion:'1.0',namespace:'11111111-1111-4111-8111-111111111111',ownerDirectory:rankedDirectory,stateDirectory,sourcePath,timezone:'UTC',collectionEnabled:true,language:{enabled:true}}));
 const run=()=>{const result=spawnSync(process.execPath,['--disable-warning=ExperimentalWarning',fileURLToPath(new URL('../dist/cli.js',import.meta.url)),'collect','--config',configPath],{encoding:'utf8',timeout:65000,windowsHide:true});assert.equal(result.status,0,result.stdout+result.stderr);return JSON.parse(readFileSync(join(stateDirectory,'aggregate.json'),'utf8'));};
 const started=performance.now(),first=run(),firstElapsedMs=Math.round(performance.now()-started);
 const table=first.language.tables.find(t=>t.preset==='all'&&t.app==='all'&&t.category==='all'&&t.corpus==='formatted');
 assert.equal(first.numeric.totals.words,37800);assert.equal(table.words.length,100);assert.equal(table.omitted.words,12500);assert.equal(table.omitted.phrases,50160);assert.equal(table.coverage.eligible,42);assert.equal(table.comparedDictations,42);assert.equal(table.changedDictations,0);
 const repeated=run();assert.deepEqual(repeated.numeric,first.numeric);assert.deepEqual(repeated.language,first.language);assert.equal(sourceHash(),before);
 console.log(JSON.stringify({result:'passed',scope:'native synthetic production CLI with oversized ranking batches',firstElapsedMs,exactRepeat:true,sourceBytesPreserved:true,resourceBudgetsUnchanged:true}));
}finally{rmSync(rankedDirectory,{recursive:true,force:true});}
