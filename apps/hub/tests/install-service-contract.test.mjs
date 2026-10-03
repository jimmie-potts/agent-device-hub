import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('service contract accepts omitted empty environment files and binds a configured list',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'hi-contract-'));
 try{
  const unit=join(directory,'monitor.service');await writeFile(unit,'[Service]\nType=simple\n');
  // systemctl omits an empty EnvironmentFiles array, even with --all.
  await writeFile(join(directory,'systemctl'),'#!/bin/sh\nprintf "%s\\n" "$INSTALL_TEST_PROPERTIES"\n',{mode:0o700});
  const fields={ExecStart:'{ argv[]=/shared/node /shared/hub/dist/cli.js serve /state/host.json ; }',KillMode:'control-group',Type:'simple',CanFreeze:'yes',FreezerState:'running',FragmentPath:unit,DropInPaths:'',Restart:'on-failure',Environment:'',WorkingDirectory:''};
  const run=extra=>spawnSync(process.execPath,['--input-type=module','-e',`
   import {serviceContract} from ${JSON.stringify(new URL('../dist/install/service.js',import.meta.url).href)};
   const result=await serviceContract({node:'/shared/node',entry:'/shared/hub',config:'/state/host.json'});
   console.log(JSON.stringify(result));
  `],{encoding:'utf8',env:{...process.env,PATH:directory,INSTALL_TEST_PROPERTIES:Object.entries({...fields,...extra}).map(([key,value])=>key+'='+value).join('\n')}});
  const omitted=run({});assert.equal(omitted.status,0,omitted.stderr);
  const empty=run({EnvironmentFiles:''});assert.equal(empty.status,0,empty.stderr);
  assert.equal(JSON.parse(omitted.stdout).sha256,JSON.parse(empty.stdout).sha256);
  const configured=run({EnvironmentFiles:'/private/hub.env (ignore_errors=no)'});assert.equal(configured.status,0,configured.stderr);
  assert.notEqual(JSON.parse(configured.stdout).sha256,JSON.parse(empty.stdout).sha256);
  const unsupported=run({CanFreeze:''});assert.notEqual(unsupported.status,0);assert.match(unsupported.stderr,/unknown-install-service-contract/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
