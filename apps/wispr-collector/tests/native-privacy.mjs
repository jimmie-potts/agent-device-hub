import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync,mkdtempSync,rmSync,symlinkSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { qualifyWindowsPaths } from '../dist/config.js';
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
  console.log(JSON.stringify({result:'passed',scope:'native synthetic ACL, reparse, Git-path and lease checks',privatePathsAccepted:true,broadAclRejected:true,junctionRejected:true,gitRejected:true,exclusiveLease:true}));
}finally{rmSync(directory,{recursive:true,force:true});}
