import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, readdir, rm, realpath, symlink, link, chmod, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {backup, restore, verify, PENDING} from '../bunny-backup.mjs';

process.umask(0o077);
const revision = 'a'.repeat(40);
const linux = {skip: process.platform !== 'linux' ? 'real runtime private-file checks require Linux; run in the approved container' : false};
async function fixture(t) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'bunny-backup-test-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const state = join(root, 'source'), target = join(root, 'target'), secrets = join(root, 'secrets'), output = join(root, 'output');
  for (const path of [state, target, secrets, output, join(state, 'modules'), join(state, 'modules/core'), join(state, 'modules/pixoo')]) await mkdir(path, {mode: 0o700});
  const config = join(root, 'runtime.json');
  await writeFile(config, JSON.stringify({schema: 'runtime-config/1.0', modules: {}, edge: {credentials: join(secrets, 'edge.json')}}), {mode: 0o600});
  await writeFile(join(secrets, 'edge.json'), JSON.stringify({schema:'edge-credentials/1.0',credentials:[]}), {mode:0o600});
  const {holdRuntimeLease} = await import('../../apps/runtime/dist/src/lease.js');
  (await holdRuntimeLease(state)).release();
  const {PrivateRequestDigest} = await import('@jimmie-potts/sdk');
  const db = new DatabaseSync(join(state, 'modules/core.sqlite'));
  db.exec('CREATE TABLE example (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO example VALUES(1, \'private synthetic record\'); BEGIN');
  new PrivateRequestDigest(db, () => join(state, 'modules/core')).digest('fixture', 'synthetic', true);
  db.exec('COMMIT'); db.close();
  await writeFile(join(state, 'modules/pixoo/retained-asset'), 'synthetic retained media', {mode:0o600});
  return {root, state, target, config, secrets, destination: join(output, 'snapshot'), revision, helper:{revision:'b'.repeat(40),image:'sha256:'+'c'.repeat(64)}};
}
async function roundTrip(f) {
  assert.equal((await backup(f)).status, 'complete');
  return restore({...f, state: f.target, archive: f.destination});
}
test('stopped backup and restore preserve records, assets, config and matching internal key', linux, async t => {
  const f = await fixture(t);
  assert.equal((await roundTrip(f)).startup, 'stopped');
  const db = new DatabaseSync(join(f.target, 'modules/core.sqlite'));
  assert.equal(db.prepare('SELECT value FROM example WHERE id = 1').get().value, 'private synthetic record'); db.close();
  assert.deepEqual(await readFile(join(f.target, 'modules/core/request-digest.key')), await readFile(join(f.state, 'modules/core/request-digest.key')));
  assert.equal(await readFile(join(f.target, 'modules/pixoo/retained-asset'), 'utf8'), 'synthetic retained media');
  assert.equal((await stat(join(f.target, 'modules/core.sqlite'))).mode & 0o777, 0o600);
  assert.equal((await stat(join(f.target, 'modules/core.sqlite-owner'))).size, 0);
  assert.ok(!(await readdir(f.target)).includes(PENDING));
  assert.deepEqual((await readdir(f.destination)).sort(), ['manifest.json', 'runtime.json', 'state']);
  assert.ok(!(await readdir(join(f.destination, 'state/modules'))).includes('core.sqlite-owner'));
});
test('WAL-resident committed records survive a crashed writer and restoration', linux, async t => {
  const f = await fixture(t);
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    'import {DatabaseSync} from "node:sqlite"; process.umask(0o077); const db=new DatabaseSync(process.argv[1]); db.exec("PRAGMA journal_mode=WAL; PRAGMA locking_mode=EXCLUSIVE; PRAGMA wal_autocheckpoint=0; INSERT INTO example VALUES(2, \'committed in WAL\')"); process.exit(0);', join(f.state, 'modules/core.sqlite')], {encoding:'utf8'});
  assert.equal(child.status, 0); assert.ok((await stat(join(f.state, 'modules/core.sqlite-wal'))).size > 0);
  await roundTrip(f);
  const db = new DatabaseSync(join(f.target, 'modules/core.sqlite'));
  assert.equal(db.prepare('SELECT value FROM example WHERE id = 2').get().value, 'committed in WAL'); db.close();
});
test('actual held runtime ownership refuses backup before any destination exists', linux, async t => {
  const f = await fixture(t);
  const {acquireRuntimeOwnership} = await import('../../apps/runtime/dist/src/runtime-ownership.js');
  const owner = await acquireRuntimeOwnership(f.state);
  try {await assert.rejects(backup(f)); assert.deepEqual(await readdir(join(f.root, 'output')), []);}
  finally {owner.releaseBeforeStartup();}
});

