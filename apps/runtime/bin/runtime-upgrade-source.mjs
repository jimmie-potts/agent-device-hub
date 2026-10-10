// Pure source evidence adapter: no release code, installer or service is run.
import {lstat} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {canonical, digest, fullRevision, hashRegular, inventory, readRegular, sha256} from '../../hub/dist/install/files.js';
import {checkStateDirectory, readPrivateFile} from '../dist/src/state.js';
const maximum = 256 * 1024;

export async function verifyRuntimeUpgradeRelease(input, directory, archive) {
  // The procedure supplies trusted build evidence. Hash agreement alone does
  // not establish merged source, archive extraction safety or host acceptance.
  const identity = JSON.parse((await readPrivateFile(input, maximum)).toString('utf8'));
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)
    || Object.keys(identity).sort().join(',') !== 'archiveSha256,kind,manifestSha256,sourceRevision,version'
    || identity.kind !== 'release' || !fullRevision(identity.sourceRevision)
    || !digest(identity.archiveSha256) || !digest(identity.manifestSha256)
    || typeof identity.version !== 'string' || !identity.version || identity.version.length > 128 || /[\r\n]/.test(identity.version)) {
    throw new Error('install-source-identity');
  }
  const root = await checkStateDirectory(directory);
  const manifestBytes = await readPrivateFile(join(root, 'manifest.json'), 8 * 1024 * 1024);
  // Compare the exact manifest bytes before interpreting its declarations.
  if (sha256(manifestBytes) !== identity.manifestSha256) throw new Error('install-manifest-hash');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
    || Object.keys(manifest).sort().join(',') !== 'artifact,inventory,sourceRevision,version'
    || manifest.artifact !== '@jimmie-potts/runtime' || manifest.sourceRevision !== identity.sourceRevision
    || manifest.version !== identity.version || !Array.isArray(manifest.inventory)) throw new Error('install-source-identity');
  const actual = await inventory(root);
  const entries = actual.entries.filter(entry => entry.path !== 'manifest.json');
  if (canonical(entries) !== canonical(manifest.inventory)) throw new Error('install-file-inventory');
  await checkStateDirectory(dirname(archive));
  const info = await lstat(archive);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.uid !== process.getuid() || (info.mode & 0o077) !== 0) {
    throw new Error('unsafe-install-file');
  }
  if (await hashRegular(archive) !== identity.archiveSha256) throw new Error('install-archive-hash');
  return {identity, root, entries};
}

const scope = 'runtime-durable-formats/1.0';
const refused = () => { throw new Error('runtime-upgrade-source-refused'); };
const operatorFiles = new Set([
  // These tools inspect delivery evidence or package the app-verification
  // consumer. Runtime/build entry points do not import or execute them.
  // Keep unknown scripts and runtime artifact generators conservative inputs.
  'scripts/package-app-verify.mjs',
  ...['ci', 'cli', 'context', 'preflight', 'receipts', 'report', 'records']
    .map(name => `scripts/delivery-preflight/${name}.mjs`),
  'apps/runtime/bin/runtime-upgrade-check.mjs', 'apps/runtime/bin/runtime-upgrade-source.mjs',
  'apps/runtime/bin/runtime-upgrade-baseline.mjs',
  'apps/runtime/bin/runtime-upgrade-preflight.mjs',
  'apps/runtime/src/upgrade-admission.ts', 'apps/runtime/src/upgrade-http.ts',
  'apps/runtime/src/upgrade-inputs.ts', 'apps/runtime/src/upgrade-listener.ts',
  'apps/runtime/src/upgrade-lock.ts', 'apps/runtime/src/upgrade-owner.ts', 'apps/runtime/src/upgrade-paths.ts',
  'apps/runtime/src/upgrade-hooks.ts',
  'apps/runtime/src/upgrade-preflight.ts',
]);
const rootInputs = new Set(['.nvmrc', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'tsconfig.strict.json']);
const required = ['.nvmrc', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.strict.json',
  'apps/runtime/package.json', 'apps/runtime/tsconfig.json', 'apps/runtime/src/main.ts', 'apps/runtime/src/launch.ts',
  'apps/runtime/src/process.ts', 'apps/runtime/src/modules.ts', 'apps/runtime/src/state.ts', 'apps/runtime/src/core/store.ts',
  'apps/runtime/build/registry.ts', 'apps/runtime/dashboard/build.mjs', 'packages/sdk/src/database.ts', 'packages/sdk/src/outbox.ts',
  'packages/agent-state/package.json', 'packages/contracts/package.json', 'packages/event-contracts/package.json',
  ...['playback', 'nanoleaf', 'pixoo', 'tidbyt', 'lifx'].map(name => `modules/${name}/package.json`),
  'controllers/lifx/package.json', 'controllers/tidbyt/package.json'];
const closed = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && canonical(Object.keys(value).sort()) === canonical([...keys].sort());
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\r\n\0]/.test(value);

