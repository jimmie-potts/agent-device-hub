import { existsSync, readFileSync, statSync } from 'node:fs';
import { win32 } from 'node:path';
import { execFileSync } from 'node:child_process';

export type CollectorConfig = { schemaVersion:'1.0'; namespace:string; ownerDirectory:string; sourcePath:string; stateDirectory:string; timezone:string; collectionEnabled:boolean; language:{enabled:false} };
export function sourceIdentity(path:string):string {
  const stat=statSync(path,{bigint:true});
  if(!stat.isFile())throw new Error('unsafe-path');
  return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;
}
const contained=(root:string,path:string)=>{const r=win32.relative(root.toLowerCase(),path.toLowerCase());return r!==''&&!r.startsWith('..')&&!win32.isAbsolute(r);};
function windowsPath(path: unknown): asserts path is string {
  if(typeof path!=='string'||path.length>240||!/^[A-Za-z]:\\/.test(path)||/[<>"|?*\x00-\x1f]/.test(path)||path.slice(2).includes(':')||path!==win32.normalize(path)||path.split('\\').some(p=>/[ .]$/.test(p)||/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(p))||/(^|\\)(OneDrive[^\\]*|Dropbox|Google Drive|iCloudDrive)(\\|$)/i.test(path))throw new Error('unsafe-path');
}
export function parseConfig(value: unknown): CollectorConfig {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid-config');
  const c=value as CollectorConfig;
  if(Object.keys(c).sort().join(',')!=='collectionEnabled,language,namespace,ownerDirectory,schemaVersion,sourcePath,stateDirectory,timezone'||c.schemaVersion!=='1.0'||typeof c.namespace!=='string'||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(c.namespace)||typeof c.collectionEnabled!=='boolean'||!c.language||Object.keys(c.language).join(',')!=='enabled'||typeof c.language.enabled!=='boolean')throw new Error('invalid-config');
  if(c.language.enabled)throw new Error('language-extension-unavailable');
  windowsPath(c.ownerDirectory);windowsPath(c.sourcePath);windowsPath(c.stateDirectory);
  if(!contained(c.ownerDirectory,c.sourcePath)||!contained(c.ownerDirectory,c.stateDirectory)||contained(c.stateDirectory,c.sourcePath)||c.stateDirectory.toLowerCase()===c.sourcePath.toLowerCase())throw new Error('unsafe-path');
  try{if(typeof c.timezone!=='string'||c.timezone.length>80)throw 0;new Intl.DateTimeFormat('en',{timeZone:c.timezone});}catch{throw new Error('invalid-config');}
  return structuredClone(c);
}

// Pass paths as JSON in an environment value, never interpolate them into shell code.
const inspectScript=String.raw`
$ErrorActionPreference='Stop'
try {
  $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $allowed=@($sid,'S-1-5-18','S-1-5-32-544')
  $paths=ConvertFrom-Json $env:BUNNY_WISPR_CHECK_PATHS
  foreach($path in $paths) {
    $drive=New-Object System.IO.DriveInfo([System.IO.Path]::GetPathRoot($path))
    if($drive.DriveType -ne [System.IO.DriveType]::Fixed){throw 'unsafe'}
    $existing=$path
    while(-not (Test-Path -LiteralPath $existing)){$existing=[System.IO.Path]::GetDirectoryName($existing);if(-not $existing){throw 'missing'}}
    $part=$existing
    while($part){
      $item=Get-Item -Force -LiteralPath $part
      if(($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0){throw 'reparse'}
      $parent=[System.IO.Path]::GetDirectoryName($part)
      if($parent -eq $part){break};$part=$parent
    }
    $acl=Get-Acl -LiteralPath $existing
    if($allowed -notcontains $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value){throw 'owner'}
    foreach($rule in $acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])){
      if($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and $allowed -notcontains $rule.IdentityReference.Value -and [int]$rule.FileSystemRights -ne 0){throw 'permission'}
    }
  }
  [Console]::Out.Write('{"ok":true}')
} catch { [Console]::Out.Write('{"ok":false}');exit 1 }
`;

/** Read-only qualification. It never changes the source's ACL or repairs owner paths. */
export function qualifyWindowsPaths(paths: string[]): void {
  if(process.platform!=='win32')throw new Error('unsupported-platform');
  for(const path of paths){
    windowsPath(path);
    for(const env of ['OneDrive','OneDriveConsumer','OneDriveCommercial']){
      const cloud=process.env[env];if(cloud&&(path.toLowerCase()===cloud.toLowerCase()||contained(cloud,path)))throw new Error('unsafe-path');
    }
    for(let part=path;;part=win32.dirname(part)){
      if(existsSync(win32.join(part,'.git')))throw new Error('unsafe-path');
      if(win32.dirname(part)===part)break;
    }
  }
  try{
    const output=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',inspectScript],{encoding:'utf8',timeout:8000,maxBuffer:4096,windowsHide:true,env:{...process.env,BUNNY_WISPR_CHECK_PATHS:JSON.stringify(paths)},stdio:['ignore','pipe','pipe']});
    if(JSON.parse(output).ok!==true)throw new Error('unsafe-private-path');
  }catch{throw new Error('unsafe-private-path');}
}

export function loadConfig(path: string): CollectorConfig {
  qualifyWindowsPaths([path]);
  if(statSync(path).size>16*1024)throw new Error('invalid-config');
  let value:unknown;try{value=JSON.parse(readFileSync(path,'utf8'));}catch{throw new Error('invalid-config');}
  const config=parseConfig(value);
  if(!contained(config.ownerDirectory,path)||contained(config.stateDirectory,path))throw new Error('unsafe-path');
  const paths=[config.sourcePath,config.stateDirectory];
  for(const suffix of ['-wal','-shm'])if(existsSync(config.sourcePath+suffix))paths.push(config.sourcePath+suffix);
  qualifyWindowsPaths(paths);
  return config;
}
