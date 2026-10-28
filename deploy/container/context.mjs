// Ordinary Git export of a reviewed revision, with a closed source-root allowlist. No working-file reads.
import {execFile} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {isAbsolute, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const execute = promisify(execFile);
const roots = ['.dockerignore', '.nvmrc', 'package.json', 'package-lock.json',
  'src', 'packages', 'apps', 'modules', 'controllers', 'scripts', 'deploy/container', 'docs/skins/places.json'];
const privateSegment = /^(?:node_modules|dist|\.git|\.local|\.private|private|secrets|backups|artifacts|coverage|test-results|playwright-report|__pycache__|\.codex|\.claude)$/i;
const privateFile = /^(?:\.env(?:\..*)?|config\.local\..*|CLAUDE\.local\.md|\.DS_Store|Thumbs\.db)$|(?:\.local\.json|\.log|\.sqlite(?:3)?(?:-.*)?|\.db(?:-.*)?|\.key|\.pem|\.pfx|\.p12|\.pyc)$/i;

export async function createContext({repository, revision, destination}) {
  if (!/^[a-f0-9]{40}$/.test(revision) || !isAbsolute(destination)) throw new Error('context-input-refused');
  const git = async args => execute('git', ['-C', repository, ...args], {encoding: 'buffer', maxBuffer: 8 * 1024 * 1024});
  await git(['cat-file', '-e', revision + '^{commit}']);
  const {stdout} = await git(['ls-tree', '-rz', revision]);
  const entries = new TextDecoder('utf-8', {fatal: true}).decode(stdout).split('\0').filter(Boolean).map(line => {
    const split = line.indexOf('\t');
    return {path: line.slice(split + 1), mode: line.slice(0, split).split(' ')[0]};
  });
  const allPaths = entries.map(entry => entry.path);
  const buildConfigs = allPaths.filter(path => /^tsconfig[^/]*\.json$/.test(path));
  const selectedRoots = [...roots.filter(root => allPaths.some(path => path === root || path.startsWith(root + '/'))), ...buildConfigs];
  const paths = allPaths.filter(path => selectedRoots.some(root => path === root || path.startsWith(root + '/')));
  for (const path of paths) {
    if (!['100644', '100755'].includes(entries.find(entry => entry.path === path)?.mode)) throw new Error('unsupported-source-entry');
    if ([...path].some(character => character.charCodeAt(0) < 32 || character === '\\')
      || path.split('/').some(part => privateSegment.test(part) || privateFile.test(part))) {
      throw new Error('private-path-in-source-revision');
    }
  }
  if (!paths.includes('deploy/container/Dockerfile') || !paths.includes('.dockerignore') || !paths.includes('package-lock.json')) {
    throw new Error('context-source-incomplete');
  }
  // Exclusive destination creation: errors leave an inspectable partial export, never overwrite an archive.
  await mkdir(destination, {mode: 0o700});
  const archive = join(destination, 'context.tar');
  await git(['archive', '--format=tar', '--output=' + archive, revision, '--', ...selectedRoots]);
  return {revision, archive};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [revision, destination, ...extra] = process.argv.slice(2);
    if (extra.length || !destination) throw new Error('context-input-refused');
    const repository = resolve(fileURLToPath(new URL('../../', import.meta.url)));
    process.stdout.write(JSON.stringify(await createContext({repository, revision, destination})) + '\n');
  } catch {
    process.stderr.write('source context refused; use a committed source revision and a new destination\n');
    process.exitCode = 2;
  }
}
