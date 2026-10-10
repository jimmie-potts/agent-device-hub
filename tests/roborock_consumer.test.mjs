import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Ajv2020} from 'ajv/dist/2020.js';
import {checkManifest,checkConfiguration} from '@jimmie-potts/sdk';
import {registration,statusSchema,runsSchema,runDocumentSchema,samplesSchema} from '@jimmie-potts/roborock';
import {emptyStatus} from '../modules/roborock/dist/src/contracts.js';
import {frontendSource,registrySource} from '../apps/runtime/dist/build/registry.js';
void test('shipped module exports load and synthetic/real settings admit no path publication',()=>{
 const real=registration.create(),synthetic=registration.simulate();
 assert.equal(checkManifest(real.manifest),undefined);
 assert.equal(checkConfiguration(real.manifest,undefined).status,'refused');
 assert.equal(checkConfiguration(real.manifest,{id:'vacuum'}).status,'refused');
 const checked=checkConfiguration(synthetic.manifest,{id:'vacuum'});assert.equal(checked.status,'accepted');assert.deepEqual(checked.config,{id:'vacuum'});
 assert.equal(registration.shipped,true);assert.deepEqual(real.manifest.tools.map(t=>t.name),['status']);assert.deepEqual(real.manifest.pages.map(p=>p.id),['status']);assert.equal(real.refreshForTest,undefined);
 assert.ok(registrySource(process.cwd()).includes('from "@jimmie-potts/roborock"'));
 const frontend=frontendSource(process.cwd());assert.ok(frontend.includes('@jimmie-potts/roborock/frontend'));assert.equal(frontend.includes('roborock-transport'),false);
});
void test('MCP and standalone consumers compile all selected schemas without an external registry',()=>{
 const ajv=new Ajv2020({strict:true});const valid=ajv.compile(statusSchema);assert.equal(valid(emptyStatus('vacuum')),true);assert.equal(valid({...emptyStatus('vacuum'),target:'/private'}),false);
 for(const schema of[runsSchema,runDocumentSchema,samplesSchema])assert.equal(typeof ajv.compile(schema),'function');
 const tool=registration.create().manifest.tools[0];assert.equal(ajv.compile(tool.output)(emptyStatus('vacuum')),true);
});
