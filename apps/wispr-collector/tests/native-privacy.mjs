import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync,mkdtempSync,rmSync,symlinkSync,writeFileSync,linkSync,readFileSync,copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { qualifyWindowsPaths,qualifyState } from '../dist/config.js';
import { acquireLease } from '../dist/lease.js';

assert.equal(process.platform,'win32');
const root=process.env.WISPR_TEST_TMPDIR;assert.ok(root&&/^[A-Za-z]:\\/.test(root));
const directory=mkdtempSync(join(root,'native-privacy-'));
let initialized=false;
function acl(mode){
  if(initialized){
    const args=mode==='public'?['/grant','*S-1-1-0:(OI)(CI)(RX)']:['/remove:g','*S-1-1-0'];
    const result=spawnSync('icacls.exe',[directory,...args],{encoding:'utf8',timeout:8000,windowsHide:true});
    assert.equal(result.status,0,result.stdout+result.stderr);return;
  }
  const code=String.raw`
$ErrorActionPreference='Stop'
try {
 $path=$env:BUNNY_WISPR_FIXTURE
 $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
 $acl=New-Object System.Security.AccessControl.DirectorySecurity
 $acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false)
 foreach($identity in @($sid.Value,'S-1-5-18','S-1-5-32-544')){
   $principal=New-Object System.Security.Principal.SecurityIdentifier($identity)
   $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($principal,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
   $acl.AddAccessRule($rule)
 }
 if($env:BUNNY_WISPR_ACL_MODE -eq 'public'){
   $principal=New-Object System.Security.Principal.SecurityIdentifier('S-1-1-0')
   $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($principal,'ReadAndExecute','ContainerInherit,ObjectInherit','None','Allow')
   $acl.AddAccessRule($rule)
 }
 Set-Acl -LiteralPath $path -AclObject $acl
 [Console]::Out.Write('ok')
}catch{[Console]::Out.Write($_.Exception.Message);exit 1}
`;
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],{encoding:'utf8',timeout:8000,windowsHide:true,env:{...process.env,BUNNY_WISPR_FIXTURE:directory,BUNNY_WISPR_ACL_MODE:mode}});
  assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(result.stdout,'ok');
  initialized=true;
}
try{
  acl('private');
  const file=join(directory,'fixture.sqlite');writeFileSync(file,'synthetic');
  qualifyWindowsPaths([directory,file,join(directory,'new-output.json')]);
  acl('public');assert.throws(()=>qualifyWindowsPaths([directory]),{message:'unsafe-private-path'});acl('private');
  const target=join(directory,'target');mkdirSync(target);
  const link=join(directory,'redirect');symlinkSync(target,link,'junction');
  assert.throws(()=>qualifyWindowsPaths([link]),{message:'unsafe-private-path'});
  rmSync(link);
  mkdirSync(join(target,'.git'));
  assert.throws(()=>qualifyWindowsPaths([join(target,'output.json')]),{message:'unsafe-path'});
  const lease=acquireLease(directory);
  assert.throws(()=>acquireLease(directory),{message:'collector-busy'});lease.release();acquireLease(directory).release();
  const stateDirectory=join(directory,'alias-state'),sourcePath=join(directory,'synthetic-source.sqlite'),configPath=join(directory,'config.json');
  mkdirSync(stateDirectory);mkdirSync(join(stateDirectory,'backups'));
  const db=new DatabaseSync(sourcePath);db.exec("PRAGMA journal_mode=WAL;CREATE TABLE History(id TEXT,timestamp TEXT,status TEXT,numWords INTEGER);INSERT INTO History VALUES('a','2026-10-01T12:00:00Z','formatted',10)");
  const config={schemaVersion:'1.0',namespace:'11111111-1111-4111-8111-111111111111',ownerDirectory:directory,sourcePath,stateDirectory,timezone:'UTC',collectionEnabled:true,language:{enabled:false}};
  writeFileSync(configPath,JSON.stringify(config));
  const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
  function readerGrant(path,enabled){
    const args=enabled?['/grant','*S-1-1-0:(RX)']:['/remove:g','*S-1-1-0'];
    const result=spawnSync('icacls.exe',[path,...args],{encoding:'utf8',timeout:8000,windowsHide:true});
    assert.equal(result.status,0,result.stdout+result.stderr);
  }
  function aclIdentity(path){
    const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',String.raw`[Console]::Out.Write((Get-Acl -LiteralPath $env:BUNNY_WISPR_FIXTURE).Sddl)`],{encoding:'utf8',timeout:8000,windowsHide:true,env:{...process.env,BUNNY_WISPR_FIXTURE:path}});
    assert.equal(result.status,0,result.stderr);return result.stdout;
  }
  function command(name,args=[]){return spawnSync(process.execPath,['--disable-warning=ExperimentalWarning',fileURLToPath(new URL('../dist/cli.js',import.meta.url)),name,'--config',configPath,...args],{encoding:'utf8',timeout:60000,windowsHide:true});}
  // Grant another reader only on synthetic vendor-source files, never collector outputs.
  const sourceFiles=[sourcePath,sourcePath+'-wal',sourcePath+'-shm'];
  for(const path of sourceFiles)readerGrant(path,true);
  // SQLite read-only WAL readers may update SHM lock/read-mark bookkeeping.
  // Persistent database/WAL bytes and every source ACL must remain unchanged.
  const sourceFingerprint=()=>sourceFiles.map(path=>({bytes:path.endsWith('-shm')?null:hash(path),acl:aclIdentity(path)}));
  const sourceBefore=sourceFingerprint();
  try{
    const collected=command('collect');assert.equal(collected.status,0,collected.stdout+collected.stderr);
    const aggregatePath=join(stateDirectory,'aggregate.json');
    assert.equal(JSON.parse(readFileSync(aggregatePath)).numeric.totals.words,10);
    const repeated=command('collect');assert.equal(repeated.status,0,repeated.stdout+repeated.stderr);
    assert.equal(JSON.parse(readFileSync(aggregatePath)).numeric.totals.words,10);
    assert.deepEqual(sourceFingerprint(),sourceBefore);
    const backupPath=join(stateDirectory,'backups/private.sqlite');copyFileSync(join(stateDirectory,'analytics.sqlite'),backupPath);
    const exportPath=join(directory,'private-export.json');writeFileSync(exportPath,'preserve-existing-export');
    for(const path of [configPath,stateDirectory,join(stateDirectory,'analytics.sqlite'),backupPath,exportPath]){
      const retainedBefore=hash(join(stateDirectory,'analytics.sqlite')),publishedBefore=hash(aggregatePath);
      readerGrant(path,true);
      try{
        const rejected=path===exportPath?command('export',['--format','json','--output',exportPath]):command('collect');
        assert.equal(rejected.status,1,rejected.stdout+rejected.stderr);
        assert.equal(JSON.parse(rejected.stderr).code,'unsafe-private-path');
        assert.equal(hash(join(stateDirectory,'analytics.sqlite')),retainedBefore);assert.equal(hash(aggregatePath),publishedBefore);
        assert.equal(readFileSync(exportPath,'utf8'),'preserve-existing-export');
      }finally{readerGrant(path,false);}
    }
    rmSync(exportPath);
    console.log(JSON.stringify({result:'passed',scope:'native selected-source ACL relaxation',extraSourceReaderAccepted:true,sidecarsQualified:true,sourceBytesAndAclsUnchanged:true,repeatedCountsExact:true,privateConfigStateBackupExportRejected:true}));
  }finally{db.close();}
  // Leave a clean state directory for the existing writable-alias negative controls.
  rmSync(stateDirectory,{recursive:true,force:true});mkdirSync(stateDirectory);mkdirSync(join(stateDirectory,'backups'));
  const before=hash(sourcePath),configBefore=hash(configPath);
  function rejected(command,args=[]){
    const result=spawnSync(process.execPath,['--disable-warning=ExperimentalWarning',fileURLToPath(new URL('../dist/cli.js',import.meta.url)),command,'--config',configPath,...args],{encoding:'utf8',timeout:60000,windowsHide:true});
    assert.equal(result.status,1,result.stdout+result.stderr);assert.equal(JSON.parse(result.stderr).code,'unsafe-path');
    assert.equal(hash(sourcePath),before);assert.equal(hash(configPath),configBefore);
  }
  for(const filename of ['lease.sqlite','worker-lease.sqlite','analytics.sqlite','analytics.sqlite-journal','control.json','aggregate.json','status.json','run.json','stop.json','backups/first.sqlite']){
    const alias=join(stateDirectory,filename);linkSync(sourcePath,alias);
    try{assert.throws(()=>qualifyState(config),{message:'unsafe-path'});rejected('collect');}finally{rmSync(alias);}
  }
  const configAlias=join(stateDirectory,'status.json');linkSync(configPath,configAlias);
  try{rejected('status');}finally{rmSync(configAlias);}
  for(const protectedPath of [sourcePath,configPath]){
    const alias=join(directory,'export-alias.json');linkSync(protectedPath,alias);
    try{rejected('export',['--format','json','--output',alias]);}finally{rmSync(alias);}
    rejected('export',['--format','json','--output',protectedPath]);
  }
  // Short-name availability is a filesystem setting; never enable it for a test.
  const shortResult=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',String.raw`$fso=New-Object -ComObject Scripting.FileSystemObject;[Console]::Out.Write($fso.GetFolder($env:BUNNY_WISPR_FIXTURE).ShortPath)`],{encoding:'utf8',timeout:8000,windowsHide:true,env:{...process.env,BUNNY_WISPR_FIXTURE:stateDirectory}});
  assert.equal(shortResult.status,0,shortResult.stderr);const shortState=shortResult.stdout;
  let shortAlias='unavailable on this volume';
  if(shortState.toLowerCase()!==stateDirectory.toLowerCase()){
    const containedSource=join(stateDirectory,'contained.sqlite');copyFileSync(sourcePath,containedSource);
    try{assert.throws(()=>qualifyState({...config,sourcePath:join(shortState,'contained.sqlite')}),{message:'unsafe-path'});shortAlias='rejected';}finally{rmSync(containedSource);}
    rejected('export',['--format','json','--output',join(shortState,'new.json')]);
  }
  for(const suffix of ['-wal','-shm','-journal'])rejected('export',['--format','json','--output',sourcePath+suffix]);
  const check=new DatabaseSync(sourcePath,{readOnly:true});assert.equal(check.prepare('PRAGMA journal_mode').get().journal_mode,'wal');check.close();
  console.log(JSON.stringify({result:'passed',scope:'native synthetic ACL, reparse, Git-path and lease checks',privatePathsAccepted:true,broadAclRejected:true,junctionRejected:true,gitRejected:true,exclusiveLease:true}));
  console.log(JSON.stringify({result:'passed',scope:'native synthetic writable aliases',stateAliasesRejected:10,configAliasRejected:true,sourceAndConfigExportsRejected:true,sourceSidecarsProtected:true,shortAlias,sourceUnchanged:true,journalMode:'wal'}));
}finally{rmSync(directory,{recursive:true,force:true});}
