import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {sha256} from '../dist/install/files.js';
import {stageRelease,retainRelease,writeDurable} from '../dist/install/stage.js';

function archive(files){
 const blocks=[];
 for(const [name,content] of Object.entries(files)){
  const b=Buffer.alloc(512);b.write('package/'+name);b.write('0000644\0',100);b.write('0000000\0',108);b.write('0000000\0',116);b.write(Buffer.byteLength(content).toString(8).padStart(11,'0')+'\0',124);b.write('00000000000\0',136);b.fill(32,148,156);b.write('0',156);b.write('ustar\0',257);b.write('00',263);b.write(b.reduce((a,v)=>a+v,0).toString(8).padStart(6,'0')+'\0 ',148);blocks.push(b,Buffer.from(content),Buffer.alloc((512-Buffer.byteLength(content)%512)%512));
 }
 return gzipSync(Buffer.concat([...blocks,Buffer.alloc(1024)]));
}
export function releaseFixture(content='app'){
 const manifest=JSON.stringify({artifact:'@jimmie-potts/hub',sourceRevision:'a'.repeat(40),version:'0.4.1',files:{'app.js':sha256(content)},dependencyFiles:{}});
 const bytes=archive({'app.js':content,'manifest.json':manifest});
 return {bytes,identity:{kind:'release',sourceRevision:'a'.repeat(40),version:'0.4.1',archiveSha256:sha256(bytes),manifestSha256:sha256(manifest)}};
}
test('immutable SHA staging reuses identical verified bytes and rejects conflicts and tampering',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hi-stage-'));try{
  const one=releaseFixture(),first=await stageRelease(root,one.bytes,one.identity);
  assert.equal(await readFile(join(first.path,'app.js'),'utf8'),'app');assert.deepEqual(await stageRelease(root,one.bytes,one.identity),first);
  const other=releaseFixture('different');await assert.rejects(stageRelease(root,other.bytes,other.identity),/conflicting-install-release/);
  await writeFile(join(first.path,'app.js'),'tampered');await assert.rejects(stageRelease(root,one.bytes,one.identity),/install-file-hash/);
  assert.deepEqual((await readdir(join(root,'releases'))).sort(),['a'.repeat(40)]);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('durable write replaces a whole document and refuses linked destinations',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hi-write-'));try{
  const path=join(root,'receipt.json');await writeDurable(path,{value:1});await writeDurable(path,{value:2});
  assert.deepEqual(JSON.parse(await readFile(path,'utf8')),{value:2});assert.deepEqual(await readdir(root),['receipt.json']);
  await symlink(path,join(root,'linked.json'));await assert.rejects(writeDurable(join(root,'linked.json'),{value:3}),/unsafe-install-file/);assert.deepEqual(JSON.parse(await readFile(path,'utf8')),{value:2});
 }finally{await rm(root,{recursive:true,force:true});}
});
test('adoption never replaces an existing SHA directory whose provenance is missing',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hi-adopt-'));try{
  const source=join(root,'source'),destination=join(root,'destination');await mkdir(source,{mode:0o700});await mkdir(destination,{mode:0o700});
  const fixture=releaseFixture(),staged=await stageRelease(source,fixture.bytes,fixture.identity);
  await mkdir(join(destination,'releases',fixture.identity.sourceRevision),{recursive:true,mode:0o700});
  await assert.rejects(retainRelease(destination,staged.path,fixture.identity),/ENOENT|conflicting-install-release/);
  assert.deepEqual(await readdir(join(destination,'releases',fixture.identity.sourceRevision)),[]);
 }finally{await rm(root,{recursive:true,force:true});}
});
