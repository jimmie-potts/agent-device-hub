import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,stat,writeFile,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PrivateStore} from '../dist/storage.js';
test('private atomic retention refuses capacity without deleting evidence',async()=>{
 const root=await mkdtemp(join(tmpdir(),'maintenance-store-'));
 try {
  const store=new PrivateStore(root,4096);await store.open();
  await store.save('original.json',{personal:'private-device'});
  assert.equal((await stat(join(root,'original.json'))).mode&0o777,0o600);
  await assert.rejects(store.save('large.json',{x:'a'.repeat(5000)}),/capacity/);
  assert.match(await readFile(join(root,'original.json'),'utf8'),/private-device/);
  await symlink(join(root,'original.json'),join(root,'link.json'));
  await assert.rejects(store.read('link.json'),/unsafe/);
 }finally{await rm(root,{recursive:true,force:true});}
});
