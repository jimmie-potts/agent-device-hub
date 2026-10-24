import assert from 'node:assert/strict';
import test from 'node:test';
import {portableCreateArgs, portableContainerMatches, portableManifest, portableArtifact, stopPortableContainer, finishPortable, recoverPortableAbsence} from '../dist/portable.js';
import {mkdtemp, rm, writeFile, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

const identity = {runId: 'runtime-20261022T214100Z-abcdef', revision: '1'.repeat(40), image: 'sha256:' + '2'.repeat(64),
  artifactDigest: 'sha256:' + '3'.repeat(64), step: 'mac-codex-local', seconds: 180};
const id = '4'.repeat(64);
test('image build manifest is closed, source-bound and requires a real digest', () => {
  const valid = {schema: 'portable-artifact/1', revision: identity.revision, artifactDigest: identity.artifactDigest};
  assert.equal(portableArtifact(valid, identity.revision), identity.artifactDigest);
  for (const value of [{...valid, revision: 'f'.repeat(40)}, {...valid, artifactDigest: null}, {...valid, artifactDigest: 'unknown'},
    {...valid, schema: 'other'}, {...valid, token: 'PRIVATE_CANARY'}]) assert.throws(() => portableArtifact(value, identity.revision));
  assert.doesNotThrow(() => portableCreateArgs({...identity, artifactDigest: null})); // honest pre-start pending identity
});
function container() {
  const args = portableCreateArgs(identity);
  return {Id: id, Image: identity.image, Config: {User: '1000:1000', Labels: {'org.bunny.verify.run': identity.runId,
    'org.bunny.verify.revision': identity.revision}, Entrypoint: ['/usr/bin/timeout'], Cmd: args.slice(args.indexOf(identity.image) + 1)},
  State: {Running: false, Restarting: false, Paused: false, Pid: 0, Status: 'exited', ExitCode: 0}, Mounts: [],
  HostConfig: {NetworkMode: 'none', RestartPolicy: {Name: 'no'}, AutoRemove: false, Init: true,
    Privileged: false, CapAdd: null, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'], Devices: [], DeviceRequests: null,
    Binds: null, PortBindings: {}, PidMode: '', IpcMode: 'private', UTSMode: '', CgroupnsMode: 'private', LogConfig: {Type: 'none'}},
  NetworkSettings: {Ports: {}, Networks: {none: {}}}};
}
test('portable launch is offline, finite, nonprivileged, has no mounts/ports and never auto-removes', () => {
  const args = portableCreateArgs(identity);
  for (const flag of ['--init', '--cap-drop', '--security-opt', '--network', '--restart', '--log-driver']) assert.ok(args.includes(flag));
  for (const flag of ['--rm', '-v', '--volume', '--mount', '--publish', '-p', '--privileged', '--detach']) assert.equal(args.includes(flag), false);
  assert.deepEqual(args.slice(args.indexOf(identity.image) + 1), ['--signal=KILL', '180s', '/usr/local/bin/node', '/opt/bunny/apps/runtime/dist/verify/portable-driver.js']);
  assert.equal(portableContainerMatches(container(), identity), true);
});
test('foreign identity and every effective isolation widening refuse admission', () => {
  const changes = [c => c.Id = 'short', c => c.Image = 'sha256:' + '5'.repeat(64), c => c.Config.User = '0',
    c => c.Config.Labels['org.bunny.verify.run'] = 'other', c => c.Config.Cmd[1] = '9999s',
    c => c.Mounts.push({Type: 'bind'}), c => c.HostConfig.NetworkMode = 'bridge',
    c => c.HostConfig.Privileged = true, c => c.HostConfig.AutoRemove = true, c => c.HostConfig.Init = false,
    c => c.HostConfig.RestartPolicy.Name = 'always', c => c.HostConfig.CapAdd = ['NET_ADMIN'],
    c => c.HostConfig.SecurityOpt = [], c => c.HostConfig.Devices = [{}], c => c.HostConfig.Binds = ['/private:/x'],
    c => c.HostConfig.PortBindings = {'80/tcp': [{}]}, c => c.HostConfig.PidMode = 'host',
    c => c.HostConfig.IpcMode = 'host', c => c.HostConfig.CgroupnsMode = 'host', c => c.HostConfig.LogConfig.Type = 'json-file',
    c => c.HostConfig.Tmpfs = {'/var/lib/app-verify': ''}, c => c.HostConfig.DeviceRequests = [{}],
    c => c.NetworkSettings.Networks.bridge = {}];
  for (const change of changes) {const c = container(); change(c); assert.equal(portableContainerMatches(c, identity), false, String(change));}
});
test('manifest rejects changed candidate, paths, excessive size, missing captures and false success', () => {
  const good = {schema: 'portable-capture/1', runId: identity.runId, revision: identity.revision, artifactDigest: identity.artifactDigest,
    step: identity.step, outcome: 'passed', assertions: 3,
    files: [{name: 'capture/assertions.json', bytes: 100, sha256: 'a'.repeat(64)},
      {name: 'capture/after.png', bytes: 100, sha256: 'b'.repeat(64)}, {name: 'capture/interaction.webm', bytes: 100, sha256: 'c'.repeat(64)},
      {name: 'capture/checks.json', bytes: 100, sha256: 'd'.repeat(64)}]};
  assert.deepEqual(portableManifest(good, identity), good);
  for (const bad of [{...good, runId: 'foreign'}, {...good, revision: 'f'.repeat(40)}, {...good, artifactDigest: 'sha256:' + 'f'.repeat(64)},
    {...good, assertions: 0}, {...good, outcome: 'passed', files: []}, {...good, files: good.files.slice(0, 3)},
    {...good, files: [{...good.files[0], name: '../config/producer.json'}]},
    {...good, files: [{...good.files[0], name: 'capture/extra.json'}]},
    {...good, files: [{...good.files[0], bytes: 1024 ** 3}]}]) assert.throws(() => portableManifest(bad, identity));
});
test('cleanup never stops/removes a foreign container or deletes after an unknown/live stop', async () => {
  for (const kind of ['foreign', 'unknown', 'live']) {
    const calls = []; const c = container();
    if (kind === 'foreign') c.Image = 'sha256:' + 'f'.repeat(64);
    if (kind === 'live') Object.assign(c.State, {Running: true, Status: 'running', Pid: 22});
    const run = async args => {calls.push(args); if (kind === 'unknown') throw new Error('unavailable'); return JSON.stringify([c]);};
    assert.equal(await stopPortableContainer(id, identity, run), false);
    assert.equal(calls.some(args => args[0] === 'rm'), false);
    if (kind !== 'live') assert.equal(calls.some(args => args[0] === 'stop'), false);
  }
});
test('stopped exact ownership is authoritative; cleanup helper only proves stop and never removes', async () => {
  const calls = []; const run = async args => {calls.push(args); return JSON.stringify([container()]);};
  assert.equal(await stopPortableContainer(id, identity, run), true);
  assert.deepEqual(calls, [['inspect', id]]);
});

async function proofWorld(t, mode = 'passed') {
  const at = await mkdtemp(join(tmpdir(), 'portable-proof-'));
  t.after(() => rm(at, {recursive: true, force: true}));
  const receipt = {receiptVersion: 'app-verification-portable/1', identity, backend: 'docker-foreground', containerId: id,
    architecture: 'synthetic', state: 'running', startedAt: '2026-10-22T21:41:00Z', finishedAt: null,
    realtimeExpiryAcrossSuspend: false, capture: null, cleanup: {stopped: false, container: 'pending'}, failure: null, secrets: 'none recorded'};
  const log = {runId: identity.runId, step: identity.step, outcome: mode === 'failed' ? 'failed' : 'passed', finishedAt: '2026-10-22T21:42:00Z', assertions: [{outcome: 'passed'}, {outcome: 'passed'}]};
  const files = new Map([
    ['capture/assertions.json', Buffer.from(JSON.stringify(log))],
    ['capture/after.png', Buffer.from('89504e470d0a1a0a', 'hex')],
    ['capture/interaction.webm', Buffer.from('1a45dfa38018538067841c53bb6b', 'hex')],
    ['capture/checks.json', Buffer.from('{"synthetic":true}')],
  ]);
  if (mode === 'failed') {files.delete('capture/after.png'); files.delete('capture/interaction.webm');}
  if (mode === 'bad-video') files.set('capture/interaction.webm', Buffer.from('not finalized'));
  if (mode === 'private-json') files.set('capture/checks.json', Buffer.from('{"leak":"PRIVATE_CANARY"}'));
  if (mode === 'abandoned') files.set('capture/assertions.json', Buffer.from(JSON.stringify({...log, outcome: 'failed'})));
  const manifest = {schema: 'portable-capture/1', runId: identity.runId, revision: identity.revision, artifactDigest: identity.artifactDigest,
    step: identity.step, outcome: mode === 'failed' ? 'failed' : 'passed', assertions: 2,
    files: [...files].map(([name, bytes]) => ({name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')}))};
  const calls = [];
  const run = async args => {
    calls.push(args);
    if (args[0] === 'inspect') return JSON.stringify([container()]);
    if (args[0] === 'cp') {
      const key = args[1].split('/proof/')[1];
      await writeFile(args[2], key === 'manifest.json' ? JSON.stringify(manifest) : files.get(key)); return '';
    }
    if (args[0] === 'rm') return id;
    if (args[0] === 'ps') return mode === 'removal-unknown' ? id : '';
    throw new Error('unexpected call');
  };
  return {at, receipt, calls, run};
}
test('validated proof survives exact removal, with separate capture and cleanup evidence', async t => {
  const w = await proofWorld(t);
  await finishPortable(w.receipt, w.at, w.run, true);
  assert.equal(w.receipt.state, 'passed'); assert.equal(w.receipt.cleanup.container, 'removed');
  assert.equal(w.receipt.cleanup.stopped, true);
  assert.equal(JSON.parse(await readFile(join(w.at, 'capture-manifest.json'), 'utf8')).runId, identity.runId);
  assert.ok(w.calls.findIndex(a => a[0] === 'rm') > w.calls.findLastIndex(a => a[0] === 'cp'));
});
for (const mode of ['bad-video', 'private-json', 'abandoned', 'removal-unknown']) test(`${mode} cannot pass or erase missing proof`, async t => {
  const w = await proofWorld(t, mode);
  await finishPortable(w.receipt, w.at, w.run, true);
  assert.notEqual(w.receipt.state, 'passed'); assert.equal(w.receipt.cleanup.container, 'left');
  if (mode !== 'removal-unknown') assert.equal(w.calls.some(a => a[0] === 'rm'), false);
});
test('failed capture stays private until explicit cleanup, which never turns it into a pass', async t => {
  const w = await proofWorld(t, 'failed');
  await finishPortable(w.receipt, w.at, w.run, true);
  assert.equal(w.receipt.state, 'failed'); assert.equal(w.receipt.cleanup.container, 'left');
  assert.equal(w.calls.some(a => a[0] === 'rm'), false);
  await finishPortable(w.receipt, w.at, w.run, false, true);
  assert.equal(w.receipt.state, 'failed'); assert.equal(w.receipt.cleanup.container, 'removed');
});

for (const mode of ['forced-interruption', 'early-kill', 'oom', 'late-ambiguous-kill']) {
  test(`${mode}: exit 137 does not establish deadline expiry or erase failed proof`, async t => {
    const w = await proofWorld(t, 'failed');
    w.receipt.identity = {...identity, seconds: 600};
    w.receipt.startedAt = new Date(Date.now() - (mode === 'late-ambiguous-kill' ? 601_000 : 0)).toISOString();
    let running = mode === 'forced-interruption';
    const calls = [];
    const run = async args => {
      calls.push(args);
      if (args[0] === 'inspect') {
        const c = container();
        const launch = portableCreateArgs(w.receipt.identity);
        c.Config.Cmd = launch.slice(launch.indexOf(w.receipt.identity.image) + 1);
        Object.assign(c.State, {Running: running, Pid: running ? 22 : 0, Status: running ? 'running' : 'exited',
          ExitCode: running ? 0 : 137, OOMKilled: mode === 'oom'});
        return JSON.stringify([c]);
      }
      if (args[0] === 'stop') {running = false; return id;}
      return w.run(args);
    };
    await finishPortable(w.receipt, w.at, run, false);
    assert.equal(w.receipt.state, 'failed');
    assert.deepEqual(w.receipt.cleanup, {stopped: true, container: 'left'});
    assert.equal(w.receipt.failure, 'capture-incomplete');
    assert.equal(calls.filter(args => args[0] === 'stop').length, mode === 'forced-interruption' ? 1 : 0);
    assert.equal(calls.some(args => args[0] === 'rm'), false);
    await finishPortable(w.receipt, w.at, run, false, true);
    assert.equal(w.receipt.state, 'failed');
    assert.equal(w.receipt.cleanup.container, 'removed');
    assert.equal(JSON.parse(await readFile(join(w.at, 'capture-manifest.json'), 'utf8')).outcome, 'failed');
  });
}

test('recovery reconciles rm-before-receipt-save using exact absence and surviving proof without promotion', async t => {
  const w = await proofWorld(t);
  await finishPortable(w.receipt, w.at, w.run, true);
  Object.assign(w.receipt, {state: 'unknown', capture: null, failure: 'operation-unconfirmed', cleanup: {stopped: false, container: 'unknown'}});
  const calls = [];
  const absent = async args => {calls.push(args); if (args[0] === 'ps') return ''; throw new Error('container absent');};
  await finishPortable(w.receipt, w.at, absent, false, true);
  assert.equal(w.receipt.state, 'failed');
  assert.deepEqual(w.receipt.cleanup, {stopped: true, container: 'removed'});
  assert.equal(w.receipt.capture.outcome, 'passed');
  assert.equal(w.receipt.failure, 'recovered-after-removal');
  assert.deepEqual(calls.map(a => a[0]), ['inspect', 'ps']);
});

test('authoritative absence with missing retained proof is truthful but unsuccessful', async t => {
  const w = await proofWorld(t);
  const absent = async args => {if (args[0] === 'ps') return ''; throw new Error('container absent');};
  await finishPortable(w.receipt, w.at, absent, false, true);
  assert.equal(w.receipt.state, 'unknown');
  assert.deepEqual(w.receipt.cleanup, {stopped: true, container: 'removed'});
  assert.equal(w.receipt.capture, null);
  assert.equal(w.receipt.failure, 'proof-unavailable');
  assert.equal(await recoverPortableAbsence(w.receipt, w.at, absent), true);
  assert.equal(w.receipt.state, 'unknown');
  assert.deepEqual(w.receipt.cleanup, {stopped: true, container: 'removed'});
});

test('failed Docker reads never establish absence or destroy retained evidence', async t => {
  const w = await proofWorld(t);
  await finishPortable(w.receipt, w.at, async () => {throw new Error('engine unavailable');}, false, true);
  assert.equal(w.receipt.state, 'unknown');
  assert.deepEqual(w.receipt.cleanup, {stopped: false, container: 'unknown'});
});
