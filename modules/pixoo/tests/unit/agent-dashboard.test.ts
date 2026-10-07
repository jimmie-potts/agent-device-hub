import {expect,it} from 'vitest';
import type {MonitorSession,MonitorView} from '../../src/presentation/sources.js';
import {DashboardPager,shortLabel,shortSessionId} from '../../src/presentation/agent-dashboard.js';
import {present} from '../helpers/present.js';

export function session(id:string,patch:Partial<MonitorSession>={}):MonitorSession {
 return {identity:{provider:'codex',client:'cli',hostId:'h',sourceId:'s',sessionId:id},turn:{status:'unknown'},parent:{status:'top-level'},activity:'active',attention:[],notices:[],read:'unknown',unavailable:[],ordering:{status:'unknown'},lastEvidenceAtMs:1000,observedAtMs:1000,freshness:'current',restartUncertain:false,children:{active:0,uncertain:0},...patch};
}
export function view(sessions:MonitorSession[]):MonitorView {
 return {connection:'current',snapshot:{revision:1,collector:'running',sessions}};
}
/** The view's snapshot, which every view these tests change has. */
const snapshotOf=(state:MonitorView)=>present(state.snapshot,'the snapshot');
const firstSession=(state:MonitorView)=>present(snapshotOf(state).sessions[0],'the first session');
it('prioritizes blocking attention before continuing questions, keeps stable rows and excludes known children',()=>{
 const attention=(kind:'input'|'question')=>[{kind,id:{status:'unknown'} as const,turn:{status:'unknown'} as const}];
 const sessions=[session('z'),session('b',{attention:attention('question')}),session('c',{attention:attention('input')}),session('a'),session('child',{parent:{status:'known',identity:session('a').identity}})];
 const pager=new DashboardPager();
 const order=(pager:DashboardPager,state:MonitorView)=>[0,10000,20000,30000].map(at=>pager.layout(state,at).rows.map(row=>row.identity.sessionId).join(''));
 expect(order(pager,view(sessions))).toEqual(['c','b','a','z']);
 expect(pager.layout(view(sessions),0)).toMatchObject({pages:4,attentionTotal:2});
 const second=new DashboardPager();second.layout(view(sessions),0);
 expect(second.layout(view(sessions),10000).rows[0]).toMatchObject({activity:'active',attention:'question'});
 expect(order(new DashboardPager(),view([...sessions].reverse()))).toEqual(['c','b','a','z']);
});