function selected(path) {
  if (operatorFiles.has(path)) return false;
  if (rootInputs.has(path)) return true;
  if (path.startsWith('apps/runtime/src/') || path.startsWith('apps/runtime/build/')
    || path === 'apps/runtime/package.json' || path === 'apps/runtime/tsconfig.json'
    || path === 'apps/runtime/dashboard/build.mjs') return true;
  if (/^(packages|modules|controllers)\//.test(path)) {
    if (path.split('/').some(part => ['tests', 'test', 'fixtures', 'docs', 'dist', 'node_modules', '__pycache__', '.pytest_cache'].includes(part))
      || /\.(md|pyc)$/.test(path)) return false;
    return true;
  }
  return path.startsWith('scripts/') && !path.split('/').some(part => ['tests', 'fixtures', 'vendor'].includes(part))
    && /\.(mjs|cjs|js|ts|py)$/.test(path);
}

export function runtimeFormatInputs(entries) {
  const inputs = [];
  for (const entry of entries) {
    if (!selected(entry.path) || entry.kind === 'directory') continue;
    if (entry.kind !== 'file' || !digest(entry.sha256)) refused();
    inputs.push({path: entry.path, sha256: entry.sha256});
  }
  inputs.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (inputs.length === 0 || inputs.length > 10000 || new Set(inputs.map(item => item.path)).size !== inputs.length
    || required.some(path => !inputs.some(item => item.path === path))) refused();
  return inputs;
}

async function buildStamp(release) {
  const path = 'apps/runtime/dist/src/build-identity.js';
  const entry = release.entries.find(item => item.path === path);
  if (entry?.kind !== 'file' || !digest(entry.sha256)) refused();
  const bytes = await readRegular(join(release.root, path), 8192);
  if (sha256(bytes) !== entry.sha256) refused();
  const source = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  const prefix = 'export const BUILD_IDENTITY = Object.freeze(';
  const suffix = ');\n';
  if (!source.startsWith(prefix) || !source.endsWith(suffix)) refused();
  const stamp = JSON.parse(source.slice(prefix.length, -suffix.length));
  if (!closed(stamp, ['schema', 'version', 'revision', 'dirty', 'builtAt'])
    || stamp.schema !== 'runtime-build/2.0' || stamp.dirty !== false
    || stamp.revision !== release.identity.sourceRevision || stamp.version !== release.identity.version
    || typeof stamp.builtAt !== 'string' || stamp.builtAt.length !== 24) refused();
  const instant = Date.parse(stamp.builtAt);
  if (!Number.isFinite(instant) || new Date(instant).toISOString() !== stamp.builtAt) refused();
  const pkg = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(await readRegular(join(release.root, 'apps/runtime/package.json'), maximum)));
  if (pkg?.name !== '@jimmie-potts/runtime' || pkg?.version !== stamp.version) refused();
  return stamp;
}

async function inventoryPin(path, revision, inputs) {
  const bytes = await readPrivateFile(path, 8 * 1024 * 1024);
  const value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  if (!closed(value, ['schema', 'scope', 'sourceRevision', 'inputs']) || value.schema !== 'runtime-format-input-inventory/1.0'
    || value.scope !== scope || value.sourceRevision !== revision || canonical(value.inputs) !== canonical(inputs)) refused();
  return {path, sha256: sha256(bytes)};
}

/** The bin supplies the pure verifier; no JSON field selects an implementation. */
export function createUpgradeSourceAdapter(verify) {
  return async input => {
    try {
      if (!closed(input, ['installationId', 'provenanceDirectory', 'releases', 'qualificationRevision', 'formatInventoryFiles'])
        || !text(input.installationId) || input.installationId.length > 128 || !text(input.provenanceDirectory)
        || !fullRevision(input.qualificationRevision) || !closed(input.releases, ['previous', 'target', 'recovery'])
        || !closed(input.formatInventoryFiles, ['previous', 'target', 'recovery', 'qualification'])) refused();
      await checkStateDirectory(input.provenanceDirectory);
      const releases = {}, stamps = {}, inputs = {}, artifacts = {};
      for (const name of ['previous', 'target', 'recovery']) {
        const paths = input.releases[name];
        if (!closed(paths, ['identity', 'directory', 'archive']) || !Object.values(paths).every(text)) refused();
        const release = await verify(paths.identity, paths.directory, paths.archive);
        releases[name] = release.identity;
        stamps[name] = await buildStamp(release);
        inputs[name] = runtimeFormatInputs(release.entries);
        artifacts[name] = release;
      }
      if (canonical(inputs.previous) !== canonical(inputs.target) || canonical(inputs.previous) !== canonical(inputs.recovery)) refused();
      const inventorySha256 = sha256(Buffer.from(canonical({scope, inputs: inputs.previous})));
      const inventories = {};
      for (const name of ['previous', 'target', 'recovery', 'qualification']) {
        const path = input.formatInventoryFiles[name];
        if (!text(path)) refused();
        inventories[name] = await inventoryPin(path, name === 'qualification' ? input.qualificationRevision : releases[name].sourceRevision, inputs.previous);
      }
      return {expected: {installationId: input.installationId, provenanceDirectory: input.provenanceDirectory, releases,
        formats: {scope, qualificationRevision: input.qualificationRevision, inventorySha256, inventories}}, stamps, inputs: inputs.previous, artifacts};
    } catch { return refused(); }
  };
}
