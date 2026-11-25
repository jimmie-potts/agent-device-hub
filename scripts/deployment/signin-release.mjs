import {execFile} from 'node:child_process';
import {lstat, realpath, stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {isAbsolute, join} from 'node:path';
import {parseArgs, promisify} from 'node:util';
import {operatorFor, signinOperatorPaths, signinReleaseRoot} from '../mac-signin.mjs';
import {operatorRefusal} from '../operator-refusal.mjs';

const exec = promisify(execFile);
const refuse = () => {throw operatorRefusal('selection');};
const optional = error => {
  if (error.code === 'ENOENT') return undefined;
  throw error;
};

/** Use the installed launcher's project and release directory even if launchd has not loaded it yet. */
export async function installedSigninReleases(project, {home = homedir(), platform = process.platform} = {}) {
  if (platform !== 'darwin') return undefined;
  const plist = join(home, 'Library', 'LaunchAgents', 'org.bunny.runtime-signin.plist');
  try {
    if (await lstat(plist).catch(optional) === undefined) return undefined;
    const {stdout} = await exec('/usr/bin/plutil', ['-extract', 'ProgramArguments', 'json', '-o', '-', plist], {timeout: 5000});
    const args = JSON.parse(stdout);
    const script = join(home, '.local', 'share', 'bunny', 'signin', 'mac-signin.mjs');
    if (!Array.isArray(args) || !args.every(arg => typeof arg === 'string') || args[1] !== script) refuse();
    const {values} = parseArgs({args: args.slice(2), options: {project: {type: 'string'}, releases: {type: 'string'}}});
    if ((values.project ?? 'bunny-mac-personal') !== project) return undefined;
    const releases = values.releases ?? signinReleaseRoot(home);
    if (!isAbsolute(releases)) refuse();
    return releases;
  } catch {return refuse();}
}

/** Bind the installed launcher's fixed lookup to the operator that is executing the batch. */
export async function verifySigninRelease({releases, source, revision, compose}, info) {
  const labels = {'org.opencontainers.image.revision': revision, 'com.docker.compose.project.config_files': compose};
  const candidate = info ?? {Config: {Labels: labels}};
  const operator = join(source, 'scripts', 'bunny.mjs');
  try {
    if (Object.entries(labels).some(([key, value]) => candidate.Config?.Labels?.[key] !== value)) refuse();
    if (await realpath(operator) !== operator || !(await stat(operator)).isFile()) refuse();
    const locations = signinOperatorPaths(releases, revision);
    const found = await operatorFor(candidate, releases, async path => (await lstat(path).catch(optional)) !== undefined);
    if (await realpath(found.path) !== operator) refuse();
    for (const path of locations) {
      if (await lstat(path).catch(optional) !== undefined && await realpath(path) !== operator) refuse();
    }
    if (await lstat(join(source, '.git')).catch(optional) !== undefined) {
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
      const options = {cwd: source, timeout: 5000, env};
      const {stdout: identity} = await exec('git', ['rev-parse', '--show-toplevel', 'HEAD'], options);
      if (identity !== `${source}\n${revision}\n`) refuse();
      const {stdout: trackedChanges} = await exec('git', ['-c', 'core.fsmonitor=false', 'status', '--porcelain', '--untracked-files=no'], options);
      if (trackedChanges !== '') refuse();
    } else if (!locations.includes(operator)) refuse();
  } catch {return refuse();}
}
