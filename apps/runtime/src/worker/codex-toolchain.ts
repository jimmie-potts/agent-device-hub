import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, symlink, writeFile} from 'node:fs/promises';
import {basename, dirname, join} from 'node:path';
import {promisify} from 'node:util';
import {prepareStateDirectory} from '../state.js';
import {checkoutIdentity, sameCheckout} from './writer-proof.js';

const GIT = '/Library/Developer/CommandLineTools/usr/bin/git';
const OPENSSL = '/System/Library/OpenSSL/openssl.cnf';

type GitView = {root: string; bin: string; readable: readonly string[]};
export type CodexToolchain = {bin: string; readable: readonly string[]; gitView?: GitView};

export const codexToolchainVariables = (bin: string): Record<string, string> => ({
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_OPTIONAL_LOCKS: '0',
  npm_config_userconfig: join(bin, 'user.npmrc'),
  npm_config_globalconfig: join(bin, 'global.npmrc'),
  npm_config_offline: 'true',
  npm_config_update_notifier: 'false',
  npm_config_logs_max: '0',
});

export const CODEX_TOOLCHAIN_REFUSAL =
  'Codex could not use the worker’s Node 24 distribution with npm and Apple Command Line Tools Git inside its worktree. Check the selected toolchain and worker profile.';

const exists = (error: unknown): boolean => error instanceof Error && 'code' in error && error.code === 'EEXIST';
const execute = promisify(execFile);

async function trustedFile(path: string, executable: boolean): Promise<void> {
  const info = await lstat(path);
  if (await realpath(path) !== path || !info.isFile() || info.nlink !== 1 ||
    (info.uid !== 0 && info.uid !== process.getuid?.()) || (info.mode & 0o022) !== 0 ||
    executable && (info.mode & 0o111) === 0) throw new Error('unsafe Codex toolchain file');
}

/** Resolve the host Node distribution and stage only the reviewed command names in the private worker profile. */
export async function prepareCodexToolchain(home: string): Promise<CodexToolchain> {
  if (process.platform !== 'darwin' || !process.versions.node.startsWith('24.')) throw new Error('unsupported Codex toolchain');
  const node = await realpath(process.execPath);
  const npmRoot = join(dirname(dirname(node)), 'lib/node_modules/npm');
  const npm = join(npmRoot, 'bin/npm-cli.js');
  const original = dirname(node);
  if (basename(node) !== 'node' || await realpath(join(original, 'npm')) !== npm) throw new Error('unsupported Node distribution');
  const npmInfo = await lstat(npmRoot);
  if (!npmInfo.isDirectory() || await realpath(npmRoot) !== npmRoot ||
    (npmInfo.uid !== 0 && npmInfo.uid !== process.getuid?.()) || (npmInfo.mode & 0o022) !== 0) throw new Error('unsafe npm installation');
  await Promise.all([trustedFile(node, true), trustedFile(npm, true), trustedFile(GIT, true), trustedFile(OPENSSL, false)]);
  const entries = {node, npm, git: GIT};
  const identity = createHash('sha256').update(JSON.stringify(entries)).digest('hex').slice(0, 24);
  const bin = await prepareStateDirectory(join(home, 'toolchain', identity));
  await Promise.all(Object.entries(entries).map(async ([name, target]) => {
    const link = join(bin, name);
    try {await symlink(target, link);}
    catch (error) {if (!exists(error)) throw error;}
    const info = await lstat(link);
    if (!info.isSymbolicLink() || info.uid !== process.getuid?.() || await readlink(link) !== target) {
      throw new Error('unsafe Codex toolchain link');
    }
  }));
  for (const name of ['user.npmrc', 'global.npmrc']) {
    const file = join(bin, name);
    try {await writeFile(file, '', {flag: 'wx', mode: 0o600});}
    catch (error) {if (!exists(error)) throw error;}
    await trustedFile(file, false);
    if ((await lstat(file)).size !== 0) throw new Error('unexpected npm configuration');
  }
  if ((await readdir(bin)).sort().join(',') !== 'git,global.npmrc,node,npm,user.npmrc') throw new Error('unexpected Codex toolchain entry');
  return {bin, readable: [node, npmRoot, GIT, OPENSSL]};
}

