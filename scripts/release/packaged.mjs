#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {readdir,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
// This one file asserts source-checkout Git inventory. The full source job still runs it.
const checkoutOnly = 'build.test.js';
// The capture cases. Two lanes divide them through BUNNY_CAPTURE_SHARD (#1512).
const captures = 'apps/runtime/dist/verify/tests/steps.test.js';
export const LANES = Object.freeze(['scenarios', 'captures', 'verification']);
export async function packagedTests(directory = root) {
  const files = async path => (await readdir(join(directory, path))).filter(name => name.endsWith('.test.js')).sort();
  const scenarios = await files('apps/runtime/dist/tests/scenarios');
  const verify = await files('apps/runtime/dist/verify/tests');
  if (!scenarios.length || !verify.includes(checkoutOnly) || verify.length < 2) throw new Error('packaged-test-inventory-refused');
  const helpers=['scripts/tests/bunny-backup.test.mjs'];
  for(const path of helpers){const entry=await lstat(join(directory,path)).catch(()=>undefined);if(!entry?.isFile())throw new Error('packaged-test-inventory-refused');}
  return {helpers,scenarios: scenarios.map(name => `apps/runtime/dist/tests/scenarios/${name}`),
    verification: verify.filter(name => name !== checkoutOnly).map(name => `apps/runtime/dist/verify/tests/${name}`),
    excluded: [`apps/runtime/dist/verify/tests/${checkoutOnly}`]};
}
/**
 * The test processes one lane runs, in order, each as {args, env}. Without a lane, one job runs the whole inventory
 * serially as before. The three lanes run in parallel jobs on the same image and together run the same inventory:
 * every file once, except the capture file, which two lanes split by alternate case.
 */
export function lanePlan(tests, lane) {
  const scenarios = {args: ['--test', ...tests.scenarios]}, helpers = {args: ['--test', ...tests.helpers]};
  const serial = paths => ['--test', '--test-concurrency=1', ...paths];
  if (lane === undefined) return [scenarios, {args: serial(tests.verification)}, helpers];
  if (!tests.verification.includes(captures)) throw new Error('packaged-test-inventory-refused');
  if (lane === 'scenarios') return [scenarios, helpers];
  if (lane === 'captures') return [{args: serial([captures]), env: {BUNNY_CAPTURE_SHARD: '1/2'}}];
  if (lane === 'verification') return [{args: serial(tests.verification), env: {BUNNY_CAPTURE_SHARD: '2/2'}}];
  throw new Error('packaged-lane-refused');
}
export async function runPackaged(directory=root, lane=undefined) {
  const tests = await packagedTests(directory);
  for (const [suite, paths] of Object.entries(tests)) console.log(`Packaged ${suite}: ${paths.join(', ')}`);
  const plan = lanePlan(tests, lane);
  if (lane !== undefined) for (const {args, env} of plan) console.log(`Packaged lane ${lane}:${env ? ` ${Object.entries(env).map(([k, v]) => `${k}=${v}`).join(' ')}` : ''} ${args.filter(arg => !arg.startsWith('--')).join(', ')}`);
  for (const {args, env} of plan) {
    const child = spawn(process.execPath, args, {cwd: directory, stdio: 'inherit', env: {...process.env, ...env}});
    const code = await new Promise((resolve, reject) => {child.once('error', reject); child.once('close', code => resolve(code ?? 1));});
    if (code !== 0) return code;
  }
  return 0;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPackaged(root, process.argv[2]).then(code => {process.exitCode = code;}, () => {process.stderr.write('packaged-checks-failed\n'); process.exitCode = 1;});
}
