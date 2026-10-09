import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {test, type TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {moduleFrontends} from '../build/frontend.js';
import * as registry from '../build/registry.js';

async function workspace(context: TestContext): Promise<string> {
  const scratch = fileURLToPath(new URL('../../../../.local/scratch/frontend-build/', import.meta.url));
  await mkdir(scratch, {recursive: true});
  const root = await mkdtemp(join(scratch, 'workspace-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, 'modules', 'alpha'), {recursive: true});
  await mkdir(join(root, 'node_modules', '@jimmie-potts'), {recursive: true});
  await symlink(join(root, 'modules', 'alpha'), join(root, 'node_modules', '@jimmie-potts', 'alpha'));
  await writeFile(join(root, 'modules', 'alpha', 'package.json'), JSON.stringify({
    name: '@jimmie-potts/alpha', type: 'module', exports: {'.': './server.js', './frontend': './frontend.ts'},
  }));
  await writeFile(join(root, 'modules', 'alpha', 'server.js'),
    'import {readFileSync} from "node:fs"; export const registration = {read: readFileSync};\n');
  await writeFile(join(root, 'modules', 'alpha', 'frontend.ts'),
    'export const frontend = {module: "alpha", pages: [{id: "library", Component: () => null}]};\n');
  return root;
}

async function bundle(root: string) {
  return build({
    stdin: {contents: 'export {FRONTENDS} from "@bunny/module-frontends";', resolveDir: root, sourcefile: 'entry.js'},
    bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true, logLevel: 'silent',
    plugins: [moduleFrontends(root)],
  });
}

void test('collects an explicit browser entry and never imports its Node registration', async context => {
  const root = await workspace(context);
  const collector = (registry as Partial<{frontendSource: (root: string) => string}>).frontendSource;
  assert.ok(collector, 'the build must expose a static frontend collector');
  const result = await bundle(root);
  assert.ok(Object.keys(result.metafile.inputs).some(path => path.endsWith('/frontend.ts')));
  assert.ok(!Object.keys(result.metafile.inputs).some(path => path.endsWith('/server.js')));
  const output = result.outputFiles[0];
  assert.ok(output);
  const bundled = await import(`data:text/javascript;base64,${Buffer.from(output.contents).toString('base64')}`) as {
    FRONTENDS: readonly {module: string; pages: readonly {id: string; Component: () => unknown}[]}[];
  };
  assert.ok(Object.isFrozen(bundled.FRONTENDS));
  assert.equal(bundled.FRONTENDS.length, 1);
  const frontend = bundled.FRONTENDS[0];
  assert.ok(frontend);
  assert.equal(frontend.module, 'alpha');
  assert.equal(frontend.pages[0]?.id, 'library');
  assert.equal(frontend.pages[0]?.Component(), null);
});

void test('discovers only explicit frontend exports in folder order, including browser conditions', async context => {
  const root = await workspace(context);
  for (const name of ['zeta', 'gamma']) {
    await mkdir(join(root, 'modules', name));
    await symlink(join(root, 'modules', name), join(root, 'node_modules', '@jimmie-potts', name));
    await writeFile(join(root, 'modules', name, 'package.json'), JSON.stringify({
      name: `@jimmie-potts/${name}`, type: 'module', exports: {
        '.': './server.js',
        ...(name === 'zeta' ? {'./frontend': {browser: './frontend.ts', default: './server.js'}} : {}),
      },
    }));
    await writeFile(join(root, 'modules', name, 'frontend.ts'),
      `export const frontend = {module: ${JSON.stringify(name)}, pages: []};\n`);
    await writeFile(join(root, 'modules', name, 'server.js'), 'import "node:fs";\n');
  }
  const source = registry.frontendSource(root);
  assert.ok(source.indexOf('@jimmie-potts/alpha/frontend') < source.indexOf('@jimmie-potts/zeta/frontend'));
  assert.ok(!source.includes('@jimmie-potts/gamma'));
  const result = await bundle(root);
  const inputs = Object.keys(result.metafile.inputs);
  assert.ok(inputs.some(path => path.endsWith('/zeta/frontend.ts')));
  assert.ok(!inputs.some(path => path.includes('/gamma/') || path.endsWith('/server.js')));
});

void test('bundles an empty frontend collection when no package opts in', async context => {
  const root = await workspace(context);
  await writeFile(join(root, 'modules', 'alpha', 'package.json'), JSON.stringify({
    name: '@jimmie-potts/alpha', type: 'module', exports: {'.': './server.js'},
  }));
  const result = await bundle(root);
  assert.ok(!Object.keys(result.metafile.inputs).some(path => path.includes('/modules/')));
  const output = result.outputFiles[0];
  assert.ok(output);
  const bundled = await import(`data:text/javascript;base64,${Buffer.from(output.contents).toString('base64')}`) as {
    FRONTENDS: readonly unknown[];
  };
  assert.deepEqual(bundled.FRONTENDS, []);
  assert.ok(Object.isFrozen(bundled.FRONTENDS));
});

void test('rejects a frontend that imports its Node implementation', async context => {
  const root = await workspace(context);
  await writeFile(join(root, 'modules', 'alpha', 'frontend.ts'),
    'export {registration as frontend} from "./server.js";\n');
  await assert.rejects(bundle(root), /Could not resolve "node:fs"/);
});

void test('rejects a malformed workspace name before generating frontend imports', async context => {
  const root = await workspace(context);
  await writeFile(join(root, 'modules', 'alpha', 'package.json'), JSON.stringify({
    name: '@other/alpha', exports: {'./frontend': './frontend.ts'},
  }));
  assert.throws(() => registry.frontendSource(root), /names no workspace package/);
});
