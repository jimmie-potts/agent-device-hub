import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chmod, link, mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {parseArguments} from '../src/process.js';
import type {UpgradeOwner} from '../src/upgrade-owner.js';
import {inspectUpgradePaths, inspectUpgradeExecution, inspectUpgradeRunningPaths, parseUpgradeRequest, renderUpgradeAdoptionDraft} from '../src/upgrade-paths.js';

void test('request binds operational choices and refuses missing or unbounded execution frames', () => {
  const root = '/synthetic/install';
  const pin = {path: root + '/provenance/effects.json', sha256: 'a'.repeat(64)};
  const execution = {operationId: 'synthetic-upgrade', backupDirectory: root + '/backups/synthetic-upgrade',
    stopTimeoutMs: 30000, postStart: {attempts: 5, timeoutMs: 15000, intervalMs: 500},
    startupEffects: {assessment: pin, authority: pin}, adoption: null};
  const artifact = {identity: root + '/identity', directory: root + '/release', archive: root + '/archive'};
  const document = {schema: 'runtime-upgrade-request/1.0', operation: 'upgrade', installationId: 'synthetic',
    installationRoot: root, tokenFile: '/synthetic/token', admissionFile: root + '/provenance/admission',
    installedBaselineClosureFile: root + '/provenance/closure', qualificationRevision: 'a'.repeat(40),
    releases: {previous: artifact, target: artifact, recovery: artifact},
    formatInventoryFiles: {previous: root + '/p', target: root + '/t', recovery: root + '/r', qualification: root + '/q'}, execution};
  assert.deepEqual(parseUpgradeRequest(document), document);
  const longerObservation = {...document, execution: {...execution,
    postStart: {...execution.postStart, timeoutMs: 180000}}};
  assert.deepEqual(parseUpgradeRequest(longerObservation), longerObservation);
  for (const timeoutMs of [0, 999, 180001, Infinity, NaN, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => parseUpgradeRequest({...longerObservation, execution: {...longerObservation.execution,
      postStart: {...longerObservation.execution.postStart, timeoutMs}}}), /^Error: runtime-upgrade-paths-refused$/);
  }
  const missing: Partial<typeof document> = {...document};
  delete missing.execution;
  for (const value of [missing, {...document, execution: {...execution, stopTimeoutMs: 0}},
    {...document, execution: {...execution, backupDirectory: '/synthetic/state'}},
    {...document, execution: {...execution, postStart: {...execution.postStart, attempts: 0}}},
    {...document, execution: {...execution, passed: true}}]) {
    assert.throws(() => parseUpgradeRequest(value), /^Error: runtime-upgrade-paths-refused$/);
  }
});

