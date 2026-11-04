#!/usr/bin/env node
// Starts the selected core once at Mac sign-in (Hub #1426), through the operator of the release that matches its
// image, so the operation lease, the unfinished-deployment hold and the access checks all apply. It never runs
// `docker start` itself and never retries a refusal. Installed alone by mac-host-install.mjs: imports only node:*.
import {execFile} from 'node:child_process';
import {access} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join, resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';

const seconds = 1000;
export const engineWait = 300 * seconds;
export const healthWait = 180 * seconds;
const poll = 5 * seconds;
const healthCommand = ['node', '/opt/bunny/deploy/container/entrypoint.mjs', 'status'];

class Refused extends Error {
  constructor(reason) {super(reason); this.reason = reason;}
}
const refuse = reason => {throw new Refused(reason);};

const docker = args => new Promise((done, fail) => {
  execFile('docker', args, {timeout: 30 * seconds, maxBuffer: 16 * 1024 * 1024}, (error, stdout) => (error ? fail(error) : done(stdout)));
});

async function until(attempt, limit, {sleep, now}) {
  const deadline = now() + limit;
  for (;;) {
    if (await attempt().then(result => result, () => false)) return true;
    if (now() >= deadline) return false;
    await sleep(poll);
  }
}

async function selectedCore(project, run) {
  const ids = (await run(['ps', '-a', '--no-trunc', '--filter', `label=com.docker.compose.project=${project}`,
    '--filter', 'label=com.docker.compose.service=core', '--format', '{{.ID}}'])).split('\n').filter(Boolean);
  if (ids.length === 0) refuse('core-missing');
  if (ids.length > 1) refuse('core-ambiguous');
  const [info] = JSON.parse(await run(['inspect', ids[0]]));
  return info;
}

// The container's own labels name its revision and Compose file, so a deployment needs no change here.
export async function operatorFor(info, releases, exists) {
  const labels = info.Config?.Labels ?? {};
  const revision = labels['org.opencontainers.image.revision'];
  const compose = labels['com.docker.compose.project.config_files'];
  if (!/^[0-9a-f]{40}$/.test(revision ?? '') || typeof compose !== 'string' || compose === '' || compose.includes(',')) refuse('identity-invalid');
  for (const source of ['source', join('build', 'source')]) {
    const path = join(releases, revision, source, 'scripts', 'bunny.mjs');
    if (await exists(path)) return {path, compose};
  }
  return refuse('operator-missing');
}

export async function startAtSignIn({project, releases}, {
  run = docker,
  load = path => import(pathToFileURL(path).href),
  exists = path => access(path).then(() => true, () => false),
  sleep = delay,
  now = Date.now,
  report = () => {},
} = {}) {
  const clock = {sleep, now};
  if (!await until(() => run(['info', '--format', '{{.ServerVersion}}']).then(() => true), engineWait, clock)) refuse('docker-unavailable');
  report({step: 'engine', outcome: 'ready'});
  const info = await selectedCore(project, run);
  if (info.State?.Running === true) {
    report({step: 'start', outcome: 'already-running'});
  } else {
    const {path, compose} = await operatorFor(info, releases, exists);
    const operator = await load(path).catch(() => refuse('operator-unusable'));
    // Imported rather than run: the operator's entry point hangs on the Mac (#1410), and the same lease and checks apply.
    try {await operator.maintain(operator.parse(['start', '--project', project, '--compose', compose]));}
    catch (error) {
      report({step: 'start', outcome: 'refused', code: error.code ?? error.message});
      refuse('start-refused');
    }
    report({step: 'start', outcome: 'started'});
  }
  const healthy = await until(async () => {
    const {Id} = await selectedCore(project, run);
    return JSON.parse(await run(['exec', Id, ...healthCommand])).status === 'ok';
  }, healthWait, clock);
  if (!healthy) refuse('health-failed');
  report({step: 'health', outcome: 'ok'});
  return {outcome: 'running'};
}

const notify = reason => new Promise(done => {
  const script = `display notification "The runtime did not start at sign-in: ${reason}. Check the sign-in log." with title "B.U.N.N.Y."`;
  execFile('osascript', ['-e', script], {timeout: 10 * seconds}, () => done());
});

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {values} = parseArgs({options: {project: {type: 'string'}, releases: {type: 'string'}}});
  const report = fields => process.stdout.write(`${JSON.stringify({at: new Date().toISOString(), ...fields})}\n`);
  try {
    await startAtSignIn({
      project: values.project ?? 'bunny-mac-personal',
      releases: values.releases ?? join(homedir(), '.local', 'share', 'bunny', 'releases'),
    }, {report});
  } catch (error) {
    const reason = error instanceof Refused ? error.reason : 'unexpected';
    report({step: 'signin', reason});
    await notify(reason);
    process.exitCode = 1;
  }
}
