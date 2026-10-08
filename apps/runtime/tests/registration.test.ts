// How the runtime collects module registrations (Hub #999): the build writes one static import of each module's
// registration from `modules/*/package.json`, and the shipped list puts the core first, then every shipped module by its
// `after` constraints, its order and its name. A list that breaks a rule fails to assemble.
import assert from 'node:assert/strict';
import {mkdir, readdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {ModuleRegistration} from '@jimmie-potts/sdk';
import {moduleFolders, registrySource} from '../build/registry.js';
import {CORE_MODULE, orderModules, registrations, shippedList, shippedModules} from '../src/index.js';
import {it, stateDir} from './support.js';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** A registration with no module behind it, for the ordering rules. */
const registered = (name: string, order: number, more: Partial<ModuleRegistration> = {}): ModuleRegistration => ({
  name, order, shipped: true,
  create: () => { throw new Error('not built'); }, simulate: () => { throw new Error('not built'); },
  ...more,
});
const names = (list: readonly {name: string}[]): string[] => list.map(({name}) => name);

it('the shipped list holds the core first, then every shipped registration the build collected', () => {
  assert.equal(shippedModules[0]?.name, CORE_MODULE);
  assert.deepEqual(names(shippedModules), [CORE_MODULE, ...names(orderModules(registrations))]);
  assert.deepEqual(names(shippedModules).slice(1).sort(), names(registrations.filter(({shipped}) => shipped)).sort());
});

it('modules start by order, then by name, and an after constraint comes before order', () => {
  const list = [registered('zeta', 10), registered('alpha', 30), registered('beta', 10), registered('gamma', 5, {after: ['alpha']})];
  assert.deepEqual(names(orderModules(list)), ['beta', 'zeta', 'alpha', 'gamma']);
  assert.deepEqual(names(shippedList(list)), [CORE_MODULE, 'beta', 'zeta', 'alpha', 'gamma']);
});

it('a module that does not ship is left out, wherever its order would place it', () => {
  assert.deepEqual(names(shippedList([registered('beta', 20), registered('alpha', 10, {shipped: false})])), [CORE_MODULE, 'beta']);
});

it('the core stays first: a registration may not take its name, and an order below every other one still starts after it', () => {
  assert.throws(() => shippedList([registered(CORE_MODULE, 1)]), /the core is not a registration/);
  assert.deepEqual(names(shippedList([registered('early', Number.MIN_SAFE_INTEGER)])), [CORE_MODULE, 'early']);
});

it('a list that names one module twice, names an unknown or unshipped module after, or loops, fails to assemble', () => {
  assert.throws(() => orderModules([registered('alpha', 1), registered('alpha', 2)]), /alpha is registered twice/);
  assert.throws(() => orderModules([registered('alpha', 1, {after: ['nowhere']})]), /alpha starts after nowhere, which does not ship/);
  assert.throws(() => orderModules([registered('alpha', 1, {after: ['beta']}), registered('beta', 2, {shipped: false})]), /which does not ship/);
  assert.throws(() => orderModules([registered('alpha', 1, {after: ['beta']}), registered('beta', 2, {after: ['alpha']})]), /alpha, beta wait on each other/);
  assert.throws(() => orderModules([registered('alpha', Number.NaN)]), /alpha's order is not a number/);
});

it('the registry the build writes imports each module folder\'s registration, in folder order, and nothing else', async context => {
  const root = await stateDir(context);
  for (const [folder, name] of [['zz-probe', '@jimmie-potts/zz-probe'], ['alpha', '@jimmie-potts/alpha']] as const) {
    await mkdir(join(root, 'modules', folder), {recursive: true});
    await writeFile(join(root, 'modules', folder, 'package.json'), JSON.stringify({name}));
  }
  // A folder without a package is no module.
  await mkdir(join(root, 'modules', 'notes'), {recursive: true});
  assert.deepEqual(moduleFolders(root), ['alpha', 'zz-probe']);
  const source = registrySource(root);
  assert.deepEqual([...source.matchAll(/^import \{registration as (m\d+)\} from "([^"]+)";$/gm)].map(match => [match[1], match[2]]),
    [['m0', '@jimmie-potts/alpha'], ['m1', '@jimmie-potts/zz-probe']]);
  assert.match(source, /^export const REGISTRATIONS = Object\.freeze\(\[m0, m1\]\);$/m);
});

it('the build collected every module folder in this checkout', async () => {
  const folders = [];
  for (const entry of await readdir(join(ROOT, 'modules'), {withFileTypes: true})) {
    if (entry.isDirectory() && (await readdir(join(ROOT, 'modules', entry.name))).includes('package.json')) folders.push(entry.name);
  }
  assert.deepEqual(moduleFolders(ROOT), folders.sort());
  assert.equal(registrations.length, folders.length);
});
