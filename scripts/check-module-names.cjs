// Fails when a file every module story would otherwise edit names a device module (Hub #999). Each module registers
// itself from its own folder, and the runtime and both scenario harnesses collect the registrations, so these shared
// files name only the core and fixture modules, except the explicit file-fixture references below. A module's name is its folder under
// `modules/`, in any letter case, with its hyphens written as hyphens, spaces or nothing (`codex-desktop`, `Codex
// Desktop`, `codexDesktop`). Run from the repository root: `node scripts/check-module-names.cjs`.
const fs = require('node:fs');
const path = require('node:path');

/** The shared files, by path from the repository root. */
const SHARED_FILES = [
  'apps/runtime/src/modules.ts',
  'apps/runtime/src/registry.d.ts',
  'apps/runtime/build/registry.ts',
  'apps/runtime/tests/scenarios/catalog.ts',
  'apps/runtime/tests/scenarios/framework.ts',
  'apps/runtime/tests/scenarios/memory.ts',
  'apps/runtime/tests/scenarios/parts.ts',
  'apps/runtime/verify/adapter.ts',
  'apps/runtime/verify/child.ts',
  'apps/runtime/verify/link.ts',
  'apps/runtime/verify/paths.ts',
  'apps/runtime/verify/plugin.ts',
  'apps/runtime/verify/protocol.ts',
  'apps/runtime/verify/seed.ts',
  'apps/runtime/verify/supervisor.ts',
];

/**
 * #927 uses selected synthetic collector files, not a device transport. The owner deferred a generic fixture loader
 * in #999 and permits coordinated shared-file edits. Keep this exception confined to its two harnesses and seed;
 * production module discovery, the catalog and every other module still use the original registration rule.
 */
const FIXTURE_REFERENCES = Object.freeze({
  'apps/runtime/tests/scenarios/framework.ts': ['wispr'],
  'apps/runtime/tests/scenarios/memory.ts': ['wispr'],
  'apps/runtime/verify/child.ts': ['wispr'],
  'apps/runtime/verify/seed.ts': ['wispr'],
});

// These exact build-identity literals name a shared contract package, not a device-module registration.
const BUILD_CONTRACT_PATHS = [
  'packages/wispr-contracts/dist', ':(glob)packages/wispr-contracts/src/**',
  'packages/wispr-contracts/dist/index.js', 'packages/wispr-contracts/dist/query.js',
];

/** The device modules: each folder under `modules/` that holds a `package.json`, in name order. */
function moduleNames(root) {
  const modules = path.join(root, 'modules');
  if (!fs.existsSync(modules)) return [];
  return fs.readdirSync(modules, {withFileTypes: true})
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(modules, entry.name, 'package.json')))
    .map(entry => entry.name)
    .sort();
}

/** Every spelling of a module's name, as a whole word in any letter case. */
function spellings(name) {
  const parts = name.split('-').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(?<![a-z0-9])${parts.join('[- ]?')}(?![a-z0-9])`, 'i');
}

/** Each line of a shared file that names a module, as `{file, line, name}`. */
function findModuleNames(root, files = SHARED_FILES) {
  const names = moduleNames(root).map(name => ({name, pattern: spellings(name)}));
  const found = [];
  for (const file of files) {
    const lines = fs.readFileSync(path.join(root, file), 'utf8').split('\n');
    lines.forEach((text, index) => {
      if (file === 'apps/runtime/verify/plugin.ts') {
        for (const contractPath of BUILD_CONTRACT_PATHS) text = text.replaceAll(`'${contractPath}'`, "''");
      }
      for (const {name, pattern} of names) if (pattern.test(text) && !FIXTURE_REFERENCES[file]?.includes(name)) found.push({file, line: index + 1, name});
    });
  }
  return found;
}

module.exports = {SHARED_FILES, FIXTURE_REFERENCES, findModuleNames, moduleNames, spellings};

if (require.main === module) {
  const found = findModuleNames(path.resolve(__dirname, '..'));
  for (const {file, line, name} of found) process.stderr.write(`${file}:${line} names the module ${name}; the module registers itself from its own folder\n`);
  if (found.length > 0) process.exitCode = 1;
}
