import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {link, mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {test} from 'node:test';
const run = promisify(execFile);
const hash = (bytes: string) => createHash('sha256').update(bytes).digest('hex');

void test('baseline closure binds actual execution and dependencies to admitted previous evidence', async t => {
  const root = await mkdtemp(join(tmpdir(), 'bunny-upgrade-baseline-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const running = join(root, 'running');
  const content: Record<string, string> = {'package.json': JSON.stringify({workspaces: ['packages/sdk', 'apps/runtime', 'apps/inactive']}),
    'apps/runtime/package.json': JSON.stringify({name: '@synthetic/runtime'}),
    'apps/inactive/package.json': JSON.stringify({name: '@synthetic/inactive'}),
    'apps/inactive/src/main.ts': 'synthetic inactive source', 'apps/runtime/dist/src/main.js': 'synthetic entry',
    'apps/runtime/dist/src/build-identity.js': 'synthetic retained stamp', 'apps/runtime/src/main.ts': 'synthetic source',
    'packages/sdk/package.json': JSON.stringify({name: '@synthetic/sdk'}), 'packages/sdk/dist/index.js': 'synthetic SDK',
    'node_modules/.package-lock.json': 'synthetic lock', 'node_modules/native/binding.node': 'synthetic native',
    'node_modules/native/peer.node': 'synthetic native'};
  for (const [name, bytes] of Object.entries(content)) {
    await mkdir(join(running, name, '..'), {recursive: true, mode: 0o700});
    await writeFile(join(running, name), bytes, {mode: 0o600});
  }
  await mkdir(join(running, 'node_modules/@synthetic'), {mode: 0o700});
  await symlink('../../packages/sdk', join(running, 'node_modules/@synthetic/sdk'));
  await symlink('../../apps/runtime', join(running, 'node_modules/@synthetic/runtime'));
  await symlink('../../apps/inactive', join(running, 'node_modules/@synthetic/inactive'));
  await mkdir(join(running, 'node_modules/.bin'), {mode: 0o700});
  await symlink('../@synthetic/sdk/dist/index.js', join(running, 'node_modules/.bin/synthetic-sdk'));
  await mkdir(join(running, '.git'), {mode: 0o700});
  await writeFile(join(running, '.git/private-marker'), 'unrelated untouched', {mode: 0o600});
  await mkdir(join(root, 'node-dir'), {mode: 0o700}); await mkdir(join(root, 'unit-dir'), {mode: 0o700});
  const node = join(root, 'node-dir/node'), unit = join(root, 'unit-dir/unit');
  await writeFile(node, 'synthetic executable', {mode: 0o600}); await writeFile(unit, 'synthetic unit', {mode: 0o600});
  const script = `import {inventory,canonical,sha256} from './apps/hub/dist/install/files.js';
import {runtimeExecutionEntries,runtimeWorkspaceMap} from './apps/runtime/bin/runtime-upgrade-baseline.mjs';
const entries=(await inventory(process.argv[1])).entries.filter(e=>!e.path.startsWith('.git'));
const inputs=entries.filter(e=>['apps/runtime/src/main.ts','packages/sdk/package.json'].includes(e.path)).map(e=>({path:e.path,sha256:e.sha256}));
process.stdout.write(JSON.stringify({entries,inputs,digest:sha256(canonical(runtimeExecutionEntries(entries,inputs,await runtimeWorkspaceMap({root:process.argv[1],entries}))))}));`;
  const result = await run(process.execPath, ['--input-type=module', '-e', script, running], {cwd: process.cwd()});
  const parsed = JSON.parse(result.stdout) as {entries: unknown[]; inputs: unknown[]; digest: string};
  const previous = {kind: 'release', sourceRevision: 'a'.repeat(40), version: '0.1.0', archiveSha256: 'b'.repeat(64), manifestSha256: 'c'.repeat(64)};
  const owner = {entry: join(running, 'apps/runtime/dist/src/main.js'), executable: node, units: [unit]};
  const document = {schema: 'runtime-installed-closure/2.0', scope: 'runtime-execution-closure/1.0', installationId: 'synthetic', protectedHooks: [],
    previous, runningRoot: running, entry: owner.entry, inventorySha256: parsed.digest,
    node: {path: node, sha256: hash('synthetic executable')}, units: [{path: unit, sha256: hash('synthetic unit')}]};
  const closure = join(root, 'closure.json'); const bytes = JSON.stringify(document); await writeFile(closure, bytes, {mode: 0o600});
  const input = {path: closure, pin: {path: closure, sha256: hash(bytes)}, installationId: 'synthetic', owner,
    previous: {root: running, identity: previous, entries: parsed.entries, inputs: parsed.inputs}};
  const inspect = async (value: unknown = input, mutation = '') => run(process.execPath, ['--input-type=module', '-e',
    `import {createRuntimeBaselineInspector} from './apps/runtime/bin/runtime-upgrade-baseline.mjs';
import {link,rm,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
const input=JSON.parse(process.argv[1]);
const inspect=createRuntimeBaselineInspector({beforeFileOpen:async name=>{if(process.argv[2]==='fifo' && name===join(input.previous.root,'node_modules/native/binding.node')) {
await rm(name);execFileSync('/usr/bin/mkfifo',[name],{timeout:1000});}},beforeFinalCheck:async()=>{if(process.argv[2]==='late-native') await writeFile(join(input.previous.root,'node_modules/native/binding.node'),'late mutation');
if(process.argv[2]==='late-alias') await link(join(input.previous.root,'node_modules/native/binding.node'),join(input.previous.root,'../unadmitted-alias'));}});
try {process.stdout.write(JSON.stringify(await inspect(input)));}
catch {process.stdout.write('baseline-refused');process.exitCode=2;}`, JSON.stringify(value), mutation], {cwd: process.cwd(), timeout: 5000});
  assert.equal((JSON.parse((await inspect()).stdout) as {baselineRoot: string}).baselineRoot, running);
  await t.test('hard links require every alias inside the verified file set', async () => {
    const native = join(running, 'node_modules/native/binding.node');
    const peer = join(running, 'node_modules/native/peer.node');
    const outside = join(root, 'unadmitted-alias');
    await rm(peer); await link(native, peer);
    assert.equal((JSON.parse((await inspect()).stdout) as {baselineRoot: string}).baselineRoot, running);
    await link(native, outside); await assert.rejects(inspect()); await rm(outside);
    await assert.rejects(inspect(input, 'late-alias')); await rm(outside);
    await rm(peer); await writeFile(peer, 'synthetic native', {mode: 0o600});
  });
  await t.test('extra dependency files refuse', async () => {
    const extra = join(running, 'node_modules/shadow.js'); await writeFile(extra, 'shadow', {mode: 0o600});
    await assert.rejects(inspect()); await rm(extra);
  });
  await t.test('changed native and built bytes refuse', async () => {
    for (const name of ['node_modules/native/binding.node', 'packages/sdk/dist/index.js']) {
      await writeFile(join(running, name), 'changed', {mode: 0o600}); await assert.rejects(inspect());
      await writeFile(join(running, name), content[name] ?? '', {mode: 0o600});
    }
  });
  await t.test('wrong closure pin or external executable bytes refuse', async () => {
    await assert.rejects(inspect({...input, pin: {...input.pin, sha256: 'd'.repeat(64)}}));
    await writeFile(node, 'changed executable', {mode: 0o600}); await assert.rejects(inspect());
    await writeFile(node, 'synthetic executable', {mode: 0o600});
    await writeFile(unit, 'changed unit', {mode: 0o600}); await assert.rejects(inspect());
    await writeFile(unit, 'synthetic unit', {mode: 0o600});
  });
  await t.test('changed and escaping workspace links refuse', async () => {
    const link = join(running, 'node_modules/@synthetic/sdk'); await rm(link); await symlink('../../../', link);
    await assert.rejects(inspect()); await rm(link); await symlink('../../packages/sdk', link);
  });
  await t.test('missing dependencies and substituted build timestamps refuse', async () => {
    const native = join(running, 'node_modules/native/binding.node'); await rm(native);
    await assert.rejects(inspect()); await writeFile(native, content['node_modules/native/binding.node'] ?? '', {mode: 0o600});
    const stamp = join(running, 'apps/runtime/dist/src/build-identity.js'); await writeFile(stamp, 'fresh substituted stamp', {mode: 0o600});
    await assert.rejects(inspect()); await writeFile(stamp, content['apps/runtime/dist/src/build-identity.js'] ?? '', {mode: 0o600});
  });
  await t.test('a closure cannot select a different release or omit an observed unit', async () => {
    for (const change of [{previous: {...previous, manifestSha256: 'd'.repeat(64)}}, {units: []}]) {
      const changed = JSON.stringify({...document, ...change}); await writeFile(closure, changed, {mode: 0o600});
      await assert.rejects(inspect({...input, pin: {...input.pin, sha256: hash(changed)}}));
    }
    await writeFile(closure, bytes, {mode: 0o600});
  });
  await t.test('new workspace-local dependency shadows refuse', async () => {
    for (const prefix of ['packages/sdk', 'apps/runtime']) {
      const shadow = join(running, prefix, 'node_modules'); await mkdir(shadow, {mode: 0o700});
      await writeFile(join(shadow, 'shadow.js'), 'shadow', {mode: 0o600});
      await assert.rejects(inspect()); await rm(shadow, {recursive: true});
    }
  });
  await t.test('an earlier dependency changed during later inspection refuses', async () => {
    await assert.rejects(inspect(input, 'late-native'));
    await writeFile(join(running, 'node_modules/native/binding.node'), content['node_modules/native/binding.node'] ?? '', {mode: 0o600});
  });
  await t.test('a file replaced by a FIFO refuses without blocking on open', async () => {
    await assert.rejects(inspect(input, 'fifo'), (error: unknown) => {
      assert.equal((error as {stdout?: string}).stdout, 'baseline-refused');
      assert.equal((error as {killed?: boolean}).killed, false);
      return true;
    });
    const native = join(running, 'node_modules/native/binding.node'); await rm(native);
    await writeFile(native, 'synthetic native', {mode: 0o600});
  });
  assert.equal(await readFile(join(running, '.git/private-marker'), 'utf8'), 'unrelated untouched');
});
