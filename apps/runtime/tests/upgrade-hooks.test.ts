import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chmod, mkdir, mkdtemp, readFile, readlink, rm, rmdir, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {createUpgradeHookInspector, inspectUpgradeProtectedHooks} from '../src/upgrade-hooks.js';
const hash = (bytes: string) => createHash('sha256').update(bytes).digest('hex');

void test('protected hooks bind exact qualified links and script bytes without rewriting them', async t => {
  const root = await mkdtemp(join(tmpdir(), 'bunny-upgrade-hooks-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const installation = join(root, 'installation'), producer = join(root, 'producer');
  await mkdir(installation, {mode: 0o700}); await mkdir(producer, {mode: 0o700});
  await mkdir(join(producer, 'bin'), {mode: 0o700});
  const source = join(producer, 'bin/hook.mjs'); await writeFile(source, 'synthetic hook', {mode: 0o600});
  const directoryLink = join(root, 'directory-hook'); await symlink('producer', directoryLink);
  const fileLink = join(root, 'file-hook'); await symlink(source, fileLink);
  const hooks = [{path: directoryLink, kind: 'directory-link', target: 'producer', scripts: [{path: join(directoryLink, 'bin/hook.mjs'), resolvedPath: source, sha256: hash('synthetic hook')}]},
    {path: fileLink, kind: 'file-link', target: source, scripts: [{path: fileLink, resolvedPath: source, sha256: hash('synthetic hook')}]}];
  const closure = join(root, 'closure.json');
  const document = {schema: 'runtime-installed-closure/2.0', installationId: 'synthetic', protectedHooks: hooks};
  const store = async (value: unknown = document) => {const bytes = JSON.stringify(value); await writeFile(closure, bytes, {mode: 0o600}); return {path: closure, sha256: hash(bytes)};};
  const pin = await store(); const input = {installationRoot: installation, installationId: 'synthetic', pin};
  const refusal = /^Error: runtime-upgrade-hooks-refused$/;
  assert.equal((await inspectUpgradeProtectedHooks(input)).hooks.length, 2);
  await t.test('a missing or changed admitted hook list refuses', async () => {
    await store({...document, protectedHooks: []}); await assert.rejects(inspectUpgradeProtectedHooks(input), refusal);
    const omitted = await store({schema: document.schema, installationId: document.installationId});
    await assert.rejects(inspectUpgradeProtectedHooks({...input, pin: omitted}), refusal); await store();
  });
  await t.test('changed link target or link shape refuses without repair', async () => {
    await rm(directoryLink); await symlink(installation, directoryLink);
    await assert.rejects(inspectUpgradeProtectedHooks(input), refusal); assert.equal(await readlink(directoryLink), installation);
    await rm(directoryLink); await mkdir(directoryLink, {mode: 0o700});
    await assert.rejects(inspectUpgradeProtectedHooks(input), refusal); await rmdir(directoryLink); await symlink('producer', directoryLink);
  });
  await t.test('changed script bytes and unsafe permissions refuse', async () => {
    await writeFile(source, 'changed'); await assert.rejects(inspectUpgradeProtectedHooks(input), refusal);
    await writeFile(source, 'synthetic hook'); await chmod(source, 0o666);
    await assert.rejects(inspectUpgradeProtectedHooks(input), refusal); await chmod(source, 0o600);
  });
  await t.test('script paths must be exact invocations through the qualified link', async () => {
    for (const change of [{path: source}, {resolvedPath: join(root, 'wrong')}, {sha256: 'a'.repeat(64)}]) {
      const changed = await store({...document, protectedHooks: [{...hooks[0], scripts: [{...hooks[0]?.scripts[0], ...change}]}]});
      await assert.rejects(inspectUpgradeProtectedHooks({...input, pin: changed}), refusal);
    }
    await store();
  });
  await t.test('hooks and resolved producers cannot overlap installation storage', async () => {
    await assert.rejects(inspectUpgradeProtectedHooks({...input, installationRoot: producer}), refusal);
    await assert.rejects(inspectUpgradeProtectedHooks({...input, installationRoot: root}), refusal);
  });
  await t.test('duplicate entries and unknown fields cannot conceal coverage', async () => {
    for (const protectedHooks of [[hooks[0], hooks[0]], [{...hooks[0], accepted: true}], [{...hooks[0], scripts: [hooks[0]?.scripts[0], hooks[0]?.scripts[0]]}]]) {
      const changed = await store({...document, protectedHooks});
      await assert.rejects(inspectUpgradeProtectedHooks({...input, pin: changed}), refusal);
    }
    await store();
  });
  await t.test('late script or closure drift refuses against original evidence', async () => {
    const inspector = createUpgradeHookInspector({beforeFinalCheck: async () => {await writeFile(source, 'late mutation');}});
    await assert.rejects(inspector(input), refusal); await writeFile(source, 'synthetic hook');
    const changed = createUpgradeHookInspector({beforeFinalCheck: async () => {await store({...document, protectedHooks: []});}});
    await assert.rejects(changed(input), refusal); await store();
  });
  await t.test('a link changed during the final script read refuses', async () => {
    let calls = 0;
    const inspector = createUpgradeHookInspector({afterScriptRead: async () => {
      if (++calls === 3) {await rm(directoryLink); await symlink(installation, directoryLink);}
    }});
    await assert.rejects(inspector(input), refusal);
    await rm(directoryLink); await symlink('producer', directoryLink);
  });
  assert.equal(await readFile(source, 'utf8'), 'synthetic hook');
  assert.equal(await readlink(directoryLink), 'producer');
});
