import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,chmod,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {inventory,verifyRelease,extractArchive} from '../dist/install/files.js';
const hash=value=>createHash('sha256').update(value).digest('hex');

test('installation inventory is read-only, deterministic and includes modes and dependency bytes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'install-inventory-'));
 try{
  await mkdir(join(root,'node_modules'));await writeFile(join(root,'app.js'),'run');await writeFile(join(root,'node_modules','dependency.js'),'dependency');
  const first=await inventory(root);assert.equal(first.entries.length,3);assert.deepEqual(await inventory(root),first);
  await chmod(join(root,'app.js'),0o700);assert.notEqual((await inventory(root)).sha256,first.sha256);
  await writeFile(join(root,'node_modules','dependency.js'),'tampered');assert.notEqual((await inventory(root)).sha256,first.sha256);
  await symlink('/etc/passwd',join(root,'escape'));await assert.rejects(inventory(root),/unsafe-install-link/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('release verification requires complete trusted file hashes and exact full source identity',async()=>{
 const root=await mkdtemp(join(tmpdir(),'install-release-'));
 try{
  await mkdir(join(root,'node_modules'));await writeFile(join(root,'app.js'),'run');await writeFile(join(root,'node_modules','dependency.js'),'dependency');
  const manifest={artifact:'@jimmie-potts/hub',version:'0.4.1',sourceRevision:'a'.repeat(40),files:{'app.js':hash('run')},dependencyFiles:{'node_modules/dependency.js':hash('dependency')}};
  const bytes=JSON.stringify(manifest);await writeFile(join(root,'manifest.json'),bytes);
  const expected={kind:'release',sourceRevision:'a'.repeat(40),version:'0.4.1',archiveSha256:'b'.repeat(64),manifestSha256:hash(bytes)};
  assert.deepEqual((await verifyRelease(root,expected)).identity,expected);
  await writeFile(join(root,'node_modules','dependency.js'),'bad');await assert.rejects(verifyRelease(root,expected),/install-file-hash/);
  await writeFile(join(root,'node_modules','dependency.js'),'dependency');await writeFile(join(root,'extra.js'),'extra');await assert.rejects(verifyRelease(root,expected),/install-file-inventory/);
  await rm(join(root,'extra.js'));await assert.rejects(verifyRelease(root,{...expected,sourceRevision:'c'.repeat(40)}),/install-source-identity/);
  assert.equal(await readFile(join(root,'manifest.json'),'utf8'),bytes);
 }finally{await rm(root,{recursive:true,force:true});}
});

function archive(entries){
 const blocks=[];
 for(const {path,content='',type='0',link=''} of entries){
  const b=Buffer.alloc(512);b.write(path,0,100);b.write('0000644\0',100);b.write('0000000\0',108);b.write('0000000\0',116);b.write(Buffer.byteLength(content).toString(8).padStart(11,'0')+'\0',124);b.write('00000000000\0',136);b.fill(32,148,156);b.write(type,156);b.write(link,157,100);b.write('ustar\0',257);b.write('00',263);const sum=b.reduce((a,v)=>a+v,0);b.write(sum.toString(8).padStart(6,'0')+'\0 ',148);blocks.push(b,Buffer.from(content),Buffer.alloc((512-Buffer.byteLength(content)%512)%512));
 }
 return gzipSync(Buffer.concat([...blocks,Buffer.alloc(1024)]));
}
test('archive staging rejects traversal, links, duplicate paths and wrong trusted hash before publishing',async()=>{
 const root=await mkdtemp(join(tmpdir(),'install-tar-'));
 try{
  const good=archive([{path:'package/app.js',content:'safe'}]);await extractArchive(good,join(root,'good'),hash(good));assert.equal(await readFile(join(root,'good/app.js'),'utf8'),'safe');
  await assert.rejects(extractArchive(good,join(root,'bad-hash'),'a'.repeat(64)),/install-archive-hash/);
  for(const [name,entries] of Object.entries({traversal:[{path:'package/../escape',content:'no'}],absolute:[{path:'/escape'}],link:[{path:'package/link',type:'2',link:'/etc/passwd'}],duplicate:[{path:'package/a'},{path:'package/a'}]})){
   const bytes=archive(entries);await assert.rejects(extractArchive(bytes,join(root,name),hash(bytes)),/unsafe-install-archive/);
  }
  const truncated=gzipSync(gunzipSync(good).subarray(0,-1024));await assert.rejects(extractArchive(truncated,join(root,'truncated'),hash(truncated)),/unsafe-install-archive/);
  await assert.rejects(readFile(join(root,'escape')),/ENOENT/);
 }finally{await rm(root,{recursive:true,force:true});}
});
