import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {LANES, lanePlan, packagedTests} from '../packaged.mjs';

test('sealed-image inventory keeps every verification file except the exact checkout-only build file', async context => {
  const root = await mkdtemp(join(tmpdir(), 'packaged-inventory-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  const scenarios = join(root, 'apps/runtime/dist/tests/scenarios'), verify = join(root, 'apps/runtime/dist/verify/tests');
  await mkdir(join(root,'scripts/tests'),{recursive:true});await writeFile(join(root,'scripts/tests/bunny-backup.test.mjs'),'');
  await mkdir(scenarios, {recursive: true}); await mkdir(verify, {recursive: true});
  await writeFile(join(scenarios, 'catalog.test.js'), '');
  const included = ['adapter.test.js', 'boundaries.test.js', 'drain.test.js', 'follow.test.js', 'guard.test.js',
    'health.test.js', 'home.test.js', 'journal.test.js', 'migrated.test.js', 'nanoleaf-migrated.test.js',
    'roborock.test.js', 'runs.test.js', 'steps.test.js', 'supervisor.test.js', 'future.test.js'];
  for (const name of ['build.test.js', 'support.js', ...included]) await writeFile(join(verify, name), '');
  const tests = await packagedTests(root);
  assert.deepEqual(tests.verification, included.sort().map(name => `apps/runtime/dist/verify/tests/${name}`));
  assert.deepEqual(tests.helpers,['scripts/tests/bunny-backup.test.mjs']);
  assert.deepEqual(tests.excluded, ['apps/runtime/dist/verify/tests/build.test.js']);
  assert.deepEqual(tests.scenarios, ['apps/runtime/dist/tests/scenarios/catalog.test.js']);
  await rm(join(verify, 'build.test.js'));
  await assert.rejects(packagedTests(root), /packaged-test-inventory-refused/);
});

test('packaged backup helper failure is executed and blocks qualification',async context=>{
  const root=await mkdtemp(join(tmpdir(),'packaged-helper-control-'));context.after(()=>rm(root,{recursive:true,force:true}));
  for(const path of ['apps/runtime/dist/tests/scenarios','apps/runtime/dist/verify/tests','scripts/tests'])await mkdir(join(root,path),{recursive:true});
  for(const path of ['apps/runtime/dist/tests/scenarios/catalog.test.js','apps/runtime/dist/verify/tests/build.test.js','apps/runtime/dist/verify/tests/health.test.js'])await writeFile(join(root,path),'');
  await writeFile(join(root,'scripts/tests/bunny-backup.test.mjs'),"throw new Error('synthetic helper negative control');");
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const program=`import{runPackaged}from ${JSON.stringify(new URL('../packaged.mjs',import.meta.url).href)};process.exitCode=await runPackaged(${JSON.stringify(root)});`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',program],{env,encoding:'utf8'});
  assert.equal(child.status,1);assert.match(child.stdout+child.stderr,/synthetic helper negative control/);
});

// The parallel lanes run the same inventory as one serial job (#1512): every file in one lane, except the capture file,
// whose two complementary shards run in two lanes. Each lane keeps the serial runner wherever the job had it.
test('the packaged lanes together run every packaged file once, and split only the capture cases', () => {
  const steps = 'apps/runtime/dist/verify/tests/steps.test.js';
  const tests = {helpers: ['scripts/tests/bunny-backup.test.mjs'],
    scenarios: ['apps/runtime/dist/tests/scenarios/catalog.test.js', 'apps/runtime/dist/tests/scenarios/runner.test.js'],
    verification: ['apps/runtime/dist/verify/tests/adapter.test.js', steps, 'apps/runtime/dist/verify/tests/supervisor.test.js', 'apps/runtime/dist/verify/tests/future.test.js'],
    excluded: ['apps/runtime/dist/verify/tests/build.test.js']};
  const files = plan => plan.flatMap(({args}) => args.filter(arg => !arg.startsWith('--')));
  const serial = lanePlan(tests, undefined);
  assert.deepEqual(serial.map(({args}) => args), [['--test', ...tests.scenarios], ['--test', '--test-concurrency=1', ...tests.verification], ['--test', ...tests.helpers]]);
  assert.ok(serial.every(({env}) => env === undefined), 'the serial run takes every capture case');
  const lanes = LANES.map(lane => lanePlan(tests, lane));
  const all = lanes.flatMap(files);
  assert.deepEqual(all.filter(file => file !== steps).sort(), files(serial).filter(file => file !== steps).sort(), 'every other file runs exactly once');
  const shards = lanes.flat().filter(({args}) => args.includes(steps));
  assert.deepEqual(shards.map(({env}) => env?.BUNNY_CAPTURE_SHARD).sort(), ['1/2', '2/2'], 'the capture file runs as two complementary shards');
  for (const {args} of lanes.flat()) {
    if (args.some(file => tests.verification.includes(file))) assert.equal(args[1], '--test-concurrency=1', 'verification files stay serial');
  }
  assert.throws(() => lanePlan(tests, 'other'), /packaged-lane-refused/);
  assert.throws(() => lanePlan({...tests, verification: tests.verification.filter(file => file !== steps)}, 'captures'), /packaged-test-inventory-refused/);
});