it('shows one session per page, rotates at ten seconds, skips elapsed intervals and clamps when filters or sessions change',()=>{
 const pager=new DashboardPager(),state=view(Array.from({length:9},(_,i)=>session(String(i))));
 expect(pager.layout(state,0)).toMatchObject({page:0,pages:9,matched:9});
 expect(pager.layout(state,0).rows.map(row=>row.identity.sessionId)).toEqual(['0']);
 expect(pager.layout(state,9999).page).toBe(0);
 expect(pager.layout(state,10000).rows.map(row=>row.identity.sessionId)).toEqual(['1']);
 expect(pager.layout(state,20000).rows).toHaveLength(1);
 expect(pager.layout(state,40000).page).toBe(4);
 expect(pager.layout(state,41000,{q:'0'})).toMatchObject({page:0,pages:1,matched:1,total:9});
 expect(pager.layout(view([]),42000)).toMatchObject({page:0,pages:1,rows:[]});
});
it('keeps notices consumer-specific, full labels and timestamps, and health dimensions separate',()=>{
 const state=view([session('a',{label:'résumé-long',notices:[{id:'n',kind:'turn-ended',turn:{status:'unknown'},acknowledgedBy:['other']}],children:{active:2,uncertain:1}})]);
 state.connection='stale';const layout=new DashboardPager().layout(state,0);
 expect(layout).toMatchObject({connection:'stale',collector:'running'});
 expect(layout.rows[0]).toMatchObject({label:'résumé-long',shortLabel:'RESUME-LONG',noticeIds:['n'],activeChildren:2,childrenUncertain:true,uncertain:true,observedAtMs:1000});
 present(firstSession(state).notices[0]).acknowledgedBy.push('pixoo');
 expect(new DashboardPager().layout(state,0).rows[0]?.noticeIds).toEqual([]);
});
type Frame=Uint8Array;
const lit=(frame:Frame,x0:number,y0:number,x1:number,y1:number)=>{const bits=[];for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)bits.push(((frame[(y*64+x)*3]??0)|(frame[(y*64+x)*3+1]??0)|(frame[(y*64+x)*3+2]??0))!==0?'1':'0');return bits.join('');};
const differs=(a:Frame,b:Frame)=>{const out:Array<[number,number]>=[];for(let i=0;i<4096;i++)if(a[i*3]!==b[i*3]||a[i*3+1]!==b[i*3+1]||a[i*3+2]!==b[i*3+2])out.push([i%64,Math.floor(i/64)]);return out;};
async function renderOne(patch:Partial<MonitorSession>={},change:(state:MonitorView)=>void=()=>{}){
 const {renderDashboard}=await import('../../src/presentation/dashboard-pixels.js');
 const state=view([session('a',{label:'Build',turn:{status:'known',id:'t'},ordering:{status:'known',authority:'s',epoch:'e',sequence:1},...patch})]);change(state);
 const layout=new DashboardPager().layout(state,0);
 return {layout,frames:renderDashboard(layout)};
}
const ask=(kind:'approval'|'input'|'question')=>({attention:[{kind,id:{status:'unknown'} as const,turn:{status:'unknown'} as const}]});
it('renders exact RGB frames, independently of caller mutation',async()=>{
 const {renderDashboard}=await import('../../src/presentation/dashboard-pixels.js');
 const layout=new DashboardPager().layout(view([session('a')]),0);
 const frames=renderDashboard(layout);
 expect(frames).toHaveLength(1);expect(frames[0]).toHaveLength(12288);
 expect(frames).toEqual(renderDashboard(layout));
 present(frames[0]).fill(0);expect(present(renderDashboard(layout)[0]).some(v=>v!==0)).toBe(true);
});
it('distinguishes every activity, attention, provider and notice state by shape or words, not only colour',async()=>{
 const tiles=new Set<string>(),words=new Set<string>();
 for(const activity of ['unknown','active','idle','interrupted','ended'] as const){
  const [frame]=(await renderOne({activity})).frames;
  tiles.add(lit(present(frame),7,7,13,13));words.add(lit(present(frame),33,3,62,7));
 }
 expect(tiles.size).toBe(5);expect(words.size).toBe(5);
 const chips=new Set<string>();
 for(const kind of ['approval','input','question'] as const)chips.add(lit(present((await renderOne(ask(kind))).frames[0]),24,12,62,20));
 const notice=lit(present((await renderOne({notices:[{id:'n',kind:'turn-ended',turn:{status:'unknown'},acknowledgedBy:[]}]})).frames[0]),24,12,62,20);
 const plain=lit(present((await renderOne()).frames[0]),24,12,62,20);
 expect(new Set([...chips,notice,plain]).size).toBe(5);
 const providers=new Set<string>();
 for(const provider of ['codex','claude'] as const)providers.add(lit(present((await renderOne({},state=>{firstSession(state).identity.provider=provider;})).frames[0]),24,2,30,8));
 expect(providers.size).toBe(2);
});
it('pulses only a session that needs attention, dimming just its tile and chip in the second frame',async()=>{
 for(const kind of ['approval','input','question'] as const){
  const {frames}=await renderOne(ask(kind));
  expect(frames).toHaveLength(2);
  const changed=differs(present(frames[0]),present(frames[1]));
  expect(changed.length).toBeGreaterThan(0);
  expect(changed.every(([x,y])=>(x>=1&&x<=20&&y>=1&&y<=20)||(x>=24&&x<=62&&y>=12&&y<=20))).toBe(true);
 }
 for(const activity of ['active','idle','interrupted','ended','unknown'] as const)expect((await renderOne({activity})).frames).toHaveLength(1);
 // Attention elsewhere keeps the shown session and the steady total still.
 const {renderDashboard}=await import('../../src/presentation/dashboard-pixels.js');
 const pager=new DashboardPager(),state=view([session('a',ask('approval')),session('b')]);pager.layout(state,0);
 const layout=pager.layout(state,10000);
 expect(layout).toMatchObject({attentionTotal:1,rows:[{attention:'none'}]});
 expect(renderDashboard(layout)).toHaveLength(1);
});
it('spells out uncertainty and dims the label instead of a trailing symbol',async()=>{
 const certain=present((await renderOne()).frames[0]),uncertain=present((await renderOne({freshness:'uncertain'})).frames[0]);
 expect(lit(certain,39,45,62,49)).not.toContain('1');
 expect(lit(uncertain,39,45,62,49)).toContain('1');
 const label=(frame:Frame)=>Array.from(frame.slice((26*64+2)*3,(33*64+62)*3)).reduce((a,b)=>Math.max(a,b),0);
 expect(label(uncertain)).toBeLessThan(label(certain));
});
it('shows subagents, and keeps the summary and separate source and collector health on every page, including an empty one',async()=>{
 const {renderDashboard}=await import('../../src/presentation/dashboard-pixels.js');
 expect(lit(present((await renderOne()).frames[0]),2,45,33,49)).not.toContain('1');
 expect(lit(present((await renderOne({children:{active:3,uncertain:0}})).frames[0]),2,45,33,49)).toContain('1');
 const sources=new Set<string>(),collectors=new Set<string>();
 for(const connection of ['current','stale','unavailable'] as const)sources.add(lit(present((await renderOne({},state=>{state.connection=connection;})).frames[0]),52,56,56,60));
 for(const collector of ['running','quiesced','faulted','closed'] as const)collectors.add(lit(present((await renderOne({},state=>{snapshotOf(state).collector=collector;})).frames[0]),58,56,62,60));
 const none=view([]);none.connection='unavailable';none.snapshot=null;
 const empty=renderDashboard(new DashboardPager().layout(none,0));
 expect(empty).toHaveLength(1);
 collectors.add(lit(present(empty[0]),58,56,62,60));
 expect([sources.size,collectors.size]).toEqual([3,5]);
 expect(lit(present(empty[0]),0,14,63,31)).toContain('1');
 expect(lit(present(empty[0]),0,56,50,60)).toContain('1');
 // Page dots up to eight pages, then a numeric position.
 const many=(n:number)=>present(renderDashboard(new DashboardPager().layout(view(Array.from({length:n},(_,i)=>session(String(i)))),0))[0]);
 expect(lit(many(8),26,56,49,60)).not.toEqual(lit(many(9),26,56,49,60));
 expect(lit(many(2),26,56,49,56)).toBe('0'.repeat(24));
});
it('covers every legend state in the synthetic examples and matches their frame hashes',async()=>{
 const {createHash}=await import('node:crypto');
 const {syntheticDashboardRenditions}=await import('../../src/presentation/dashboard-examples.js');
 const cases=syntheticDashboardRenditions(),rows=cases.flatMap(c=>c.rendition.layout.rows),layouts=cases.map(c=>c.rendition.layout);
 expect(new Set(rows.map(row=>row.identity.provider))).toEqual(new Set(['codex','claude']));
 expect(new Set(rows.map(row=>row.activity))).toEqual(new Set(['active','idle','interrupted','ended','unknown']));
 expect(new Set(rows.map(row=>row.attention))).toEqual(new Set(['approval','input','question','none']));
 expect(rows.some(row=>row.noticeIds.length>0&&row.attention==='none')).toBe(true);
 expect(rows.some(row=>row.activeChildren>9&&row.childrenUncertain)).toBe(true);
 expect(new Set(rows.map(row=>row.uncertain))).toEqual(new Set([true,false]));
 expect(new Set(layouts.map(layout=>layout.connection))).toEqual(new Set(['current','stale','unavailable']));
 expect(new Set(layouts.map(layout=>layout.collector))).toEqual(new Set(['running','quiesced','faulted','closed','unknown']));
 expect(layouts.some(layout=>layout.rows.length===0)).toBe(true);
 expect(layouts.some(layout=>layout.pages>8)).toBe(true);
 expect(cases.map(c=>c.rendition.frames.length)).toEqual([2,2,2,1,1,1,1,1,1,1,1,1,1,1,1,2]);
 for(const c of cases)expect(c.rendition.rgb).toEqual(c.rendition.frames[0]);
 expect(cases.map(c=>c.rendition.frames.map(frame=>createHash('sha256').update(new Uint8Array(frame)).digest('hex').slice(0,16)).join(' '))).toEqual([
  'd17b4eff2ddfa03d 120e94276ae78ec2',
  '98e1146603fba33f 5ff602a38c54257e',
  'd1b97446ab602ce0 d1694b5080644fe4',
  '428b62f6b5e41da9',
  '20c1d501a9b49f72',
  '988bfd52edc1dc33',
  '37159be9fd7d6231',
  '296eec01f405f193',
  'b5db73a84fb91eeb',
  'e647a684ad3cd44a',
  '52d07ec1c0a0ff50',
  'd4bccd3803d166b6',
  '94293ef42bd5c839',
  '8049586657dfe10e',
  '462e424af084472d',
  'aab42864520804b9 7fe1b2c9d92c799d'
 ]);
 const projected=(row:{project?:string})=>row.project!==undefined&&row.project!=='';
 expect(rows.some(row=>row.title!==undefined&&!projected(row)&&row.label===row.title.value)).toBe(true);
 expect(rows.some(row=>projected(row)&&row.label==='Owner choice'&&row.title?.value==='Résumé monitor')).toBe(true);
 expect(rows.some(row=>projected(row)&&row.label===row.title?.value)).toBe(true);
 for(const project of [true,false])for(const uncertain of [true,false])expect(rows.some(row=>projected(row)===project&&row.uncertain===uncertain&&row.unavailable.some(e=>e.dimension==='ordering'&&e.reason==='missing'))).toBe(true);
 expect(layouts[1]).toMatchObject({attentionTotal:3,page:1,rows:[{attention:'input'}]});
});
const sharedPrefix=['01a0d3e2-7c4b-7f10-9a3e-5b1c2d4e8f01','01a0d3e2-7c4b-7f10-b1c4-02d9e6a7c3b2','01a0d3e2-91f0-7a22-8d05-c7e3f1a09d43','01a0d3e4-0b6a-7c31-a7f2-4e8b9c2d1f54'];
const tails=['…0-9A3E-5B1C2D4E8F01','…0-B1C4-02D9E6A7C3B2','…2-8D05-C7E3F1A09D43','…1-A7F2-4E8B9C2D1F54'];
it('shows the distinguishing end of unlabeled session IDs and both ends of long labels at the 20-character width',()=>{
 expect(sharedPrefix.map(shortSessionId)).toEqual(tails);
 const pager=new DashboardPager(),state=view(sharedPrefix.map(id=>session(id)));
 const rows=[0,10000,20000,30000].map(at=>present(pager.layout(state,at).rows[0]));
 expect(rows.map(row=>row.shortLabel)).toEqual(tails);
 expect(rows.map(row=>row.label)).toEqual(sharedPrefix);
 expect(shortLabel('resume-long-running-migration-7')).toBe('RESUME-LON…GRATION-7');
 expect(shortLabel('resume-long-running-migration-8')).toBe('RESUME-LON…GRATION-8');
 expect(shortLabel('pixoo-layout-redesign')).toBe('PIXOO-LAYO…-REDESIGN');
 expect(new DashboardPager().layout(view([session('b',{label:'pixoo-layout-98'})]),0).rows[0]).toMatchObject({label:'pixoo-layout-98',shortLabel:'PIXOO-LAYOUT-98'});
 expect([shortLabel('a'.repeat(20)),shortSessionId('s1')]).toEqual(['A'.repeat(20),'S1']);
 expect([shortLabel('a…b'),shortLabel('ab…cdefghijklmnopqrstu'),shortSessionId('x…y')]).toEqual(['A?B','AB?CDEFGHI…MNOPQRSTU','X?Y']);
});
it('wraps identifiers into two lines of ten at a separator when the rest fits, otherwise at ten',async()=>{
 const {identifierLines}=await import('../../src/presentation/dashboard-pixels.js');
 expect(identifierLines('BUILD')).toEqual(['BUILD']);
 expect(identifierLines('PIXOO-LAYOUT-98')).toEqual(['PIXOO-','LAYOUT-98']);
 expect(identifierLines('FIX THE BUILD')).toEqual(['FIX THE','BUILD']);
 expect(identifierLines('RESUME-LON…GRATION-7')).toEqual(['RESUME-LON','…GRATION-7']);
 expect(identifierLines('…0-9A3E-5B1C2D4E8F01')).toEqual(['…0-9A3E-5B','1C2D4E8F01']);
 expect(identifierLines('ABCDEFGHIJKLMNOP')).toEqual(['ABCDEFGHIJ','KLMNOP']);
});
it('draws labels in a 5x7 alphabet with its own truncation marker outside the label alphabet',async()=>{
 const {glyphs,markerGlyphs,largeGlyphs,largeMarkerGlyphs}=await import('../../src/presentation/pixel-font.js');
 const {renderDashboard}=await import('../../src/presentation/dashboard-pixels.js');
 expect(Object.keys(markerGlyphs)).toEqual(['…']);
 expect(Object.hasOwn(glyphs,'…')).toBe(false);
 expect(Object.values(glyphs)).not.toContain(markerGlyphs['…']);
 const labelAlphabet=[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ._+!?/-'];
 expect(Object.keys(largeGlyphs).sort()).toEqual([...labelAlphabet].sort());
 expect(Object.keys(largeMarkerGlyphs)).toEqual(['…']);
 expect(Object.values(largeGlyphs)).not.toContainEqual(largeMarkerGlyphs['…']);
 expect(new Set(Object.values(largeGlyphs).map(glyph=>glyph.join(''))).size).toBe(labelAlphabet.length);
 const cell=(frame:Uint8Array,x:number,y:number)=>{const rows=[];for(let dy=0;dy<7;dy++){let row='';for(let dx=0;dx<5;dx++)row+=frame[((y+dy)*64+x+dx)*3]!==0?'#':'.';rows.push(row);}return rows;};
 const frame=present(renderDashboard(new DashboardPager().layout(view([session(present(sharedPrefix[0]))]),0))[0]);
 expect(cell(frame,2,26)).toEqual(largeMarkerGlyphs['…']);
 expect(cell(frame,8,26)).toEqual(largeGlyphs['0']);
 expect(cell(frame,2,35)).toEqual(largeGlyphs['1']);
});
it('uses label then shared title then distinct ID tails, and folds accents before truncation',()=>{
 const state=view([session('a',{title:{value:'Résumé café',source:'provider'},project:'DIVOOM-APP-UPGRADE'})]);
 expect(new DashboardPager().layout(state,0).rows[0]).toMatchObject({label:'Résumé café',shortLabel:'RESUME CAFE',title:{value:'Résumé café',source:'provider'},project:'DIVOOM-APP-UPGRADE'});
 firstSession(state).label='Owner choice';
 expect(new DashboardPager().layout(state,0).rows[0]).toMatchObject({label:'Owner choice',shortLabel:'OWNER CHOICE'});
 expect(new DashboardPager().layout(state,0,{q:'café'}).matched).toBe(1);
 expect(new DashboardPager().layout(state,0,{q:'divoom'}).matched).toBe(1);
 expect(shortLabel('résumé-café')).toBe('RESUME-CAFE');
});
it('places project below the title and moves details above it without overlapping ink or changing pulse',async()=>{
 const {drawText}=await import('../../src/presentation/pixel-font.js');
 const {frames}=await renderOne({title:{value:'Résumé monitor',source:'provider'},project:'DIVOOM-APP-UPGRADE',freshness:'uncertain',children:{active:2,uncertain:0},...ask('approval')});
 const expected=new Uint8Array(12288);drawText(expected,'DIVOOM-…UPGRADE',2,45,[70,170,220]);
 expect(lit(present(frames[0]),0,45,63,49)).toBe(lit(expected,0,45,63,49));
 expect(lit(present(frames[0]),2,21,30,25)).toContain('1');
 expect(lit(present(frames[0]),40,21,63,25)).toContain('1');
 expect(lit(present(frames[0]),0,26,63,26)).not.toContain('1');
 expect(lit(present(frames[0]),0,43,63,44)).not.toContain('1');
 expect(lit(present(frames[0]),33,3,62,7)).toContain('1');
 expect(frames).toHaveLength(2);
 expect(differs(present(frames[0]),present(frames[1])).every(([x,y])=>(x>=1&&x<=20&&y>=1&&y<=20)||(x>=24&&x<=62&&y>=12&&y<=20))).toBe(true);
});

it('does not warn solely for routine missing ordering and preserves the complete evidence',()=>{
 const state=view([session('a',{turn:{status:'known',id:'t'},unavailable:[{dimension:'ordering',reason:'missing'}]})]);
 const before=structuredClone(state),row=present(new DashboardPager().layout(state,0).rows[0]);
 expect(row.uncertain).toBe(false);
 expect(row.unavailable).toEqual(firstSession(before).unavailable);
 expect(state).toEqual(before);
 row.unavailable.length=0;
 expect(state).toEqual(before);
});

const evidencePolicy=[
 ['ordering','missing',false],['ordering','unsupported',false],['ordering','inaccessible',false],['ordering','ambiguous',true],['ordering','lost',true],
 ['read','missing',false],['read','unsupported',false],['read','inaccessible',false],['read','ambiguous',true],['read','lost',true],
 ...(['activity','attention','turn','parent'] as const).flatMap(dimension=>(['missing','unsupported','inaccessible','ambiguous','lost'] as const).map(reason=>[dimension,reason,true] as const)),
] as const;
it.each(evidencePolicy)('applies the approved %s / %s uncertainty policy (%s)',(dimension,reason,uncertain)=>{
 const item=session('a',{turn:{status:'known',id:'t'},ordering:{status:'known',authority:'s',epoch:'e',sequence:1},unavailable:[{dimension,reason}]});
 const state=view([item]),before=structuredClone(state),row=present(new DashboardPager().layout(state,0).rows[0]);
 expect(row.uncertain).toBe(uncertain);
 expect(row.unavailable).toEqual(item.unavailable);
 expect(state).toEqual(before);
});
it('keeps unknown ordering and optional read separate from unknown turn and other state warnings',()=>{
 const certain:Partial<MonitorSession>={turn:{status:'known',id:'t'},ordering:{status:'known',authority:'s',epoch:'e',sequence:1}};
 for(const patch of [{},{ordering:{status:'unknown'}},{read:'unknown'}] as Partial<MonitorSession>[])
  expect(present(new DashboardPager().layout(view([session('a',{...certain,...patch})]),0).rows[0]).uncertain).toBe(false);
 for(const patch of [{turn:{status:'unknown'}},{activity:'unknown'},{parent:{status:'unknown'}},{freshness:'uncertain'}] as Partial<MonitorSession>[])
  expect(present(new DashboardPager().layout(view([session('a',{...certain,...patch})]),0).rows[0]).uncertain).toBe(true);
 for(const connection of ['stale','unavailable'] as const){const state=view([session('a',certain)]);state.connection=connection;expect(present(new DashboardPager().layout(state,0).rows[0]).uncertain).toBe(true);}
});
it.each([undefined,'DIVOOM'])('keeps warning words and label dimming accurate with project %s',async(project)=>{
 const {drawText}=await import('../../src/presentation/pixel-font.js');
 const patch={...(project===undefined?{}:{project}),ordering:{status:'unknown'} as const};
 const baseline=present((await renderOne(patch)).frames[0]);
 const routine=present((await renderOne({...patch,unavailable:[{dimension:'ordering',reason:'missing'},{dimension:'read',reason:'unsupported'}]})).frames[0]);
 expect(routine).toEqual(baseline);
 const y=project===undefined?45:21,titleY=project===undefined?26:27;
 expect(lit(routine,40,y,63,y+4)).not.toContain('1');
 const expected=new Uint8Array(12288);drawText(expected,'UNSURE',40,y,[1,1,1]);
 for(const dimension of ['ordering','read'] as const)for(const reason of ['ambiguous','lost'] as const){
  const warning=present((await renderOne({...patch,unavailable:[{dimension,reason}]})).frames[0]);
  expect(lit(warning,40,y,63,y+4)).toBe(lit(expected,40,y,63,y+4));
  let labelPixels=0;
  for(let dy=0;dy<7;dy++)for(let x=2;x<32;x++){const i=((titleY+dy)*64+x)*3;const lit=routine[i]??0;if(lit!==0){labelPixels++;expect(warning[i]).toBeLessThan(lit);expect(warning[i]).toBeGreaterThan(0);}}
  expect(labelPixels).toBeGreaterThan(0);
 }
});
