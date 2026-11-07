#!/usr/bin/env node
// Starts the selected core once at Mac sign-in (Hub #1426), through the operator of the release that matches its
// image, so the operation lease, the unfinished-deployment hold and the access checks all apply. It never runs
// `docker start` itself and never retries a refusal. A stopped core stays stopped under an owner's start hold or when
// it is a failed deployment's replacement. Installed alone by mac-host-install.mjs: imports only node:*.
import {execFile} from 'node:child_process';
import {realpathSync} from 'node:fs';
import {access, readdir, readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
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

// An owner's maintenance script (a backup, a configuration write) records under the same lease, which names the file by
// the record's ID and stamps its owner process, with the script's own fields and no schema. Only a deployment leaves a
// replacement behind, and the pending marker and lease already stop the operator while any operation is unfinished.
// One that carries a deployment's fields without its schema is a format this copy does not know.
const own = (record, field) => Object.hasOwn(record, field);
const maintenance = (name, record) => !own(record, 'schema') && typeof record.id === 'string' && name === `${record.id}.json`
  && typeof record.ownerProcess === 'object' && record.ownerProcess !== null && own(record, 'writerReleasedAt')
  && !own(record, 'replacementContainer') && !own(record, 'targetImage');

// Reads no operator state beyond what its records hold: a later deployment replaces the container, which ends the refusal.
export async function startGate({project, operations}, info) {
  const present = await access(join(operations, `${project}.start-hold`)).then(() => true, () => false);
  if (present) refuse('held');
  const records = join(operations, `${project}.records`);
  const names = await readdir(records).catch(error => (error.code === 'ENOENT' ? [] : refuse('records-unreadable')));
  for (const name of names.filter(file => file.endsWith('.json'))) {
    const record = await readFile(join(records, name), 'utf8').then(JSON.parse).catch(() => refuse('records-unreadable'));
    if (typeof record !== 'object' || record === null || Array.isArray(record)) refuse('records-unreadable');
    if (maintenance(name, record)) continue;
    // An installed copy can lag a release: a record format it does not know must not read as "no failed deployment".
    if (record.schema !== 'bunny-batch-record/1.0') refuse('records-unreadable');
    if (record.reconciledFrom === undefined || record.completedAt !== undefined) continue;
    // A replacement can fail before its ID is recorded; then its image and age identify it.
    const unnamed = record.replacementContainer === undefined && record.targetImage === info.Image
      && Date.parse(info.Created) <= Date.parse(record.reconciledAt);
    if (record.replacementContainer === info.Id || unnamed) refuse('failed-deployment');
  }
}

export async function startAtSignIn(selection, {
  run = docker,
  gate = info => startGate(selection, info),
  load = path => import(pathToFileURL(path).href),
  exists = path => access(path).then(() => true, () => false),
  sleep = delay,
  now = Date.now,
  report = () => {},
} = {}) {
  const {project, releases} = selection;
  const clock = {sleep, now};
  if (!await until(() => run(['info', '--format', '{{.ServerVersion}}']).then(() => true), engineWait, clock)) refuse('docker-unavailable');
  report({step: 'engine', outcome: 'ready'});
  const info = await selectedCore(project, run);
  if (info.State?.Running === true) {
    report({step: 'start', outcome: 'already-running'});
  } else {
    await gate(info);
    const {path, compose} = await operatorFor(info, releases, exists);
    const operator = await load(path).catch(() => refuse('operator-unusable'));
    // Imported rather than run: an older release's operator hangs at its entry point (#1410), and the same lease and checks apply.
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

const notices = {
  held: 'The runtime stayed stopped at sign-in because of its start hold.',
  'failed-deployment': 'The runtime stayed stopped at sign-in: its image failed a deployment.',
  'health-failed': 'The runtime is running but did not report healthy after sign-in.',
};
const notify = reason => new Promise(done => {
  const notice = notices[reason] ?? `The runtime did not start at sign-in: ${reason}.`;
  const script = `display notification "${notice} Check the sign-in log." with title "B.U.N.N.Y."`;
  execFile('osascript', ['-e', script], {timeout: 10 * seconds}, () => done());
});

function isEntryPoint() {
  // Node resolves a symlink for import.meta.url but keeps it in argv, and a missed match would exit 0 having done nothing.
  try {return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));}
  catch {return false;}
}
if (isEntryPoint()) {
  const {values} = parseArgs({options: {project: {type: 'string'}, releases: {type: 'string'}}});
  const report = fields => process.stdout.write(`${JSON.stringify({at: new Date().toISOString(), ...fields})}\n`);
  try {
    await startAtSignIn({
      project: values.project ?? 'bunny-mac-personal',
      releases: values.releases ?? join(homedir(), '.local', 'share', 'bunny', 'releases'),
      operations: join(homedir(), '.local', 'state', 'bunny-operations'),
    }, {report});
  } catch (error) {
    const reason = error instanceof Refused ? error.reason : 'unexpected';
    report({step: 'signin', reason});
    await notify(reason);
    process.exitCode = 1;
  }
}
