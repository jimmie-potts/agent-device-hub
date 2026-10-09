// Writes the runtime's module registry (Hub #999): `node apps/runtime/dist/build/registry.js`, which the build runs
// after compiling the runtime. Every folder under `modules/` with a `package.json` is a module whose package exports
// `registration`; the registry imports each one statically, in folder order, so the runtime and its harnesses collect
// the modules without a list that names them, and the runtime loads nothing at run time (ADR 0012).
import {existsSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

/** Where the registry goes, under the checkout's root; `src/registry.d.ts` types it. */
export const REGISTRY_FILE = 'apps/runtime/dist/src/registry.js';
/** A workspace package name, which the registry imports. */
const PACKAGE = /^@jimmie-potts\/[a-z0-9][a-z0-9-]*$/;

/** The module folders under `root/modules`: each folder with a `package.json`, in name order. */
export function moduleFolders(root: string): string[] {
  const modules = join(root, 'modules');
  if (!existsSync(modules)) return [];
  return readdirSync(modules, {withFileTypes: true})
    .filter(entry => entry.isDirectory() && existsSync(join(modules, entry.name, 'package.json')))
    .map(entry => entry.name)
    .sort();
}

function modulePackages(root: string): {name: string; exports?: unknown}[] {
  return moduleFolders(root).map(folder => {
    const {name, exports} = JSON.parse(readFileSync(join(root, 'modules', folder, 'package.json'), 'utf8')) as {name?: unknown; exports?: unknown};
    if (typeof name !== 'string' || !PACKAGE.test(name)) throw new Error(`modules/${folder}/package.json names no workspace package`);
    return {name, exports};
  });
}

/** The registry's source: one import of each module folder's package's `registration`, and the frozen list of them. */
export function registrySource(root: string): string {
  const packages = modulePackages(root).map(({name}) => name);
  return [
    '// Written by apps/runtime/build/registry.ts from modules/*/package.json when the runtime is built; do not edit.',
    ...packages.map((name, index) => `import {registration as m${index}} from ${JSON.stringify(name)};`),
    `export const REGISTRATIONS = Object.freeze([${packages.map((_, index) => `m${index}`).join(', ')}]);`,
    '',
  ].join('\n');
}

/** Browser imports for modules that explicitly export `./frontend`; never imports their Node registrations. */
export function frontendSource(root: string): string {
  const packages = modulePackages(root)
    .filter(entry => typeof entry.exports === 'object' && entry.exports !== null && !Array.isArray(entry.exports)
      && Object.hasOwn(entry.exports, './frontend'))
    .map(({name}) => `${name}/frontend`);
  return [
    '// Collected from explicit module package frontend exports at build time; do not edit.',
    ...packages.map((name, index) => `import {frontend as f${index}} from ${JSON.stringify(name)};`),
    `export const FRONTENDS = Object.freeze([${packages.map((_, index) => `f${index}`).join(', ')}]);`,
    '',
  ].join('\n');
}

/** Writes the registry for the checkout at `root`. */
export function writeRegistry(root: string): void {
  writeFileSync(join(root, REGISTRY_FILE), registrySource(root));
}

// Run as a program from the built `dist/build/registry.js`: the checkout's root is four folders up.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeRegistry(fileURLToPath(new URL('../../../../', import.meta.url)));
}
