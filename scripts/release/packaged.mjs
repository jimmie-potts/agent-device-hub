#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {readdir,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
// This one file asserts source-checkout Git inventory. The full source job still runs it.
const checkoutOnly = 'build.test.js';
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
export async function runPackaged(directory=root) {
  const tests = await packagedTests(directory);
  for (const [suite, paths] of Object.entries(tests)) console.log(`Packaged ${suite}: ${paths.join(', ')}`);
  for (const args of [['--test', ...tests.scenarios], ['--test', '--test-concurrency=1', ...tests.verification],['--test',...tests.helpers]]) {
    const child = spawn(process.execPath, args, {cwd: directory, stdio: 'inherit'});
    const code = await new Promise((resolve, reject) => {child.once('error', reject); child.once('close', code => resolve(code ?? 1));});
    if (code !== 0) return code;
  }
  return 0;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPackaged().then(code => {process.exitCode = code;}, () => {process.stderr.write('packaged-checks-failed\n'); process.exitCode = 1;});
}
