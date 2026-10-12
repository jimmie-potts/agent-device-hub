import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {validateInstallReceipt} from '@jimmie-potts/device-contracts';
import {inspectUpgradeReceipts, inspectUpgradeState} from '../src/upgrade-inputs.js';

void test('upgrade state inspection covers configured and retained owners without opening their databases', async t => {
  const root = await mkdtemp(join(tmpdir(), 'bunny-upgrade-inputs-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const state = join(root, 'state');
  const modules = join(state, 'modules');
  await mkdir(modules, {recursive: true, mode: 0o700});
  const core = join(modules, 'core.sqlite');
  await writeFile(core, 'opaque synthetic database', {mode: 0o600});
  await writeFile(join(modules, 'core.sqlite-owner'), '', {mode: 0o600});
  await writeFile(join(modules, 'pixoo.sqlite-wal'), 'opaque retained state', {mode: 0o600});
  await mkdir(join(modules, 'pixoo'), {mode: 0o700});
  const configFile = join(root, 'runtime.json');
  const config = JSON.stringify({schema: 'runtime-config/1.0', modules: {playback: {secret: 'synthetic-secret'}, 'codex-desktop': {}}});
  await writeFile(configFile, config, {mode: 0o600});
  const before = await lstat(core);
  assert.deepEqual(await inspectUpgradeState(state, configFile), {
    configSha256: createHash('sha256').update(config).digest('hex'),
    configured: ['codex-desktop', 'playback'], durableOwners: ['core', 'pixoo', 'playback'],
  });
  const after = await lstat(core);
  assert.equal(after.atimeMs, before.atimeMs);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(after.size, before.size);

  await t.test('unknown configured or retained owners refuse rather than omitting their state', async () => {
    await writeFile(configFile, JSON.stringify({schema: 'runtime-config/1.0', modules: {'unknown-owner': {}}}), {mode: 0o600});
    await assert.rejects(inspectUpgradeState(state, configFile), /^Error: runtime-upgrade-inputs-refused$/);
    await writeFile(configFile, config, {mode: 0o600});
    const unknown = join(modules, 'unknown-owner.sqlite');
    await writeFile(unknown, 'retained opaque state', {mode: 0o600});
    await assert.rejects(inspectUpgradeState(state, configFile), /^Error: runtime-upgrade-inputs-refused$/);
    assert.equal(await readFile(unknown, 'utf8'), 'retained opaque state');
    await rm(unknown);
  });
  await t.test('Roborock configuration and retained state remain outside the qualified profile', async () => {
    await writeFile(configFile, JSON.stringify({schema: 'runtime-config/1.0', modules: {roborock: {id: 'roborock', configurationRevision: 0}}}), {mode: 0o600});
    await assert.rejects(inspectUpgradeState(state, configFile), /^Error: runtime-upgrade-inputs-refused$/);
    await writeFile(configFile, config, {mode: 0o600});
    for (const name of ['roborock.sqlite', 'roborock.sqlite-wal', 'roborock']) {
      const path = join(modules, name);
      if (name === 'roborock') await mkdir(path, {mode: 0o700});
      else await writeFile(path, 'retained synthetic Roborock state', {mode: 0o600});
      try {
        await assert.rejects(inspectUpgradeState(state, configFile), /^Error: runtime-upgrade-inputs-refused$/);
        if (name !== 'roborock') assert.equal(await readFile(path, 'utf8'), 'retained synthetic Roborock state');
      } finally {await rm(path, {recursive: true});}
    }
  });
  await t.test('unqualified Roborock configuration and retained state refuse without modification', async () => {
    await writeFile(configFile, JSON.stringify({schema: 'runtime-config/1.0', modules: {roborock: {id: 'vacuum'}}}), {mode: 0o600});
    await assert.rejects(inspectUpgradeState(state, configFile), /^Error: runtime-upgrade-inputs-refused$/);
    await writeFile(configFile, config, {mode: 0o600});
    for (const name of ['roborock.sqlite', 'roborock.sqlite-wal', 'roborock']) {
      const path = join(modules, name);
      if (name === 'roborock') await mkdir(path, {mode: 0o700});
      else await writeFile(path, 'retained synthetic Roborock state', {mode: 0o600});
      try {
        await assert.rejects(inspectUpgradeState(state, configFile), /^Error: runtime-upgrade-inputs-refused$/);
        if (name !== 'roborock') assert.equal(await readFile(path, 'utf8'), 'retained synthetic Roborock state');
      } finally {await rm(path, {recursive: true});}
    }
  });
  await t.test('ONN configuration and retained state are inventoried without database reads or modification', async () => {
    await writeFile(configFile, JSON.stringify({schema: 'runtime-config/1.0', modules: {onn: {}}}), {mode: 0o600});
    assert.ok((await inspectUpgradeState(state, configFile)).durableOwners.includes('onn'));
    await writeFile(configFile, config, {mode: 0o600});
    for (const name of ['onn.sqlite', 'onn.sqlite-wal', 'onn.sqlite-shm', 'onn.sqlite-journal', 'onn.sqlite-owner', 'onn']) {
      const path = join(modules, name);
      if (name === 'onn') await mkdir(path, {mode: 0o700});
      else await writeFile(path, 'retained synthetic ONN state', {mode: 0o600});
      try {
        const before = await lstat(path);
        if (name === 'onn.sqlite-owner') {
          await assert.rejects(inspectUpgradeState(state, configFile), /^Error: runtime-upgrade-inputs-refused$/);
        } else {
          assert.ok((await inspectUpgradeState(state, configFile)).durableOwners.includes('onn'));
        }
        const after = await lstat(path);
        assert.equal(after.atimeMs, before.atimeMs);
        assert.equal(after.mtimeMs, before.mtimeMs);
        assert.equal(after.size, before.size);
        assert.equal(after.mode, before.mode);
        if (name !== 'onn') assert.equal(await readFile(path, 'utf8'), 'retained synthetic ONN state');
      } finally {await rm(path, {recursive: true});}
    }
  });
  await t.test('companion files are inventoried without opening them or accepting an unsupported lease', async () => {
    await writeFile(configFile, JSON.stringify({schema: 'runtime-config/1.0', modules: {companions: {}}}), {mode: 0o600});
    try {
      await assert.rejects(inspectUpgradeState(state, configFile), /^Error: runtime-upgrade-inputs-refused$/);
      const database = join(modules, 'companions.sqlite');
      await writeFile(database, 'opaque companion database', {mode: 0o600});
      assert.ok((await inspectUpgradeState(state, configFile)).durableOwners.includes('companions'));
      await rm(database);
      await assert.rejects(inspectUpgradeState(state, configFile), /^Error: runtime-upgrade-inputs-refused$/);
    }
    finally {await writeFile(configFile, config, {mode: 0o600});}
    for (const name of ['companions.sqlite', 'companions.sqlite-wal', 'companions.sqlite-shm',
      'companions.sqlite-journal', 'companions.sqlite-owner', 'companions']) {
      const path = join(modules, name);
      const primary = join(modules, 'companions.sqlite');
      if (name !== 'companions.sqlite') await writeFile(primary, 'opaque synthetic primary state', {mode: 0o600});
      if (name === 'companions') await mkdir(path, {mode: 0o700});
      else await writeFile(path, 'opaque synthetic companion state', {mode: 0o600});
      try {
        const before = await lstat(path);
        if (name.endsWith('-owner')) {
          await assert.rejects(inspectUpgradeState(state, configFile), /^Error: runtime-upgrade-inputs-refused$/);
        } else {
          assert.ok((await inspectUpgradeState(state, configFile)).durableOwners.includes('companions'));
        }
        const after = await lstat(path);
        assert.equal(after.atimeMs, before.atimeMs);
        assert.equal(after.mtimeMs, before.mtimeMs);
        assert.equal(after.size, before.size);
        assert.equal(after.mode, before.mode);
        if (name !== 'companions') assert.equal(await readFile(path, 'utf8'), 'opaque synthetic companion state');
      } finally {
        await rm(path, {recursive: true});
        if (name !== 'companions.sqlite') await rm(primary);
      }
    }
  });
  await t.test('companion sidecars cannot mask a missing primary database', async () => {
    const database = join(modules, 'companions.sqlite'), wal = database + '-wal';
    await writeFile(database, 'opaque companion database', {mode: 0o600});
    await writeFile(wal, 'opaque companion sidecar', {mode: 0o600});
    await writeFile(configFile, JSON.stringify({schema: 'runtime-config/1.0', modules: {companions: {}}}), {mode: 0o600});
    try {
      assert.ok((await inspectUpgradeState(state, configFile)).durableOwners.includes('companions'));
      await rm(database);
      await assert.rejects(inspectUpgradeState(state, configFile), /^Error: runtime-upgrade-inputs-refused$/);
      assert.equal(await readFile(wal, 'utf8'), 'opaque companion sidecar');
    } finally {
      await rm(database, {force: true}); await rm(wal); await writeFile(configFile, config, {mode: 0o600});
    }
  });
  await t.test('non-private database permissions refuse without changing them', async () => {
    await chmod(core, 0o644);
    await assert.rejects(inspectUpgradeState(state, configFile), /^Error: runtime-upgrade-inputs-refused$/);
    assert.equal((await lstat(core)).mode & 0o777, 0o644);
    await chmod(core, 0o600);
  });
  await t.test('a linked module folder refuses without following it', async () => {
    await symlink(join(root, 'unrelated'), join(modules, 'playback'));
    await assert.rejects(inspectUpgradeState(state, configFile), /^Error: runtime-upgrade-inputs-refused$/);
    assert.equal((await lstat(join(modules, 'playback'))).isSymbolicLink(), true);
  });
});

void test('receipt inspection binds settled operations to their installation and exact file identity', async t => {
  const root = await mkdtemp(join(tmpdir(), 'bunny-upgrade-receipts-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const fixtures = JSON.parse(await readFile(join(process.cwd(), 'packages/contracts/fixtures/install-receipt-v1.json'), 'utf8')) as {
    cases: {id: string; value: Record<string, unknown>}[];
  };
  const value = fixtures.cases.find(row => row.id === 'upgrade-success')?.value;
  assert.ok(value);
  assert.ok(typeof value.installationId === 'string');
  assert.ok(typeof value.operationId === 'string');
  const bytes = JSON.stringify(value);
  const name = value.operationId + '.json';
  await writeFile(join(root, name), bytes, {mode: 0o600});
  assert.deepEqual(await inspectUpgradeReceipts(root, value.installationId, validateInstallReceipt),
    [{name, sha256: createHash('sha256').update(bytes).digest('hex')}]);

  await t.test('a receipt changed during inspection refuses even when its filename is unchanged', async () => {
    const changed = JSON.stringify({...value, outcome: 'in-progress'});
    try {
      await assert.rejects(inspectUpgradeReceipts(root, value.installationId as string, candidate => {
        const valid = validateInstallReceipt(candidate);
        // Deterministically simulate a concurrent writer after the initial read.
        writeFileSync(join(root, name), changed, {mode: 0o600});
        return valid;
      }), /^Error: runtime-upgrade-inputs-refused$/);
      assert.equal(await readFile(join(root, name), 'utf8'), changed);
    } finally {
      await writeFile(join(root, name), bytes, {mode: 0o600});
    }
  });

  await t.test('valid in-progress and unresolved terminal outcomes refuse before eligibility', async () => {
    for (const id of ['durable-intent', 'failed-rollback', 'interrupted-recovery', 'final-receipt-write-failure']) {
      const unresolved = fixtures.cases.find(row => row.id === id)?.value;
      assert.ok(unresolved);
      assert.equal(validateInstallReceipt(unresolved), true, 'the fixture must be schema-valid');
      assert.ok(typeof unresolved.operationId === 'string' && typeof unresolved.installationId === 'string');
      await rm(join(root, name));
      const unresolvedName = unresolved.operationId + '.json';
      await writeFile(join(root, unresolvedName), JSON.stringify(unresolved), {mode: 0o600});
      await assert.rejects(inspectUpgradeReceipts(root, unresolved.installationId, validateInstallReceipt),
        /^Error: runtime-upgrade-inputs-refused$/);
      await rm(join(root, unresolvedName));
      await writeFile(join(root, name), bytes, {mode: 0o600});
    }
  });
  await t.test('a different installation refuses', async () => {
    await assert.rejects(inspectUpgradeReceipts(root, 'another-installation', validateInstallReceipt),
      /^Error: runtime-upgrade-inputs-refused$/);
  });
  await t.test('a mismatched operation filename refuses', async () => {
    await writeFile(join(root, 'different-operation.json'), bytes, {mode: 0o600});
    await assert.rejects(inspectUpgradeReceipts(root, value.installationId as string, validateInstallReceipt),
      /^Error: runtime-upgrade-inputs-refused$/);
    await rm(join(root, 'different-operation.json'));
  });
  await t.test('an unfinished temporary receipt file requires inspection', async () => {
    await writeFile(join(root, '.receipt-next-fixture'), 'partial receipt', {mode: 0o600});
    await assert.rejects(inspectUpgradeReceipts(root, value.installationId as string, validateInstallReceipt),
      /^Error: runtime-upgrade-inputs-refused$/);
    assert.equal(await readFile(join(root, '.receipt-next-fixture'), 'utf8'), 'partial receipt');
  });
});
