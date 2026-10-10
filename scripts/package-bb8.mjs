// Pack both owners and check their public exports in a consumer outside every checkout.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {scratchRoot} from './scratch-root.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function run(command, args, cwd) {
  const result = spawnSync(command, args, {cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024, env: {...process.env, NODE_PATH: '', NODE_OPTIONS: ''}});
  if (result.error || result.status !== 0) throw Error(result.error?.message ?? `${command} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
const npm = (args, cwd) => run(process.execPath, [process.env.npm_execpath, ...args], cwd);
const base = scratchRoot(root, 'bb8-consumer'); await mkdir(base, {recursive: true});
const scratch = await mkdtemp(join(base, 'check-'));
try {
  const archives = [];
  for (const folder of ['packages/observability', 'packages/event-contracts', 'packages/sdk', 'modules/bb8', 'apps/bb8-windows']) {
    const source = join(root, folder), stage = join(scratch, folder); await mkdir(stage, {recursive: true});
    const metadata = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
    for (const item of ['dist', 'package.json']) await cp(join(source, item), join(stage, item), {recursive: true});
    if (folder === 'packages/event-contracts') await cp(join(source, 'schemas'), join(stage, 'schemas'), {recursive: true});
    if (folder === 'packages/observability') await cp(join(source, 'runtime'), join(stage, 'runtime'), {recursive: true});
    if (folder === 'modules/bb8') await cp(join(source, 'src/frontend'), join(stage, 'src/frontend'), {recursive: true});
    if (folder === 'modules/bb8') {
      // Frontend source imports only the pure type contract; include it for bundler/type consumers.
      await cp(join(source, 'src/contracts.ts'), join(stage, 'src/contracts.ts'));
    }
    if (folder.startsWith('modules/') || folder.startsWith('apps/')) await cp(join(source, 'README.md'), join(stage, 'README.md'));
    if (folder === 'apps/bb8-windows') for (const item of ['bin', 'THIRD-PARTY-NOTICES.md']) await cp(join(source, item), join(stage, item), {recursive: true});
    delete metadata.devDependencies;
    await writeFile(join(stage, 'package.json'), JSON.stringify(metadata));
    const report = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', scratch], stage));
    archives.push(join(scratch, report[0].filename));
  }
  if (process.argv.includes('--test')) {
    const consumer = join(scratch, 'consumer'); await mkdir(consumer);
    assert.notEqual(spawnSync('git', ['-C', consumer, 'rev-parse', '--is-inside-work-tree'], {encoding: 'utf8'}).stdout.trim(), 'true');
    await writeFile(join(consumer, 'package.json'), JSON.stringify({name: 'isolated-bb8-consumer', private: true, type: 'module'}));
    npm(['install', '--offline', '--ignore-scripts', '--omit=optional', '--no-audit', '--no-fund', ...archives], consumer);
    run(process.execPath, ['--input-type=module', '-e', `import assert from 'node:assert/strict'; import {registration} from '@jimmie-potts/bb8'; import {bb8Validator, BOUNDS} from '@jimmie-potts/bb8/link'; import {HelperOwner, NativeAdapter, parseWindowsConfig} from '@jimmie-potts/bb8-windows'; assert.equal(registration.name,'bb8'); assert.equal(BOUNDS.maxPending,8); assert.ok(bb8Validator()); assert.equal(typeof HelperOwner,'function'); assert.equal(typeof NativeAdapter,'function'); assert.equal(typeof parseWindowsConfig,'function');`], consumer);
    const frontend = join(consumer, 'node_modules/@jimmie-potts/bb8/src/frontend/index.tsx');
    const bundled = await build({entryPoints: [frontend], bundle: true, write: false, platform: 'browser', format: 'esm', jsx: 'automatic', external: ['react', 'react/jsx-runtime'], metafile: true});
    assert.ok(Object.keys(bundled.metafile.inputs).every(path => !path.includes('/node:') && !path.includes('bb8-windows') && !path.includes('noble')));
    await readFile(join(consumer, 'node_modules/@jimmie-potts/bb8-windows/bin/check-private.ps1'));
    await readFile(join(consumer, 'node_modules/@jimmie-potts/bb8-windows/bin/writer-lease.ps1'));
    console.log('BB-8 isolated module, pure link, frontend and Windows helper consumer passed; native activation deferred to #605.');
  }
} finally {await rm(scratch, {recursive: true, force: true});}
