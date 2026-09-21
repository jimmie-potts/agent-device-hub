import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validateRequest,configurationResult} from '../dist/vendor/nanoleaf-integration.js';
import {validateIntegrationSnapshot,validateIntegrationReceipt} from '../dist/integration.js';

test('pinned Nanoleaf request fixtures and configuration-only outcomes',async()=>{
  const pin=JSON.parse(await readFile(new URL('../fixtures/nanoleaf-source.json',import.meta.url),'utf8'));
  for(const [path,hash] of Object.entries(pin.files)) assert.equal(createHash('sha256').update(await readFile(new URL('../'+path.replace(/^apps\/hub\//,''),import.meta.url))).digest('hex'),hash);
  const cases=JSON.parse(await readFile(new URL('../fixtures/nanoleaf-integration.json',import.meta.url),'utf8'));
  for(const c of cases.requests) assert.equal(validateRequest(c.request),c.valid,c.name);
  for(const c of cases.receipts) assert.equal(configurationResult(c.receipt),c.result,c.name);
});

export const snapshot={apiVersion:'nanoleaf.integration/1.0',identity:{controllerId:'controller',deviceId:'device',sourceId:'source',controllerEpoch:'epoch'},
 configurationRevision:0,revision:'b'.repeat(64),mode:'Work',settings:{style:'classic',coverage:'whole'},source:'legacy',projects:[],tasks:[],elements:[],wallPending:null,
 pending:[],outcomes:[],nextRequestId:{epoch:'a'.repeat(32),sequence:0},
 capabilities:Object.fromEntries(['settings.set','elements.assign','task.assign','project.color','mode.set'].map(k=>[k,{supported:true,scope:'control',...(k==='mode.set'?{route:'/controller/v1/commands'}:{})}])),
 limits:{maxItems:1000,maxPending:1,maxReceipts:256,maxBodyBytes:65536}};

test('integration projection rejects unexpected private data and invalid receipts',()=>{
 assert.equal(validateIntegrationSnapshot(snapshot),true);
 assert.equal(validateIntegrationSnapshot({...snapshot,token:'PRIVATE_CANARY'}),false);
 assert.equal(validateIntegrationSnapshot({...snapshot,projects:[{id:'project-'+'a'.repeat(64),color:'#ffffff',title:'PRIVATE_CANARY'}]}),false);
 assert.equal(validateIntegrationReceipt({apiVersion:'nanoleaf.integration/1.0',requestId:snapshot.nextRequestId,outcome:'applied',priorEffects:'configuration',physicalOutcome:'unknown'}),true);
 assert.equal(validateIntegrationReceipt({apiVersion:'nanoleaf.integration/1.0',requestId:snapshot.nextRequestId,outcome:'applied',priorEffects:'none',physicalOutcome:'sent'}),false);
});