const GIT_ENV = {PATH: '/Library/Developer/CommandLineTools/usr/bin:/usr/bin:/bin',
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0'};

function gitLauncher(cwd: string, metadata: string, index: string, headFile: string, head: string): string {
  return `#!/usr/bin/env node
const {spawnSync} = require('node:child_process');
const {readFileSync} = require('node:fs');
const [command, ...args] = process.argv.slice(2);
if (command !== 'status' && command !== 'diff' && !(command === '--version' && args.length === 0)) {
  process.stderr.write('The linked Codex checkout supports read-only git status and git diff.\\n');
  process.exit(2);
}
if (readFileSync(${JSON.stringify(headFile)}, 'utf8').trim() !== ${JSON.stringify(head)}) {
  process.stderr.write('The linked Codex checkout HEAD changed.\\n');
  process.exit(1);
}
const separator = args.indexOf('--');
const position = separator < 0 ? args.length : separator;
if (command === 'diff') args.splice(position, 0, '--no-ext-diff', '--no-textconv');
const result = spawnSync(${JSON.stringify(GIT)}, [
  '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
  ${JSON.stringify(`--git-dir=${metadata}`)}, ${JSON.stringify(`--work-tree=${cwd}`)}, command, ...args,
], {cwd: ${JSON.stringify(cwd)}, env: ${JSON.stringify({...GIT_ENV, GIT_INDEX_FILE: index})}, stdio: 'inherit'});
if (result.signal !== null) process.kill(process.pid, result.signal);
process.exitCode = result.status ?? 1;
`;
}

/**
 * The linked checkout's live index and files remain authoritative. Its shallow HEAD objects and neutral config live in
 * a separate read-only directory because granting the common Git directory would disclose other refs and local config.
 */
export async function prepareLinkedGitView(cwd: string, home: string, signal?: AbortSignal): Promise<GitView | undefined> {
  if ((await lstat(join(cwd, '.git'))).isDirectory()) return undefined;
  const git = async (directory: string, args: string[]) => (await execute(GIT, ['-c', 'core.hooksPath=/dev/null',
    '-c', 'core.fsmonitor=false', ...args], {cwd: directory, env: GIT_ENV, signal, timeout: 15_000, maxBuffer: 8192})).stdout.trim();
  const identity = await checkoutIdentity(cwd, git);
  const head = await git(cwd, ['rev-parse', 'HEAD']);
  if (!/^[a-f0-9]{40}$/u.test(head)) throw new Error('unsafe Codex checkout revision');
  const index = join(identity.gitDir, 'index'), headFile = join(identity.gitDir, 'HEAD');
  await Promise.all([trustedFile(index, false), trustedFile(headFile, false)]);
  if ((await readFile(headFile, 'utf8')).trim() !== head) throw new Error('Codex needs a detached linked checkout');
  const root = await mkdtemp(join(home, 'git-view-'));
  try {
    const bin = join(root, 'bin'), metadata = join(root, '.git');
    await mkdir(bin, {mode: 0o700});
    await git(root, ['-c', 'init.templateDir=', 'init', '--quiet']);
    await git(root, ['-c', 'protocol.allow=never', '-c', 'protocol.file.allow=always', 'fetch', '--quiet',
      '--no-tags', '--no-recurse-submodules', '--no-write-fetch-head', '--depth=1', identity.common, head]);
    await git(root, ['update-ref', '--no-deref', 'HEAD', head]);
    if (await git(root, ['rev-parse', 'HEAD']) !== head ||
      !sameCheckout(await checkoutIdentity(cwd, git), identity) || await git(cwd, ['rev-parse', 'HEAD']) !== head) {
      throw new Error('Codex checkout changed while preparing its Git view');
    }
    await writeFile(join(bin, 'git'), gitLauncher(cwd, metadata, index, headFile, head), {flag: 'wx', mode: 0o500});
    return {root, bin, readable: [metadata, index, headFile]};
  } catch (error) {
    await rm(root, {recursive: true, force: true}).catch(() => {});
    throw error;
  }
}

export async function releaseCodexToolchain(toolchain: CodexToolchain): Promise<void> {
  if (toolchain.gitView !== undefined) await rm(toolchain.gitView.root, {recursive: true, force: true}).catch(() => {});
}
