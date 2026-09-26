import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {linesGeometry,panelsGeometry} from './fixture.mjs';
const dir=await mkdtemp(join(tmpdir(),'dashboard-art-'));
const tokens={working:'#00ff00',question:'#ffff00',blocked:'#ff0000',unread:'#193cff'};
try {
 await build({entryPoints:['apps/dashboard/src/art/nanoleaf.ts','apps/dashboard/src/art/prism.ts','apps/dashboard/src/art/panels.ts'],bundle:true,platform:'node',format:'esm',outdir:dir});
 const {prismLayout,panelsLayout,presentation,strip,fallbackReason,geometryRead,elementColors,artMode}=await import(join(dir,'nanoleaf.js'));
 const {validate}=await import(join(dir,'prism.js'));
 const {validatePanels}=await import(join(dir,'panels.js'));
 const lines=linesGeometry(),panels=panelsGeometry();
 const snapshot=(extra={})=>({mode:'Work',settings:{style:'project',coverage:'whole'},projects:[{id:'project-a',color:'#a9c3ff'},{id:'project-b',color:'#ff0000'}],elements:lines.elements.map((e,index)=>({id:e.id,projectId:index===0?'project-a':index===1?'project-b':null,signature:index===1?1:0})),wallPending:null,...extra});
 test('the hub geometry becomes a Prism layout the renderer accepts, with the elements\' numbers and zones',()=>{
  const input=prismLayout(lines);assert.equal(input.nodes.length,12);assert.equal(input.lines.length,15);
  assert.deepEqual(input.lines[0],{id:'101:102',number:1,a:'1',b:'2',zoneIds:[101,102]});
  const layout=validate(input);assert.equal(layout.lines.length,15);assert.equal(layout.roots.length,1,'one connected component');assert.ok(layout.lines.every(l=>l.tubeLength>=40));
  assert.equal(prismLayout({...lines,elements:lines.elements.map(e=>({...e,points:null}))}),undefined,'a layout without drawable points is not drawn');
  assert.equal(prismLayout({...lines,connectors:null}),undefined);assert.equal(prismLayout(panels),undefined);assert.equal(prismLayout(undefined),undefined);
 });
 test('the Panels geometry becomes a triangle layout and the Lines do not',()=>{
  const input=panelsLayout(panels);assert.equal(input.elements.length,18);assert.equal(validatePanels(input).elements.length,18);
  assert.equal(panelsLayout(lines),undefined);assert.equal(panelsLayout({...panels,kind:null,elements:[],connectors:null}),undefined);
  assert.throws(()=>validatePanels({elements:[{id:'a',points:[[0,0],[1,1]]}]}),/three finite corners/);
 });
 test('colors follow the wall map: the status color on both zones, and in the project style the signature zone takes the reservation\'s color',()=>{
  const projects=[{id:'p',color:'#a9c3ff'},{id:'bad',color:'not-a-color'}];
  assert.deepEqual(elementColors({projectId:'p',signature:0},'project',projects,undefined,tokens),['#a9c3ff','#193cff']);
  assert.deepEqual(elementColors({projectId:'p',signature:1},'project',projects,'working',tokens),['#00ff00','#a9c3ff']);
  assert.deepEqual(elementColors({projectId:'p',signature:0},'classic',projects,'blocked',tokens),['#ff0000','#ff0000'],'classic never shows the reservation');
  assert.deepEqual(elementColors({projectId:'bad',signature:0},'project',projects,undefined,tokens),['#193cff','#193cff'],'an invalid project color falls back to the base');
  assert.deepEqual(elementColors({projectId:null,signature:0},'project',projects,undefined,tokens),['#193cff','#193cff'],'the shared pool has no reservation color');
  assert.deepEqual(elementColors(undefined,'project',projects,'question',tokens),['#ffff00','#ffff00']);
 });
 test('presentation carries mode, colors, pending marks, activity and labels for the drawn elements only',()=>{
  const elements=lines.elements.map(e=>({id:e.id,number:e.number}));
  const view=presentation({kind:'lines',elements,snapshot:snapshot({wallPending:{settings:{},elements:[{id:'103:104',projectId:'project-a'},{id:'unknown'}],tasks:[]}}),status:{'101:102':'working','unknown':'blocked'},activity:['101:102','unknown'],tokens});
  assert.equal(view.mode,'work');assert.deepEqual(view.colors.get('101:102'),['#a9c3ff','#00ff00']);assert.deepEqual(view.colors.get('103:104'),['#193cff','#ff0000']);assert.deepEqual(view.colors.get('105:106'),['#193cff','#193cff']);
  assert.deepEqual([...view.pending],['103:104']);assert.deepEqual([...view.activity],['101:102']);
  assert.deepEqual(view.metadata.get('101:102'),{ariaLabel:'Line 1 · Reserved: project-a · working, active',status:'working'});
  assert.deepEqual(view.metadata.get('105:106'),{ariaLabel:'Line 3 · Shared pool · No task shown',status:null});
  assert.equal(view.colors.size,15,'only drawn elements are colored');
  const classic=presentation({kind:'lines',elements,snapshot:snapshot({mode:'Quiet',settings:{style:'classic'}}),tokens});assert.equal(classic.mode,'quiet');assert.deepEqual(classic.metadata.get('101:102'),{ariaLabel:'Line 1 · No task shown',status:null});
  const unknown=presentation({kind:'panels',elements:[{id:'4001',number:1}],snapshot:undefined,tokens});assert.equal(unknown.mode,'free','no snapshot draws dim, not lit');assert.deepEqual(unknown.metadata.get('4001'),{ariaLabel:'Panel 1 · No task shown',status:null});
  assert.equal(artMode('Free'),'free');assert.equal(artMode(undefined),'free');
 });
 test('the schematic strip lists the snapshot\'s elements with the geometry\'s numbers, or the geometry\'s elements without a snapshot',()=>{
  const read={geometry:{...lines,kind:null,elements:[],connectors:null},final:true};
  const cells=strip({read,snapshot:snapshot({wallPending:{settings:{},elements:[{id:'105:106',signature:1}],tasks:[]}}),tokens});
  assert.equal(cells.length,15);assert.deepEqual(cells[0],{id:'101:102',number:1,colors:['#a9c3ff','#193cff'],pending:false,reserved:'project-a',label:'Line 1 · Reserved: project-a · No task shown'});assert.equal(cells[2].pending,true);
  const fromGeometry=strip({read:{geometry:{...lines,elements:lines.elements.map(e=>({...e,points:null}))},final:true},snapshot:undefined,tokens});assert.equal(fromGeometry.length,15);assert.equal(fromGeometry[3].number,4);
  assert.deepEqual(strip({read:undefined,snapshot:undefined,tokens}),[]);
  assert.equal(fallbackReason(undefined),'the layout has not been read yet');assert.equal(fallbackReason({error:'unsupported-capability',final:true}),'the controller predates the geometry route');
  assert.equal(fallbackReason({error:'connection-unavailable',final:false}),'the layout could not be read (connection-unavailable)');assert.equal(fallbackReason(read),'the controller has no saved layout');assert.equal(fallbackReason({geometry:{...lines,elements:lines.elements.map(e=>({...e,points:null}))},final:true}),'the saved layout has no drawable shape');
 });
 test('a geometry read is final for a validated answer, an owner without the route or an incompatible owner, and retried otherwise',()=>{
  assert.deepEqual(geometryRead({geometry:lines}),{geometry:lines,final:true});
  assert.deepEqual(geometryRead({error:'unsupported-capability',status:422}),{error:'unsupported-capability',final:true});
  assert.deepEqual(geometryRead({error:'incompatible-controller',status:502}),{error:'incompatible-controller',final:true});
  assert.deepEqual(geometryRead({error:'capacity',status:429}),{error:'capacity',final:false});assert.deepEqual(geometryRead({error:'connection-unavailable',status:0}),{error:'connection-unavailable',final:false});
 });
 test('the ported validator keeps the wall map\'s layout rules',()=>{
  const ok={version:1,nodes:[{id:'a',x:0,y:0},{id:'b',x:100,y:0},{id:'c',x:150,y:-86.6}],lines:[{id:'ab',a:'a',b:'b'},{id:'bc',a:'b',b:'c'}]};
  const layout=validate(ok);assert.equal(layout.lines.length,2);assert.deepEqual(layout.rootIds,['b'],'the most connected junction is the root');assert.equal(layout.lines[0].colors.length,2);
  assert.throws(()=>validate({...ok,version:2}),/version 1/);
  assert.throws(()=>validate({...ok,nodes:[{id:'a',x:0,y:0},{id:'b',x:100,y:0},{id:'c',x:130,y:-40}],lines:[{id:'ab',a:'a',b:'b'},{id:'bc',a:'b',b:'c'}]}),/six flat faces/);
  assert.throws(()=>validate({...ok,lines:[{id:'ab',a:'a',b:'b'},{id:'ab',a:'b',b:'c'}]}),/unique, stable ID/);
  assert.throws(()=>validate({...ok,lines:[{id:'ab',a:'a',b:'b'},{id:'bc',a:'b',b:'c',colors:['#fff','#000000']}]}),/six-digit hex/);
  assert.throws(()=>validate({...ok,nodes:[...ok.nodes,{id:'d',x:900,y:900}]}),/connectors that have no Lines/);
 });
}finally{await rm(dir,{recursive:true,force:true});}
