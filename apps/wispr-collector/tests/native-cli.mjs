import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync,readFileSync,rmSync,writeFileSync,existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
assert.equal(process.platform,'win32');assert.equal(Number(process.versions.node.split('.')[0]),24);
const root=process.env.WISPR_TEST_TMPDIR;assert.ok(root&&/^[A-Za-z]:\\/.test(root));
const directory=mkdtempSync(join(root,'native-cli-'));
const acl=String.raw`$ErrorActionPreference='Stop';$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User;$acl=New-Object System.Security.AccessControl.DirectorySecurity;$acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false);foreach($id in @($sid.Value,'S-1-5-18','S-1-5-32-544')){$principal=New-Object System.Security.Principal.SecurityIdentifier($id);$rule=New-Object System.Security.AccessControl.FileSystemAccessRule($principal,'FullControl','ContainerInherit,ObjectInherit','None','Allow');$acl.AddAccessRule($rule)};Set-Acl -LiteralPath $env:BUNNY_WISPR_FIXTURE -AclObject $acl`;
try{
 const secured=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',acl],{encoding:'utf8',timeout:8000,windowsHide:true,env:{...process.env,BUNNY_WISPR_FIXTURE:directory}});assert.equal(secured.status,0,secured.stderr);
 const sourcePath=join(directory,'source.sqlite'),stateDirectory=join(directory,'state'),configPath=join(directory,'config.json');
 const db=new DatabaseSync(sourcePath);db.exec("PRAGMA journal_mode=WAL;CREATE TABLE History(id TEXT,timestamp TEXT,status TEXT,numWords INTEGER,duration REAL,speechDuration REAL,transcript TEXT,context TEXT);INSERT INTO History VALUES('a','2026-10-01T12:00:00Z','formatted',12,6,4,'PRIVATE_CANARY','https://secret.invalid/PRIVATE_CANARY')");db.close();
 const hash=()=>createHash('sha256').update(readFileSync(sourcePath)).digest('hex'),before=hash();
 const config={schemaVersion:'1.0',namespace:'11111111-1111-4111-8111-111111111111',ownerDirectory:directory,sourcePath,stateDirectory,timezone:'America/New_York',collectionEnabled:true,language:{enabled:false}};
 writeFileSync(configPath,JSON.stringify(config));
 let calls=0;
 function cli(command,args=[],ok=true){const result=spawnSync(process.execPath,['--disable-warning=ExperimentalWarning',fileURLToPath(new URL('../dist/cli.js',import.meta.url)),command,'--config',configPath,...args],{encoding:'utf8',timeout:60_000,windowsHide:true});calls++;assert.equal(result.status,ok?0:1,result.stdout+result.stderr);assert.equal((result.stdout+result.stderr).includes('PRIVATE_CANARY'),false);return JSON.parse(ok?result.stdout:result.stderr);}
 cli('collect');let snapshot=JSON.parse(readFileSync(join(stateDirectory,'aggregate.json')));assert.equal(snapshot.numeric.totals.words,12);const generation=snapshot.generation;
 cli('export',['--format','json','--output',join(directory,'numeric.json')]);cli('export',['--format','csv','--output',join(directory,'numeric.csv')]);
 assert.equal(JSON.parse(readFileSync(join(directory,'numeric.json'))).numeric.totals.words,12);assert.match(readFileSync(join(directory,'numeric.csv'),'utf8'),/2026-10-01,8,4,other,other-unknown,false,1,12/);
 cli('backup',['--name','first']);cli('clear');snapshot=JSON.parse(readFileSync(join(stateDirectory,'aggregate.json')));assert.notEqual(snapshot.generation,generation);assert.equal(snapshot.numeric.totals.words,0);
 cli('collect');assert.equal(JSON.parse(readFileSync(join(stateDirectory,'aggregate.json'))).numeric.totals.words,0);
 assert.equal(cli('restore',['--name','first'],false).code,'backup-before-clear');cli('restore',['--name','first','--historical-reimport']);assert.equal(cli('status').result.revision>1,true);
 assert.equal(hash(),before);for(const name of ['numeric.json','numeric.csv'])assert.equal(readFileSync(join(directory,name),'utf8').includes('PRIVATE_CANARY'),false);
 const writer=new DatabaseSync(sourcePath);writer.exec('ALTER TABLE History ADD COLUMN asrText TEXT; ALTER TABLE History ADD COLUMN formattedText TEXT; ALTER TABLE History ADD COLUMN editedText TEXT; ALTER TABLE History ADD COLUMN detectedLanguage TEXT; ALTER TABLE History ADD COLUMN editedTextStatus TEXT; ALTER TABLE History ADD COLUMN editObservationEnd TEXT; DELETE FROM History');
 const insert=writer.prepare('INSERT INTO History(id,timestamp,status,numWords,asrText,formattedText,editedText,detectedLanguage,editedTextStatus,editObservationEnd) VALUES(?,?,?,?,?,?,?,?,?,?)');
 for(const id of ['a','b','c'])insert.run(id,'2026-10-01T12:00:00Z','formatted',2,'hello there','hello world','hello friend','en','complete','2026-10-01T12:01:00Z');writer.close();const beforeLanguage=hash();
 config.language.enabled=true;writeFileSync(configPath,JSON.stringify(config));cli('reset',['--historical-reimport']);cli('collect');
 const language=JSON.parse(readFileSync(join(stateDirectory,'aggregate.json')));assert.equal(language.language.availability,'available');assert.ok(language.language.tables.some(t=>t.words.some(w=>w.text==='friend')));cli('backup',['--name','text']);
 config.language.enabled=false;config.collectionEnabled=false;writeFileSync(configPath,JSON.stringify(config));assert.equal(cli('collect',[],false).code,'collection-disabled');
 const disabled=JSON.parse(readFileSync(join(stateDirectory,'aggregate.json')));assert.equal(disabled.language.availability,'disabled');assert.equal(disabled.numeric.totals.words,6);assert.notEqual(disabled.generation,language.generation);assert.equal(existsSync(join(stateDirectory,'backups/text.sqlite')),false);assert.equal(hash(),beforeLanguage);
 console.log(JSON.stringify({result:'passed',scope:'offline packaged Windows CLI with synthetic source',calls,sourceUnchanged:true,clearBoundary:true,explicitRestore:true,numericExports:true,privateCanaryExcluded:true,languageOptIn:true,textOptOut:true,managedTextBackupRemoved:true}));
}finally{rmSync(directory,{recursive:true,force:true});}
