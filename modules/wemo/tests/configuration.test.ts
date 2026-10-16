import assert from 'node:assert/strict';
import {test} from 'node:test';
import {checkConfiguration} from '@jimmie-potts/sdk';
import {createWemoModule} from '../src/module.js';
import {WEMO_SIMULATED_SECTION} from '../src/registration.js';
void test('configuration admits at most two explicit qualified unique plugs and refuses guessing',()=>{
  const manifest=createWemoModule().manifest;
  assert.equal(checkConfiguration(manifest,WEMO_SIMULATED_SECTION).status,'accepted');
  for(const change of [{address:'wemo.local'},{address:'127.0.0.1'},{address:'224.0.0.1'},{port:80},{mac:'unknown'},{model:'Socket'},{firmware:''},{configurationRevision:0},{id:'a.b'},{extra:true}]){
    const config=structuredClone(WEMO_SIMULATED_SECTION);Object.assign(config.plugs[0]??{},change);assert.equal(checkConfiguration(manifest,config).status,'refused',JSON.stringify(change));
  }
  assert.equal(checkConfiguration(manifest,{plugs:[]}).status,'refused');
  const plug=WEMO_SIMULATED_SECTION.plugs[0];assert.equal(checkConfiguration(manifest,{plugs:[plug,plug]}).status,'refused');
});

void test('distinct plugs must also have distinct owner aliases',()=>{
  const config=structuredClone(WEMO_SIMULATED_SECTION);
  assert.ok(config.plugs[0]&&config.plugs[1]);config.plugs[1].label=config.plugs[0].label;
  assert.equal(checkConfiguration(createWemoModule().manifest,config).status,'refused');
});
