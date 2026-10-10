import assert from 'node:assert/strict';
import {chmod, link, mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {parseArguments} from '../src/process.js';
import type {UpgradeOwner} from '../src/upgrade-owner.js';
import {inspectUpgradePaths, parseUpgradeRequest} from '../src/upgrade-paths.js';

void test('upgrade paths preserve the direct baseline for adoption and require the previous anchor for upgrades', async t => {
  const root = await mkdtemp(join(tmpdir(), 'bunny-upgrade-paths-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const installation = join(root, 'installation');
  for (const name of ['', 'releases', 'provenance', 'receipts', 'backups']) await mkdir(join(installation, name), {mode: 0o700});
  await writeFile(join(installation, 'install.lock'), '', {mode: 0o600});
  const previous = 'a'.repeat(40), target = 'b'.repeat(40);
  const previousRoot = join(installation, 'releases', previous), targetRoot = join(installation, 'releases', target);
  for (const directory of [previousRoot, targetRoot, join(root, 'direct'), join(root, 'state')]) await mkdir(directory, {mode: 0o700});
  const files = {config: join(root, 'config'), token: join(root, 'token'), credentials: join(root, 'credentials'), node: join(root, 'node'), unit: join(root, 'unit')};
  for (const path of Object.values(files)) await writeFile(path, 'synthetic', {mode: 0o600});
  const owner: UpgradeOwner = {service: 'bunny-runtime.service', pid: 1, startMonotonic: '1', startTicks: '1',
    units: [files.unit], controlGroup: '/synthetic', executable: files.node, cwd: join(root, 'direct'),
    entry: join(root, 'direct/apps/runtime/dist/src/main.js'), argv: [],
    options: parseArguments(['--port', '8788', '--state-dir', join(root, 'state'), '--config', files.config, '--edge', '--environment', 'production'])};
  const artifact = (directory: string) => ({identity: join(root, 'identity'), directory, archive: join(root, 'archive')});
  const document = {schema: 'runtime-upgrade-request/1.0', operation: 'adoption', installationId: 'synthetic',
    installationRoot: installation, tokenFile: files.token, admissionFile: join(installation, 'provenance/admission.json'),
    installedBaselineClosureFile: join(installation, 'provenance/closure.json'), qualificationRevision: target,
    releases: {previous: artifact(previousRoot), target: artifact(targetRoot), recovery: artifact(previousRoot)},
    formatInventoryFiles: {previous: join(root, 'p.json'), target: join(root, 't.json'), recovery: join(root, 'r.json'), qualification: join(root, 'q.json')}};
  const request = parseUpgradeRequest(document);
  const verified = {previous: previousRoot, target: targetRoot, recovery: previousRoot, baselineRoot: owner.cwd,
    revisions: {previous, target, recovery: previous}};
  const result = await inspectUpgradePaths(request, owner, verified, files.credentials);
  assert.equal(result.selection.kind, 'absent');
  assert.equal(result.directories.length, 7);
  assert.equal((await inspectUpgradePaths(parseUpgradeRequest({...document, operation: 'upgrade'}),
    {...owner, cwd: previousRoot, entry: join(previousRoot, 'apps/runtime/dist/src/main.js')},
    {...verified, baselineRoot: previousRoot}, files.credentials).then(() => 'unexpected', () => 'refused')), 'refused');
  await symlink(previousRoot, join(installation, 'current'));
  const anchoredOwner = {...owner, cwd: previousRoot, entry: join(previousRoot, 'apps/runtime/dist/src/main.js')};
  assert.equal((await inspectUpgradePaths(parseUpgradeRequest({...document, operation: 'upgrade'}), anchoredOwner,
    {...verified, baselineRoot: previousRoot}, files.credentials)).selection.kind, 'previous');
  await t.test('the fixed current entry resolves to the verified previous execution file', async () => {
    await mkdir(join(previousRoot, 'apps/runtime/dist/src'), {recursive: true, mode: 0o700});
    await writeFile(join(previousRoot, 'apps/runtime/dist/src/main.js'), 'synthetic entry', {mode: 0o600});
    const currentOwner = {...anchoredOwner, entry: join(installation, 'current/apps/runtime/dist/src/main.js')};
    assert.equal((await inspectUpgradePaths(parseUpgradeRequest({...document, operation: 'upgrade'}), currentOwner,
      {...verified, baselineRoot: previousRoot}, files.credentials)).selection.kind, 'previous');
  });
  await t.test('foreign current refuses without changing its target', async () => {
    await rm(join(installation, 'current')); await symlink(targetRoot, join(installation, 'current'));
    await assert.rejects(inspectUpgradePaths(request, owner, verified, files.credentials), /^Error: runtime-upgrade-paths-refused$/);
    await rm(join(installation, 'current')); await symlink(previousRoot, join(installation, 'current'));
  });
  await t.test('mutable paths cannot overlap release storage', async () => {
    await assert.rejects(inspectUpgradePaths(request, {...owner, options: {...owner.options, stateDir: previousRoot}}, verified,
      files.credentials), /^Error: runtime-upgrade-paths-refused$/);
  });
  await t.test('unknown request fields cannot claim acceptance', () => {
    assert.throws(() => parseUpgradeRequest({...document, passed: true}), /^Error: runtime-upgrade-paths-refused$/);
    assert.throws(() => parseUpgradeRequest({...document, tokenFile: files.token + '/../token'}), /^Error: runtime-upgrade-paths-refused$/);
  });
  await t.test('a dangling current is not an absent adoption anchor', async () => {
    await rm(join(installation, 'current')); await symlink(join(root, 'missing'), join(installation, 'current'));
    await assert.rejects(inspectUpgradePaths(request, owner, verified, files.credentials), /^Error: runtime-upgrade-paths-refused$/);
    await rm(join(installation, 'current')); await symlink(previousRoot, join(installation, 'current'));
  });
  await t.test('wrong release placement and execution entry refuse', async () => {
    await assert.rejects(inspectUpgradePaths(request, owner, {...verified, target: previousRoot}, files.credentials), /^Error: runtime-upgrade-paths-refused$/);
    await assert.rejects(inspectUpgradePaths(request, {...owner, entry: join(root, 'foreign-main.js')}, verified, files.credentials), /^Error: runtime-upgrade-paths-refused$/);
  });
  await t.test('public operation directories refuse without changing permissions', async () => {
    const backups = join(installation, 'backups');
    await chmod(backups, 0o755);
    await assert.rejects(inspectUpgradePaths(request, owner, verified, files.credentials), /^Error: runtime-upgrade-paths-refused$/);
    await chmod(backups, 0o700);
  });
  await t.test('linked protected inputs refuse', async () => {
    const linked = join(root, 'linked-token'); await symlink(files.token, linked);
    await assert.rejects(inspectUpgradePaths(parseUpgradeRequest({...document, tokenFile: linked}), owner, verified,
      files.credentials), /^Error: runtime-upgrade-paths-refused$/);
  });
  await t.test('secret input roles require private single-link regular files', async () => {
    await chmod(files.token, 0o644);
    await assert.rejects(inspectUpgradePaths(request, owner, verified, files.credentials), /^Error: runtime-upgrade-paths-refused$/);
    await chmod(files.token, 0o600);
    const alias = join(root, 'token-hardlink'); await link(files.token, alias);
    await assert.rejects(inspectUpgradePaths(request, owner, verified, files.credentials), /^Error: runtime-upgrade-paths-refused$/);
    await rm(alias);
    await rm(files.credentials); await mkdir(files.credentials, {mode: 0o700});
    await assert.rejects(inspectUpgradePaths(request, owner, verified, files.credentials), /^Error: runtime-upgrade-paths-refused$/);
    await rm(files.credentials, {recursive: true}); await writeFile(files.credentials, 'synthetic', {mode: 0o600});
  });
  await t.test('unexpected installation entries remain untouched', async () => {
    await writeFile(join(installation, 'foreign'), 'retained', {mode: 0o600});
    await assert.rejects(inspectUpgradePaths(request, owner, verified, files.credentials), /^Error: runtime-upgrade-paths-refused$/);
  });
});