test('a configuration reference to the held coordination inode refuses before output', linux, async t => {
  const f = await fixture(t);
  await writeFile(f.config, JSON.stringify({schema:'runtime-config/1.0', modules:{},
    edge:{credentials:join(f.state,'modules/core.sqlite-owner')}}), {mode:0o600});
  await assert.rejects(backup({...f,secrets:f.state}));
  assert.deepEqual(await readdir(join(f.root,'output')), []);
});
test('another process holding the real core lease refuses backup', linux, async t => {
  const f = await fixture(t);
  const {spawn} = await import('node:child_process');
  const code = `import {holdRuntimeLease} from ${JSON.stringify(new URL('../../apps/runtime/dist/src/lease.js', import.meta.url).href)}; await holdRuntimeLease(process.argv[1]); process.stdout.write('ready'); setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code, f.state], {stdio:['ignore','pipe','ignore']});
  await new Promise((resolve, reject) => {child.stdout.once('data', resolve); child.once('exit', () => reject(new Error('fixture-exit')));});
  try {await assert.rejects(backup(f));} finally {child.kill(); await new Promise(resolve => child.once('exit', resolve));}
});
test('wrong DB/key pair cannot produce a verified backup', linux, async t => {
  const f = await fixture(t); await writeFile(join(f.state, 'modules/core/request-digest.key'), Buffer.alloc(32, 123));
  await assert.rejects(backup(f)); assert.ok(!(await readdir(f.destination)).includes('manifest.json'));
});
test('corruption, missing credentials and changed configuration refuse before target writes', linux, async t => {
  const f = await fixture(t); await backup(f);
  await writeFile(join(f.destination, 'state/modules/pixoo/retained-asset'), 'corrupt');
  await assert.rejects(restore({...f, archive:f.destination, state:f.target})); assert.deepEqual(await readdir(f.target), []);
  await writeFile(join(f.destination, 'state/modules/pixoo/retained-asset'), 'synthetic retained media');
  await assert.rejects(verify({...f, archive:f.destination, revision:'b'.repeat(40)}));
  await writeFile(f.config, JSON.stringify({schema:'runtime-config/1.0',modules:{}}));
  await assert.rejects(restore({...f, archive:f.destination, state:f.target})); assert.deepEqual(await readdir(f.target), []);
  await writeFile(f.config, await readFile(join(f.destination, 'runtime.json')));
  await rm(join(f.secrets, 'edge.json'));
  await assert.rejects(restore({...f, archive:f.destination, state:f.target})); assert.deepEqual(await readdir(f.target), []);
});
test('restore refuses occupied and partial targets without overwriting failed latest state', linux, async t => {
  const f = await fixture(t); await backup(f); await writeFile(join(f.target, PENDING), 'preserve this', {mode:0o600});
  await assert.rejects(restore({...f, state:f.target, archive:f.destination}));
  assert.equal(await readFile(join(f.target, PENDING), 'utf8'), 'preserve this');
  await assert.rejects(restore({...f, state:f.state, archive:f.destination}));
});
for (const kind of ['symlink', 'hardlink', 'permissions']) test(`unsafe ${kind} refuses export`, linux, async t => {
  const f = await fixture(t), source = join(f.state, 'modules/pixoo/retained-asset');
  if (kind === 'symlink') await symlink(source, join(f.state, 'unexpected'));
  if (kind === 'hardlink') await link(source, join(f.state, 'unexpected'));
  if (kind === 'permissions') await chmod(source, 0o644);
  await assert.rejects(backup(f));
});
test('interrupted restore keeps a durable pending marker and refuses reuse', {...linux, timeout:20000}, async t => {
  const f = await fixture(t);
  const {open} = await import('node:fs/promises');
  const large = await open(join(f.state, 'modules/pixoo/large-asset'), 'wx', 0o600);
  await large.truncate(128 * 1024 * 1024); await large.close();
  await backup(f);
  const {spawn} = await import('node:child_process'), {watch} = await import('node:fs');
  const code = `import {restore} from ${JSON.stringify(new URL('../bunny-backup.mjs', import.meta.url).href)}; await restore(JSON.parse(process.argv[1]));`;
  let child;
  const watcher = watch(f.target, (_event, name) => {if (name === PENDING) child?.kill('SIGKILL');});
  try {
    child = spawn(process.execPath, ['--input-type=module', '-e', code, JSON.stringify({...f, state:f.target, archive:f.destination})], {stdio:'ignore'});
    const signal = await new Promise(resolve => child.once('exit', (_code, signal) => resolve(signal)));
    assert.equal(signal, 'SIGKILL');
    assert.ok((await readdir(f.target)).includes(PENDING));
    await assert.rejects(restore({...f, state:f.target, archive:f.destination}));
    // Source and completed snapshot are preserved after the failed target operation.
    assert.equal((await stat(join(f.state, 'modules/pixoo/large-asset'))).size, 128 * 1024 * 1024);
    await verify({...f, archive:f.destination});
  } finally {watcher.close(); child?.kill('SIGKILL');}
});

const onnSection={id:'onn',configurationRevision:1,adbSocket:'/not-configured/socket',serial:'192.0.2.10:12345',hostExecutable:'/not-configured/adb',hostExecutableSha256:'0'.repeat(64),hostVersion:'37.0.1',hostKeyDirectory:'/not-configured/keys'};
test('version 2 full ONN backup never accesses declared host dependencies and preserves raw config and old source',linux,async t=>{
  const f=await fixture(t);
  const raw='  '+JSON.stringify({schema:'runtime-config/1.0',modules:{onn:onnSection},edge:{credentials:join(f.secrets,'edge.json')}})+'\n';
  await writeFile(f.config,raw);
  const fs=(await import('node:fs')).default,fp=(await import('node:fs/promises')).default,{syncBuiltinESMExports}=await import('node:module');
  const calls=[],restores=[];
  const external=path=>typeof path==='string'&&Object.values(onnSection).filter(value=>typeof value==='string'&&value.startsWith('/')).some(value=>path===value||path.startsWith(value+'/'));
  for(const [object,names] of [[fp,['lstat','stat','open','readFile','readdir','realpath']],[fs,['lstatSync','statSync','openSync','readFileSync','readdirSync','realpathSync']]])for(const name of names){const original=object[name];restores.push(()=>{object[name]=original;});object[name]=function(path,...args){if(external(path)){calls.push(name);throw Error('external dependency was accessed');}return original.call(this,path,...args);};}
  syncBuiltinESMExports();
  try {
    await backup(f);const manifest=await verify({...f,archive:f.destination});
    assert.equal(manifest.schema,'bunny-container-backup/2');assert.equal(manifest.revision,revision);assert.deepEqual(manifest.helper,f.helper);
    assert.deepEqual(manifest.externalHostDependencies,['adbSocket','hostExecutable','hostKeyDirectory'].map(field=>({field:'modules.onn.'+field,path:onnSection[field]})));
    assert.equal(await readFile(join(f.destination,'runtime.json'),'utf8'),raw);assert.equal(manifest.references.length,1);
    await restore({...f,state:f.target,archive:f.destination});assert.deepEqual(calls,[]);
  }finally{for(const restore of restores)restore();syncBuiltinESMExports();}
});
test('version 1 verification keeps its old credential-reference semantics',linux,async t=>{
  const f=await fixture(t);await backup(f);
  const path=join(f.destination,'manifest.json'),manifest=JSON.parse(await readFile(path,'utf8'));
  manifest.schema='bunny-container-backup/1';delete manifest.helper;delete manifest.externalHostDependencies;await writeFile(path,JSON.stringify(manifest));
  assert.equal((await verify({...f,archive:f.destination})).schema,'bunny-container-backup/1');
  // Legacy readers ignored unknown manifest keys; new fields cannot grant ONN exemptions to version 1.
  manifest.helper={unexpected:true};manifest.externalHostDependencies=[{untrusted:true}];await writeFile(path,JSON.stringify(manifest));
  assert.equal((await verify({...f,archive:f.destination})).schema,'bunny-container-backup/1');
});
test('overlapping ONN dependencies and secret references refuse before reference I/O',linux,async t=>{
  for(const kind of ['exact','ancestor','descendant','lexical-alias']) {
    const f=await fixture(t),path=join(f.secrets,'edge.json');
    const external=kind==='exact'?path:kind==='ancestor'?f.secrets:kind==='descendant'?path+'/nested':f.secrets+'/./edge.json';
    await writeFile(f.config,JSON.stringify({schema:'runtime-config/1.0',modules:{onn:{...onnSection,hostExecutable:external}},edge:{credentials:path}}));
    const fs=(await import('node:fs/promises')).default,{syncBuiltinESMExports}=await import('node:module'),restores=[],calls=[];
    for(const name of ['lstat','stat','open','readFile','realpath']){const original=fs[name];restores.push(()=>{fs[name]=original;});fs[name]=function(selected,...args){if(selected===path)calls.push(name);return original.call(this,selected,...args);};}
    syncBuiltinESMExports();
    try{await assert.rejects(backup(f));assert.deepEqual(calls,[],kind);assert.deepEqual(await readdir(join(f.root,'output')),[]);}
    finally{for(const restore of restores)restore();syncBuiltinESMExports();}
  }
});
test('declared dependency tampering or unsupported absolute fields never verify or restore',linux,async t=>{
  const f=await fixture(t);await writeFile(f.config,JSON.stringify({schema:'runtime-config/1.0',modules:{onn:onnSection},edge:{credentials:join(f.secrets,'edge.json')}}));
  await backup(f);const path=join(f.destination,'manifest.json'),manifest=JSON.parse(await readFile(path,'utf8'));
  manifest.externalHostDependencies[0].path='/unselected/socket';await writeFile(path,JSON.stringify(manifest));
  await assert.rejects(restore({...f,state:f.target,archive:f.destination}));assert.deepEqual(await readdir(f.target),[]);
  await writeFile(f.config,JSON.stringify({schema:'runtime-config/1.0',modules:{other:{adbSocket:'/not-configured/socket'}}}));
  await assert.rejects(backup({...f,destination:join(f.root,'output','unknown')}));
});
