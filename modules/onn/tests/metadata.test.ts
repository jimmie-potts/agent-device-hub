import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseMetadataReply, validateMetadataSample, type MetadataSample} from '../src/metadata.js';
const empty = (): MetadataSample => ({schema:'onn-metadata/2.0',deviceElapsedMs:42,sessions:[]});
void test('selected empty sample is valid and validator returns a fresh projection', () => {
 const value=empty(); const projected=validateMetadataSample(value);
 assert.deepEqual(projected,value); assert.notEqual(projected,value); assert.notEqual(projected?.sessions,value.sessions);
 assert.deepEqual(parseMetadataReply(JSON.stringify(value)+'\n',0,''),value);
});
const selected = (): MetadataSample => ({...empty(),sessions:[{app:'youtube',metadata:{title:'Synthetic title',displayTitle:null,subtitle:null,artist:'Synthetic channel',album:null,genre:null,description:null,mediaId:null,durationMs:null},playback:{state:3,positionMs:-1,speed:-1,positionUpdatedElapsedMs:40},omissions:[]}]});
const first = (sample:MetadataSample) => {const value=sample.sessions[0];assert.ok(value);return value;};
const reply = (value:unknown) => JSON.stringify(value)+'\n';
void test('both apps, nulls, Unicode, ordinary URLs and unknown identity remain source values', () => {
 const value=selected();first(value).app='stremio';const metadata=first(value).metadata;assert.ok(metadata);
 metadata.title='Bearer of good news; token economics; "界 😀"\n\\';metadata.mediaId='https://example.test/title?id=abc';metadata.durationMs=0;
 assert.deepEqual(parseMetadataReply(reply(value),0,''),value);
 first(value).metadata=null;first(value).playback=null;assert.deepEqual(validateMetadataSample(value),value);
});
void test('closed objects, numeric ranges, array limits and exact omission pairs are enforced', () => {
 const cases:Array<(sample:MetadataSample)=>unknown>=[
 value=>({...value,extra:'unexpected'}),value=>({...value,deviceElapsedMs:-1}),value=>({...value,deviceElapsedMs:Number.MAX_SAFE_INTEGER+1}),
 value=>({...value,sessions:Array.from({length:9},()=>first(value))}),value=>({...value,sessions:[{...first(value),app:'other'}]}),
 value=>({...value,sessions:[{...first(value),metadata:{...first(value).metadata,uri:'unexpected'}}]}),
 value=>({...value,sessions:[{...first(value),metadata:{...first(value).metadata,title:'界'.repeat(2731)}}]}),
 value=>({...value,sessions:[{...first(value),metadata:{...first(value).metadata,title:'\ud800'}}]}),
 value=>({...value,sessions:[{...first(value),metadata:{...first(value).metadata,durationMs:-1}}]}),
 value=>({...value,sessions:[{...first(value),metadata:{...first(value).metadata,durationMs:true}}]}),
 ...[12,-1,1.5].map(state=>(value:MetadataSample)=>({...value,sessions:[{...first(value),playback:{...first(value).playback,state}}]})),
 ...[-2,Number.MAX_SAFE_INTEGER+1].map(positionMs=>(value:MetadataSample)=>({...value,sessions:[{...first(value),playback:{...first(value).playback,positionMs}}]})),
 ...[NaN,Infinity].map(speed=>(value:MetadataSample)=>({...value,sessions:[{...first(value),playback:{...first(value).playback,speed}}]})),
 value=>({...value,sessions:[{...first(value),playback:{...first(value).playback,positionUpdatedElapsedMs:-1}}]}),
 value=>({...value,sessions:[{...first(value),omissions:[{field:'title',reason:'unknown'}]}]}),
 value=>({...value,sessions:[{...first(value),omissions:[{field:'uri',reason:'oversized'}]}]}),
 value=>({...value,sessions:[{...first(value),omissions:[{field:'title',reason:'oversized'},{field:'title',reason:'oversized'}]}]}),
 ];
 for(const transform of cases)assert.equal(validateMetadataSample(transform(selected())),undefined);
 const value=selected(), metadata=first(value).metadata;assert.ok(metadata);metadata.title='x'.repeat(8192);
 assert.ok(validateMetadataSample(value));
 for(const field of Object.keys(metadata))if(field!=='durationMs')Reflect.set(metadata,field,'x'.repeat(8192));
 value.sessions=Array.from({length:8},()=>first(value));assert.equal(validateMetadataSample(value),undefined);
});
void test('reply channel accepts one complete newline-terminated result and suppresses failures', () => {
 const value=selected(), wire=reply(value);
 for(const stdout of [wire.slice(0,-1),wire+'\n',wire.replace(/\n$/,'\r\n'),'startup\n'+wire,wire+wire,'not JSON\n',JSON.stringify({...value,sessions:null})+'\n'])
  assert.equal(parseMetadataReply(stdout,0,''),undefined);
 for(const exit of [1,2,NaN])assert.equal(parseMetadataReply(wire,exit,''),undefined);
 assert.equal(parseMetadataReply(wire,0,'PRIVATE ERROR'),undefined);
 assert.equal(parseMetadataReply('{"schema":"onn-metadata/2.0","failure":"metadata-read-unavailable"}\n',2,''),undefined);
 assert.equal(parseMetadataReply(wire.replace('"deviceElapsedMs":42','"deviceElapsedMs":42,"deviceElapsedMs":43'),0,''),undefined);
});
void test('recognized credentials are narrowly redacted and omissions stay idempotent', () => {
 const cases:ReadonlyArray<readonly [string,string]>=[
 ['Authorization: Bearer abc end','Authorization: Bearer [REDACTED] end'],
 ['Bearer abcSecret.123 finish','Bearer [REDACTED] finish'],
 ['hello password="synthetic secret" goodbye','hello password=[REDACTED] goodbye'],
 ['https://bob:synthetic@example.test/view?access%5Ftoken=synthetic&v=abc#chapter','https://[REDACTED]@example.test/view?access%5Ftoken=[REDACTED]&v=abc#chapter'],
 ['https://example.test/view?token=synthetic#chapter','https://example.test/view?token=[REDACTED]#chapter'],
 ['before https://example.test/callback#access_token=synthetic&chapter=2 after','before https://example.test/callback#access_token=[REDACTED]&chapter=2 after'],
 ['https://example.test/view?token=one#refresh%5Ftoken=two;id-token=three&chapter=2','https://example.test/view?token=[REDACTED]#refresh%5Ftoken=[REDACTED];id-token=[REDACTED]&chapter=2'],
 ['https://example.test/view#chapter?ordinary=yes','https://example.test/view#chapter?ordinary=yes'],
 ['https://bob@example.test/view?key=ordinary','https://bob@example.test/view?key=ordinary'],
 ];
 for(const [source,expected] of cases){
  const value=selected(), metadata=first(value).metadata;assert.ok(metadata);metadata.title=source;
  const projected=validateMetadataSample(value);assert.ok(projected);assert.equal(first(projected).metadata?.title,expected);
  assert.equal(first(value).metadata?.title,source,'caller remains unchanged');
  assert.deepEqual(validateMetadataSample(projected),projected);
  assert.deepEqual(first(projected).omissions,source===expected?[]:[{field:'title',reason:'credential-redacted'}]);
 }
 const value=selected(), metadata=first(value).metadata;assert.ok(metadata);metadata.title='token=a '.repeat(1024);
 const projected=validateMetadataSample(value);assert.ok(projected);assert.equal(first(projected).metadata?.title,null);
 assert.deepEqual(first(projected).omissions,[{field:'title',reason:'credential-redacted'},{field:'title',reason:'oversized'}]);
 assert.deepEqual(validateMetadataSample(projected),projected);
});
void test('validator never invokes accessors and does not retain caller references', () => {
 let touched=false;const evil={...empty()};Object.defineProperty(evil,'schema',{enumerable:true,get(){touched=true;throw new Error('PRIVATE');}});
 assert.equal(validateMetadataSample(evil),undefined);assert.equal(touched,false);
 const value=selected(), projected=validateMetadataSample(value);assert.ok(projected);
 assert.notEqual(first(projected),first(value));assert.notEqual(first(projected).metadata,first(value).metadata);
 assert.notEqual(first(projected).playback,first(value).playback);assert.notEqual(first(projected).omissions,first(value).omissions);
 const sparse=Array<unknown>(1);assert.equal(validateMetadataSample({...empty(),sessions:sparse}),undefined);
 assert.equal(validateMetadataSample({...empty(),[Symbol('unexpected')]:true}),undefined);
});