void test('upgrade paths preserve the direct baseline for adoption and require the previous anchor for upgrades', async t => {
  const root = await mkdtemp(join(tmpdir(), 'bunny-upgrade-paths-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const installation = join(root, 'installation');
  for (const name of ['', 'releases', 'provenance', 'receipts', 'backups']) await mkdir(join(installation, name), {mode: 0o700});
  await writeFile(join(installation, 'install.lock'), '', {mode: 0o600});
  const previous = 'a'.repeat(40), target = 'b'.repeat(40);
  const previousRoot = join(installation, 'releases', previous), targetRoot = join(installation, 'releases', target);
  for (const directory of [previousRoot, targetRoot, join(root, 'direct'), join(root, 'state')]) await mkdir(directory, {mode: 0o700});
  const files = {config: join(root, 'config'), token: join(root, 'token'), credentials: join(root, 'credentials'), node: join(root, 'node'), unit: join(root, 'bunny-runtime.service')};
  for (const path of Object.values(files)) await writeFile(path, 'synthetic', {mode: 0o600});
  const owner: UpgradeOwner = {service: 'bunny-runtime.service', pid: 1, startMonotonic: '1', startTicks: '1',
    units: [files.unit], controlGroup: '/synthetic', executable: files.node, cwd: join(root, 'direct'),
    entry: join(root, 'direct/apps/runtime/dist/src/main.js'), argv: [],
    options: parseArguments(['--port', '8788', '--state-dir', join(root, 'state'), '--config', files.config, '--edge', '--environment', 'production'])};
  owner.argv = [owner.executable, owner.entry, '--port', '8788'];
  const artifact = (directory: string) => ({identity: join(root, 'identity'), directory, archive: join(root, 'archive')});
  const document = {schema: 'runtime-upgrade-request/1.0', operation: 'adoption', installationId: 'synthetic',
    installationRoot: installation, tokenFile: files.token, admissionFile: join(installation, 'provenance/admission.json'),
    installedBaselineClosureFile: join(installation, 'provenance/closure.json'), qualificationRevision: target,
    releases: {previous: artifact(previousRoot), target: artifact(targetRoot), recovery: artifact(previousRoot)},
    formatInventoryFiles: {previous: join(root, 'p.json'), target: join(root, 't.json'), recovery: join(root, 'r.json'), qualification: join(root, 'q.json')},
    execution: {operationId: 'synthetic', backupDirectory: join(installation, 'backups/synthetic'), stopTimeoutMs: 30000,
      postStart: {attempts: 5, timeoutMs: 15000, intervalMs: 500},
      startupEffects: {assessment: {path: join(installation, 'provenance/effects'), sha256: 'a'.repeat(64)},
        authority: {path: join(installation, 'provenance/authority'), sha256: 'b'.repeat(64)}},
      adoption: {draftFile: join(installation, 'provenance/draft'), overrideFile: join(root, 'bunny-runtime.service.d/anchor.conf'),
        originals: [{path: join(installation, 'provenance/original'), sha256: 'c'.repeat(64)}],
        restoration: {path: join(installation, 'provenance/restoration'), sha256: 'd'.repeat(64)}}}};
  const upgradeDocument = {...document, operation: 'upgrade', execution: {...document.execution, adoption: null}};
  const request = parseUpgradeRequest(document);
  await t.test('operational evidence is pinned privately and changed bytes refuse', async () => {
    const bytes = 'synthetic approved operational evidence\n';
    const pins = [...Object.values(request.execution.startupEffects),
      ...(request.execution.adoption === null ? [] : [...request.execution.adoption.originals, request.execution.adoption.restoration])];
    for (const pin of pins) {
      pin.sha256 = createHash('sha256').update(bytes).digest('hex');
      await writeFile(pin.path, bytes, {mode: 0o600});
    }
    assert.deepEqual(await inspectUpgradeExecution(request), request.execution);
    const authority = request.execution.startupEffects.authority;
    await writeFile(authority.path, 'changed authority', {mode: 0o600});
    await assert.rejects(inspectUpgradeExecution(request), /^Error: runtime-upgrade-paths-refused$/);
    await writeFile(authority.path, bytes, {mode: 0o600});
    assert.deepEqual(await inspectUpgradeExecution(request), request.execution);
  });
  const verified = {previous: previousRoot, target: targetRoot, recovery: previousRoot, baselineRoot: owner.cwd,
    revisions: {previous, target, recovery: previous}};
  const result = await inspectUpgradePaths(request, owner, verified, files.credentials);
  assert.equal(result.selection.kind, 'absent');
  assert.equal(result.directories.length, 7);
  await t.test('occupied operational destinations refuse before any service or backup action', async () => {
    await mkdir(request.execution.backupDirectory, {mode: 0o700});
    await assert.rejects(inspectUpgradePaths(request, owner, verified, files.credentials), /^Error: runtime-upgrade-paths-refused$/);
    await rm(request.execution.backupDirectory, {recursive: true});
    assert.ok(request.execution.adoption);
    await writeFile(request.execution.adoption.draftFile, 'retained foreign draft', {mode: 0o600});
    await assert.rejects(inspectUpgradePaths(request, owner, verified, files.credentials), /^Error: runtime-upgrade-paths-refused$/);
    await rm(request.execution.adoption.draftFile);
    await writeFile(request.execution.adoption.draftFile, renderUpgradeAdoptionDraft(installation, owner), {mode: 0o600});
    assert.deepEqual(await inspectUpgradePaths(request, owner, verified, files.credentials), result);
    await rm(request.execution.adoption.draftFile);
  });
  assert.equal((await inspectUpgradePaths(parseUpgradeRequest(upgradeDocument),
    {...owner, cwd: previousRoot, entry: join(previousRoot, 'apps/runtime/dist/src/main.js')},
    {...verified, baselineRoot: previousRoot}, files.credentials).then(() => 'unexpected', () => 'refused')), 'refused');
  await symlink(previousRoot, join(installation, 'current'));
  const anchoredOwner = {...owner, cwd: previousRoot, entry: join(previousRoot, 'apps/runtime/dist/src/main.js')};
  assert.equal((await inspectUpgradePaths(parseUpgradeRequest(upgradeDocument), anchoredOwner,
    {...verified, baselineRoot: previousRoot}, files.credentials)).selection.kind, 'previous');
  await t.test('the fixed current entry resolves to the verified previous execution file', async () => {
    await mkdir(join(previousRoot, 'apps/runtime/dist/src'), {recursive: true, mode: 0o700});
    await writeFile(join(previousRoot, 'apps/runtime/dist/src/main.js'), 'synthetic entry', {mode: 0o600});
    const currentOwner = {...anchoredOwner, entry: join(installation, 'current/apps/runtime/dist/src/main.js')};
    assert.equal((await inspectUpgradePaths(parseUpgradeRequest(upgradeDocument), currentOwner,
      {...verified, baselineRoot: previousRoot}, files.credentials)).selection.kind, 'previous');
  });
  await t.test('post-start paths bind the target, original paths and exact adoption override', async () => {
    assert.ok(request.execution.adoption);
    const adoption = request.execution.adoption;
    await mkdir(join(targetRoot, 'apps/runtime/dist/src'), {recursive: true, mode: 0o700});
    await writeFile(join(targetRoot, 'apps/runtime/dist/src/main.js'), 'synthetic target entry', {mode: 0o600});
    await mkdir(join(root, 'bunny-runtime.service.d'), {mode: 0o700});
    const override = renderUpgradeAdoptionDraft(installation, owner);
    await writeFile(adoption.overrideFile, override, {mode: 0o600});
    await rm(join(installation, 'current')); await symlink(targetRoot, join(installation, 'current'));
    const runningOwner = {...owner, cwd: targetRoot, entry: join(installation, 'current/apps/runtime/dist/src/main.js'),
      units: [...owner.units, adoption.overrideFile].sort()};
    const approved = {owner, paths: result};
    assert.equal((await inspectUpgradeRunningPaths(request, runningOwner, approved, targetRoot)).target, targetRoot);
    await assert.rejects(inspectUpgradeRunningPaths(request, runningOwner, approved, previousRoot), /^Error: runtime-upgrade-paths-refused$/);
    await assert.rejects(inspectUpgradeRunningPaths(request, {...runningOwner, cwd: previousRoot}, approved, targetRoot), /^Error: runtime-upgrade-paths-refused$/);
    await writeFile(adoption.overrideFile, override + 'Environment=EXTRA=1\n');
    await assert.rejects(inspectUpgradeRunningPaths(request, runningOwner, approved, targetRoot), /^Error: runtime-upgrade-paths-refused$/);
    await writeFile(adoption.overrideFile, override);
    await chmod(files.config, 0o644);
    await assert.rejects(inspectUpgradeRunningPaths(request, runningOwner, approved, targetRoot), /^Error: runtime-upgrade-paths-refused$/);
    await chmod(files.config, 0o600);
    assert.equal((await inspectUpgradeRunningPaths(request, runningOwner, approved, targetRoot)).target, targetRoot);
    await rm(join(root, 'bunny-runtime.service.d'), {recursive: true});
    await rm(join(installation, 'current')); await symlink(previousRoot, join(installation, 'current'));
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
