import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'dashboard-widgets-'));
try {
 await build({entryPoints:['apps/dashboard/src/widgets.ts'],bundle:true,platform:'node',format:'esm',outfile:join(dir,'widgets.mjs')});
 const {widgetCatalog,widgetDefinition,homeLayout,invalidPlacements}=await import(join(dir,'widgets.mjs'));
 test('every catalog widget declares an ID, a source kind, the reads it needs, its sizes and whether it commands',()=>{
  const ids=widgetCatalog.map(w=>w.id);
  assert.deepEqual([...new Set(ids)],ids,'IDs are unique');
  for(const w of widgetCatalog){
   assert.match(w.id,/^[a-z0-9-]+$/);
   assert.ok(w.name&&w.description);
   assert.ok(['controller','hub','external'].includes(w.source.kind),w.id);
   assert.ok(w.source.needs.length>0,w.id+' names its reads');
   assert.ok(w.sizes.length>0,w.id+' declares a size');
   assert.equal(typeof w.commands,'boolean');
  }
  assert.equal(widgetDefinition('component-status').source.kind,'controller');
  assert.equal(widgetDefinition('attention').commands,false,'a read-only widget declares no command action');
  assert.equal(widgetDefinition('missing'),undefined);
 });
 test('the home layout places one component widget per registered component, then the hub-wide widgets, at declared sizes',()=>{
  const layout=homeLayout([{id:'wall'},{id:'pixel'},{id:'activity'}]);
  assert.deepEqual(layout.filter(p=>p.widget==='component-status').map(p=>p.instance),['wall','pixel','activity']);
  assert.deepEqual(layout.filter(p=>p.widget!=='component-status').map(p=>p.widget),['sessions','attention']);
  assert.deepEqual(invalidPlacements(layout),[]);
  assert.deepEqual(homeLayout([]).map(p=>p.widget),['sessions','attention'],'no components still leaves the hub-wide widgets');
 });
 test('a placement outside the catalog or at an undeclared size is reported',()=>{
  assert.deepEqual(invalidPlacements([{widget:'graph',size:'small'},{widget:'attention','size':'large'}]),[{widget:'graph',size:'small'},{widget:'attention',size:'large'}]);
 });
} finally {await rm(dir,{recursive:true,force:true});}
